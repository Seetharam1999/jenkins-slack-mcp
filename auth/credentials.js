const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.jenkins-slack-mcp');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { mode: 0o700 });
}

function loadConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function getCredentials() {
  const config = loadConfig();
  return {
    jenkins: config.jenkins || null,
    slack: config.slack || null,
  };
}

function saveJenkinsCredentials({ baseUrl, user, apiToken, buildToken }) {
  const config = loadConfig();
  config.jenkins = { baseUrl, user, apiToken, buildToken };
  saveConfig(config);
}

function saveSlackCredentials({ botToken, userToken, teamName, userName }) {
  const config = loadConfig();
  config.slack = { botToken, userToken, teamName, userName };
  saveConfig(config);
}

function saveJobs(jobs) {
  const config = loadConfig();
  config.jobs = jobs;
  saveConfig(config);
}

function getJobs() {
  const config = loadConfig();
  return config.jobs || {};
}

function isConfigured() {
  const creds = getCredentials();
  return !!(creds.jenkins && creds.slack);
}

function clearAll() {
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
}

module.exports = { getCredentials, saveJenkinsCredentials, saveSlackCredentials, saveJobs, getJobs, isConfigured, clearAll };
