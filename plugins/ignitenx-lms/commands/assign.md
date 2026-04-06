# /lms:assign

Assign published content to employees or groups via rollout.

## Usage

```
/lms:assign
```

## Description

This command assigns LMS content to specific users or groups/departments by creating a rollout. The correct flow is: **Content Item -> Rollout -> Item Users (auto-created)**. For individual manual assignments, use the item user endpoint after creating a rollout.

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

1. **Identify the content** to assign. Ask for content ID or search:
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/items?search=<term>&skip=0&limit=20" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```

2. **Identify the audience**. Ask who should receive the assignment:
   - **By criteria** (recommended) — assign to a department, location, grade, etc. via rollout criteria
   - **By specific users** — assign to individual user IDs via manual item user assignment

   For criteria-based assignment, use a lookup endpoint to get the criterion value ID:
   ```bash
   # Example: get department IDs
   curl -s "$BASE_URL/api/app/$TENANT/lookupdepartments" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```

   **Supported criteria and their lookup endpoints:**

   | Criteria | Key for `queryProperty` | Lookup Endpoint |
   |----------|------------------------|-----------------|
   | Department | `department` | `GET /lookupdepartments` |
   | Location | `location` | `GET /lookuplocations` |
   | Designation | `designation` | `GET /lookupdesignations` |
   | Grade | `grade` | `GET /lookupgrades` |
   | Level | `level` | `GET /lookuplevels` |
   | Cost Centre | `cost_centre` | `GET /lookupcostcentres` |
   | Organisation Unit | `organisation_unit` | `GET /lookuporgunits` |
   | Business Entity | `business_entity` | `GET /lookupbusinessentities` |
   | Date of Joining | `date_of_joining` | N/A (use date range values) |

   Multiple criteria can be combined — users must match ALL filters (AND logic).

   For individual user assignment, search users:
   ```bash
   curl -s "$BASE_URL/api/app/$TENANT/listusers?name=<name>&offset=0&limit=20" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID"
   ```

3. **Set deadline** (optional but recommended). Suggest based on urgency:
   - Critical: 1 day
   - High: 3 days
   - Normal: 2 weeks
   - Low: 4 weeks

4. **Create a rollout** to assign content to the audience:
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

   **accessType values**: `0` = Internal, `1` = Private, `2` = External, `3` = All users, `4` = Criteria-based (uses `queryProperty`).

   When `myLearning` is `true`, item users are auto-created for all matched users.

5. **Manual assignment** (optional — for individual users not covered by rollout):
   ```bash
   curl -s -X POST "$BASE_URL/api/app/$TENANT/itemuser" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -H "X-Role-ID: $ROLE_ID" \
     -d '{"itemId": "<content-id>", "userId": "<user-id>", "rolloutId": "<rollout-id>"}'
   ```

6. **Report** the result: rollout created, how many users were matched, any manual additions.

## Example Interaction

User: "Assign the new fire safety SOP to the warehouse team, due in two weeks"
