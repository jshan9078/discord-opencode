#!/bin/bash
# Interactive setup for Discord AI Coding Agent
# Run: ./setup.sh
#
# Features:
# - Interactive prompts for all options
# - Progress indicators
# - Error handling for SSH/deploy failures
# - Local MCP/skill import

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "   Discord AI Coding Agent - Interactive Setup"
echo "═══════════════════════════════════════════════════════════"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Prerequisites Check
# -----------------------------------------------------------------------------
log_info "Step 1: Checking prerequisites..."

# Check doctl
if ! command -v doctl &> /dev/null; then
    log_error "doctl not found. Install from:"
    echo "   macOS: brew install doctl"
    echo "   Other: https://github.com/digitalocean/doctl/releases"
    exit 1
fi
log_success "doctl found"

# Check doctl auth
if ! doctl account get &> /dev/null 2>&1; then
    log_error "Not authenticated with DigitalOcean."
    echo "   Run: doctl auth init"
    exit 1
fi
log_success "Authenticated with DigitalOcean"
echo ""

# -----------------------------------------------------------------------------
# Step 2: Discord Bot Token
# -----------------------------------------------------------------------------
log_info "Step 2: Discord Bot Token"
echo "   Get from: https://discord.com/developers/applications"
echo "   - Create app → Bot → Reset Token"
echo "   - Enable Message Content Intent"
echo ""

read -p "   Enter Discord Bot Token: " DISCORD_TOKEN
while [ -z "$DISCORD_TOKEN" ]; do
    echo "   Token is required."
    read -p "   Enter Discord Bot Token: " DISCORD_TOKEN
done
log_success "Discord token configured"
echo ""

# -----------------------------------------------------------------------------
# Step 3: GitHub Token (Optional)
# -----------------------------------------------------------------------------
log_info "Step 3: GitHub Token (optional, for git push)"
echo "   Get from: https://github.com/settings/tokens/new"
echo "   - Note: 'Discord Bot'"
echo "   - Scopes: repo"
echo ""

read -p "   Enter GitHub Token (press Enter to skip): " GITHUB_TOKEN
if [ -n "$GITHUB_TOKEN" ]; then
    log_success "GitHub token configured"
else
    log_warn "No GitHub token - git push won't work"
fi
echo ""

# -----------------------------------------------------------------------------
# Step 4: VPS Size (Basic Droplets - cheapest for our use case)
# -----------------------------------------------------------------------------
log_info "Step 4: Choose VPS Size"
echo "   Basic Droplets - ideal for lightweight bot workloads"
echo ""
echo "   1. \$6/mo  - 1 vCPU, 1 GB RAM, 25 GB SSD  (1-2 projects)"
echo "   2. \$12/mo - 1 vCPU, 2 GB RAM, 50 GB SSD  (3-5 projects)"
echo "   3. \$24/mo - 2 vCPU, 4 GB RAM, 80 GB SSD  (5+ projects)"
echo ""

read -p "   Select size [1]: " VPS_SIZE
VPS_SIZE=${VPS_SIZE:-1}

case $VPS_SIZE in
    1) VPS_SIZE="s-1vcpu-1gb" VPS_RAM="1GB" VPS_PRICE="$6/mo" ;;
    2) VPS_SIZE="s-1vcpu-2gb" VPS_RAM="2GB" VPS_PRICE="$12/mo" ;;
    3) VPS_SIZE="s-2vcpu-4gb" VPS_RAM="4GB" VPS_PRICE="$24/mo" ;;
    *) VPS_SIZE="s-1vcpu-1gb" VPS_RAM="1GB" VPS_PRICE="$6/mo" ;;
esac

echo "   → Selected: $VPS_SIZE ($VPS_RAM, $VPS_PRICE)"
log_success "VPS size: $VPS_SIZE"
echo ""

# -----------------------------------------------------------------------------
# Step 5: Region
# -----------------------------------------------------------------------------
log_info "Step 5: Choose Region"
echo ""
echo "   1. New York (nyc1)"
echo "   2. San Francisco (sfo3)"
echo "   3. Amsterdam (ams3)"
echo "   4. Singapore (sgp1)"
echo ""

read -p "   Select region [1]: " REGION
REGION=${REGION:-1}

