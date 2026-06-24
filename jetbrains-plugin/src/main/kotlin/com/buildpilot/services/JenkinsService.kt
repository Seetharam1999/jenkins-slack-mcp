package com.buildpilot.services

import com.google.gson.Gson
import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import okhttp3.*
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit

@Service
@State(name = "BuildPilotJenkins", storages = [Storage("buildpilot.xml")])
class JenkinsService {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()
    private val gson = Gson()

    var baseUrl: String = ""
    var username: String = ""
    var jobs: MutableMap<String, JenkinsJob> = mutableMapOf()

    val isLoggedIn: Boolean get() = baseUrl.isNotEmpty() && username.isNotEmpty()

    // --- Security: URL Validation ---
    private val blockedPatterns = listOf(
        Regex("^127\\."), Regex("^10\\."), Regex("^172\\.(1[6-9]|2\\d|3[01])\\."),
        Regex("^192\\.168\\."), Regex("^169\\.254\\."), Regex("^0\\."),
        Regex("^localhost$", RegexOption.IGNORE_CASE), Regex("^::1$"),
        Regex("^fc00:", RegexOption.IGNORE_CASE), Regex("^fe80:", RegexOption.IGNORE_CASE)
    )

    private fun validateBaseUrl(url: String): String {
        if (url.isBlank()) throw IOException("Invalid Jenkins URL")
        val parsed = try { URI(url) } catch (e: Exception) { throw IOException("Invalid URL format") }
        if (parsed.scheme != "https" && parsed.scheme != "http") {
            throw IOException("Only HTTP/HTTPS protocols are allowed")
        }
        val host = parsed.host ?: throw IOException("Invalid hostname")
        for (pattern in blockedPatterns) {
            if (pattern.containsMatchIn(host)) {
                throw IOException("Connection to private/internal networks is not allowed")
            }
        }
        if (host == "169.254.169.254" || host == "metadata.google.internal") {
            throw IOException("Connection to cloud metadata endpoints is not allowed")
        }
        return "${parsed.scheme}://${parsed.host}${if (parsed.port > 0) ":${parsed.port}" else ""}"
    }

    // --- Security: Parameter Validation ---
    private val PARAM_NAME_REGEX = Regex("^[a-zA-Z0-9_.\\-]+$")
    private val RESERVED_KEYS = setOf("token", "cause", "json", "submit")

    private fun validateParams(params: Map<String, String>): Map<String, String> {
        val sanitized = mutableMapOf<String, String>()
        for ((key, value) in params) {
            if (!PARAM_NAME_REGEX.matches(key)) {
                throw IOException("Invalid parameter name: \"$key\"")
            }
            if (RESERVED_KEYS.contains(key.lowercase())) {
                throw IOException("Parameter \"$key\" is reserved")
            }
            if (value.length > 1000) {
                throw IOException("Parameter \"$key\" value exceeds max length (1000)")
            }
            sanitized[key] = value
        }
        return sanitized
    }

    // --- Credential Management (OS Keychain via PasswordSafe) ---
    private fun getApiToken(): String {
        val attrs = CredentialAttributes("BuildPilot-Jenkins", username)
        return PasswordSafe.instance.getPassword(attrs) ?: ""
    }

    private fun getBuildToken(): String {
        val attrs = CredentialAttributes("BuildPilot-Jenkins-BuildToken", username)
        return PasswordSafe.instance.getPassword(attrs) ?: ""
    }

    private fun authHeader(): String {
        return okhttp3.Credentials.basic(username, getApiToken())
    }

    // --- Core Methods ---
    fun login(url: String, user: String, apiToken: String, token: String) {
        val validUrl = validateBaseUrl(url.trimEnd('/'))
        val request = Request.Builder()
            .url("$validUrl/me/api/json")
            .header("Authorization", okhttp3.Credentials.basic(user, apiToken))
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) throw IOException("Login failed: HTTP ${response.code}")
        response.close()

        baseUrl = validUrl
        username = user

