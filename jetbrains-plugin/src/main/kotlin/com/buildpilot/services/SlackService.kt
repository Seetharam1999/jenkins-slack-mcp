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

@Service
@State(name = "BuildPilotSlack", storages = [Storage("buildpilot-slack.xml")])
class SlackService {
    private val client = OkHttpClient()
    private val gson = Gson()
    private val JSON = "application/json".toMediaType()

    var userId: String = ""

    val isConnected: Boolean get() = userId.isNotEmpty() && getBotToken().isNotEmpty()

    private fun getBotToken(): String {
        val attrs = CredentialAttributes("BuildPilot-Slack", "botToken")
        return PasswordSafe.instance.getPassword(attrs) ?: ""
    }

    fun saveBotToken(token: String, slackUserId: String) {
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
        val openData = gson.fromJson(openResp.body?.string(), Map::class.java)
        if (openData["ok"] != true) return

        @Suppress("UNCHECKED_CAST")
        val channelId = (openData["channel"] as? Map<String, Any>)?.get("id") as? String ?: return

        // Send message
        val msgBody = gson.toJson(mapOf("channel" to channelId, "text" to message)).toRequestBody(JSON)
        val msgReq = Request.Builder()
            .url("https://slack.com/api/chat.postMessage")
            .header("Authorization", "Bearer $botToken")
            .post(msgBody).build()

        client.newCall(msgReq).execute()
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