case $REGION in
    1) REGION="nyc1" ;;
    2) REGION="sfo3" ;;
    3) REGION="ams3" ;;
    4) REGION="sgp1" ;;
    *) REGION="nyc1" ;;
esac

echo "   → Selected: $REGION"
log_success "Region: $REGION"
echo ""

# -----------------------------------------------------------------------------
# Step 6: MCPs (Optional)
# -----------------------------------------------------------------------------
log_info "Step 6: Add MCPs (optional)"
echo "   MCPs add extra capabilities. Skip if unsure."
echo ""
echo "   1. None (default - just OpenCode + gh CLI)"
echo "   2. Web Search (brave-search)"
echo "   3. Browser Automation (playwright)"
echo ""

read -p "   Select MCPs [1]: " MCP_SELECTION
MCP_SELECTION=${MCP_SELECTION:-1}

case $MCP_SELECTION in
    2) MCP_LIST="brave-search" ;;
    3) MCP_LIST="playwright" ;;
    1) MCP_LIST="" ;;
    *) MCP_LIST="" ;;
esac

if [ -n "$MCP_LIST" ]; then
    log_success "MCPs: $MCP_LIST"
else
    log_warn "No MCPs - using default OpenCode + gh CLI"
fi
echo ""

# -----------------------------------------------------------------------------
# Step 7: Import Existing MCPs/Skills
# -----------------------------------------------------------------------------
log_info "Step 7: Import Local MCPs & Skills"
echo "   Checking for existing config on this machine..."
echo ""

# Detect local MCPs
LOCAL_MCP_CONFIG=""
if [ -f ~/.config/opencode/config.toml ]; then
    LOCAL_MCP_CONFIG=~/.config/opencode/config.toml
    echo "   ✓ Found: MCP config at ~/.config/opencode/config.toml"
fi

# Detect local skills
LOCAL_SKILLS=""
if [ -d ~/.config/opencode/skills ]; then
    LOCAL_SKILLS=~/.config/opencode/skills
    COUNT=$(ls ~/.config/opencode/skills/ 2>/dev/null | wc -l | tr -d ' ')
    echo "   ✓ Found: $COUNT skills at ~/.config/opencode/skills"
fi

if [ -z "$LOCAL_MCP_CONFIG" ] && [ -z "$LOCAL_SKILLS" ]; then
    log_warn "No local MCPs or skills found - using defaults"
else
    echo ""
    read -p "   Import to VPS? [Y/n]: " IMPORT_LOCAL
    IMPORT_LOCAL=${IMPORT_LOCAL:-Y}
    
    if [[ "$IMPORT_LOCAL" != "n" && "$IMPORT_LOCAL" != "N" ]]; then
        DO_IMPORT=true
        log_success "Will import local MCPs/skills"
    fi
fi
echo ""

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo "═══════════════════════════════════════════════════════════"
echo "   Summary"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "   VPS:        $VPS_SIZE ($VPS_RAM) at $REGION $VPS_PRICE"
echo "   MCPs:       ${MCP_LIST:-default (none)}"
echo "   Import:     ${DO_IMPORT:-no}"
echo ""
read -p "   Continue? [Y/n]: " CONFIRM
CONFIRM=${CONFIRM:-Y}

if [[ "$CONFIRM" == "n" || "$CONFIRM" == "N" ]]; then
    log_warn "Cancelled."
    exit 0
fi
echo ""

# -----------------------------------------------------------------------------
# Provision VPS
# -----------------------------------------------------------------------------
log_info "Provisioning VPS..."

DROPLET_ID=$(doctl compute droplet create discord-bot \
    --region $REGION \
    --size $VPS_SIZE \
    --image ubuntu-24-04 \
    --format id \
    --no-header 2>&1)

if [ $? -ne 0 ]; then
    log_error "Failed to create droplet: $DROPLET_ID"
    exit 1
fi

log_success "Created droplet: $DROPLET_ID"

# Get IP
IP=$(doctl compute droplet get $DROPLET_ID --format public4 --no-header 2>&1)
log_info "IP: $IP"

log_info "Waiting for VPS to be ready..."
sleep 10

# Wait for VPS to be active
for i in {1..20}; do
    STATUS=$(doctl compute droplet get $DROPLET_ID --format status --no-header 2>&1)
    if [ "$STATUS" == "active" ]; then
        log_success "VPS is active"
        break
    fi
    echo "   Waiting... ($i/20)"
    sleep 3
