/**
 * Tests for validation utilities
 */

const { validateTelemetryPayload, validateIronWifiWebhookPayload } = require('../../src/utils/validation');

describe('validateTelemetryPayload', () => {
  describe('valid payloads', () => {
    it('should accept a valid telemetry payload with all required fields', () => {
      const payload = {
        device_id: 'RUT200-001',
        timestamp: '2024-01-15T12:00:00Z',
        status: 'online'
      };
      
      const result = validateTelemetryPayload(payload);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept payload with just device_id (minimum required)', () => {
      const payload = {
        device_id: '6001747099'
      };
      
      const result = validateTelemetryPayload(payload);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept payload with optional fields', () => {
      const payload = {
        device_id: 'RUT200-001',
        timestamp: '2024-01-15T12:00:00Z',
        wan_ip: '192.168.1.1',
        rsrp: -85,
        rsrq: -10,
        total_tx_bytes: 1000000,
        total_rx_bytes: 2000000
      };
      
      const result = validateTelemetryPayload(payload);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('invalid payloads', () => {
    it('should reject null payload', () => {
      const result = validateTelemetryPayload(null);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Payload must be an object');
    });

    it('should reject undefined payload', () => {
      const result = validateTelemetryPayload(undefined);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Payload must be an object');
    });

    it('should reject string payload', () => {
      const result = validateTelemetryPayload('not an object');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Payload must be an object');
    });

    it('should reject payload without device_id', () => {
      const payload = {
        timestamp: '2024-01-15T12:00:00Z',
        status: 'online'
      };
      
      const result = validateTelemetryPayload(payload);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('device_id (string) is required');
    });

    it('should reject payload with non-string device_id', () => {
      const payload = {
        device_id: 12345
      };
      
      const result = validateTelemetryPayload(payload);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('device_id (string) is required');
    });

    it('should reject payload with invalid timestamp', () => {
      const payload = {
        device_id: 'RUT200-001',
        timestamp: 'not-a-date'
      };
      
      const result = validateTelemetryPayload(payload);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('timestamp must be a valid date string');
    });
  });
});

describe('validateIronWifiWebhookPayload', () => {
  describe('valid payloads', () => {
    it('should accept array payload', () => {
      const payload = [
        { username: 'user1', session_time: 3600 },
        { username: 'user2', session_time: 7200 }
      ];
      
      const result = validateIronWifiWebhookPayload(payload);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept payload with records property', () => {
      const payload = {
        records: [
          { username: 'user1', session_time: 3600 }
        ]
      };
      
      const result = validateIronWifiWebhookPayload(payload);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept payload with data property', () => {
      const payload = {
        data: [
          { username: 'user1', session_time: 3600 }
        ]
      };
      
      const result = validateIronWifiWebhookPayload(payload);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept payload with rows property', () => {
      const payload = {
        rows: [
          { username: 'user1', session_time: 3600 }
        ]
      };
      
      const result = validateIronWifiWebhookPayload(payload);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('invalid payloads', () => {
    it('should reject null payload', () => {
      const result = validateIronWifiWebhookPayload(null);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Payload is empty');
    });

    it('should reject undefined payload', () => {
      const result = validateIronWifiWebhookPayload(undefined);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Payload is empty');
    });

    it('should reject object without expected properties', () => {
      const payload = {
        something: 'else'
      };
      
      const result = validateIronWifiWebhookPayload(payload);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Payload must be an array or contain a "records", "data", or "rows" property');
    });
  });
});

