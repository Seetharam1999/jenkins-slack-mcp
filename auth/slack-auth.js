const axios = require('axios');

async function sendSlackDM(botToken, userId, message) {
  // Open DM channel with user
  const openResp = await axios.post('https://slack.com/api/conversations.open', 
    { users: userId },
    { headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' } }
  );
  
  if (!openResp.data.ok) throw new Error(`Slack DM open failed: ${openResp.data.error}`);
  
  const channelId = openResp.data.channel.id;
  
  // Send message
  const msgResp = await axios.post('https://slack.com/api/chat.postMessage',
    { channel: channelId, text: message },
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

module.exports = { sendSlackDM, postToChannel };
