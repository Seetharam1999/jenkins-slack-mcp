const vscode = require('vscode');

class HistoryTreeProvider {
  constructor(context) {
    this.context = context;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.history = context.globalState.get('buildpilot.history', []);
  }

  refresh() { this._onDidChangeTreeData.fire(); }

  addEntry(jobName, params) {
    this.history.unshift({ jobName, params, time: new Date().toLocaleString() });
    if (this.history.length > 50) this.history = this.history.slice(0, 50);
    this.context.globalState.update('buildpilot.history', this.history);
    this.refresh();
  }

  clear() {
    this.history = [];
    this.context.globalState.update('buildpilot.history', []);
    this.refresh();
  }

  getTreeItem(element) { return element; }

  getChildren() {
    if (!this.history.length) return [new vscode.TreeItem('No builds yet')];
    return this.history.map(entry => {
      const item = new vscode.TreeItem(`${entry.jobName} (${entry.params})`);
      item.description = entry.time;
      item.iconPath = new vscode.ThemeIcon('rocket');
      return item;
    });
  }
}

module.exports = { HistoryTreeProvider };
