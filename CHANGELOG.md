# Changelog

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
