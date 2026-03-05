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
   - Category (recommend based on content)
   - Description (generate from content if not provided)
   - Tags (suggest based on content analysis)

2. **Validate** the file exists and is a supported format (PDF, DOCX, PPTX, MP4, ZIP for SCORM).

3. **Publish** using the API (multipart form upload):
   ```bash
   curl -s -X POST "$BASE_URL/api/app/$TENANT/items" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -F "file=@<path>" \
     -F "title=<title>" \
     -F "category=<category>" \
     -F "description=<description>" \
     -F "tags=<tag1>" \
     -F "tags=<tag2>"
   ```

4. **Confirm** publication by retrieving the new content item:
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/items/<returned-id>" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```

5. **Report** the result to the user with the content ID and a link to view it in the portal.

## Example Interaction

User: "Publish the fire safety SOP I just created"
