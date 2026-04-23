var PdfCompanion;

function log(msg) {
    Zotero.debug("PDF Companion: " + msg);
}

function install() {
    log("Installed");
}

async function startup({ id, version, rootURI }) {
    log("Starting " + version);

    // Initialize default preferences
    const defaults = {
        "extensions.pdfcompanion.serverHost": "10.0.0.21",
        "extensions.pdfcompanion.serverPort": 8451
    };
    for (let [key, value] of Object.entries(defaults)) {
        if (Zotero.Prefs.get(key, true) === undefined) {
            Zotero.Prefs.set(key, value, true);
        }
    }

    Services.scriptloader.loadSubScript(rootURI + 'pdfcompanion.js');
    PdfCompanion.init({ id, version, rootURI });
    PdfCompanion.addToAllWindows();
}

function onMainWindowLoad({ window }) {
    PdfCompanion.addToWindow(window);
}

function onMainWindowUnload({ window }) {
    PdfCompanion.removeFromWindow(window);
}

function shutdown() {
    log("Shutting down");
    PdfCompanion.removeFromAllWindows();
    PdfCompanion = undefined;
}

function uninstall() {
    log("Uninstalled");
}
