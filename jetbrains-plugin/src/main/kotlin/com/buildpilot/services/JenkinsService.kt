package com.buildpilot.services

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.util.text.StringUtil
import org.jetbrains.annotations.Nullable
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.util.Base64

@Service
@State(name = "BuildPilotJenkins", storages = [Storage("buildpilot.xml")])
class JenkinsService {
    var baseUrl: String = ""
    var username: String = ""
    var jobs: MutableMap<String, JenkinsJob> = mutableMapOf()

    val isLoggedIn: Boolean get() = baseUrl.isNotEmpty() && username.isNotEmpty()

    // --- Security: URL Validation ---
    private val blockedPatterns = listOf(
        Regex("^127\\."), Regex("^10\\."), Regex("^172\\.(1[6-9]|2\\d|3[01])\\."),
        Regex("^192\\.168\\."), Regex("^169\\.254\\."), Regex("^0\\."),
        Regex("^localhost$", RegexOption.IGNORE_CASE), Regex("^::1$")
    )

    private fun validateBaseUrl(url: String): String {
        if (url.isBlank()) throw IOException("Invalid Jenkins URL")
        val parsed = try { URI(url.trimEnd('/')) } catch (_: Exception) { throw IOException("Invalid URL format") }
        if (parsed.scheme != "https" && parsed.scheme != "http") throw IOException("Only HTTP/HTTPS allowed")
        val host = parsed.host ?: throw IOException("Invalid hostname")
        for (p in blockedPatterns) { if (p.containsMatchIn(host)) throw IOException("Private/internal networks blocked") }
        return "${parsed.scheme}://${parsed.host}${if (parsed.port > 0) ":${parsed.port}" else ""}"
    }

    // --- Security: Parameter Validation ---
    private val PARAM_REGEX = Regex("^[a-zA-Z0-9_.\\-]+$")
    private val RESERVED = setOf("token", "cause", "json", "submit")

    private fun validateParams(params: Map<String, String>): Map<String, String> {
        for ((key, value) in params) {
            if (!PARAM_REGEX.matches(key)) throw IOException("Invalid param name: \"$key\"")
            if (RESERVED.contains(key.lowercase())) throw IOException("\"$key\" is reserved")
            if (value.length > 1000) throw IOException("\"$key\" value too long")
        }
        return params
    }

    // --- HTTP (zero dependencies) ---
    private fun authHeader(): String {
        val token = getApiToken()
        return "Basic " + Base64.getEncoder().encodeToString("$username:$token".toByteArray())
    }

    private fun httpGet(url: String): String {
        val conn = URI(url).toURL().openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.setRequestProperty("Authorization", authHeader())
        conn.connectTimeout = 15000
        conn.readTimeout = 30000
        conn.instanceFollowRedirects = false
        try {
            if (conn.responseCode >= 400) throw IOException("HTTP ${conn.responseCode}")
            return conn.inputStream.bufferedReader().readText()
        } finally { conn.disconnect() }
    }

    private fun httpPost(url: String): Int {
        val conn = URI(url).toURL().openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Authorization", authHeader())
        conn.connectTimeout = 15000
        conn.readTimeout = 15000
        conn.instanceFollowRedirects = false
        conn.doOutput = true
        conn.outputStream.close()
        val code = conn.responseCode
        conn.disconnect()
        return code
    }

    // --- Credentials ---
    private fun getApiToken(): String {
        val attrs = CredentialAttributes("BuildPilot-Jenkins", username)
        return PasswordSafe.instance.getPassword(attrs) ?: ""
    }

    private fun getBuildToken(): String {
        val attrs = CredentialAttributes("BuildPilot-BuildToken", username)
        return PasswordSafe.instance.getPassword(attrs) ?: ""
    }

    // --- Core ---
    fun login(url: String, user: String, apiToken: String, token: String) {
        val validUrl = validateBaseUrl(url)
        // Validate with a direct connection
        val conn = URI("$validUrl/me/api/json").toURL().openConnection() as HttpURLConnection
        conn.setRequestProperty("Authorization", "Basic " + Base64.getEncoder().encodeToString("$user:$apiToken".toByteArray()))
        conn.connectTimeout = 15000; conn.readTimeout = 15000
        if (conn.responseCode >= 400) { conn.disconnect(); throw IOException("Login failed: HTTP ${conn.responseCode}") }
        conn.disconnect()

        baseUrl = validUrl; username = user
        val apiAttrs = CredentialAttributes("BuildPilot-Jenkins", user)
        PasswordSafe.instance.set(apiAttrs, Credentials(user, apiToken))
        val buildAttrs = CredentialAttributes("BuildPilot-BuildToken", user)
        PasswordSafe.instance.set(buildAttrs, Credentials(user, token))
    }

