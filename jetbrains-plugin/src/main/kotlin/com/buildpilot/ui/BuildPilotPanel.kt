package com.buildpilot.ui

import com.buildpilot.services.JenkinsService
import com.buildpilot.services.SlackService
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

    private val jobListModel = DefaultListModel<String>()
    private val jobList = JBList(jobListModel)
    private val searchField = JTextField()
    private val pinnedJobs = mutableSetOf<String>()
    private val pinnedGroups = mutableSetOf<String>()

    private val historyListModel = DefaultListModel<String>()
    private val historyList = JBList(historyListModel)
    private val historyEntries = mutableListOf<HistoryEntry>()
    private val entryPollers = mutableMapOf<String, Timer>()

    private val summaryArea = JTextArea()
    private var summaryPoller: Timer? = null
    private var summaryScrollPane: JBScrollPane? = null

    fun getContent(): JComponent {
        val tabbedPane = JBTabbedPane()
        tabbedPane.addTab("Jobs", createJobsPanel())
        tabbedPane.addTab("History", createHistoryPanel())
        tabbedPane.addTab("Build Summary", createSummaryPanel())
        if (jenkins.isLoggedIn) refreshJobs()
        return tabbedPane
    }

    private fun createJobsPanel(): JComponent {
        val panel = JPanel(BorderLayout(0, 4))
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

        val topPanel = JPanel(BorderLayout())
        topPanel.add(searchPanel, BorderLayout.NORTH)
        topPanel.add(toolbar, BorderLayout.SOUTH)

        jobList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        jobList.addMouseListener(object : java.awt.event.MouseAdapter() {
            override fun mouseClicked(e: java.awt.event.MouseEvent) { if (e.clickCount == 2) triggerSelected() }
        })
        panel.add(topPanel, BorderLayout.NORTH)
        panel.add(JBScrollPane(jobList), BorderLayout.CENTER)
        return panel
    }

    private fun createHistoryPanel(): JComponent {
        val panel = JPanel(BorderLayout(0, 4))
        val toolbar = JPanel(FlowLayout(FlowLayout.LEFT, 4, 2))
        val stopBtn = JButton("⏹ Stop")
        val viewBtn = JButton("📊 View")
        val clearBtn = JButton("🗑 Clear")
        stopBtn.addActionListener { stopSelectedBuild() }
        viewBtn.addActionListener { viewSelectedBuild() }
        clearBtn.addActionListener { clearHistory() }
        toolbar.add(stopBtn); toolbar.add(viewBtn); toolbar.add(clearBtn)

        historyList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        historyList.addMouseListener(object : java.awt.event.MouseAdapter() {
            override fun mouseClicked(e: java.awt.event.MouseEvent) { if (e.clickCount == 2) viewSelectedBuild() }
        })
        panel.add(toolbar, BorderLayout.NORTH)
        panel.add(JBScrollPane(historyList), BorderLayout.CENTER)
        return panel
    }

    private fun createSummaryPanel(): JComponent {
        val panel = JPanel(BorderLayout())
        summaryArea.isEditable = false
        summaryArea.font = Font("Monospaced", Font.PLAIN, 12)
        summaryArea.text = "Trigger a build or click View to see status here..."
        summaryScrollPane = JBScrollPane(summaryArea)
        panel.add(summaryScrollPane!!, BorderLayout.CENTER)
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
        try { jenkins.discoverJobs(); refreshJobList() }
        catch (e: Exception) { Messages.showErrorDialog(project, "Refresh failed: ${jenkins.safeErrorMessage(e)}", "BuildPilot") }
    }

    private fun refreshJobList() {
        jobListModel.clear()
        val filter = searchField.text.lowercase()
        val allJobs = jenkins.jobs.values.filter { filter.isEmpty() || it.name.lowercase().contains(filter) }
        val groups = allJobs.groupBy { it.name.split("-").firstOrNull()?.uppercase() ?: "OTHER" }
        val sortedGroups = groups.entries.sortedWith(compareByDescending<Map.Entry<String, List<com.buildpilot.services.JenkinsJob>>> { pinnedGroups.contains(it.key) }.thenBy { it.key })
        for ((group, jobs) in sortedGroups) {
            val pinIcon = if (pinnedGroups.contains(group)) "📌 " else ""
            jobListModel.addElement("── ${pinIcon}${group} (${jobs.size}) ──")
            val sorted = jobs.sortedWith(compareByDescending<com.buildpilot.services.JenkinsJob> { pinnedJobs.contains(it.name) }.thenBy { it.name })
            for (job in sorted) {
                val icon = when (job.color) { "blue" -> "✅"; "red" -> "❌"; "disabled" -> "⏸️"; else -> "⚪" }
                val pin = if (pinnedJobs.contains(job.name)) " 📌" else ""
                jobListModel.addElement("  $icon ${job.name}$pin")
            }
        }
    }

    private fun getSelectedJobName(): String? {
        val selected = jobList.selectedValue ?: return null
        if (selected.startsWith("──")) return null
        return selected.replace(Regex("^\\s+[✅❌⏸️⚪]\\s+"), "").replace(" 📌", "").trim()
    }

    private fun pinSelected() {
        val selected = jobList.selectedValue ?: return
        if (selected.startsWith("──")) { pinnedGroups.add(selected.replace(Regex("[─📌() \\d]"), "").trim()) }
        else { getSelectedJobName()?.let { pinnedJobs.add(it) } }
        refreshJobList()
    }

    private fun unpinSelected() {
        val selected = jobList.selectedValue ?: return
        if (selected.startsWith("──")) { pinnedGroups.remove(selected.replace(Regex("[─📌() \\d]"), "").trim()) }
        else { getSelectedJobName()?.let { pinnedJobs.remove(it) } }
        refreshJobList()
    }

    private fun triggerSelected() {
        if (!jenkins.isLoggedIn) { Messages.showErrorDialog(project, "Login first", "BuildPilot"); return }
        val jobName = getSelectedJobName() ?: run { Messages.showWarningDialog(project, "Select a job first", "BuildPilot"); return }

        val params = jenkins.getJobParams(jobName)
        val buildParams = mutableMapOf<String, String>()
        for (param in params) {
            val value = if (param.choices.isNotEmpty()) {
                Messages.showEditableChooseDialog("${param.name}${if (param.description.isNotEmpty()) " - ${param.description}" else ""}", "Build Parameter", null, param.choices.toTypedArray(), param.defaultValue, null)
            } else {
                Messages.showInputDialog(project, "${param.name}${if (param.description.isNotEmpty()) " - ${param.description}" else ""}:", "Build Parameter", null, param.defaultValue, null)
            }
            if (value != null) buildParams[param.name] = value
        }

        try {
            // Capture prev build number BEFORE trigger
            val prevBuild = jenkins.getLastBuild(jobName)
            val prevBuildNumber = prevBuild?.number ?: 0

            jenkins.triggerBuild(jobName, buildParams)
            val paramStr = buildParams.entries.joinToString(", ") { "${it.key}=${it.value}" }.ifEmpty { "defaults" }

            val entry = HistoryEntry(id = "${jobName}-${System.currentTimeMillis()}", jobName = jobName, params = paramStr, time = System.currentTimeMillis(), running = true, buildNumber = null, prevBuildNumber = prevBuildNumber)
            historyEntries.add(0, entry)
            if (historyEntries.size > 50) historyEntries.removeAt(historyEntries.lastIndex)
            refreshHistoryList()

            Messages.showInfoMessage(project, "✅ $jobName triggered ($paramStr)", "BuildPilot")
            if (slack.isConnected) { slack.notify("🚀 *$jobName* triggered ($paramStr)") }

            // Resolve build number in background
            resolveAndPollEntry(entry)
        } catch (e: Exception) {
            Messages.showErrorDialog(project, "Build failed: ${jenkins.safeErrorMessage(e)}", "BuildPilot")
        }
    }

    private fun resolveAndPollEntry(entry: HistoryEntry) {
        val timer = Timer()
        entryPollers[entry.id] = timer
        timer.scheduleAtFixedRate(object : TimerTask() {
            var attempts = 0
            override fun run() {
                attempts++
                if (!jenkins.isLoggedIn || attempts > 20) { timer.cancel(); entryPollers.remove(entry.id); return }
                try {
                    val build = jenkins.getLastBuild(entry.jobName) ?: return
                    val assignedNumbers = historyEntries.filter { it.jobName == entry.jobName && it.buildNumber != null }.map { it.buildNumber!! }.toSet()
                    if (build.number > entry.prevBuildNumber && !assignedNumbers.contains(build.number)) {
                        entry.buildNumber = build.number
                        SwingUtilities.invokeLater { refreshHistoryList() }
                        // Switch to per-build polling
                        timer.cancel()
                        entryPollers.remove(entry.id)
                        pollEntryStatus(entry)
                    }
                } catch (_: Exception) {}
            }
        }, 2000, 2000)
    }

    private fun pollEntryStatus(entry: HistoryEntry) {
        val timer = Timer()
        entryPollers[entry.id] = timer
        timer.scheduleAtFixedRate(object : TimerTask() {
            override fun run() {
                if (!jenkins.isLoggedIn || entry.buildNumber == null) { timer.cancel(); entryPollers.remove(entry.id); return }
                try {
                    val build = jenkins.getBuildInfo(entry.jobName, entry.buildNumber!!) ?: return
                    if (!build.building) {
                        entry.running = false
                        SwingUtilities.invokeLater { refreshHistoryList() }
                        timer.cancel()
                        entryPollers.remove(entry.id)
                    }
                } catch (_: Exception) { timer.cancel(); entryPollers.remove(entry.id) }
            }
        }, 8000, 8000)
    }

    private fun stopSelectedBuild() {
        if (!jenkins.isLoggedIn) return
        val idx = historyList.selectedIndex
        if (idx < 0 || idx >= historyEntries.size) return
        val entry = historyEntries[idx]
        if (!entry.running) { Messages.showWarningDialog(project, "${entry.jobName} is not running.", "BuildPilot"); return }
        if (entry.buildNumber == null) { Messages.showWarningDialog(project, "Build number not resolved yet. Try again in a few seconds.", "BuildPilot"); return }

        try {
            val build = jenkins.getBuildInfo(entry.jobName, entry.buildNumber!!)
            if (build == null || !build.building) {
                entry.running = false; refreshHistoryList()
                Messages.showWarningDialog(project, "${entry.jobName} #${entry.buildNumber} is not running.", "BuildPilot"); return
            }
            jenkins.stopBuild(entry.jobName, entry.buildNumber!!)
            entry.running = false; refreshHistoryList()
            Messages.showInfoMessage(project, "⛔ ${entry.jobName} #${entry.buildNumber} stopped.", "BuildPilot")
        } catch (e: Exception) {
            Messages.showErrorDialog(project, "Stop failed: ${jenkins.safeErrorMessage(e)}", "BuildPilot")
        }
    }

    private fun viewSelectedBuild() {
        val idx = historyList.selectedIndex
        if (idx < 0 || idx >= historyEntries.size) return
        val entry = historyEntries[idx]
        if (entry.buildNumber == null) { Messages.showWarningDialog(project, "Build number not resolved yet.", "BuildPilot"); return }
        showBuildSummary(entry.jobName, entry.buildNumber!!)
    }

    private fun showBuildSummary(jobName: String, buildNumber: Int) {
        summaryPoller?.cancel()
        summaryArea.text = "Loading $jobName #$buildNumber..."

        summaryPoller = Timer()
        summaryPoller?.scheduleAtFixedRate(object : TimerTask() {
            override fun run() {
                try {
                    val build = jenkins.getBuildInfo(jobName, buildNumber) ?: return
                    val console = jenkins.getConsoleOutput(jobName, buildNumber)
                    val status = if (build.building) "🔄 RUNNING" else "✅ ${build.result ?: "UNKNOWN"}"
                    val duration = if (build.duration > 0) "${build.duration / 1000}s" else "—"
                    val started = SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(Date(build.timestamp))

                    val text = buildString {
                        appendLine("═══════════════════════════════════════")
                        appendLine("  $jobName #${build.number}")
                        appendLine("═══════════════════════════════════════")
                        appendLine("  Status:       $status")
                        appendLine("  Started:      $started")
                        appendLine("  Duration:     $duration")
                        appendLine("  Display Name: ${build.displayName.ifEmpty { "—" }}")
                        appendLine("  Description:  ${build.description.ifEmpty { "—" }}")
                        appendLine("═══════════════════════════════════════")
                        appendLine()
                        appendLine("Console Output (last 100 lines):")
                        appendLine("───────────────────────────────────────")
                        appendLine(console.ifEmpty { "Waiting for output..." })
                        if (build.building) { appendLine(); appendLine("  [Auto-refreshing every 5s...]") }
                    }

                    SwingUtilities.invokeLater {
                        val scrollBar = summaryScrollPane?.verticalScrollBar
                        val atBottom = scrollBar != null && (scrollBar.value + scrollBar.visibleAmount >= scrollBar.maximum - 50)
                        summaryArea.text = text
                        if (atBottom) { summaryArea.caretPosition = summaryArea.document.length }
                    }

                    if (!build.building) { summaryPoller?.cancel() }
                } catch (_: Exception) {}
            }
        }, 1000, 5000)
    }

    private fun clearHistory() {
        for ((_, timer) in entryPollers) timer.cancel()
        entryPollers.clear()
        historyEntries.clear()
        refreshHistoryList()
    }

    private fun refreshHistoryList() {
        historyListModel.clear()
        val sdf = SimpleDateFormat("HH:mm:ss")
        for (entry in historyEntries) {
            val icon = if (entry.running) "🔄" else "✅"
            val buildLabel = if (entry.buildNumber != null) " #${entry.buildNumber}" else " (queued)"
            val runLabel = if (entry.running) " [RUNNING]" else ""
            historyListModel.addElement("$icon ${entry.jobName}$buildLabel (${entry.params}) — ${sdf.format(Date(entry.time))}$runLabel")
        }
    }

    private fun openSettings() {
        com.intellij.openapi.options.ShowSettingsUtil.getInstance().showSettingsDialog(project, "BuildPilot")
    }

    data class HistoryEntry(val id: String, val jobName: String, val params: String, val time: Long, var running: Boolean, var buildNumber: Int?, val prevBuildNumber: Int)
}
