package com.buildpilot.ui

import com.buildpilot.services.BuildInfo
import com.buildpilot.services.JenkinsService
import com.buildpilot.services.SlackService
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTabbedPane
import java.awt.*
import java.text.SimpleDateFormat
import java.util.*
import javax.swing.*
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener

class BuildPilotPanel(private val project: Project) {
    private val jenkins = JenkinsService.getInstance()
    private val slack = SlackService.getInstance()

    // Jobs tab
    private val jobListModel = DefaultListModel<String>()
    private val jobList = JBList(jobListModel)
    private val searchField = JTextField()
    private val pinnedJobs = mutableSetOf<String>()
    private val pinnedGroups = mutableSetOf<String>()

    // History tab
    private val historyListModel = DefaultListModel<String>()
    private val historyList = JBList(historyListModel)
    private val historyEntries = mutableListOf<HistoryEntry>()

    // Build summary
    private val summaryArea = JTextArea()
    private var pollingTimer: Timer? = null

    fun getContent(): JComponent {
        val tabbedPane = JBTabbedPane()
        tabbedPane.addTab("Jobs", createJobsPanel())
        tabbedPane.addTab("History", createHistoryPanel())
        tabbedPane.addTab("Build Summary", createSummaryPanel())

        if (jenkins.isLoggedIn) refreshJobs()
        return tabbedPane
    }

    // --- Jobs Tab ---
    private fun createJobsPanel(): JComponent {
        val panel = JPanel(BorderLayout(0, 4))

        // Search box
        val searchPanel = JPanel(BorderLayout(4, 0))
        searchPanel.border = BorderFactory.createEmptyBorder(4, 4, 4, 4)
        searchField.putClientProperty("JTextField.placeholderText", "Filter jobs...")
        searchField.document.addDocumentListener(object : DocumentListener {
            override fun insertUpdate(e: DocumentEvent) = refreshJobList()
            override fun removeUpdate(e: DocumentEvent) = refreshJobList()
            override fun changedUpdate(e: DocumentEvent) = refreshJobList()
        })
        val clearBtn = JButton("✕")
        clearBtn.preferredSize = Dimension(40, 28)
        clearBtn.addActionListener { searchField.text = ""; refreshJobList() }
        searchPanel.add(searchField, BorderLayout.CENTER)
        searchPanel.add(clearBtn, BorderLayout.EAST)

        // Toolbar
        val toolbar = JPanel(FlowLayout(FlowLayout.LEFT, 4, 2))
        val loginBtn = JButton("🔑 Login")
        val refreshBtn = JButton("↻")
        val triggerBtn = JButton("▶ Build")
        val pinBtn = JButton("📌 Pin")
        val unpinBtn = JButton("Unpin")
        val settingsBtn = JButton("⚙")

        loginBtn.addActionListener { login() }
        refreshBtn.addActionListener { refreshJobs() }
        triggerBtn.addActionListener { triggerSelected() }
        pinBtn.addActionListener { pinSelected() }
        unpinBtn.addActionListener { unpinSelected() }
        settingsBtn.addActionListener { openSettings() }

        toolbar.add(loginBtn); toolbar.add(refreshBtn); toolbar.add(triggerBtn)
        toolbar.add(pinBtn); toolbar.add(unpinBtn); toolbar.add(settingsBtn)

        // Top section
        val topPanel = JPanel(BorderLayout())
        topPanel.add(searchPanel, BorderLayout.NORTH)
        topPanel.add(toolbar, BorderLayout.SOUTH)

        // Job list
        jobList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        jobList.addMouseListener(object : java.awt.event.MouseAdapter() {
            override fun mouseClicked(e: java.awt.event.MouseEvent) {
                if (e.clickCount == 2) triggerSelected()
            }
        })

        panel.add(topPanel, BorderLayout.NORTH)
        panel.add(JBScrollPane(jobList), BorderLayout.CENTER)
        return panel
    }

