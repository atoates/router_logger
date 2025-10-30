#!/bin/bash
# Test Property Search and Validation
# This script demonstrates the property search and assignment validation

BASE_URL="https://routerlogger-production.up.railway.app"
LIST_ID="901517043586"

echo "========================================="
echo "Property Search & Validation Test"
echo "========================================="
echo ""

# 1. Check ClickUp auth
echo "1. Checking ClickUp authorization..."
AUTH_STATUS=$(curl -s "$BASE_URL/api/clickup/auth/status")
IS_AUTHORIZED=$(echo $AUTH_STATUS | jq -r '.authorized')

if [ "$IS_AUTHORIZED" = "true" ]; then
    echo "   ✅ ClickUp is authorized"
    WORKSPACE=$(echo $AUTH_STATUS | jq -r '.workspace.workspace_name')
    echo "   Workspace: $WORKSPACE"
else
    echo "   ❌ ClickUp not authorized"
    echo "   Please visit the app and click 'Connect ClickUp'"
    exit 1
fi

echo ""

# 2. Get custom fields
echo "2. Checking for 'Type' custom field..."
FIELDS=$(curl -s "$BASE_URL/api/clickup/custom-fields/$LIST_ID")
TYPE_FIELD=$(echo $FIELDS | jq '.fields | map(select(.name == "Type")) | .[0]')

if [ "$TYPE_FIELD" = "null" ]; then
    echo "   ⚠️  'Type' field not found"
    echo "   Please create it in ClickUp (see CLICKUP-PROPERTY-TYPE-SETUP.md)"
    echo ""
    echo "   Current custom fields:"
    echo $FIELDS | jq -r '.fields | map("   - " + .name + " (" + .type + ")") | .[]'
else
    echo "   ✅ 'Type' field exists"
    echo $TYPE_FIELD | jq '{id, name, type}'
fi

echo ""

# 3. Search for property tasks
echo "3. Searching for property tasks..."
PROPERTIES=$(curl -s "$BASE_URL/api/router-properties/search-properties/$LIST_ID")
PROPERTY_COUNT=$(echo $PROPERTIES | jq -r '.count')

echo "   Found $PROPERTY_COUNT property tasks"

if [ "$PROPERTY_COUNT" -gt 0 ]; then
    echo ""
    echo "   Properties:"
    echo $PROPERTIES | jq -r '.properties | map("   - " + .name + " (" + .id + ")") | .[]'
    
    # 4. Test assignment with first property
    echo ""
    echo "4. Testing assignment validation..."
    FIRST_PROPERTY_ID=$(echo $PROPERTIES | jq -r '.properties[0].id')
    FIRST_PROPERTY_NAME=$(echo $PROPERTIES | jq -r '.properties[0].name')
    
    echo "   Attempting to assign router 6001747099 to: $FIRST_PROPERTY_NAME"
    echo "   Property ID: $FIRST_PROPERTY_ID"
    
    ASSIGN_RESULT=$(curl -s -X POST "$BASE_URL/api/router-properties/assign" \
        -H "Content-Type: application/json" \
        -d '{
            "routerId": "6001747099",
            "propertyTaskId": "'$FIRST_PROPERTY_ID'",
            "installedBy": "Test Script",
            "notes": "Testing property validation",
            "validateClickUp": true
        }')
    
    if echo $ASSIGN_RESULT | jq -e '.success' > /dev/null 2>&1; then
        echo "   ✅ Assignment successful!"
        echo $ASSIGN_RESULT | jq '{success, assignment: {id, router_id, property_name}}'
    else
        ERROR=$(echo $ASSIGN_RESULT | jq -r '.error')
        echo "   ⚠️  Assignment failed: $ERROR"
        
        if echo $ERROR | grep -q "already assigned"; then
            echo "   (This is expected if router was already assigned)"
        fi
    fi
    
else
    echo ""
    echo "   ℹ️  No property tasks found yet"
    echo "   To create property tasks:"
    echo "   1. Go to ClickUp → Routers list"
    echo "   2. Create 'Type' custom field (dropdown)"
    echo "   3. Create tasks with Type = 'property'"
    echo ""
    echo "   See: CLICKUP-PROPERTY-TYPE-SETUP.md for instructions"
fi

echo ""

# 5. Test with invalid (router) task
echo "5. Testing validation with router task..."
echo "   Attempting to assign to a router task (should fail)..."

# Get first router task
ROUTER_TASKS=$(curl -s "$BASE_URL/api/clickup/tasks/$LIST_ID")
ROUTER_TASK_ID=$(echo $ROUTER_TASKS | jq -r '.tasks[0].id')

if [ "$ROUTER_TASK_ID" != "null" ] && [ "$ROUTER_TASK_ID" != "" ]; then
    ROUTER_TASK_NAME=$(echo $ROUTER_TASKS | jq -r '.tasks[0].name')
    echo "   Using task: $ROUTER_TASK_NAME ($ROUTER_TASK_ID)"
    
    INVALID_ASSIGN=$(curl -s -X POST "$BASE_URL/api/router-properties/assign" \
        -H "Content-Type: application/json" \
        -d '{
            "routerId": "6001747100",
            "propertyTaskId": "'$ROUTER_TASK_ID'",
            "installedBy": "Test Script",
            "validateClickUp": true
        }')
    
    ERROR=$(echo $INVALID_ASSIGN | jq -r '.error')
    
    if echo $ERROR | grep -q "not a property task"; then
        echo "   ✅ Validation correctly rejected router task!"
        echo "   Error: $ERROR"
    else
        echo "   Result: $ERROR"
    fi
else
    echo "   ⚠️  No router tasks found to test with"
fi

echo ""
echo "========================================="
echo "Test Complete"
echo "========================================="
echo ""
echo "Summary:"
echo "- Property search filters tasks by Type = 'property'"
echo "- Assignment validates task type before creating record"
echo "- Invalid task types are rejected with clear error messages"
echo ""
echo "Next steps:"
echo "1. Set up 'Type' field in ClickUp (if not done)"
echo "2. Create property tasks with Type = 'property'"
echo "3. Build frontend UI with property search dropdown"
echo ""
echo "Documentation:"
echo "- PROPERTY-SEARCH-QUICKSTART.md - Quick reference"
echo "- PROPERTY-SEARCH-GUIDE.md - Complete API documentation"
echo "- CLICKUP-PROPERTY-TYPE-SETUP.md - Setup instructions"
