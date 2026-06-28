# Changelog

## 1.0.5

API-alignment pass against the live IgniteNX backend (demo-readiness):

- **Rollout**: `noOfDays` → **`timeToComplete`** in all examples/field tables (`ignitenx-api`, `lms-workflow`,
  `assign`, `create-sop`). This was a demo-blocking mismatch.
- **create-sop**: rollout criteria field `filterList` → **`queryProperty`**.
- **E-learning**: documented the child-items flow — `POST /childItems` (link), `GET /childItemByParent/:id`
  (admin list), with the verified payload `{childId, parentId, name, type, sequenceNumber}`.
- **Training**: removed the non-existent `mandatory` field; corrected `trainingCompletionCriteria`
  (`0 Attendance, 1 AttendanceAndPostAssessment, 2 AttendancePostAssessmentAndFeedback, 3 AttendanceAndFeedback`)
  and `trainingLibraryCriteria` (`0 None, 1 OnCompletingPreAssessment, 2 CompletingEvent`).
- **Item types**: added `17 Go1`, `18 LinkedIn`, `19 Declaration`, `28 CMI5`.
- **Content recipes**: added per-content-type `POST /items` recipes (document, audio, video, YouTube,
  video-with-questions, SCORM via `scormUploadInit`, xAPI, AICC, flashcard, embed, page, URL).
- **Reminders**: added types `4 Consolidate Manager Feedback`, `5 Attendance`.
- **Lookups**: noted `lookupbusinessentities` requires the tenant Business Entity feature (404 if disabled).
- **Responses**: clarified `POST /upload` (full Item, only `id`/`url` populated) and `POST /items`
  (echoes request body; fetch `GET /items/:id` for stored record).
