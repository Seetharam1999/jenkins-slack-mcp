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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

@Service
@State(name = "BuildPilotSlack", storages = [Storage("buildpilot-slack.xml")])
class SlackService {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()
    private val gson = Gson()
    private val JSON = "application/json".toMediaType()

    var userId: String = ""

    val isConnected: Boolean get() = userId.isNotEmpty() && getBotToken().isNotEmpty()

    private fun getBotToken(): String {
        val attrs = CredentialAttributes("BuildPilot-Slack", "botToken")
        return PasswordSafe.instance.getPassword(attrs) ?: ""
    }

    fun saveBotToken(token: String, slackUserId: String) {
        if (token.isBlank() || slackUserId.isBlank()) {
            throw IOException("Bot token and User ID are required")
        }
        // Validate user ID format
        if (!slackUserId.matches(Regex("^[A-Z0-9]+$"))) {
            throw IOException("Invalid Slack User ID format")
        }
        val attrs = CredentialAttributes("BuildPilot-Slack", "botToken")
        PasswordSafe.instance.set(attrs, Credentials("botToken", token))
        userId = slackUserId
    }

    fun notify(message: String) {
        if (!isConnected) return
        val botToken = getBotToken()

        // Open DM channel
        val openBody = gson.toJson(mapOf("users" to userId)).toRequestBody(JSON)
        val openReq = Request.Builder()
            .url("https://slack.com/api/conversations.open")
            .header("Authorization", "Bearer $botToken")
            .post(openBody).build()

        val openResp = client.newCall(openReq).execute()
        val openRespBody = openResp.body?.string() ?: throw IOException("Empty response")
        openResp.close()
        val openData = gson.fromJson(openRespBody, Map::class.java)
        if (openData["ok"] != true) throw IOException("Slack DM open failed")

        @Suppress("UNCHECKED_CAST")
        val channelId = (openData["channel"] as? Map<String, Any>)?.get("id") as? String
            ?: throw IOException("No channel ID returned")

        // Validate channel ID format
        if (!channelId.matches(Regex("^[A-Z0-9]+$"))) {
            throw IOException("Invalid channel ID")
        }

        // Send message
        val msgBody = gson.toJson(mapOf("channel" to channelId, "text" to message)).toRequestBody(JSON)
        val msgReq = Request.Builder()
            .url("https://slack.com/api/chat.postMessage")
            .header("Authorization", "Bearer $botToken")
            .post(msgBody).build()

        val msgResp = client.newCall(msgReq).execute()
        msgResp.close()
    }

    fun logout() {
        val attrs = CredentialAttributes("BuildPilot-Slack", "botToken")
        PasswordSafe.instance.set(attrs, null)
        userId = ""
    }

    companion object {
        fun getInstance(): SlackService = ApplicationManager.getApplication().getService(SlackService::class.java)
    }
}
