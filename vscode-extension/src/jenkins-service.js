const https = require('https');
const http = require('http');
const vscode = require('vscode');
const { URL } = require('url');

const BLOCKED_HOSTS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\./, /^localhost$/i, /^::1$/, /^fc00:/i, /^fe80:/i,
];

function validateBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') throw new Error('Invalid Jenkins URL');
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error('Invalid URL format'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Only HTTP/HTTPS allowed');
  for (const p of BLOCKED_HOSTS) { if (p.test(parsed.hostname)) throw new Error('Private/internal networks blocked'); }
  return parsed.origin;
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const timeout = opts.timeout || 15000;
    const req = mod.request(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400 && res.statusCode !== 201) {
          reject(new Error(`HTTP ${res.statusCode}`));
        } else {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function authHeaders(user, apiToken) {
  return { Authorization: 'Basic ' + Buffer.from(`${user}:${apiToken}`).toString('base64') };
}

class JenkinsService {
  constructor(context) {
    this.context = context;
    this.secrets = context.secrets;
    this.jobs = {};
    this._creds = null;
    this._loadFromState();
  }

  async _loadFromState() {
    this.jobs = this.context.globalState.get('buildpilot.jobs', {});
    const meta = this.context.globalState.get('buildpilot.jenkins.meta', null);
    if (!meta) return;
    try {
      const apiToken = await this.secrets.get('buildpilot.apiToken');
      const buildToken = await this.secrets.get('buildpilot.buildToken');
      if (apiToken) this._creds = { baseUrl: meta.baseUrl, user: meta.user, apiToken, buildToken: buildToken || '' };
    } catch {}
  }

  isLoggedIn() { return !!this._creds; }
  getJobs() { return this.jobs; }
  getCreds() { return this._creds; }

  async login(baseUrl, user, apiToken, buildToken) {
    const validUrl = validateBaseUrl(baseUrl);
    await request(`${validUrl}/me/api/json`, { headers: authHeaders(user, apiToken) });
    this._creds = { baseUrl: validUrl, user, apiToken, buildToken };
    await this.context.globalState.update('buildpilot.jenkins.meta', { baseUrl: validUrl, user });
    await this.secrets.store('buildpilot.apiToken', apiToken);
    await this.secrets.store('buildpilot.buildToken', buildToken || '');
  }

  async discoverJobs() {
    if (!this._creds) throw new Error('Not logged in');
    const { baseUrl, user, apiToken } = this._creds;
    const data = await request(`${baseUrl}/api/json?tree=jobs[name,url,color,_class]`, { headers: authHeaders(user, apiToken), timeout: 30000 });
    this.jobs = {};
    for (const j of (data.jobs || [])) {
      if (j._class === 'com.cloudbees.hudson.plugins.folder.Folder') continue;
      this.jobs[j.name] = { name: j.name, path: `/job/${encodeURIComponent(j.name)}`, color: j.color || 'unknown' };
    }
    await this.context.globalState.update('buildpilot.jobs', this.jobs);
  }

  async triggerBuild(jobName, params = {}) {
    const job = this.jobs[jobName];
    if (!job) throw new Error(`Job "${jobName}" not found`);
    const { baseUrl, user, apiToken, buildToken } = this._creds;
    const RESERVED = ['token', 'cause', 'json', 'submit'];
    for (const key of Object.keys(params)) {
      if (RESERVED.includes(key.toLowerCase())) throw new Error(`Parameter "${key}" is reserved`);
      if (!/^[a-zA-Z0-9_\-.]+$/.test(key)) throw new Error(`Invalid parameter name: "${key}"`);
    }
    const qs = new URLSearchParams({ token: buildToken, cause: 'BuildPilot', ...params }).toString();
    await request(`${baseUrl}${job.path}/buildWithParameters?${qs}`, { method: 'POST', headers: authHeaders(user, apiToken) });
  }

  async getLastBuildNumber(jobName) {
    const job = this.jobs[jobName];
    if (!job) return null;
    const { baseUrl, user, apiToken } = this._creds;
    try {
      return await request(`${baseUrl}${job.path}/lastBuild/api/json?tree=number,building`, { headers: authHeaders(user, apiToken), timeout: 10000 });
    } catch { return null; }
  }

  async cancelBuild(jobName, buildNumber) {
    const job = this.jobs[jobName];
    if (!job) throw new Error(`Job "${jobName}" not found`);
    const { baseUrl, user, apiToken } = this._creds;
    await request(`${baseUrl}${job.path}/${buildNumber}/stop`, { method: 'POST', headers: authHeaders(user, apiToken), timeout: 10000 });
  }

  async getConsoleText(jobName, buildNumber) {
    const job = this.jobs[jobName];
    if (!job) return '';
    const { baseUrl, user, apiToken } = this._creds;
    try {
      const text = await request(`${baseUrl}${job.path}/${buildNumber}/consoleText`, { headers: authHeaders(user, apiToken), timeout: 10000 });
      const lines = String(text).split('\n');
      return lines.slice(-100).join('\n');
    } catch { return ''; }
  }

  logout() {
    this._creds = null;
    this.jobs = {};
    this.context.globalState.update('buildpilot.jenkins.meta', undefined);
    this.context.globalState.update('buildpilot.jobs', undefined);
    this.secrets.delete('buildpilot.apiToken');
    this.secrets.delete('buildpilot.buildToken');
  }
}

module.exports = { JenkinsService };
