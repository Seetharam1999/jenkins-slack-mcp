const express = require('express');
const { getCredentials, getJobs } = require('./auth/credentials');
const { triggerBuild } = require('./auth/jenkins-auth');

const app = express();
app.use(express.urlencoded({ extended: true }));

app.post('/slack/command', async (req, res) => {
  const { command, text, user_name } = req.body;
  const branch = text.trim() || undefined;
  const creds = getCredentials();
  const jobs = getJobs();

  if (!creds.jenkins) return res.json({ text: '❌ Jenkins not configured. Run MCP login_jenkins first.' });

  const job = jobs[command];
  if (!job) return res.json({ text: `❌ Unknown job: ${command}` });

  const branchName = branch || job.defaultBranch;

  try {
    await triggerBuild({
      baseUrl: creds.jenkins.baseUrl,
      user: creds.jenkins.user,
      apiToken: creds.jenkins.apiToken,
      buildToken: creds.jenkins.buildToken,
      jobPath: job.path,
      branch: branchName,
    });
    res.json({ response_type: 'in_channel', text: `✅ *${job.name}* build triggered on \`${branchName}\` by @${user_name}` });
  } catch (err) {
    res.json({ response_type: 'ephemeral', text: `❌ Failed: ${err.message}` });
  }
});

app.get('/health', (_, res) => res.send('ok'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Slack command server on port ${PORT}`));
