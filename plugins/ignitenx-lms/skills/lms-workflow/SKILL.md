# L&D Workflow Guide

This skill describes the standard L&D workflows for processing training requests, SOPs, and instructor-led training using igniteNX.

> **Important**: Training = ILT (Instructor-Led Training). They are the same concept. Use the `/trainings` API to manage ILT programs — this internally creates an item with `type=8`.

## Authentication (run once per session)

Before using any API calls, authenticate and set up variables. Only `IGNITENX_API_KEY` is required as an environment variable.

```bash
BASE_URL="https://app.ignitenx.com"

TENANT=$(echo $IGNITENX_API_KEY | cut -d'_' -f2)
ROLE_ID=$(echo $IGNITENX_API_KEY | cut -d'_' -f3)

TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/$TENANT/apikey-login" \
  -H "Content-Type: application/json" \
  -d "{\"api_key\": \"$IGNITENX_API_KEY\"}" | jq -r '.access_token')
```

All subsequent API calls require both headers:
```bash
-H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID"
```

The `X-User-ID` header is **not needed** — middleware extracts it from the Bearer token automatically.

## End-to-End Content Workflow

### 1. Request Intake
- L&D admin receives a training request (via email, Slack, or ticket)
- Extract: **topic**, **scope**, **target audience**, **urgency**, **compliance requirement**

### 2. Content Assessment
- Check if existing content covers the topic:
  ```bash
  curl -s "$BASE_URL/api/app/$TENANT/items?skip=0&limit=20&search=<topic+keywords>" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID"
  ```
- If existing content found, skip to Step 5 (Rollout)
- If not, proceed to content creation

### 3. Content Creation (SOP/Training Material)
- Draft the SOP or training material using appropriate template
- Review cycle: draft -> review -> revise -> approve
- Standard SOP structure:
  1. Purpose & Scope
  2. Definitions & Abbreviations
  3. Responsibilities
  4. Procedure (step-by-step)
  5. References
  6. Revision History

### 4. Publishing
Upload uses a 3-step SAS URL flow (do NOT use multipart form):

- **Step 1** - Request SAS upload URL:
  ```bash
  SAS_RESP=$(curl -s -X POST "$BASE_URL/api/app/$TENANT/upload" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID" \
    -d '{"fileName": "document.pdf", "folder": "Document", "id": null}')
  ITEM_ID=$(echo $SAS_RESP | jq -r '.id')
  SAS_URL=$(echo $SAS_RESP | jq -r '.url')
  ```

- **Step 2** - Upload file to SAS URL (no auth headers needed):
  ```bash
  curl -s -X PUT "$SAS_URL" \
    -H "x-ms-blob-type: BlockBlob" \
    -H "Content-Type: application/pdf" \
    --data-binary @./document.pdf
  ```

- **Step 3** - Create item metadata:
  ```bash
  CLEAN_URL=$(echo "$SAS_URL" | cut -d'?' -f1)
  curl -s -X POST "$BASE_URL/api/app/$TENANT/items" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID" \
    -d "{
      \"id\": \"$ITEM_ID\",
      \"name\": \"Title Here\",
      \"description\": \"Description here\",
      \"type\": 1,
      \"sourceType\": 1,
      \"fileName\": \"document.pdf\",
      \"url\": \"$CLEAN_URL\"
    }"
  ```

  **folder values**: `Document`, `Video`, `Audio`, `Announcement`, `LibraryItem`
  **type values**: `1`=Document, `2`=Video, `3`=URL, `4`=Scorm, `20`=Audio

- Verify published content:
  ```bash
  curl -s "$BASE_URL/api/app/$TENANT/items?search=Title+Here" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID"
  ```

### 5. Rollout (Assign content to audience)
- Identify target audience:
  ```bash
  curl -s "$BASE_URL/api/app/$TENANT/departments?skip=0&limit=20" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID"

  curl -s "$BASE_URL/api/app/$TENANT/listusers?department=<dept-name>&skip=0&limit=20" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID"
  ```
