const vscode = require('vscode');

class JobsTreeProvider {
  constructor(jenkinsService, context) {
    this.jenkins = jenkinsService;
    this.context = context;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._filter = '';
    this._pinnedJobs = context.globalState.get('buildpilot.pinnedJobs', []);
    this._pinnedGroups = context.globalState.get('buildpilot.pinnedGroups', []);
  }

  refresh() { this._onDidChangeTreeData.fire(); }

  setFilter(filter) {
    this._filter = (filter || '').toLowerCase();
    this.refresh();
  }

  pinJob(jobName) {
    if (!this._pinnedJobs.includes(jobName)) {
      this._pinnedJobs.unshift(jobName);
      this.context.globalState.update('buildpilot.pinnedJobs', this._pinnedJobs);
      this.refresh();
    }
  }

  unpinJob(jobName) {
    this._pinnedJobs = this._pinnedJobs.filter(j => j !== jobName);
    this.context.globalState.update('buildpilot.pinnedJobs', this._pinnedJobs);
    this.refresh();
  }

  pinGroup(groupName) {
    if (!this._pinnedGroups.includes(groupName)) {
      this._pinnedGroups.unshift(groupName);
      this.context.globalState.update('buildpilot.pinnedGroups', this._pinnedGroups);
      this.refresh();
    }
  }

  unpinGroup(groupName) {
    this._pinnedGroups = this._pinnedGroups.filter(g => g !== groupName);
    this.context.globalState.update('buildpilot.pinnedGroups', this._pinnedGroups);
    this.refresh();
  }

  getTreeItem(element) { return element; }

  getChildren(element) {
    if (!this.jenkins.isLoggedIn()) {
      return [new vscode.TreeItem('Click to login → BuildPilot: Login')];
    }

    const jobs = this.jenkins.getJobs();
    let jobList = Object.values(jobs);

    if (this._filter) {
      jobList = jobList.filter(j => j.name.toLowerCase().includes(this._filter));
    }

    // Expanding a group
    if (element?.contextValue === 'group' || element?.contextValue === 'pinnedGroup') {
      return this._buildJobItems(jobList.filter(j => {
        const prefix = j.name.split('-')[0].toUpperCase();
        return prefix === element.groupName;
      }));
    }

    // Top level — build groups
    const groups = {};
    for (const job of jobList) {
      const prefix = job.name.split('-')[0].toUpperCase();
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(job);
    }

    // Flat list if only one group
    if (Object.keys(groups).length <= 1) {
      return this._buildJobItems(jobList);
    }

    // Separate pinned groups and unpinned groups
    const pinnedGroupNames = Object.keys(groups).filter(g => this._pinnedGroups.includes(g)).sort();
    const unpinnedGroupNames = Object.keys(groups).filter(g => !this._pinnedGroups.includes(g)).sort();

    const items = [];

    for (const groupName of pinnedGroupNames) {
      const groupItem = new vscode.TreeItem(`📌 ${groupName}`, vscode.TreeItemCollapsibleState.Expanded);
      groupItem.contextValue = 'pinnedGroup';
      groupItem.groupName = groupName;
      groupItem.description = `${groups[groupName].length} jobs`;
      groupItem.iconPath = new vscode.ThemeIcon('folder');
      items.push(groupItem);
    }

    for (const groupName of unpinnedGroupNames) {
      const groupItem = new vscode.TreeItem(groupName, vscode.TreeItemCollapsibleState.Collapsed);
      groupItem.contextValue = 'group';
      groupItem.groupName = groupName;
      groupItem.description = `${groups[groupName].length} jobs`;
      groupItem.iconPath = new vscode.ThemeIcon('folder');
      items.push(groupItem);
    }

    return items;
  }

  _buildJobItems(jobs) {
    // Pinned jobs within a group come first
    const pinned = jobs.filter(j => this._pinnedJobs.includes(j.name));
    const unpinned = jobs.filter(j => !this._pinnedJobs.includes(j.name));
    return [...pinned, ...unpinned].map(job => {
      const isPinned = this._pinnedJobs.includes(job.name);
      const item = new vscode.TreeItem(job.name);
      item.iconPath = new vscode.ThemeIcon(
        job.color === 'blue' ? 'pass' : job.color === 'red' ? 'error' : 'circle-outline'
      );
      item.contextValue = isPinned ? 'pinnedJob' : 'job';
      item.jobName = job.name;
      item.command = { command: 'buildpilot.triggerBuild', title: 'Trigger Build', arguments: [item] };
      item.tooltip = `Click to trigger ${job.name}`;
      if (isPinned) item.description = '📌';
      return item;
    });
  }
}

module.exports = { JobsTreeProvider };
