# /lms:notifications

Check and manage your notification inbox — unread count, read notifications, mark as read, and view delivery logs.

## Usage

```
/lms:notifications
```

## Description

This command manages the in-app notification inbox: checking unread count, reading notifications with search, marking individual or all notifications as read, and viewing notification delivery logs (admin).

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

> **Important**: All notification inbox endpoints use `/api/notifications/$TENANT/` (NOT `/api/app/$TENANT/`).

## Workflow

1. **Ask what to check**:
   - Unread notification count and preview
   - Full notification inbox (with optional search)
   - Notification delivery logs (admin view)

2. **For unread count** — show count and preview:
   ```bash
   curl -s "$BASE_URL/api/notifications/$TENANT/userunreadcount" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Returns `{"count": <number>, "data": [...]}` — `data` contains up to 3 most recent unread notifications with subject, sender, and date.

3. **For inbox** — list notifications with optional search:
   ```bash
   curl -s "$BASE_URL/api/notifications/$TENANT/usernotifications?limit=20&offset=0" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Use `q` parameter to search by subject: `?q=safety`.

   Present each notification with: sender name, subject, date. Support pagination with `offset`.

4. **Mark as read** — after viewing a notification:
   ```bash
   # Mark single notification as read
   curl -s -X PUT "$BASE_URL/api/notifications/$TENANT/notification/<notification-id>/read" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Response: `{"status": "ok", "updated": 1}`

   If many unread, offer to mark all as read:
   ```bash
   curl -s -X PUT "$BASE_URL/api/notifications/$TENANT/mark-all-as-read" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Response: `{"status": "ok", "updated": <number>, "unreadCount": 0}`

5. **For notification logs (admin)** — view delivery history:
   ```bash
   curl -s "$BASE_URL/api/notifications/$TENANT/logs?limit=20&offset=0" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```

   Supported filter query params (all optional):
   - `senderName` — filter by sender (regex)
   - `userName` — filter by recipient
   - `subject` — filter by subject
   - `notificationName` — filter by notification type
   - `status` — exact: `pending`, `scheduled`, `succeeded`, `failed`
   - `type` — exact: `email`, `push`, `sms`, `desktop`
   - `createdAt` — date `YYYY-MM-DD` or range `YYYY-MM-DD,YYYY-MM-DD`

   Count logs:
   ```bash
   curl -s "$BASE_URL/api/notifications/$TENANT/logs/count" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Returns `{"count": <number>}`. Accepts the same filter params.

6. **Suggest actions** based on results:
   - If many unread: offer to mark all as read
   - If searching: support paginated browsing with offset
   - If logs show failures: suggest investigating delivery issues

## Example Interaction

User: "How many unread notifications do I have?"
User: "Show my notification inbox and mark the safety training one as read"
User: "Show notification logs for the last week filtered by subject 'fire safety'"
User: "Mark all my notifications as read"
