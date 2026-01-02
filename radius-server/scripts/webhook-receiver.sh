#!/bin/bash
# Simple webhook receiver for GitHub/GitLab
# Listens for POST requests and triggers deployment
# Usage: Run this as a systemd service or with nohup

PORT=${WEBHOOK_PORT:-9000}
SECRET=${WEBHOOK_SECRET:-change-this-secret}
DEPLOY_DIR="/opt/radius-server"

# Simple HTTP server that listens for webhook
while true; do
    echo "Listening for webhook on port $PORT..."
    
    # Read HTTP request
    read -r REQUEST
    
    # Check if it's a POST request
    if [[ $REQUEST == POST* ]]; then
        # Read headers
        while read -r HEADER; do
            [ -z "$HEADER" ] && break
            if [[ $HEADER == *"X-GitHub-Event"* ]] || [[ $HEADER == *"X-Gitlab-Event"* ]]; then
                echo "✅ Webhook received, triggering deployment..."
                cd "$DEPLOY_DIR" && ./scripts/deploy.sh
                break
            fi
        done
    fi
    
    # Send response
    echo -e "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK"
done | nc -l -p "$PORT"

