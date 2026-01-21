#!/bin/bash
# Deploy PDF Companion plugin to remote Windows PC
# Usage: ./deploy.sh

set -e

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ID="pdf-companion@onyx.local"

# Remote PC config
REMOTE_USER="drlio"
REMOTE_HOST="172.16.0.2"
REMOTE_PATH="C:/Users/drlio/AppData/Roaming/Zotero/Zotero/Profiles/lr7dts6a.default/extensions"

# Get version from manifest.json
VERSION=$(grep -o '"version": *"[^"]*"' "$PLUGIN_DIR/manifest.json" | cut -d'"' -f4)
XPI_NAME="pdf-companion-${VERSION}.xpi"

# Update version in description field
sed -i "s/Auto PDF fetch for Zotero (v[^)]*)/Auto PDF fetch for Zotero (v$VERSION)/" "$PLUGIN_DIR/manifest.json"

echo "=== PDF Companion Deployer ==="
echo "Version: $VERSION"
echo "Target: $REMOTE_USER@$REMOTE_HOST"
echo ""

# Build XPI
echo "[1/3] Building XPI..."
cd "$PLUGIN_DIR"
rm -f pdf-companion-*.xpi
zip -r "$XPI_NAME" manifest.json bootstrap.js pdfcompanion.js prefs.js options.xhtml options.js skin/ -x "*.git*"
echo "      Created: $XPI_NAME"

# Get SSH password from vault
echo "[2/3] Getting credentials..."
SSH_PASS=$(curl -s -H "X-Vault-Token: $ONYX_VAULT_TOKEN" http://10.0.0.44:8050/vault/ssh_password | grep -o '"value":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SSH_PASS" ]; then
    echo "ERROR: Could not get SSH password from vault"
    exit 1
fi

# Deploy to remote
echo "[3/3] Deploying to $REMOTE_HOST..."
sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
    "$PLUGIN_DIR/$XPI_NAME" \
    "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/$PLUGIN_ID.xpi"

# Update extensions.json cache
echo "[4/4] Updating Zotero extensions.json..."
sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$REMOTE_HOST" \
    "powershell -Command \"\$json = Get-Content '$REMOTE_PATH/../extensions.json' -Raw | ConvertFrom-Json; \$addon = \$json.addons | Where-Object { \$_.id -eq '$PLUGIN_ID' }; if (\$addon) { \$addon.version = '$VERSION'; \$addon.defaultLocale.description = 'Auto PDF fetch for Zotero (v$VERSION)'; \$json | ConvertTo-Json -Depth 10 | Set-Content '$REMOTE_PATH/../extensions.json' -Encoding UTF8 }\"" 2>/dev/null

# Verify
REMOTE_SIZE=$(sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$REMOTE_HOST" \
    "powershell -Command \"(Get-Item '$REMOTE_PATH\\$PLUGIN_ID.xpi').Length\"" 2>/dev/null | tr -d '[:space:]')
LOCAL_SIZE=$(stat -c%s "$PLUGIN_DIR/$XPI_NAME")

echo ""
echo "=== Deployment Complete ==="
echo "Local size:  $LOCAL_SIZE bytes"
echo "Remote size: $REMOTE_SIZE bytes"

if [ "$LOCAL_SIZE" = "$REMOTE_SIZE" ]; then
    echo "Status: OK"
    echo ""
    echo "Restart Zotero to load v$VERSION"
else
    echo "Status: WARNING - size mismatch"
fi
