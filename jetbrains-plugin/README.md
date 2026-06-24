# BuildPilot 🚀 — JetBrains Plugin

> **Jenkins** | **CI** | **CD** | **Build** | **Deploy** | **DevOps**

**Trigger Jenkins builds directly from IntelliJ IDEA, WebStorm, and all JetBrains IDEs.**

## Supported IDEs

- IntelliJ IDEA (Community & Ultimate)
- WebStorm
- Android Studio
- PyCharm
- GoLand
- PhpStorm
- Rider
- All JetBrains IDEs (2023.3+)

## Features

- 🔑 **One-time Login** — Connect to Jenkins with API token
- 📋 **Auto-discover Jobs** — All Jenkins jobs in the tool window
- 📂 **Grouped Jobs** — Jobs grouped by prefix with collapsible sections
- 🔍 **Inline Search** — Filter jobs in real-time as you type
- 📌 **Pin/Unpin** — Pin jobs or groups to the top for quick access
- ▶️ **Trigger Builds** — Click a job, fill params, build!
- ⏹️ **Stop Builds** — Stop running builds directly from history
- 📊 **Live Build Summary** — Real-time status + console output (auto-refreshing)
- 📜 **Build History** — Track triggers with running/completed status
- 🔔 **Slack Notifications** — Get DM'd when builds trigger
- ⚡ **Parameterized Builds** — Supports branch selection, choice params
- 🚀 **Multi-IDE** — Works in all JetBrains IDEs

## Installation

1. Open IDE → Settings → Plugins → Marketplace
2. Search **"BuildPilot"**
3. Install & restart

## Usage

1. Open the **BuildPilot** tool window (right sidebar)
2. Click **🔑 Login** → enter Jenkins URL, username, API token
3. Jobs auto-populate grouped by prefix
4. **Search** — Type in the filter box to find jobs instantly
5. **Pin** — Select a job/group and click 📌 Pin to keep it at the top
6. **Trigger** — Double-click or select + click ▶ Build
7. **Stop** — In History tab, select a running build and click ⏹ Stop
8. **View** — Double-click history entry or click 📊 View for live console output

Also available via **Tools → BuildPilot** menu.

## Tool Window Tabs

| Tab | Description |
|-----|-------------|
| **Jobs** | Grouped job list with search, pin/unpin, trigger |
| **History** | Build history with stop button for running builds |
| **Build Summary** | Live build status + console output (auto-refresh 5s) |

## Settings

Open via ⚙ button in Jobs tab or **Settings → Tools → BuildPilot**.

## Commands (Tools Menu)

| Command | Description |
|---------|-------------|
| Login to Jenkins | Connect with API token |
| Trigger Build | Pick a job and trigger |
| Stop Build | Stop a running build |
| Refresh Jobs | Re-fetch from Jenkins |
| Connect Slack | Enable DM notifications |
| Logout | Clear all credentials |

## Security

BuildPilot is hardened against OWASP Top 10 vulnerabilities:

| Category | Protection |
|----------|------------|
| **Credential Storage** | All tokens stored in OS keychain via IntelliJ PasswordSafe. Never in plaintext XML. |
| **SSRF Protection** | Jenkins URL validated — private IPs (10.x, 172.x, 192.168.x), loopback, link-local, and cloud metadata endpoints blocked. |
| **Input Validation** | Build params allowlisted (`[a-zA-Z0-9_\-.]`). Reserved keys (`token`, `cause`, `json`, `submit`) blocked. Values max 1000 chars. |
| **Error Sanitization** | URLs and auth headers redacted from error messages. Messages truncated to 200 chars. |
| **Network** | Request timeouts (15s connect, 30s read). Redirects disabled to prevent auth header leakage. |
| **Slack Validation** | User ID format validated. Bot token stored in OS keychain. |

## Build from Source

```bash
cd jetbrains-plugin
./gradlew buildPlugin
```

Output: `build/distributions/buildpilot-1.0.0.zip`

## Also Available As

- **VS Code Extension** — Full-featured with webview panels
- **MCP Server** — For Amazon Q, GitHub Copilot, Claude, and other AI IDEs

## License

MIT © [Seetharam](https://github.com/Seetharam1999)
