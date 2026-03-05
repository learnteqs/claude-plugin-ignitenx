# igniteNX API Reference

Programmatic access to the igniteNX LMS platform via curl. All services share the same base URL — Azure Front Door routes by path prefix.

> **Important**: Training = ILT (Instructor-Led Training). They are the same concept. Use the `/trainings` API to create ILT programs — this internally creates an item with `type=8`. Do NOT create trainings via `/items` directly.

## Configuration

```bash
BASE_URL="https://app.ignitenx.com"
```

The only required environment variable:
```bash
export IGNITENX_API_KEY="inx_<tenant>_<roleId>_<uuid>"
```

## Authentication

Extract tenant, role ID, and obtain a JWT token. The auth endpoint needs **no** `Authorization` or `X-Role-ID` headers.

```bash
TENANT=$(echo $IGNITENX_API_KEY | cut -d'_' -f2)
ROLE_ID=$(echo $IGNITENX_API_KEY | cut -d'_' -f3)

TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/$TENANT/apikey-login" \
  -H "Content-Type: application/json" \
  -d "{\"api_key\": \"$IGNITENX_API_KEY\"}" | jq -r '.access_token')
```

All subsequent **app API** calls require both headers:
```bash
-H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID"
```

Token is cached locally with auto-refresh. No need to re-authenticate for each call.

The `X-User-ID` header is **not needed** — middleware extracts the user identity from the Bearer token automatically.

## Item Type Enum Reference

The `/items` endpoint handles ALL content types. The `type` field (integer) distinguishes them:

| Value | Name | Description |
|-------|------|-------------|
| 0 | Url | External URL link |
| 1 | Document | PDF, DOCX, PPTX, DOC, PPT |
| 2 | Audio | MP3, WAV, M4A, AAC, OGG |
| 3 | Video | MP4, AVI, MOV, MKV, WEBM |
| 4 | FlashCard | Flash card content (ZIP) |
| 5 | SCORM | SCORM package (ZIP) |
| 6 | ExperienceAPI | xAPI content (ZIP) |
| 7 | Assessment | Test/Assessment |
| 8 | Training | ILT training item (use `/trainings` API instead) |
| 10 | Embed | Embedded HTML content |
| 11 | Page | Page content |
| 12 | VideoWithQuestions | Video with embedded questions |
| 13 | Course | Course (grouping of items) |
| 14 | CourseraCourse | Coursera integration |
| 15 | UdemyCourse | Udemy integration |
| 21 | Poll | Poll |
| 22 | Survey | Survey |
| 23 | Feedback | Feedback form |
| 24 | Elearning | E-learning content (parent with child items) |
| 25 | AICC | AICC package (ZIP) |
| 26 | Announcement | Announcement |
| 27 | LearningPath | Learning path |

Additional enums:
- `sourceType`: `0` = URL, `1` = Upload (file to Azure Blob)
- `itemStatus`: `0` = Draft, `1` = Published, `2` = Archived

## Content Management

### List content items
```bash
curl -s "$BASE_URL/api/app/$TENANT/items?skip=0&limit=20&search=<term>&category=<cat>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### List items by type
```bash
# List only videos (type=3)
curl -s "$BASE_URL/api/app/$TENANT/listitems/3?skip=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Get content item details
```bash
curl -s "$BASE_URL/api/app/$TENANT/items/<content-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Create content item
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/items" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"name": "My Content", "type": 0, "sourceType": 0, "url": "https://example.com"}'
```

### Update content item
```bash
curl -s -X PUT "$BASE_URL/api/app/$TENANT/items/<content-id>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"name": "New Title", "description": "New description"}'
```

### Archive content item
```bash
curl -s -X PATCH "$BASE_URL/api/app/$TENANT/items/<content-id>/archive" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"reason": "Outdated"}'
```

## Publishing (File Upload)

### Upload and publish new content (multipart form)
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -F "file=@./sop.pdf" \
  -F "name=Safety SOP v2" \
  -F "category=Safety" \
  -F "description=Updated safety procedures" \
  -F "tags=safety" \
  -F "tags=procedures"
