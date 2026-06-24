const vscode = require('vscode');

class JobsTreeProvider {
  constructor(jenkinsService) {
    this.jenkins = jenkinsService;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() { this._onDidChangeTreeData.fire(); }

  getTreeItem(element) { return element; }

  getChildren() {
    if (!this.jenkins.isLoggedIn()) {
      return [new vscode.TreeItem('Click to login → BuildPilot: Login')];
    }
    const jobs = this.jenkins.getJobs();
    return Object.values(jobs).map(job => {
      const item = new vscode.TreeItem(job.name);
      item.iconPath = new vscode.ThemeIcon(job.color === 'blue' ? 'pass' : job.color === 'red' ? 'error' : 'circle-outline');
      item.contextValue = 'job';
      item.jobName = job.name;
      item.command = { command: 'buildpilot.triggerBuild', title: 'Trigger Build', arguments: [item] };
      item.tooltip = `Click to trigger ${job.name}`;
      return item;
    });
  }
}

module.exports = { JobsTreeProvider };
