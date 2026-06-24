const vscode = require('vscode');
const { JenkinsService } = require('./jenkins-service');
const { SlackService } = require('./slack-service');
const { JobsTreeProvider } = require('./jobs-tree-provider');
const { HistoryTreeProvider } = require('./history-tree-provider');
const { BuildSummaryPanel } = require('./build-summary-panel');
const { SearchViewProvider } = require('./search-view-provider');

let jenkinsService;
let slackService;
let jobsProvider;
let historyProvider;

function activate(context) {
  jenkinsService = new JenkinsService(context);
  slackService = new SlackService(context);
  jobsProvider = new JobsTreeProvider(jenkinsService, context);
  historyProvider = new HistoryTreeProvider(context, jenkinsService);

  const searchProvider = new SearchViewProvider(jobsProvider);

  vscode.window.registerTreeDataProvider('buildpilot.jobs', jobsProvider);
  vscode.window.registerTreeDataProvider('buildpilot.history', historyProvider);
  vscode.window.registerWebviewViewProvider('buildpilot.search', searchProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('buildpilot.login', () => loginJenkins(context)),
    vscode.commands.registerCommand('buildpilot.triggerBuild', (item) => triggerBuild(item, context)),
    vscode.commands.registerCommand('buildpilot.multiTrigger', () => multiTrigger()),
    vscode.commands.registerCommand('buildpilot.cancelBuild', () => cancelBuild()),
    vscode.commands.registerCommand('buildpilot.refreshJobs', () => refreshJobs()),
    vscode.commands.registerCommand('buildpilot.connectSlack', () => connectSlack(context)),
    vscode.commands.registerCommand('buildpilot.logout', () => logout()),
    vscode.commands.registerCommand('buildpilot.showBuildSummary', (jobName, params) => showBuildSummary(context, jobName, params)),
    vscode.commands.registerCommand('buildpilot.pinJob', (item) => { jobsProvider.pinJob(item.jobName); }),
    vscode.commands.registerCommand('buildpilot.unpinJob', (item) => { jobsProvider.unpinJob(item.jobName); }),
    vscode.commands.registerCommand('buildpilot.pinGroup', (item) => { jobsProvider.pinGroup(item.groupName); }),
    vscode.commands.registerCommand('buildpilot.unpinGroup', (item) => { jobsProvider.unpinGroup(item.groupName); }),
    vscode.commands.registerCommand('buildpilot.searchJobs', () => {}),
    vscode.commands.registerCommand('buildpilot.clearSearch', () => { jobsProvider.setFilter(''); }),
    vscode.commands.registerCommand('buildpilot.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'buildpilot');
    }),
    vscode.commands.registerCommand('buildpilot.stopBuild', (item) => stopBuildFromHistory(item))
  );

  if (!jenkinsService.isLoggedIn()) {
    vscode.window.showInformationMessage('BuildPilot: Connect to Jenkins to get started.', 'Login').then(choice => {
      if (choice === 'Login') vscode.commands.executeCommand('buildpilot.login');
    });
  } else {
    // Wait for async credentials to load before refreshing
    setTimeout(() => refreshJobs(), 500);
  }
}

async function loginJenkins(context) {
  const baseUrl = await vscode.window.showInputBox({ prompt: 'Jenkins Base URL', placeHolder: 'https://jenkins.example.com', value: vscode.workspace.getConfiguration('buildpilot').get('jenkinsUrl') || '' });
  if (!baseUrl) return;

  const user = await vscode.window.showInputBox({ prompt: 'Jenkins Username' });
  if (!user) return;

  const apiToken = await vscode.window.showInputBox({ prompt: 'Jenkins API Token', password: true });
  if (!apiToken) return;

  const buildToken = await vscode.window.showInputBox({ prompt: 'Build Trigger Token (optional)', password: true });

  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'BuildPilot: Connecting...' }, async () => {
      await jenkinsService.login(baseUrl.replace(/\/$/, ''), user, apiToken, buildToken || '');
      await jenkinsService.discoverJobs();
    });
    vscode.workspace.getConfiguration('buildpilot').update('jenkinsUrl', baseUrl, true);
    jobsProvider.refresh();
    const jobCount = Object.keys(jenkinsService.getJobs()).length;
    vscode.window.showInformationMessage(`BuildPilot: Connected as ${user}! ${jobCount} jobs found.`);
  } catch (err) {
    vscode.window.showErrorMessage(`BuildPilot: Login failed - ${err.message}`);
  }
}

