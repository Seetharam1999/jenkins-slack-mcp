# jenkins-slack-mcp

MCP server to trigger Jenkins builds from any IDE with Slack DM notifications. Auto-discovers all jobs on login — no manual configuration.

## Install

```bash
npm install -g jenkins-slack-mcp
```

## Register in your IDE

### Amazon Q

`~/.aws/amazonq/mcp.json`:
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

### VS Code

`.vscode/mcp.json`:
```json
{
  "mcpServers": {
    "jenkins-slack": { "command": "jenkins-slack-mcp" }
  }
}
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
```json
{
  "mcpServers": {
    "jenkins-slack": { "command": "jenkins-slack-mcp" }
  }
}
```

### Cursor

`.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "jenkins-slack": { "command": "jenkins-slack-mcp" }
  }
}
```

### Without global install

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

---

## Flow of Work

```
┌─────────────────────────────────────────────────────────┐
│  1. login_jenkins (baseUrl only)                        │
│     → Opens browser to Jenkins token page               │
│     → User copies API token + build trigger token       │
│                                                         │
│  2. login_jenkins (all params)                          │
│     → Validates credentials                             │
│     → Auto-discovers ALL jobs from Jenkins              │
│     → Stores securely at ~/.jenkins-slack-mcp/          │
│                                                         │
│  3. list_jobs / list_jobs filter="tms"                  │
│     → Shows jobs in table with status (✅ ❌ ⏸️)        │
│                                                         │
│  4. job_details jobName="my-job"                        │
│     → Shows all parameters (name, type, default,        │
│       choices) in table format                          │
│                                                         │
│  5. trigger_build jobName="my-job" params={...}         │
│     → Triggers build with params                        │
│     → Sends Slack DM to you (if configured)             │
│     → Posts to channel (if notifyChannel provided)      │
│                                                         │
│  (Optional) setup_slack                                 │
│     → Configure bot token + your Slack User ID          │
│     → Get DM notifications on every build trigger       │
└─────────────────────────────────────────────────────────┘
```

---

## Usage

### Step 1: Login to Jenkins

First time — just provide the URL, browser opens automatically:
```
login_jenkins baseUrl="https://jenkins.example.com"
```
→ Browser opens Jenkins → Copy your API token and build trigger token.

Then login with full credentials:
```
login_jenkins:
  baseUrl: https://jenkins.example.com
  user: your_username
  apiToken: your_api_token
  buildToken: your_build_trigger_token
```
→ All jobs auto-discovered!

### Step 2: Browse Jobs

```
list_jobs                    # all jobs
list_jobs filter="tms"       # filter by name
```

Output:
| # | Job Name | Status |
|---|----------|--------|
| 1 | tms-docker-build-new | ✅ Success |
| 2 | tms-constants | ✅ Success |
| 3 | TMS-version-update | ✅ Success |

### Step 3: Check Parameters

```
job_details jobName="tms-docker-build-new"
```

Output:
| Parameter | Type | Default | Choices | Description |
|-----------|------|---------|---------|-------------|
| BRANCH | String | main | - | Branch to build |

### Step 4: Trigger Build

```
trigger_build jobName="tms-docker-build-new" params={"BRANCH": "feature/xyz"}
```

### Step 5 (Optional): Setup Slack DMs

```
setup_slack:
  botToken: xoxb-your-bot-token
  userId: U0123456789
```

**How to get your Slack User ID:**
1. Open Slack → Click your profile picture
2. Click "Profile" → Click "..." (more)
3. Click "Copy Member ID"

**How to get bot token:**
1. Go to https://api.slack.com/apps → Your App
2. OAuth & Permissions → Bot User OAuth Token (starts with `xoxb-`)

After setup, every `trigger_build` sends you a DM automatically.

---

## Available Tools

| Tool | Description |
|------|-------------|
| `login_jenkins` | Login + auto-discover jobs (opens browser for new users) |
| `setup_slack` | Configure Slack bot token + User ID for DM notifications |
| `status` | Check login status + job count |
| `list_jobs` | All jobs in table format (filterable) |
| `job_details` | Show parameters for a job |
| `trigger_build` | Trigger build + Slack DM + channel notify |
| `refresh_jobs` | Re-fetch jobs from Jenkins |
| `whoami` | Current user details |
| `logout` | Clear all credentials |

## Credentials

Stored at `~/.jenkins-slack-mcp/config.json` (600 permissions, owner-only).

## Author

[Seetharam1999](https://github.com/Seetharam1999)