done

if [ "$STATUS" != "active" ]; then
    log_error "VPS did not become active in time"
    exit 1
fi

echo ""

# -----------------------------------------------------------------------------
# Install on VPS
# -----------------------------------------------------------------------------
log_info "Installing bridge on VPS..."

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=30 -o UserKnownHostsFile=/dev/null"

# Wait for SSH to be ready
log_info "Waiting for SSH..."
SSH_READY=false
for i in {1..30}; do
    if ssh $SSH_OPTS root@$IP "echo ok" &> /dev/null; then
        SSH_READY=true
        break
    fi
    echo "   Attempt $i/30..."
    sleep 2
done

if [ "$SSH_READY" = false ]; then
    log_error "SSH not ready after 60 seconds"
    exit 1
fi
log_success "SSH connection established"

# Install dependencies
log_info "Installing system dependencies..."
ssh $SSH_OPTS root@$IP "apt update && apt install -y curl git build-essential" 2>&1
if [ $? -eq 0 ]; then
    log_success "System dependencies installed"
else
    log_error "Failed to install dependencies"
    exit 1
fi

# Install Bun
log_info "Installing Bun..."
ssh $SSH_OPTS root@$IP "curl -fsSL https://bun.sh/install | bash" 2>&1
if [ $? -eq 0 ]; then
    log_success "Bun installed"
else
    log_warn "Bun install had issues - continuing"
fi

# Install bridge
log_info "Installing bridge..."
ssh $SSH_OPTS root@$IP "rm -rf /root/opencode-chat-bridge && git clone https://github.com/ominiverdi/opencode-chat-bridge.git /root/opencode-chat-bridge" 2>&1
if [ $? -eq 0 ]; then
    log_success "Bridge installed"
else
    log_error "Failed to clone bridge"
    exit 1
fi

# Install OpenCode
log_info "Installing OpenCode..."
ssh $SSH_OPTS root@$IP "curl -fsSL https://opencode.ai/install | bash" 2>&1
if [ $? -eq 0 ]; then
    log_success "OpenCode installed"
else
    log_warn "OpenCode install had issues - continuing"
fi

# Configure
log_info "Configuring..."
ssh $SSH_OPTS root@$IP "cd /root/opencode-chat-bridge && echo 'DISCORD_BOT_TOKEN=$DISCORD_TOKEN' > .env" 2>&1
if [ -n "$GITHUB_TOKEN" ]; then
    ssh $SSH_OPTS root@$IP "echo 'GITHUB_TOKEN=$GITHUB_TOKEN' >> /root/opencode-chat-bridge/.env" 2>&1
fi
log_success "Configuration written"

# Install MCPs if selected
if [ -n "$MCP_LIST" ]; then
    log_info "Installing MCPs..."
    ssh $SSH_OPTS root@$IP "mkdir -p ~/.config/opencode" 2>&1
    
    if [[ "$MCP_LIST" == *"brave-search"* ]]; then
        ssh $SSH_OPTS root@$IP "cat > ~/.config/opencode/config.toml" << 'MCPCONFIG'
[mcp]
enabled = true

[mcp.servers.brave-search]
command = "npx"
args = ["-y", "@anthropic/mcp-server-brave-search"]
MCPCONFIG
        log_success "brave-search MCP configured"
    fi
    
    if [[ "$MCP_LIST" == *"playwright"* ]]; then
        ssh $SSH_OPTS root@$IP "cat >> ~/.config/opencode/config.toml" << 'MCPCONFIG'

[mcp.servers.playwright]
command = "npx"
args = ["-y", "@anthropic/mcp-server-playwright"]
MCPCONFIG
        log_success "playwright MCP configured"
    fi
fi

# Import local MCPs/skills if detected
if [ "$DO_IMPORT" = true ]; then
    log_info "Importing local MCPs/skills..."
    
    if [ -n "$LOCAL_MCP_CONFIG" ]; then
        scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$LOCAL_MCP_CONFIG" root@$IP:~/.config/opencode/config.toml 2>&1
        log_success "MCP config imported"
    fi
    
    if [ -n "$LOCAL_SKILLS" ]; then
        scp -r -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$LOCAL_SKILLS" root@$IP:~/.config/opencode/ 2>&1
        log_success "Skills imported"
    fi
