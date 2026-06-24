package com.buildpilot.settings

import com.buildpilot.services.JenkinsService
import com.intellij.openapi.options.Configurable
import javax.swing.*
import java.awt.GridLayout

class BuildPilotConfigurable : Configurable {
    private var panel: JPanel? = null
    private var urlField: JTextField? = null

    override fun getDisplayName() = "BuildPilot"

    override fun createComponent(): JComponent {
        panel = JPanel(GridLayout(2, 2, 10, 10))
        panel!!.add(JLabel("Jenkins URL:"))
        urlField = JTextField(JenkinsService.getInstance().baseUrl)
        panel!!.add(urlField)
        return panel!!
    }

    override fun isModified(): Boolean {
        return urlField?.text != JenkinsService.getInstance().baseUrl
    }

    override fun apply() {
        // URL is set during login, this is read-only display
    }

    override fun reset() {
        urlField?.text = JenkinsService.getInstance().baseUrl
    }
}
