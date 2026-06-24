const axios = require('axios');
const express = require('express');
const open = require('open');
const crypto = require('crypto');
const vscode = require('vscode');

const OAUTH_TIMEOUT_MS = 120000;
const MAX_CALLBACK_ATTEMPTS = 5;

class SlackService {
  constructor(context) {
    this.context = context;
    this._config = context.globalState.get('buildpilot.slack.meta', null);
  }

  isConnected() { return !!this._config; }

  async login(clientId, clientSecret) {
    if (!clientId || !clientSecret) throw new Error('Client ID and Secret are required');
    const { botToken, userId } = await this._oauthFlow(clientId, clientSecret);
    this._config = { userId };
    // Store only non-sensitive metadata in globalState
    await this.context.globalState.update('buildpilot.slack.meta', { userId });
    // Store token in secrets API
    await this.context.secrets.store('buildpilot.slackToken', botToken);
  }

  async notify(message) {
    if (!this._config) return;
    const botToken = await this.context.secrets.get('buildpilot.slackToken');
    if (!botToken) return;

    const { userId } = this._config;
    const openResp = await axios.post('https://slack.com/api/conversations.open',
      { users: userId },
      { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    if (!openResp.data.ok) throw new Error(openResp.data.error);
    await axios.post('https://slack.com/api/chat.postMessage',
      { channel: openResp.data.channel.id, text: message },
      { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
  }

  logout() {
    this._config = null;
    this.context.globalState.update('buildpilot.slack.meta', undefined);
    this.context.secrets.delete('buildpilot.slackToken');
  }

  _oauthFlow(clientId, clientSecret) {
    return new Promise((resolve, reject) => {
      const app = express();
      const state = crypto.randomBytes(32).toString('hex');
      let server;
      let callbackAttempts = 0;

      const timeout = setTimeout(() => { server?.close(); reject(new Error('OAuth timed out')); }, OAUTH_TIMEOUT_MS);

      // Rate limit
      app.use('/slack/callback', (req, res, next) => {
        callbackAttempts++;
        if (callbackAttempts > MAX_CALLBACK_ATTEMPTS) { res.status(429).end(); return; }
        next();
      });

      app.get('/slack/callback', async (req, res) => {
        try {
          // Timing-safe state comparison
          if (!req.query.state || !crypto.timingSafeEqual(
            Buffer.from(req.query.state, 'utf8'),
            Buffer.from(state, 'utf8')
          )) {
            res.status(400).send('Invalid state');
            return;
          }

          if (req.query.error) {
            res.send('<h2>Authentication denied</h2>');
            reject(new Error(String(req.query.error).slice(0, 100)));
            return;
          }

          if (!req.query.code) {
            res.status(400).send('Missing code');
            return;
          }

          const tokenResp = await axios.post('https://slack.com/api/oauth.v2.access', null, {
            params: {
              client_id: clientId,
              client_secret: clientSecret,
              code: req.query.code,
              redirect_uri: `http://localhost:${server.address().port}/slack/callback`
            },
            timeout: 10000,
          });

          if (!tokenResp.data.ok) {
            res.send('<h2>Token exchange failed</h2>');
            reject(new Error(tokenResp.data.error || 'Token exchange failed'));
            return;
          }

          res.send('<h2>Slack connected! Close this tab.</h2><script>window.close()</script>');
          clearTimeout(timeout);
          server.close();
          resolve({ botToken: tokenResp.data.access_token, userId: tokenResp.data.authed_user?.id });
        } catch (err) {
          res.status(500).send('<h2>Authentication failed</h2>');
          clearTimeout(timeout);
          server.close();
          reject(new Error('OAuth exchange failed'));
        }
      });

      // Reject all other routes
      app.use((req, res) => { res.status(404).end(); });

      // Bind to loopback only
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=chat:write,users:read,im:write&state=${state}&redirect_uri=${encodeURIComponent(`http://localhost:${port}/slack/callback`)}`;
        open(url);
      });
    });
  }
}

module.exports = { SlackService };
