#!/bin/bash
# Deploy PDF Companion plugin to remote PCs
# Usage: ./deploy.sh [all|windows|linux|consult]

# Don't exit on error - we want to continue if one PC is offline
set +e

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ID="pdf-companion@onyx.local"

# Target configs
# VPN PCs - IPs can change, use env vars or pass as argument
# Usage: LINUX_IP=172.16.0.4 ./deploy.sh linux
#        ./deploy.sh 172.16.0.4

# VERSO-Z490M (Linux) via VPN
LINUX_NAME="verso-Z490M"
LINUX_USER="verso"
LINUX_HOST="${LINUX_IP:-172.16.0.4}"
LINUX_PATH="/home/verso/.zotero/zotero/*.default*/extensions"

# Windows PC via VPN (currently offline or IP changed)
WIN_NAME="drlio-PC"
WIN_USER="drlio"
WIN_HOST="${WIN_IP:-172.16.0.5}"
WIN_PATH="C:/Users/drlio/AppData/Roaming/Zotero/Zotero/Profiles/lr7dts6a.default/extensions"

# VERSO-CONSULT (10.0.0.3) - Windows
CONSULT_USER="onyx"
CONSULT_HOST="10.0.0.3"
CONSULT_PATH="C:/Users/Verso/AppData/Roaming/Zotero/Zotero/Profiles/tzd8eihw.default/extensions"

# Get version from manifest.json
VERSION=$(grep -o '"version": *"[^"]*"' "$PLUGIN_DIR/manifest.json" | cut -d'"' -f4)
XPI_NAME="pdf-companion-${VERSION}.xpi"

# Update version in description field
sed -i "s/Auto PDF fetch for Zotero (v[^)]*)/Auto PDF fetch for Zotero (v$VERSION)/" "$PLUGIN_DIR/manifest.json"

echo "=== PDF Companion Deployer ==="
echo "Version: $VERSION"
echo ""

# Build XPI
echo "[1/4] Building XPI..."
cd "$PLUGIN_DIR"
rm -f pdf-companion-*.xpi
zip -r "$XPI_NAME" manifest.json bootstrap.js pdfcompanion.js prefs.js options.xhtml options.js skin/ -x "*.git*"
echo "      Created: $XPI_NAME"
LOCAL_SIZE=$(stat -c%s "$PLUGIN_DIR/$XPI_NAME")

