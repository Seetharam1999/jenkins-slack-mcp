const vscode = require('vscode');

class HistoryTreeProvider {
  constructor(context, jenkinsService) {
    this.context = context;
    this.jenkins = jenkinsService;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.history = context.globalState.get('buildpilot.history', []);
    this._statusCache = {}; // jobName -> { building, number }
  }

  refresh() { this._onDidChangeTreeData.fire(); }

  addEntry(jobName, params) {
    this.history.unshift({ jobName, params, time: new Date().toLocaleString(), status: 'running' });
    if (this.history.length > 50) this.history = this.history.slice(0, 50);
    this.context.globalState.update('buildpilot.history', this.history);
    this._statusCache[jobName] = { building: true };
    this.refresh();
    // Poll status for this entry
    this._pollStatus(jobName);
  }

  _pollStatus(jobName) {
    const interval = setInterval(async () => {
      if (!this.jenkins.isLoggedIn()) { clearInterval(interval); return; }
      try {
        const build = await this.jenkins.getLastBuildNumber(jobName);
        if (build && !build.building) {
          this._statusCache[jobName] = { building: false };
          // Update stored history
          const entry = this.history.find(e => e.jobName === jobName && e.status === 'running');
          if (entry) entry.status = 'done';
          this.context.globalState.update('buildpilot.history', this.history);
          this.refresh();
          clearInterval(interval);
        }
      } catch { clearInterval(interval); }
    }, 8000);
    // Auto-stop polling after 30 minutes
    setTimeout(() => clearInterval(interval), 30 * 60 * 1000);
  }

  clear() {
    this.history = [];
    this._statusCache = {};
    this.context.globalState.update('buildpilot.history', []);
    this.refresh();
  }

  getTreeItem(element) { return element; }

  getChildren() {
    if (!this.history.length) return [new vscode.TreeItem('No builds yet')];
    return this.history.map(entry => {
      const isRunning = entry.status === 'running';
      const icon = isRunning ? 'sync~spin' : 'rocket';
      const item = new vscode.TreeItem(`${entry.jobName} (${entry.params})`);
      item.description = entry.time;
      item.iconPath = new vscode.ThemeIcon(isRunning ? 'loading~spin' : 'rocket');
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
