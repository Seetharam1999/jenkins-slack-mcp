const axios = require('axios');
const express = require('express');
const open = require('open');
const crypto = require('crypto');

const SCOPES = 'chat:write,users:read,im:write';

async function slackOAuthLogin(clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    throw new Error('Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET environment variables');
  }

  return new Promise((resolve, reject) => {
    const app = express();
    const state = crypto.randomBytes(16).toString('hex');
    let server;

    const timeout = setTimeout(() => {
      server?.close();
      reject(new Error('OAuth timed out after 2 minutes'));
    }, 120000);

    app.get('/slack/callback', async (req, res) => {
      try {
        if (req.query.state !== state) {
          res.status(400).send('Invalid state');
          return;
        }
        if (req.query.error) {
          res.send(`<h2>❌ ${req.query.error}</h2>`);
          reject(new Error(req.query.error));
          return;
        }

        // Exchange code for token
        const tokenResp = await axios.post('https://slack.com/api/oauth.v2.access', null, {
          params: {
            client_id: clientId,
            client_secret: clientSecret,
            code: req.query.code,
            redirect_uri: `http://localhost:${server.address().port}/slack/callback`,
          },
        });

        if (!tokenResp.data.ok) {
          res.send(`<h2>❌ ${tokenResp.data.error}</h2>`);
          reject(new Error(tokenResp.data.error));
          return;
        }

        const { access_token: botToken, authed_user } = tokenResp.data;
        const userId = authed_user?.id;

        res.send('<h2>✅ Slack connected! You can close this tab.</h2>');
        clearTimeout(timeout);
        server.close();
        resolve({ botToken, userId });
      } catch (err) {
        res.status(500).send(`<h2>❌ ${err.message}</h2>`);
        clearTimeout(timeout);
        server.close();
        reject(err);
      }
    });

    server = app.listen(0, () => {
      const port = server.address().port;
      const redirectUri = encodeURIComponent(`http://localhost:${port}/slack/callback`);
      const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${SCOPES}&user_scope=&state=${state}&redirect_uri=${redirectUri}`;
      open(url);
    });
  });
}

async function sendSlackDM(botToken, userId, message) {
  const openResp = await axios.post('https://slack.com/api/conversations.open',
    { users: userId },
    { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' } }
  );
  if (!openResp.data.ok) throw new Error(`Slack DM open failed: ${openResp.data.error}`);

  const msgResp = await axios.post('https://slack.com/api/chat.postMessage',
    { channel: openResp.data.channel.id, text: message },
    { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' } }
  );
  if (!msgResp.data.ok) throw new Error(`Slack message failed: ${msgResp.data.error}`);
}

async function postToChannel(botToken, channel, message) {
  const resp = await axios.post('https://slack.com/api/chat.postMessage',
    { channel, text: message },
    { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' } }
  );
  if (!resp.data.ok) throw new Error(`Slack post failed: ${resp.data.error}`);
}

module.exports = { slackOAuthLogin, sendSlackDM, postToChannel };