# Get SSH password from vault (for Windows)
echo "[2/4] Getting credentials..."
SSH_PASS=$(curl -s -H "X-Vault-Token: $ONYX_VAULT_TOKEN" http://10.0.0.44:8050/vault/ssh_password | grep -o '"value":"[^"]*"' | cut -d'"' -f4)

# Determine targets - support IP as argument
TARGET="${1:-all}"

# If first arg looks like an IP, use it for Linux deployment
if [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    LINUX_HOST="$1"
    TARGET="linux"
    echo "Using provided IP: $LINUX_HOST"
fi

deploy_windows() {
    echo ""
    echo "--- Deploying to Windows $WIN_NAME ($WIN_HOST) ---"

    if [ -z "$SSH_PASS" ]; then
        echo "SKIP: No SSH password for Windows"
        return 1
    fi

    # Test connection
    if ! timeout 5 sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "$WIN_USER@$WIN_HOST" "echo ok" &>/dev/null; then
        echo "SKIP: Windows PC not reachable"
        return 1
    fi

    echo "  Copying XPI..."
    sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
        "$PLUGIN_DIR/$XPI_NAME" \
        "$WIN_USER@$WIN_HOST:$WIN_PATH/$PLUGIN_ID.xpi"

    echo "  Updating extensions.json..."
    sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "$WIN_USER@$WIN_HOST" \
        "powershell -Command \"\$json = Get-Content '$WIN_PATH/../extensions.json' -Raw | ConvertFrom-Json; \$addon = \$json.addons | Where-Object { \$_.id -eq '$PLUGIN_ID' }; if (\$addon) { \$addon.version = '$VERSION'; \$addon.defaultLocale.description = 'Auto PDF fetch for Zotero (v$VERSION)'; \$addon.targetApplications[0].maxVersion = '8.0.*'; \$json | ConvertTo-Json -Depth 20 | Set-Content '$WIN_PATH/../extensions.json' -Encoding UTF8 }\"" 2>/dev/null

    REMOTE_SIZE=$(sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "$WIN_USER@$WIN_HOST" \
        "powershell -Command \"(Get-Item '$WIN_PATH\\$PLUGIN_ID.xpi').Length\"" 2>/dev/null | tr -d '[:space:]')

    if [ "$LOCAL_SIZE" = "$REMOTE_SIZE" ]; then
        echo "  Status: OK ($REMOTE_SIZE bytes)"
    else
        echo "  Status: WARNING - size mismatch (local: $LOCAL_SIZE, remote: $REMOTE_SIZE)"
    fi
}

deploy_linux() {
    echo ""
    echo "--- Deploying to Linux $LINUX_NAME ($LINUX_HOST) ---"

    # Test connection (using SSH key)
    if ! timeout 5 ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "$LINUX_USER@$LINUX_HOST" "echo ok" &>/dev/null; then
        echo "SKIP: Linux PC not reachable at $LINUX_HOST"
        return 1
    fi

    # Find actual extensions path (glob resolution)
    ACTUAL_PATH=$(ssh -o StrictHostKeyChecking=no "$LINUX_USER@$LINUX_HOST" \
        "ls -d ~/.zotero/zotero/*.default*/extensions 2>/dev/null | head -1")

    if [ -z "$ACTUAL_PATH" ]; then
        echo "SKIP: Zotero profile not found on $LINUX_HOST"
        echo "  Hint: Run Zotero once to create the profile"
        return 1
    fi

    echo "  Profile: $ACTUAL_PATH"

    echo "  Copying XPI..."
    scp -o StrictHostKeyChecking=no \
        "$PLUGIN_DIR/$XPI_NAME" \
        "$LINUX_USER@$LINUX_HOST:$ACTUAL_PATH/$PLUGIN_ID.xpi"

    echo "  Updating extensions.json..."
    ssh -o StrictHostKeyChecking=no "$LINUX_USER@$LINUX_HOST" \
        "cd '$ACTUAL_PATH/..' && python3 -c \"
import json
with open('extensions.json', 'r') as f:
    data = json.load(f)
for addon in data.get('addons', []):
    if addon.get('id') == '$PLUGIN_ID':
        addon['version'] = '$VERSION'
        if 'defaultLocale' in addon:
            addon['defaultLocale']['description'] = 'Auto PDF fetch for Zotero (v$VERSION)'
with open('extensions.json', 'w') as f:
    json.dump(data, f, indent=2)
print('Updated')
\" 2>/dev/null" || echo "  Note: extensions.json update skipped"

    REMOTE_SIZE=$(ssh -o StrictHostKeyChecking=no "$LINUX_USER@$LINUX_HOST" "stat -c%s '$ACTUAL_PATH/$PLUGIN_ID.xpi'" 2>/dev/null)

    if [ "$LOCAL_SIZE" = "$REMOTE_SIZE" ]; then
        echo "  Status: OK ($REMOTE_SIZE bytes)"
    else
        echo "  Status: WARNING - size mismatch (local: $LOCAL_SIZE, remote: $REMOTE_SIZE)"
    fi
}

deploy_consult() {
    echo ""
    echo "--- Deploying to VERSO-CONSULT ($CONSULT_HOST) ---"

    if [ -z "$SSH_PASS" ]; then
        echo "SKIP: No SSH password for VERSO-CONSULT"
        return 1
    fi

    # Test connection
    if ! timeout 5 sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "$CONSULT_USER@$CONSULT_HOST" "echo ok" &>/dev/null; then
        echo "SKIP: VERSO-CONSULT not reachable"
        return 1
    fi

    echo "  Copying XPI..."
    sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
        "$PLUGIN_DIR/$XPI_NAME" \
        "$CONSULT_USER@$CONSULT_HOST:$CONSULT_PATH/$PLUGIN_ID.xpi"

    echo "  Updating extensions.json..."
    sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "$CONSULT_USER@$CONSULT_HOST" \
        "powershell -Command \"\$json = Get-Content '$CONSULT_PATH/../extensions.json' -Raw | ConvertFrom-Json; \$addon = \$json.addons | Where-Object { \$_.id -eq '$PLUGIN_ID' }; if (\$addon) { \$addon.version = '$VERSION'; \$addon.defaultLocale.description = 'Auto PDF fetch for Zotero (v$VERSION)'; \$addon.targetApplications[0].maxVersion = '8.0.*'; \$json | ConvertTo-Json -Depth 20 | Set-Content '$CONSULT_PATH/../extensions.json' -Encoding UTF8 }\"" 2>/dev/null

    REMOTE_SIZE=$(sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "$CONSULT_USER@$CONSULT_HOST" \
        "powershell -Command \"(Get-Item '$CONSULT_PATH\\$PLUGIN_ID.xpi').Length\"" 2>/dev/null | tr -d '[:space:]')

    if [ "$LOCAL_SIZE" = "$REMOTE_SIZE" ]; then
        echo "  Status: OK ($REMOTE_SIZE bytes)"
    else
        echo "  Status: WARNING - size mismatch (local: $LOCAL_SIZE, remote: $REMOTE_SIZE)"
    fi
}

# Execute deployments
echo "[3/4] Deploying..."

WIN_OK=0
LINUX_OK=0
CONSULT_OK=0

case "$TARGET" in
    windows|win|w)
        deploy_windows && WIN_OK=1
        ;;
    linux|lin|l)
        deploy_linux && LINUX_OK=1
        ;;
    consult|c)
        deploy_consult && CONSULT_OK=1
        ;;
    all|*)
        deploy_windows && WIN_OK=1
        deploy_linux && LINUX_OK=1
        deploy_consult && CONSULT_OK=1
        ;;
esac

echo ""
echo "=== Deployment Summary ==="
echo "Version: $VERSION"
if [ "$TARGET" = "all" ] || [ "$TARGET" = "windows" ] || [ "$TARGET" = "win" ] || [ "$TARGET" = "w" ] || [ -z "$TARGET" ]; then
    [ "$WIN_OK" = "1" ] && echo "$WIN_NAME ($WIN_HOST):    OK" || echo "$WIN_NAME ($WIN_HOST):    SKIPPED"
fi
if [ "$TARGET" = "all" ] || [ "$TARGET" = "linux" ] || [ "$TARGET" = "lin" ] || [ "$TARGET" = "l" ] || [ -z "$TARGET" ]; then
    [ "$LINUX_OK" = "1" ] && echo "$LINUX_NAME ($LINUX_HOST):    OK" || echo "$LINUX_NAME ($LINUX_HOST):    SKIPPED"
fi
if [ "$TARGET" = "all" ] || [ "$TARGET" = "consult" ] || [ "$TARGET" = "c" ] || [ -z "$TARGET" ]; then
    [ "$CONSULT_OK" = "1" ] && echo "VERSO-CONSULT ($CONSULT_HOST):    OK" || echo "VERSO-CONSULT ($CONSULT_HOST):    SKIPPED"
fi
echo ""
echo "Restart Zotero to load v$VERSION"
