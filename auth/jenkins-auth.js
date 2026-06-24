const axios = require('axios');
const open = require('open');

async function openJenkinsTokenPage(baseUrl) {
  const tokenUrl = `${baseUrl}/me/configure`;
  await open(tokenUrl);
  return tokenUrl;
}

async function validateAndFetchUser(baseUrl, user, apiToken) {
  const resp = await axios.get(`${baseUrl}/me/api/json`, {
    auth: { username: user, password: apiToken },
  });
  return { fullName: resp.data.fullName, id: resp.data.id };
}

async function fetchAllJobs(baseUrl, user, apiToken) {
  const resp = await axios.get(`${baseUrl}/api/json?tree=jobs[name,url,color,_class]`, {
    auth: { username: user, password: apiToken },
  });
  return resp.data.jobs || [];
}

async function fetchJobParams(baseUrl, user, apiToken, jobPath) {
  try {
    const url = `${baseUrl}${jobPath}/api/json?tree=property[parameterDefinitions[name,type,defaultParameterValue[value],description,choices]]`;
    const resp = await axios.get(url, { auth: { username: user, password: apiToken } });
    const props = resp.data.property || [];
    for (const p of props) {
      if (p.parameterDefinitions) return p.parameterDefinitions;
    }
    return [];
  } catch {
    return [];
  }
}

async function triggerBuild({ baseUrl, user, apiToken, buildToken, jobPath, params }) {
  const url = `${baseUrl}${jobPath}/buildWithParameters`;
  await axios.post(url, null, {
    params: { token: buildToken, cause: 'MCP trigger', ...params },
    auth: { username: user, password: apiToken },
  });
}

module.exports = { openJenkinsTokenPage, validateAndFetchUser, fetchAllJobs, fetchJobParams, triggerBuild };
