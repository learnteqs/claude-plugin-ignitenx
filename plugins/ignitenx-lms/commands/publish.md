# /lms:publish

Publish content to the igniteNX LMS.

## Usage

```
/lms:publish
```

## Description

This command guides you through publishing a document or training material to the igniteNX LMS. It handles file upload, metadata entry, and confirmation.

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

1. **Identify the file** to publish. Ask the user for:
   - File path (required)
   - Title (required)
   - Content type: Document, Video, Audio, Scorm (default: Document)
   - Description (generate from content if not provided)
   - Tags (suggest based on content analysis)

2. **Validate** the file exists and is a supported format (PDF, DOCX, PPTX, MP4, ZIP for SCORM).

3. **Upload** using the 3-step SAS URL flow (do NOT use multipart form):

   **Step 1** - Request SAS upload URL:
   ```bash
   SAS_RESP=$(curl -s -X POST "$BASE_URL/api/app/$TENANT/upload" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '{"fileName": "<filename>", "folder": "<folder>", "id": null}')
   ITEM_ID=$(echo $SAS_RESP | jq -r '.id')
   SAS_URL=$(echo $SAS_RESP | jq -r '.url')
   ```

   **folder values**: `Document`, `Video`, `Audio`, `Announcement`, `LibraryItem`

   **Step 2** - Upload file to SAS URL (no auth headers needed):
   ```bash
   curl -s -X PUT "$SAS_URL" \
     -H "x-ms-blob-type: BlockBlob" \
     -H "Content-Type: <mime-type>" \
     --data-binary @<path>
   ```

   **Step 3** - Create item metadata:
   ```bash
   CLEAN_URL=$(echo "$SAS_URL" | cut -d'?' -f1)
   curl -s -X POST "$BASE_URL/api/app/$TENANT/items" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d "{
       \"id\": \"$ITEM_ID\",
       \"name\": \"<title>\",
       \"description\": \"<description>\",
       \"type\": <type-int>,
       \"sourceType\": 1,
       \"fileName\": \"<filename>\",
       \"url\": \"$CLEAN_URL\"
     }"
   ```

   **type values**: `1`=Document, `2`=Video, `3`=URL, `4`=Scorm, `20`=Audio

4. **Confirm** publication by retrieving the new content item:
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/items/$ITEM_ID" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```

5. **Report** the result to the user with the content ID and a link to view it in the portal.

## Example Interaction

User: "Publish the fire safety SOP I just created"
