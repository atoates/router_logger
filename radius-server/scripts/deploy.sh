#!/bin/bash
# Deployment script for RouterLogger RADIUS Server
# Pulls latest code from Git and rebuilds Docker containers

set -e  # Exit on error

echo "🚀 Starting deployment..."

# Navigate to deployment directory
cd /opt/radius-server || exit 1

# Backup current .env file
if [ -f .env ]; then
    echo "📦 Backing up .env file..."
    cp .env .env.backup
fi

# Pull latest changes from Git
echo "📥 Pulling latest changes from Git..."
git pull origin main || {
    echo "❌ Git pull failed. Checking if this is a git repository..."
    if [ ! -d .git ]; then
        echo "⚠️  Not a git repository. Cloning..."
        cd /opt
        rm -rf radius-server-temp
        git clone <YOUR_GIT_REPO_URL> radius-server-temp
        mv radius-server/.env radius-server-temp/ 2>/dev/null || true
        mv radius-server radius-server-old
        mv radius-server-temp radius-server
        cd radius-server
    else
        exit 1
    fi
}

# Restore .env file (don't overwrite if it exists)
if [ -f .env.backup ] && [ ! -f .env ]; then
    echo "📦 Restoring .env file..."
    mv .env.backup .env
fi

# Rebuild and restart containers
echo "🔨 Rebuilding containers..."
docker compose down
docker compose build --no-cache
docker compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to start..."
sleep 5

# Check service status
echo "📊 Service status:"
docker compose ps

# Show recent logs
echo "📋 Recent logs:"
docker compose logs --tail=20

echo "✅ Deployment complete!"
echo ""
echo "🌐 Captive Portal: http://$(hostname -I | awk '{print $1}'):8081"
echo "📡 RADIUS Auth: $(hostname -I | awk '{print $1}'):1812"
echo "📡 RADIUS Acct: $(hostname -I | awk '{print $1}'):1813"

