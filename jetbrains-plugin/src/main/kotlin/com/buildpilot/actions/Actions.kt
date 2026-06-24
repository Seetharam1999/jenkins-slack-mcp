package com.buildpilot.actions

import com.buildpilot.services.JenkinsService
import com.buildpilot.services.SlackService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ui.Messages

class LoginAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val jenkins = JenkinsService.getInstance()
        val url = Messages.showInputDialog(project, "Jenkins Base URL:", "BuildPilot Login", null) ?: return
        val user = Messages.showInputDialog(project, "Username:", "BuildPilot Login", null) ?: return
        val apiToken = Messages.showPasswordDialog("API Token:", "BuildPilot Login") ?: return
        val buildToken = Messages.showInputDialog(project, "Build Trigger Token (optional):", "BuildPilot Login", null) ?: ""

        try {
            jenkins.login(url, user, apiToken, buildToken)
            jenkins.discoverJobs()
            Messages.showInfoMessage(project, "Connected as $user! ${jenkins.jobs.size} jobs found.", "BuildPilot")
        } catch (ex: Exception) {
            Messages.showErrorDialog(project, "Login failed: ${ex.message}", "BuildPilot")
        }
    }
}

class TriggerBuildAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val jenkins = JenkinsService.getInstance()
        if (!jenkins.isLoggedIn) { Messages.showErrorDialog(project, "Login first", "BuildPilot"); return }

        val jobNames = jenkins.jobs.keys.toTypedArray()
        val selected = Messages.showEditableChooseDialog("Select job:", "BuildPilot - Trigger Build", null, jobNames, jobNames.firstOrNull() ?: "", null) ?: return

        try {
            jenkins.triggerBuild(selected)
            Messages.showInfoMessage(project, "✅ $selected triggered!", "BuildPilot")
            SlackService.getInstance().notify("🚀 *$selected* triggered by ${jenkins.username}")
        } catch (ex: Exception) {
            Messages.showErrorDialog(project, "Failed: ${ex.message}", "BuildPilot")
        }
    }
}

class RefreshJobsAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val jenkins = JenkinsService.getInstance()
        if (!jenkins.isLoggedIn) { Messages.showErrorDialog(project, "Login first", "BuildPilot"); return }
        jenkins.discoverJobs()
        Messages.showInfoMessage(project, "Refreshed! ${jenkins.jobs.size} jobs.", "BuildPilot")
    }
}

class ConnectSlackAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val botToken = Messages.showPasswordDialog("Slack Bot Token:", "BuildPilot - Slack") ?: return
        val userId = Messages.showInputDialog(project, "Your Slack User ID:", "BuildPilot - Slack", null) ?: return
        SlackService.getInstance().saveBotToken(botToken, userId)
        Messages.showInfoMessage(project, "Slack connected!", "BuildPilot")
    }
}

class LogoutAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        JenkinsService.getInstance().logout()
        SlackService.getInstance().logout()
        Messages.showInfoMessage(e.project, "Logged out.", "BuildPilot")
    }
}
