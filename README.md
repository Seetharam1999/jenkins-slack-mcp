# jenkins-slack-mcp

MCP server to trigger Jenkins builds from any IDE (Amazon Q, VS Code, Cursor) with Slack notifications. Zero config — login once and it remembers.

## Install

```bash
npm install -g github:Seetharam1999/jenkins-slack-mcp
```

## Register in your IDE

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

**Without global install** (npx):
```json
{
  "mcpServers": {
    "jenkins-slack": {
      "command": "npx",
      "args": ["github:Seetharam1999/jenkins-slack-mcp"]
    }
  }
}
```

## First-time Setup (from IDE chat)

### 1. Login to Jenkins
```
login_jenkins:
  baseUrl: https://jenkins.example.com
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
  command: /build-backend
  jobPath: /job/my-backend-service
  name: Backend Service
  defaultBranch: main
```

### 4. Trigger Builds
```
trigger_build:
  job: /build-backend
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
node server.js
# Expose with ngrok:
ngrok http 3001
```

Set Slack app slash command URL to `https://your-ngrok-url/slack/command`

## Credentials

Stored at `~/.jenkins-slack-mcp/config.json` (600 permissions, owner-only).

## Author

[Seetharam1999](https://github.com/Seetharam1999)
