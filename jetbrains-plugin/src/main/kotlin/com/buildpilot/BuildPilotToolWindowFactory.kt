package com.buildpilot

import com.buildpilot.ui.BuildPilotPanel
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class BuildPilotToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = BuildPilotPanel(project)
        val content = ContentFactory.getInstance().createContent(panel.getContent(), "", false)
        toolWindow.contentManager.addContent(content)
    }
}
