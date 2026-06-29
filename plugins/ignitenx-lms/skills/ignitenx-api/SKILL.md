---
name: ignitenx-api
description: Complete API reference for the igniteNX LMS platform including authentication, content management, rollouts, trainings, approvals, and notifications
---

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
| 17 | Go1 | Go1 content integration |
| 18 | LinkedIn | LinkedIn Learning content |
| 19 | Declaration | Declaration / acknowledgement content |
| 21 | Poll | Poll |
| 22 | Survey | Survey |
| 23 | Feedback | Feedback form |
| 24 | Elearning | E-learning content (parent with child items) |
| 25 | AICC | AICC package (ZIP) |
| 26 | Announcement | Announcement |
| 27 | LearningPath | Learning path |
| 28 | CMI5 | CMI5 package (ZIP) |

Additional enums:
- `sourceType`: `0` = URL, `1` = Upload (file to Azure Blob)
- `itemStatus`: `0` = Draft, `1` = Published, `2` = Archived

## Content Management

### List content items
```bash
curl -s "$BASE_URL/api/app/$TENANT/items?skip=0&limit=50" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Query params: `skip` (int, default 0), `limit` (int, default 500). No text search on this endpoint.

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

Content upload uses a **3-step SAS URL flow** (do NOT use multipart form POST to `/items`):

### Step 1: Request SAS upload URL
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/upload" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"fileName": "sop.pdf", "folder": "Document", "id": null}'
```
Returns a full Item object, but only `id` (the new item ID) and `url` (the SAS upload URL) are populated — ignore the other zero-valued fields.

**folder values** (must match content type):

| Folder | Use For |
|--------|---------|
| `Document` | PDF, DOCX, PPTX documents |
| `Video` | MP4, AVI video files |
| `Audio` | MP3, WAV audio files |
| `Announcement` | Announcement attachments |
| `LibraryItem` | Library content |
| `FlashCard` | Flashcard images |
| `thumbnail` | Item thumbnail images |

### Step 2: Upload file to SAS URL
```bash
curl -s -X PUT "<returned-sas-url>" \
  -H "x-ms-blob-type: BlockBlob" \
  -H "Content-Type: application/pdf" \
  --data-binary @./sop.pdf
```
**No auth headers needed** - the SAS URL is self-authenticating. Returns HTTP 201 on success.

### Step 3: Create item metadata
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/items" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{
    "id": "<id-from-step-1>",
    "name": "Safety SOP v2",
    "description": "Updated safety procedures",
    "type": 1,
    "sourceType": 1,
    "fileName": "sop.pdf",
    "url": "<sas-url-without-query-params>"
  }'
```

**Item type values**: `0` = Url, `1` = Document, `2` = Audio, `3` = Video, `5` = SCORM (see full Item Type Enum table above)
**sourceType**: `0` = URL (external link), `1` = Upload (file in Azure Blob)

> **Response**: `POST /items` returns HTTP 200 and echoes your request body back to confirm creation — not the
> stored record. Fetch `GET /items/:id` afterwards for server-populated fields (createdAt, status, etc.).

> **Important**: Strip the SAS query params from the URL before saving. Use only the base path (e.g., `https://app.ignitenx.com/storage/local/Document/{id}/sop.pdf`).

## Content Type Creation Recipes

Per–content-type bodies for `POST /items`. **Uploaded** types (`sourceType=1`) first run the 3-step SAS flow
above (or `scormUploadInit` for SCORM); **URL/HTML** types (`sourceType=0`) need no upload.

**Document (type 1)** — upload with `folder=Document`, then:
```json
{"id": "<id>", "name": "Safety SOP", "type": 1, "sourceType": 1, "fileName": "sop.pdf", "url": "<clean-sas-url>"}
```

**Audio (type 2)** — upload with `folder=Audio`:
```json
{"id": "<id>", "name": "Briefing", "type": 2, "sourceType": 1, "fileName": "briefing.mp3", "url": "<clean-sas-url>"}
```

