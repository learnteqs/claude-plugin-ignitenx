# /lms:check-email

Parse training requests from email.

## Usage

```
/lms:check-email
```

## Description

This command reads local email files (synced via Outlook/Gmail desktop or IMAP cron) and extracts actionable training requests.

## Authentication

Ensure the session is authenticated before running API calls. See `skills/ignitenx-api.md` for the authentication steps.

```bash
BASE_URL="https://app.ignitenx.com"
TENANT=$(echo $IGNITENX_API_KEY | cut -d'_' -f2)
ROLE_ID=$(echo $IGNITENX_API_KEY | cut -d'_' -f3)

TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/$TENANT/apikey-login" \
  -H "Content-Type: application/json" \
  -d "{\"api_key\": \"$IGNITENX_API_KEY\"}" | jq -r '.access_token')
```

## Workflow

1. **Locate email source**. Ask the user for the path to their synced email folder or specific .eml/.msg file.

2. **Read and parse** the email content. Extract:
   - **Sender**: who is requesting
   - **Topic**: what training/SOP is needed
   - **Scope**: which processes, systems, or areas
   - **Audience**: who needs to be trained
   - **Urgency**: any deadlines mentioned
   - **Compliance**: regulatory or certification requirements

3. **Summarize** the extracted request in a structured format.

4. **Suggest next steps** based on the request:
   - Check if content already exists:
     ```bash
     curl -s "$BASE_URL/api/app/$TENANT/items?search=<topic>&skip=0&limit=20" \
       -H "Authorization: Bearer $TOKEN" \
       -H "X-Role-ID: $ROLE_ID"
     ```
   - If new content needed: suggest `/lms:create-sop`
   - If content exists: suggest `/lms:assign`

5. **Ask the user** which action to take.

## Supported Email Formats

- `.eml` files (standard MIME format)
- `.msg` files (Outlook format)
- Plain text email body (pasted into conversation)
- Email forwarded as text

## Example Interaction

User: "Check my latest email from the ops manager about forklift training"
