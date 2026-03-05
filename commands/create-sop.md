# /lms:create-sop

Create a new Standard Operating Procedure document.

## Usage

```
/lms:create-sop
```

## Description

This command orchestrates the full SOP creation workflow: gather requirements, draft the document, review, and optionally publish to the LMS and create a rollout.

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

1. **Gather requirements**. Ask the user for:
   - Topic / subject area
   - Target audience (which department/role)
   - Category (Safety, Process, Onboarding, Compliance, Technical, Policy)
   - Urgency level
   - Any specific procedures or steps to include
   - Reference documents or standards

2. **Select template** from `sop-templates.md` based on category:
   - Safety -> Safety SOP template
   - Process -> Process/Operational SOP template
   - Onboarding -> Onboarding SOP template
   - Compliance -> Compliance SOP template
   - Default -> Standard SOP template

3. **Draft the SOP** using the selected template. Fill in:
   - Document number (auto-generate: SOP-[DEPT]-[NNN])
   - Version 1.0
   - Current date as effective date
   - All sections per template

4. **Review loop**. Present the draft and ask the user to:
   - Approve as-is
   - Request changes (iterate)
   - Add/remove sections

5. **Generate final document**. Save as PDF or DOCX.

6. **Optionally publish** to the LMS:
   ```bash
   curl -s -X POST "$BASE_URL/api/app/$TENANT/items" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -F "file=@./sop-output.pdf" \
     -F "title=<title>" \
     -F "category=<category>" \
     -F "description=<description>"
   ```

7. **Optionally create a rollout** to assign to the target audience:
   ```bash
   curl -s -X POST "$BASE_URL/api/app/$TENANT/rollout" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '{
       "name": "<rollout-name>",
       "itemId": "<content-id>",
       "startDate": "<YYYY-MM-DDT00:00:00Z>",
       "endDate": "<YYYY-MM-DDT00:00:00Z>",
       "noOfDays": <days>,
       "accessType": 4,
       "queryProperty": [{"key": "department", "value": ["<dept-id>"]}],
       "myLearning": true,
       "mandatory": true
     }'
   ```

## Example Interaction

User: "Create an SOP for chemical handling in the warehouse"