        // Store secrets in OS keychain
        val apiAttrs = CredentialAttributes("BuildPilot-Jenkins", user)
        PasswordSafe.instance.set(apiAttrs, Credentials(user, apiToken))
        val buildAttrs = CredentialAttributes("BuildPilot-Jenkins-BuildToken", user)
        PasswordSafe.instance.set(buildAttrs, Credentials(user, token))
    }

    fun discoverJobs() {
        val request = Request.Builder()
            .url("$baseUrl/api/json?tree=jobs[name,url,color,_class]")
            .header("Authorization", authHeader())
            .build()

        val response = client.newCall(request).execute()
        val body = response.body?.string() ?: return
        response.close()
        val data = gson.fromJson(body, Map::class.java)

        jobs.clear()
        @Suppress("UNCHECKED_CAST")
        val jobList = data["jobs"] as? List<Map<String, Any>> ?: return
        for (job in jobList) {
            val cls = job["_class"] as? String ?: ""
            if (cls.contains("Folder")) continue
            val name = job["name"] as? String ?: continue
            val color = job["color"] as? String ?: "unknown"
            jobs[name] = JenkinsJob(name, "/job/${java.net.URLEncoder.encode(name, "UTF-8")}", color)
        }
    }

    fun getJobParams(jobName: String): List<JobParam> {
        val job = jobs[jobName] ?: return emptyList()
        val url = "$baseUrl${job.path}/api/json?tree=property[parameterDefinitions[name,type,defaultParameterValue[value],description,choices]]"
        val request = Request.Builder()
            .url(url)
            .header("Authorization", authHeader())
            .build()

        return try {
            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return emptyList()
            response.close()
            val data = gson.fromJson(body, Map::class.java)
            @Suppress("UNCHECKED_CAST")
            val properties = data["property"] as? List<Map<String, Any>> ?: return emptyList()
            for (prop in properties) {
                @Suppress("UNCHECKED_CAST")
                val paramDefs = prop["parameterDefinitions"] as? List<Map<String, Any>> ?: continue
                return paramDefs.map { p ->
                    val defaultVal = (p["defaultParameterValue"] as? Map<String, Any>)?.get("value") as? String ?: ""
                    @Suppress("UNCHECKED_CAST")
                    JobParam(
                        name = p["name"] as? String ?: "",
                        type = p["type"] as? String ?: "",
                        defaultValue = defaultVal,
                        description = p["description"] as? String ?: "",
                        choices = p["choices"] as? List<String> ?: emptyList()
                    )
                }
            }
            emptyList()
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun triggerBuild(jobName: String, params: Map<String, String> = emptyMap()) {
        val job = jobs[jobName] ?: throw IOException("Job '$jobName' not found")
        val sanitized = validateParams(params)
        val buildToken = getBuildToken()

        val urlBuilder = StringBuilder("${baseUrl}${job.path}/buildWithParameters?token=${enc(buildToken)}&cause=BuildPilot")
        for ((k, v) in sanitized) {
            urlBuilder.append("&${enc(k)}=${enc(v)}")
        }

        val request = Request.Builder()
            .url(urlBuilder.toString())
            .post(RequestBody.create(null, ByteArray(0)))
            .header("Authorization", authHeader())
            .build()

        val response = client.newCall(request).execute()
        response.close()
        if (!response.isSuccessful && response.code != 201) {
            throw IOException("Build trigger failed: HTTP ${response.code}")
        }
    }

    fun getLastBuild(jobName: String): BuildInfo? {
        val job = jobs[jobName] ?: return null
        val request = Request.Builder()
            .url("$baseUrl${job.path}/lastBuild/api/json?tree=number,building,result,timestamp,duration")
            .header("Authorization", authHeader())
            .build()

        return try {
            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return null
            response.close()
            val data = gson.fromJson(body, Map::class.java)
            BuildInfo(
                number = (data["number"] as? Double)?.toInt() ?: 0,
                building = data["building"] as? Boolean ?: false,
                result = data["result"] as? String,
                timestamp = (data["timestamp"] as? Double)?.toLong() ?: 0,
                duration = (data["duration"] as? Double)?.toLong() ?: 0
            )
        } catch (e: Exception) { null }
    }

    fun getConsoleOutput(jobName: String, buildNumber: Int): String {
        val job = jobs[jobName] ?: return ""
        val request = Request.Builder()
            .url("$baseUrl${job.path}/$buildNumber/consoleText")
            .header("Authorization", authHeader())
            .build()

        return try {
            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: ""
            response.close()
            val lines = body.lines()
            lines.takeLast(100).joinToString("\n")
        } catch (e: Exception) { "" }
    }

    fun stopBuild(jobName: String, buildNumber: Int) {
        val job = jobs[jobName] ?: throw IOException("Job '$jobName' not found")
        val request = Request.Builder()
            .url("$baseUrl${job.path}/$buildNumber/stop")
            .post(RequestBody.create(null, ByteArray(0)))
            .header("Authorization", authHeader())
            .build()

        val response = client.newCall(request).execute()
        response.close()
    }

    fun logout() {
        val apiAttrs = CredentialAttributes("BuildPilot-Jenkins", username)
        PasswordSafe.instance.set(apiAttrs, null)
        val buildAttrs = CredentialAttributes("BuildPilot-Jenkins-BuildToken", username)
        PasswordSafe.instance.set(buildAttrs, null)
        baseUrl = ""
        username = ""
        jobs.clear()
    }

    private fun enc(value: String) = java.net.URLEncoder.encode(value, "UTF-8")

    // --- Error Sanitization ---
    fun safeErrorMessage(e: Exception): String {
        return (e.message ?: "Unknown error")
            .replace(Regex("https?://[^\\s]+"), "[URL_REDACTED]")
            .replace(Regex("Basic\\s+[A-Za-z0-9+/=]+"), "[AUTH_REDACTED]")
            .take(200)
    }

    companion object {
        fun getInstance(): JenkinsService = ApplicationManager.getApplication().getService(JenkinsService::class.java)
    }
}

data class JenkinsJob(val name: String, val path: String, val color: String)
data class JobParam(val name: String, val type: String, val defaultValue: String, val description: String, val choices: List<String>)
data class BuildInfo(val number: Int, val building: Boolean, val result: String?, val timestamp: Long, val duration: Long)