- Create a rollout to assign content with deadline:
  ```bash
  curl -s -X POST "$BASE_URL/api/app/$TENANT/rollout" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID" \
    -d '{
      "name": "Rollout Name",
      "itemId": "<content-id>",
      "startDate": "2026-03-04T00:00:00Z",
      "endDate": "2026-04-01T00:00:00Z",
      "noOfDays": 28,
      "accessType": 4,
      "queryProperty": [{"key": "department", "value": ["<dept-id>"]}],
      "myLearning": true,
      "mandatory": true
    }'
  ```

  When `myLearning` is `true`, item users are auto-created for all matched users.

### 6. Manual Assignment (optional)
- For individual user assignments not covered by rollout criteria:
  ```bash
  curl -s -X POST "$BASE_URL/api/app/$TENANT/itemuser" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID" \
    -d '{"itemId": "<content-id>", "userId": "<user-id>", "rolloutId": "<rollout-id>"}'
  ```

### 7. Monitoring & Follow-up
- Check assignment status:
  ```bash
  curl -s "$BASE_URL/api/app/$TENANT/itemuserUsage/<content-id>" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID"
  ```
- View dashboard overview:
  ```bash
  curl -s "$BASE_URL/api/app/$TENANT/itemuserstatuscount" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID"
  ```
- Send notification for overdue users in a rollout:
  ```bash
  curl -s -X POST "$BASE_URL/api/notifications/$TENANT/remainder/<rollout-id>?type=rollout&notificationName=CourseReminder" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID"
  ```
- Generate reports:
  ```bash
  curl -s -X POST "$BASE_URL/api/app/$TENANT/reports/CourseUserReport" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID" \
    -d '{}'
  ```

---

## Instructor-Led Training (ILT) Workflow

Training = ILT. The full workflow: Create Training -> Schedule Event with Sessions -> Enroll Users -> Track Attendance.

### 1. Create Training Type (if needed)
Check existing training types first:
```bash
curl -s "$BASE_URL/api/app/$TENANT/trainingtypes?skip=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### 2. Create Training (ILT)
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/trainings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{
    "name": "Fire Safety Training",
    "description": "Annual fire safety certification",
    "trainingCode": "FST-2026",
    "objectives": "Understand fire prevention, evacuation procedures, and extinguisher use",
    "effectiveMethodology": "Classroom lecture with hands-on fire drill",
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

### 3. Create Event with Sessions
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/events" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{
    "event": {
      "name": "March Fire Safety Session",
      "date": "2026-03-15T09:00:00Z",
      "endDate": "2026-03-15T17:00:00Z",
      "trainingId": "<training-id>",
      "status": 0,
      "scheduleType": 0,
      "maximumParticipants": 30,
      "walkInEnabled": true
    },
    "sessions": [{
      "name": "Session 1",
      "startTime": "2026-03-15T09:00:00Z",
      "endTime": "2026-03-15T17:00:00Z",
      "duration": 480,
      "status": 0,
      "hostLink": "https://meet.example.com/host/abc",
      "joinLink": "https://meet.example.com/join/abc"
    }]
  }'
```

