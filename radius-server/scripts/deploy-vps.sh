#!/bin/bash
# RouterLogger RADIUS Server - VPS Deployment Script
# 
# This script automates the deployment of the RADIUS server stack
# on a fresh Ubuntu/Debian VPS.
#
# Usage:
#   chmod +x deploy-vps.sh
#   ./deploy-vps.sh
#
# Requirements:
#   - Ubuntu 22.04 LTS or Debian 12
#   - Root or sudo access
#   - At least 2GB RAM, 20GB disk

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/routerlogger-radius"
DOMAIN=""  # Set via argument or prompt

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       RouterLogger RADIUS Server Deployment Script           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root or with sudo${NC}"
    exit 1
fi

# Parse arguments
while getopts "d:" opt; do
    case $opt in
        d) DOMAIN="$OPTARG" ;;
        *) echo "Usage: $0 [-d domain.com]"; exit 1 ;;
    esac
done

# Prompt for domain if not provided
if [ -z "$DOMAIN" ]; then
    echo -e "${YELLOW}Enter your domain name (or press Enter to skip HTTPS setup):${NC}"
    read -r DOMAIN
fi

echo -e "${GREEN}Starting deployment...${NC}"

# ===========================================
# Step 1: Update System
# ===========================================
echo -e "${BLUE}[1/7] Updating system packages...${NC}"
apt-get update
apt-get upgrade -y

# ===========================================
# Step 2: Install Docker
# ===========================================
echo -e "${BLUE}[2/7] Installing Docker...${NC}"

if ! command -v docker &> /dev/null; then
    # Install Docker
    apt-get install -y ca-certificates curl gnupg lsb-release
    
    # Add Docker GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    
    # Add Docker repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    # Start Docker
    systemctl enable docker
    systemctl start docker
    
    echo -e "${GREEN}Docker installed successfully${NC}"
else
    echo -e "${GREEN}Docker already installed${NC}"
fi

# ===========================================
# Step 3: Configure Firewall
# ===========================================
echo -e "${BLUE}[3/7] Configuring firewall...${NC}"

if command -v ufw &> /dev/null; then
    # Enable UFW if not already
    ufw --force enable
    
    # Allow SSH
    ufw allow 22/tcp
    
    # Allow RADIUS ports
    ufw allow 1812/udp comment 'RADIUS Auth'
    ufw allow 1813/udp comment 'RADIUS Acct'
    
    # Allow HTTP/HTTPS
    ufw allow 80/tcp
    ufw allow 443/tcp
    
    # Allow admin ports (restrict in production!)
    ufw allow 8080/tcp comment 'daloRADIUS'
    ufw allow 8081/tcp comment 'Captive Portal'
    
    echo -e "${GREEN}Firewall configured${NC}"
else
    echo -e "${YELLOW}UFW not found, skipping firewall configuration${NC}"
fi

# ===========================================
# Step 4: Create Installation Directory
# ===========================================
echo -e "${BLUE}[4/7] Setting up installation directory...${NC}"

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Clone or copy files (assuming files are in current directory)
if [ -f "./docker-compose.yml" ]; then
    echo -e "${GREEN}Using local files${NC}"
else
    echo -e "${YELLOW}Please copy the radius-server directory to $INSTALL_DIR${NC}"
    echo "Expected files: docker-compose.yml, config/, captive-portal/"
    exit 1
fi

# ===========================================
# Step 5: Generate Secrets
# ===========================================
echo -e "${BLUE}[5/7] Generating secure passwords...${NC}"

if [ ! -f ".env" ]; then
    cp .env.example .env
    
    # Generate random passwords
    DB_ROOT_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    DB_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    RADIUS_SECRET=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    SESSION_SECRET=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
    
    # Update .env file
    sed -i "s/change-this-secure-root-password/$DB_ROOT_PASS/" .env
    sed -i "s/change-this-secure-radius-password/$DB_PASS/" .env
    sed -i "s/change-this-shared-secret/$RADIUS_SECRET/" .env
    sed -i "s/change-this-session-secret/$SESSION_SECRET/" .env
    
    echo -e "${GREEN}Secrets generated and saved to .env${NC}"
    echo ""
    echo -e "${YELLOW}IMPORTANT: Save these values securely!${NC}"
    echo "RADIUS Shared Secret: $RADIUS_SECRET"
    echo "(You'll need this when configuring routers)"
    echo ""
else
    echo -e "${GREEN}Using existing .env file${NC}"
fi

# ===========================================
# Step 6: Start Services
# ===========================================
echo -e "${BLUE}[6/7] Starting Docker services...${NC}"

docker compose up -d

# Wait for services to be ready
echo "Waiting for services to start..."
sleep 30

# Check service status
docker compose ps

# ===========================================
# Step 7: Setup HTTPS (Optional)
# ===========================================
if [ -n "$DOMAIN" ]; then
    echo -e "${BLUE}[7/7] Setting up HTTPS with Caddy...${NC}"
    
    # Install Caddy
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
    
    # Create Caddyfile
    cat > /etc/caddy/Caddyfile << EOF
# RouterLogger RADIUS Admin
admin.$DOMAIN {
    reverse_proxy localhost:8080
}

# Captive Portal
portal.$DOMAIN {
    reverse_proxy localhost:8081
}
EOF
    
    # Restart Caddy
    systemctl restart caddy
    
    echo -e "${GREEN}HTTPS configured for:${NC}"
    echo "  - Admin: https://admin.$DOMAIN"
    echo "  - Portal: https://portal.$DOMAIN"
else
    echo -e "${YELLOW}[7/7] Skipping HTTPS setup (no domain provided)${NC}"
fi

# ===========================================
# Deployment Complete
# ===========================================
echo ""
echo -e "${GREEN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              Deployment Complete!                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo "Access Points:"
if [ -n "$DOMAIN" ]; then
    echo "  - daloRADIUS Admin: https://admin.$DOMAIN"
    echo "  - Captive Portal:   https://portal.$DOMAIN"
else
    echo "  - daloRADIUS Admin: http://$(hostname -I | awk '{print $1}'):8080"
    echo "  - Captive Portal:   http://$(hostname -I | awk '{print $1}'):8081"
fi
echo ""
echo "Default Credentials:"
echo "  - Username: administrator"
echo "  - Password: radius"
echo ""
echo -e "${RED}⚠️  IMPORTANT: Change the default password immediately!${NC}"
echo ""
echo "RADIUS Configuration:"
echo "  - Auth Port: 1812/udp"
echo "  - Acct Port: 1813/udp"
echo "  - Secret: (check .env file)"
echo ""
echo "Next Steps:"
echo "  1. Change daloRADIUS admin password"
echo "  2. Add your routers to the NAS table"
echo "  3. Configure RouterLogger webhook URL in .env"
echo "  4. Update your Teltonika routers to use this RADIUS server"
echo ""
echo "Logs: docker compose logs -f"
echo "Status: docker compose ps"
echo ""

