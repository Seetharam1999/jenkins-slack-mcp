const https = require('https');
const http = require('http');
const { URL } = require('url');
const { exec } = require('child_process');

const BLOCKED_HOSTS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\./, /^localhost$/i, /^::1$/, /^fc00:/i, /^fe80:/i,
];

function validateBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') throw new Error('Invalid Jenkins URL');
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error('Invalid URL format'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Only HTTP/HTTPS allowed');
  for (const p of BLOCKED_HOSTS) { if (p.test(parsed.hostname)) throw new Error('Private/internal networks blocked'); }
  return parsed.origin;
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: opts.timeout || 15000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400 && res.statusCode !== 201) reject(new Error(`HTTP ${res.statusCode}`));
        else { try { resolve(JSON.parse(data)); } catch { resolve(data); } }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    if (opts.method === 'POST') req.end();
    else req.end();
  });
}

function authHeaders(user, apiToken) {
  return { Authorization: 'Basic ' + Buffer.from(`${user}:${apiToken}`).toString('base64') };
}

function openUrl(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

// --- Parameter validation ---
const PARAM_NAME_REGEX = /^[a-zA-Z0-9_\-.]+$/;
const RESERVED_KEYS = ['token', 'cause', 'json', 'submit'];

function sanitizeParams(params) {
  const sanitized = {};
  for (const [key, value] of Object.entries(params)) {
    if (!PARAM_NAME_REGEX.test(key)) throw new Error(`Invalid parameter name: "${key}"`);
    if (RESERVED_KEYS.includes(key.toLowerCase())) throw new Error(`Parameter "${key}" is reserved`);
    if (typeof value === 'string' && value.length > 1000) throw new Error(`Parameter "${key}" value too long`);
    sanitized[key] = value;
  }
  return sanitized;
}

async function openJenkinsTokenPage(baseUrl) {
  const validUrl = validateBaseUrl(baseUrl);
  const tokenUrl = `${validUrl}/me/configure`;
  openUrl(tokenUrl);
  return tokenUrl;
}

async function validateAndFetchUser(baseUrl, user, apiToken) {
  const validUrl = validateBaseUrl(baseUrl);
  const resp = await request(`${validUrl}/me/api/json`, { headers: authHeaders(user, apiToken) });
  return { fullName: resp.fullName, id: resp.id };
}

async function fetchAllJobs(baseUrl, user, apiToken) {
  const validUrl = validateBaseUrl(baseUrl);
  const resp = await request(`${validUrl}/api/json?tree=jobs[name,url,color,_class]`, { headers: authHeaders(user, apiToken), timeout: 30000 });
  return resp.jobs || [];
}

async function fetchJobParams(baseUrl, user, apiToken, jobPath) {
  const validUrl = validateBaseUrl(baseUrl);
  try {
    const resp = await request(`${validUrl}${jobPath}/api/json?tree=property[parameterDefinitions[name,type,defaultParameterValue[value],description,choices]]`, { headers: authHeaders(user, apiToken) });
    const props = resp.property || [];
    for (const p of props) { if (p.parameterDefinitions) return p.parameterDefinitions; }
    return [];
  } catch { return []; }
}

async function triggerBuild({ baseUrl, user, apiToken, buildToken, jobPath, params }) {
  const validUrl = validateBaseUrl(baseUrl);
  const sanitized = sanitizeParams(params || {});
  const qs = new URLSearchParams({ token: buildToken, cause: 'BuildPilot', ...sanitized }).toString();
  await request(`${validUrl}${jobPath}/buildWithParameters?${qs}`, { method: 'POST', headers: authHeaders(user, apiToken) });
}

module.exports = { openJenkinsTokenPage, validateAndFetchUser, fetchAllJobs, fetchJobParams, triggerBuild, validateBaseUrl, sanitizeParams };
