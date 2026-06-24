#!/usr/bin/env node
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { getCredentials, saveJenkinsCredentials, saveJobs, getJobs, isConfigured, clearAll } = require('./auth/credentials');
const { validateAndFetchUser, triggerBuild } = require('./auth/jenkins-auth');
const { slackOAuthFlow, getSlackUserInfo, postToSlack } = require('./auth/slack-auth');

const server = new Server({ name: 'jenkins-slack-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'login_jenkins',
      description: 'Login to Jenkins. Validates credentials and stores them securely in ~/.jenkins-slack-mcp/',
      inputSchema: {
        type: 'object',
        properties: {
          baseUrl: { type: 'string', description: 'Jenkins base URL (e.g. https://jenkins.example.com)' },
          user: { type: 'string', description: 'Jenkins username' },
          apiToken: { type: 'string', description: 'Jenkins API token' },
          buildToken: { type: 'string', description: 'Remote build trigger token configured in Jenkins job' },
        },
        required: ['baseUrl', 'user', 'apiToken', 'buildToken'],
      },
    },
    {
      name: 'login_slack',
      description: 'Login to Slack via OAuth. Opens browser for authentication.',
      inputSchema: {
        type: 'object',
        properties: {
          clientId: { type: 'string', description: 'Slack App Client ID' },
          clientSecret: { type: 'string', description: 'Slack App Client Secret' },
        },
        required: ['clientId', 'clientSecret'],
      },
    },
    {
      name: 'status',
      description: 'Check current login status for Jenkins and Slack',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'add_job',
      description: 'Register a Jenkins job that can be triggered',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Trigger command name (e.g. /build-app)' },
          jobPath: { type: 'string', description: 'Jenkins job path (e.g. /job/my-app or /view/my-view/job/my-app)' },
          name: { type: 'string', description: 'Friendly job name' },
          defaultBranch: { type: 'string', description: 'Default branch if none specified' },
        },
        required: ['command', 'jobPath', 'name'],
      },
    },
    {
      name: 'list_jobs',
      description: 'List all registered Jenkins jobs',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'trigger_build',
      description: 'Trigger a Jenkins build and optionally notify Slack',
      inputSchema: {
        type: 'object',
        properties: {
          job: { type: 'string', description: 'Job command (e.g. /build-app) or job name' },
          branch: { type: 'string', description: 'Branch to build' },
          slackChannel: { type: 'string', description: 'Slack channel to notify (optional)' },
        },
        required: ['job'],
      },
    },
    {
      name: 'whoami',
      description: 'Get current Jenkins and Slack user details',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'logout',
      description: 'Clear all stored credentials',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'login_jenkins': {
        const userInfo = await validateAndFetchUser(args.baseUrl, args.user, args.apiToken);
        saveJenkinsCredentials(args);
        return text(`✅ Jenkins login successful! Welcome, ${userInfo.fullName} (${userInfo.id})`);
      }

      case 'login_slack': {
        const creds = await slackOAuthFlow({
          clientId: args.clientId,
          clientSecret: args.clientSecret,
          scopes: {
            bot: ['commands', 'chat:write', 'channels:read'],
            user: ['chat:write'],
          },
        });
        return text(`✅ Slack connected! Team: ${creds.teamName}`);
      }

      case 'status': {
        const creds = getCredentials();
        const jenkins = creds.jenkins ? `✅ Jenkins: ${creds.jenkins.user} @ ${creds.jenkins.baseUrl}` : '❌ Jenkins: not logged in. Use login_jenkins to connect.';
        const slack = creds.slack ? `✅ Slack: ${creds.slack.teamName}` : '❌ Slack: not logged in. Use login_slack to connect.';
        return text(`${jenkins}\n${slack}`);
      }

      case 'add_job': {
        const creds = getCredentials();
        if (!creds.jenkins) return text('❌ Not logged into Jenkins. Use login_jenkins first.');

        const jobs = getJobs();
        jobs[args.command] = { path: args.jobPath, name: args.name, defaultBranch: args.defaultBranch || 'main' };
        saveJobs(jobs);

        let msg = `✅ Job registered: ${args.command} → ${args.name} (default: ${args.defaultBranch || 'main'})`;
        if (!creds.slack) {
          msg += `\n\n💡 Tip: Connect Slack with login_slack to get build notifications in your channels.`;
        }
        return text(msg);
      }

      case 'list_jobs': {
        const jobs = getJobs();
        if (!Object.keys(jobs).length) return text('No jobs configured. Use add_job to register one.');
        const list = Object.entries(jobs).map(([cmd, j]) => `• ${cmd} → ${j.name} (default: ${j.defaultBranch})`).join('\n');
        return text(list);
      }

      case 'trigger_build': {
        const creds = getCredentials();
        if (!creds.jenkins) return text('❌ Not logged into Jenkins. Use login_jenkins first.');

        const jobs = getJobs();
        const job = jobs[args.job];
        if (!job) return text(`❌ Unknown job: ${args.job}. Available: ${Object.keys(jobs).join(', ')}`);

        const branch = args.branch || job.defaultBranch;
        await triggerBuild({
          baseUrl: creds.jenkins.baseUrl,
          user: creds.jenkins.user,
          apiToken: creds.jenkins.apiToken,
          buildToken: creds.jenkins.buildToken,
          jobPath: job.path,
          branch,
        });

        let msg = `✅ *${job.name}* build triggered on \`${branch}\``;

        // Notify Slack if channel provided and logged in
        if (args.slackChannel && creds.slack?.botToken) {
          await postToSlack(creds.slack.botToken, args.slackChannel, `🚀 ${job.name} build triggered on branch: ${branch}`);
          msg += `\n📢 Notified Slack channel: ${args.slackChannel}`;
        } else if (args.slackChannel && !creds.slack) {
          msg += `\n⚠️ Slack not connected. Use login_slack to enable Slack notifications.`;
        }

        // Remind to connect Slack if not logged in
        if (!creds.slack) {
          msg += `\n\n💡 Tip: Connect Slack with login_slack to get build notifications in your channels.`;
        }

        return text(msg);
      }

      case 'whoami': {
        const creds = getCredentials();
        const parts = [];
        if (creds.jenkins) {
          const userInfo = await validateAndFetchUser(creds.jenkins.baseUrl, creds.jenkins.user, creds.jenkins.apiToken);
          parts.push(`Jenkins: ${userInfo.fullName} (${userInfo.id}) @ ${creds.jenkins.baseUrl}`);
        } else {
          parts.push('Jenkins: not logged in');
        }
        if (creds.slack?.botToken) {
          const slackInfo = await getSlackUserInfo(creds.slack.botToken);
          parts.push(`Slack: ${slackInfo.user} @ ${slackInfo.team}`);
        } else {
          parts.push('Slack: not logged in');
        }
        return text(parts.join('\n'));
      }

      case 'logout': {
        clearAll();
        return text('✅ All credentials cleared.');
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `❌ Error: ${err.message}` }], isError: true };
  }
});

function text(msg) {
  return { content: [{ type: 'text', text: msg }] };
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Jenkins-Slack MCP server running');
}

main().catch(console.error);