fi

# Create systemd service
log_info "Creating systemd service..."
ssh $SSH_OPTS root@$IP "cat > /etc/systemd/system/discord-bot.service << 'SERVICE'
[Unit]
Description=Discord Coding Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/opencode-chat-bridge
ExecStart=/root/.bun/bin/bun connectors/discord.ts
Restart=always
Environment=PATH=/root/.bun/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
SERVICE"
log_success "Service file created"

# Enable and start
log_info "Starting bot..."
ssh $SSH_OPTS root@$IP "systemctl daemon-reload" 2>&1
ssh $SSH_OPTS root@$IP "systemctl enable discord-bot" 2>&1
ssh $SSH_OPTS root@$IP "systemctl start discord-bot" 2>&1

# Check status
sleep 3
BOT_STATUS=$(ssh $SSH_OPTS root@$IP "systemctl is-active discord-bot" 2>&1)
if [ "$BOT_STATUS" == "active" ]; then
    log_success "Bot is running"
else
    log_warn "Bot may not have started - check with: systemctl status discord-bot"
fi

echo ""

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
echo "═══════════════════════════════════════════════════════════"
echo -e "   ${GREEN}Setup Complete!${NC}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "   Bot IP:     $IP"
echo "   SSH:       ssh root@$IP"
echo "   Status:    systemctl status discord-bot"
echo ""
echo "   Next steps:"
echo "   1. In Discord, mention the bot: @YourBotName"
echo "   2. Run: @Bot init to set up your first project"
echo "   3. Start coding!"
echo ""
echo "   Docs: See cloud-setup.md for full guide"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Prerequisites Check
# -----------------------------------------------------------------------------
echo "📋 Step 1: Checking prerequisites..."
echo ""

# Check doctl
if ! command -v doctl &> /dev/null; then
    echo "❌ doctl not found. Install from:"
    echo "   macOS: brew install doctl"
    echo "   Other: https://github.com/digitalocean/doctl/releases"
    exit 1
fi

# Check doctl auth
if ! doctl account get &> /dev/null; then
    echo "❌ Not authenticated with DigitalOcean."
    echo "   Run: doctl auth init"
    exit 1
fi

echo "✅ Prerequisites OK"
echo ""

# -----------------------------------------------------------------------------
# Step 2: Discord Bot Token
# -----------------------------------------------------------------------------
echo "📋 Step 2: Discord Bot Token"
echo "   Get from: https://discord.com/developers/applications"
echo "   - Create app → Bot → Reset Token"
echo "   - Enable Message Content Intent"
echo ""

read -p "Enter Discord Bot Token: " DISCORD_TOKEN
while [ -z "$DISCORD_TOKEN" ]; do
    read -p "Token (required): " DISCORD_TOKEN
done
echo ""

# -----------------------------------------------------------------------------
# Step 3: GitHub Token (Optional)
# -----------------------------------------------------------------------------
echo "📋 Step 3: GitHub Token (optional, for git push)"
echo "   Get from: https://github.com/settings/tokens/new"
echo "   - Note: 'Discord Bot'"
echo "   - Scopes: repo"
echo ""

read -p "Enter GitHub Token (press Enter to skip): " GITHUB_TOKEN
echo ""

# -----------------------------------------------------------------------------
# Step 4: VPS Size (Basic Droplets - cheapest for our use case)
# -----------------------------------------------------------------------------
echo "📋 Step 4: Choose VPS Size"
echo "   Basic Droplets - ideal for lightweight bot workloads"
echo ""
echo "   1. \$6/mo  - 1 vCPU, 1 GB RAM, 25 GB SSD  (1-2 projects)"
echo "   2. \$12/mo - 1 vCPU, 2 GB RAM, 50 GB SSD  (3-5 projects)"
echo "   3. \$24/mo - 2 vCPU, 4 GB RAM, 80 GB SSD  (5+ projects)"
echo ""

read -p "Select size [1]: " VPS_SIZE
VPS_SIZE=${VPS_SIZE:-1}

case $VPS_SIZE in
    1) VPS_SIZE="s-1vcpu-1gb" ;;
    2) VPS_SIZE="s-1vcpu-2gb" ;;
    3) VPS_SIZE="s-2vcpu-4gb" ;;
    *) VPS_SIZE="s-1vcpu-1gb" ;;
esac

