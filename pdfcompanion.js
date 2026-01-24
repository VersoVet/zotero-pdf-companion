// PDF Companion for Zotero 7/8

PdfCompanion = {
    id: null,
    version: null,
    rootURI: null,
    addedElementIDs: [],
    notifierID: null,
    pendingItems: new Set(),
    timer: null,

    // Default values
    defaultHost: "10.0.0.44",
    defaultPort: 8451,
    paperReaderPort: 8462,

    getServerHost() {
        try {
            return Zotero.Prefs.get("extensions.pdfcompanion.serverHost", true) || this.defaultHost;
        } catch (e) {
            return this.defaultHost;
        }
    },

    getServerPort() {
        try {
            return Zotero.Prefs.get("extensions.pdfcompanion.serverPort", true) || this.defaultPort;
        } catch (e) {
            return this.defaultPort;
        }
    },

    get config() {
        return {
            apiUrl: "http://" + this.getServerHost() + ":" + this.getServerPort(),
            paperReaderUrl: "http://" + this.getServerHost() + ":" + this.paperReaderPort,
            useScihub: true,
            triggerDelay: 3000
        };
    },

    logBuffer: [],

    log(msg) {
        Zotero.debug("PDF Companion: " + msg);
        this.logBuffer.push(new Date().toISOString() + " - " + msg);
        if (this.logBuffer.length > 100) this.logBuffer.shift();
    },

    init({ id, version, rootURI }) {
        this.id = id;
        this.version = version;
        this.rootURI = rootURI;

        this.log("Initializing v" + version);

        // Register notifier for auto-detection
        this.notifierID = Zotero.Notifier.registerObserver(
            this.notifierCallback,
            ["item"]
        );
    },

    addToWindow(window) {
        let doc = window.document;

        // === Tools Menu ===
        let toolsPopup = doc.getElementById('menu_ToolsPopup');
        if (toolsPopup) {
            let submenu = doc.createXULElement('menu');
            submenu.id = 'pdfcompanion-tools-menu';
            submenu.setAttribute('label', 'PDF Companion');

            let menupopup = doc.createXULElement('menupopup');
            menupopup.id = 'pdfcompanion-tools-popup';

            // Menu items
            let items = [
                { id: 'fetch', label: 'Fetch PDF (auto)', action: () => this.fetchPdfForSelected() },
                { id: 'local', label: 'Attach local PDF...', action: () => this.attachLocalPdfForSelected() },
                { id: 'enrich', label: 'Enrich metadata', action: () => this.enrichMetadataForSelected() },
                { id: 'analyze', label: 'Analyze PDF (Paper Reader)', action: () => this.summarizeForSelected() },
                { id: 'sendlo', label: 'Send to LibreOffice', action: () => this.sendToLibreOffice() },
                { id: 'sep', separator: true },
                { id: 'test', label: 'Test Connection', action: () => this.testConnection() },
                { id: 'logs', label: 'Show Logs', action: () => this.showLogs() }
            ];

            for (let item of items) {
                if (item.separator) {
                    let sep = doc.createXULElement('menuseparator');
                    sep.id = 'pdfcompanion-tools-' + item.id;
                    menupopup.appendChild(sep);
                } else {
                    let menuitem = doc.createXULElement('menuitem');
                    menuitem.id = 'pdfcompanion-tools-' + item.id;
                    menuitem.setAttribute('label', item.label);
                    menuitem.addEventListener('command', item.action);
                    menupopup.appendChild(menuitem);
                }
            }

            submenu.appendChild(menupopup);
            toolsPopup.appendChild(submenu);
            this.storeAddedElement(submenu);
        }

        // === Item Context Menu ===
        let itemMenu = doc.getElementById('zotero-itemmenu');
        if (itemMenu) {
            let submenu = doc.createXULElement('menu');
            submenu.id = 'pdfcompanion-context-menu';
            submenu.setAttribute('label', 'PDF Companion');

            let menupopup = doc.createXULElement('menupopup');
            menupopup.id = 'pdfcompanion-context-popup';

            let items = [
                { id: 'fetch', label: 'Fetch PDF (auto)', action: () => this.fetchPdfForSelected() },
                { id: 'local', label: 'Attach local PDF...', action: () => this.attachLocalPdfForSelected() },
                { id: 'enrich', label: 'Enrich metadata', action: () => this.enrichMetadataForSelected() },
                { id: 'analyze', label: 'Analyze PDF (Paper Reader)', action: () => this.summarizeForSelected() },
                { id: 'sendlo', label: 'Send to LibreOffice', action: () => this.sendToLibreOffice() }
            ];

            for (let item of items) {
                let menuitem = doc.createXULElement('menuitem');
                menuitem.id = 'pdfcompanion-context-' + item.id;
                menuitem.setAttribute('label', item.label);
                menuitem.addEventListener('command', item.action);
                menupopup.appendChild(menuitem);
            }

            submenu.appendChild(menupopup);
            itemMenu.appendChild(submenu);
            this.storeAddedElement(submenu);
        }

        this.log("Added menus to window");
    },

    addToAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.addToWindow(win);
        }
    },

    storeAddedElement(elem) {
        if (!elem.id) throw new Error("Element must have an id");
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
        if (this.notifierID) {
            Zotero.Notifier.unregisterObserver(this.notifierID);
            this.notifierID = null;
        }
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    },

    // === Notifier for auto-detection ===
    notifierCallback: {
        notify: function(event, type, ids) {
            if (event !== "add" || type !== "item") return;
            for (let id of ids) {
                PdfCompanion.pendingItems.add(id);
            }
            if (PdfCompanion.timer) clearTimeout(PdfCompanion.timer);
            PdfCompanion.timer = setTimeout(() => {
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

    // === FETCH PDF ===
    fetchPdfForSelected() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "No items selected");
            return;
        }
        items = items.filter(item => !item.isAttachment() && !item.isNote());
        if (items.length === 0) {
            this.showNotification("PDF Companion", "No valid items selected");
            return;
        }
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

        let pw = new Zotero.ProgressWindow({ closeOnClick: false });
        pw.changeHeadline("PDF Companion - " + title.substring(0, 30));
        pw.show();

        let stepItem = new pw.ItemProgress("chrome://zotero/skin/spinner-16px.png", "Connecting...");

        try {
            let url = this.config.apiUrl + "/audit/recover-pdf-stream?" +
                "key=" + encodeURIComponent(item.key) +
                "&use_scihub=" + (this.config.useScihub ? "true" : "false");

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
                                stepItem.setText(this.getStepText(data));
                                if (data.step === "complete" || data.step === "error") {
                                    result = data;
                                }
                            } catch (e) {}
                        }
                    }
                };

                xhr.onload = () => resolve(result);
                xhr.onerror = () => reject(new Error("Connection failed"));
                xhr.ontimeout = () => reject(new Error("Timeout"));
                xhr.timeout = 180000;
                xhr.send();
            });

            pw.close();

            if (!finalResult) {
                this.showNotification("Error", "No response from server");
                return;
            }

            if (finalResult.status === "success") {
                this.showNotification("PDF Found!", this.getSourceLabel(finalResult.source) + "\n" + title.substring(0, 40));
                try { Zotero.Sync.Runner.sync(); } catch (e) {}
            } else {
                this.showNotification("PDF Not Found", title.substring(0, 40) + "\n" + (finalResult.message || "Not available"));
            }

        } catch (e) {
            pw.close();
            this.showNotification("Error", e.message || "Connection failed");
        }
    },

    getStepText(data) {
        let labels = {
            "start": "Starting...",
            "unpaywall": "Checking Unpaywall...",
            "pmc": "Checking PubMed Central...",
            "doi_redirect": "Checking publisher...",
            "scihub": "Checking Sci-Hub...",
            "download": "Downloading...",
            "attach": "Attaching...",
            "complete": "Done!",
            "error": "Error"
        };
        return labels[data.step] || data.message || data.step;
    },

    getSourceLabel(src) {
        let labels = {
            "unpaywall": "Source: Unpaywall",
            "pmc": "Source: PubMed Central",
            "doi_redirect": "Source: Publisher",
            "scihub": "Source: Sci-Hub"
        };
        return labels[src] || ("Source: " + src);
    },

    // === ATTACH LOCAL PDF ===
    async attachLocalPdfForSelected() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "No items selected");
            return;
        }
        items = items.filter(item => !item.isAttachment() && !item.isNote());
        if (items.length !== 1) {
            this.showNotification("PDF Companion", "Please select exactly one item");
            return;
        }

        let item = items[0];
        let filePath = await this.pickPdfFile();
        if (!filePath) return;

        await this.uploadLocalPdf(item, filePath);
    },

    async pickPdfFile() {
        const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
        let fp = new FilePicker();
        fp.init(Zotero.getMainWindow(), "Select PDF", fp.modeOpen);
        fp.appendFilter("PDF Files", "*.pdf");
        let result = await fp.show();
        return (result === fp.returnOK) ? fp.file : null;
    },

    async uploadLocalPdf(item, filePath) {
        let title = item.getField("title") || "Unknown";
        this.showNotification("PDF Companion", "Uploading...\n" + title.substring(0, 50));

        try {
            let file = Zotero.File.pathToFile(filePath);
            if (!file.exists()) {
                this.showNotification("Error", "File not found");
                return;
            }

            let fileData = await Zotero.File.getBinaryContentsAsync(file);
            let boundary = "----ZoteroPdfCompanion" + Date.now();
            let body = "--" + boundary + "\r\n" +
                'Content-Disposition: form-data; name="file"; filename="' + file.leafName + '"\r\n' +
                "Content-Type: application/pdf\r\n\r\n";

            let encoder = new TextEncoder();
            let header = encoder.encode(body);
            let footer = encoder.encode("\r\n--" + boundary + "--\r\n");
            let bodyArray = new Uint8Array(header.length + fileData.length + footer.length);
            bodyArray.set(header, 0);
            bodyArray.set(new Uint8Array(fileData), header.length);
            bodyArray.set(footer, header.length + fileData.length);

            let url = this.config.apiUrl + "/attach-pdf?key=" + encodeURIComponent(item.key) + "&replace_existing=true";
            let response = await Zotero.HTTP.request("POST", url, {
                headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },
                body: bodyArray,
                responseType: "json",
                timeout: 120000
            });

            if (response.response && response.response.success) {
                this.showNotification("PDF Attached!", title.substring(0, 40));
            } else {
                this.showNotification("Upload Failed", response.response?.error || "Unknown error");
            }
        } catch (e) {
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
        items = items.filter(item => !item.isAttachment() && !item.isNote());
        for (let item of items) {
            await this.enrichMetadata(item);
        }
    },

    async enrichMetadata(item) {
        let title = item.getField("title") || "Unknown";
        let pw = new Zotero.ProgressWindow({ closeOnClick: false });
        pw.changeHeadline("Enriching - " + title.substring(0, 30));
        pw.show();
        let stepItem = new pw.ItemProgress("chrome://zotero/skin/spinner-16px.png", "Connecting...");

        try {
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
                                stepItem.setText(data.message || data.step);
                                if (data.step === "complete" || data.step === "error") {
                                    result = data;
                                }
                            } catch (e) {}
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
                this.showNotification("Metadata Enriched!", fields.length > 0 ? "Updated: " + fields.join(", ") : "No new data");
                await item.reload();
            } else {
                this.showNotification("Enrichment Failed", finalResult?.message || "Unknown error");
            }
        } catch (e) {
            pw.close();
            this.showNotification("Error", e.message || "Connection failed");
        }
    },

    // === PAPER READER ===
    async summarizeForSelected() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "No items selected");
            return;
        }
        items = items.filter(item => !item.isAttachment() && !item.isNote());
        if (items.length !== 1) {
            this.showNotification("PDF Companion", "Please select exactly one item");
            return;
        }
        await this.summarizePaper(items[0]);
    },

    async summarizePaper(item) {
        let title = item.getField("title") || "Unknown";
        let pw = new Zotero.ProgressWindow({ closeOnClick: false });
        pw.changeHeadline("Paper Reader - " + title.substring(0, 25));
        pw.show();
        let stepItem = new pw.ItemProgress("chrome://zotero/skin/spinner-16px.png", "Connecting...");

        try {
            let url = this.config.paperReaderUrl + "/analyze/zotero";
            let response = await Zotero.HTTP.request("POST", url, {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ zotero_key: item.key, options: { language: "fr" } }),
                timeout: 30000
            });

            let result = JSON.parse(response.responseText);

            if (result.status === "pending") {
                stepItem.setText("Processing...");
                await this.pollAnalysis(result.id, pw, stepItem, title);
            } else if (result.status === "completed") {
                pw.close();
                this.showNotification("Analysis Complete!", title.substring(0, 40));
            } else {
                pw.close();
                this.showNotification("Analysis Failed", result.error || "Unknown error");
            }
        } catch (e) {
            pw.close();
            this.showNotification("Error", e.message || "Connection failed");
        }
    },

    async pollAnalysis(ficheId, pw, stepItem, title) {
        let url = this.config.paperReaderUrl + "/fiches/" + ficheId;
        for (let i = 0; i < 60; i++) {
            await Zotero.Promise.delay(5000);
            try {
                let response = await Zotero.HTTP.request("GET", url, { timeout: 10000 });
                let result = JSON.parse(response.responseText);
                stepItem.setText(result.status);
                if (result.status === "completed") {
                    pw.close();
                    this.showNotification("Analysis Complete!", title.substring(0, 40));
                    return;
                } else if (result.status === "failed") {
                    pw.close();
                    this.showNotification("Analysis Failed", result.error || "Processing failed");
                    return;
                }
            } catch (e) {}
        }
        pw.close();
        this.showNotification("Timeout", "Analysis taking too long");
    },

    // === SEND TO LIBREOFFICE ===
    async sendToLibreOffice() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "No items selected");
            return;
        }
        items = items.filter(item => !item.isAttachment() && !item.isNote());
        if (items.length !== 1) {
            this.showNotification("PDF Companion", "Please select exactly one item");
            return;
        }

        let item = items[0];
        let title = item.getField("title") || "Unknown";
        let creators = item.getCreators() || [];
        let authors = creators.filter(c => c.creatorType === "author").map(c => c.lastName || c.name).join(", ");
        let date = item.getField("date") || "";
        let year = date ? date.substring(0, 4) : "";

        try {
            let response = await Zotero.HTTP.request("POST", "http://10.0.0.13:8461/writer/current-reference", {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: item.key, title: title, authors: authors, year: year, doi: item.getField("DOI") || "" }),
                timeout: 10000
            });

            let result = JSON.parse(response.responseText);
            if (result.status === "ok") {
                this.showNotification("Sent to LibreOffice!", title.substring(0, 35));
            } else {
                this.showNotification("Send Failed", result.message || "Unknown error");
            }
        } catch (e) {
            this.showNotification("Connection Error", e.message || "Could not reach article-writer");
        }
    },

    // === UTILITIES ===
    async testConnection() {
        let url = this.config.apiUrl + "/health";
        try {
            let response = await Zotero.HTTP.request("GET", url, { timeout: 5000 });
            let data = JSON.parse(response.responseText);
            if (data.status === "healthy") {
                this.showNotification("Connection OK!", "Server: " + data.skill + " v" + data.version);
            } else {
                this.showNotification("Warning", "Status: " + data.status);
            }
        } catch (e) {
            this.showNotification("Connection Failed", e.message || "Error");
        }
    },

    showLogs() {
        let logs = this.logBuffer.join("\n") || "(no logs)";
        Services.prompt.alert(null, "PDF Companion Logs", logs);
    },

    showNotification(headline, msg) {
        try {
            let pw = new Zotero.ProgressWindow({ closeOnClick: true });
            pw.changeHeadline(headline);
            pw.addDescription(msg);
            pw.show();
            pw.startCloseTimer(5000);
        } catch (e) {}
    }
};
