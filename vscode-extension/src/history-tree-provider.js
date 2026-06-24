const vscode = require('vscode');

class HistoryTreeProvider {
  constructor(context, jenkinsService) {
    this.context = context;
    this.jenkins = jenkinsService;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.history = context.globalState.get('buildpilot.history', []);
    this._pollers = new Map();
    this._reconcileOnLoad();
  }

  refresh() { this._onDidChangeTreeData.fire(); }

  _reconcileOnLoad() {
    setTimeout(async () => {
      if (!this.jenkins.isLoggedIn()) return;
      let changed = false;
      for (const entry of this.history) {
        if (entry.status !== 'running') continue;
        if (!entry.buildNumber) { entry.status = 'done'; changed = true; continue; }
        try {
          const build = await this.jenkins.getBuildInfo(entry.jobName, entry.buildNumber);
          if (!build || !build.building) {
            entry.status = 'done';
            changed = true;
          } else {
            this._pollEntry(entry);
          }
        } catch {
          entry.status = 'done';
          changed = true;
        }
      }
      if (changed) { this._save(); this.refresh(); }
    }, 2000);
  }

  /**
   * @param {string} jobName
   * @param {string} params
   * @param {number|null} prevBuildNumber - the lastBuild number BEFORE trigger
   */
  addEntry(jobName, params, prevBuildNumber) {
    const id = `${jobName}-${Date.now()}`;
    const entry = { id, jobName, params, time: new Date().toLocaleString(), status: 'running', buildNumber: null, prevBuildNumber };
    this.history.unshift(entry);
    if (this.history.length > 50) this.history = this.history.slice(0, 50);
    this._save();
    this.refresh();
    this._resolveAndPoll(entry);
  }

  async _resolveAndPoll(entry) {
    // Poll until a build number GREATER than prevBuildNumber appears
    // Also must not match any already-assigned number in history
    const prev = entry.prevBuildNumber || 0;
    const assignedNumbers = new Set(this.history.filter(e => e.jobName === entry.jobName && e.buildNumber).map(e => e.buildNumber));

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));
      if (!this.jenkins.isLoggedIn()) return;
      try {
        const build = await this.jenkins.getLastBuildNumber(entry.jobName);
        if (build && build.number > prev && !assignedNumbers.has(build.number)) {
          entry.buildNumber = build.number;
          this._save();
          this.refresh();
          break;
        }
      } catch {}
    }
    if (entry.buildNumber) this._pollEntry(entry);
  }

  _pollEntry(entry) {
    if (this._pollers.has(entry.id)) return;
    const interval = setInterval(async () => {
      if (!this.jenkins.isLoggedIn() || !entry.buildNumber) { this._clearPoller(entry.id); return; }
      try {
        const build = await this.jenkins.getBuildInfo(entry.jobName, entry.buildNumber);
        if (!build || !build.building) {
          entry.status = 'done';
          this._save();
          this._clearPoller(entry.id);
          this.refresh();
        }
      } catch { this._clearPoller(entry.id); }
    }, 8000);
    this._pollers.set(entry.id, interval);
    setTimeout(() => this._clearPoller(entry.id), 30 * 60 * 1000);
  }

  _clearPoller(id) {
    const interval = this._pollers.get(id);
    if (interval) { clearInterval(interval); this._pollers.delete(id); }
  }

  _save() { this.context.globalState.update('buildpilot.history', this.history); }

  clear() {
    for (const [id] of this._pollers) this._clearPoller(id);
    this.history = [];
    this._save();
    this.refresh();
  }

  getTreeItem(element) { return element; }

  getChildren() {
    if (!this.history.length) return [new vscode.TreeItem('No builds yet')];
    return this.history.map(entry => {
      const isRunning = entry.status === 'running';
      const buildLabel = entry.buildNumber ? ` #${entry.buildNumber}` : ' (queued)';
      const label = `${entry.jobName}${buildLabel} (${entry.params})`;
      const item = new vscode.TreeItem(label);
      // Unique ID so VS Code re-renders when buildNumber changes
      item.id = `${entry.id}-${entry.buildNumber || 'pending'}`;
      item.description = entry.time;
      item.iconPath = new vscode.ThemeIcon(isRunning ? 'loading~spin' : 'check');
      item.contextValue = isRunning ? 'historyRunning' : 'historyDone';
      item.jobName = entry.jobName;
      item.buildNumber = entry.buildNumber;
      item.command = {
        command: 'buildpilot.showBuildSummary',
        title: 'Show Build Summary',
        arguments: [entry.jobName, entry.params, entry.buildNumber]
      };
      return item;
    });
  }
}

module.exports = { HistoryTreeProvider };