function buildJobQuickPickItems() {
  const jobs = jenkinsService.getJobs();
  const groups = {};

  for (const [name, job] of Object.entries(jobs)) {
    const prefix = name.split('-')[0].toUpperCase();
    if (!groups[prefix]) groups[prefix] = [];
    const icon = job.color === 'blue' ? '$(pass)' : job.color === 'red' ? '$(error)' : job.color === 'disabled' ? '$(debug-pause)' : '$(circle-outline)';
    groups[prefix].push({
      label: `${icon} ${name}`,
      description: prefix,
      detail: job.color === 'blue' ? 'Last: Success' : job.color === 'red' ? 'Last: Failed' : job.color,
      jobName: name
    });
  }

  const items = [];
  for (const [group, jobItems] of Object.entries(groups).sort()) {
    items.push({ label: group, kind: vscode.QuickPickItemKind.Separator });
    items.push(...jobItems.sort((a, b) => a.label.localeCompare(b.label)));
  }
  return items;
}

async function triggerBuild(item, context) {
  if (!jenkinsService.isLoggedIn()) {
    vscode.window.showErrorMessage('BuildPilot: Login first.');
    return;
  }

  let jobName;

  if (item?.jobName) {
    jobName = item.jobName;
  } else {
    const items = buildJobQuickPickItems();
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Search and select a job...',
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!picked || !picked.jobName) return;
    jobName = picked.jobName;
  }

  const branch = await vscode.window.showInputBox({
    prompt: `Branch for ${jobName}`,
    value: vscode.workspace.getConfiguration('buildpilot').get('defaultBranch') || 'main'
  });
  if (branch === undefined) return;

  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `🚀 ${jobName} → ${branch}` }, async () => {
      await jenkinsService.triggerBuild(jobName, { BRANCH: branch });
    });
    historyProvider.addEntry(jobName, `BRANCH=${branch}`);
    vscode.window.showInformationMessage(`✅ ${jobName} triggered → ${branch}`);
    BuildSummaryPanel.show(context, jenkinsService, jobName, branch);

    if (vscode.workspace.getConfiguration('buildpilot').get('slackNotify') && slackService.isConnected()) {
      await slackService.notify(`🚀 *${jobName}* triggered → \`${branch}\``);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`BuildPilot: ${err.message}`);
  }
}

async function multiTrigger() {
  if (!jenkinsService.isLoggedIn()) {
    vscode.window.showErrorMessage('BuildPilot: Login first.');
    return;
  }

  const items = buildJobQuickPickItems().filter(i => i.jobName);
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select multiple jobs (use checkbox)...',
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!picked || !picked.length) return;

  const branch = await vscode.window.showInputBox({
    prompt: `Branch for ${picked.length} job(s)`,
    value: vscode.workspace.getConfiguration('buildpilot').get('defaultBranch') || 'main'
  });
  if (branch === undefined) return;

  let success = 0;
  let failed = 0;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `🚀 Triggering ${picked.length} jobs → ${branch}`, cancellable: true },
    async (progress, token) => {
      for (const item of picked) {
        if (token.isCancellationRequested) break;
        progress.report({ message: item.jobName, increment: 100 / picked.length });
        try {
          await jenkinsService.triggerBuild(item.jobName, { BRANCH: branch });
          historyProvider.addEntry(item.jobName, `BRANCH=${branch}`);
          success++;
        } catch {
          failed++;
        }
      }
    }
  );

  vscode.window.showInformationMessage(`BuildPilot: ${success} triggered, ${failed} failed → ${branch}`);

  if (vscode.workspace.getConfiguration('buildpilot').get('slackNotify') && slackService.isConnected()) {
    const jobList = picked.map(p => p.jobName).join(', ');
    await slackService.notify(`🚀 Batch: ${success}/${picked.length} triggered → \`${branch}\`\nJobs: ${jobList}`);
  }
}

