package com.buildpilot.ui

import com.buildpilot.services.JenkinsService
import com.buildpilot.services.SlackService
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import java.awt.BorderLayout
import javax.swing.*

class BuildPilotPanel(private val project: Project) {
    private val jenkins = JenkinsService.getInstance()
    private val slack = SlackService.getInstance()
    private val jobListModel = DefaultListModel<String>()
    private val jobList = JBList(jobListModel)

    fun getContent(): JComponent {
        val panel = JPanel(BorderLayout())

        // Toolbar
        val toolbar = JPanel()
        val refreshBtn = JButton("↻ Refresh")
        val triggerBtn = JButton("▶ Build")
        val loginBtn = JButton("🔑 Login")

        refreshBtn.addActionListener { refreshJobs() }
        triggerBtn.addActionListener { triggerSelected() }
        loginBtn.addActionListener { login() }

        toolbar.add(loginBtn)
        toolbar.add(refreshBtn)
        toolbar.add(triggerBtn)

        // Jobs list
        jobList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        jobList.addMouseListener(object : java.awt.event.MouseAdapter() {
            override fun mouseClicked(e: java.awt.event.MouseEvent) {
                if (e.clickCount == 2) triggerSelected()
            }
        })

        panel.add(toolbar, BorderLayout.NORTH)
        panel.add(JBScrollPane(jobList), BorderLayout.CENTER)

        // Load jobs if already logged in
        if (jenkins.isLoggedIn) refreshJobs()

        return panel
    }

    private fun login() {
        val url = Messages.showInputDialog(project, "Jenkins Base URL:", "BuildPilot Login", null) ?: return
        val user = Messages.showInputDialog(project, "Username:", "BuildPilot Login", null) ?: return
        val apiToken = Messages.showPasswordDialog("API Token:", "BuildPilot Login") ?: return
        val buildToken = Messages.showInputDialog(project, "Build Trigger Token (optional):", "BuildPilot Login", null) ?: ""

        try {
            jenkins.login(url, user, apiToken, buildToken)
            jenkins.discoverJobs()
            refreshJobList()
            Messages.showInfoMessage(project, "Connected as $user! ${jenkins.jobs.size} jobs found.", "BuildPilot")
        } catch (e: Exception) {
            Messages.showErrorDialog(project, "Login failed: ${e.message}", "BuildPilot")
        }
    }

    private fun refreshJobs() {
        if (!jenkins.isLoggedIn) return
        try {
            jenkins.discoverJobs()
            refreshJobList()
        } catch (e: Exception) {
            Messages.showErrorDialog(project, "Refresh failed: ${e.message}", "BuildPilot")
        }
    }

    private fun refreshJobList() {
        jobListModel.clear()
        jenkins.jobs.values.forEach { job ->
            val icon = when (job.color) {
                "blue" -> "✅"
                "red" -> "❌"
                "disabled" -> "⏸️"
                else -> "⚪"
            }
            jobListModel.addElement("$icon ${job.name}")
        }
    }

    private fun triggerSelected() {
        val selected = jobList.selectedValue ?: run {
            Messages.showWarningDialog(project, "Select a job first", "BuildPilot")
            return
        }
        // Strip status icon prefix
        val jobName = selected.substring(2).trim()
        val params = jenkins.getJobParams(jobName)
        val buildParams = mutableMapOf<String, String>()

        for (param in params) {
            val value = if (param.choices.isNotEmpty()) {
                Messages.showEditableChooseDialog(
                    "${param.name}${if (param.description.isNotEmpty()) " - ${param.description}" else ""}",
                    "Build Parameter", null, param.choices.toTypedArray(), param.defaultValue, null
                )
            } else {
                Messages.showInputDialog(
                    project,
                    "${param.name}${if (param.description.isNotEmpty()) " - ${param.description}" else ""}:",
                    "Build Parameter", null, param.defaultValue, null
                )
            }
            if (value != null) buildParams[param.name] = value
        }

        try {
            jenkins.triggerBuild(jobName, buildParams)
            val paramStr = buildParams.entries.joinToString(", ") { "${it.key}=${it.value}" }.ifEmpty { "defaults" }
            Messages.showInfoMessage(project, "✅ $jobName triggered ($paramStr)", "BuildPilot")

            if (slack.isConnected) {
                slack.notify("🚀 *$jobName* triggered ($paramStr)")
            }
        } catch (e: Exception) {
            Messages.showErrorDialog(project, "Build failed: ${e.message}", "BuildPilot")
        }
    }
}
