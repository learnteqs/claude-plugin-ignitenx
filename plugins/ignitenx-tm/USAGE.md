# ignitenx-tm

The tenant-provisioning agent for IgniteNX **Tenant Manager** (TM). The agent reaches TM only through the plugin's
bundled `tpa-mcp` server. A `PreToolUse` hook denies every other tool: built-in tools, other plugins' tools and claude.ai
connectors.

This release is the **skeleton**. It has one tool, `tpa_get_identity`, and one command, `/ignitenx-tm:poll`, which runs
the identity check every agent cycle starts with. Intake, placement and submission tools come in later milestones.

> [!WARNING]
> **Do not enable this plugin in your everyday Claude Code.** Its hook applies to the whole session: while the plugin
> is enabled, every tool except `tpa_*` is denied, in every session. The plugin ships disabled (`defaultEnabled: false`).
> If you enabled it by mistake, run `claude plugin disable ignitenx-tm@ignitenx-plugins` (or use `/plugin`) and start a
> new session.

## 1. Create the agent key in Tenant Manager

In TM, go to **Access Control → API keys → + New**.

| Setting | Value |
|---|---|
| Grants | One grant: `partners.view` and `plans.view` over **all tenants** |
| Expiry | At most 90 days. Rotate before it expires. |
| IP allowlist | The runner's static egress IP, as Tenant Manager sees it |
| Rate limit | The default, 120/min. One identity check costs 2 (the exchange and `/me`). |

`tpa_get_identity` **refuses to run** in any of these cases:

- the key holds any other permission, either in the combined list or in any single grant;
- the key reports super-admin access;
- TM identifies the token as anyone other than this key.

The allowed set today is `plans.view` and `partners.view`. It also includes the planned `provisioning.view`,
`provisioning.submit` and `ops.view`, which TM doesn't define yet. Never grant any of these:

- `db.*`: every one of them implies `db.view`, which reads decrypted connection strings;
- `tenants.*`;
- `accesscontrol.view`;
- `audit.view`.

A key's access also shrinks if the person who created, updated or rotated it loses theirs. TM then answers `/me` with 403,
and the agent stops with a `no_access` error.

## 2. Prepare a dedicated runner

The runner must load nothing except this plugin. Every process Claude Code starts inherits its environment, including:

- other plugins' MCP servers;
- other hooks;
- the status-line script;
- the `apiKeyHelper` script.

A key in that environment would reach all of them.

- **Its own OS user and `CLAUDE_CONFIG_DIR`**, holding no other plugins, MCP servers, hooks, `statusLine` or `apiKeyHelper`.
- **API-key auth.** Set `ANTHROPIC_API_KEY` and have no claude.ai login. A claude.ai login would load that account's
  connectors and synced plugins.
- **An empty working directory for each run.** Otherwise `.claude/settings*.json` or `.mcp.json` in the current directory
  could add tools, or switch hooks off.
- **Nothing that disables hooks.** No `disableAllHooks` in the runner's settings, and no managed `allowManagedHooksOnly`
  policy.
- **Node 20 or later on `PATH`.** The server and hook are prebuilt, so there is no `npm install`.

The server reads its settings from the environment. It never returns them to the model or logs them.

| Variable | Example | Notes |
|---|---|---|
| `TM_BASE_URL` | `https://tm.example.com` | Must be `https`; plain `http` is accepted only for `localhost`. Include any path prefix, e.g. `/tenants` for the combined image. |
| `TM_AGENT_KEY_FILE` | `/etc/tpa/agent-key` | Preferred. A file readable only by the runner user, holding the key. |
| `TM_AGENT_KEY` | `tmk_…` | Used when `TM_AGENT_KEY_FILE` is not set. |

The server refuses to run if `NODE_TLS_REJECT_UNAUTHORIZED=0` is set, because that turns off certificate checks before the
key is sent.

## 3. Run the agent

```bash
cd "$(mktemp -d)"
claude -p "/ignitenx-tm:poll" \
  --plugin-dir /opt/claude-plugin-ignitenx/plugins/ignitenx-tm \
  --settings '{"enabledPlugins":{"ignitenx-tm@inline":true}}' \
  --setting-sources user \
  --tools "" \
  --permission-mode dontAsk \
  --allowedTools mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity \
  --output-format stream-json --verbose --include-hook-events
```

`--plugin-dir` loads the plugin as `ignitenx-tm@inline`, and because it ships disabled, `--settings` has to enable it.
Without that flag the plugin loads nothing. For a marketplace install on the runner, run
`claude plugin enable ignitenx-tm@ignitenx-plugins` once instead.

**Every layer below is required.** The hook blocks every other tool, but it runs as `node`. If node cannot start, Claude
Code treats the hook as a non-blocking error and runs the tool anyway. The other layers stop that failure from becoming
an open door.

| Layer | What it does |
|---|---|
| The plugin's `PreToolUse` hook | Denies, with exit code 2, every tool whose name isn't one of this version's `tpa_*` tools. That holds even under `bypassPermissions`, and a call the hook can't parse is denied too. It runs `node` directly rather than through a shell, so it behaves the same under bash, pwsh and Windows PowerShell. |
| `--tools ""` | Removes every built-in tool (shell, file, web, agents), so none is even offered to the model. |
| `--permission-mode dontAsk` + `--allowedTools` | Denies anything not pre-approved instead of waiting for a prompt. |
| `--setting-sources user` + an empty directory | Stops the working directory from adding settings, tools or MCP servers. |
| A dedicated config and API-key auth | Leaves no other plugins, connectors or hooks in the session. |

Do not use these flags:

- **`--bare`**: it skips the hooks of settings and installed plugins.
- **`--strict-mcp-config`**: it also drops the plugin's own `tpa-mcp` server, so the agent has no tools.

If you run without `--tools ""`, set `ENABLE_TOOL_SEARCH=false`. Otherwise MCP tools are deferred behind `ToolSearch`,
which the hook denies, and the agent can't reach its own tools. That failure is safe, but the agent does nothing.

### Check each run

In the stream-json output:

- The `system/init` event must list exactly one MCP server, `plugin:ignitenx-tm:tpa-mcp` (connected), and exactly one
  tool, `mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity`.
- A `hook_response` event for `PreToolUse` must appear for the tool call. If there is none, the guard is not running.
- A refusal comes back as a tool error, for example `Identity check failed (refused: the agent key holds access an agent
  must not have: db.view). Stop.` The agent then stops without calling anything else.

## 4. Develop

The source is in `src/`. What actually runs is the committed `dist/tpa-mcp.mjs` and `dist/guard.mjs`, so rebuild and
commit them with every source change. CI fails if they don't match the source.

```bash
cd plugins/ignitenx-tm
npm ci
npm run check            # typecheck, build, unit + bundle tests
npm run proof:headless   # real `claude -p` runs against a stand-in TM
claude plugin validate --strict .
```

`proof:headless` needs a logged-in `claude`, and it spends a few model turns on your account. It runs three steps:

1. **The runner invocation.** Checks that the plugin loads, only its tool is offered, the identity comes back, the hook
   fires, and neither the key nor the token appears.
2. **A canary.** One harmless `Read` under `bypassPermissions` must come back denied by the hook.
3. **A hostile prompt**, with `bypassPermissions` and every built-in tool on. Every non-`tpa` tool must be denied and
   nothing may happen. This step runs only if the first two passed, so a broken guard never faces the hostile prompt.

On a real runner, set `PROOF_RUNNER=1` to also require that tpa-mcp is the only MCP server.
