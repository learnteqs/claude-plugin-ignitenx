---
name: lms-workflow
description: Standard L&D workflows for content lifecycle, ILT management, notifications, approvals, and reporting in igniteNX
---

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
  curl -s "$BASE_URL/api/app/$TENANT/items?skip=0&limit=50" \
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
  **type values**: `0`=Url, `1`=Document, `2`=Audio, `3`=Video, `5`=SCORM

- Verify published content:
  ```bash
  curl -s "$BASE_URL/api/app/$TENANT/items/$ITEM_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID"
  ```

### 5. Rollout (Assign content to audience)
- Identify target audience using lookup endpoints to get criteria value IDs:
  ```bash
  # Get department IDs (or use lookuplocations, lookupgrades, etc.)
  curl -s "$BASE_URL/api/app/$TENANT/lookupdepartments" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Role-ID: $ROLE_ID"
  ```
- Create a criteria-based rollout to assign content with deadline:
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
      "timeToComplete": 28,
      "accessType": 4,
      "queryProperty": [{"key": "department", "value": ["<dept-id>"]}],
      "myLearning": true,
      "mandatory": true
    }'
  ```

  **accessType**: `0`=Internal, `1`=Private, `2`=External, `3`=Everyone, `4`=Criteria (uses `queryProperty`).

  **Supported `queryProperty` keys**: `department`, `location`, `designation`, `grade`, `level`, `cost_centre`, `organisation_unit`, `business_entity`. Multiple criteria use AND logic.

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

First list session users to get `eventSessionUserId` values, then mark attendance:
```bash
# Get enrolled session users
curl -s "$BASE_URL/api/app/$TENANT/eventsessionusers/<session-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"

# Mark attendance (body is an ARRAY of objects)
curl -s -X POST "$BASE_URL/api/app/$TENANT/sessions/<session-id>/attendance" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '[
    {"eventSessionUserId": "<session-user-id-1>", "attendance": true},
    {"eventSessionUserId": "<session-user-id-2>", "attendance": true}
  ]'
