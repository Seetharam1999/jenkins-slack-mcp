# jenkins-slack-mcp

MCP server to trigger Jenkins builds from any IDE (Amazon Q, VS Code, Cursor) with Slack notifications. Zero config — login once and it remembers.

## Global Install (for anyone)

```bash
npm install -g jenkins-slack-mcp
```

Then add to your IDE's MCP config:

**Amazon Q** (`~/.aws/amazonq/mcp.json`):
```json
{
  "mcpServers": {
    "jenkins-slack": {
      "command": "jenkins-slack-mcp",
      "args": [],
      "disabled": false
    }
  }
}
```

**VS Code / Cursor** (`.vscode/mcp.json`):
```json
{
  "mcpServers": {
    "jenkins-slack": {
      "command": "jenkins-slack-mcp"
    }
  }
}
```

## First-time Setup (from IDE chat)

Once the MCP is registered, use these tools from your IDE:

### 1. Login to Jenkins
```
login_jenkins:
  baseUrl: https://your-jenkins.com
  user: your_username
  apiToken: your_api_token
  buildToken: your_remote_trigger_token
```

### 2. Login to Slack
```
login_slack:
  clientId: your_slack_app_client_id
  clientSecret: your_slack_app_client_secret
```
Opens browser → OAuth → done.

### 3. Register Jobs
```
add_job:
  command: /buildtt
  jobPath: /view/track-and-trace/job/track-and-trace
  name: Track & Trace
  defaultBranch: main
```

### 4. Trigger Builds
```
trigger_build:
  job: /buildtt
  branch: feature/my-branch
  slackChannel: #deployments
```

## Available Tools

| Tool | Description |
|------|-------------|
| `login_jenkins` | Authenticate with Jenkins |
| `login_slack` | OAuth login to Slack |
| `status` | Check login status |
| `whoami` | Get user details from both services |
| `add_job` | Register a Jenkins job |
| `list_jobs` | Show registered jobs |
| `trigger_build` | Build + optional Slack notify |
| `logout` | Clear stored credentials |

## Slack Slash Commands (bonus)

If you also want `/buildtt main` from Slack directly:

```bash
jenkins-slack-mcp-server  # or: node server.js
# Expose with ngrok:
ngrok http 3001
```

Set Slack app slash command URL to `https://your-ngrok-url/slack/command`

## Credentials

Stored at `~/.jenkins-slack-mcp/config.json` (600 permissions, owner-only).

## Publishing to npm

```bash
# Login to npm
npm login

# Publish
npm publish
```

After publishing, anyone can:
```bash
npm install -g jenkins-slack-mcp
```

## Publishing to GitHub

```bash
git init
git remote add origin https://github.com/your-org/jenkins-slack-mcp.git
git add .
git commit -m "Initial commit"
git push -u origin main
```