    // --- History Tab ---
    private fun createHistoryPanel(): JComponent {
        val panel = JPanel(BorderLayout(0, 4))
        val toolbar = JPanel(FlowLayout(FlowLayout.LEFT, 4, 2))
        val stopBtn = JButton("⏹ Stop")
        val clearBtn = JButton("Clear")
        val viewBtn = JButton("📊 View")

        stopBtn.addActionListener { stopSelectedBuild() }
        clearBtn.addActionListener { historyEntries.clear(); refreshHistoryList() }
        viewBtn.addActionListener { viewSelectedBuild() }

        toolbar.add(stopBtn); toolbar.add(viewBtn); toolbar.add(clearBtn)

        historyList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        historyList.addMouseListener(object : java.awt.event.MouseAdapter() {
            override fun mouseClicked(e: java.awt.event.MouseEvent) {
                if (e.clickCount == 2) viewSelectedBuild()
            }
        })

        panel.add(toolbar, BorderLayout.NORTH)
        panel.add(JBScrollPane(historyList), BorderLayout.CENTER)
        return panel
    }

    // --- Build Summary Tab ---
    private fun createSummaryPanel(): JComponent {
        val panel = JPanel(BorderLayout())
        summaryArea.isEditable = false
        summaryArea.font = Font("Monospaced", Font.PLAIN, 12)
        summaryArea.text = "Trigger a build to see live status here..."
        panel.add(JBScrollPane(summaryArea), BorderLayout.CENTER)
        return panel
    }

