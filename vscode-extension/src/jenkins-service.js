const axios = require('axios');
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
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP/HTTPS protocols are allowed');
  }
  for (const pattern of BLOCKED_HOSTS) {
    if (pattern.test(parsed.hostname)) throw new Error('Connection to private/internal networks is not allowed');
  }
  return parsed.origin;
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
    // Load non-sensitive metadata from globalState
    const meta = this.context.globalState.get('buildpilot.jenkins.meta', null);
    if (!meta) return;
    // Retrieve secrets from secure storage
    try {
      const apiToken = await this.secrets.get('buildpilot.apiToken');
      const buildToken = await this.secrets.get('buildpilot.buildToken');
      if (apiToken) {
        this._creds = { baseUrl: meta.baseUrl, user: meta.user, apiToken, buildToken: buildToken || '' };
      }
    } catch {}
  }

  isLoggedIn() { return !!this._creds; }

  getJobs() { return this.jobs; }

  getCreds() { return this._creds; }

  async login(baseUrl, user, apiToken, buildToken) {
    const validUrl = validateBaseUrl(baseUrl);
    const resp = await axios.get(`${validUrl}/me/api/json`, {
      auth: { username: user, password: apiToken },
      timeout: 15000,
    });

    this._creds = { baseUrl: validUrl, user, apiToken, buildToken };

    // Store only non-sensitive metadata in globalState
    await this.context.globalState.update('buildpilot.jenkins.meta', { baseUrl: validUrl, user });
    // Store secrets in encrypted secrets API
    await this.secrets.store('buildpilot.apiToken', apiToken);
    await this.secrets.store('buildpilot.buildToken', buildToken || '');

    return resp.data;
  }

  async discoverJobs() {
    if (!this._creds) throw new Error('Not logged in');
    const { baseUrl, user, apiToken } = this._creds;
    const resp = await axios.get(`${baseUrl}/api/json?tree=jobs[name,url,color,_class]`, {
      auth: { username: user, password: apiToken },
      timeout: 30000,
    });
    this.jobs = {};
    for (const j of (resp.data.jobs || [])) {
      if (j._class === 'com.cloudbees.hudson.plugins.folder.Folder') continue;
      this.jobs[j.name] = { name: j.name, path: `/job/${encodeURIComponent(j.name)}`, color: j.color || 'unknown' };
    }
    await this.context.globalState.update('buildpilot.jobs', this.jobs);
  }

  async triggerBuild(jobName, params = {}) {
    const job = this.jobs[jobName];
    if (!job) throw new Error(`Job "${jobName}" not found`);
    const { baseUrl, user, apiToken, buildToken } = this._creds;

    // Validate params - block reserved keys
    const RESERVED = ['token', 'cause', 'json', 'submit'];
    for (const key of Object.keys(params)) {
      if (RESERVED.includes(key.toLowerCase())) {
        throw new Error(`Parameter "${key}" is reserved`);
      }
      if (!/^[a-zA-Z0-9_\-.]+$/.test(key)) {
        throw new Error(`Invalid parameter name: "${key}"`);
      }
    }

    await axios.post(`${baseUrl}${job.path}/buildWithParameters`, null, {
      params: { token: buildToken, cause: 'BuildPilot', ...params },
      auth: { username: user, password: apiToken },
      timeout: 15000,
    });
  }

  async getLastBuildNumber(jobName) {
    const job = this.jobs[jobName];
    if (!job) return null;
    const { baseUrl, user, apiToken } = this._creds;
    try {
      const resp = await axios.get(`${baseUrl}${job.path}/lastBuild/api/json?tree=number,building`, {
        auth: { username: user, password: apiToken },
        timeout: 10000,
      });
      return resp.data;
    } catch { return null; }
  }

  async cancelBuild(jobName, buildNumber) {
    const job = this.jobs[jobName];
    if (!job) throw new Error(`Job "${jobName}" not found`);
    const { baseUrl, user, apiToken } = this._creds;
    await axios.post(`${baseUrl}${job.path}/${buildNumber}/stop`, null, {
      auth: { username: user, password: apiToken },
      timeout: 10000,
    });
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
