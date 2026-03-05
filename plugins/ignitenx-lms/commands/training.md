# /lms:training

Manage instructor-led training (ILT) — create trainings, schedule events, enroll users, and track attendance.

> **Important**: Training = ILT. They are the same concept. Creating a training via `/trainings` API internally creates an item with `type=8`.

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

The `X-User-ID` header is **not needed** — middleware extracts it from the Bearer token automatically.

## Workflow

1. **Ask what to do**:
   - Create a new training (ILT) program
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
       "trainingCode": "<unique-code>",
       "objectives": "<training-objectives>",
       "effectiveMethodology": "<teaching-methodology>",
       "trainingMode": 1,
       "enrollmentType": 0,
       "accessType": 1,
       "trainingCompletionCriteria": 0,
       "trainingLibraryCriteria": 0,
       "completionPercentage": 100,
       "mandatory": true,
       "allowSelfEnrolWithAttendance": true
     }'
   ```

   **Required fields**: `name`, `trainingCode`, `objectives`, `effectiveMethodology`, `trainingMode`, `enrollmentType`, `accessType`, `trainingCompletionCriteria`, `trainingLibraryCriteria`, `completionPercentage`

   trainingMode: 0=Hybrid, 1=Classroom, 2=Online
   trainingCompletionCriteria: 0=Attendance, 1=PostAssessment, 2=Feedback
   trainingLibraryCriteria: 0=NA, 1=Mandatory, 2=Optional

   `allowSelfEnrolWithAttendance` (optional): enables walk-in enrollment for events under this training.

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
         "status": 0,
         "scheduleType": 0,
         "maximumParticipants": 30,
         "walkInEnabled": true
       },
       "sessions": [{
         "name": "Session 1",
         "startTime": "<start-datetime>",
         "endTime": "<end-datetime>",
         "duration": <minutes>,
         "status": 0,
         "hostLink": "<meeting-link-for-trainer>",
         "joinLink": "<meeting-link-for-participants>"
       }]
     }'
   ```

   **Event required fields**: `name`, `date`, `trainingId`, `status` (default 0), `scheduleType`
   **Session required fields**: `name`, `startTime`, `endTime`, `duration`, `status` (default 0)
   **Session optional fields**: `hostLink`, `joinLink` (only for online/virtual sessions — offline/classroom sessions don't need meeting links), `trainerId`, `trainingRoomId`

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
