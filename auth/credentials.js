const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CONFIG_DIR = path.join(os.homedir(), '.jenkins-slack-mcp');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.enc');
const ALGORITHM = 'aes-256-gcm';

// Derive a machine-bound key from hostname + username (not perfect, but better than plaintext)
function getDerivedKey() {
  const seed = `buildpilot:${os.hostname()}:${os.userInfo().username}:${os.homedir()}`;
  return crypto.createHash('sha256').update(seed).digest();
}

function ensureConfigDir() {
  try {
    fs.mkdirSync(CONFIG_DIR, { mode: 0o700, recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  // Ensure permissions even if dir already exists
  try { fs.chmodSync(CONFIG_DIR, 0o700); } catch {}
}

function encrypt(data) {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const json = JSON.stringify(data);
  let encrypted = cipher.update(json, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return JSON.stringify({ iv: iv.toString('hex'), tag: tag.toString('hex'), data: encrypted });
}

function decrypt(raw) {
  const key = getDerivedKey();
  const { iv, tag, data } = JSON.parse(raw);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

function loadConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return decrypt(raw);
  } catch {
    // If decryption fails (corrupted/tampered), wipe and start fresh
    try { fs.unlinkSync(CONFIG_FILE); } catch {}
    return {};
  }
}

function saveConfig(config) {
  ensureConfigDir();
  const encrypted = encrypt(config);
  // Write atomically to avoid race conditions
  const tmpFile = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmpFile, encrypted, { mode: 0o600 });
  fs.renameSync(tmpFile, CONFIG_FILE);
}

function getCredentials() {
  const config = loadConfig();
  return { jenkins: config.jenkins || null, slack: config.slack || null };
}

function saveJenkinsCredentials({ baseUrl, user, apiToken, buildToken }) {
  const config = loadConfig();
  config.jenkins = { baseUrl, user, apiToken, buildToken };
  saveConfig(config);
}

function saveSlackConfig({ botToken, userId }) {
  const config = loadConfig();
  config.slack = { botToken, userId };
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

function clearAll() {
  try { fs.unlinkSync(CONFIG_FILE); } catch {}
  try { fs.unlinkSync(CONFIG_FILE + '.tmp'); } catch {}
}

module.exports = { getCredentials, saveJenkinsCredentials, saveSlackConfig, saveJobs, getJobs, clearAll };