async function cancelBuild() {
  if (!jenkinsService.isLoggedIn()) {
    vscode.window.showErrorMessage('BuildPilot: Login first.');
    return;
  }

  const items = buildJobQuickPickItems();
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select job to cancel...',
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!picked || !picked.jobName) return;

  try {
    const lastBuild = await jenkinsService.getLastBuildNumber(picked.jobName);
    if (!lastBuild) {
      vscode.window.showWarningMessage(`BuildPilot: No builds found for ${picked.jobName}`);
      return;
    }
    if (!lastBuild.building) {
      vscode.window.showWarningMessage(`BuildPilot: ${picked.jobName} #${lastBuild.number} is not running.`);
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Cancel ${picked.jobName} #${lastBuild.number}?`, { modal: true }, 'Yes, Cancel'
    );
    if (confirm !== 'Yes, Cancel') return;

    await jenkinsService.cancelBuild(picked.jobName, lastBuild.number);
    vscode.window.showInformationMessage(`⛔ ${picked.jobName} #${lastBuild.number} cancelled.`);
  } catch (err) {
    vscode.window.showErrorMessage(`BuildPilot: Cancel failed - ${err.message}`);
  }
}

async function refreshJobs() {
  if (!jenkinsService.isLoggedIn()) return;
  try {
    await jenkinsService.discoverJobs();
    jobsProvider.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(`BuildPilot: Refresh failed - ${err.message}`);
  }
}

async function connectSlack(context) {
  const clientId = await vscode.window.showInputBox({ prompt: 'Slack App Client ID' });
  if (!clientId) return;
  const clientSecret = await vscode.window.showInputBox({ prompt: 'Slack App Client Secret', password: true });
  if (!clientSecret) return;

  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'BuildPilot: Connecting Slack...' }, async () => {
      await slackService.login(clientId, clientSecret);
    });
    vscode.window.showInformationMessage('BuildPilot: Slack connected!');
  } catch (err) {
    vscode.window.showErrorMessage(`BuildPilot: Slack login failed - ${err.message}`);
  }
}

async function logout() {
  jenkinsService.logout();
  slackService.logout();
  jobsProvider.refresh();
  historyProvider.clear();
  vscode.window.showInformationMessage('BuildPilot: Logged out.');
}

async function showBuildSummary(context, jobName, params) {
  if (!jenkinsService.isLoggedIn()) {
    vscode.window.showErrorMessage('BuildPilot: Login first.');
    return;
  }
  const branch = (params || '').replace('BRANCH=', '') || 'unknown';
  BuildSummaryPanel.show(context, jenkinsService, jobName, branch);
}

async function stopBuildFromHistory(item) {
  if (!jenkinsService.isLoggedIn()) {
    vscode.window.showErrorMessage('BuildPilot: Login first.');
    return;
  }
  const jobName = item?.jobName;
  if (!jobName) return;

  try {
    const lastBuild = await jenkinsService.getLastBuildNumber(jobName);
    if (!lastBuild) {
      vscode.window.showWarningMessage(`BuildPilot: No builds found for ${jobName}`);
      return;
    }
    if (!lastBuild.building) {
      vscode.window.showWarningMessage(`BuildPilot: ${jobName} #${lastBuild.number} is not running.`);
      return;
    }
    await jenkinsService.cancelBuild(jobName, lastBuild.number);
    vscode.window.showInformationMessage(`⛔ ${jobName} #${lastBuild.number} stopped.`);
  } catch (err) {
    vscode.window.showErrorMessage(`BuildPilot: Stop failed - ${err.message}`);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
