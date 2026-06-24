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

// Track open panels by unique key
const openPanels = new Map();

class BuildSummaryPanel {
  /**
   * @param {number|null} buildNumber - specific build number to show, or null for latest
   */
  static show(context, jenkinsService, jobName, branch, buildNumber) {
    const panelKey = buildNumber ? `${jobName}#${buildNumber}` : `${jobName}-latest-${Date.now()}`;
    const column = vscode.ViewColumn.Beside;

    // Always open a new tab
    const title = buildNumber ? `${jobName} #${buildNumber}` : `${jobName} (latest)`;
    const panel = vscode.window.createWebviewPanel('buildpilot.summary', title, column, {
      enableScripts: true,
      localResourceRoots: [],
    });

    const instance = new BuildSummaryPanel(panel, panelKey);
    openPanels.set(panelKey, instance);
    instance._startPolling(jenkinsService, jobName, branch, buildNumber);
  }

  constructor(panel, key) {
    this._panel = panel;
    this._key = key;
    this._polling = null;
    this._panel.onDidDispose(() => {
      this._stopPolling();
      openPanels.delete(this._key);
    });
  }

  _stopPolling() { if (this._polling) { clearInterval(this._polling); this._polling = null; } }

  async _startPolling(jenkinsService, jobName, branch, buildNumber) {
    this._stopPolling();
    const creds = jenkinsService.getCreds();
    const job = jenkinsService.getJobs()[jobName];
    if (!creds || !job) return;

    const headers = { Authorization: 'Basic ' + Buffer.from(`${creds.user}:${creds.apiToken}`).toString('base64') };
    this._setShell(jobName, branch);

    // Determine which build to fetch
    let targetBuild = buildNumber;

    const poll = async () => {
      try {
        // If no specific build number, fetch latest
        const buildPath = targetBuild
          ? `${creds.baseUrl}${job.path}/${targetBuild}/api/json?tree=number,building,result,timestamp,duration,displayName,description`
          : `${creds.baseUrl}${job.path}/lastBuild/api/json?tree=number,building,result,timestamp,duration,displayName,description`;

        const build = await fetchJson(buildPath, headers);

        // Lock onto this build number once discovered
        if (!targetBuild && build?.number) targetBuild = build.number;

        let consoleText = '';
        try {
          const raw = await fetchText(`${creds.baseUrl}${job.path}/${build.number}/consoleText`, headers);
          consoleText = raw.split('\n').slice(-150).join('\n');
        } catch {}

        const status = build.building ? 'RUNNING' : (build.result || 'UNKNOWN');
        this._panel.title = `${jobName} #${build.number} — ${status}`;
        this._sendUpdate(jobName, branch, status, build, consoleText);
        if (!build.building) this._stopPolling();
      } catch {}
    };

    // Initial delay for newly triggered builds
    if (!buildNumber) await new Promise(r => setTimeout(r, 3000));
    await poll();
    this._polling = setInterval(poll, 5000);
  }

  _setShell(jobName, branch) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
    this._panel.webview.html = `<!DOCTYPE html>
<html><head><meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">
body{font-family:-apple-system,sans-serif;padding:20px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground)}
.h{display:flex;align-items:center;gap:12px;margin-bottom:16px}.t{font-size:20px;font-weight:600}
.b{padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;color:#fff}
.m{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
.c{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:6px;padding:10px}
.l{font-size:11px;opacity:.7;text-transform:uppercase;margin-bottom:2px}.v{font-size:13px;font-weight:500}
.o{background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;font-family:monospace;font-size:11px;line-height:1.4;white-space:pre-wrap;max-height:500px;overflow-y:auto}
.p{height:3px;background:var(--vscode-panel-border);border-radius:2px;margin-bottom:16px;overflow:hidden}
.f{height:100%;transition:width .3s}
@keyframes pulse{0%{width:0}50%{width:70%}100%{width:100%}}
.info{font-size:11px;opacity:.5;margin-top:8px}
</style></head><body>
<div class="h"><span id="icon" style="font-size:24px">&#9203;</span><span class="t" id="title">${escapeHtml(jobName)}</span><span class="b" id="badge" style="background:#9e9e9e">LOADING</span></div>
<div class="p"><div class="f" id="progress" style="background:#9e9e9e;width:0"></div></div>
<div class="m">
<div class="c"><div class="l">Branch</div><div class="v" id="branch">${escapeHtml(branch)}</div></div>
<div class="c"><div class="l">Duration</div><div class="v" id="duration">—</div></div>
<div class="c"><div class="l">Started</div><div class="v" id="started">—</div></div>
<div class="c"><div class="l">Build</div><div class="v" id="buildnum">—</div></div>
<div class="c"><div class="l">Display Name</div><div class="v" id="displayname">—</div></div>
<div class="c"><div class="l">Description</div><div class="v" id="description">—</div></div>
</div>
<div class="o" id="console">Loading...</div>
<div class="info" id="info"></div>
<script nonce="${nonce}">
const colors = {SUCCESS:'#4caf50',FAILURE:'#f44336',RUNNING:'#2196f3',ABORTED:'#ff9800',PENDING:'#9e9e9e',UNKNOWN:'#9e9e9e'};
const icons = {SUCCESS:'&#9989;',FAILURE:'&#10060;',RUNNING:'&#128260;',ABORTED:'&#9940;',PENDING:'&#9203;',UNKNOWN:'&#10067;'};
window.addEventListener('message', e => {
  const d = e.data;
  const color = colors[d.status] || '#9e9e9e';
  document.getElementById('icon').innerHTML = icons[d.status] || '&#10067;';
  document.getElementById('title').textContent = d.title;
  document.getElementById('badge').textContent = d.status;
  document.getElementById('badge').style.background = color;
  document.getElementById('duration').textContent = d.duration;
  document.getElementById('started').textContent = d.started;
  document.getElementById('buildnum').textContent = d.buildnum;
  document.getElementById('displayname').textContent = d.displayName || '—';
  document.getElementById('description').textContent = d.description || '—';
  const prog = document.getElementById('progress');
  prog.style.background = color;
  if (d.status === 'RUNNING') { prog.style.animation = 'pulse 2s infinite'; prog.style.width = ''; }
  else { prog.style.animation = 'none'; prog.style.width = '100%'; }
  const con = document.getElementById('console');
  const atBottom = con.scrollHeight - con.scrollTop - con.clientHeight < 50;
  con.textContent = d.console || 'Waiting for output...';
  if (atBottom) con.scrollTop = con.scrollHeight;
  document.getElementById('info').textContent = d.status === 'RUNNING' ? 'Auto-refreshing every 5s...' : '';
});
</script>
</body></html>`;
  }

  _sendUpdate(jobName, branch, status, build, consoleText) {
    this._panel.webview.postMessage({
      status,
      title: `${jobName} #${build?.number || '?'}`,
      duration: build?.duration ? `${(build.duration / 1000).toFixed(1)}s` : '—',
      started: build?.timestamp ? new Date(build.timestamp).toLocaleString() : '—',
      buildnum: build?.number ? `#${build.number}` : '—',
      displayName: build?.displayName || '',
      description: build?.description || '',
      console: consoleText,
    });
  }
}

module.exports = { BuildSummaryPanel };
