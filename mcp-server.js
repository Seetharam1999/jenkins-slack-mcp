#!/usr/bin/env node
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { getCredentials, saveJenkinsCredentials, saveSlackConfig, saveJobs, getJobs, clearAll } = require('./auth/credentials');
const { openJenkinsTokenPage, validateAndFetchUser, fetchAllJobs, fetchJobParams, triggerBuild } = require('./auth/jenkins-auth');
const { sendSlackDM, postToChannel } = require('./auth/slack-auth');

const server = new Server({ name: 'jenkins-slack-mcp', version: '1.0.4' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'login_jenkins',
      description: 'Login to Jenkins. Opens browser to Jenkins token page for new users. Validates credentials and auto-discovers all jobs.',
      inputSchema: {
        type: 'object',
        properties: {
          baseUrl: { type: 'string', description: 'Jenkins base URL (e.g. https://jenkins.example.com)' },
          user: { type: 'string', description: 'Jenkins username' },
          apiToken: { type: 'string', description: 'Jenkins API token (get from Jenkins → User → Configure → API Token)' },
          buildToken: { type: 'string', description: 'Remote build trigger token' },
        },
        required: ['baseUrl'],
      },
    },
    {
      name: 'setup_slack',
      description: 'Configure Slack notifications. Set bot token and your Slack User ID to receive DMs on build trigger.',
      inputSchema: {
        type: 'object',
        properties: {
          botToken: { type: 'string', description: 'Slack Bot OAuth Token (xoxb-...)' },
          userId: { type: 'string', description: 'Your Slack User ID (found in Profile → ... → Copy Member ID)' },
        },
        required: ['botToken', 'userId'],
      },
    },
    {
      name: 'status',
      description: 'Check current login status for Jenkins and Slack',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_jobs',
      description: 'List all available Jenkins jobs in table format with status. Supports filtering by name.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Filter jobs by name (e.g. "tms", "optima")' },
        },
      },
    },
    {
      name: 'job_details',
      description: 'Get build parameters for a specific Jenkins job in table format.',
      inputSchema: {
        type: 'object',
        properties: {
          jobName: { type: 'string', description: 'Jenkins job name (e.g. tms-docker-build-new)' },
        },
        required: ['jobName'],
      },
    },
    {
      name: 'trigger_build',
      description: 'Trigger a Jenkins build with parameters. Sends Slack DM if configured.',
      inputSchema: {
        type: 'object',
        properties: {
          jobName: { type: 'string', description: 'Jenkins job name' },
          params: { type: 'object', description: 'Build parameters as key-value pairs (e.g. {"BRANCH": "main"})' },
          notifyChannel: { type: 'string', description: 'Slack channel to notify (optional, e.g. #deployments)' },
        },
        required: ['jobName'],
      },
    },
    {
      name: 'refresh_jobs',
      description: 'Re-fetch all jobs from Jenkins (use after new jobs are created)',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'whoami',
      description: 'Get current Jenkins and Slack user details',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'logout',
      description: 'Clear all stored credentials and jobs',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'login_jenkins': {
        // If only baseUrl provided, open browser for user to get token
        if (!args.user || !args.apiToken) {
          const tokenUrl = await openJenkinsTokenPage(args.baseUrl);
          return text(
            `🌐 Opening Jenkins in your browser...\n\n` +
            `**Steps to get your credentials:**\n` +
            `1. Login at: ${args.baseUrl}\n` +
            `2. Go to: ${tokenUrl}\n` +
            `3. Under "API Token" → Click "Add new Token" → Generate\n` +
            `4. Copy the token\n` +
            `5. For build trigger token: Go to Job → Configure → Build Triggers → "Trigger builds remotely" → Copy token\n\n` +
            `Then call login_jenkins again with all 4 parameters:\n` +
            `- baseUrl: ${args.baseUrl}\n` +
            `- user: your_username\n` +
            `- apiToken: (the token you just generated)\n` +
            `- buildToken: (the remote trigger token)`
          );
        }

        // Validate credentials
        const userInfo = await validateAndFetchUser(args.baseUrl, args.user, args.apiToken);
        saveJenkinsCredentials(args);

        // Auto-discover all jobs
        const allJobs = await fetchAllJobs(args.baseUrl, args.user, args.apiToken);
        const buildableJobs = {};
        for (const j of allJobs) {
          if (j._class === 'com.cloudbees.hudson.plugins.folder.Folder') continue;
          buildableJobs[j.name] = { path: `/job/${encodeURIComponent(j.name)}`, name: j.name, color: j.color || 'unknown' };
        }
        saveJobs(buildableJobs);

        const jobCount = Object.keys(buildableJobs).length;
        let msg = `✅ Jenkins login successful! Welcome, ${userInfo.fullName}\n`;
        msg += `📋 Auto-discovered ${jobCount} jobs.\n\n`;
        msg += `Use **list_jobs** to see all jobs or **list_jobs filter="tms"** to search.\n`;
        msg += `Use **job_details** to see parameters before triggering.`;

        const creds = getCredentials();
        if (!creds.slack) {
          msg += `\n\n💡 Set up Slack notifications with **setup_slack** to get DMs on build trigger.`;
        }
        return text(msg);
      }

      case 'setup_slack': {
        saveSlackConfig({ botToken: args.botToken, userId: args.userId });

        // Test by sending a welcome DM
        try {
          await sendSlackDM(args.botToken, args.userId, '✅ Jenkins-Slack MCP connected! You will receive build notifications here.');
          return text(`✅ Slack configured!\n- User ID: ${args.userId}\n- ✉️ Test DM sent to you successfully.`);
        } catch (err) {
          return text(`⚠️ Slack config saved but test DM failed: ${err.message}\nCheck your bot token and user ID.`);
        }
      }

      case 'status': {
        const creds = getCredentials();
        const jobCount = Object.keys(getJobs()).length;
        const jenkins = creds.jenkins
          ? `✅ Jenkins: ${creds.jenkins.user} @ ${creds.jenkins.baseUrl}`
          : '❌ Jenkins: not logged in. Use **login_jenkins** to connect.';
        const slack = creds.slack
          ? `✅ Slack: User ID ${creds.slack.userId} (DM notifications enabled)`
          : '❌ Slack: not configured. Use **setup_slack** to enable notifications.';
        return text(`${jenkins}\n${slack}\n📋 Jobs available: ${jobCount}`);
      }

      case 'list_jobs': {
        const creds = getCredentials();
        if (!creds.jenkins) return text('❌ Not logged into Jenkins. Use **login_jenkins** first.');

        const jobs = getJobs();
        if (!Object.keys(jobs).length) return text('No jobs found. Use **refresh_jobs** to re-fetch.');

        let filtered = Object.entries(jobs);
        if (args.filter) {
          const f = args.filter.toLowerCase();
          filtered = filtered.filter(([n]) => n.toLowerCase().includes(f));
        }

        if (!filtered.length) return text(`No jobs matching "${args.filter}".`);

        let table = `| # | Job Name | Status |\n|---|----------|--------|\n`;
        filtered.slice(0, 50).forEach(([, job], i) => {
          const status = job.color === 'blue' ? '✅ Success' : job.color === 'red' ? '❌ Failed' : job.color === 'disabled' ? '⏸️ Disabled' : job.color === 'notbuilt' ? '⬜ Not built' : `⚠️ ${job.color}`;
          table += `| ${i + 1} | ${job.name} | ${status} |\n`;
        });

        if (filtered.length > 50) table += `\n_...${filtered.length - 50} more. Narrow with filter._`;
        table += `\n\nUse **job_details jobName="<name>"** to see parameters.`;
        return text(table);
      }

      case 'job_details': {
        const creds = getCredentials();
        if (!creds.jenkins) return text('❌ Not logged into Jenkins. Use **login_jenkins** first.');

        const jobs = getJobs();
        const job = jobs[args.jobName];
        if (!job) return text(`❌ Job "${args.jobName}" not found. Use **list_jobs** to see available jobs.`);

        const params = await fetchJobParams(creds.jenkins.baseUrl, creds.jenkins.user, creds.jenkins.apiToken, job.path);

        let msg = `## ${job.name}\n`;
        msg += `**Status:** ${job.color === 'blue' ? '✅ Success' : job.color === 'red' ? '❌ Failed' : job.color}\n\n`;

        if (params.length === 0) {
          msg += `**Parameters:** None required\n`;
          msg += `\n→ Trigger with: **trigger_build jobName="${job.name}"**`;
        } else {
          msg += `| Parameter | Type | Default | Choices | Description |\n|-----------|------|---------|---------|-------------|\n`;
          params.forEach(p => {
            const def = p.defaultParameterValue?.value || '-';
            const type = (p.type || '').replace('ParameterDefinition', '');
            const desc = p.description || '-';
            const choices = p.choices ? p.choices.join(', ') : '-';
            msg += `| ${p.name} | ${type} | ${def} | ${choices} | ${desc} |\n`;
          });
          const example = params.map(p => `"${p.name}": "${p.defaultParameterValue?.value || 'value'}"`).join(', ');
          msg += `\n→ Trigger with: **trigger_build jobName="${job.name}" params={${example}}**`;
        }
        return text(msg);
      }

      case 'trigger_build': {
        const creds = getCredentials();
        if (!creds.jenkins) return text('❌ Not logged into Jenkins. Use **login_jenkins** first.');

        const jobs = getJobs();
        const job = jobs[args.jobName];
        if (!job) return text(`❌ Job "${args.jobName}" not found. Use **list_jobs** to see available jobs.`);

        const params = args.params || {};
        await triggerBuild({
          baseUrl: creds.jenkins.baseUrl,
          user: creds.jenkins.user,
          apiToken: creds.jenkins.apiToken,
          buildToken: creds.jenkins.buildToken,
          jobPath: job.path,
          params,
        });

        const paramStr = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(', ') || 'defaults';
        let msg = `✅ **${job.name}** build triggered (${paramStr})`;

        // Send Slack DM to user
        if (creds.slack?.botToken && creds.slack?.userId) {
          try {
            await sendSlackDM(creds.slack.botToken, creds.slack.userId, `🚀 *${job.name}* build triggered\nParams: ${paramStr}\nTriggered by: ${creds.jenkins.user}`);
            msg += `\n✉️ Slack DM sent to you.`;
          } catch (err) {
            msg += `\n⚠️ Slack DM failed: ${err.message}`;
          }
        }

        // Notify channel if specified
        if (args.notifyChannel && creds.slack?.botToken) {
          try {
            await postToChannel(creds.slack.botToken, args.notifyChannel, `🚀 *${job.name}* build triggered (${paramStr}) by ${creds.jenkins.user}`);
            msg += `\n📢 Posted to ${args.notifyChannel}`;
          } catch (err) {
            msg += `\n⚠️ Channel notify failed: ${err.message}`;
          }
        }

        if (!creds.slack) {
          msg += `\n\n💡 Set up **setup_slack** to get DM notifications on every build.`;
        }

        return text(msg);
      }

      case 'refresh_jobs': {
        const creds = getCredentials();
        if (!creds.jenkins) return text('❌ Not logged into Jenkins. Use **login_jenkins** first.');

        const allJobs = await fetchAllJobs(creds.jenkins.baseUrl, creds.jenkins.user, creds.jenkins.apiToken);
        const buildableJobs = {};
        for (const j of allJobs) {
          if (j._class === 'com.cloudbees.hudson.plugins.folder.Folder') continue;
          buildableJobs[j.name] = { path: `/job/${encodeURIComponent(j.name)}`, name: j.name, color: j.color || 'unknown' };
        }
        saveJobs(buildableJobs);
        return text(`✅ Refreshed! ${Object.keys(buildableJobs).length} jobs discovered.`);
      }

      case 'whoami': {
        const creds = getCredentials();
        const parts = [];
        if (creds.jenkins) {
          const userInfo = await validateAndFetchUser(creds.jenkins.baseUrl, creds.jenkins.user, creds.jenkins.apiToken);
          parts.push(`**Jenkins:** ${userInfo.fullName} (${userInfo.id}) @ ${creds.jenkins.baseUrl}`);
        } else {
          parts.push('**Jenkins:** not logged in');
        }
        if (creds.slack) {
          parts.push(`**Slack:** User ID ${creds.slack.userId} (DM enabled)`);
        } else {
          parts.push('**Slack:** not configured');
        }
        return text(parts.join('\n'));
      }

      case 'logout': {
        clearAll();
        return text('✅ All credentials and jobs cleared.');
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