**Video — uploaded (type 3)** — upload with `folder=Video`:
```json
{"id": "<id>", "name": "Ramp Walkthrough", "type": 3, "sourceType": 1, "fileName": "ramp.mp4", "url": "<clean-sas-url>"}
```

**Video — YouTube / external URL (type 3, no upload)**:
```json
{"name": "Safety Briefing (YouTube)", "type": 3, "sourceType": 0, "url": "https://www.youtube.com/watch?v=XXXX"}
```

**Video with questions (type 12)** — upload the video (`folder=Video`), then attach timed questions:
```json
{"id": "<id>", "name": "Interactive Safety", "type": 12, "sourceType": 1, "fileName": "v.mp4", "url": "<clean-sas-url>",
 "questions": [{"question": "PPE required?", "options": ["Yes","No"], "answer": "Yes", "time": 30}]}
```
`time` is the video timestamp (seconds) at which the question appears.

**SCORM (type 5)** — uses its own init endpoint (public container), NOT the generic `/upload`:
```bash
# 1) init — only .zip is accepted
curl -s -X POST "$BASE_URL/api/app/$TENANT/scormUploadInit" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID" \
  -d '{"fileName": "course.zip"}'
# returns {id, fileName, path, url, baseUrl, container, folderPrefix}
# 2) PUT the zip to the returned url (header x-ms-blob-type: BlockBlob), then create the item:
```
```json
{"id": "<id>", "name": "DG Handling SCORM", "type": 5, "sourceType": 1, "fileName": "course.zip", "url": "<baseUrl>", "scormVersion": 2}
```
`scormVersion`: `1` = SCORM 1.2, `2` = SCORM 2004.

**xAPI / ExperienceAPI (type 6)** and **AICC (type 25)** — ZIP packages; upload via the SAS flow
(`folder=ExperienceAPI` / `AICC`), then create with `type: 6` / `type: 25`, `sourceType: 1`, `fileName`, `url`.

**FlashCard (type 4)** — upload images/ZIP with `folder=FlashCard`, then:
```json
{"id": "<id>", "name": "Signage Cards", "type": 4, "sourceType": 1, "flashCardFiles": ["<url1>", "<url2>"]}
```

**Embed (type 10)** — embedded HTML/iframe, no upload:
```json
{"name": "Dashboard", "type": 10, "sourceType": 0, "url": "<embeddable-url>"}
```

**Page (type 11)** — authored HTML page, no upload:
```json
{"name": "Welcome", "type": 11, "sourceType": 0, "content": "<h1>Welcome</h1>"}
```

**URL (type 0)** — external link, no upload:
```json
{"name": "Regulator Site", "type": 0, "sourceType": 0, "url": "https://example.com"}
```

## E-learning (Course) with Child Items

An **E-learning** item (`type=24`) is a *parent* that groups ordered *child* resources (videos, documents,
SCORM, assessments, etc.). Create the parent, create each child as a normal item, then link them.

### 1. Create the parent E-learning item
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/items" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"name": "Ramp Safety Course", "type": 24, "sourceType": 0}'
```

### 2. Create each child item
Create each resource as a normal standalone item (any content type — see **Content Type Creation Recipes**
above), e.g. a video (`type=3`) or document (`type=1`). Keep each returned item `id` to use as the `childId`.

### 3. Link a child to the parent
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/childItems" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{
    "childId": "<child-item-id>",
    "parentId": "<parent-elearning-id>",
    "name": "Module 1 — Introduction",
    "type": 3,
    "sequenceNumber": 1
  }'
```
Repeat for each child, incrementing `sequenceNumber` to control order. `id` is optional (auto-generated when
omitted); `sectionId` is optional. The endpoint echoes the created child link back, and returns **409** if
that resource is already linked to the parent. A background job auto-creates the child item-users.

