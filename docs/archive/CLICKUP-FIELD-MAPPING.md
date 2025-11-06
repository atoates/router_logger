# ClickUp Custom Field Mapping

## 📊 Data Flow: Router Database → ClickUp Tasks

### Complete Field Mapping

| ClickUp Field | Field Type | Database Source | Example Value | Notes |
|---------------|------------|-----------------|---------------|-------|
| **Task Name** | Built-in | `router.name` | "Router #1" | Fallback: `Router #{router_id}` if name is null |
| **Router ID** | Text | `router.router_id` | "6001747099" | ✅ Always populated |
| **IMEI** | Number | `router.imei` | 863353070422307 | Converted from string to integer |
| **Firmware** | Text | `router.firmware_version` | "RUT2M_R_00.07.18.1" | Optional - only if available |
| **Last Online** | Date | `router.last_seen` | 1730327957468 | Unix timestamp in milliseconds |
| **Operational Status** | Dropdown | `router.current_status` | "Online" or "Offline" | Maps to dropdown options |

---

## 🔍 Detailed Breakdown

### 1. **Task Name** (ClickUp Built-in)
```javascript
name: router.name || `Router #${router.router_id}`
```
- **Source**: `routers.name` (from RMS or manual entry)
- **Format**: Plain text string
- **Example**: "Router #1" or "Router #6001747099"

---

### 2. **Router ID** (Custom Field - Text)
```javascript
{
  id: 'dfe0016c-4ab0-4dd9-bb38-b338411e9b47',
  value: router.router_id.toString()
}
```
- **Source**: `routers.router_id` (primary identifier)
- **Format**: String representation of the ID
- **Example**: "6001747099"
- **Always populated**: ✅ Required field

---

### 3. **IMEI** (Custom Field - Number)
```javascript
{
  id: '8b278eb1-ba02-43c7-81d6-0b739c089e7c',
  value: parseInt(router.imei)
}
```
- **Source**: `routers.imei` (from RMS/device)
- **Format**: Integer (15 digits)
- **Example**: 863353070422307
- **Validation**: Only added if IMEI exists and converts to valid number
- **Original data**: Stored as string in DB, converted to number for ClickUp

---

### 4. **Firmware** (Custom Field - Text)
```javascript
{
  id: '845f6619-e3ee-4634-b92a-a117f14fb8c7',
  value: router.firmware_version
}
```
- **Source**: `routers.firmware_version` (from RMS)
- **Format**: Version string
- **Example**: "RUT2M_R_00.07.18.1"
- **Optional**: Only added if firmware_version exists

---

### 5. **Last Online** (Custom Field - Date)
```javascript
{
  id: '684e19a1-06c3-4bfd-94dd-6aca4a9b85fe',
  value: new Date(router.last_seen).getTime()
}
```
- **Source**: `routers.last_seen` (updated with each log entry)
- **Format**: Unix timestamp in milliseconds
- **Example**: 1730327957468 (Oct 30, 2025 22:19:17 GMT)
- **Conversion**: JavaScript Date object → `.getTime()` → milliseconds
- **Optional**: Only added if last_seen exists

---

### 6. **Operational Status** (Custom Field - Dropdown)
```javascript
{
  id: '8a661229-13f0-4693-a7cb-1df86725cfed',
  value: router.current_status === 'online' 
    ? 'b256bad4-2f9e-4e98-89b1-77a2a5443337'  // Online
    : '7149ad8d-db43-48ab-a038-a17162c7495d'  // Offline
}
```
- **Source**: `router.current_status` (derived from latest log)
- **Format**: ClickUp dropdown option UUID
- **Mapping**:
  - `current_status === 'online'` → Online option (`b256bad4...`)
  - `current_status !== 'online'` → Offline option (`7149ad8d...`)
- **Always populated**: ✅ Required field
- **Note**: Uses UUID option IDs, NOT orderindex numbers

---

## 📝 Additional Task Properties

### Tags
```javascript
tags: ['router', 'auto-created']
```
- Hard-coded tags for all auto-created tasks
- Helps filter/identify automated tasks

### Status
```javascript
status: 'to do'
```
- Default ClickUp status for new tasks
- Can be changed manually in ClickUp

### Priority
```javascript
priority: 3  // Normal priority
```
- ClickUp priority levels: 1=Urgent, 2=High, 3=Normal, 4=Low

---

## 🗂️ Router Database Schema (Source Data)

### `routers` Table Fields Available

| Field | Type | Source | Usage in ClickUp |
|-------|------|--------|------------------|
| `id` | Integer | Auto-increment | Not used |
| `router_id` | String | RMS/Device | ✅ Router ID field + Task name |
| `device_serial` | String | RMS | Not currently used |
| `imei` | String | RMS/Device | ✅ IMEI field (converted to number) |
| `name` | String | RMS/Manual | ✅ Task name |
| `location` | String | RMS/Manual | Not currently used |
| `site_id` | String | RMS | Not currently used |
| `firmware_version` | String | RMS | ✅ Firmware field |
| `created_at` | Timestamp | Database | Not used |
| `last_seen` | Timestamp | Router logs | ✅ Last Online field |
| `rms_created_at` | Timestamp | RMS | Not used |
| `clickup_task_id` | String | ClickUp link | Link back to task |
| `clickup_task_url` | String | ClickUp link | Direct task URL |
| `clickup_list_id` | String | ClickUp link | Which list contains the task |
| `log_count` | Integer | Derived | Not used |
| `current_status` | String | Derived | ✅ Operational Status dropdown |

---

## 🔄 Data Sources Explained

### From RMS (Teltonika Remote Management System)
- `router_id` - Device identifier
- `imei` - SIM card IMEI number
- `firmware_version` - Current firmware version
- `site_id` - RMS organization structure
- `name` - Device name (if set in RMS)
- `location` - Geographic location (if set)

### From Router Logs (MQTT/API)
- `last_seen` - Timestamp of last telemetry received
- `current_status` - Derived from latest log entry status

### From Database
- `log_count` - Number of log entries for this router
- `created_at` - When router was first added to system

### From ClickUp (After Creation)
- `clickup_task_id` - The task ID in ClickUp
- `clickup_task_url` - Direct link to view task
- `clickup_list_id` - Which ClickUp list contains it

---

## 🚀 Fields NOT Currently Used (But Available)

These router fields exist but aren't being sent to ClickUp:

| Field | Why Not Used | Potential Use |
|-------|--------------|---------------|
| `device_serial` | Duplicate of router_id | Could add as custom field |
| `location` | Often null | Could be task description or custom field |
| `site_id` | RMS-specific | Could create ClickUp folders by site |
| `rms_created_at` | Historical only | Could track "install date" |
| `log_count` | Dynamic stat | Could show activity level |

---

## 💡 Potential Additional Fields

If you wanted to add more ClickUp custom fields, here's what's available from the router logs:

From `router_logs` table (latest entry):
- **Signal Strength**: `rsrp`, `rsrq`, `rssi`, `sinr`
- **Network Info**: `operator`, `network_type`, `cell_id`
- **Data Usage**: `total_tx_bytes`, `total_rx_bytes`
- **System Info**: `uptime_seconds`, `cpu_usage`, `memory_free`
- **Location**: `latitude`, `longitude`
- **Temperature**: `cpu_temp_c`, `board_temp_c`
- **WiFi**: `wifi_client_count`
- **Connection**: `wan_ip`, `vpn_status`

---

## 📋 Example Task Creation Payload

```json
{
  "name": "Router #1",
  "status": "to do",
  "priority": 3,
  "tags": ["router", "auto-created"],
  "custom_fields": [
    {
      "id": "dfe0016c-4ab0-4dd9-bb38-b338411e9b47",
      "value": "6001747099"
    },
    {
      "id": "8b278eb1-ba02-43c7-81d6-0b739c089e7c",
      "value": 863353070422307
    },
    {
      "id": "845f6619-e3ee-4634-b92a-a117f14fb8c7",
      "value": "RUT2M_R_00.07.18.1"
    },
    {
      "id": "684e19a1-06c3-4bfd-94dd-6aca4a9b85fe",
      "value": 1730327957468
    },
    {
      "id": "8a661229-13f0-4693-a7cb-1df86725cfed",
      "value": "b256bad4-2f9e-4e98-89b1-77a2a5443337"
    }
  ]
}
```

---

## 🔧 How to Add More Fields

If you want to add additional custom fields:

1. **Create the field in ClickUp**
   - Go to your "Routers" list settings
   - Add custom field (choose type: text, number, date, dropdown, etc.)
   - Copy the field ID

2. **Add to the script**
   ```javascript
   const CUSTOM_FIELDS = {
     // ... existing fields ...
     LOCATION: 'your-new-field-id-here'
   };
   ```

3. **Map the data**
   ```javascript
   if (router.location) {
     customFields.push({
       id: CUSTOM_FIELDS.LOCATION,
       value: router.location
     });
   }
   ```

4. **Update both scripts**
   - `create-all-tasks.js` - for new tasks
   - `update-task-custom-fields.js` - for updating existing tasks

---

**Summary**: You're currently populating 5 custom fields + task name from your router database, with the core fields being Router ID, IMEI, Firmware, Last Online timestamp, and Online/Offline status!
