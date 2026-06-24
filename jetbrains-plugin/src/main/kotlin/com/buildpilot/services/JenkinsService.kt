package com.buildpilot.services

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import java.io.IOException

@Service
@State(name = "BuildPilotJenkins", storages = [Storage("buildpilot.xml")])
class JenkinsService {
    private val client = OkHttpClient()
    private val gson = Gson()

    var baseUrl: String = ""
    var username: String = ""
    var buildToken: String = ""
    var jobs: MutableMap<String, JenkinsJob> = mutableMapOf()

    val isLoggedIn: Boolean get() = baseUrl.isNotEmpty() && username.isNotEmpty()

    private fun getApiToken(): String {
        val attrs = CredentialAttributes("BuildPilot-Jenkins", username)
        return PasswordSafe.instance.getPassword(attrs) ?: ""
    }

    fun login(url: String, user: String, apiToken: String, token: String) {
        // Validate credentials
        val request = Request.Builder()
            .url("$url/me/api/json")
            .header("Authorization", Credentials.basic(user, apiToken))
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) throw IOException("Login failed: ${response.code}")

        baseUrl = url
        username = user
        buildToken = token

        // Store API token securely
        val attrs = CredentialAttributes("BuildPilot-Jenkins", user)
        PasswordSafe.instance.set(attrs, Credentials(user, apiToken))
    }

    fun discoverJobs() {
        val apiToken = getApiToken()
        val request = Request.Builder()
            .url("$baseUrl/api/json?tree=jobs[name,url,color,_class]")
            .header("Authorization", Credentials.basic(username, apiToken))
            .build()

        val response = client.newCall(request).execute()
        val body = response.body?.string() ?: return
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
        val apiToken = getApiToken()
        val url = "$baseUrl${job.path}/api/json?tree=property[parameterDefinitions[name,type,defaultParameterValue[value],description,choices]]"
        val request = Request.Builder()
            .url(url)
            .header("Authorization", Credentials.basic(username, apiToken))
            .build()

        return try {
            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return emptyList()
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
        val apiToken = getApiToken()

        val urlBuilder = "${baseUrl}${job.path}/buildWithParameters?token=$buildToken&cause=BuildPilot"
        val fullUrl = params.entries.fold(urlBuilder) { url, (k, v) ->
            "$url&${java.net.URLEncoder.encode(k, "UTF-8")}=${java.net.URLEncoder.encode(v, "UTF-8")}"
        }

        val request = Request.Builder()
            .url(fullUrl)
            .post(RequestBody.create(null, ByteArray(0)))
            .header("Authorization", Credentials.basic(username, apiToken))
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful && response.code != 201) {
            throw IOException("Build trigger failed: ${response.code}")
        }
    }

    fun logout() {
        val attrs = CredentialAttributes("BuildPilot-Jenkins", username)
        PasswordSafe.instance.set(attrs, null)
        baseUrl = ""
        username = ""
        buildToken = ""
        jobs.clear()
    }

    companion object {
        fun getInstance(): JenkinsService = ApplicationManager.getApplication().getService(JenkinsService::class.java)
    }
}

data class JenkinsJob(val name: String, val path: String, val color: String)
data class JobParam(val name: String, val type: String, val defaultValue: String, val description: String, val choices: List<String>)