### 4. List a parent course's child items (admin)
```bash
curl -s "$BASE_URL/api/app/$TENANT/childItemByParent/<parent-elearning-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
> `GET /childItems/:id` is the **learner**-side variant (it takes an *item-user* id and enforces
> prerequisites). For admin listing by parent item id use `/childItemByParent/:id` (above); use
> `/childItemById/:id` to fetch a single child link.

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
    "timeToComplete": 28,
    "accessType": 4,
    "queryProperty": [{"key": "department", "value": ["<dept-id>"]}],
    "myLearning": true,
    "mandatory": true
  }'
```

**Rollout accessType values**:

| Value | Name | Description |
|-------|------|-------------|
| 0 | Internal | All active internal employees |
| 1 | Private | Manually selected users only |
| 2 | External | All active external employees |
| 3 | Everyone | All active users |
| 4 | Criteria | Uses `queryProperty` to filter by department, location, grade, etc. |

**Audience targeting**: Use `queryProperty` (array of `{key, value}` objects) to target by criteria when `accessType` is `4`. Supported keys:

| Key | Lookup Endpoint | Description |
|-----|----------------|-------------|
| `department` | `GET /lookupdepartments` | Filter by department |
| `location` | `GET /lookuplocations` | Filter by location |
| `designation` | `GET /lookupdesignations` | Filter by designation |
| `grade` | `GET /lookupgrades` | Filter by grade |
| `level` | `GET /lookuplevels` | Filter by level |
| `cost_centre` | `GET /lookupcostcentres` | Filter by cost centre |
| `organisation_unit` | `GET /lookuporgunits` | Filter by organisation unit |
| `business_entity` | `GET /lookupbusinessentities` | Filter by business entity (recursive hierarchy) |
Multiple criteria use AND logic — users must match ALL filters.

When `myLearning` is `true`, item users are auto-created for all matched users.

#### Rollout fields reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Rollout name |
| itemId | uuid | Yes | Content item ID to assign |
| startDate | datetime | Yes | Start date (ISO 8601) |
| endDate | datetime | No | End date (ISO 8601) |
| timeToComplete | int | No | Days allowed to complete. If omitted, stored as NULL and the completion deadline falls back to the rollout endDate — there is no default |
| accessType | int | Yes | See accessType values above |
| queryProperty | array | No | Array of `{key, value}` filter objects (required when accessType=4) |
| myLearning | bool | No | Auto-create item users for matched users (default false) |
| availableLearning | bool | No | Show in "Available Learning" section |
| mandatory | bool | No | Mark as mandatory |
| onboarding | bool | No | Mark as onboarding content |
| compliance | bool | No | Mark as compliance content |
| complianceType | uuid | No | Compliance type ID (when compliance=true) |
| recurrence | int | No | `0`=Monthly, `1`=Quarterly, `2`=Annual |

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
curl -s "$BASE_URL/api/app/$TENANT/listusers?offset=0&limit=20&name=<name>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Query params: `offset` (default 0), `limit` (default 10), `name`, `userName`, `departmentId` (uuid), `locationId` (uuid), `gradeId` (uuid), `organisationUnitId` (uuid), `active` (bool), `sort`, `order` (ASC/DESC).

### Get employee details
```bash
curl -s "$BASE_URL/api/app/$TENANT/users/<user-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Group/Department Management

### List groups
```bash
curl -s "$BASE_URL/api/app/$TENANT/departments?skip=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

### List members of a group
```bash
curl -s "$BASE_URL/api/app/$TENANT/listusers?departmentId=<dept-id>&offset=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Lookup Endpoints (for Rollout Criteria)

Lookup endpoints return lightweight `{id, name}` arrays for populating rollout criteria values. Use these to get the ID of a department, location, etc. before creating a criteria-based rollout.

```bash
# Departments
curl -s "$BASE_URL/api/app/$TENANT/lookupdepartments" \
  -H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID"

# Locations
curl -s "$BASE_URL/api/app/$TENANT/lookuplocations" \
  -H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID"

# Designations
curl -s "$BASE_URL/api/app/$TENANT/lookupdesignations" \
  -H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID"

# Grades
curl -s "$BASE_URL/api/app/$TENANT/lookupgrades" \
  -H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID"

