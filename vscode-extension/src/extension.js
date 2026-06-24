const vscode = require('vscode');
const { JenkinsService } = require('./jenkins-service');
const { SlackService } = require('./slack-service');
const { JobsTreeProvider } = require('./jobs-tree-provider');
const { HistoryTreeProvider } = require('./history-tree-provider');

let jenkinsService;
let slackService;
let jobsProvider;
let historyProvider;

function activate(context) {
  jenkinsService = new JenkinsService(context);
  slackService = new SlackService(context);
  jobsProvider = new JobsTreeProvider(jenkinsService);
  historyProvider = new HistoryTreeProvider(context);

  vscode.window.registerTreeDataProvider('buildpilot.jobs', jobsProvider);
  vscode.window.registerTreeDataProvider('buildpilot.history', historyProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('buildpilot.login', () => loginJenkins(context)),
    vscode.commands.registerCommand('buildpilot.triggerBuild', (item) => triggerBuild(item, context)),
    vscode.commands.registerCommand('buildpilot.refreshJobs', () => refreshJobs()),
    vscode.commands.registerCommand('buildpilot.connectSlack', () => connectSlack(context)),
    vscode.commands.registerCommand('buildpilot.logout', () => logout(context))
  );

  // Show login prompt if not configured
  if (!jenkinsService.isLoggedIn()) {
    vscode.window.showInformationMessage('BuildPilot: Connect to Jenkins to get started.', 'Login').then(choice => {
      if (choice === 'Login') vscode.commands.executeCommand('buildpilot.login');
    });
  } else {
    refreshJobs();
  }
}

async function loginJenkins(context) {
  const baseUrl = await vscode.window.showInputBox({ prompt: 'Jenkins Base URL', placeHolder: 'https://jenkins.example.com', value: vscode.workspace.getConfiguration('buildpilot').get('jenkinsUrl') || '' });
  if (!baseUrl) return;

  const user = await vscode.window.showInputBox({ prompt: 'Jenkins Username' });
  if (!user) return;

  const apiToken = await vscode.window.showInputBox({ prompt: 'Jenkins API Token (Jenkins → User → Configure → API Token)', password: true });
  if (!apiToken) return;

  const buildToken = await vscode.window.showInputBox({ prompt: 'Remote Build Trigger Token (optional)', password: true });

  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'BuildPilot: Connecting to Jenkins...' }, async () => {
      await jenkinsService.login(baseUrl, user, apiToken, buildToken || '');
      await jenkinsService.discoverJobs();
    });
    vscode.workspace.getConfiguration('buildpilot').update('jenkinsUrl', baseUrl, true);
    jobsProvider.refresh();
    vscode.window.showInformationMessage(`BuildPilot: Connected as ${user}!`);
  } catch (err) {
    vscode.window.showErrorMessage(`BuildPilot: Login failed - ${err.message}`);
  }
}

async function triggerBuild(item, context) {
  let jobName;
  if (item?.jobName) {
    jobName = item.jobName;
  } else {
    const jobs = jenkinsService.getJobs();
    const picked = await vscode.window.showQuickPick(Object.keys(jobs), { placeHolder: 'Select a job to build' });
    if (!picked) return;
    jobName = picked;
  }

  // Fetch params for this job
  const params = await jenkinsService.getJobParams(jobName);
  const buildParams = {};

  for (const p of params) {
    if (p.choices && p.choices.length > 0) {
      const val = await vscode.window.showQuickPick(p.choices, { placeHolder: `${p.name} (${p.description || ''})` });
      if (val) buildParams[p.name] = val;
    } else {
      const val = await vscode.window.showInputBox({
        prompt: `${p.name}${p.description ? ' - ' + p.description : ''}`,
        value: p.defaultParameterValue?.value || ''
      });
      if (val !== undefined) buildParams[p.name] = val;
    }
  }

  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `BuildPilot: Triggering ${jobName}...` }, async () => {
      await jenkinsService.triggerBuild(jobName, buildParams);
    });

    const paramStr = Object.entries(buildParams).map(([k, v]) => `${k}=${v}`).join(', ') || 'defaults';
    historyProvider.addEntry(jobName, paramStr);
    vscode.window.showInformationMessage(`✅ ${jobName} triggered (${paramStr})`);

    // Slack notification
    const config = vscode.workspace.getConfiguration('buildpilot');
    if (config.get('slackNotify') && slackService.isConnected()) {
      await slackService.notify(`🚀 *${jobName}* triggered (${paramStr})`);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`BuildPilot: Build failed - ${err.message}`);
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
    vscode.window.showInformationMessage('BuildPilot: Slack connected! You\'ll get DM notifications on builds.');
  } catch (err) {
    vscode.window.showErrorMessage(`BuildPilot: Slack login failed - ${err.message}`);
  }
}

async function logout(context) {
  jenkinsService.logout();
  slackService.logout();
  jobsProvider.refresh();
  historyProvider.clear();
  vscode.window.showInformationMessage('BuildPilot: Logged out.');
}

function deactivate() {}

module.exports = { activate, deactivate };
