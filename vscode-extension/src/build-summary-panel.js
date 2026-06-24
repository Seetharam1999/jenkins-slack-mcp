const vscode = require('vscode');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, { headers, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

function fetchText(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, { headers, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

class BuildSummaryPanel {
  static currentPanel;

  static show(context, jenkinsService, jobName, branch) {
    const column = vscode.ViewColumn.Beside;
    if (BuildSummaryPanel.currentPanel) {
      BuildSummaryPanel.currentPanel._panel.reveal(column);
      BuildSummaryPanel.currentPanel._startPolling(jenkinsService, jobName, branch);
      return;
    }
    const panel = vscode.window.createWebviewPanel('buildpilot.summary', `Build: ${jobName}`, column, { enableScripts: false, localResourceRoots: [] });
    BuildSummaryPanel.currentPanel = new BuildSummaryPanel(panel);
    BuildSummaryPanel.currentPanel._startPolling(jenkinsService, jobName, branch);
  }

  constructor(panel) {
    this._panel = panel;
    this._polling = null;
    this._panel.onDidDispose(() => { this._stopPolling(); BuildSummaryPanel.currentPanel = null; });
  }

  _stopPolling() { if (this._polling) { clearInterval(this._polling); this._polling = null; } }

  async _startPolling(jenkinsService, jobName, branch) {
    this._stopPolling();
    const creds = jenkinsService.getCreds();
    const job = jenkinsService.getJobs()[jobName];
    if (!creds || !job) return;

    const headers = { Authorization: 'Basic ' + Buffer.from(`${creds.user}:${creds.apiToken}`).toString('base64') };
    this._panel.title = `Build: ${jobName}`;
    this._updateHtml(jobName, branch, 'PENDING', null);

    await new Promise(r => setTimeout(r, 3000));

    this._polling = setInterval(async () => {
      try {
        const build = await fetchJson(`${creds.baseUrl}${job.path}/lastBuild/api/json?tree=number,building,result,timestamp,duration`, headers);
        let consoleText = '';
        try {
          const raw = await fetchText(`${creds.baseUrl}${job.path}/${build.number}/consoleText`, headers);
          consoleText = raw.split('\n').slice(-100).join('\n');
        } catch {}
        const status = build.building ? 'RUNNING' : (build.result || 'UNKNOWN');
        this._updateHtml(jobName, branch, status, build, consoleText);
        if (!build.building) this._stopPolling();
      } catch {}
    }, 5000);
  }

  _updateHtml(jobName, branch, status, build, consoleText = '') {
    const nonce = crypto.randomBytes(16).toString('base64');
    const colors = { SUCCESS: '#4caf50', FAILURE: '#f44336', RUNNING: '#2196f3', ABORTED: '#ff9800', PENDING: '#9e9e9e', UNKNOWN: '#9e9e9e' };
    const icons = { SUCCESS: '&#9989;', FAILURE: '&#10060;', RUNNING: '&#128260;', ABORTED: '&#9940;', PENDING: '&#9203;', UNKNOWN: '&#10067;' };
    const color = colors[status] || '#9e9e9e';
    const icon = icons[status] || '&#10067;';
    const duration = build?.duration ? `${(build.duration / 1000).toFixed(1)}s` : '—';
    const buildNum = build?.number ? `#${build.number}` : '';
    const startTime = build?.timestamp ? new Date(build.timestamp).toLocaleString() : '—';

    const csp = `default-src 'none'; style-src 'nonce-${nonce}';`;
    this._panel.webview.html = `<!DOCTYPE html>
<html><head><meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">
body{font-family:-apple-system,sans-serif;padding:20px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground)}
.h{display:flex;align-items:center;gap:12px;margin-bottom:16px}.t{font-size:20px;font-weight:600}
.b{background:${color};color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600}
.m{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
.c{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:6px;padding:10px}
.l{font-size:11px;opacity:.7;text-transform:uppercase;margin-bottom:2px}.v{font-size:13px;font-weight:500}
.o{background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;font-family:monospace;font-size:11px;line-height:1.4;white-space:pre-wrap;max-height:400px;overflow-y:auto}
.p{height:3px;background:var(--vscode-panel-border);border-radius:2px;margin-bottom:16px;overflow:hidden}
.f{height:100%;background:${color};${status === 'RUNNING' ? 'animation:a 2s infinite' : 'width:100%'}}
@keyframes a{0%{width:0}50%{width:70%}100%{width:100%}}
</style></head><body>
<div class="h"><span style="font-size:24px">${icon}</span><span class="t">${escapeHtml(jobName)} ${escapeHtml(buildNum)}</span><span class="b">${escapeHtml(status)}</span></div>
<div class="p"><div class="f"></div></div>
<div class="m"><div class="c"><div class="l">Branch</div><div class="v">${escapeHtml(branch)}</div></div>
<div class="c"><div class="l">Duration</div><div class="v">${escapeHtml(duration)}</div></div>
<div class="c"><div class="l">Started</div><div class="v">${escapeHtml(startTime)}</div></div>
<div class="c"><div class="l">Build</div><div class="v">${escapeHtml(buildNum) || 'Queued'}</div></div></div>
<div class="o">${escapeHtml(consoleText) || 'Waiting for output...'}</div>
${status === 'RUNNING' ? '<p style="opacity:.5;font-size:11px">Auto-refreshing every 5s...</p>' : ''}
</body></html>`;
  }
}

module.exports = { BuildSummaryPanel };
