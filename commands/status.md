# /lms:status

Check assignment and training completion status.

## Usage

```
/lms:status
```

## Description

This command provides a quick overview of training progress — completion rates, overdue items, and per-user status.

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

1. **Ask what to check**:
   - Overall dashboard status
   - Status for a specific content item
   - Event status for trainings
   - Training hours analytics

2. **For overall dashboard** — get assignment status counts:
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/itemuserstatuscount" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Present: not started, in progress, completed, overdue counts.

3. **For specific content** — check assignment status:
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/itemuserUsage/<content-id>" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Present: total assigned, completed, in-progress, not started, overdue.

4. **For event status** — get event counts:
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/eventStatusCount?trainingId=<optional-training-id>" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Present: scheduled, rescheduled, cancelled, completed, in-progress events.

5. **For training hours** — get analytics:
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/trainingHoursAndAveragePerEmployee?trainingId=<optional-id>" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Present: total hours, average per employee, man days.

6. **Suggest actions** based on results:
   - If overdue > 20%: recommend sending notifications:
     ```bash
     curl -s -X POST "$BASE_URL/api/notifications/$TENANT/remainder/<rollout-id>?type=rollout&notificationName=CourseReminder" \
       -H "Authorization: Bearer $TOKEN" \
       -H "X-Role-ID: $ROLE_ID"
     ```
   - If completion < 50%: recommend extending deadlines or re-assigning
   - If fully complete: congratulate and suggest archiving old content