```

The `type` field is auto-detected from file extension. You can also set it explicitly: `-F "type=1"` for Document.

### Get upload URL (Azure Blob SAS)
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"fileName": "video.mp4", "contentType": "video/mp4"}'
```
Returns a SAS URL for direct upload to Azure Blob Storage.

## Rollout (Assign content to audience)

The correct assignment flow is: **Create Content Item -> Create Rollout -> Item Users auto-created**.

### Create rollout
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/rollout" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{
    "name": "Safety SOP Rollout",
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

**accessType values**: `0` = Internal, `1` = Private, `2` = External, `3` = All users, `4` = Criteria-based (uses `queryProperty`).

When `myLearning` is `true`, item users are auto-created for all matched users.

### List rollouts for a content item
```bash
curl -s "$BASE_URL/api/app/$TENANT/rollout/<content-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Delete rollout
```bash
curl -s -X DELETE "$BASE_URL/api/app/$TENANT/rollout/<rollout-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Item User (Manual Assignment)

For individual user assignments not covered by rollout criteria.

### Assign a single user
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/itemuser" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"itemId": "<content-id>", "userId": "<user-id>", "rolloutId": "<rollout-id>"}'
```

### Check assignment status
```bash
curl -s "$BASE_URL/api/app/$TENANT/itemuserUsage/<content-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Employee Management

### List employees
```bash
curl -s "$BASE_URL/api/app/$TENANT/listusers?skip=0&limit=20&search=<name>&department=<dept>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Get employee details
```bash
curl -s "$BASE_URL/api/app/$TENANT/users/<user-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Group/Department Management

### List groups
```bash
curl -s "$BASE_URL/api/app/$TENANT/departments?skip=0&limit=20&search=<term>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### List members of a group
```bash
curl -s "$BASE_URL/api/app/$TENANT/listusers?department=<dept-name>&skip=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Categories

### List categories
```bash
curl -s "$BASE_URL/api/app/$TENANT/categories?skip=0&limit=20&search=<term>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Training Management (ILT)

Training = ILT (Instructor-Led Training). Use the `/trainings` API to manage ILT programs. Creating a training internally creates an item with `type=8`.

### List trainings
```bash
curl -s "$BASE_URL/api/app/$TENANT/trainings?skip=0&limit=20&search=<term>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Get training details
```bash
curl -s "$BASE_URL/api/app/$TENANT/trainings/<training-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Create training
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

#### Training fields reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Training name |
| trainingCode | string | Yes | Unique code (e.g., "FST-2026") |
| objectives | string | Yes | Training objectives |
| effectiveMethodology | string | Yes | Teaching methodology description |
| trainingMode | int | Yes | `0`=Hybrid, `1`=Classroom, `2`=Online |
| enrollmentType | int | Yes | `0`=All, `1`=Direct, `2`=ManagerNomination |
| accessType | int | Yes | `0`=Private, `1`=Public |
| trainingCompletionCriteria | int | Yes | `0`=Attendance, `1`=PostAssessment, `2`=Feedback |
| trainingLibraryCriteria | int | Yes | `0`=NA, `1`=Mandatory, `2`=Optional |
| completionPercentage | float | Yes | Default `100` |
| description | string | No | Training description |
| mandatory | bool | No | Mark as mandatory |
| allowSelfEnrolWithAttendance | bool | No | Enable walk-in enrollment for events |
| trainingTypeId | uuid | No | Training type ID |
| categoryIds | uuid[] | No | Category IDs |
| certificateId | uuid | No | Certificate template ID |
| external | bool | No | External training flag |
| cancellation | bool | No | Allow cancellation |
| trainingCost | int | No | Training cost |
| enableForum | bool | No | Enable discussion forum |
| approvalRequired | bool | No | Require approval for enrollment |
| preTestId | uuid | No | Pre-assessment test ID |
| postTestId | uuid | No | Post-assessment test ID |
| participantFeedbackId | uuid | No | Participant feedback form ID |
| trainerFeedbackId | uuid | No | Trainer feedback form ID |
| managerFeedbackId | uuid | No | Manager feedback form ID |
| trainingFeedbackId | uuid | No | Training feedback form ID |

### Update training
```bash
curl -s -X PUT "$BASE_URL/api/app/$TENANT/trainings/<training-id>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"name": "Updated Name", "trainingMode": 2}'
```

### Delete training
```bash
curl -s -X DELETE "$BASE_URL/api/app/$TENANT/trainings/<training-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Training Types

