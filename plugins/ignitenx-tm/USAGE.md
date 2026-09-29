# ignitenx-tm

The tenant-provisioning agent for IgniteNX **Tenant Manager** (TM), in **shadow mode**. You paste a tenant request,
usually a whole email thread. The agent turns it into a spec and records it in TM as a shadow request, which people
review on TM's **Provisioning requests** page. Nothing is provisioned, reserved or messaged.

The agent reaches TM only through the plugin's bundled `tpa-mcp` server. A `PreToolUse` hook denies every other tool:
built-in tools, other plugins' tools and claude.ai connectors.

| Tool | What it does |
|---|---|
| `tpa_get_identity` | Exchanges the agent key for a token and calls `/me`. Refuses to go on if the key holds more than the agent may. |
| `tpa_get_options` | Reads what the agent may choose from: partners, plans, languages, themes, defaults, servers and TM's placement preview (`GET /api/tm/provisioning/options`). |
| `tpa_submit_request` | Checks the spec against those options and TM's rules, then records it (`POST /api/tm/provisioning/requests`). One submit per `tpa-mcp` process: a Claude session normally has one, and a reconnect starts a new process. |

The cycle's rules reach the model as the `tpa-mcp` server's instructions, so they apply in every session where the plugin
is enabled. It needs a Tenant Manager with the provisioning API.

**What the model never sees:** a TM secret. `tpa_get_options` passes on only an allowlist of fields (ids and names,
never hosts or credentials). Every result the plugin's own handlers return is scrubbed of secret patterns, the key and
the token, and TM's own error text is never passed on. The MCP SDK's input-schema errors come back unscrubbed, and echo
only the names of the model's own argument keys. The model does see the pasted text, because you pasted it.

**What the plugin refuses before anything reaches TM:**
- a submit before the options were read by this `tpa-mcp` process;
- an id or list value that isn't in the options;
- a server other than TM's placement suggestion, so the pasted text can never pick one;
- an evidence quote that isn't in the pasted text;
- a password, key, token or connection string in any value, the summary or a flag note, including a secret the plugin
  replaced in the paste and the model repeats without its label (section 3.4);
- a link in a free-text value: the title, page title, IdP display name, industry, requested environment or region, the
  summary or a flag note. Ids and emails aren't checked for links; they must match TM's formats.

Before sending, it replaces every secret in the pasted text with `[redacted]`, the same way TM does, and sends the rest
exactly as pasted. So hidden characters (zero-width, bidi and tag characters, and the like) still reach TM, which strips
and counts them itself and raises its `hidden_text` check. The plugin and TM read them from the same Unicode 16.0
tables: an emoji selector (U+FE0F) stays only after an emoji drawn as text by default (after #, * or a digit, only
before U+20E3); the first one after an emoji already drawn in colour is removed without being counted, and any other is
counted as hidden. TM then checks everything again. The result carries `redactions`, the secrets replaced by the plugin
and by TM together, and `hiddenCharacters`, the hidden characters in the paste by kind.

> [!WARNING]
> **Do not enable this plugin in your everyday Claude Code.** Its hook applies to the whole session: while the plugin
> is enabled, every tool except `tpa_*` is denied, in every session. The plugin ships disabled (`defaultEnabled: false`).
> Enable it only at project scope in the agent's own folder (section 3), or on a dedicated runner (section 4). If you
> enabled it by mistake, run `claude plugin disable ignitenx-tm@ignitenx-plugins` (or use `/plugin`) and start a new
> session.

## 1. Create the agent key in Tenant Manager

In TM, go to **Access Control → API keys → + New**.

| Setting | Value |
|---|---|
| Name | Where it runs, e.g. `tpa-desktop-shadow`. TM shows it as the submitter of each request. |
| Grants | One grant: `provisioning.submit` on the **named partners** it may submit for. It implies `provisioning.view`, which reads the options. |
| Expiry | 7 days or less. Mint a new key when it expires. |
| IP allowlist | The desktop against a local TM: `127.0.0.1` and `::1`. A runner: its static egress IP, as TM sees it. |
| Rate limit | The default, 120/min. A cycle costs about 4: the exchange, `/me`, the options and the submit. |

TM shows the secret once. Save it straight into the key file (section 3 or 4), never into a chat.

**Why named partners.** TM lists only the partners the key can submit for, and refuses a request for any other
partner. A grant on named tenants never covers a new tenant, so it can't submit at all. An all-tenants grant can submit
for every partner, which the agent doesn't need.

