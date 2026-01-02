#!/bin/bash
# Setup script to initialize Git repository on the droplet
# Run this once on the VPS to set up Git-based deployment

set -e

echo "🔧 Setting up Git-based deployment..."

# Check if we're in the right directory
if [ ! -f docker-compose.yml ]; then
    echo "❌ Error: docker-compose.yml not found. Are you in /opt/radius-server?"
    exit 1
fi

# Check if Git is installed
if ! command -v git &> /dev/null; then
    echo "📦 Installing Git..."
    apt update
    apt install -y git
fi

# Check if this is already a git repository
if [ -d .git ]; then
    echo "✅ Already a Git repository"
    git remote -v
else
    echo "📥 Initializing Git repository..."
    git init
    echo "⚠️  You need to add your Git remote:"
    echo "   git remote add origin <YOUR_GIT_REPO_URL>"
    echo "   git fetch origin"
    echo "   git checkout -b main origin/main"
fi

# Make deploy script executable
chmod +x scripts/deploy.sh

# Create a systemd service for auto-deployment (optional)
echo ""
echo "📝 To set up automatic deployment via webhook, you can:"
echo "   1. Use GitHub Actions / GitLab CI"
echo "   2. Set up a webhook receiver (see scripts/webhook-receiver.sh)"
echo "   3. Use a cron job for periodic pulls"
echo ""
echo "✅ Setup complete!"
echo ""
echo "To deploy manually, run:"
echo "   /opt/radius-server/scripts/deploy.sh"

