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

- 🔑 One-time Jenkins login with API token
- 📋 Auto-discover all Jenkins jobs
- ▶️ Trigger parameterized builds from tool window
- 📊 Build history tracking
- 🔔 Slack DM notifications
- 🔄 **Continuous Integration** from your IDE
- 🚀 **Continuous Deployment** pipeline trigger

## Installation

1. Open IDE → Settings → Plugins → Marketplace
2. Search **"BuildPilot"**
3. Install & restart

## Usage

1. Open the **BuildPilot** tool window (right sidebar)
2. Click **🔑 Login** → enter Jenkins URL, username, API token
3. Jobs auto-populate in the list
4. Double-click or select + click **▶ Build** to trigger

Also available via **Tools → BuildPilot** menu.

## Build from Source

```bash
cd jetbrains-plugin
./gradlew buildPlugin
```

Output: `build/distributions/buildpilot-1.0.0.zip`

## License

MIT © [Seetharam](https://github.com/Seetharam1999)