TM also caps each key at 200 requests in any 24 hours.

`tpa_get_identity` **refuses to run** in any of these cases, and so do the other two tools, because they check the
identity again after every token exchange:

- the key holds any other permission, either in the combined list or in any single grant;
- the key reports super-admin access;
- TM identifies the token as anyone other than this key.

The allowed set is `provisioning.submit` and `provisioning.view`, plus `plans.view` and `partners.view`, which the agent
no longer needs, and the planned `ops.view`, which TM doesn't define yet. Never grant any of these:

- `db.*`: all of them except `db.servers.view` imply `db.view`, which reads decrypted connection strings.
  `db.servers.view` lists the database servers and blob accounts;
- `tenants.*`;
- `accesscontrol.view`;
- `audit.view`.

A key's access also shrinks if the person who created, updated or rotated it loses theirs. So that person needs
`provisioning.submit` on the same partners. If they lose it, TM answers `/me` with 403, and the agent stops with a
`no_access` error.

## 2. Settings

The server reads its settings from the environment. It never returns them to the model or logs them.

| Variable | Example | Notes |
|---|---|---|
| `TM_BASE_URL` | `https://tm.example.com` | Must be `https`; plain `http` is accepted only for `localhost`. Include any path prefix, e.g. `/tenants` for the combined image. A local TM is `http://localhost:8100`. |
| `TM_AGENT_KEY_FILE` | `D:/Work/tpa-agent-secrets/agent-key` | Preferred. A file only you (or the runner user) can read, holding the key. |
| `TM_AGENT_KEY` | `tmk_…` | Used when `TM_AGENT_KEY_FILE` is not set. Never use it in the desktop (see 3.1). |
| `TM_UI_URL` | `https://tm.example.com` | Optional. TM's web app, including any path prefix. On the local stack it is `http://localhost:5174`. The **Review in TM** link is built from it. It follows the same rules as `TM_BASE_URL`; without it, or if it breaks them, the reply has the request id but no link. |

The server refuses to run if `NODE_TLS_REJECT_UNAUTHORIZED=0` is set, because that turns off certificate checks before
the key is sent.

## 3. Record requests from the Claude desktop app

This is how requests are recorded today: on demand, by a person, in a folder that holds only the agent's settings. Here
that folder is `D:\Work\tpa-agent`.

