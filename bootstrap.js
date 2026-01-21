if (typeof Zotero == 'undefined') {
    var Zotero;
}
var PdfCompanion;
var chromeHandle;

function log(msg) {
    Zotero.debug("PDF Companion: " + msg);
}

// In Zotero 6, bootstrap methods are called before Zotero is initialized
// In Zotero 7, bootstrap methods are not called until Zotero is initialized
async function waitForZotero() {
    if (typeof Zotero != 'undefined') {
        await Zotero.initializationPromise;
        return;
    }

    var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
    var windows = Services.wm.getEnumerator('navigator:browser');
    var found = false;
    while (windows.hasMoreElements()) {
        let win = windows.getNext();
        if (win.Zotero) {
            Zotero = win.Zotero;
            found = true;
            break;
        }
    }
    if (!found) {
        await new Promise((resolve) => {
            var listener = {
                onOpenWindow: function (aWindow) {
                    let domWindow = aWindow
                        .QueryInterface(Ci.nsIInterfaceRequestor)
                        .getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
                    domWindow.addEventListener(
                        "load",
                        function () {
                            domWindow.removeEventListener("load", arguments.callee, false);
                            if (domWindow.Zotero) {
                                Services.wm.removeListener(listener);
                                Zotero = domWindow.Zotero;
                                resolve();
                            }
                        },
                        false
                    );
                },
            };
            Services.wm.addListener(listener);
        });
    }
    await Zotero.initializationPromise;
}

async function install() {
    await waitForZotero();
    log("Installed");
}

async function startup({ id, version, resourceURI, rootURI = resourceURI.spec }) {
    await waitForZotero();

    log("Starting " + version);

    // 'Services' may not be available in Zotero 6
    if (typeof Services == 'undefined') {
        var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
    }

    // Initialize default preferences if not set
    initDefaultPrefs();

    var aomStartup = Cc[
        "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Ci.amIAddonManagerStartup);
    var manifestURI = Services.io.newURI(rootURI + "manifest.json");
    chromeHandle = aomStartup.registerChrome(manifestURI, []);

    Services.scriptloader.loadSubScript(rootURI + "pdfcompanion.js");

    PdfCompanion.init({ id, version, rootURI });
    PdfCompanion.addToAllWindows();
}

function initDefaultPrefs() {
    // Set default preferences if they don't exist
    const defaults = {
        "extensions.pdfcompanion.serverHost": "10.0.0.44",
        "extensions.pdfcompanion.serverPort": 8451
    };

    for (let [key, value] of Object.entries(defaults)) {
        if (Zotero.Prefs.get(key, true) === undefined) {
            Zotero.Prefs.set(key, value, true);
            log("Set default pref: " + key + " = " + value);
        }
    }
}

function onMainWindowLoad({ window }) {
    PdfCompanion.addToWindow(window);
}

function onMainWindowUnload({ window }) {
    PdfCompanion.removeFromWindow(window);
}

function shutdown() {
    log("Shutting down");

    if (chromeHandle) {
        chromeHandle.destruct();
        chromeHandle = null;
    }

    PdfCompanion.removeFromAllWindows();
    PdfCompanion = undefined;
}

function uninstall() {
    if (typeof Zotero == 'undefined') {
        dump("PDF Companion: Uninstalled\n\n");
        return;
    }
    log("Uninstalled");
}
