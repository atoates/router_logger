/**
 * Lightweight request validation helpers (no external deps).
 * Goal: fail fast on obviously-invalid payloads to avoid dirty DB rows.
 */

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function canParseDate(value) {
  if (value == null) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function validateTelemetryPayload(body) {
  const errors = [];

  if (!isPlainObject(body)) {
    return { ok: false, errors: ['body must be a JSON object'] };
  }

  if (!isNonEmptyString(body.device_id) && typeof body.device_id !== 'number') {
    errors.push('device_id is required');
  }

  // Timestamp is optional but must be parseable if present
  if (body.timestamp != null && !canParseDate(body.timestamp)) {
    errors.push('timestamp must be a valid date/time');
  }

  // Optional nested objects should be objects when present
  if (body.cell != null && !isPlainObject(body.cell)) {
    errors.push('cell must be an object when provided');
  }
  if (body.counters != null && !isPlainObject(body.counters)) {
    errors.push('counters must be an object when provided');
  }

  return { ok: errors.length === 0, errors };
}

function validateIronwifiWebhookPayload(body) {
  // IronWifi may send:
  // - Array of records (JSON)
  // - Wrapper object with {records|data|rows: [...]}
  // - String (CSV/text) (only works if body parsing supports it)
  const errors = [];

  if (body == null) {
    return { ok: false, errors: ['body is required'] };
  }

  if (Array.isArray(body)) {
    return { ok: true, errors: [] };
  }

  if (typeof body === 'string') {
    // Avoid processing extremely large bodies (safety)
    if (body.length > 5 * 1024 * 1024) {
      return { ok: false, errors: ['body is too large'] };
    }
    return { ok: true, errors: [] };
  }

  if (isPlainObject(body)) {
    const records = body.records || body.data || body.rows;
    if (records == null) {
      // We can still accept it (unknown shape) but won’t process
      return { ok: false, errors: ['unrecognized webhook object shape (expected records/data/rows)'] };
    }
    if (!Array.isArray(records)) {
      errors.push('records/data/rows must be an array');
    }
    return { ok: errors.length === 0, errors };
  }

  return { ok: false, errors: ['unsupported body type'] };
}

module.exports = {
  validateTelemetryPayload,
  validateIronwifiWebhookPayload
};



