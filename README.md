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
│     → Stores encrypted at ~/.jenkins-slack-mcp/         │
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
| 1 | build-main | ✅ Success |
| 2 | lib-packages | ✅ Success |
| 3 | job-constant | ✅ Success |

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

---

## Security

BuildPilot follows OWASP security best practices:

### Credential Storage
- All credentials (API tokens, Slack tokens) are **encrypted at rest** using AES-256-GCM
- Encryption key is machine-bound (derived from hostname + user identity)
- Config file stored with `600` permissions (owner-read/write only)
- Atomic file writes prevent data corruption and race conditions

### Network Security
- **SSRF Protection** — Private IPs, loopback, link-local, and cloud metadata endpoints (169.254.169.254) are blocked
- **TLS enforced** — Only HTTP/HTTPS protocols allowed
- **Request timeouts** — All HTTP calls have strict timeouts (10-30s)
- **Redirect protection** — Auth headers stripped on redirects

### Input Validation
- Build parameter names validated against allowlist (`[a-zA-Z0-9_\-.]`)
- Reserved parameter keys (`token`, `cause`, `json`, `submit`) are blocked to prevent injection
- Parameter values capped at 1000 characters
- Jenkins URL validated and sanitized before use

### OAuth Security
- OAuth callback server binds to `127.0.0.1` only (not `0.0.0.0`)
- CSRF state parameter uses `crypto.randomBytes(32)`
- Timing-safe comparison for state validation
- Rate limiting on callback endpoint (max 5 attempts)
- Auto-timeout after 2 minutes
- All non-callback routes rejected with 404

### Error Handling
- Error messages sanitized to prevent credential leakage
- URLs, auth headers, and tokens are redacted from error output
- Error messages truncated to 200 characters

---

## VS Code Extension

See [vscode-extension/README.md](./vscode-extension/README.md) for the full-featured VS Code extension with:
- Inline search, grouped jobs, pin/unpin
- Live build summary webview
- Stop running builds from history
- Slack notifications

---

## Credentials

Stored encrypted at `~/.jenkins-slack-mcp/config.enc` (AES-256-GCM, 600 permissions, owner-only).

## Author

[Seetharam1999](https://github.com/Seetharam1999)
