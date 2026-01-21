// PDF Companion Options - Zotero 7

// Use Mozilla Services for preferences
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const PREF_BRANCH = "extensions.pdfcompanion.";

function getPref(key, defaultValue) {
    try {
        let branch = Services.prefs.getBranch(PREF_BRANCH);
        let type = branch.getPrefType(key);
        if (type === Services.prefs.PREF_STRING) {
            return branch.getStringPref(key);
        } else if (type === Services.prefs.PREF_INT) {
            return branch.getIntPref(key);
        } else if (type === Services.prefs.PREF_BOOL) {
            return branch.getBoolPref(key);
        }
    } catch (e) {}
    return defaultValue;
}

function setPref(key, value) {
    try {
        let branch = Services.prefs.getBranch(PREF_BRANCH);
        if (typeof value === "string") {
            branch.setStringPref(key, value);
        } else if (typeof value === "number") {
            branch.setIntPref(key, value);
        } else if (typeof value === "boolean") {
            branch.setBoolPref(key, value);
        }
        return true;
    } catch (e) {
        return false;
    }
}

function onLoad() {
    // Load current preferences
    let host = getPref("serverHost", "10.0.0.44");
    let port = getPref("serverPort", 8451);

    document.getElementById("pdfcompanion-server-host").value = host;
    document.getElementById("pdfcompanion-server-port").value = port;

    // Add event listeners
    document.getElementById("pdfcompanion-test-btn").addEventListener("click", testConnection);
    document.getElementById("pdfcompanion-save-btn").addEventListener("click", savePrefs);

    setStatus("Ready", "#666");
}

function savePrefs() {
    let host = document.getElementById("pdfcompanion-server-host").value.trim();
    let port = parseInt(document.getElementById("pdfcompanion-server-port").value, 10);

    if (!host) {
        setStatus("Error: Host cannot be empty", "#c00");
        return;
    }

    if (!port || port < 1 || port > 65535) {
        setStatus("Error: Invalid port number", "#c00");
        return;
    }

    let ok1 = setPref("serverHost", host);
    let ok2 = setPref("serverPort", port);

    if (ok1 && ok2) {
        setStatus("Settings saved!", "#090");
    } else {
        setStatus("Error saving preferences", "#c00");
    }
}

function testConnection() {
    let host = document.getElementById("pdfcompanion-server-host").value.trim();
    let port = document.getElementById("pdfcompanion-server-port").value;

    if (!host || !port) {
        setStatus("Error: Please enter host and port", "#c00");
        return;
    }

    setStatus("Testing connection...", "#666");

    let url = "http://" + host + ":" + port + "/health";

    let xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.timeout = 5000;

    xhr.onload = function() {
        try {
            let data = JSON.parse(xhr.responseText);
            if (data.status === "healthy") {
                setStatus("Connection OK - " + data.skill + " v" + data.version, "#090");
            } else {
                setStatus("Server responded but status is: " + data.status, "#f90");
            }
        } catch (e) {
            setStatus("Invalid response from server", "#c00");
        }
    };

    xhr.onerror = function() {
        setStatus("Connection failed - network error", "#c00");
    };

    xhr.ontimeout = function() {
        setStatus("Connection failed - timeout", "#c00");
    };

    xhr.send();
}

function setStatus(msg, color) {
    let status = document.getElementById("pdfcompanion-status");
    status.textContent = msg;
    status.style.color = color;
}

// Initialize on load
window.addEventListener("load", onLoad);