# Levels
curl -s "$BASE_URL/api/app/$TENANT/lookuplevels" \
  -H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID"

# Cost Centres
curl -s "$BASE_URL/api/app/$TENANT/lookupcostcentres" \
  -H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID"

# Organisation Units
curl -s "$BASE_URL/api/app/$TENANT/lookuporgunits" \
  -H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID"

# Business Entities — requires the Business Entity feature enabled for the tenant (returns HTTP 404 if disabled)
curl -s "$BASE_URL/api/app/$TENANT/lookupbusinessentities" \
  -H "Authorization: Bearer $TOKEN" -H "X-Role-ID: $ROLE_ID"
```

## Categories

### List categories
```bash
curl -s "$BASE_URL/api/app/$TENANT/categories?skip=0&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

## Training Management (ILT)

Training = ILT (Instructor-Led Training). Use the `/trainings` API to manage ILT programs. Creating a training internally creates an item with `type=8`.

### List trainings
```bash
curl -s "$BASE_URL/api/app/$TENANT/trainings?skip=0&limit=20" \
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
| accessType | int | Yes | `0`=Private, `1`=Public (Note: different from Rollout accessType) |
| trainingCompletionCriteria | int | Yes | `0`=Attendance, `1`=AttendanceAndPostAssessment, `2`=AttendancePostAssessmentAndFeedback, `3`=AttendanceAndFeedback |
| trainingLibraryCriteria | int | Yes | `0`=None, `1`=OnCompletingPreAssessment, `2`=CompletingEvent |
| completionPercentage | float | Yes | Default `100` |
| description | string | No | Training description |
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

First list session users to get their `eventSessionUserId` values, then mark attendance:
```bash
# Get session user IDs
curl -s "$BASE_URL/api/app/$TENANT/eventsessionusers/<session-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"

# Mark attendance (body is an ARRAY of objects, not wrapped)
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

## Approval Flow

Approval workflows allow configuring multi-step approval processes for content enrollment, deadline extensions, additional assessment attempts, event nominations, and participant cancellations. When an entity has `approvalRequired: true`, user actions (like enrollment) create an approval request routed through the configured process.

### Approval Status Values

| Value | Label |
|-------|-------|
| 0 | Pending |
| 1 | Approved |
| 2 | Rejected |

### Approval Type Reference

| Type ID | Name | Description |
|---------|------|-------------|
| 0 | Item | Content/course enrollment approval |
| 1 | ItemDays | Deadline extension approval |
| 2 | AdditionalAttempts | Additional assessment attempts approval |
| 3 | Event | Training/event nomination approval |
| 13 | ParticipantCancellation | Participant cancellation approval |

### Pending approvals inbox
```bash
curl -s "$BASE_URL/api/app/$TENANT/approvalinstances/pending?limit=10&offset=0" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Query params: `limit` (int, default 10), `offset` (int, default 0).

Response: `{"pending_approvals": [...]}`. Each item contains:
- `steps` — array of approval step objects (`stepName`, `status`, `approverRemarks`, `handledBy`, `handledAt`)
- `requestorDetails` — requestor display name, email, phone, avatar
- `requestInfo` — `instanceId`, `requestId`, `requestName`, `type`, `assessmentType`, `processStep`

### Handled approvals history
```bash
curl -s "$BASE_URL/api/app/$TENANT/approvalinstances/history?status=approved&limit=25&offset=0" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Query params: `limit` (int, default 25), `offset` (int, default 0), `status` (comma-separated: `pending`, `approved`, `rejected`).

Response: `{"handled_approvals": [...]}`.

