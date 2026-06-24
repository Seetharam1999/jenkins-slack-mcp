const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');

const SCOPES = 'chat:write,users:read,im:write';
const OAUTH_TIMEOUT_MS = 120000;
const MAX_CALLBACK_ATTEMPTS = 5;

function openUrl(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

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

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

async function slackOAuthLogin(clientId, clientSecret) {
  if (!clientId || !clientSecret) throw new Error('Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET environment variables');

  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(32).toString('hex');
    let server;
    let callbackAttempts = 0;
    let done = false;

    const timeout = setTimeout(() => { if (!done) { server?.close(); reject(new Error('OAuth timed out')); } }, OAUTH_TIMEOUT_MS);

    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${server.address().port}`);
      if (url.pathname !== '/slack/callback') { res.writeHead(404); res.end(); return; }

      callbackAttempts++;
      if (callbackAttempts > MAX_CALLBACK_ATTEMPTS) { res.writeHead(429); res.end(); return; }

      const qState = url.searchParams.get('state');
      if (!qState || !crypto.timingSafeEqual(Buffer.from(qState), Buffer.from(state))) {
        res.writeHead(400); res.end('Invalid state'); return;
      }

      if (url.searchParams.get('error')) {
        res.writeHead(200); res.end('Authentication denied');
        done = true; clearTimeout(timeout); server.close();
        reject(new Error(url.searchParams.get('error')));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) { res.writeHead(400); res.end('Missing code'); return; }

      const params = new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, code,
        redirect_uri: `http://localhost:${server.address().port}/slack/callback`
      });

      httpsGet(`https://slack.com/api/oauth.v2.access?${params}`).then(resp => {
        done = true; clearTimeout(timeout); server.close();
        if (!resp.ok) { res.writeHead(200); res.end('Failed'); reject(new Error(resp.error || 'Token exchange failed')); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Slack connected! Close this tab.</h2>');
        resolve({ botToken: resp.access_token, userId: resp.authed_user?.id });
      }).catch(e => { done = true; clearTimeout(timeout); server.close(); res.writeHead(500); res.end('Error'); reject(e); });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${SCOPES}&state=${state}&redirect_uri=${encodeURIComponent(`http://localhost:${port}/slack/callback`)}`;
      openUrl(authUrl);
    });
  });
}

async function sendSlackDM(botToken, userId, message) {
  if (!botToken || !userId || !message) throw new Error('Missing required params');
  const headers = { Authorization: `Bearer ${botToken}` };
  const openResp = await postJson('https://slack.com/api/conversations.open', { users: userId }, headers);
  if (!openResp.ok) throw new Error(`Slack DM open failed: ${openResp.error}`);
  const msgResp = await postJson('https://slack.com/api/chat.postMessage', { channel: openResp.channel.id, text: message }, headers);
  if (!msgResp.ok) throw new Error(`Slack message failed: ${msgResp.error}`);
}

async function postToChannel(botToken, channel, message) {
  if (!botToken || !channel || !message) throw new Error('Missing required params');
  if (!/^[#@]?[a-zA-Z0-9_\-]+$/.test(channel) && !/^[A-Z0-9]+$/.test(channel)) throw new Error('Invalid channel format');
  const headers = { Authorization: `Bearer ${botToken}` };
  const resp = await postJson('https://slack.com/api/chat.postMessage', { channel, text: message }, headers);
  if (!resp.ok) throw new Error(`Slack post failed: ${resp.error}`);
}

module.exports = { slackOAuthLogin, sendSlackDM, postToChannel };
