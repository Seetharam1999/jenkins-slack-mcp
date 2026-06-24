const express = require('express');
const axios = require('axios');
const open = require('open');
const { saveSlackCredentials } = require('./credentials');

const SLACK_OAUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';

async function slackOAuthFlow({ clientId, clientSecret, scopes, port = 9876 }) {
  return new Promise((resolve, reject) => {
    const app = express();
    const redirectUri = `http://localhost:${port}/slack/callback`;

    const authUrl = `${SLACK_OAUTH_URL}?client_id=${clientId}&scope=${scopes.bot.join(',')}&user_scope=${scopes.user.join(',')}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    app.get('/slack/callback', async (req, res) => {
      const { code, error } = req.query;
      if (error) {
        res.send('❌ Slack auth denied');
        server.close();
        return reject(new Error(error));
      }

      try {
        const resp = await axios.post(SLACK_TOKEN_URL, null, {
          params: { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri },
        });

        const data = resp.data;
        if (!data.ok) throw new Error(data.error);

        const creds = {
          botToken: data.access_token,
          userToken: data.authed_user?.access_token,
          teamName: data.team?.name,
          userName: data.authed_user?.id,
        };

        saveSlackCredentials(creds);
        res.send('✅ Slack connected! You can close this window.');
        server.close();
        resolve(creds);
      } catch (err) {
        res.send(`❌ Error: ${err.message}`);
        server.close();
        reject(err);
      }
    });

    const server = app.listen(port, () => {
      console.error(`Opening Slack OAuth... (listening on port ${port})`);
      open(authUrl);
    });

    setTimeout(() => { server.close(); reject(new Error('OAuth timeout')); }, 120000);
  });
}

async function getSlackUserInfo(token) {
  const resp = await axios.get('https://slack.com/api/auth.test', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.data;
}

async function postToSlack(token, channel, text) {
  await axios.post('https://slack.com/api/chat.postMessage', { channel, text }, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

module.exports = { slackOAuthFlow, getSlackUserInfo, postToSlack };
