const mqtt = require('mqtt');
const { logger } = require('../config/database');
const { processRouterTelemetry } = require('../services/telemetryProcessor');

let mqttClient = null;

function initMQTT() {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  
  if (!brokerUrl) {
    logger.warn('MQTT_BROKER_URL not configured, MQTT ingestion disabled');
    return null;
  }

  const options = {
    clientId: `router-logger-${Math.random().toString(16).slice(3)}`,
    clean: true,
    connectTimeout: 4000,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    reconnectPeriod: 1000,
  };

  mqttClient = mqtt.connect(brokerUrl, options);

  mqttClient.on('connect', () => {
    logger.info('Connected to MQTT broker');
    
    // Subscribe to RUT200 telemetry topics
    const topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'vacatad/rut200';
    const telemetryTopic = `${topicPrefix}/+/+/telemetry`;
    const eventsTopic = `${topicPrefix}/+/+/events`;
    
    mqttClient.subscribe([telemetryTopic, eventsTopic], (err) => {
      if (err) {
        logger.error('MQTT subscription error:', err);
      } else {
        logger.info(`Subscribed to topics: ${telemetryTopic}, ${eventsTopic}`);
      }
    });
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      logger.info(`Received MQTT message on ${topic}`);
      
      // Extract site_id and device_id from topic
      // Topic format: vacatad/rut200/<site_id>/<device_id>/telemetry
      const topicParts = topic.split('/');
      const siteId = topicParts[2];
      const deviceId = topicParts[3];
      
      payload.site_id = siteId;
      payload.device_id = payload.device_id || deviceId;
      
      // Process telemetry
      if (topic.endsWith('/telemetry')) {
        await processRouterTelemetry(payload);
      } else if (topic.endsWith('/events')) {
        logger.info('Event received:', payload);
        // Handle events (firmware updates, reboots, etc.)
      }
      
    } catch (error) {
      logger.error('Error processing MQTT message:', error);
    }
  });

  mqttClient.on('error', (error) => {
    logger.error('MQTT error:', error);
  });

  mqttClient.on('close', () => {
    logger.warn('MQTT connection closed');
  });

  return mqttClient;
}

function getMQTTClient() {
  return mqttClient;
}

function closeMQTT() {
  if (mqttClient) {
    mqttClient.end();
    logger.info('MQTT connection closed');
  }
}

module.exports = {
  initMQTT,
  getMQTTClient,
  closeMQTT
};
