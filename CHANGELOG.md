# Changelog

## ignitenx-tm 0.2.2

- The tenant key, which is also the tenant URL name, is one lower-case word: legal words such as Pvt and Ltd are
  dropped and the rest joined, up to 20 letters, with `uat` at the end for a UAT tenant. "Lotus Learning Academy Pvt
  Ltd" becomes `lotuslearningacademy`, and `lotuslearningacademyuat` on UAT.
- `/ignitenx-tm:poll` can only be started by a person. The agent tried to start it itself, and the guard blocked
  that as a failed step.

## ignitenx-tm 0.2.1

Copies Tenant Manager's redaction fix (learnteqs/ignitenx#5025, #5024, #5017), so the plugin replaces these secrets
in the paste before sending it, and refuses a summary, note or value that repeats one:

- a password after a label with up to four words before its colon: "Temp password for the admin: …", "API key for
  staging: …", "Password (admin): …", "Password(admin): …". The label ends at its first colon (or `=`) that has a
  space after it and is outside brackets. A key right after it is skipped ("Password (admin): Temp: …", "Primary Key:
  …"), and so is a key at the end of its line, whose value is on the next line;
- a password inside brackets after a label ("password (for admin: …)"), and more keys on a line after a skipped key
  ("Passwords (LMS): admin: … trainer: …");
- a password behind a separator, such as "Password: -> …", a long arrow, a bullet, an emoji or a short mask, and a
  quoted password with a space;
- a password after a plural label: "Passwords: …", "Secrets: …", "API keys: …";
- an AWS access key followed straight away by a digit, a keycap or more capitals, or glued after a lowercase letter or
  "_".

These stay as pasted: a count, an amount or a plain word after token usage ("Max tokens: 4096",
`{"max_tokens": 4096}`, "Token budget/month: 25000", "GenAI token budget: $500/month", "Token budget: approved"), an
email address after "Send the password to:", the next field after a placeholder ("Password : ********    Role :
Admin", "Password login: Disabled  SSO: Azure AD"), a plain word inside brackets ("(Note: case sensitive)"), and a
key on the line after a label with words. The pasted-secret rule also finds a secret behind a separator or in curly
quotes or guillemets, but never takes a plain word such as "Pending" on its own. The shared text vectors grow from 99
to 324.

## ignitenx-tm 0.2.0

The agent now records a pasted tenant request in Tenant Manager as a **shadow request**. Nothing is provisioned,
reserved or messaged. Needs a Tenant Manager with the provisioning API (`/api/tm/provisioning/options` and
`/requests`).

- **`tpa_get_options`**: reads the partners, plans, languages, lists, defaults, servers and placement preview the agent
  may use. Only an allowlist of fields reaches the model, never a host or a credential, and the result is cached for
  the session.
- **`tpa_submit_request`**: takes the pasted text and a spec with a value, source, confidence and evidence quotes for
  every field, plus triage and flags. Before anything reaches TM it refuses:
  - a submit before the options were read;
  - an id or list value outside the options;
  - a server other than TM's placement suggestion, so the pasted text can never pick one;
  - a quote that isn't in the pasted text, and TM's length, evidence and free-text rules;
  - a secret in the summary, a note or any value, and a link in any free-text value: the title, page title, IdP
    display name, industry, requested environment or region, summary and notes (ids and emails are left to TM's
    formats);
  - a summary, note or value that repeats a secret of 4 or more characters the plugin replaced in the paste, even
    without its label. This rule is the plugin's own, because TM receives only the redacted paste.

  It then replaces the secrets in the pasted text with `[redacted]`, with the same text vectors as TM, and sends the
  rest as pasted, so TM strips and counts hidden characters itself and raises its `hidden_text` check. Both read
  hidden characters from TM's literal Unicode 16.0 tables (learnteqs/ignitenx#5007, #5021): an emoji selector (U+FE0F)
  stays only after an emoji drawn as text by default, the first one after an emoji already drawn in colour is removed
  without being counted, and any other is counted as hidden.
  - One submit per tpa-mcp process: a Claude session normally has one, and a reconnect starts a new process. A second
    submit gets `already_submitted`.
  - A spec TM rejects doesn't use up the session. After 3 rejections the next submit is refused with `too_many_attempts`.
  - A submit whose answer was lost is resent with the same id and body, so TM records it only once.
  - The result carries the request id, TM's checks and a **Review in TM** link, when `TM_UI_URL` is set. It also carries
    `redactions`, the secrets replaced by the plugin and by TM together, and `hiddenCharacters`, the hidden characters
    in the paste by kind.
- **Identity on every call**: after every token exchange, `/me` and the identity check run before the options or the
  submit, so an over-privileged key is refused even if the model skipped `tpa_get_identity`.
- **TM errors**: read as fixed codes and field errors. TM's own error text is no longer quoted to the model.
- **Scrubbed results**: every result the plugin's own handlers return is scrubbed of secret patterns, the key and the
  token. The MCP SDK's input-schema errors come back unscrubbed, and echo only the names of the model's own argument
  keys.
- **Server instructions**: the cycle's rules ship as the tpa-mcp server's MCP instructions, so they reach desktop
  sessions and routines, which don't expand slash commands. They cover email threads: the latest confirmed value wins,
  discussed-only values stay absent, and a thread still under discussion is recorded as such.
- **Hook**: allows exactly the three `tpa_*` tools. An allowed call still writes nothing to stdout, so Manual mode still
  asks before `tpa_submit_request`.
- **`/ignitenx-tm:poll`**: checks the identity, reads the options, and submits only a request pasted in the session.
  It pre-approves only `tpa_get_identity` and `tpa_get_options`, so Manual mode still asks before the submit, and the
  command is safe in the desktop.
- **Docs**: USAGE.md covers recording requests from the Claude desktop app in Manual mode, pinning the plugin by commit,
  the new key (one grant of `provisioning.submit` on named partners) and every error code the agent can stop with. It
  also corrects the reason not to grant `db.*`: `db.servers.view` doesn't imply `db.view` (#10).
- **Headless proof**: checks the three tools, and that the options come back from the stand-in Tenant Manager.

## ignitenx-tm 0.1.0

First release: the skeleton of the tenant-provisioning agent.

- **tpa-mcp**: a bundled MCP server with one tool, `tpa_get_identity`. It exchanges the Tenant Manager agent key for a
  short-lived token, calls `/me`, and refuses to continue in any of these cases:
  - the key holds anything beyond the agent's allowed permissions;
  - the key reports super-admin access;
  - Tenant Manager identifies the token as anyone other than this key.

  It never returns or logs the key or the token.
- **Key handling**: the key can come from `TM_AGENT_KEY_FILE` instead of the environment. The server refuses to run
  without certificate checks, or against a non-https Tenant Manager other than localhost, and it never follows a redirect.
- **Default-deny hook**: a `PreToolUse` hook denies every tool except this version's `tpa_*` tools, including
  built-in tools, other plugins and claude.ai connectors.
  - It blocks with exit code 2, even under `bypassPermissions`.
  - It runs `node` directly with no shell, so it behaves the same under bash, pwsh and Windows PowerShell.
  - If `node` itself can't start, Claude Code lets the tool run. That's why the documented runner flags are required.
- **`/ignitenx-tm:poll`**: runs the identity check that starts every agent cycle.
- **Headless proof**: `npm run proof:headless` checks real `claude -p` runs against a stand-in Tenant Manager. It
  covers the plugin loading, the tool working, the hook firing, and a harmless canary being denied. A hostile
  `bypassPermissions` prompt then must have every other tool denied, with no side effect and no key in the transcript.
  The hostile run is skipped unless the canary passed.

## ignitenx-lms 1.0.5

API-alignment pass against the live IgniteNX backend (demo-readiness):

- **Rollout**: `noOfDays` → **`timeToComplete`** in all examples/field tables (`ignitenx-api`, `lms-workflow`,
  `assign`, `create-sop`). This was a demo-blocking mismatch.
- **create-sop**: rollout criteria field `filterList` → **`queryProperty`**.
- **E-learning**: documented the child-items flow — `POST /childItems` (link), `GET /childItemByParent/:id`
  (admin list), with the verified payload `{childId, parentId, name, type, sequenceNumber}`.
- **Training**: removed the non-existent `mandatory` field; corrected `trainingCompletionCriteria`
  (`0 Attendance, 1 AttendanceAndPostAssessment, 2 AttendancePostAssessmentAndFeedback, 3 AttendanceAndFeedback`)
  and `trainingLibraryCriteria` (`0 None, 1 OnCompletingPreAssessment, 2 CompletingEvent`).
- **Item types**: added `17 Go1`, `18 LinkedIn`, `19 Declaration`, `28 CMI5`.
- **Content recipes**: added per-content-type `POST /items` recipes (document, audio, video, YouTube,
  video-with-questions, SCORM via `scormUploadInit`, xAPI, AICC, flashcard, embed, page, URL).
- **Reminders**: added types `4 Consolidate Manager Feedback`, `5 Attendance`.
- **Lookups**: noted `lookupbusinessentities` requires the tenant Business Entity feature (404 if disabled).
- **Responses**: clarified `POST /upload` (full Item, only `id`/`url` populated) and `POST /items`
  (echoes request body; fetch `GET /items/:id` for stored record).