**Event required fields**: `name`, `date`, `trainingId`, `status`, `scheduleType`
**Session required fields**: `name`, `startTime`, `endTime`, `duration`, `status`
**Session optional fields**: `hostLink`, `joinLink` (only needed for online/virtual sessions — offline/classroom sessions don't need meeting links)

### 4. Enroll Users
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

### 5. Send Session Reminder
```bash
curl -s -X POST "$BASE_URL/api/notifications/$TENANT/remainder/<session-id>?type=session&notificationName=SessionReminder" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### 6. Mark Attendance
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/sessions/<session-id>/attendance" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"userIds": ["<user-id-1>", "<user-id-2>"]}'
```

### 7. Track Training Hours
```bash
curl -s "$BASE_URL/api/app/$TENANT/trainingHoursAndAveragePerEmployee?trainingId=<training-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

---

## Notification & Reminder Workflow

### Sending Notifications (immediate)
Use the notifications service to send notifications now. No `X-User-ID` header needed — extracted from Bearer token.

```bash
# For a rollout (course reminder)
curl -s -X POST "$BASE_URL/api/notifications/$TENANT/remainder/<rollout-id>?type=rollout&notificationName=CourseReminder" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"

# For a session (session reminder)
curl -s -X POST "$BASE_URL/api/notifications/$TENANT/remainder/<session-id>?type=session&notificationName=SessionReminder" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"

# Consolidated (all pending courses per user)
curl -s -X POST "$BASE_URL/api/notifications/$TENANT/remainder/<rollout-id>?type=consolidate&notificationName=ConsolidateReminder" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Managing Automated Reminders (schedules)
Reminders are configuration objects that control automated notification schedules:

```bash
# List reminder configurations
curl -s "$BASE_URL/api/app/$TENANT/reminders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"

# Enable/disable a reminder
curl -s -X PUT "$BASE_URL/api/app/$TENANT/reminders/<reminder-id>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"active": true}'
```

**Key distinction**: Reminders = automated schedules (daily/weekly/monthly). Notifications = manual or triggered sends.

---

## Dashboard Monitoring

### Assignment Overview
```bash
curl -s "$BASE_URL/api/app/$TENANT/itemuserstatuscount" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Returns: not started, in progress, completed, overdue counts.

### Event Status Overview
```bash
curl -s "$BASE_URL/api/app/$TENANT/eventStatusCount?trainingId=<optional-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Returns: scheduled, rescheduled, cancelled, completed, in-progress counts.

### Training Hours
```bash
curl -s "$BASE_URL/api/app/$TENANT/trainingHoursAndAveragePerEmployee?trainingId=<optional-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Returns: total training hours, average per employee, man days.

---

## Report Generation Workflow

### 1. Generate report
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/reports/<template-name>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"department": "HR"}'
```

### 2. Check report status
```bash
curl -s "$BASE_URL/api/app/$TENANT/reports?skip=0&limit=5" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Status: `0` = Queued, `1` = Generating, `2` = Succeeded, `3` = Failed

### 3. Download completed report
```bash
curl -s "$BASE_URL/api/app/$TENANT/downloadreport/<report-table>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

**Available templates**: `UserDetailsReport`, `CourseUserReport`, `TestUserReport`, `TrainingSummaryReport`, `TrainingDetailsReport`, `ConsolidatedMISReport`, `TrainingHoursReport`, `LearningHoursReport`, `ComplianceReport`, `LibraryUsageReport`

---

## Content Categorization Taxonomy

| Category | Use For |
|----------|---------|
| Safety | Safety SOPs, emergency procedures, PPE guidelines |
| Process | Operational procedures, workflows, checklists |
| Onboarding | New hire orientation, role-specific training |
| Compliance | Regulatory training, certifications, audits |
| Technical | Software training, system guides, technical manuals |
| Soft Skills | Leadership, communication, teamwork |
| Policy | Company policies, code of conduct, HR guidelines |

## Urgency Levels

| Level | Timeline | Action |
|-------|----------|--------|
| Critical | Same day | Publish immediately, rollout with 1-day deadline |
| High | 1-3 days | Draft, review, publish within 3 days |
| Normal | 1-2 weeks | Standard workflow with full review cycle |
| Low | 2-4 weeks | Queue for next content batch |

## Approval Gates

1. **Content Review**: SME validates technical accuracy
2. **L&D Review**: L&D team reviews pedagogy and formatting
3. **Compliance Review**: (if applicable) Legal/compliance sign-off
4. **Publication Approval**: Final go-ahead to publish and rollout
