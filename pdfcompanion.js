// PDF Companion for Zotero 7
// Based on zotero-shortdoi by Brenton M. Wiernik

if (typeof Zotero === 'undefined') {
    Zotero = {};
}

function _create(doc, name) {
    const elt =
        Zotero.platformMajorVersion >= 102
            ? doc.createXULElement(name)
            : doc.createElementNS(
                "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
                name
            );
    return elt;
}

PdfCompanion = {
    id: null,
    version: null,
    rootURI: null,
    addedElementIDs: [],
    notifierID: null,
    pendingItems: new Set(),
    timer: null,
    // Environment: "dev" or "prod"
    env: "dev",

    endpoints: {
        dev:  "http://10.0.0.13:8451",
        prod: "http://10.0.0.44:8451"
    },

    get config() {
        return {
            apiUrl: this.endpoints[this.env],
            useScihub: true,
            triggerDelay: 3000
        };
    },

    log(msg) {
        Zotero.debug("PDF Companion: " + msg);
    },

    init({ id, version, rootURI } = {}) {
        this.id = id;
        this.version = version;
        this.rootURI = rootURI;

        // Register notifier for auto-detection of new items
        this.notifierID = Zotero.Notifier.registerObserver(
            this.notifierCallback,
            ["item"]
        );
        this.log("Notifier registered");
    },

    addToWindow(window) {
        this.log("Adding to window");

        let doc = window.document;

        // === Item context menu ===
        // Submenu for PDF Companion
        let submenu = _create(doc, "menu");
        submenu.id = "zotero-itemmenu-pdfcompanion-menu";
        submenu.setAttribute("label", "PDF Companion");

        let submenuPopup = _create(doc, "menupopup");
        submenuPopup.id = "zotero-itemmenu-pdfcompanion-popup";

        // Option 1: Auto fetch
        let autoFetch = _create(doc, "menuitem");
        autoFetch.id = "zotero-itemmenu-pdfcompanion-auto";
        autoFetch.setAttribute("label", "Fetch PDF (auto)");
        autoFetch.addEventListener("command", () => {
            PdfCompanion.fetchPdfForSelected();
        });
        submenuPopup.appendChild(autoFetch);

        // Option 2: Attach local file
        let attachLocal = _create(doc, "menuitem");
        attachLocal.id = "zotero-itemmenu-pdfcompanion-local";
        attachLocal.setAttribute("label", "Attach local PDF...");
        attachLocal.addEventListener("command", () => {
            PdfCompanion.attachLocalPdfForSelected();
        });
        submenuPopup.appendChild(attachLocal);

        // Option 3: Enrich metadata
        let enrichMeta = _create(doc, "menuitem");
        enrichMeta.id = "zotero-itemmenu-pdfcompanion-enrich";
        enrichMeta.setAttribute("label", "Enrich metadata");
        enrichMeta.addEventListener("command", () => {
            PdfCompanion.enrichMetadataForSelected();
        });
        submenuPopup.appendChild(enrichMeta);

        submenu.appendChild(submenuPopup);
        doc.getElementById("zotero-itemmenu").appendChild(submenu);
        this.storeAddedElement(submenu);

        // === Tools menu ===
        let toolsSubmenu = _create(doc, "menu");
        toolsSubmenu.id = "menu_Tools-pdfcompanion-menu";
        toolsSubmenu.setAttribute("label", "PDF Companion");

        let toolsSubmenuPopup = _create(doc, "menupopup");
        toolsSubmenuPopup.id = "menu_Tools-pdfcompanion-popup";

        let toolsAutoFetch = _create(doc, "menuitem");
        toolsAutoFetch.id = "menu_Tools-pdfcompanion-auto";
        toolsAutoFetch.setAttribute("label", "Fetch PDF for Selected (auto)");
        toolsAutoFetch.addEventListener("command", () => {
            PdfCompanion.fetchPdfForSelected();
        });
        toolsSubmenuPopup.appendChild(toolsAutoFetch);

        let toolsAttachLocal = _create(doc, "menuitem");
        toolsAttachLocal.id = "menu_Tools-pdfcompanion-local";
        toolsAttachLocal.setAttribute("label", "Attach local PDF to Selected...");
        toolsAttachLocal.addEventListener("command", () => {
            PdfCompanion.attachLocalPdfForSelected();
        });
        toolsSubmenuPopup.appendChild(toolsAttachLocal);

        let toolsEnrichMeta = _create(doc, "menuitem");
        toolsEnrichMeta.id = "menu_Tools-pdfcompanion-enrich";
        toolsEnrichMeta.setAttribute("label", "Enrich metadata for Selected");
        toolsEnrichMeta.addEventListener("command", () => {
            PdfCompanion.enrichMetadataForSelected();
        });
        toolsSubmenuPopup.appendChild(toolsEnrichMeta);

        toolsSubmenu.appendChild(toolsSubmenuPopup);
        doc.getElementById("menu_ToolsPopup").appendChild(toolsSubmenu);
        this.storeAddedElement(toolsSubmenu);

        this.log("UI elements added");
    },

    addToAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.addToWindow(win);
        }
    },

    storeAddedElement(elem) {
        if (!elem.id) {
            throw new Error("Element must have an id");
        }
        this.addedElementIDs.push(elem.id);
    },

    removeFromWindow(window) {
        var doc = window.document;
        for (let id of this.addedElementIDs) {
            let elem = doc.getElementById(id);
            if (elem) elem.remove();
        }
    },

    removeFromAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.removeFromWindow(win);
        }

        // Unregister notifier
        if (this.notifierID) {
            Zotero.Notifier.unregisterObserver(this.notifierID);
            this.notifierID = null;
        }

        // Clear timer
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    },

    // Notifier callback for auto-detection
    notifierCallback: {
        notify: function (event, type, ids, extraData) {
            if (event !== "add" || type !== "item") return;

            for (let id of ids) {
                PdfCompanion.pendingItems.add(id);
            }

            if (PdfCompanion.timer) {
                clearTimeout(PdfCompanion.timer);
            }

            PdfCompanion.timer = setTimeout(function () {
                PdfCompanion.processPendingItems();
            }, PdfCompanion.config.triggerDelay);
        }
    },

    async processPendingItems() {
        let ids = Array.from(this.pendingItems);
        this.pendingItems.clear();

        for (let id of ids) {
            try {
                let item = await Zotero.Items.getAsync(id);
                if (!item || item.isAttachment() || item.isNote()) continue;

                let itemType = Zotero.ItemTypes.getName(item.itemTypeID);
                if (!["journalArticle", "conferencePaper", "preprint", "book", "thesis"].includes(itemType)) continue;

                await this.recoverPdf(item);
            } catch (e) {
                this.log("processPendingItems error: " + e);
            }
        }
    },

    // === AUTO FETCH ===
    fetchPdfForSelected() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "No items selected");
            return;
        }

        // Filter to regular items only
        items = items.filter(item => !item.isAttachment() && !item.isNote());

        if (items.length === 0) {
            this.showNotification("PDF Companion", "No valid items selected");
            return;
        }

        this.log("Fetching PDF for " + items.length + " items");
        this.processItems(items);
    },

    async processItems(items) {
        for (let item of items) {
            await this.recoverPdf(item);
        }
    },

    async recoverPdf(item) {
        let title = item.getField("title") || "Unknown";
        this.log("Recovering PDF for: " + title);

        // Create a persistent progress window
        let pw = new Zotero.ProgressWindow({ closeOnClick: false });
        pw.changeHeadline("PDF Companion - " + title.substring(0, 30));
        pw.show();

        let stepIcon = "chrome://zotero/skin/spinner-16px.png";
        let stepItem = new pw.ItemProgress(stepIcon, "Connecting to server...");

        try {
            // Use XMLHttpRequest for SSE streaming (more compatible than fetch)
            let url = this.config.apiUrl + "/audit/recover-pdf-stream?key=" + encodeURIComponent(item.key) + "&use_scihub=" + this.config.useScihub;

            let finalResult = await new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                let lastIndex = 0;
                let result = null;

                xhr.open("GET", url, true);
                xhr.setRequestHeader("Accept", "text/event-stream");

                xhr.onprogress = () => {
                    let newData = xhr.responseText.substring(lastIndex);
                    lastIndex = xhr.responseText.length;

                    let lines = newData.split("\n");
                    for (let line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                let data = JSON.parse(line.substring(6));
                                this.log("Progress: " + data.step + " - " + data.message);

                                // Update progress window
                                stepItem.setText(data.message);

                                if (data.step === "complete" || data.step === "error") {
                                    result = data;
                                }
                            } catch (e) {
                                // Ignore JSON parse errors
                            }
                        }
                    }
                };

                xhr.onload = () => resolve(result);
                xhr.onerror = () => reject(new Error("Connection failed"));
                xhr.ontimeout = () => reject(new Error("Timeout"));
                xhr.timeout = 120000;
                xhr.send();
            });

            pw.close();

            if (finalResult && finalResult.status === "success") {
                this.showNotification("PDF Found!", this.getSourceLabel(finalResult.source) + "\n" + title.substring(0, 40));
            } else if (finalResult) {
                this.showNotification("PDF Not Found", title.substring(0, 40) + "\n" + (finalResult.message || "Not available") + "\n\nUse 'Attach local PDF' to add manually.");
            } else {
                this.showNotification("Error", "No response from server");
            }

        } catch (e) {
            pw.close();
            this.log("Error: " + e);
            this.showNotification("Error", e.message || "Connection failed");
        }
    },

    // === ATTACH LOCAL PDF ===
    async attachLocalPdfForSelected() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "No items selected");
            return;
        }

        // Filter to regular items only
        items = items.filter(item => !item.isAttachment() && !item.isNote());

        if (items.length === 0) {
            this.showNotification("PDF Companion", "No valid items selected");
            return;
        }

        if (items.length > 1) {
            this.showNotification("PDF Companion", "Please select only one item");
            return;
        }

        let item = items[0];
        let title = item.getField("title") || "Unknown";

        // Open file picker
        let filePath = await this.pickPdfFile();
        if (!filePath) {
            this.log("File picker cancelled");
            return;
        }

        this.log("Selected file: " + filePath);
        await this.uploadLocalPdf(item, filePath);
    },

    async pickPdfFile() {
        // Use Zotero's file picker
        const { FilePicker } = ChromeUtils.importESModule(
            "chrome://zotero/content/modules/filePicker.mjs"
        );

        let fp = new FilePicker();
        fp.init(
            Zotero.getMainWindow(),
            "Select PDF to attach",
            fp.modeOpen
        );
        fp.appendFilter("PDF Files", "*.pdf");

        let result = await fp.show();
        if (result === fp.returnOK) {
            return fp.file;
        }
        return null;
    },

    async uploadLocalPdf(item, filePath) {
        let title = item.getField("title") || "Unknown";
        this.log("Uploading local PDF for: " + title);

        this.showNotification("PDF Companion", "Uploading PDF...\n" + title.substring(0, 50));

        try {
            // Read the file
            let file = Zotero.File.pathToFile(filePath);
            if (!file.exists()) {
                this.showNotification("Error", "File not found: " + filePath);
                return;
            }

            let fileData = await Zotero.File.getBinaryContentsAsync(file);

            // Create FormData-like request
            let boundary = "----ZoteroPdfCompanion" + Date.now();
            let body = "";
            body += "--" + boundary + "\r\n";
            body += 'Content-Disposition: form-data; name="file"; filename="' + file.leafName + '"\r\n';
            body += "Content-Type: application/pdf\r\n\r\n";

            // Convert to ArrayBuffer for binary data
            let encoder = new TextEncoder();
            let header = encoder.encode(body);
            let footer = encoder.encode("\r\n--" + boundary + "--\r\n");

            // Combine header + file data + footer
            let bodyArray = new Uint8Array(header.length + fileData.length + footer.length);
            bodyArray.set(header, 0);
            bodyArray.set(new Uint8Array(fileData), header.length);
            bodyArray.set(footer, header.length + fileData.length);

            let url = this.config.apiUrl + "/attach-pdf?key=" + encodeURIComponent(item.key) + "&replace_existing=true";

            let response = await Zotero.HTTP.request("POST", url, {
                headers: {
                    "Content-Type": "multipart/form-data; boundary=" + boundary
                },
                body: bodyArray,
                responseType: "json",
                timeout: 120000
            });

            let result = response.response;

            if (result && result.success) {
                this.log("PDF uploaded successfully");
                this.showNotification("PDF Attached!", "Uploaded to Dropbox\n" + title.substring(0, 40));
            } else {
                let err = result ? (result.error || "Upload failed") : "API error";
                this.log("Upload failed: " + err);
                this.showNotification("Upload Failed", title.substring(0, 40) + "\n" + err);
            }
        } catch (e) {
            this.log("Upload error: " + e);
            this.showNotification("Error", e.message || "Upload failed");
        }
    },

    // === ENRICH METADATA ===
    async enrichMetadataForSelected() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "No items selected");
            return;
        }

        // Filter to regular items only
        items = items.filter(item => !item.isAttachment() && !item.isNote());

        if (items.length === 0) {
            this.showNotification("PDF Companion", "No valid items selected");
            return;
        }

        this.log("Enriching metadata for " + items.length + " items");

        for (let item of items) {
            await this.enrichMetadata(item);
        }
    },

    async enrichMetadata(item) {
        let title = item.getField("title") || "Unknown";
        this.log("Enriching metadata for: " + title);

        // Create a persistent progress window
        let pw = new Zotero.ProgressWindow({ closeOnClick: false });
        pw.changeHeadline("Enriching - " + title.substring(0, 30));
        pw.show();

        let stepIcon = "chrome://zotero/skin/spinner-16px.png";
        let stepItem = new pw.ItemProgress(stepIcon, "Connecting to server...");

        try {
            // Use XMLHttpRequest for SSE streaming
            let url = this.config.apiUrl + "/enrich/item-stream/" + encodeURIComponent(item.key);

            let finalResult = await new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                let lastIndex = 0;
                let result = null;

                xhr.open("GET", url, true);
                xhr.setRequestHeader("Accept", "text/event-stream");

                xhr.onprogress = () => {
                    let newData = xhr.responseText.substring(lastIndex);
                    lastIndex = xhr.responseText.length;

                    let lines = newData.split("\n");
                    for (let line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                let data = JSON.parse(line.substring(6));
                                this.log("Enrich progress: " + data.step + " - " + data.message);

                                // Update progress window
                                stepItem.setText(data.message);

                                if (data.step === "complete" || data.step === "error") {
                                    result = data;
                                }
                            } catch (e) {
                                // Ignore JSON parse errors
                            }
                        }
                    }
                };

                xhr.onload = () => resolve(result);
                xhr.onerror = () => reject(new Error("Connection failed"));
                xhr.ontimeout = () => reject(new Error("Timeout"));
                xhr.timeout = 120000;
                xhr.send();
            });

            pw.close();

            if (finalResult && finalResult.status === "success") {
                let fields = finalResult.fields_updated || [];
                let msg = fields.length > 0
                    ? "Updated: " + fields.join(", ")
                    : "No new data found";
                this.showNotification("Metadata Enriched!", msg + "\n" + title.substring(0, 40));

                // Refresh the item in Zotero UI
                await item.reload();
            } else if (finalResult) {
                this.showNotification("Enrichment Failed", title.substring(0, 40) + "\n" + (finalResult.message || "Unknown error"));
            } else {
                this.showNotification("Error", "No response from server");
            }

        } catch (e) {
            pw.close();
            this.log("Enrich error: " + e);
            this.showNotification("Error", e.message || "Connection failed");
        }
    },

    getSourceLabel(src) {
        let labels = {
            "unpaywall": "Source: Unpaywall (Open Access)",
            "unpaywall_oa": "Source: Unpaywall (Open Access)",
            "pmc": "Source: PubMed Central",
            "doi_redirect": "Source: Publisher (Open Access)",
            "scihub": "Source: Sci-Hub",
            "crossref": "Source: CrossRef"
        };
        return labels[src] || ("Source: " + src);
    },

    showNotification(headline, msg) {
        try {
            let pw = new Zotero.ProgressWindow({ closeOnClick: true });
            pw.changeHeadline(headline);
            pw.addDescription(msg);
            pw.show();
            pw.startCloseTimer(5000);
        } catch (e) {
            this.log("Notification error: " + e);
        }
    }
};