echo "   → Selected: $VPS_SIZE"
echo ""

# -----------------------------------------------------------------------------
# Step 5: Region
# -----------------------------------------------------------------------------
echo "📋 Step 5: Choose Region"
echo ""
echo "   1. New York (nyc1)"
echo "   2. San Francisco (sfo3)"
echo "   3. Amsterdam (ams3)"
echo "   4. Singapore (sgp1)"
echo ""

read -p "Select region [1]: " REGION
REGION=${REGION:-1}

case $REGION in
    1) REGION="nyc1" ;;
    2) REGION="sfo3" ;;
    3) REGION="ams3" ;;
    4) REGION="sgp1" ;;
    *) REGION="nyc1" ;;
esac

echo "   → Selected: $REGION"
echo ""

# -----------------------------------------------------------------------------
# Step 6: Coding Agent
# -----------------------------------------------------------------------------
echo "📋 Step 6: Choose Coding Agent"
echo ""
echo "   Uses OpenCode as the coding agent."
echo ""

# -----------------------------------------------------------------------------
# Step 7: MCPs
# -----------------------------------------------------------------------------
echo "📋 Step 7: Add MCPs (optional)"
echo "   MCPs add extra capabilities to the agent."
echo ""
echo "   Common MCPs:"
echo "     1. None (default - OpenCode + gh CLI)"
echo "     2. Web Search (brave-search)"
echo "     3. Browser Automation (playwright)"
echo "     4. All of the above"
echo ""

read -p "Select MCPs [1]: " MCP_SELECTION
MCP_SELECTION=${MCP_SELECTION:-1}

case $MCP_SELECTION in
    2) MCP_LIST="brave-search" ;;
    3) MCP_LIST="playwright" ;;
    4) MCP_LIST="brave-search,playwright" ;;
    *) MCP_LIST="" ;;
esac

echo "   → Selected: ${MCP_LIST:-none}"
echo ""

# -----------------------------------------------------------------------------
# Step 8: Import Existing MCPs/Skills
# -----------------------------------------------------------------------------
echo "📋 Step 8: Import Your Local MCPs & Skills"
echo "   We can detect MCPs and skills from your local machine."
echo ""

# Detect local MCPs
LOCAL_MCP_CONFIG=""
if [ -f ~/.config/opencode/config.toml ]; then
    LOCAL_MCP_CONFIG=~/.config/opencode/config.toml
    echo "   Found: MCP config at ~/.config/opencode/config.toml"
fi

# Detect local skills
LOCAL_SKILLS=""
if [ -d ~/.config/opencode/skills ]; then
    LOCAL_SKILLS=~/.config/opencode/skills
    echo "   Found: Skills at ~/.config/opencode/skills ($(ls ~/.config/opencode/skills/ | wc -l) skills)"
fi

if [ -z "$LOCAL_MCP_CONFIG" ] && [ -z "$LOCAL_SKILLS" ]; then
    echo "   No local MCPs or skills found. You'll use defaults."
else
    echo ""
    read -p "   Import to VPS? [Y/n]: " IMPORT_LOCAL
    IMPORT_LOCAL=${IMPORT_LOCAL:-Y}
    
    if [[ "$IMPORT_LOCAL" != "n" && "$IMPORT_LOCAL" != "N" ]]; then
        DO_IMPORT=true
    fi
fi
echo ""

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo "═══════════════════════════════════════════════════════════"
echo "   Summary"
echo "═══════════════════════════════════════════════════"
echo ""
echo "   VPS:        $VPS_SIZE at $REGION (\$6-24/mo)"
echo "   Agent:      $CODING_AGENT"
echo "   MCPs:      ${MCP_LIST:-none}"
echo "   Slack:     ${SLACK_BOT_TOKEN:+enabled}"
echo ""
read -p "   Continue? [Y/n]: " CONFIRM
CONFIRM=${CONFIRM:-Y}

if [[ "$CONFIRM" == "n" || "$CONFIRM" == "N" ]]; then
    echo "Cancelled."
    exit 0
fi
echo ""

# -----------------------------------------------------------------------------
# Provision VPS
# -----------------------------------------------------------------------------
echo "⏳ Provisioning VPS..."

DROPLET_ID=$(doctl compute droplet create discord-bot \
    --region $REGION \
    --size $VPS_SIZE \
    --image ubuntu-24-04 \
    --format id \
    --no-header)

