# /lms:training

Manage instructor-led training (ILT) — create trainings, schedule events, enroll users, and track attendance.

## Usage

```
/lms:training
```

## Description

This command helps manage the full ILT lifecycle: training creation, event scheduling with sessions, user enrollment, attendance tracking, and sending session reminders.

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

1. **Ask what to do**:
   - Create a new training program
   - Schedule an event for an existing training
   - Enroll users in a session
   - Mark attendance
   - Send session reminders
   - View training status

2. **Create training** (if new):
   ```bash
   curl -s -X POST "$BASE_URL/api/app/$TENANT/trainings" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '{
       "name": "<training-name>",
       "trainingMode": 1,
       "enrollmentType": 0,
       "accessType": 1,
       "trainingCompletionCriteria": 0,
       "mandatory": true
     }'
   ```
   trainingMode: 0=Hybrid, 1=Classroom, 2=Online

3. **Schedule event with session**:
   ```bash
   curl -s -X POST "$BASE_URL/api/app/$TENANT/events" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '{
       "event": {
         "name": "<event-name>",
         "date": "<start-datetime>",
         "endDate": "<end-datetime>",
         "trainingId": "<training-id>",
         "scheduleType": 0,
         "maximumParticipants": 30
       },
       "sessions": [{
         "name": "Session 1",
         "startTime": "<start-datetime>",
         "endTime": "<end-datetime>"
       }]
     }'
   ```

4. **Enroll users**:
   ```bash
   curl -s -X POST "$BASE_URL/api/app/$TENANT/sessionusers/bulk" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '{
       "eventId": "<event-id>",
       "sessionId": "<session-id>",
       "userIds": ["<user-id-1>", "<user-id-2>"],
       "markAttendance": false
     }'
   ```

5. **Send session reminder**:
   ```bash
   curl -s -X POST "$BASE_URL/api/notifications/$TENANT/remainder/<session-id>?type=session&notificationName=SessionReminder" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```

6. **Mark attendance**:
   ```bash
   curl -s -X POST "$BASE_URL/api/app/$TENANT/sessions/<session-id>/attendance" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '{"userIds": ["<user-id-1>", "<user-id-2>"]}'
   ```

7. **Report** the result: training created, event scheduled, users enrolled, attendance recorded.

## Example Interaction

User: "Schedule a fire safety training for next week with 20 max participants and enroll the warehouse team"
