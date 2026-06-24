const vscode = require('vscode');
const axios = require('axios');

class BuildSummaryPanel {
  static currentPanel;

  static show(context, jenkinsService, jobName, branch) {
    const column = vscode.ViewColumn.Beside;

    if (BuildSummaryPanel.currentPanel) {
      BuildSummaryPanel.currentPanel._panel.reveal(column);
      BuildSummaryPanel.currentPanel._startPolling(jenkinsService, jobName, branch);
      return;
    }

    const panel = vscode.window.createWebviewPanel('buildpilot.summary', `🚀 ${jobName}`, column, { enableScripts: true });
    BuildSummaryPanel.currentPanel = new BuildSummaryPanel(panel, context);
    BuildSummaryPanel.currentPanel._startPolling(jenkinsService, jobName, branch);
  }

  constructor(panel, context) {
    this._panel = panel;
    this._context = context;
    this._polling = null;

    this._panel.onDidDispose(() => {
      this._stopPolling();
      BuildSummaryPanel.currentPanel = null;
    });
  }

  _stopPolling() {
    if (this._polling) { clearInterval(this._polling); this._polling = null; }
  }

  async _startPolling(jenkinsService, jobName, branch) {
    this._stopPolling();
    const creds = jenkinsService.getCreds();
    const job = jenkinsService.getJobs()[jobName];
    if (!creds || !job) return;

    this._panel.title = `🚀 ${jobName}`;
    this._updateHtml(jobName, branch, 'PENDING', null);

    // Wait a moment for Jenkins to register the build
    await new Promise(r => setTimeout(r, 3000));

    this._polling = setInterval(async () => {
      try {
        const resp = await axios.get(`${creds.baseUrl}${job.path}/lastBuild/api/json?tree=number,building,result,timestamp,duration,displayName,fullDisplayName`, {
          auth: { username: creds.user, password: creds.apiToken }
        });
        const build = resp.data;

        let consoleText = '';
        try {
          const consoleResp = await axios.get(`${creds.baseUrl}${job.path}/${build.number}/consoleText`, {
            auth: { username: creds.user, password: creds.apiToken }
          });
          // Last 100 lines
          const lines = consoleResp.data.split('\n');
          consoleText = lines.slice(-100).join('\n');
        } catch {}

        const status = build.building ? 'RUNNING' : (build.result || 'UNKNOWN');
        this._updateHtml(jobName, branch, status, build, consoleText);

        if (!build.building) this._stopPolling();
      } catch {}
    }, 5000);
  }

  _updateHtml(jobName, branch, status, build, consoleText = '') {
    const statusColors = {
      'SUCCESS': '#4caf50',
      'FAILURE': '#f44336',
      'RUNNING': '#2196f3',
      'ABORTED': '#ff9800',
      'PENDING': '#9e9e9e',
      'UNKNOWN': '#9e9e9e'
    };
    const statusIcons = {
      'SUCCESS': '✅',
      'FAILURE': '❌',
      'RUNNING': '🔄',
      'ABORTED': '⛔',
      'PENDING': '⏳',
      'UNKNOWN': '❓'
    };

    const color = statusColors[status] || '#9e9e9e';
    const icon = statusIcons[status] || '❓';
    const duration = build?.duration ? `${(build.duration / 1000).toFixed(1)}s` : '—';
    const buildNum = build?.number ? `#${build.number}` : '';
    const startTime = build?.timestamp ? new Date(build.timestamp).toLocaleString() : '—';

    this._panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .status-badge { background: ${color}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .job-title { font-size: 20px; font-weight: 600; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .meta-card { background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 12px; }
  .meta-label { font-size: 11px; opacity: 0.7; text-transform: uppercase; margin-bottom: 4px; }
  .meta-value { font-size: 14px; font-weight: 500; }
  .console-header { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  .console { background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 8px; font-family: 'Fira Code', 'Courier New', monospace; font-size: 12px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; max-height: 400px; overflow-y: auto; }
  .progress-bar { height: 4px; background: var(--vscode-panel-border); border-radius: 2px; margin-bottom: 20px; overflow: hidden; }
  .progress-fill { height: 100%; background: ${color}; ${status === 'RUNNING' ? 'animation: progress 2s infinite;' : 'width: 100%;'} }
  @keyframes progress { 0% { width: 0%; } 50% { width: 70%; } 100% { width: 100%; } }
</style>
</head>
<body>
  <div class="header">
    <span style="font-size:24px">${icon}</span>
    <span class="job-title">${jobName} ${buildNum}</span>
    <span class="status-badge">${status}</span>
  </div>

  <div class="progress-bar"><div class="progress-fill"></div></div>

  <div class="meta">
    <div class="meta-card">
      <div class="meta-label">Branch</div>
      <div class="meta-value">🌿 ${branch}</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Duration</div>
      <div class="meta-value">⏱️ ${duration}</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Started</div>
      <div class="meta-value">📅 ${startTime}</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Build</div>
      <div class="meta-value">🔢 ${buildNum || 'Queued'}</div>
    </div>
  </div>

  <div class="console-header">Console Output (last 100 lines)</div>
  <div class="console">${escapeHtml(consoleText) || 'Waiting for output...'}</div>

  ${status === 'RUNNING' ? '<p style="opacity:0.6;font-size:12px;">Auto-refreshing every 5s...</p>' : ''}
</body>
</html>`;
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { BuildSummaryPanel };