    fun discoverJobs() {
        val body = httpGet("$baseUrl/api/json?tree=jobs[name,url,color,_class]")
        jobs.clear()
        // Simple JSON parsing without Gson
        val jobsArray = extractJsonArray(body, "jobs")
        for (jobStr in jobsArray) {
            val cls = extractJsonString(jobStr, "_class")
            if (cls.contains("Folder")) continue
            val name = extractJsonString(jobStr, "name")
            if (name.isEmpty()) continue
            val color = extractJsonString(jobStr, "color").ifEmpty { "unknown" }
            jobs[name] = JenkinsJob(name, "/job/${enc(name)}", color)
        }
    }

    fun triggerBuild(jobName: String, params: Map<String, String> = emptyMap()) {
        val job = jobs[jobName] ?: throw IOException("Job '$jobName' not found")
        val sanitized = validateParams(params)
        val buildToken = getBuildToken()
        val qs = StringBuilder("token=${enc(buildToken)}&cause=BuildPilot")
        for ((k, v) in sanitized) qs.append("&${enc(k)}=${enc(v)}")
        val code = httpPost("$baseUrl${job.path}/buildWithParameters?$qs")
        if (code >= 400 && code != 201) throw IOException("Build failed: HTTP $code")
    }

    fun getLastBuild(jobName: String): BuildInfo? {
        val job = jobs[jobName] ?: return null
        return try {
            val body = httpGet("$baseUrl${job.path}/lastBuild/api/json?tree=number,building,result,timestamp,duration")
            BuildInfo(
                number = extractJsonNumber(body, "number"),
                building = body.contains("\"building\":true"),
                result = extractJsonString(body, "result").ifEmpty { null },
                timestamp = extractJsonLong(body, "timestamp"),
                duration = extractJsonLong(body, "duration")
            )
        } catch (_: Exception) { null }
    }

    fun getConsoleOutput(jobName: String, buildNumber: Int): String {
        val job = jobs[jobName] ?: return ""
        return try {
            val text = httpGet("$baseUrl${job.path}/$buildNumber/consoleText")
            text.lines().takeLast(100).joinToString("\n")
        } catch (_: Exception) { "" }
    }

    fun stopBuild(jobName: String, buildNumber: Int) {
        val job = jobs[jobName] ?: throw IOException("Job '$jobName' not found")
        httpPost("$baseUrl${job.path}/$buildNumber/stop")
    }

    fun logout() {
        val apiAttrs = CredentialAttributes("BuildPilot-Jenkins", username)
        PasswordSafe.instance.set(apiAttrs, null)
        val buildAttrs = CredentialAttributes("BuildPilot-BuildToken", username)
        PasswordSafe.instance.set(buildAttrs, null)
        baseUrl = ""; username = ""; jobs.clear()
    }

    fun safeErrorMessage(e: Exception): String {
        return (e.message ?: "Unknown error")
            .replace(Regex("https?://[^\\s]+"), "[REDACTED]")
            .replace(Regex("Basic\\s+[A-Za-z0-9+/=]+"), "[REDACTED]")
            .take(200)
    }

    // --- Minimal JSON helpers (no Gson needed) ---
    private fun extractJsonString(json: String, key: String): String {
        val pattern = "\"$key\"\\s*:\\s*\"([^\"]*)\""
        return Regex(pattern).find(json)?.groupValues?.get(1) ?: ""
    }

    private fun extractJsonNumber(json: String, key: String): Int {
        val pattern = "\"$key\"\\s*:\\s*(\\d+)"
        return Regex(pattern).find(json)?.groupValues?.get(1)?.toIntOrNull() ?: 0
    }

    private fun extractJsonLong(json: String, key: String): Long {
        val pattern = "\"$key\"\\s*:\\s*(\\d+)"
        return Regex(pattern).find(json)?.groupValues?.get(1)?.toLongOrNull() ?: 0L
    }

    private fun extractJsonArray(json: String, key: String): List<String> {
        val startIdx = json.indexOf("\"$key\"")
        if (startIdx < 0) return emptyList()
        val arrStart = json.indexOf('[', startIdx)
        if (arrStart < 0) return emptyList()
        // Find matching bracket, split by objects
        var depth = 0; var objStart = -1
        val objects = mutableListOf<String>()
        for (i in arrStart until json.length) {
            when (json[i]) {
                '[' -> depth++
                ']' -> { depth--; if (depth == 0) break }
                '{' -> { if (depth == 1 && objStart < 0) objStart = i; if (depth >= 1) depth++ }
                '}' -> { depth--; if (depth == 1 && objStart >= 0) { objects.add(json.substring(objStart, i + 1)); objStart = -1 } }
            }
        }
        return objects
    }

    private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")

    companion object {
        fun getInstance(): JenkinsService = ApplicationManager.getApplication().getService(JenkinsService::class.java)
    }
}

data class JenkinsJob(val name: String, val path: String, val color: String)
data class BuildInfo(val number: Int, val building: Boolean, val result: String?, val timestamp: Long, val duration: Long)
