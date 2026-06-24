const https = require('https');
const http = require('http');
const crypto = require('crypto');
const vscode = require('vscode');

function postJson(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request(parsed, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 10000,
    }, (res) => {
      let result = '';
      res.on('data', c => result += c);
      res.on('end', () => { try { resolve(JSON.parse(result)); } catch { resolve(result); } });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

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
    await this.context.globalState.update('buildpilot.slack.meta', { userId });
    await this.context.secrets.store('buildpilot.slackToken', botToken);
  }

  async notify(message) {
    if (!this._config) return;
    const botToken = await this.context.secrets.get('buildpilot.slackToken');
    if (!botToken) return;
    const { userId } = this._config;
    const headers = { Authorization: `Bearer ${botToken}` };
    const openResp = await postJson('https://slack.com/api/conversations.open', { users: userId }, headers);
    if (!openResp.ok) return;
    await postJson('https://slack.com/api/chat.postMessage', { channel: openResp.channel.id, text: message }, headers);
  }

  logout() {
    this._config = null;
    this.context.globalState.update('buildpilot.slack.meta', undefined);
    this.context.secrets.delete('buildpilot.slackToken');
  }

  _oauthFlow(clientId, clientSecret) {
    return new Promise((resolve, reject) => {
      const state = crypto.randomBytes(32).toString('hex');
      let server;
      let done = false;

      const timeout = setTimeout(() => { if (!done) { server?.close(); reject(new Error('OAuth timed out')); } }, 120000);

      // Minimal http server on loopback — no express needed
      server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${server.address().port}`);
        if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

        const qState = url.searchParams.get('state');
        if (!qState || !crypto.timingSafeEqual(Buffer.from(qState), Buffer.from(state))) {
          res.writeHead(400); res.end('Invalid state'); return;
        }

        const code = url.searchParams.get('code');
        if (!code) { res.writeHead(400); res.end('Missing code'); return; }

        // Exchange code for token
        const params = new URLSearchParams({
          client_id: clientId, client_secret: clientSecret, code,
          redirect_uri: `http://localhost:${server.address().port}/callback`
        });

        https.get(`https://slack.com/api/oauth.v2.access?${params}`, (tokenRes) => {
          let data = '';
          tokenRes.on('data', c => data += c);
          tokenRes.on('end', () => {
            done = true; clearTimeout(timeout); server.close();
            try {
              const resp = JSON.parse(data);
              if (!resp.ok) { res.writeHead(200); res.end('Failed'); reject(new Error(resp.error)); return; }
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end('<h2>Slack connected! Close this tab.</h2>');
              resolve({ botToken: resp.access_token, userId: resp.authed_user?.id });
            } catch (e) { res.writeHead(500); res.end('Error'); reject(e); }
          });
        }).on('error', (e) => { done = true; clearTimeout(timeout); server.close(); reject(e); });
      });

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=chat:write,users:read,im:write&state=${state}&redirect_uri=${encodeURIComponent(`http://localhost:${port}/callback`)}`;
        vscode.env.openExternal(vscode.Uri.parse(authUrl));
      });
    });
  }
}

module.exports = { SlackService };
