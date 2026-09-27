# igniteNX Plugins for Claude Code

This marketplace has two plugins:

| Plugin | For |
|---|---|
| `ignitenx-lms` | L&D workflow automation for the igniteNX Learning Management System |
| `ignitenx-tm` | The tenant-provisioning agent for igniteNX Tenant Manager. **Runner only**, see below. |

## ignitenx-lms

### Installation

Add the marketplace:
```
/plugin marketplace add learnteqs/claude-plugin-ignitenx
```

Install the plugin:
```
/plugin install ignitenx-lms@ignitenx-plugins
```

### Prerequisites

- igniteNX LMS account with API key
- Set environment variable: `IGNITENX_API_KEY="inx_<tenant>_<roleId>_<uuid>"`

### Commands

| Command | Description |
|---------|-------------|
| `/lms:check-email` | Parse training requests from email |
| `/lms:create-sop` | Create SOP documents |
| `/lms:publish` | Publish content to igniteNX |
| `/lms:assign` | Assign content to learners |
| `/lms:status` | Check completion status |
| `/lms:training` | Manage ILT programs |

See [USAGE.md](plugins/ignitenx-lms/USAGE.md) for detailed usage guide.

## ignitenx-tm

The tenant-provisioning agent. It reaches Tenant Manager only through its bundled `tpa-mcp` tools. A hook denies every
other tool in any session where the plugin is enabled, so **don't enable it in your everyday Claude Code**. It installs
disabled and is meant for the agent's dedicated runner. If you enabled it by mistake, run
`claude plugin disable ignitenx-tm@ignitenx-plugins` and start a new session.

| Command | Description |
|---------|-------------|
| `/ignitenx-tm:poll` | Run one agent cycle. Currently it only verifies the agent's Tenant Manager identity |

See [plugins/ignitenx-tm/USAGE.md](plugins/ignitenx-tm/USAGE.md) for the agent key, runner flags and development.