echo "   Created droplet: $DROPLET_ID"

# Get IP
IP=$(doctl compute droplet get $DROPLET_ID --format public4 --no-header)
echo "   IP: $IP"

echo "   Waiting for VPS to be ready (30s)..."
sleep 30

echo "✅ VPS ready"
echo ""

# -----------------------------------------------------------------------------
# Install on VPS
# -----------------------------------------------------------------------------
echo "⏳ Installing bridge on VPS..."

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

# Wait for SSH to be ready
echo "   Waiting for SSH..."
for i in {1..30}; do
    if ssh $SSH_OPTS root@$IP "echo ok" &> /dev/null; then
        echo "   SSH ready"
        break
    fi
    sleep 2
done

# Install dependencies
echo "   Installing dependencies..."
ssh $SSH_OPTS root@$IP "apt update && apt install -y curl git build-essential"

# Install Bun
echo "   Installing Bun..."
ssh $SSH_OPTS root@$IP "curl -fsSL https://bun.sh/install | bash"

# Install bridge
echo "   Installing bridge..."
ssh $SSH_OPTS root@$IP "git clone https://github.com/ominiverdi/opencode-chat-bridge.git /root/opencode-chat-bridge"

# Install the coding agent (OpenCode)
echo "   Installing OpenCode..."
ssh $SSH_OPTS root@$IP "curl -fsSL https://opencode.ai/install | bash"

# Configure
echo "   Configuring..."
ssh $SSH_OPTS root@$IP "cd /root/opencode-chat-bridge && echo 'DISCORD_BOT_TOKEN=$DISCORD_TOKEN' > .env"
if [ -n "$GITHUB_TOKEN" ]; then
    ssh $SSH_OPTS root@$IP "echo 'GITHUB_TOKEN=$GITHUB_TOKEN' >> /root/opencode-chat-bridge/.env"
fi

# Install MCPs if selected (user choices)
if [ -n "$MCP_LIST" ]; then
    echo "   Installing MCPs..."
    ssh $SSH_OPTS root@$IP "mkdir -p ~/.config/opencode"
    
    if [[ "$MCP_LIST" == *"brave-search"* ]]; then
        cat << 'MCPCONFIG' | ssh $SSH_OPTS root@$IP "cat > ~/.config/opencode/config.toml"
[mcp]
enabled = true

[mcp.servers.brave-search]
command = "npx"
args = ["-y", "@anthropic/mcp-server-brave-search"]
MCPCONFIG
    fi
fi

# Import local MCPs/skills if detected
if [ "$DO_IMPORT" = true ]; then
    echo "   Importing local MCPs/skills..."
    
    if [ -n "$LOCAL_MCP_CONFIG" ]; then
        scp $SSH_OPTS "$LOCAL_MCP_CONFIG" root@$IP:~/.config/opencode/config.toml
        echo "   → Imported MCP config"
    fi
    
    if [ -n "$LOCAL_SKILLS" ]; then
        scp -r $SSH_OPTS "$LOCAL_SKILLS" root@$IP:~/.config/opencode/skills
        echo "   → Imported skills"
    fi
fi

# Create systemd service
echo "   Creating service..."
ssh $SSH_OPTS root@$IP "cat > /etc/systemd/system/discord-bot.service << 'SERVICE'
[Unit]
Description=Discord Coding Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/opencode-chat-bridge
ExecStart=/root/.bun/bin/bun connectors/discord.ts
Restart=always

[Install]
WantedBy=multi-user.target
SERVICE"

# Enable and start
echo "   Starting bot..."
ssh $SSH_OPTS root@$IP "systemctl daemon-reload && systemctl enable discord-bot && systemctl start discord-bot"

echo "✅ Installation complete"
echo ""

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
echo "═══════════════════════════════════════════════════"
echo "   Setup Complete!"
echo "═══════════════════════════════════════════════════"
echo ""
echo "   Bot IP:     $IP"
echo "   Status:    ssh root@$IP 'systemctl status discord-bot'"
echo ""
echo "   In Discord:"
echo "     @YourBotName add a login feature"
echo ""
echo "   To connect via SSH:"
echo "     ssh root@$IP"
echo ""
echo "   For MCPs, SSH in and edit ~/.config/opencode/config.toml"
echo ""