### List training types
```bash
curl -s "$BASE_URL/api/app/$TENANT/trainingtypes?skip=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Event Management

Events are scheduled instances of a training (ILT) program. Created with composite `{event, sessions}` payload.

**Event status**: `0` = Scheduled, `1` = Rescheduled, `2` = Cancelled, `3` = Completed, `4` = In Progress
**Schedule type**: `0` = Single Session, `1` = Multi Session, `2` = Multi Day

### List all events
```bash
curl -s "$BASE_URL/api/app/$TENANT/events?skip=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### List events for a training
```bash
curl -s "$BASE_URL/api/app/$TENANT/events/<training-id>?skip=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Create event with sessions
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

#### Event fields reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Event name |
| date | datetime | Yes | Start datetime (ISO 8601) |
| trainingId | uuid | Yes | Training ID |
| status | int | Yes | Default `0` (Scheduled) |
| scheduleType | int | Yes | `0`=SingleSession, `1`=MultiSession, `2`=MultiDay |
| endDate | datetime | No | End datetime |
| maximumParticipants | int | No | Max participants (0 = unlimited) |
| minimumParticipants | int | No | Min participants |
| locationId | uuid | No | Location ID |
| walkInEnabled | bool | No | Enable walk-in enrollment |
| walkInCode | string | No | Walk-in code |
| walkInCodeMode | int | No | `0`=Manual, `1`=Auto |
| lastDate | datetime | No | Last date for enrollment |
| cancelBefore | datetime | No | Cancel before date |
| preTestId | uuid | No | Pre-assessment test ID |
| postTestId | uuid | No | Post-assessment test ID |
| programCost | float | No | Program cost |
| budgetCost | float | No | Budget cost |
| postAssessmentDueDays | int | No | Days for post-assessment completion |

#### Session fields reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Session name |
| startTime | datetime | Yes | Session start (ISO 8601) |
| endTime | datetime | Yes | Session end (ISO 8601) |
| duration | int | Yes | Duration in minutes |
| status | int | Yes | Default `0` (Scheduled) |
| hostLink | string | No | Meeting link for trainer (online/virtual sessions only) |
| joinLink | string | No | Meeting link for participants (online/virtual sessions only) |
| trainerId | uuid | No | Trainer user ID |
| trainingRoomId | uuid | No | Training room ID (classroom sessions) |
| walkInCode | string | No | Walk-in code for this session |

> **Note**: `hostLink` and `joinLink` are optional — offline/classroom sessions don't need meeting links.

### Cancel event
```bash
curl -s -X PUT "$BASE_URL/api/app/$TENANT/events/<event-id>/cancel" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"remarks": "Instructor unavailable"}'
```

### Delete event
```bash
curl -s -X DELETE "$BASE_URL/api/app/$TENANT/events/<event-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Session Management

Sessions are created WITH events (not independently). Use these endpoints to list, view users, and enroll.

### List sessions for an event
```bash
curl -s "$BASE_URL/api/app/$TENANT/eventsessions/<event-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Get session details
```bash
curl -s "$BASE_URL/api/app/$TENANT/eventsession/<session-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### List session users
```bash
curl -s "$BASE_URL/api/app/$TENANT/eventsessionusers/<session-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

**Event user status**: `-1` = Not Enrolled, `0` = Enrolled, `1` = Waiting List, `2` = Cancelled, `3` = In Progress, `4` = Completed, `5` = No Show, `6` = Partially Completed, `7` = Pending

### Enroll users in a session (bulk)
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
Response: `{"added": 2, "skipped": 0, "updated": 0}`

### Mark attendance
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/sessions/<session-id>/attendance" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"userIds": ["<user-id-1>", "<user-id-2>"]}'
```

## Notifications

