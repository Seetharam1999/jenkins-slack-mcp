const axios = require('axios');
const vscode = require('vscode');

class JenkinsService {
  constructor(context) {
    this.context = context;
    this.secrets = context.secrets;
    this.jobs = {};
    this._creds = null;
    this._loadFromState();
  }

  _loadFromState() {
    this.jobs = this.context.globalState.get('buildpilot.jobs', {});
    this._creds = this.context.globalState.get('buildpilot.jenkins', null);
  }

  isLoggedIn() { return !!this._creds; }

  getJobs() { return this.jobs; }

  getCreds() { return this._creds; }

  async login(baseUrl, user, apiToken, buildToken) {
    const resp = await axios.get(`${baseUrl}/me/api/json`, { auth: { username: user, password: apiToken } });
    this._creds = { baseUrl, user, apiToken, buildToken };
    await this.context.globalState.update('buildpilot.jenkins', this._creds);
    await this.secrets.store('buildpilot.apiToken', apiToken);
    return resp.data;
  }

  async discoverJobs() {
    const { baseUrl, user, apiToken } = this._creds;
    const resp = await axios.get(`${baseUrl}/api/json?tree=jobs[name,url,color,_class]`, { auth: { username: user, password: apiToken } });
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
    await axios.post(`${baseUrl}${job.path}/buildWithParameters`, null, {
      params: { token: buildToken, cause: 'BuildPilot', ...params },
      auth: { username: user, password: apiToken },
    });
  }

  async getLastBuildNumber(jobName) {
    const job = this.jobs[jobName];
    if (!job) return null;
    const { baseUrl, user, apiToken } = this._creds;
    try {
      const resp = await axios.get(`${baseUrl}${job.path}/lastBuild/api/json?tree=number,building`, { auth: { username: user, password: apiToken } });
      return resp.data;
    } catch { return null; }
  }

  async cancelBuild(jobName, buildNumber) {
    const job = this.jobs[jobName];
    if (!job) throw new Error(`Job "${jobName}" not found`);
    const { baseUrl, user, apiToken } = this._creds;
    await axios.post(`${baseUrl}${job.path}/${buildNumber}/stop`, null, {
      auth: { username: user, password: apiToken },
    });
  }

  logout() {
    this._creds = null;
    this.jobs = {};
    this.context.globalState.update('buildpilot.jenkins', undefined);
    this.context.globalState.update('buildpilot.jobs', undefined);
    this.secrets.delete('buildpilot.apiToken');
  }
}

module.exports = { JenkinsService };
