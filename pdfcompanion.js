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
                { id: 'replace', label: 'Replace PDF...', action: () => this.replacePdfForSelected() },
                { id: 'enrich', label: 'Enrich metadata', action: () => this.enrichMetadataForSelected() },
                { id: 'analyze', label: 'Analyze PDF (Paper Reader)', action: () => this.summarizeForSelected() },
                { id: 'sendlo', label: 'Send to LibreOffice', action: () => this.sendToLibreOffice() },
                { id: 'sep', separator: true },
                { id: 'shownotes', label: 'Show Notes', action: () => this.showFormattedNotes() },
                { id: 'copyid', label: 'Copy Item ID', action: () => this.copyItemId() },
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
                { id: 'replace', label: 'Replace PDF...', action: () => this.replacePdfForSelected() },
                { id: 'enrich', label: 'Enrich metadata', action: () => this.enrichMetadataForSelected() },
                { id: 'analyze', label: 'Analyze PDF (Paper Reader)', action: () => this.summarizeForSelected() },
                { id: 'sendlo', label: 'Send to LibreOffice', action: () => this.sendToLibreOffice() },
                { id: 'sep', separator: true },
                { id: 'shownotes', label: 'Show Notes', action: () => this.showFormattedNotes() },
                { id: 'copyid', label: 'Copy Item ID', action: () => this.copyItemId() }
            ];

            for (let item of items) {
                if (item.separator) {
                    let sep = doc.createXULElement('menuseparator');
                    sep.id = 'pdfcompanion-context-' + item.id;
                    menupopup.appendChild(sep);
                } else {
                    let menuitem = doc.createXULElement('menuitem');
                    menuitem.id = 'pdfcompanion-context-' + item.id;
                    menuitem.setAttribute('label', item.label);
                    menuitem.addEventListener('command', item.action);
                    menupopup.appendChild(menuitem);
                }
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

        let pw = new Zotero.ProgressWindow({ closeOnClick: true });
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

            // Convert binary string to Uint8Array properly
            let fileBytes = new Uint8Array(fileData.length);
            for (let i = 0; i < fileData.length; i++) {
                fileBytes[i] = fileData.charCodeAt(i) & 0xff;
            }

            let boundary = "----ZoteroPdfCompanion" + Date.now();
            let body = "--" + boundary + "\r\n" +
                'Content-Disposition: form-data; name="file"; filename="' + file.leafName + '"\r\n' +
                "Content-Type: application/pdf\r\n\r\n";

            let encoder = new TextEncoder();
            let header = encoder.encode(body);
            let footer = encoder.encode("\r\n--" + boundary + "--\r\n");
            let bodyArray = new Uint8Array(header.length + fileBytes.length + footer.length);
            bodyArray.set(header, 0);
            bodyArray.set(fileBytes, header.length);
            bodyArray.set(footer, header.length + fileBytes.length);

            let url = this.config.apiUrl + "/item/" + encodeURIComponent(item.key) + "/attach-pdf?replace_existing=true";
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

    // === REPLACE PDF ===
    async replacePdfForSelected() {
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

        await this.replacePdf(item, filePath);
    },

    async replacePdf(item, filePath) {
        let title = item.getField("title") || "Unknown";
        this.log("Replacing PDF for: " + title + " (key: " + item.key + ")");

        // Use ProgressWindow (closeOnClick: true allows closing by clicking)
        let pw = new Zotero.ProgressWindow({ closeOnClick: true });
        pw.changeHeadline("Replace PDF - " + title.substring(0, 30));
        pw.show();

        let stepItem = new pw.ItemProgress("chrome://zotero/skin/spinner-16px.png", "Reading file...");

        try {
            let file = Zotero.File.pathToFile(filePath);
            if (!file.exists()) {
                stepItem.setIcon("chrome://zotero/skin/cross.png");
                stepItem.setText("File not found");
                setTimeout(() => pw.close(), 3000);
                return;
            }

            let filename = file.leafName;
            if (!filename.toLowerCase().endsWith('.pdf')) {
                filename += '.pdf';
            }

            this.log("Reading file: " + filename);
            stepItem.setText("Reading: " + filename);
            let fileData = await Zotero.File.getBinaryContentsAsync(file);
            this.log("File read: " + fileData.length + " bytes");

            if (fileData.length < 1000) {
                stepItem.setIcon("chrome://zotero/skin/cross.png");
                stepItem.setText("Invalid PDF (too small)");
                setTimeout(() => pw.close(), 3000);
                return;
            }

            stepItem.setText("Uploading " + Math.round(fileData.length / 1024) + " KB...");

            // Convert binary string to Uint8Array properly
            let fileBytes = new Uint8Array(fileData.length);
            for (let i = 0; i < fileData.length; i++) {
                fileBytes[i] = fileData.charCodeAt(i) & 0xff;
            }

            // Build multipart form data
            let boundary = "----WebKitFormBoundary" + Math.random().toString(36).substr(2);
            let body = "--" + boundary + "\r\n" +
                'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
                "Content-Type: application/pdf\r\n\r\n";

            let encoder = new TextEncoder();
            let header = encoder.encode(body);
            let footer = encoder.encode("\r\n--" + boundary + "--\r\n");

            let bodyArray = new Uint8Array(header.length + fileBytes.length + footer.length);
            bodyArray.set(header, 0);
            bodyArray.set(fileBytes, header.length);
            bodyArray.set(footer, header.length + fileBytes.length);

            // Use SSE streaming endpoint
            let url = this.config.apiUrl + "/item/" + encodeURIComponent(item.key) + "/replace-pdf/stream";
            this.log("POST SSE " + url);

            let self = this;
            let finalResult = await new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                let lastIndex = 0;
                let result = null;

                xhr.open("POST", url, true);
                xhr.setRequestHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
                xhr.setRequestHeader("Accept", "text/event-stream");

                xhr.onprogress = () => {
                    let newData = xhr.responseText.substring(lastIndex);
                    lastIndex = xhr.responseText.length;
                    let lines = newData.split("\n");
                    for (let line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                let data = JSON.parse(line.substring(6));
                                self.log("SSE: " + JSON.stringify(data));
                                stepItem.setText(self.getReplaceStepText(data));
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
                xhr.send(bodyArray);
            });

            if (!finalResult) {
                stepItem.setIcon("chrome://zotero/skin/cross.png");
                stepItem.setText("No response from server");
                setTimeout(() => pw.close(), 3000);
                return;
            }

            if (finalResult.status === "success") {
                let msg = finalResult.filename || filename;
                if (finalResult.deleted_count > 0) {
                    msg += " (" + finalResult.deleted_count + " old removed)";
                }
                stepItem.setIcon("chrome://zotero/skin/tick.png");
                stepItem.setText("Done: " + msg);
                setTimeout(() => pw.close(), 3000);
                try { Zotero.Sync.Runner.sync(); } catch (e) {}
            } else {
                stepItem.setIcon("chrome://zotero/skin/cross.png");
                stepItem.setText("Failed: " + (finalResult.message || "Unknown error"));
                setTimeout(() => pw.close(), 4000);
            }
        } catch (e) {
            this.log("Replace PDF error: " + e);
            stepItem.setIcon("chrome://zotero/skin/cross.png");
            stepItem.setText("Error: " + (e.message || "Upload failed"));
            setTimeout(() => pw.close(), 4000);
        }
    },

    getReplaceStepText(data) {
        let labels = {
            "uploading": "Uploading file...",
            "validating": "Validating PDF...",
            "checking_item": "Checking item...",
            "deleting_old": "Removing old attachments...",
            "attaching": "Attaching new PDF...",
            "syncing": "Syncing with Zotero...",
            "complete": "Complete!",
            "error": "Error: " + (data.message || "Unknown")
        };
        let text = labels[data.step] || data.step || "Processing...";
        if (data.message && data.step !== "error" && data.step !== "complete") {
            text += " " + data.message;
        }
        return text;
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
        let pw = new Zotero.ProgressWindow({ closeOnClick: true });
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
        let pw = new Zotero.ProgressWindow({ closeOnClick: true });
        pw.changeHeadline("Paper Reader - " + title.substring(0, 25));
        pw.show();
        let stepItem = new pw.ItemProgress("chrome://zotero/skin/spinner-16px.png", "Connecting...");

        try {
            let url = this.config.paperReaderUrl + "/analyze/zotero";
            let requestBody = {
                zotero_key: item.key,
                options: {
                    language: "fr",
                    attach_to_zotero: true
                }
            };

            this.log("Sending to Paper Reader: " + JSON.stringify(requestBody));

            let response = await Zotero.HTTP.request("POST", url, {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
                timeout: 60000
            });

            let result = JSON.parse(response.responseText);
            this.log("Paper Reader response: " + JSON.stringify(result));

            if (result.status === "completed") {
                pw.close();
                this.showNotification("Analysis Complete!", title.substring(0, 40));
            } else if (result.status === "failed") {
                pw.close();
                this.showNotification("Analysis Failed", result.error || "Unknown error");
            } else {
                // Status is pending/ingesting/extracting/etc - poll for completion
                stepItem.setText(this.getAnalysisStatusText(result.status));
                await this.pollAnalysis(result.id, pw, stepItem, title);
            }
        } catch (e) {
            pw.close();
            this.log("Paper Reader error: " + e);
            this.showNotification("Error", e.message || "Connection failed");
        }
    },

    getAnalysisStatusText(status) {
        let labels = {
            "pending": "En attente...",
            "ingesting": "Ingestion du PDF...",
            "extracting": "Extraction LLM...",
            "validating": "Validation multi-LLM...",
            "synthesizing": "Synthèse en cours...",
            "completed": "Terminé!",
            "failed": "Échec"
        };
        return labels[status] || status;
    },

    async pollAnalysis(ficheId, pw, stepItem, title) {
        let url = this.config.paperReaderUrl + "/fiches/" + ficheId;
        for (let i = 0; i < 120; i++) {  // 10 minutes max (120 * 5s)
            await Zotero.Promise.delay(5000);
            try {
                let response = await Zotero.HTTP.request("GET", url, { timeout: 10000 });
                let result = JSON.parse(response.responseText);

                this.log("Poll #" + (i+1) + ": status=" + result.status);
                stepItem.setText(this.getAnalysisStatusText(result.status));

                if (result.status === "completed") {
                    pw.close();
                    this.showNotification("Analysis Complete!",
                        title.substring(0, 40) + "\n\nFiche de lecture créée et attachée à Zotero.");
                    // Trigger sync to pull the attachment
                    try { Zotero.Sync.Runner.sync(); } catch (e) {}
                    return;
                } else if (result.status === "failed") {
                    pw.close();
                    this.showNotification("Analysis Failed", result.error || "Processing failed");
                    return;
                }
            } catch (e) {
                this.log("Poll error: " + e);
            }
        }
        pw.close();
        this.showNotification("Timeout", "Analysis taking too long.\nCheck Paper Reader dashboard.");
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
        let results = [];

        // Test zotero-manager
        try {
            let response = await Zotero.HTTP.request("GET", this.config.apiUrl + "/health", { timeout: 5000 });
            let data = JSON.parse(response.responseText);
            if (data.status === "healthy") {
                results.push("✓ Zotero Manager: " + data.version);
            } else {
                results.push("⚠ Zotero Manager: " + data.status);
            }
        } catch (e) {
            results.push("✗ Zotero Manager: " + (e.message || "Connection failed"));
        }

        // Test paper-reader
        try {
            let response = await Zotero.HTTP.request("GET", this.config.paperReaderUrl + "/health", { timeout: 5000 });
            let data = JSON.parse(response.responseText);
            if (data.status === "healthy") {
                results.push("✓ Paper Reader: " + data.version);
            } else {
                results.push("⚠ Paper Reader: " + data.status);
            }
        } catch (e) {
            results.push("✗ Paper Reader: " + (e.message || "Connection failed"));
        }

        this.showNotification("Connection Test", results.join("\n"));
    },

    showLogs() {
        let logs = this.logBuffer.join("\n") || "(no logs)";
        Services.prompt.alert(null, "PDF Companion Logs", logs);
    },

    copyItemId() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "No item selected");
            return;
        }

        let item = items[0];
        let key = item.key;
        let title = item.getField("title") || "Unknown";

        // Copy to clipboard
        let clipboardHelper = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
            .getService(Components.interfaces.nsIClipboardHelper);
        clipboardHelper.copyString(key);

        // Show notification with ID
        let msg = "ID: " + key + "\n\nCopied to clipboard!";
        if (items.length > 1) {
            msg += "\n\n(" + items.length + " items selected, showing first)";
        }
        this.showNotification(title.substring(0, 30), msg);
    },

    async showFormattedNotes() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "No item selected");
            return;
        }

        let item = items[0];
        let title = item.getField("title") || "Unknown";
        let authors = item.getCreators().map(c => c.firstName + " " + c.lastName).join(", ") || "Unknown";
        let year = item.getField("year") || "";
        let doi = item.getField("DOI") || "";

        // Get all notes attached to this item
        let noteIDs = item.getNotes();
        let notesContent = [];

        for (let noteID of noteIDs) {
            let noteItem = await Zotero.Items.getAsync(noteID);
            if (noteItem) {
                let noteHtml = noteItem.getNote();
                notesContent.push(noteHtml);
            }
        }

        // Build HTML page
        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${this.escapeHtml(title)}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            max-width: 900px;
            margin: 0 auto;
            padding: 30px;
            background: #f8f9fa;
            color: #333;
            line-height: 1.6;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px 30px;
            border-radius: 12px;
            margin-bottom: 25px;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
        }
        .header h1 {
            margin: 0 0 10px 0;
            font-size: 1.5em;
            font-weight: 600;
        }
        .meta {
            font-size: 0.9em;
            opacity: 0.9;
        }
        .meta span { margin-right: 20px; }
        .item-id {
            background: rgba(255,255,255,0.2);
            padding: 3px 10px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 0.85em;
        }
        .note {
            background: white;
            padding: 25px 30px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            border-left: 4px solid #667eea;
        }
        .note h1, .note h2, .note h3 {
            color: #444;
            margin-top: 0;
        }
        .note h1 { font-size: 1.4em; border-bottom: 2px solid #eee; padding-bottom: 10px; }
        .note h2 { font-size: 1.2em; color: #555; }
        .note h3 { font-size: 1.1em; color: #666; }
        .note p { margin: 12px 0; }
        .note ul, .note ol { padding-left: 25px; }
        .note li { margin: 6px 0; }
        .note blockquote {
            border-left: 3px solid #667eea;
            margin: 15px 0;
            padding: 10px 20px;
            background: #f5f5ff;
            font-style: italic;
        }
        .note code {
            background: #f1f1f1;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: "SF Mono", Monaco, monospace;
            font-size: 0.9em;
        }
        .note pre {
            background: #2d2d2d;
            color: #f8f8f2;
            padding: 15px;
            border-radius: 6px;
            overflow-x: auto;
        }
        .note pre code {
            background: none;
            color: inherit;
        }
        .note table {
            border-collapse: collapse;
            width: 100%;
            margin: 15px 0;
        }
        .note th, .note td {
            border: 1px solid #ddd;
            padding: 10px;
            text-align: left;
        }
        .note th { background: #f5f5f5; }
        .no-notes {
            text-align: center;
            padding: 50px;
            color: #888;
            font-style: italic;
        }
        .note-divider {
            border: none;
            height: 1px;
            background: linear-gradient(to right, transparent, #ddd, transparent);
            margin: 30px 0;
        }
        @media print {
            body { background: white; }
            .header { box-shadow: none; }
            .note { box-shadow: none; border: 1px solid #ddd; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${this.escapeHtml(title)}</h1>
        <div class="meta">
            <span><strong>Authors:</strong> ${this.escapeHtml(authors)}</span>
            ${year ? `<span><strong>Year:</strong> ${year}</span>` : ''}
            ${doi ? `<span><strong>DOI:</strong> ${doi}</span>` : ''}
            <span class="item-id">ID: ${item.key}</span>
        </div>
    </div>`;

        if (notesContent.length === 0) {
            html += `<div class="no-notes">No notes found for this item.</div>`;
        } else {
            for (let i = 0; i < notesContent.length; i++) {
                html += `<div class="note">${notesContent[i]}</div>`;
                if (i < notesContent.length - 1) {
                    html += `<hr class="note-divider">`;
                }
            }
        }

        html += `</body></html>`;

        try {
            // Open in a Zotero window
            let win = Services.ww.openWindow(
                null,
                "about:blank",
                "_blank",
                "chrome,centerscreen,resizable=yes,scrollbars=yes,width=950,height=700",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = title.substring(0, 50);
            }, { once: true });

            this.log("Opened notes window for: " + item.key);
        } catch (e) {
            this.log("showFormattedNotes error: " + e);
            this.showNotification("Error", "Could not display notes: " + e.message);
        }
    },

    escapeHtml(text) {
        if (!text) return "";
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
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