Send notifications to users in a rollout or session. Uses the notifications service (`/api/notifications/`). The `X-User-ID` is automatically extracted from the Bearer token by middleware — no extra header needed.

### Send notification for a rollout
```bash
curl -s -X POST "$BASE_URL/api/notifications/$TENANT/remainder/<rollout-id>?type=rollout&notificationName=CourseReminder" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Response: `{"status": "ok", "count": 15}`

### Send notification for a session
```bash
curl -s -X POST "$BASE_URL/api/notifications/$TENANT/remainder/<session-id>?type=session&notificationName=SessionReminder" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Send consolidated notification
```bash
curl -s -X POST "$BASE_URL/api/notifications/$TENANT/remainder/<rollout-id>?type=consolidate&notificationName=ConsolidateReminder" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

**Notification types**:
- `rollout` — sends to all item_users in rollout where status != completed
- `session` — sends to all users in an event session
- `consolidate` — aggregates all pending courses per user, sends one notification each

## Reminders (Automated Schedules)

Reminders are **configuration objects** that control automated notification schedules. They are NOT ad-hoc "send now" actions. To send a notification immediately, use the Notifications endpoint above.

### List reminder configurations
```bash
curl -s "$BASE_URL/api/app/$TENANT/reminders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

**Reminder types**: `0` = Consolidate Course, `1` = Training, `2` = Training to Trainer, `3` = Post Training Activities

### Update reminder (enable/disable)
```bash
curl -s -X PUT "$BASE_URL/api/app/$TENANT/reminders/<reminder-id>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"active": true}'
```

## Dashboard & Analytics

### Assignment status counts
```bash
curl -s "$BASE_URL/api/app/$TENANT/itemuserstatuscount" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Response: `{"notStarted_count": 10, "inprogress_count": 5, "completed_count": 20, "overdue_count": 3}`

### Training hours analytics
```bash
curl -s "$BASE_URL/api/app/$TENANT/trainingHoursAndAveragePerEmployee?trainingId=<optional-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Event status counts
```bash
curl -s "$BASE_URL/api/app/$TENANT/eventStatusCount?trainingId=<optional-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Learning hours
```bash
curl -s "$BASE_URL/api/app/$TENANT/learninghours" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Reports

Reports are template-based and generated asynchronously.

### List generated reports
```bash
curl -s "$BASE_URL/api/app/$TENANT/reports?skip=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### List reports by template
```bash
curl -s "$BASE_URL/api/app/$TENANT/reports/<template-name>?skip=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### Generate a new report
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/reports/<template-name>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"department": "HR"}'
```

**Report status**: `0` = Queued, `1` = Generating, `2` = Succeeded, `3` = Failed

**Available templates**: `UserDetailsReport`, `CourseUserReport`, `TestUserReport`, `TrainingSummaryReport`, `TrainingDetailsReport`, `ConsolidatedMISReport`, `TrainingHoursReport`, `LearningHoursReport`, `ComplianceReport`, `LibraryUsageReport`

### Download completed report
```bash
curl -s "$BASE_URL/api/app/$TENANT/downloadreport/<report-table>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Entity Relationships

```
Training Types (Classroom/Virtual/Hybrid)
  └── Trainings = ILT (share ID with items table type=8)
        └── Events (scheduleType: 0=SingleSession, 1=MultiSession, 2=MultiDay)
              └── Sessions (created WITH events, not independently)
                    └── Event Session Users (enrollment, attendance)

Items (Repository - standalone content of any type from Item Type Enum)
  └── E-Learning Courses (type=24, parent items with child items)
        └── Child Items (resources linked via /childItems API)

Rollouts (assign items to audiences by criteria)
  └── Item Users (auto-created when myLearning=true)
```

## Error Handling

- **401 Unauthorized**: Token expired or invalid. Re-run the authentication step to get a new token.
- **403 Forbidden**: Role does not have permission for this operation.
- **429 Too Many Requests**: API key rate limit exceeded. Wait 60 seconds.
- **404 Not Found**: Resource does not exist or tenant mismatch.
- **409 Conflict**: Duplicate (e.g., user already assigned to content).
