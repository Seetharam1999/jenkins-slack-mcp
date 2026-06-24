# jenkins-slack-mcp

MCP server to trigger Jenkins builds from any IDE (Amazon Q, VS Code, Cursor, Claude Desktop) with Slack notifications. Zero config — login once and it remembers.

## Install

```bash
npm install -g jenkins-slack-mcp
```

## Register in your IDE

### Amazon Q (VS Code / JetBrains)

Edit `~/.aws/amazonq/mcp.json`:

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

### VS Code (Copilot / Cline / Roo)

Edit `.vscode/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "jenkins-slack": {
      "command": "jenkins-slack-mcp"
    }
  }
}
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "jenkins-slack": {
      "command": "jenkins-slack-mcp"
    }
  }
}
```

### Cursor

Edit `.cursor/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "jenkins-slack": {
      "command": "jenkins-slack-mcp"
    }
  }
}
```

### Without global install (npx)

Use this in any of the above configs instead:

```json
{
  "mcpServers": {
    "jenkins-slack": {
      "command": "npx",
      "args": ["-y", "jenkins-slack-mcp"]
    }
  }
}
```

## First-time Setup (from IDE chat)

Once the MCP is registered, use these tools from your IDE chat:

### 1. Login to Jenkins
```
login_jenkins:
  baseUrl: https://jenkins.example.com
  user: your_username
  apiToken: your_api_token
  buildToken: your_remote_trigger_token
```

### 2. Login to Slack (optional, for notifications)
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
| `login_slack` | OAuth login to Slack (opens browser) |
| `status` | Check login status |
| `whoami` | Get user details from both services |
| `add_job` | Register a Jenkins job |
| `list_jobs` | Show registered jobs |
| `trigger_build` | Build + optional Slack notify |
| `logout` | Clear stored credentials |

## Credentials

Stored at `~/.jenkins-slack-mcp/config.json` (600 permissions, owner-only). Shared across all IDEs.

## Slack Slash Commands (bonus)

If you also want `/build-app main` from Slack directly:

```bash
node server.js
# Expose with ngrok:
ngrok http 3001
```

Set Slack app slash command URL to `https://your-ngrok-url/slack/command`

## Author

[Seetharam1999](https://github.com/Seetharam1999)