In the desktop, **the hook is the only thing inside the session that limits the tools.** The desktop ignores the
folder's settings that remove connectors, synced plugins and `dontAsk`, so the model is offered every tool the desktop
has (176 in spike (b), #9). Every step below is required.

### 3.1 Set up the folder once

1. **Pin the plugin by commit.** A marketplace `#ref` takes only a branch or a tag, and a tag can be moved. So declare a
   marketplace of your own whose one entry is pinned by `sha` to the reviewed release commit. Put it in
   `D:\Work\tpa-agent\marketplace\.claude-plugin\marketplace.json`:

   ```json
   {
     "name": "tpa-agent-pinned",
     "description": "ignitenx-tm pinned to a reviewed commit",
     "owner": { "name": "Learnteq Solutions" },
     "plugins": [
       {
         "name": "ignitenx-tm",
         "source": {
           "source": "git-subdir",
           "url": "https://github.com/learnteqs/claude-plugin-ignitenx.git",
           "path": "plugins/ignitenx-tm",
           "sha": "<the full 40-character commit sha>"
         }
       }
     ]
   }
   ```

   Then, from `D:\Work\tpa-agent`:

   ```powershell
   claude plugin uninstall ignitenx-tm@ignitenx-plugins --scope project
   claude plugin marketplace add D:\Work\tpa-agent\marketplace --scope project
   claude plugin install ignitenx-tm@tpa-agent-pinned --scope project
   ```

   Open `%USERPROFILE%\.claude\plugins\installed_plugins.json` and check that `gitCommitSha` for
   `ignitenx-tm@tpa-agent-pinned` is the reviewed commit. Do this after every install or update. For a new release,
   change `sha` and check again.

2. **Write the folder's settings.** `D:\Work\tpa-agent\.claude\settings.json` holds only the following, plus a `false`
   entry in `enabledPlugins` for each synced plugin (e.g. `"data@synced": false`). Remove the old `ignitenx-plugins`
   marketplace (`"ref": "main"`) if it is still there: while it is, any push to `main` changes the guard.

   ```json
   {
     "enabledPlugins": { "ignitenx-tm@tpa-agent-pinned": true },
     "extraKnownMarketplaces": {
       "tpa-agent-pinned": { "source": { "source": "directory", "path": "D:/Work/tpa-agent/marketplace" } }
     },
     "disableClaudeAiConnectors": true,
     "autoMemoryEnabled": false,
     "permissions": {
       "defaultMode": "dontAsk",
       "allow": [
         "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity",
         "mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_options"
       ]
     },
     "env": {
       "TM_BASE_URL": "http://localhost:8100",
       "TM_AGENT_KEY_FILE": "D:/Work/tpa-agent-secrets/agent-key",
       "TM_UI_URL": "http://localhost:5174",
       "ENABLE_TOOL_SEARCH": "false"
     }
   }
   ```

   - `tpa_submit_request` is **not** on the allow list, so the desktop asks you before each submit.
   - The desktop honours only `permissions.allow` and `env`. The CLI honours all of it.
   - `ENABLE_TOOL_SEARCH=false` keeps the `tpa_*` tools loaded. With tool search on, they are deferred behind
     `ToolSearch`, which the hook denies. The cost is about 130k tokens of tool definitions per session (about $1.11
     for an identity check in spike (b)).
   - Use `TM_AGENT_KEY_FILE`, never `TM_AGENT_KEY`: the folder's `env` reaches every process the session starts.

3. **Trust the folder once.** Run `claude` in `D:\Work\tpa-agent` and accept the trust dialog. The desktop's folder
   picker fails silently on an untrusted folder, and allow rules in an untrusted folder are ignored.

4. **Save the key** (section 1) in `D:\Work\tpa-agent-secrets\agent-key`, outside the agent folder. Better still, keep the
   file only while you record requests, and delete it after.

5. **Lock down the folders.** Every process running as you can read or change the key, the installed guard and the
   folder's settings. That includes your everyday sessions, which read untrusted mail. So remove inherited access and
   grant only yourself, in a Command Prompt:

   ```bat
   icacls D:\Work\tpa-agent-secrets /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F"
   icacls D:\Work\tpa-agent /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F"
   icacls "%USERPROFILE%\.claude\plugins\cache\tpa-agent-pinned" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F"
   ```

   Do the same for the folder of any routine that runs in `D:\Work\tpa-agent`. Your Windows account is still the trust
   boundary; the dedicated runner (section 4), with its own OS user, removes that.

6. **Name TM's environment.** Set `TM_ENVIRONMENT_NAME` on TM to the environment label of its servers. For the local
   stack, set `TmEnvironmentName=development` in the AppHost's `.env`, which matches the labels `cmd/localseed` gives.
   Without it, every registered server is a placement candidate.

### 3.2 Record a request

1. In the Claude desktop app, start a **new** session in `D:\Work\tpa-agent`. Check that the mode is **Manual**, not
   Auto: new sessions start in Auto unless the desktop has remembered Manual for the folder.
2. Type "New tenant request:" and paste the email or thread as one message, up to 50,000 characters.
3. The agent calls `tpa_get_identity`, then `tpa_get_options`. Neither asks you.
4. It fills the spec and calls `tpa_submit_request`. This is the **only prompt you should see.** Read its input:
   `sourceText` must be what you pasted. The agent may drop only exact duplicate quoted history, signatures and legal
   disclaimers, and then it flags `source_trimmed`. Allow the call **once**, never "always allow".
5. The agent replies with the request id (`pr-…`), a **Review in TM** link, TM's checks and its own flags. The tool's
   result also counts the secrets replaced (`redactions`) and the hidden characters TM stripped (`hiddenCharacters`).
6. Open the link, or **IgniteNX → Provisioning requests** in TM. The request is marked **Shadow**, and any pasted secret
   shows as `[redacted]`.
7. For the next request, start a new session. A second paste in the same session gets "already submitted: start a new
   session". The limit is one submit per `tpa-mcp` process. A Claude session normally has one, but a reconnect starts
   a new process, so don't rely on the limit to stop a second submit.

**Any other prompt means the guard missed a tool. Deny it and stop.**

`/ignitenx-tm:poll` is safe in the desktop too. Its `allowed-tools` pre-approves only `tpa_get_identity` and
`tpa_get_options`, so `tpa_submit_request` still asks you as in step 4. Run on its own, it checks the key and reads the
options, then stops.

The model copies the paste into `sourceText`, so a hostile paste could talk it into dropping lines. The prompt in step 4
and TM's page both show the text that was sent, so check it there.

### 3.3 Keep these rules while the key can submit

1. **The plugin stays pinned by commit,** and you check `gitCommitSha` after every install or update.
2. **The only allow rules are `tpa_get_identity` and `tpa_get_options`,** at every scope: user, project, project-local
   and managed.
   - No `settings.local.json`. An "always allow" answer in the folder creates one.
   - No stored approvals on a routine. The desktop applies them in later runs, in whatever folder the routine runs.
   - The only expected prompt is `tpa_submit_request`. Any other prompt means the guard missed a tool: deny it and stop.
3. **Hooks stay on:** no `disableAllHooks`, and no managed `allowManagedHooksOnly`, anywhere.
4. **The folder stays on Manual,** never Auto or Accept edits. Only Manual prompts for a tool the guard missed.
5. **Routines aren't used for pastes.** Keep any agent routine on the Manual schedule, and check its folder before every
   **Run now** and after every edit. In another folder no hook loads, and routines don't expand slash commands.

### 3.4 When the agent stops with an error

A tool error names one of these codes, e.g. `Submit failed (daily_cap: …)`. They are all the codes the model can see.

| Code | Meaning | What to do |
|---|---|---|
| `config` | The server's settings are missing or break the rules in section 2, e.g. a missing or non-https `TM_BASE_URL`, an unreadable key file, or `NODE_TLS_REJECT_UNAUTHORIZED=0`. | Fix the settings, then start a new session. |
| `rejected` | TM refused the key: it is invalid, expired, revoked or not allowed from this address. | Fix the key in TM (section 1), or mint a new one. |
| `no_access` | The key has no access to this, the person who created it lost theirs, or TM isn't set up for agents. | Fix the access in TM (section 1). |
| `refused` | The key holds more than the agent may, reports super-admin access, or isn't the key TM names. | Fix the key's grants in TM (section 1). |
| `rate_limited` | The key went over its rate limit. Nothing was recorded. | Wait a minute, then try again. |
| `unavailable` | TM can't be reached, answered something unexpected, or has no provisioning API, or the plugin hit an unexpected error. | Try again later, in a new session. If it happened on a submit, check TM's list first. |
| `options_required` | The agent submitted before reading the options in this `tpa-mcp` process. | The agent reads them and submits again. If it doesn't, start a new session. |
| `invalid_spec` | The plugin or TM refused single fields. The error lists each as `path: code`. A spec the plugin refuses never reaches TM. | The agent fixes only those fields, at most twice. |
| `too_large` | The request is over TM's 256 KiB limit. | Start a new session and paste only the part of the thread with the request. |
| `bad_request` | TM couldn't read the request: the plugin and TM don't match. | Report it with the plugin version. |
| `daily_cap` | The key has recorded 200 requests in the last 24 hours. | Wait. |
| `ambiguous` | The request may or may not be recorded: the answer was lost, or TM failed after it arrived. The plugin has already resent it twice with the same id. | Check TM's list. If it's there, you're done. If not, ask the agent to resend it unchanged, or start a new session and paste it again. |
| `retry_later` | TM was busy with this request id, and the plugin's two resends didn't get through. It may be recorded. | As for `ambiguous`. |
| `submit_pending` | After an `ambiguous` or `retry_later` submit, the agent tried to send something different. Only the same request may follow, unchanged. | As for `ambiguous`. |
| `conflict` | TM already holds a different request under this request id. | Check TM's list, then start a new session. |
| `already_submitted` | This process has recorded a request, or TM refused it as a conflict. | Start a new session. |
| `too_many_attempts` | TM refused the spec 3 times. | Check the paste, then start a new session. |

The field codes in an `invalid_spec` error are TM's own. Three rules are the plugin's own, which TM doesn't apply:

| Field code | Path | Meaning |
|---|---|---|
| `not_preview_suggestion` | `fields.placement.<server>.value` | A server other than TM's placement suggestion. The agent uses the suggestion or leaves the field absent. |
| `source_too_long_after_redaction` | `sourceText` | The paste is within the limit, but not once its secrets are replaced with `[redacted]`. Start a new session and paste only the part of the thread with the request. |
| `secret_in_value` | `summary`, `flags[i].note`, `fields.<field>.value` | TM's code, which the plugin also gives when the text repeats a secret of 4 or more characters that it replaced in the paste, such as a password without its `Password:` label. TM can't check this, because it receives only the redacted paste. |

## 4. Run it on a dedicated runner

A runner runs the agent headless, as its own OS user. In this release a runner cycle checks the identity, reads the
options and stops, because nothing has been pasted. Record requests from the desktop (section 3).

### 4.1 Prepare the runner

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
- **The reviewed commit, not a branch.** Check out the release commit (`git checkout <sha>`) in the folder `--plugin-dir`
  points at.
- **The key in `TM_AGENT_KEY_FILE`**, a file only the runner user can read (section 2).

### 4.2 Run a cycle

```bash
cd "$(mktemp -d)"
claude -p "/ignitenx-tm:poll" \
  --plugin-dir /opt/claude-plugin-ignitenx/plugins/ignitenx-tm \
  --settings '{"enabledPlugins":{"ignitenx-tm@inline":true}}' \
  --setting-sources user \
  --tools "" \
  --permission-mode dontAsk \
  --allowedTools mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity,mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_options,mcp__plugin_ignitenx-tm_tpa-mcp__tpa_submit_request \
  --output-format stream-json --verbose --include-hook-events
```

`--plugin-dir` loads the plugin as `ignitenx-tm@inline`, and because it ships disabled, `--settings` has to enable it.
Without that flag the plugin loads nothing. For a marketplace install on the runner, pin it by commit as in 3.1, and
run `claude plugin enable` for it once instead.

`--allowedTools` lists all three tools, because `/ignitenx-tm:poll` pre-approves only the first two and `dontAsk`
denies any tool that isn't pre-approved.

**Every layer below is required.** The hook blocks every other tool, but it runs as `node`. If node cannot start, Claude
Code treats the hook as a non-blocking error and runs the tool anyway. The other layers stop that failure from becoming
an open door.

| Layer | What it does |
|---|---|
| The plugin's `PreToolUse` hook | Denies, with exit code 2, every tool whose name isn't exactly one of this version's three `tpa_*` tools. That holds even under `bypassPermissions`, and a call the hook can't parse is denied too. It runs `node` directly rather than through a shell, so it behaves the same under bash, pwsh and Windows PowerShell. |
| `--tools ""` | Removes every built-in tool (shell, file, web, agents), so none is even offered to the model. |
| `--permission-mode dontAsk` + `--allowedTools` | Denies anything not pre-approved instead of waiting for a prompt. |
| `--setting-sources user` + an empty directory | Stops the working directory from adding settings, tools or MCP servers. |
| A dedicated config and API-key auth | Leaves no other plugins, connectors or hooks in the session. |

Do not use these flags:

- **`--bare`**: it skips the hooks of settings and installed plugins.
- **`--strict-mcp-config`**: it also drops the plugin's own `tpa-mcp` server, so the agent has no tools.

If you run without `--tools ""`, set `ENABLE_TOOL_SEARCH=false`. Otherwise MCP tools are deferred behind `ToolSearch`,
which the hook denies, and the agent can't reach its own tools. That failure is safe, but the agent does nothing.

### 4.3 Check each run

In the stream-json output:

- The `system/init` event must list exactly one MCP server, `plugin:ignitenx-tm:tpa-mcp` (connected), and exactly three
  tools: `mcp__plugin_ignitenx-tm_tpa-mcp__tpa_get_identity`, `…__tpa_get_options` and `…__tpa_submit_request`.
- A `hook_response` event for `PreToolUse` must appear for each tool call. If there is none, the guard is not running.
- A refusal comes back as a tool error, for example `Identity check failed (refused: the agent key holds access an agent
  must not have: db.view). Stop.` The agent then stops without calling anything else.

## 5. Develop

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

1. **The runner invocation.** Checks that the plugin loads, only its three tools are offered, the identity and the
   options come back, nothing is submitted, the hook fires, and neither the key nor the token appears.
2. **A canary.** One harmless `Read` under `bypassPermissions` must come back denied by the hook.
3. **A hostile prompt**, with `bypassPermissions` and every built-in tool on. Every non-`tpa` tool must be denied and
   nothing may happen. This step runs only if the first two passed, so a broken guard never faces the hostile prompt.

On a real runner, set `PROOF_RUNNER=1` to also require that tpa-mcp is the only MCP server.
