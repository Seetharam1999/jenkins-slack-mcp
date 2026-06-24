const axios = require('axios');
const express = require('express');
const open = require('open');
const crypto = require('crypto');

const SCOPES = 'chat:write,users:read,im:write';
const OAUTH_TIMEOUT_MS = 120000;
const MAX_CALLBACK_ATTEMPTS = 5;

async function slackOAuthLogin(clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    throw new Error('Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET environment variables');
  }

  return new Promise((resolve, reject) => {
    const app = express();
    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    let server;
    let callbackAttempts = 0;

    const timeout = setTimeout(() => {
      server?.close();
      reject(new Error('OAuth timed out after 2 minutes'));
    }, OAUTH_TIMEOUT_MS);

    // Rate limit callback attempts
    app.use('/slack/callback', (req, res, next) => {
      callbackAttempts++;
      if (callbackAttempts > MAX_CALLBACK_ATTEMPTS) {
        res.status(429).send('Too many requests');
        return;
      }
      next();
    });

    app.get('/slack/callback', async (req, res) => {
      try {
        // Validate state to prevent CSRF
        if (!req.query.state || !crypto.timingSafeEqual(
          Buffer.from(req.query.state, 'utf8'),
          Buffer.from(state, 'utf8')
        )) {
          res.status(400).send('<h2>&#10060; Invalid state parameter</h2>');
          return;
        }

        if (req.query.error) {
          const safeError = String(req.query.error).slice(0, 100).replace(/[<>"'&]/g, '');
          res.send(`<h2>&#10060; ${safeError}</h2>`);
          reject(new Error(req.query.error));
          return;
        }

        if (!req.query.code) {
          res.status(400).send('<h2>&#10060; Missing authorization code</h2>');
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
          timeout: 10000,
        });

        if (!tokenResp.data.ok) {
          const error = String(tokenResp.data.error || 'unknown').slice(0, 100);
          res.send(`<h2>&#10060; ${error}</h2>`);
          reject(new Error(error));
          return;
        }

        const { access_token: botToken, authed_user } = tokenResp.data;
        const userId = authed_user?.id;

        if (!botToken || !userId) {
          res.send('<h2>&#10060; Missing token or user ID in response</h2>');
          reject(new Error('Incomplete OAuth response'));
          return;
        }

        res.send('<h2>&#9989; Slack connected! You can close this tab.</h2><script>window.close()</script>');
        clearTimeout(timeout);
        server.close();
        resolve({ botToken, userId });
      } catch (err) {
        res.status(500).send('<h2>&#10060; Authentication failed</h2>');
        clearTimeout(timeout);
        server.close();
        reject(new Error('Slack OAuth exchange failed'));
      }
    });

    // Reject all other routes
    app.use((req, res) => { res.status(404).end(); });

    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = encodeURIComponent(`http://localhost:${port}/slack/callback`);
      const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${SCOPES}&user_scope=&state=${state}&redirect_uri=${redirectUri}`;
      open(url);
    });

    // Bind only to loopback
    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start OAuth server: ${err.message}`));
    });
  });
}

async function sendSlackDM(botToken, userId, message) {
  if (!botToken || !userId || !message) {
    throw new Error('Missing required parameters for Slack DM');
  }

  const openResp = await axios.post('https://slack.com/api/conversations.open',
    { users: userId },
    { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
  );
  if (!openResp.data.ok) throw new Error(`Slack DM open failed: ${openResp.data.error}`);

  const msgResp = await axios.post('https://slack.com/api/chat.postMessage',
    { channel: openResp.data.channel.id, text: message },
    { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
  );
  if (!msgResp.data.ok) throw new Error(`Slack message failed: ${msgResp.data.error}`);
}

async function postToChannel(botToken, channel, message) {
  if (!botToken || !channel || !message) {
    throw new Error('Missing required parameters for channel post');
  }

  // Validate channel format (ID or #name)
  if (!/^[#@]?[a-zA-Z0-9_\-]+$/.test(channel) && !/^[A-Z0-9]+$/.test(channel)) {
    throw new Error('Invalid channel format');
  }

  const resp = await axios.post('https://slack.com/api/chat.postMessage',
    { channel, text: message },
    { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
  );
  if (!resp.data.ok) throw new Error(`Slack post failed: ${resp.data.error}`);
}

module.exports = { slackOAuthLogin, sendSlackDM, postToChannel };
