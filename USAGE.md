# igniteNX Cowork Plugin Usage Guide

This guide walks an L&D admin through one-time setup and daily use from Claude Desktop's Cowork tab.

## One-Time Setup

1. Create an API key in the igniteNX portal (admin only):
   `Profile Settings -> Security -> Manage API Keys`

2. Set the API key environment variable.
   ```bash
   export IGNITENX_API_KEY="inx_<tenant>_<roleId>_<uuid>"
   ```
   PowerShell:
   ```powershell
   $env:IGNITENX_API_KEY = "inx_<tenant>_<roleId>_<uuid>"
   ```

3. Customize company context for your organization:
   `cli-cowork-plugin/skills/company-context.md`

4. Install the plugin in Claude Desktop:
   `Cowork tab -> Customize -> Add plugin -> select cli-cowork-plugin/`

Notes:
- Tenant and role ID are parsed automatically from `IGNITENX_API_KEY`.
- Default base URL is `https://app.ignitenx.com` (edit `skills/ignitenx-api.md` for your deployment).
- All API calls use curl directly — no CLI binary required.

## Authentication

The plugin authenticates via API key. Each session runs:

```bash
BASE_URL="https://app.ignitenx.com"

TENANT=$(echo $IGNITENX_API_KEY | cut -d'_' -f2)
ROLE_ID=$(echo $IGNITENX_API_KEY | cut -d'_' -f3)

TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/$TENANT/apikey-login" \
  -H "Content-Type: application/json" \
  -d "{\"api_key\": \"$IGNITENX_API_KEY\"}" | jq -r '.access_token')
```

All subsequent API calls include both headers:
```bash
-H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID"
```

## Daily Workflow in Cowork Tab

### 1) Intake request from email: `/lms:check-email`

Example:
```
/lms:check-email
```

Prompt to Claude:
- "Check the latest email from Ops about forklift safety training."

Expected outcome:
- Structured summary: requester, topic, target audience, urgency, compliance needs.
- Recommendation to create new SOP or reuse existing content.

### 2) Draft training content: `/lms:create-sop`

Example:
```
/lms:create-sop
```

Prompt to Claude:
- "Create a forklift battery charging SOP for warehouse associates and shift leads."

Expected outcome:
- Draft SOP using the matching template.
- Review loop with edits.
- Final document ready for publish (PDF or DOCX).

### 3) Publish content: `/lms:publish`

Example:
```
/lms:publish
```

Prompt to Claude:
- "Publish `C:\Training\SOPs\Forklift-Battery-Charging-v1.pdf` as 'Forklift Battery Charging SOP', category 'Safety'."

Expected outcome:
- Upload to igniteNX via curl multipart form.
- Returned content ID confirmed and ready for rollout.

### 4) Assign content to learners: `/lms:assign`

Example:
```
/lms:assign
```

Prompt to Claude:
- "Assign the forklift battery charging SOP to Warehouse group with a due date in 14 days."

Expected outcome:
- Rollout created for the target group/department.
- Item users auto-created for matched users.
- Due date and assignment counts confirmed.

### 5) Monitor progress: `/lms:status`

Example:
```
/lms:status
```

Prompt to Claude:
- "Show completion and overdue status for the forklift battery charging SOP."

Expected outcome:
- Completion %, overdue users/items, and suggested follow-up actions (reminders, deadline changes, escalation).

## End-to-End Example Scenario

1. Run `/lms:check-email` for an operations request: "Forklift incidents increased; mandatory refresher needed this month."
2. Run `/lms:create-sop` to draft and finalize "Forklift Battery Charging SOP".
3. Run `/lms:publish` to upload the SOP and capture the returned content ID.
4. Run `/lms:assign` to create a rollout for the `Warehouse` group with an explicit due date.
5. Run `/lms:status` after 3-5 days to review completion and overdue counts.
6. If overdue is high, send reminders and escalate per your `skills/company-context.md` escalation path.
