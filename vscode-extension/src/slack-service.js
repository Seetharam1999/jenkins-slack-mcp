const axios = require('axios');
const express = require('express');
const open = require('open');
const crypto = require('crypto');
const vscode = require('vscode');

class SlackService {
  constructor(context) {
    this.context = context;
    this._config = context.globalState.get('buildpilot.slack', null);
  }

  isConnected() { return !!this._config; }

  async login(clientId, clientSecret) {
    const { botToken, userId } = await this._oauthFlow(clientId, clientSecret);
    this._config = { botToken, userId };
    await this.context.globalState.update('buildpilot.slack', this._config);
    await this.context.secrets.store('buildpilot.slackToken', botToken);
  }

  async notify(message) {
    if (!this._config) return;
    const { botToken, userId } = this._config;
    const openResp = await axios.post('https://slack.com/api/conversations.open', { users: userId }, {
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' }
    });
    if (!openResp.data.ok) throw new Error(openResp.data.error);
    await axios.post('https://slack.com/api/chat.postMessage', { channel: openResp.data.channel.id, text: message }, {
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' }
    });
  }

  logout() {
    this._config = null;
    this.context.globalState.update('buildpilot.slack', undefined);
    this.context.secrets.delete('buildpilot.slackToken');
  }

  _oauthFlow(clientId, clientSecret) {
    return new Promise((resolve, reject) => {
      const app = express();
      const state = crypto.randomBytes(16).toString('hex');
      let server;
      const timeout = setTimeout(() => { server?.close(); reject(new Error('OAuth timed out')); }, 120000);

      app.get('/slack/callback', async (req, res) => {
        try {
          if (req.query.state !== state) { res.status(400).send('Invalid state'); return; }
          if (req.query.error) { res.send(`<h2>❌ ${req.query.error}</h2>`); reject(new Error(req.query.error)); return; }

          const tokenResp = await axios.post('https://slack.com/api/oauth.v2.access', null, {
            params: { client_id: clientId, client_secret: clientSecret, code: req.query.code, redirect_uri: `http://localhost:${server.address().port}/slack/callback` }
          });
          if (!tokenResp.data.ok) { res.send(`<h2>❌ ${tokenResp.data.error}</h2>`); reject(new Error(tokenResp.data.error)); return; }

          res.send('<h2>✅ Slack connected! Close this tab.</h2>');
          clearTimeout(timeout);
          server.close();
          resolve({ botToken: tokenResp.data.access_token, userId: tokenResp.data.authed_user?.id });
        } catch (err) { res.status(500).send(`<h2>❌ ${err.message}</h2>`); clearTimeout(timeout); server.close(); reject(err); }
      });

      server = app.listen(0, () => {
        const port = server.address().port;
        const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=chat:write,users:read,im:write&state=${state}&redirect_uri=${encodeURIComponent(`http://localhost:${port}/slack/callback`)}`;
        open(url);
      });
    });
  }
}

module.exports = { SlackService };
