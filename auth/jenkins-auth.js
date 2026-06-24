const axios = require('axios');

async function validateAndFetchUser(baseUrl, user, apiToken) {
  const resp = await axios.get(`${baseUrl}/me/api/json`, {
    auth: { username: user, password: apiToken },
  });
  return { fullName: resp.data.fullName, id: resp.data.id };
}

async function fetchJobs(baseUrl, user, apiToken) {
  const resp = await axios.get(`${baseUrl}/api/json?tree=jobs[name,url,color]`, {
    auth: { username: user, password: apiToken },
  });
  return resp.data.jobs || [];
}

async function triggerBuild({ baseUrl, user, apiToken, buildToken, jobPath, branch }) {
  const url = `${baseUrl}${jobPath}/buildWithParameters`;
  await axios.post(url, null, {
    params: { token: buildToken, BRANCH: branch, cause: `MCP trigger for ${branch}` },
    auth: { username: user, password: apiToken },
  });
}

module.exports = { validateAndFetchUser, fetchJobs, triggerBuild };
