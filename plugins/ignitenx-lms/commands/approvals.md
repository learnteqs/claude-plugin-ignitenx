# /lms:approvals

Manage approval workflows — check pending approvals, approve or reject requests, view your own requests, and configure approval processes.

## Usage

```
/lms:approvals
```

## Description

This command provides access to the full approval workflow: viewing pending approval inbox, approving or rejecting requests, checking the status of your own requests, requesting deadline extensions or additional assessment attempts, and configuring approval processes and type mappings (admin).

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

1. **Ask what the user wants to do**:
   - Check pending approvals (approver inbox)
   - Approve or reject a specific request
   - View my own approval requests
   - Request a deadline extension
   - Request additional assessment attempts
   - Configure approval processes (admin)
   - Configure approval type mappings (admin)

2. **For pending approvals inbox** — fetch and display:
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/approvalinstances/pending?limit=10&offset=0" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Present each item with: request name, type, requestor name, current step, date submitted.

   For history (handled approvals):
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/approvalinstances/history?status=approved&limit=25&offset=0" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Status filter: `pending`, `approved`, `rejected` (comma-separated).

3. **For approve or reject** — get the instance ID and remarks from the user:
   ```bash
   curl -s -X PUT "$BASE_URL/api/app/$TENANT/approvalinstances/<instance-id>" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '{"status": 1, "approverRemarks": "Approved, proceed.", "approverInputs": 0}'
   ```
   - `status`: `1` = Approved, `2` = Rejected
   - `approverRemarks`: **required** — remarks from the approver
   - `approverInputs`: optional numeric value (e.g., days granted for extensions)
   - Returns 409 if already handled

4. **For my requests** — list own approval requests with status:
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/approvalrequests?mine=true&limit=100&offset=0" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```
   Present: name, type, status (0=Pending, 1=Approved, 2=Rejected), current step, date.

   Count total:
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/countapprovalrequests" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```

5. **For deadline extension** — ask for item, reason, and days:
   ```bash
   curl -s -X POST "$BASE_URL/api/app/$TENANT/itemusers/<item-user-id>/extend" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '{"itemId": "<content-id>", "requestorRemarks": "Need 7 more days", "requestorInput": 7}'
   ```
   Returns 201 with approval request. Returns 409 if request already exists.

6. **For additional assessment attempts** — ask for assessment, reason, and count:
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
   `assessmentType`: `0`=Assessment, `1`=Pre, `2`=Post, `3`=PreEvent, `4`=PostEvent. Returns 409 if exists.

7. **For approval process configuration (admin)**:
   ```bash
   # List available roles for steps
   curl -s "$BASE_URL/api/app/$TENANT/approvalroles" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"

   # List existing processes
   curl -s "$BASE_URL/api/app/$TENANT/approvalprocesses?limit=10&offset=0" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"

   # Create process
   curl -s -X POST "$BASE_URL/api/app/$TENANT/approvalprocesses" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '{"name": "Manager + HR Approval", "steps": ["<role-id-1>", "<role-id-2>"], "default": false}'

   # Update process
   curl -s -X PUT "$BASE_URL/api/app/$TENANT/approvalprocesses/<process-id>" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '{"name": "Updated Name", "steps": ["<role-id-1>"], "default": true}'

   # Delete process
   curl -s -X DELETE "$BASE_URL/api/app/$TENANT/approvalprocesses/<process-id>" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```

8. **For approval type mappings (admin)** — configure which types require approval:
   ```bash
   # List current type mappings
   curl -s "$BASE_URL/api/app/$TENANT/approvaltypes" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"

   # Lookup processes (for dropdown)
   curl -s "$BASE_URL/api/app/$TENANT/lookupapprovalprocesses" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"

   # Bulk update mappings
   curl -s -X PUT "$BASE_URL/api/app/$TENANT/approvaltypesbulk" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '[
       {"approvalTypeId": 0, "approvalProcessId": "<process-id>"},
       {"approvalTypeId": 3, "approvalProcessId": null}
     ]'
   ```
   Type IDs: `0`=Item, `1`=ItemDays, `2`=AdditionalAttempts, `3`=Event, `13`=ParticipantCancellation. Set `approvalProcessId` to `null` to disable.

## Example Interaction

User: "Check if I have any pending approvals to handle"
User: "Approve the deadline extension request from John for the Safety SOP"
User: "Show me all my approval requests and their current status"
User: "Create an approval process that requires manager and then HR sign-off"
