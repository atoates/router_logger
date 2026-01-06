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

module.exports = {
  validateTelemetryPayload
};