### Approve or reject
```bash
curl -s -X PUT "$BASE_URL/api/app/$TENANT/approvalinstances/<instance-id>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"status": 1, "approverRemarks": "Approved, proceed.", "approverInputs": 0}'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | int | Yes | `1` = Approved, `2` = Rejected |
| approverRemarks | string | Yes | Remarks from the approver |
| approverInputs | number | No | Numeric input (e.g., additional days granted). Default `0` |

Returns HTTP 201 with the updated instance. Returns **409 Conflict** if the instance was already handled.

### List approval requests
```bash
curl -s "$BASE_URL/api/app/$TENANT/approvalrequests?mine=true&limit=100&offset=0" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Query params: `limit` (int, default 10), `offset` (int, default 0), `mine` (`true`/`false` — filter to current user's requests), `status` (`pending`/`approved`/`rejected`), `requestedById` (uuid).

Response: `{"approval_requests": [...]}`. Each request includes:
- `id`, `name`, `type` (approval type ID), `status` (0/1/2)
- `currentStepName`, `currentStepRoleName`, `currentStepStatus`
- `steps` — array of step objects with `instanceId`, `processStep`, `processStepRoleName`, `status`, `approverRemarks`, `approverInputs`, `handledById`, `handledAt`
- `requestorRemarks`, `createdAt`, `modifiedAt`

### Count approval requests
```bash
curl -s "$BASE_URL/api/app/$TENANT/countapprovalrequests" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Response: `{"total": <number>}`

### Request deadline extension
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/itemusers/<item-user-id>/extend" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"itemId": "<content-id>", "requestorRemarks": "Need 7 more days to complete", "requestorInput": 7}'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| itemId | uuid | Yes | The content item ID |
| requestorRemarks | string | No | Reason for extension |
| requestorInput | number | No | Number of additional days requested |

Returns HTTP 201 with the approval request. Returns **409 Conflict** if an extension request already exists.

### Request additional assessment attempts
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/attempts/request" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{
    "itemUserId": "<item-user-id>",
    "childItemUserId": "<child-item-user-id>",
    "eventUserId": "<event-user-id>",
    "itemId": "<assessment-id>",
    "requestorRemarks": "Need one more attempt",
    "requestorInput": 1,
    "assessmentType": 2,
    "approvalProcessId": "<approval-process-id>"
  }'
```

**assessmentType values**: `0` = Assessment, `1` = PreAssessment, `2` = PostAssessment, `3` = PreEvent, `4` = PostEvent.

Returns HTTP 201 with the approval request. Returns **409 Conflict** if a request already exists.

### Enrollment with approval

When content or events have `approvalRequired: true`, enrollment creates an approval request instead of direct enrollment.

**Content enrollment:**
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/items/<item-id>/enroll" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"rolloutId": "<rollout-id>"}'
```

**Event enrollment:**
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/events/<event-id>/enroll" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

> **Important**: If the item/event has `approvalRequired: true`, the response includes `"requiresApproval": true` and an approval request is created. Returns **409 Conflict** if a pending approval request already exists for this enrollment.

### Approval process configuration (admin)

**List processes:**
```bash
curl -s "$BASE_URL/api/app/$TENANT/approvalprocesses?limit=10&offset=0" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Response: `{"approval_processes": [{id, name, steps, default}, ...]}`

**Create process:**
```bash
curl -s -X POST "$BASE_URL/api/app/$TENANT/approvalprocesses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"name": "Manager + HR Approval", "steps": ["<role-id-1>", "<role-id-2>"], "default": false}'
```

**Update process:**
```bash
curl -s -X PUT "$BASE_URL/api/app/$TENANT/approvalprocesses/<process-id>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"name": "Updated Name", "steps": ["<role-id-1>"], "default": true}'
```

**Delete process:**
```bash
curl -s -X DELETE "$BASE_URL/api/app/$TENANT/approvalprocesses/<process-id>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

**Lookup processes (for dropdowns):**
```bash
curl -s "$BASE_URL/api/app/$TENANT/lookupapprovalprocesses" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Response: `{"approval_processes": [{id, name}, ...]}`

**List available roles for process steps:**
```bash
curl -s "$BASE_URL/api/app/$TENANT/approvalroles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Response: `{"roles": [{id, name}, ...]}`

### Approval type configuration (admin)

Each approval type can be mapped to a specific approval process. Set `approvalProcessId` to `null` to disable approval for that type.

**List types with process mappings:**
```bash
curl -s "$BASE_URL/api/app/$TENANT/approvaltypes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Response: `{"approval_types": [{id, approvalProcessId}, ...]}`

**Bulk update type-to-process mappings:**
```bash
curl -s -X PUT "$BASE_URL/api/app/$TENANT/approvaltypesbulk" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '[
    {"approvalTypeId": 0, "approvalProcessId": "<process-id>"},
    {"approvalTypeId": 3, "approvalProcessId": null}
  ]'
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

**Reminder types**: `0` = Consolidate Course, `1` = Training, `2` = Training to Trainer, `3` = Post Training Activities, `4` = Consolidate Manager Feedback, `5` = Attendance

### Update reminder (enable/disable)
```bash
curl -s -X PUT "$BASE_URL/api/app/$TENANT/reminders/<reminder-id>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID" \
  -d '{"active": true}'
```

## Notification Inbox

Read and manage in-app notifications. For **sending** notifications, see the Notifications section above. This section covers the **receiving** side — reading notifications, checking unread count, and marking as read.

> **Important**: Notification inbox endpoints use `/api/notifications/$TENANT/` (NOT `/api/app/$TENANT/`). Auth headers remain the same.

### Get unread count and preview
```bash
curl -s "$BASE_URL/api/notifications/$TENANT/userunreadcount" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Response: `{"count": <number>, "data": [...]}` — `data` contains up to 3 most recent unread notifications with `id`, `subject`, `senderName`, `message`, `createdAt`.

### List user notifications
```bash
curl -s "$BASE_URL/api/notifications/$TENANT/usernotifications?limit=20&offset=0&q=safety" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Query params: `limit` (int, default 20), `offset` (int, default 0), `q` (string — search by subject).

Response: `{"count": <total>, "limit": 20, "offset": 0, "data": [...]}`. Each notification includes `senderName`, `senderEmail`, `subject`, `message`, `remarks`, `createdAt`.

### Mark notification as read
```bash
curl -s -X PUT "$BASE_URL/api/notifications/$TENANT/notification/<notification-id>/read" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
No request body needed. Response: `{"status": "ok", "updated": <number>}`.

### Mark all notifications as read
```bash
curl -s -X PUT "$BASE_URL/api/notifications/$TENANT/mark-all-as-read" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
No request body needed. Response: `{"status": "ok", "updated": <number>, "unreadCount": 0}`.

### Notification logs (admin)
```bash
curl -s "$BASE_URL/api/notifications/$TENANT/logs?limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```

Filter query params (all optional):

| Param | Description |
|-------|-------------|
| `senderName` | Filter by sender name (regex, case-insensitive) |
| `userName` | Filter by recipient name |
| `subject` | Filter by subject |
| `notificationName` | Filter by notification type name |
| `remarks` | Filter by remarks |
| `status` | Exact match: `pending`, `scheduled`, `succeeded`, `failed` |
| `type` | Exact match: `email`, `push`, `sms`, `desktop` |
| `createdAt` | Date: `YYYY-MM-DD` or range: `YYYY-MM-DD,YYYY-MM-DD` |

Response: `{"limit": 20, "offset": 0, "data": [...]}`. Each log includes `id`, `senderName`, `senderEmail`, `userName`, `userEmail`, `notificationName`, `subject`, `message`, `remarks`, `type`, `status`, `ccEmails`, `createdAt`.

### Count notification logs (admin)
```bash
curl -s "$BASE_URL/api/notifications/$TENANT/logs/count" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Role-ID: $ROLE_ID"
```
Accepts the same filter query params as the logs endpoint. Response: `{"count": <number>}`.

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

**Available templates**: `UserDetailsReport`, `CourseUserReport`, `TestUserReport`, `TrainingSummaryReport`, `TrainingEventsReport`, `ConsolidatedMISReport`, `TrainingHoursReport`, `LearningHoursReport`, `ComplianceReport`, `LibraryUsageReport`

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