```

Alternatively, enroll + mark attendance in one step via `sessionusers/bulk` with `"markAttendance": true`.

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

## Notification Inbox Workflow

The sections above cover **sending** notifications. This section covers the **receiving** side — checking and managing in-app notifications.

> **Important**: All inbox endpoints use `/api/notifications/$TENANT/` (NOT `/api/app/$TENANT/`).

### 1. Check Unread Notification Count
```bash
UNREAD=$(curl -s "$BASE_URL/api/notifications/$TENANT/userunreadcount" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID")
echo "$UNREAD" | jq '.count'
```
Returns count plus up to 3 most recent unread notifications as a preview.

### 2. Read Full Notification Inbox
```bash
curl -s "$BASE_URL/api/notifications/$TENANT/usernotifications?limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Use `q` parameter to search by subject: `?q=safety+training`.

### 3. Mark Individual Notification as Read
```bash
curl -s -X PUT "$BASE_URL/api/notifications/$TENANT/notification/<notification-id>/read" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### 4. Mark All Notifications as Read
```bash
curl -s -X PUT "$BASE_URL/api/notifications/$TENANT/mark-all-as-read" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### 5. View Notification Logs (Admin)
```bash
curl -s "$BASE_URL/api/notifications/$TENANT/logs?limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Supports filters: `senderName`, `userName`, `subject`, `notificationName`, `status` (pending/scheduled/succeeded/failed), `type` (email/push/sms/desktop), `createdAt` (YYYY-MM-DD or range).

Count logs: `GET /api/notifications/$TENANT/logs/count` (same filters).

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

**Available templates**: `UserDetailsReport`, `CourseUserReport`, `TestUserReport`, `TrainingSummaryReport`, `TrainingEventsReport`, `ConsolidatedMISReport`, `TrainingHoursReport`, `LearningHoursReport`, `ComplianceReport`, `LibraryUsageReport`

---

## Approval Workflow

Multi-step approval processes can be configured for content enrollment, deadline extensions, additional assessment attempts, event nominations, and participant cancellations.

### 1. Configure Approval Process (one-time setup)

List available roles for approval steps:
```bash
ROLES=$(curl -s "$BASE_URL/api/app/$TENANT/approvalroles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID")
echo "$ROLES" | jq '.roles'
```

Create an approval process with the desired step sequence:
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/approvalprocesses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"name": "Manager + HR Approval", "steps": ["<role-id-1>", "<role-id-2>"], "default": false}'
```

Map the process to approval types:
```bash
curl -s -X PUT "$BASE_URL/api/app/$TENANT/approvaltypesbulk" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '[
    {"approvalTypeId": 0, "approvalProcessId": "<process-id>"},
    {"approvalTypeId": 3, "approvalProcessId": "<process-id>"}
  ]'
```

Type IDs: `0` = Item enrollment, `1` = Deadline extension, `2` = Additional attempts, `3` = Event nomination, `13` = Participant cancellation. Set `approvalProcessId` to `null` to disable.

### 2. Enrollment Triggers Approval

When `approvalRequired: true` is set on a training or content item, enrollment via `/items/:id/enroll` or `/events/:id/enroll` automatically creates an approval request. The response includes `"requiresApproval": true`. Returns 409 if a pending request already exists.

### 3. Check Pending Approvals (Approver)
```bash
PENDING=$(curl -s "$BASE_URL/api/app/$TENANT/approvalinstances/pending?limit=10&offset=0" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID")
echo "$PENDING" | jq '.pending_approvals'
```
Present each pending item with: request name, type, requestor name, current step, date submitted.

### 4. Approve or Reject
```bash
curl -s -X PUT "$BASE_URL/api/app/$TENANT/approvalinstances/<instance-id>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"status": 1, "approverRemarks": "Approved, proceed.", "approverInputs": 0}'
```
Status: `1` = Approved, `2` = Rejected. `approverRemarks` is **required**. Returns 409 if already handled.

### 5. Check Request Status (Requestor)
```bash
MY_REQUESTS=$(curl -s "$BASE_URL/api/app/$TENANT/approvalrequests?mine=true&limit=100&offset=0" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID")
echo "$MY_REQUESTS" | jq '.approval_requests[] | {name, status, currentStepName}'
```
Status: `0` = Pending, `1` = Approved, `2` = Rejected. Each request includes a `steps` array showing the timeline of all approval steps.

### 6. Request Deadline Extension
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/itemusers/<item-user-id>/extend" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"itemId": "<content-id>", "requestorRemarks": "Need 7 more days to complete", "requestorInput": 7}'
```
Creates an approval request routed through the configured process for type `1` (ItemDays).

### 7. Request Additional Assessment Attempts
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/attempts/request" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{
    "itemUserId": "<item-user-id>",
    "childItemUserId": "<child-item-user-id>",
    "itemId": "<assessment-id>",
    "requestorRemarks": "Need one more attempt",
    "requestorInput": 1,
    "assessmentType": 2
  }'
```
Creates an approval request routed through the configured process for type `2` (AdditionalAttempts). `assessmentType`: `0` = Assessment, `1` = Pre, `2` = Post, `3` = PreEvent, `4` = PostEvent.

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

1. **Content Review**: SME validates technical accuracy (handled outside the system or via manual approval process)
2. **L&D Review**: L&D team reviews pedagogy and formatting
3. **Compliance Review**: (if applicable) Legal/compliance sign-off
4. **Enrollment Approval**: When `approvalRequired` is set on content or events, enrollment triggers a multi-step approval process. Configure via `approvalprocesses` and `approvaltypes` APIs (see Approval Workflow section above).
5. **Publication Approval**: Final go-ahead to publish and rollout

> Multi-step approval workflows are configured via Settings > Approvals in the dashboard. The API is documented in the Approval Flow section of the API reference (`ignitenx-api` skill).
