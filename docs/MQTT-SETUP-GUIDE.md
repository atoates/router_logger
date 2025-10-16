# Optional: MQTT Broker Setup for Local Development

If you want to use MQTT locally or self-host, here are quick setup instructions.

## Option 1: Mosquitto (Lightweight)

### Install
```bash
# macOS
brew install mosquitto

# Ubuntu/Debian
sudo apt-get install mosquitto mosquitto-clients

# Docker
docker run -d -p 1883:1883 -p 9001:9001 --name mosquitto eclipse-mosquitto
```

### Configure
Create `mosquitto.conf`:
```
listener 1883
allow_anonymous true
```

### Run
```bash
mosquitto -c mosquitto.conf
```

### Test
```bash
# Subscribe
mosquitto_sub -h localhost -t "vacatad/rut200/#" -v

# Publish test message
mosquitto_pub -h localhost -t "vacatad/rut200/site1/device1/telemetry" -m '{"device_id":"test","imei":"123"}'
```

## Option 2: EMQX (Production-ready)

### Docker Compose
```yaml
version: '3.8'

services:
  emqx:
    image: emqx/emqx:latest
    container_name: emqx
    ports:
      - "1883:1883"    # MQTT
      - "8083:8083"    # WebSocket
      - "8883:8883"    # MQTT/SSL
      - "18083:18083"  # Dashboard
    environment:
      - EMQX_NAME=emqx
      - EMQX_HOST=localhost
    volumes:
      - emqx-data:/opt/emqx/data
      - emqx-log:/opt/emqx/log

volumes:
  emqx-data:
  emqx-log:
```

Run:
```bash
docker-compose up -d
```

Dashboard: http://localhost:18083 (admin/public)

## Option 3: HiveMQ Community Edition

### Docker
```bash
docker run -d \
  --name hivemq \
  -p 1883:1883 \
  -p 8080:8080 \
  hivemq/hivemq4
```

Dashboard: http://localhost:8080

## Production MQTT Brokers

### AWS IoT Core
- Fully managed
- Auto-scaling
- Integrated with AWS services
- $1 per million messages

Setup:
1. Create Thing in AWS IoT
2. Generate certificates
3. Create policy
4. Use AWS IoT endpoint in RMS

### HiveMQ Cloud
- Free tier: 100 connections
- Managed service
- Global distribution
- Web-based console

### Azure IoT Hub
- Enterprise-grade
- Device management
- Integration with Azure

## Configure in Backend

Update `backend/.env`:
```env
# Local Mosquitto
MQTT_BROKER_URL=mqtt://localhost:1883

# EMQX
MQTT_BROKER_URL=mqtt://localhost:1883

# HiveMQ Cloud
MQTT_BROKER_URL=mqtts://your-instance.hivemq.cloud:8883
MQTT_USERNAME=your-username
MQTT_PASSWORD=your-password

# AWS IoT
MQTT_BROKER_URL=mqtts://your-endpoint.iot.region.amazonaws.com:8883
# Requires certificate-based auth

MQTT_TOPIC_PREFIX=vacatad/rut200
```

## Security for Production

### Enable TLS/SSL
```conf
# mosquitto.conf
listener 8883
cafile /path/to/ca.crt
certfile /path/to/server.crt
keyfile /path/to/server.key
```

### Authentication
```conf
# mosquitto.conf
allow_anonymous false
password_file /path/to/passwd
```

Create password file:
```bash
mosquitto_passwd -c passwd username
```

### ACL (Access Control)
```conf
# mosquitto.conf
acl_file /path/to/acl
```

ACL file:
```
user router1
topic write vacatad/rut200/+/router1/#

user dashboard
topic read vacatad/rut200/#
```

## Monitoring MQTT

### mosquitto_sub for debugging
```bash
# Monitor all topics
mosquitto_sub -h localhost -t "#" -v

# Monitor RUT200 topics only
mosquitto_sub -h localhost -t "vacatad/rut200/#" -v

# Save to file
mosquitto_sub -h localhost -t "vacatad/rut200/#" -v > mqtt.log
```

### MQTT Explorer (GUI)
Download: https://mqtt-explorer.com/

Great for:
- Visualizing topic hierarchy
- Monitoring messages
- Publishing test messages
- Debugging

## Troubleshooting

### Connection refused
```bash
# Check if broker is running
netstat -an | grep 1883

# Check firewall
sudo ufw allow 1883
```

### Authentication failed
```bash
# Test with credentials
mosquitto_pub -h localhost -u username -P password -t test -m "hello"
```

### Messages not arriving
```bash
# Check broker logs
tail -f /var/log/mosquitto/mosquitto.log

# Verify topic subscription
mosquitto_sub -h localhost -t "#" -v
```
