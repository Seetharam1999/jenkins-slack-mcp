# BuildPilot 🚀

> **`Jenkins`** | **`CI`** | **`CD`** | **`Build`** | **`Deploy`** | **`DevOps`**

**Trigger Jenkins builds directly from VS Code.** No browser, no CLI — just click and deploy.

The fastest way to run your **CI/CD** pipeline. One click **build** trigger for **Jenkins** — right from your editor.



## Features

- 🔑 **One-time Login** — Connect to **Jenkins** with API token
- 📋 **Auto-discover Jobs** — All your **Jenkins** jobs appear in the sidebar
- 📂 **Grouped Jobs** — Jobs grouped by prefix with collapsible folders
- 🔍 **Inline Search** — Filter jobs in real-time from the sidebar search box
- 📌 **Pin/Unpin** — Pin individual jobs or entire groups to the top
- ▶️ **Trigger Builds** — Click a job, fill params, **build**!
- ⏹️ **Stop Builds** — Stop running builds directly from history (no browser needed)
- 📊 **Live Build Summary** — Real-time build status, console output in a webview panel
- 📜 **Build History** — Track your **CI/CD** triggers with running/completed status
- 🔔 **Slack Notifications** — Get DM'd when **builds** trigger
- ⚡ **Parameterized Builds** — Supports branch selection, choice params, etc.
- 🚀 **Multi-Trigger** — Trigger multiple jobs at once with a single branch
- ⚙️ **Quick Settings** — Gear icon for instant access to extension settings

## Quick Start

1. Install BuildPilot from VS Code Marketplace
2. Click the BuildPilot icon in the Activity Bar (sidebar)
3. Run `BuildPilot: Login to Jenkins` from Command Palette (`Cmd+Shift+P`)
4. Enter your Jenkins URL, username, and API token
5. Your jobs appear in the sidebar — click to trigger!

## Getting Your Jenkins API Token

1. Go to Jenkins → Click your username (top right)
2. Click **Configure**
3. Under **API Token** → Click **Add new Token** → **Generate**
4. Copy the token

## Sidebar Views

### Search (Inline)
A real-time search box embedded in the sidebar. Type to instantly filter jobs — no popup, no interruption. Clear button to reset.

### Jobs Tree
- Jobs are **grouped by prefix** (text before first `-`) as collapsible folders
- **Pin jobs** — Click the 📌 icon to pin individual jobs (appear first in their group)
- **Pin groups** — Click the 📌 icon on a folder to pin the entire group to the top
- **Unpin** — Click the pinned icon to unpin
- Pinned state persists across sessions

### Build History
- Shows all triggered builds with timestamps
- **Running builds** — Spinning icon + inline ⏹ stop button
- **Completed builds** — Rocket icon, no stop button
- **Click any entry** — Opens the live build summary webview
- Auto-detects when a build completes and updates the icon

## Live Build Summary

When you trigger a build or click a history entry, a webview panel opens showing:
- Build status (Running / Success / Failed / Aborted)
- Progress bar (animated while running)
- Branch, duration, start time, build number
- Console output (last 100 lines, auto-refreshing every 5s)

## Slack Integration (Optional)

1. Run `BuildPilot: Connect Slack` from Command Palette
2. Enter your Slack App Client ID and Secret
3. Authorize in browser
4. You'll receive DM notifications on every build trigger

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `buildpilot.jenkinsUrl` | `""` | Jenkins base URL |
| `buildpilot.slackNotify` | `true` | Send Slack DM on build |
| `buildpilot.defaultBranch` | `main` | Default branch |

Access settings quickly via the ⚙️ icon in the Jobs view title bar.

## Commands

| Command | Description |
|---------|-------------|
| `BuildPilot: Login to Jenkins` | Connect to Jenkins |
| `BuildPilot: Trigger Build` | Pick a job and trigger |
| `BuildPilot: Trigger Multiple Jobs` | Select multiple jobs to build |
| `BuildPilot: Cancel Build` | Cancel a running build |
| `BuildPilot: Refresh Jobs` | Re-fetch jobs from Jenkins |
| `BuildPilot: Search Jobs` | Focus the search box |
| `BuildPilot: Connect Slack` | Enable Slack notifications |
| `BuildPilot: Settings` | Open BuildPilot settings |
| `BuildPilot: Logout` | Clear all credentials |

## Security

BuildPilot is hardened against OWASP Top 10 vulnerabilities:

| Category | Protection |
|----------|------------|
| **Credential Storage** | API tokens stored exclusively in VS Code SecretStorage (OS keychain). Never in globalState or plaintext. |
| **XSS Prevention** | All user-controlled values HTML-escaped before webview injection. No raw interpolation. |
| **Content Security Policy** | Strict CSP with nonces on all webviews. Blocks inline scripts, external resources. |
| **SSRF Protection** | Jenkins URL validated — private IPs, metadata endpoints, non-HTTP protocols blocked. |
| **Input Validation** | Build params allowlisted (`[a-zA-Z0-9_\-.]`). Reserved keys blocked. Values length-capped. |
| **OAuth Security** | Callback server on `127.0.0.1` only. Timing-safe state check. Rate limited. 2min timeout. |
| **Error Handling** | Credentials/URLs redacted from error messages. No stack traces exposed. |
| **Network** | Request timeouts (10-30s). Auth stripped on redirects. Max 3 redirects. |

## How It Works

BuildPilot uses the Jenkins Remote API to:
1. Authenticate via API token (stored in VS Code SecretStorage / OS keychain)
2. Auto-discover all buildable jobs
3. Fetch job parameters dynamically
4. Trigger builds with your chosen params
5. Poll build status for live updates
6. Optionally notify via Slack

No Jenkins plugins required. Works with any Jenkins instance.

## Also Available As

- **MCP Server** — For Amazon Q, GitHub Copilot, Claude, and other AI IDEs
- **JetBrains Plugin** — Coming soon (IntelliJ, WebStorm, Android Studio)

## License

MIT © [Seetharam](https://github.com/Seetharam1999)
