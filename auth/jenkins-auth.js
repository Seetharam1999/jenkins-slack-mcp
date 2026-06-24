const axios = require('axios');
const open = require('open');
const { URL } = require('url');

// Block private/internal IPs to prevent SSRF
const BLOCKED_HOSTS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^localhost$/i,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function validateBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('Invalid Jenkins URL');
  }

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('Invalid URL format. Must be a valid URL (e.g. https://jenkins.example.com)');
  }

  // Enforce HTTPS in production (allow HTTP only for localhost dev)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP/HTTPS protocols are allowed');
  }

  const hostname = parsed.hostname;

  // Block metadata endpoints and private ranges
  for (const pattern of BLOCKED_HOSTS) {
    if (pattern.test(hostname)) {
      throw new Error('Connection to private/internal networks is not allowed');
    }
  }

  // Block AWS/GCP/Azure metadata endpoints
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    throw new Error('Connection to cloud metadata endpoints is not allowed');
  }

  return parsed.origin; // Returns sanitized URL without path/query
}

function safeAxiosConfig(user, apiToken) {
  return {
    auth: { username: user, password: apiToken },
    timeout: 30000,
    maxRedirects: 3,
    // Prevent credential leakage in redirects
    beforeRedirect: (options) => {
      delete options.auth;
    },
  };
}

async function openJenkinsTokenPage(baseUrl) {
  const validUrl = validateBaseUrl(baseUrl);
  const tokenUrl = `${validUrl}/me/configure`;
  await open(tokenUrl);
  return tokenUrl;
}

async function validateAndFetchUser(baseUrl, user, apiToken) {
  const validUrl = validateBaseUrl(baseUrl);
  const resp = await axios.get(`${validUrl}/me/api/json`, safeAxiosConfig(user, apiToken));
  return { fullName: resp.data.fullName, id: resp.data.id };
}

async function fetchAllJobs(baseUrl, user, apiToken) {
  const validUrl = validateBaseUrl(baseUrl);
  const resp = await axios.get(
    `${validUrl}/api/json?tree=jobs[name,url,color,_class]`,
    safeAxiosConfig(user, apiToken)
  );
  return resp.data.jobs || [];
}

async function fetchJobParams(baseUrl, user, apiToken, jobPath) {
  const validUrl = validateBaseUrl(baseUrl);
  try {
    const url = `${validUrl}${jobPath}/api/json?tree=property[parameterDefinitions[name,type,defaultParameterValue[value],description,choices]]`;
    const resp = await axios.get(url, safeAxiosConfig(user, apiToken));
    const props = resp.data.property || [];
    for (const p of props) {
      if (p.parameterDefinitions) return p.parameterDefinitions;
    }
    return [];
  } catch {
    return [];
  }
}

// Allowlist of safe parameter name characters
function sanitizeParams(params) {
  const sanitized = {};
  const PARAM_NAME_REGEX = /^[a-zA-Z0-9_\-.]+$/;
  const RESERVED_KEYS = ['token', 'cause', 'json', 'submit'];

  for (const [key, value] of Object.entries(params)) {
    if (!PARAM_NAME_REGEX.test(key)) {
      throw new Error(`Invalid parameter name: "${key}". Only alphanumeric, underscore, hyphen, and dot are allowed.`);
    }
    if (RESERVED_KEYS.includes(key.toLowerCase())) {
      throw new Error(`Parameter name "${key}" is reserved and cannot be used.`);
    }
    // Limit value length to prevent abuse
    if (typeof value === 'string' && value.length > 1000) {
      throw new Error(`Parameter "${key}" value exceeds maximum length (1000 chars).`);
    }
    sanitized[key] = value;
  }
  return sanitized;
}

async function triggerBuild({ baseUrl, user, apiToken, buildToken, jobPath, params }) {
  const validUrl = validateBaseUrl(baseUrl);
  const sanitizedParams = sanitizeParams(params || {});
  const url = `${validUrl}${jobPath}/buildWithParameters`;
  await axios.post(url, null, {
    params: { token: buildToken, cause: 'BuildPilot', ...sanitizedParams },
    ...safeAxiosConfig(user, apiToken),
  });
}

module.exports = { openJenkinsTokenPage, validateAndFetchUser, fetchAllJobs, fetchJobParams, triggerBuild, validateBaseUrl, sanitizeParams };
