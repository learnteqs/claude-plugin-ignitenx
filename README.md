# igniteNX LMS Plugin for Claude Code

L&D workflow automation for the igniteNX Learning Management System.

## Installation

Add the marketplace:
```
/plugin marketplace add learnteqs/claude-plugin-ignitenx
```

Install the plugin:
```
/plugin install ignitenx-lms@ignitenx-plugins
```

## Prerequisites

- igniteNX LMS account with API key
- Set environment variable: `IGNITENX_API_KEY="inx_<tenant>_<roleId>_<uuid>"`

## Commands

| Command | Description |
|---------|-------------|
| `/lms:check-email` | Parse training requests from email |
| `/lms:create-sop` | Create SOP documents |
| `/lms:publish` | Publish content to igniteNX |
| `/lms:assign` | Assign content to learners |
| `/lms:status` | Check completion status |
| `/lms:training` | Manage ILT programs |

See [USAGE.md](USAGE.md) for detailed usage guide.
