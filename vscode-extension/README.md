# BuildPilot 🚀

> **`Jenkins`** | **`CI`** | **`CD`** | **`Build`** | **`Deploy`** | **`DevOps`**

**Trigger Jenkins builds directly from VS Code.** No browser, no CLI — just click and deploy.

The fastest way to run your **CI/CD** pipeline. One click **build** trigger for **Jenkins** — right from your editor.

![BuildPilot](media/buildpilot.svg)

## Features

- 🔑 **One-time Login** — Connect to **Jenkins** with API token
- 📋 **Auto-discover Jobs** — All your **Jenkins** jobs appear in the sidebar
- ▶️ **Trigger Builds** — Click a job, fill params, **build**!
- 📊 **Build History** — Track your **CI/CD** triggers
- 🔔 **Slack Notifications** — Get DM'd when **builds** trigger
- ⚡ **Parameterized Builds** — Supports branch selection, choice params, etc.
- 🔄 **Continuous Integration** — Streamline your **CI** workflow without leaving the editor
- 🚀 **Continuous Deployment** — Kick off **CD** pipelines instantly

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

## Commands

| Command | Description |
|---------|-------------|
| `BuildPilot: Login to Jenkins` | Connect to Jenkins |
| `BuildPilot: Trigger Build` | Pick a job and trigger |
| `BuildPilot: Refresh Jobs` | Re-fetch jobs from Jenkins |
| `BuildPilot: Connect Slack` | Enable Slack notifications |
| `BuildPilot: Logout` | Clear all credentials |

## How It Works

BuildPilot uses the Jenkins Remote API to:
1. Authenticate via API token (stored securely in VS Code SecretStorage)
2. Auto-discover all buildable jobs
3. Fetch job parameters dynamically
4. Trigger builds with your chosen params
5. Optionally notify via Slack

No Jenkins plugins required. Works with any Jenkins instance.

## Also Available As

- **MCP Server** — For Amazon Q, GitHub Copilot, and other AI IDEs
- **JetBrains Plugin** — Coming soon (IntelliJ, WebStorm, Android Studio)

## License

MIT © [Seetharam](https://github.com/Seetharam1999)
