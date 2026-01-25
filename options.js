// PDF Companion Options - Zotero 7/8

// Use Mozilla Services for preferences - compatible with Zotero 7 and 8
let Services;
try {
    // Zotero 8 / Firefox 140+
    Services = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
} catch (e) {
    // Zotero 7 / Firefox 115
    Services = ChromeUtils.import("resource://gre/modules/Services.jsm").Services;
}

const PREF_BRANCH = "extensions.pdfcompanion.";
const PAPER_READER_PORT = 8462;

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
    } catch (e) {
        console.log("getPref error:", e);
    }
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
        console.log("setPref error:", e);
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
    document.getElementById("pdfcompanion-test-zm-btn").addEventListener("click", testZoteroManager);
    document.getElementById("pdfcompanion-test-pr-btn").addEventListener("click", testPaperReader);
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

function testZoteroManager() {
    let host = document.getElementById("pdfcompanion-server-host").value.trim();
    let port = document.getElementById("pdfcompanion-server-port").value;

    if (!host || !port) {
        setStatus("Error: Please enter host and port", "#c00");
        return;
    }

    setStatus("Testing Zotero Manager...", "#666");

    let url = "http://" + host + ":" + port + "/health";
    testService(url, "Zotero Manager");
}

function testPaperReader() {
    let host = document.getElementById("pdfcompanion-server-host").value.trim();

    if (!host) {
        setStatus("Error: Please enter host", "#c00");
        return;
    }

    setStatus("Testing Paper Reader...", "#666");

    let url = "http://" + host + ":" + PAPER_READER_PORT + "/health";
    testService(url, "Paper Reader");
}

function testService(url, serviceName) {
    let xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.timeout = 5000;

    xhr.onload = function() {
        try {
            let data = JSON.parse(xhr.responseText);
            if (data.status === "healthy") {
                let version = data.version || "unknown";
                let skill = data.skill || serviceName;
                setStatus("✓ " + skill + " v" + version + " - Connected", "#090");
            } else {
                setStatus("⚠ " + serviceName + ": status = " + data.status, "#f90");
            }
        } catch (e) {
            setStatus("✗ " + serviceName + ": Invalid response", "#c00");
        }
    };

    xhr.onerror = function() {
        setStatus("✗ " + serviceName + ": Network error", "#c00");
    };

    xhr.ontimeout = function() {
        setStatus("✗ " + serviceName + ": Timeout", "#c00");
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
