package com.buildpilot.services

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

@Service
@State(name = "BuildPilotSlack", storages = [Storage("buildpilot-slack.xml")])
class SlackService {
    var userId: String = ""

    val isConnected: Boolean get() = userId.isNotEmpty() && getBotToken().isNotEmpty()

    private fun getBotToken(): String {
        val attrs = CredentialAttributes("BuildPilot-Slack", "botToken")
        return PasswordSafe.instance.getPassword(attrs) ?: ""
    }

    fun saveBotToken(token: String, slackUserId: String) {
        if (token.isBlank() || slackUserId.isBlank()) throw IOException("Bot token and User ID required")
        if (!slackUserId.matches(Regex("^[A-Z0-9]+$"))) throw IOException("Invalid Slack User ID format")
        val attrs = CredentialAttributes("BuildPilot-Slack", "botToken")
        PasswordSafe.instance.set(attrs, Credentials("botToken", token))
        userId = slackUserId
    }

    fun notify(message: String) {
        if (!isConnected) return
        val botToken = getBotToken()

        // Open DM
        val openResp = slackPost("https://slack.com/api/conversations.open", """{"users":"$userId"}""", botToken)
        val channelId = Regex("\"id\"\\s*:\\s*\"([^\"]+)\"").find(openResp)?.groupValues?.get(1) ?: return

        // Send message
        val escaped = message.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")
        slackPost("https://slack.com/api/chat.postMessage", """{"channel":"$channelId","text":"$escaped"}""", botToken)
    }

    fun logout() {
        val attrs = CredentialAttributes("BuildPilot-Slack", "botToken")
        PasswordSafe.instance.set(attrs, null)
        userId = ""
    }

    private fun slackPost(url: String, jsonBody: String, token: String): String {
        val conn = URI(url).toURL().openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.setRequestProperty("Content-Type", "application/json")
        conn.connectTimeout = 10000
        conn.readTimeout = 10000
        conn.doOutput = true
        conn.outputStream.use { it.write(jsonBody.toByteArray()) }
        return try { conn.inputStream.bufferedReader().readText() } finally { conn.disconnect() }
    }

    companion object {
        fun getInstance(): SlackService = ApplicationManager.getApplication().getService(SlackService::class.java)
    }
}