    // --- Actions ---
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
            Messages.showErrorDialog(project, "Login failed: ${jenkins.safeErrorMessage(e)}", "BuildPilot")
        }
    }

    private fun refreshJobs() {
        if (!jenkins.isLoggedIn) return
        try {
            jenkins.discoverJobs()
            refreshJobList()
        } catch (e: Exception) {
            Messages.showErrorDialog(project, "Refresh failed: ${jenkins.safeErrorMessage(e)}", "BuildPilot")
        }
    }

    private fun refreshJobList() {
        jobListModel.clear()
        val filter = searchField.text.lowercase()
        val allJobs = jenkins.jobs.values
            .filter { filter.isEmpty() || it.name.lowercase().contains(filter) }

        // Group by prefix
        val groups = allJobs.groupBy { it.name.split("-").firstOrNull()?.uppercase() ?: "OTHER" }

        // Pinned groups first
        val sortedGroups = groups.entries.sortedWith(compareByDescending<Map.Entry<String, List<com.buildpilot.services.JenkinsJob>>> {
            pinnedGroups.contains(it.key)
        }.thenBy { it.key })

        for ((group, jobs) in sortedGroups) {
            val pinIcon = if (pinnedGroups.contains(group)) "📌 " else ""
            jobListModel.addElement("── ${pinIcon}${group} (${jobs.size}) ──")

            // Pinned jobs first within group
            val sorted = jobs.sortedWith(compareByDescending<com.buildpilot.services.JenkinsJob> {
                pinnedJobs.contains(it.name)
            }.thenBy { it.name })

            for (job in sorted) {
                val statusIcon = when (job.color) {
                    "blue" -> "✅"; "red" -> "❌"; "disabled" -> "⏸️"; else -> "⚪"
                }
                val pinMark = if (pinnedJobs.contains(job.name)) " 📌" else ""
                jobListModel.addElement("  $statusIcon ${job.name}$pinMark")
            }
        }
    }

    private fun getSelectedJobName(): String? {
        val selected = jobList.selectedValue ?: return null
        if (selected.startsWith("──")) return null // group header
        return selected.replace(Regex("^\\s+[✅❌⏸️⚪]\\s+"), "").replace(" 📌", "").trim()
    }

    private fun pinSelected() {
        val selected = jobList.selectedValue ?: return
        if (selected.startsWith("──")) {
            // Pin group
            val group = selected.replace(Regex("[─📌() \\d]"), "").trim()
            pinnedGroups.add(group)
        } else {
            val jobName = getSelectedJobName() ?: return
            pinnedJobs.add(jobName)
        }
        refreshJobList()
    }

    private fun unpinSelected() {
        val selected = jobList.selectedValue ?: return
        if (selected.startsWith("──")) {
            val group = selected.replace(Regex("[─📌() \\d]"), "").trim()
            pinnedGroups.remove(group)
        } else {
            val jobName = getSelectedJobName() ?: return
            pinnedJobs.remove(jobName)
        }
        refreshJobList()
    }

    private fun triggerSelected() {
        if (!jenkins.isLoggedIn) { Messages.showErrorDialog(project, "Login first", "BuildPilot"); return }
        val jobName = getSelectedJobName() ?: run {
            Messages.showWarningDialog(project, "Select a job first", "BuildPilot"); return
        }

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

            // Add to history as running
            historyEntries.add(0, HistoryEntry(jobName, paramStr, System.currentTimeMillis(), true))
            if (historyEntries.size > 50) historyEntries.removeAt(historyEntries.lastIndex)
            refreshHistoryList()

            Messages.showInfoMessage(project, "✅ $jobName triggered ($paramStr)", "BuildPilot")

            if (slack.isConnected) {
                slack.notify("🚀 *$jobName* triggered ($paramStr)")
            }

            // Start polling build status
            startPolling(jobName)
        } catch (e: Exception) {
            Messages.showErrorDialog(project, "Build failed: ${jenkins.safeErrorMessage(e)}", "BuildPilot")
        }
    }

    private fun stopSelectedBuild() {
        if (!jenkins.isLoggedIn) return
        val idx = historyList.selectedIndex
        if (idx < 0 || idx >= historyEntries.size) return
        val entry = historyEntries[idx]
        if (!entry.running) {
            Messages.showWarningDialog(project, "${entry.jobName} is not running.", "BuildPilot")
            return
        }

        try {
            val build = jenkins.getLastBuild(entry.jobName)
            if (build == null || !build.building) {
                entry.running = false
                refreshHistoryList()
                Messages.showWarningDialog(project, "${entry.jobName} is not running.", "BuildPilot")
                return
            }
            jenkins.stopBuild(entry.jobName, build.number)
            entry.running = false
            refreshHistoryList()
            Messages.showInfoMessage(project, "⛔ ${entry.jobName} #${build.number} stopped.", "BuildPilot")
        } catch (e: Exception) {
            Messages.showErrorDialog(project, "Stop failed: ${jenkins.safeErrorMessage(e)}", "BuildPilot")
        }
    }

    private fun viewSelectedBuild() {
        val idx = historyList.selectedIndex
        if (idx < 0 || idx >= historyEntries.size) return
        val entry = historyEntries[idx]
        startPolling(entry.jobName)
    }

    private fun startPolling(jobName: String) {
        pollingTimer?.cancel()
        summaryArea.text = "Loading build status for $jobName..."

        pollingTimer = Timer()
        pollingTimer?.scheduleAtFixedRate(object : TimerTask() {
            override fun run() {
                try {
                    val build = jenkins.getLastBuild(jobName) ?: return
                    val console = jenkins.getConsoleOutput(jobName, build.number)
                    val status = if (build.building) "🔄 RUNNING" else "✅ ${build.result ?: "UNKNOWN"}"
                    val duration = if (build.duration > 0) "${build.duration / 1000}s" else "—"
                    val started = SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(Date(build.timestamp))

                    val text = buildString {
                        appendLine("═══════════════════════════════════════")
                        appendLine("  $jobName #${build.number}")
                        appendLine("═══════════════════════════════════════")
                        appendLine("  Status:   $status")
                        appendLine("  Started:  $started")
                        appendLine("  Duration: $duration")
                        appendLine("═══════════════════════════════════════")
                        appendLine()
                        appendLine("Console Output (last 100 lines):")
                        appendLine("───────────────────────────────────────")
                        appendLine(console.ifEmpty { "Waiting for output..." })
                        if (build.building) {
                            appendLine()
                            appendLine("  [Auto-refreshing every 5s...]")
                        }
                    }

                    SwingUtilities.invokeLater { summaryArea.text = text }

                    if (!build.building) {
                        // Update history entry
                        historyEntries.find { it.jobName == jobName && it.running }?.running = false
                        SwingUtilities.invokeLater { refreshHistoryList() }
                        pollingTimer?.cancel()
                    }
                } catch (_: Exception) {}
            }
        }, 2000, 5000)
    }

    private fun refreshHistoryList() {
        historyListModel.clear()
        val sdf = SimpleDateFormat("HH:mm:ss")
        for (entry in historyEntries) {
            val icon = if (entry.running) "🔄" else "🚀"
            val stopLabel = if (entry.running) " [RUNNING]" else ""
            historyListModel.addElement("$icon ${entry.jobName} (${entry.params}) — ${sdf.format(Date(entry.time))}$stopLabel")
        }
    }

    private fun openSettings() {
        com.intellij.openapi.options.ShowSettingsUtil.getInstance().showSettingsDialog(project, "BuildPilot")
    }

    data class HistoryEntry(val jobName: String, val params: String, val time: Long, var running: Boolean)
}
