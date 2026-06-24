const vscode = require('vscode');

class HistoryTreeProvider {
  constructor(context, jenkinsService) {
    this.context = context;
    this.jenkins = jenkinsService;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.history = context.globalState.get('buildpilot.history', []);
    this._pollers = new Map(); // id -> interval
    
    // On load, mark old "running" entries as unknown (will be checked once)
    this._reconcileOnLoad();
  }

  refresh() { this._onDidChangeTreeData.fire(); }

  _reconcileOnLoad() {
    // Check stale running entries once after credentials load
    setTimeout(async () => {
      if (!this.jenkins.isLoggedIn()) return;
      let changed = false;
      for (const entry of this.history) {
        if (entry.status !== 'running') continue;
        try {
          const build = await this.jenkins.getLastBuildNumber(entry.jobName);
          if (!build || !build.building) {
            entry.status = 'done';
            entry.buildNumber = build?.number;
            changed = true;
          } else {
            // Still running — start polling
            this._pollStatus(entry);
          }
        } catch {
          entry.status = 'done';
          changed = true;
        }
      }
      if (changed) {
        this.context.globalState.update('buildpilot.history', this.history);
        this.refresh();
      }
    }, 2000);
  }

  addEntry(jobName, params) {
    const id = `${jobName}-${Date.now()}`;
    const entry = { id, jobName, params, time: new Date().toLocaleString(), status: 'running', buildNumber: null };
    this.history.unshift(entry);
    if (this.history.length > 50) this.history = this.history.slice(0, 50);
    this.context.globalState.update('buildpilot.history', this.history);
    this.refresh();
    this._pollStatus(entry);
  }

  _pollStatus(entry) {
    if (this._pollers.has(entry.id)) return;
    const interval = setInterval(async () => {
      if (!this.jenkins.isLoggedIn()) { this._clearPoller(entry.id); return; }
      try {
        const build = await this.jenkins.getLastBuildNumber(entry.jobName);
        if (build && !build.building) {
          entry.status = 'done';
          entry.buildNumber = build.number;
          this.context.globalState.update('buildpilot.history', this.history);
          this._clearPoller(entry.id);
          this.refresh();
        } else if (build && !entry.buildNumber) {
          entry.buildNumber = build.number;
        }
      } catch { this._clearPoller(entry.id); }
    }, 10000);
    this._pollers.set(entry.id, interval);
    // Auto-stop after 30 min
    setTimeout(() => this._clearPoller(entry.id), 30 * 60 * 1000);
  }

  _clearPoller(id) {
    const interval = this._pollers.get(id);
    if (interval) { clearInterval(interval); this._pollers.delete(id); }
  }

  clear() {
    for (const [id] of this._pollers) this._clearPoller(id);
    this.history = [];
    this.context.globalState.update('buildpilot.history', []);
    this.refresh();
  }

  getTreeItem(element) { return element; }

  getChildren() {
    if (!this.history.length) return [new vscode.TreeItem('No builds yet')];
    return this.history.map(entry => {
      const isRunning = entry.status === 'running';
      const buildLabel = entry.buildNumber ? ` #${entry.buildNumber}` : '';
      const item = new vscode.TreeItem(`${entry.jobName}${buildLabel} (${entry.params})`);
      item.description = entry.time;
      item.iconPath = new vscode.ThemeIcon(isRunning ? 'loading~spin' : 'check');
      item.contextValue = isRunning ? 'historyRunning' : 'historyDone';
      item.jobName = entry.jobName;
      item.command = {
        command: 'buildpilot.showBuildSummary',
        title: 'Show Build Summary',
        arguments: [entry.jobName, entry.params]
      };
      return item;
    });
  }
}

module.exports = { HistoryTreeProvider };
