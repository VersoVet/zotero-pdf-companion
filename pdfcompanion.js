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
            triggerDelay: 10000
        };
    },

    logBuffer: [],

    log(msg) {
        Zotero.debug("PDF Companion: " + msg);
        this.logBuffer.push(new Date().toISOString() + " - " + msg);
        if (this.logBuffer.length > 100) this.logBuffer.shift();
    },

    // === TOAST OVERLAY SYSTEM ===
    Toast: {
        _css: `
            #pdfcompanion-toast-container {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 99999;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: none;
                max-height: 80vh;
                overflow: hidden;
            }
            .pdfcompanion-toast {
                pointer-events: auto;
                background: rgba(30, 30, 30, 0.95);
                color: #eee;
                border-radius: 8px;
                padding: 12px 16px;
                width: 320px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                line-height: 1.4;
                cursor: pointer;
                opacity: 0;
                transform: translateX(30px);
                animation: pdfcompanion-toast-in 0.25s ease forwards;
            }
            .pdfcompanion-toast.closing {
                animation: pdfcompanion-toast-out 0.2s ease forwards;
            }
            .pdfcompanion-toast-headline {
                font-weight: 600;
                font-size: 13px;
                margin-bottom: 4px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .pdfcompanion-toast-msg {
                font-size: 12px;
                color: #bbb;
                word-wrap: break-word;
            }
            .pdfcompanion-toast-icon {
                flex-shrink: 0;
                width: 16px;
                height: 16px;
            }
            .pdfcompanion-toast-icon.spinner svg {
                animation: pdfcompanion-spin 1s linear infinite;
            }
            .pdfcompanion-toast-icon.success svg { color: #4caf50; }
            .pdfcompanion-toast-icon.error svg { color: #f44336; }
            @keyframes pdfcompanion-toast-in {
                to { opacity: 1; transform: translateX(0); }
            }
            @keyframes pdfcompanion-toast-out {
                to { opacity: 0; transform: translateX(30px); }
            }
            @keyframes pdfcompanion-spin {
                to { transform: rotate(360deg); }
            }
        `,

        _spinnerSvg: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="6" stroke-opacity="0.3"/><path d="M14 8a6 6 0 0 0-6-6" stroke-linecap="round"/></svg>',
        _tickSvg: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8.5l3.5 3.5 6.5-8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        _crossSvg: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"/></svg>',

        _getWindow() {
            return Zotero.getMainWindow() || null;
        },

        _getContainer(doc) {
            return doc.getElementById('pdfcompanion-toast-container') || null;
        },

        _createToastEl(doc, headline, message, iconHtml) {
            let container = this._getContainer(doc);
            if (!container) return null;

            let el = doc.createElement('div');
            el.className = 'pdfcompanion-toast';
            el.innerHTML =
                '<div class="pdfcompanion-toast-headline">' +
                    (iconHtml ? '<span class="pdfcompanion-toast-icon">' + iconHtml + '</span>' : '') +
                    '<span class="pdfcompanion-toast-headline-text">' + PdfCompanion.escapeHtml(headline) + '</span>' +
                '</div>' +
                '<div class="pdfcompanion-toast-msg">' + PdfCompanion.escapeHtml(message || '') + '</div>';

            el.addEventListener('click', () => this._closeEl(el));
            container.appendChild(el);
            return el;
        },

        _closeEl(el) {
            if (!el || !el.parentNode) return;
            el.classList.add('closing');
            setTimeout(() => {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 200);
        },

        inject(doc) {
            // Inject CSS into <head>
            let style = doc.createElement('style');
            style.id = 'pdfcompanion-toast-style';
            style.textContent = this._css;
            let head = doc.head || doc.documentElement;
            head.appendChild(style);

            // Inject container into <body> (fallback to documentElement for XUL)
            let container = doc.createElement('div');
            container.id = 'pdfcompanion-toast-container';
            let body = doc.body || doc.documentElement;
            body.appendChild(container);
        },

        remove(doc) {
            let style = doc.getElementById('pdfcompanion-toast-style');
            if (style) style.remove();
            let container = doc.getElementById('pdfcompanion-toast-container');
            if (container) container.remove();
        },

        notify(headline, message, duration) {
            let win = this._getWindow();
            if (!win) return;
            let doc = win.document;
            duration = duration || 5000;

            let el = this._createToastEl(doc, headline, message || '');
            if (!el) return;
            setTimeout(() => this._closeEl(el), duration);
        },

        progress(headline) {
            let win = this._getWindow();
            if (!win) return this._fallbackProgress(headline);
            let doc = win.document;
            let self = this;

            let el = this._createToastEl(doc, headline, '', this._spinnerSvg);
            if (!el) return this._fallbackProgress(headline);

            let iconSpan = el.querySelector('.pdfcompanion-toast-icon');
            if (iconSpan) iconSpan.classList.add('spinner');
            let headlineSpan = el.querySelector('.pdfcompanion-toast-headline-text');
            let msgDiv = el.querySelector('.pdfcompanion-toast-msg');

            let closed = false;
            return {
                update(text) {
                    if (closed) return;
                    if (msgDiv) msgDiv.textContent = text || '';
                },
                setHeadline(text) {
                    if (closed) return;
                    if (headlineSpan) headlineSpan.textContent = text || '';
                },
                success(text) {
                    if (closed) return;
                    closed = true;
                    if (iconSpan) {
                        iconSpan.classList.remove('spinner');
                        iconSpan.classList.add('success');
                        iconSpan.innerHTML = self._tickSvg;
                    }
                    if (msgDiv) msgDiv.textContent = text || '';
                    setTimeout(() => self._closeEl(el), 4000);
                },
                error(text) {
                    if (closed) return;
                    closed = true;
                    if (iconSpan) {
                        iconSpan.classList.remove('spinner');
                        iconSpan.classList.add('error');
                        iconSpan.innerHTML = self._crossSvg;
                    }
                    if (msgDiv) msgDiv.textContent = text || '';
                    setTimeout(() => self._closeEl(el), 5000);
                },
                close() {
                    if (closed) return;
                    closed = true;
                    self._closeEl(el);
                }
            };
        },

        // Fallback if no window available - returns no-op object
        _fallbackProgress(headline) {
            return {
                update() {},
                setHeadline() {},
                success() {},
                error() {},
                close() {}
            };
        }
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

        // === Toast Overlay ===
        this.Toast.inject(doc);

        // === Tools Menu ===
        let toolsPopup = doc.getElementById('menu_ToolsPopup');
        if (toolsPopup) {
            let submenu = doc.createXULElement('menu');
            submenu.id = 'pdfcompanion-tools-menu';
            submenu.setAttribute('label', 'PDF Companion');

            let menupopup = doc.createXULElement('menupopup');
            menupopup.id = 'pdfcompanion-tools-popup';

            // Sub-menu "Lire l'article" with reading modes
            let analyzeSubmenu = doc.createXULElement('menu');
            analyzeSubmenu.id = 'pdfcompanion-tools-analyze';
            analyzeSubmenu.setAttribute('label', 'Lire l\'article');
            let analyzePopup = doc.createXULElement('menupopup');
            analyzePopup.id = 'pdfcompanion-tools-analyze-popup';

            let readingModes = [
                { id: 'standard', label: 'Lecture standard', mode: 'standard' },
                { id: 'full', label: 'Lecture complète', mode: 'full' },
                { id: 'section', label: 'Lecture par section', mode: 'section' }
            ];
            for (let rm of readingModes) {
                let mi = doc.createXULElement('menuitem');
                mi.id = 'pdfcompanion-tools-analyze-' + rm.id;
                mi.setAttribute('label', rm.label);
                mi.addEventListener('command', () => this.summarizeForSelected(rm.mode));
                analyzePopup.appendChild(mi);
            }
            analyzeSubmenu.appendChild(analyzePopup);
            menupopup.appendChild(analyzeSubmenu);

            // Other menu items
            let items = [
                { id: 'fetch', label: 'Télécharger le PDF', action: () => this.fetchPdfForSelected() },
                { id: 'local', label: 'Joindre un PDF', action: () => this.attachLocalPdfForSelected() },
                { id: 'replace', label: 'Remplacer un PDF', action: () => this.replacePdfForSelected() },
                { id: 'enrich', label: 'Enrich metadata', action: () => this.enrichMetadataForSelected() },
                { id: 'showfiches', label: 'Afficher les lectures', action: () => this.showReadingCards() },
                { id: 'sep', separator: true },
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

            // Sub-menu "Lire l'article" with reading modes
            let ctxAnalyzeSubmenu = doc.createXULElement('menu');
            ctxAnalyzeSubmenu.id = 'pdfcompanion-context-analyze';
            ctxAnalyzeSubmenu.setAttribute('label', 'Lire l\'article');
            let ctxAnalyzePopup = doc.createXULElement('menupopup');
            ctxAnalyzePopup.id = 'pdfcompanion-context-analyze-popup';

            let ctxReadingModes = [
                { id: 'standard', label: 'Lecture standard', mode: 'standard' },
                { id: 'full', label: 'Lecture complète', mode: 'full' },
                { id: 'section', label: 'Lecture par section', mode: 'section' }
            ];
            for (let rm of ctxReadingModes) {
                let mi = doc.createXULElement('menuitem');
                mi.id = 'pdfcompanion-context-analyze-' + rm.id;
                mi.setAttribute('label', rm.label);
                mi.addEventListener('command', () => this.summarizeForSelected(rm.mode));
                ctxAnalyzePopup.appendChild(mi);
            }
            ctxAnalyzeSubmenu.appendChild(ctxAnalyzePopup);
            menupopup.appendChild(ctxAnalyzeSubmenu);

            // Other context menu items
            let items = [
                { id: 'fetch', label: 'Télécharger le PDF', action: () => this.fetchPdfForSelected() },
                { id: 'local', label: 'Joindre un PDF', action: () => this.attachLocalPdfForSelected() },
                { id: 'replace', label: 'Remplacer un PDF', action: () => this.replacePdfForSelected() },
                { id: 'enrich', label: 'Enrich metadata', action: () => this.enrichMetadataForSelected() },
                { id: 'showfiches', label: 'Afficher les lectures', action: () => this.showReadingCards() }
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

        // === Collection Context Menu ===
        let collectionMenu = doc.getElementById('zotero-collectionmenu');
        if (collectionMenu) {
            let submenu = doc.createXULElement('menu');
            submenu.id = 'pdfcompanion-collection-menu';
            submenu.setAttribute('label', 'PDF Companion');

            let menupopup = doc.createXULElement('menupopup');
            menupopup.id = 'pdfcompanion-collection-popup';

            let items = [
                { id: 'import-pdfs', label: 'Importer des PDFs', action: () => this.importPdfsToCollection() },
                { id: 'maintain-collection', label: 'Maintenance collection', action: () => this.analyzeCollection() },
                { id: 'synthesize-collection', label: 'Synthèse de la collection', action: () => this.synthesizeCollection() },
                { id: 'read-syntheses', label: 'Lire les synthèses', action: () => this.showCollectionSyntheses() }
            ];

            for (let item of items) {
                let menuitem = doc.createXULElement('menuitem');
                menuitem.id = 'pdfcompanion-collection-' + item.id;
                menuitem.setAttribute('label', item.label);
                menuitem.addEventListener('command', item.action);
                menupopup.appendChild(menuitem);
            }

            submenu.appendChild(menupopup);
            collectionMenu.appendChild(submenu);
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
        this.Toast.remove(doc);
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

    async itemHasPdfAttachment(item) {
        let attachmentIDs = item.getAttachments();
        for (let id of attachmentIDs) {
            let att = await Zotero.Items.getAsync(id);
            if (att && att.attachmentContentType === "application/pdf") return true;
        }
        return false;
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
                let title = item.getField("title") || "Unknown";
                let hasPdf = await this.itemHasPdfAttachment(item);

                // Always enrich first (may find and attach a PDF)
                this.log("Enriching: " + title + (hasPdf ? " (PDF present)" : " (no PDF)"));
                await this.enrichMetadata(item);

                // If no PDF before enrich, re-check after - enrich may have attached one
                if (!hasPdf) {
                    let hasPdfNow = await this.itemHasPdfAttachment(item);
                    if (hasPdfNow) {
                        this.log("PDF attached by enrich for: " + title + " → skip recovery");
                    } else {
                        this.log("Still no PDF for: " + title + " → recovering");
                        await this.recoverPdf(item);
                    }
                }
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

        let toast = this.Toast.progress("PDF Companion - " + title.substring(0, 30));
        toast.update("Connecting...");

        try {
            let url = this.config.apiUrl + "/audit/recover-pdf-stream?" +
                "key=" + encodeURIComponent(item.key) +
                "&use_scihub=" + (this.config.useScihub ? "true" : "false");

            let self = this;
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
                                toast.update(self.getStepText(data));
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

            toast.close();

            if (!finalResult) {
                this.showNotification("Error", "No response from server");
                return;
            }

            if (finalResult.status === "success") {
                this.showNotification("PDF Found!", this.getSourceLabel(finalResult.source) + " - " + title.substring(0, 40));
                try { Zotero.Sync.Runner.sync(); } catch (e) {}
            } else {
                this.showNotification("PDF Not Found", title.substring(0, 40) + " - " + (finalResult.message || "Not available"));
            }

        } catch (e) {
            toast.close();
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
                // Sync to pull the new attachment into Zotero
                try { Zotero.Sync.Runner.sync(); } catch (e) {}
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

        let toast = this.Toast.progress("Replace PDF - " + title.substring(0, 30));
        toast.update("Reading file...");

        try {
            let file = Zotero.File.pathToFile(filePath);
            if (!file.exists()) {
                toast.error("File not found");
                return;
            }

            let filename = file.leafName;
            if (!filename.toLowerCase().endsWith('.pdf')) {
                filename += '.pdf';
            }

            this.log("Reading file: " + filename);
            toast.update("Reading: " + filename);
            let fileData = await Zotero.File.getBinaryContentsAsync(file);
            this.log("File read: " + fileData.length + " bytes");

            if (fileData.length < 1000) {
                toast.error("Invalid PDF (too small)");
                return;
            }

            toast.update("Uploading " + Math.round(fileData.length / 1024) + " KB...");

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
                                toast.update(self.getReplaceStepText(data));
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
                toast.error("No response from server");
                return;
            }

            if (finalResult.status === "success") {
                let msg = finalResult.filename || filename;
                if (finalResult.deleted_count > 0) {
                    msg += " (" + finalResult.deleted_count + " old removed)";
                }
                toast.success("Done: " + msg);
                try { Zotero.Sync.Runner.sync(); } catch (e) {}
            } else {
                toast.error("Failed: " + (finalResult.message || "Unknown error"));
            }
        } catch (e) {
            this.log("Replace PDF error: " + e);
            toast.error("Error: " + (e.message || "Upload failed"));
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
        if (items.length === 0) {
            this.showNotification("PDF Companion", "No valid items selected");
            return;
        }

        // Single item: existing behavior
        if (items.length === 1) {
            await this.enrichMetadata(items[0]);
            return;
        }

        // Batch: single toast
        let total = items.length;
        let toast = this.Toast.progress("Enrichissement - 0/" + total);
        toast.update("Démarrage...");

        let enriched = 0;
        let failed = 0;

        for (let i = 0; i < items.length; i++) {
            let item = items[i];
            let title = item.getField("title") || "Unknown";
            toast.setHeadline("Enrichissement - " + (i + 1) + "/" + total);
            toast.update(title.substring(0, 50));

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
                        for (let line of newData.split("\n")) {
                            if (line.startsWith("data: ")) {
                                try {
                                    let data = JSON.parse(line.substring(6));
                                    toast.update((i + 1) + "/" + total + " - " + (data.message || data.step));
                                    if (data.step === "complete" || data.step === "error") result = data;
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

                if (finalResult && finalResult.status === "success") {
                    enriched++;
                    await item.reload();
                } else {
                    failed++;
                }
            } catch (e) {
                failed++;
                this.log("Batch enrich error: " + e);
            }
        }

        toast.close();
        this.showNotification("Enrichissement terminé",
            enriched + " enrichis, " + failed + " échecs sur " + total);
    },

    async enrichMetadata(item) {
        let title = item.getField("title") || "Unknown";
        let toast = this.Toast.progress("Enriching - " + title.substring(0, 30));
        toast.update("Connecting...");

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
                                toast.update(data.message || data.step);
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

            toast.close();

            if (finalResult && finalResult.status === "success") {
                let fields = finalResult.fields_updated || [];
                this.showNotification("Metadata Enriched!", fields.length > 0 ? "Updated: " + fields.join(", ") : "No new data");
                await item.reload();
            } else {
                this.showNotification("Enrichment Failed", finalResult?.message || "Unknown error");
            }
        } catch (e) {
            toast.close();
            this.showNotification("Error", e.message || "Connection failed");
        }
    },

    // === PAPER READER ===
    async summarizeForSelected(mode) {
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
        await this.summarizePaper(items[0], mode || "standard");
    },

    async summarizePaper(item, mode) {
        let title = item.getField("title") || "Unknown";
        let modeLabels = { "standard": "Standard", "full": "Complète", "section": "Par section" };
        let modeLabel = modeLabels[mode] || mode;

        let toast = this.Toast.progress("Lecture " + modeLabel + " - " + title.substring(0, 20));
        toast.update("Connexion...");

        try {
            let url = this.config.paperReaderUrl + "/analyze/zotero-stream?" +
                "zotero_key=" + encodeURIComponent(item.key) +
                "&lecture_mode=" + encodeURIComponent(mode);

            this.log("SSE Paper Reader: " + url + " (mode=" + mode + ")");

            let self = this;
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
                                self.log("SSE analyze: " + JSON.stringify(data));
                                toast.update(self.getAnalyzeStepText(data));
                                if (data.done === true || data.step === "termine") {
                                    result = { status: "success", data: data };
                                } else if (data.step === "error" || data.step === "erreur") {
                                    result = { status: "error", message: data.message || "Erreur inconnue" };
                                }
                            } catch (e) {}
                        }
                    }
                };

                xhr.onload = () => resolve(result);
                xhr.onerror = () => reject(new Error("Connexion échouée"));
                xhr.ontimeout = () => reject(new Error("Timeout"));
                xhr.timeout = 600000; // 10 minutes
                xhr.send();
            });

            toast.close();

            if (!finalResult) {
                this.showNotification("Erreur", "Pas de réponse du serveur");
                return;
            }

            if (finalResult.status === "success") {
                this.showNotification("Lecture terminée!",
                    title.substring(0, 40) + " - Fiche de lecture créée et attachée.");
                try { Zotero.Sync.Runner.sync(); } catch (e) {}
            } else {
                this.showNotification("Échec de la lecture", finalResult.message || "Erreur inconnue");
            }
        } catch (e) {
            toast.close();
            this.log("Paper Reader SSE error: " + e);
            this.showNotification("Erreur", e.message || "Connexion échouée");
        }
    },

    getAnalyzeStepText(data) {
        let labels = {
            "zotero": "Récupération depuis Zotero...",
            "analyse": "Analyse du PDF...",
            "extraction": "Extraction du contenu...",
            "llm": "Traitement LLM...",
            "section": "Analyse par section...",
            "synthese": "Synthèse en cours...",
            "generation": "Génération de la fiche...",
            "sauvegarde": "Sauvegarde...",
            "termine": "Terminé!"
        };
        let text = labels[data.step] || data.message || data.step || "Traitement...";
        if (data.message && data.step !== "termine" && !labels[data.step]) {
            text = data.message;
        }
        return text;
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
            this.Toast.notify(headline, msg, 5000);
        } catch (e) {}
    },

    // === COLLECTION METHODS ===
    getSelectedCollection() {
        let zp = Zotero.getActiveZoteroPane();
        let row = zp.collectionsView.selection.focused;
        if (row === undefined || row < 0) return null;

        let treeRow = zp.collectionsView.getRow(row);
        if (!treeRow || !treeRow.ref || !treeRow.ref.key) return null;

        return {
            key: treeRow.ref.key,
            name: treeRow.ref.name,
            libraryID: treeRow.ref.libraryID
        };
    },

    async analyzeCollection() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Veuillez sélectionner une collection");
            return;
        }

        this.log("Analyzing collection: " + collection.name + " (key: " + collection.key + ")");

        let toast = this.Toast.progress("Maintenance - " + collection.name.substring(0, 25));
        toast.update("Connexion...");

        try {
            let url = this.config.apiUrl + "/maintenance/collection/" +
                encodeURIComponent(collection.key) + "/stream?limit=100";

            let self = this;
            let finalResult = await new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                let lastIndex = 0;
                let result = null;
                let currentItem = 0;
                let totalItems = 0;

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
                                self.log("SSE: " + JSON.stringify(data));

                                switch (data.event) {
                                    case "populating_queue":
                                        toast.update("Récupération des articles...");
                                        break;
                                    case "queue_populated":
                                        totalItems = data.result?.queued || 0;
                                        toast.update(totalItems + " articles à traiter");
                                        break;
                                    case "processing_item":
                                        currentItem++;
                                        let title = (data.title || "").substring(0, 35);
                                        toast.update(currentItem + "/" + totalItems + " - " + title);
                                        break;
                                    case "item_completed":
                                        toast.update(currentItem + "/" + totalItems + " done");
                                        break;
                                    case "item_failed":
                                        toast.update(currentItem + "/" + totalItems + " failed: " + (data.error || "").substring(0, 30));
                                        break;
                                    case "batch_completed":
                                        result = data;
                                        break;
                                    case "error":
                                        result = { event: "error", message: data.message };
                                        break;
                                }
                            } catch (e) {}
                        }
                    }
                };

                xhr.onload = () => resolve(result);
                xhr.onerror = () => reject(new Error("Connexion échouée"));
                xhr.ontimeout = () => reject(new Error("Timeout"));
                xhr.timeout = 1800000;
                xhr.send();
            });

            if (!finalResult) {
                toast.error("Pas de réponse du serveur");
                return;
            }

            if (finalResult.event === "batch_completed") {
                let stats = finalResult.stats || {};
                let msg = "Terminé: " + (stats.completed || 0) + " traités";
                if (stats.failed > 0) msg += ", " + stats.failed + " échec(s)";
                toast.success(msg);
                try { Zotero.Sync.Runner.sync(); } catch (e) {}
            } else {
                toast.error("Erreur: " + (finalResult.message || "Inconnue"));
            }

        } catch (e) {
            this.log("Collection maintenance error: " + e);
            toast.error("Erreur: " + (e.message || "Connexion échouée"));
        }
    },

    // === IMPORT PDFs TO COLLECTION ===
    async pickMultiplePdfFiles() {
        const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
        let fp = new FilePicker();
        fp.init(Zotero.getMainWindow(), "Sélectionner des PDFs à importer", fp.modeOpenMultiple);
        fp.appendFilter("PDF Files", "*.pdf");
        let result = await fp.show();
        if (result !== fp.returnOK) return null;
        return fp.files;
    },

    async ingestPdfFile(filePath) {
        let file = Zotero.File.pathToFile(filePath);
        if (!file.exists()) {
            throw new Error("Fichier introuvable: " + filePath);
        }

        let fileData = await Zotero.File.getBinaryContentsAsync(file);
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

        let url = this.config.apiUrl + "/ingest/pdf";
        this.log("POST " + url + " (" + file.leafName + ", " + fileBytes.length + " bytes)");

        let response = await Zotero.HTTP.request("POST", url, {
            headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },
            body: bodyArray,
            responseType: "json",
            timeout: 180000
        });

        return response.response;
    },

    async addItemToCollection(itemKey, collectionKey) {
        let url = this.config.apiUrl + "/collections/" +
            encodeURIComponent(collectionKey) + "/items/" +
            encodeURIComponent(itemKey);
        this.log("POST " + url);
        let response = await Zotero.HTTP.request("POST", url, { timeout: 15000 });
        return JSON.parse(response.responseText);
    },

    async importPdfsToCollection() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Veuillez sélectionner une collection");
            return;
        }

        let files = await this.pickMultiplePdfFiles();
        if (!files) return;

        // Collect file paths from the iterator
        let filePaths = [];
        for (let f of files) {
            filePaths.push(f);
        }
        if (filePaths.length === 0) return;

        this.log("Importing " + filePaths.length + " PDFs into collection: " + collection.name);

        let toast = this.Toast.progress("Import PDFs - " + collection.name.substring(0, 25));

        let imported = 0;
        let failed = 0;

        for (let i = 0; i < filePaths.length; i++) {
            let filePath = filePaths[i];
            let file = Zotero.File.pathToFile(filePath);
            let filename = file.leafName;

            toast.update((i + 1) + "/" + filePaths.length + " - " + filename + " - Ingestion...");

            try {
                let result = await this.ingestPdfFile(filePath);

                if (result && result.success && result.item_key) {
                    toast.update((i + 1) + "/" + filePaths.length + " - " + filename + " - Ajout collection...");

                    try {
                        await this.addItemToCollection(result.item_key, collection.key);
                    } catch (e) {
                        this.log("addItemToCollection warning: " + e);
                    }

                    imported++;
                } else {
                    let errMsg = (result && result.error) ? result.error : "Échec ingestion";
                    toast.update((i + 1) + "/" + filePaths.length + " - " + filename + " - " + errMsg);
                    failed++;
                }
            } catch (e) {
                this.log("Import PDF error: " + e);
                failed++;
            }
        }

        let summaryMsg = imported + " importé(s), " + failed + " échec(s)";
        if (failed > 0) {
            toast.error("Terminé: " + summaryMsg);
        } else {
            toast.success("Terminé: " + summaryMsg);
        }

        if (imported > 0) {
            try { Zotero.Sync.Runner.sync(); } catch (e) {}
        }
    },

    // === MARKDOWN UTILITIES ===
    mdToHtml(md) {
        return md
            // Headers
            .replace(/^### (.*)$/gm, '<h3>$1</h3>')
            .replace(/^## (.*)$/gm, '<h2>$1</h2>')
            .replace(/^# (.*)$/gm, '<h1>$1</h1>')
            // Bold/Italic
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            // Blockquotes
            .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>')
            // Lists
            .replace(/^- (.*)$/gm, '<li>$1</li>')
            // Links [text](url)
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
            // Paragraphs (double newlines)
            .replace(/\n\n/g, '</p><p>')
            // Single newlines in content
            .replace(/\n/g, '<br>')
            // Wrap lists
            .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
            // Fix consecutive blockquotes
            .replace(/<\/blockquote><br><blockquote>/g, '</blockquote><blockquote>');
    },

    displayMarkdown(title, subtitle, markdownContent) {
        let bodyHtml = this.mdToHtml(markdownContent);

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${this.escapeHtml(title)}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            max-width: 950px;
            margin: 0 auto;
            padding: 30px;
            background: #f5f7f5;
            color: #333;
            line-height: 1.7;
        }
        .header {
            background: linear-gradient(135deg, #2d5a27 0%, #4a7c43 100%);
            color: white;
            padding: 25px 30px;
            border-radius: 12px;
            margin-bottom: 25px;
        }
        .header h1 { margin: 0 0 10px 0; font-size: 1.4em; }
        .header .subtitle { font-size: 0.9em; opacity: 0.9; }
        .content {
            background: white;
            border-radius: 10px;
            padding: 30px 35px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
        }
        .content h1 { font-size: 1.4em; color: #2d5a27; border-bottom: 2px solid #e5e5e5; padding-bottom: 10px; margin-top: 0; }
        .content h2 { font-size: 1.2em; color: #3d6a37; margin-top: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 5px; }
        .content h3 { font-size: 1.05em; color: #555; margin-top: 1.2em; }
        .content p { margin: 12px 0; }
        .content blockquote {
            border-left: 4px solid #4a7c43;
            margin: 15px 0;
            padding: 12px 20px;
            background: #f8faf8;
            font-style: italic;
            color: #555;
        }
        .content ul { padding-left: 25px; margin: 10px 0; }
        .content li { margin: 6px 0; }
        .content a { color: #2d5a27; text-decoration: none; }
        .content a:hover { text-decoration: underline; }
        .content strong { color: #2d5a27; }
        hr { border: none; height: 1px; background: #ddd; margin: 30px 0; }
        @media print {
            body { background: white; }
            .content { box-shadow: none; border: 1px solid #ddd; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${this.escapeHtml(title)}</h1>
        <div class="subtitle">${this.escapeHtml(subtitle)}</div>
    </div>
    <div class="content">
        <p>${bodyHtml}</p>
    </div>
</body>
</html>`;

        let win = Services.ww.openWindow(
            null, "about:blank", "_blank",
            "chrome,centerscreen,resizable=yes,scrollbars=yes,width=1000,height=800",
            null
        );

        win.addEventListener("load", () => {
            win.document.open();
            win.document.write(html);
            win.document.close();
            win.document.title = title.substring(0, 50);
        }, { once: true });

        this.log("displayMarkdown: " + title);
    },

    // === READING CARDS (FICHES DE LECTURE) ===
    async showReadingCards() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "Aucun item sélectionné");
            return;
        }

        let item = items[0];
        if (item.isAttachment() || item.isNote()) {
            this.showNotification("PDF Companion", "Sélectionnez un article, pas un attachement");
            return;
        }

        let title = item.getField("title") || "Unknown";
        let authors = item.getCreators().map(c => (c.firstName || "") + " " + (c.lastName || c.name || "")).join(", ");
        let year = item.getField("year") || "";
        let subtitle = (authors ? authors : "") + (year ? " | " + year : "");

        let toast = this.Toast.progress("Lectures - " + title.substring(0, 25));
        toast.update("Recherche des fiches...");

        try {
            // 1. Get children
            let url = this.config.apiUrl + "/item/" + item.key + "/children";
            let response = await Zotero.HTTP.request("GET", url, { timeout: 15000 });
            let children = JSON.parse(response.responseText);

            // 2. Filter by title containing "fiche de lecture"
            let fiches = children.children.filter(c => {
                let t = (c.data.title || "").toLowerCase();
                return t.includes("fiche de lecture");
            });

            if (fiches.length === 0) {
                toast.error("Aucune fiche trouvée - Utilisez 'Lire l'article' pour en créer une.");
                return;
            }

            // 3. Download all MDs to get first line as description
            toast.update("Téléchargement de " + fiches.length + " fiche(s)...");
            let ficheData = [];
            for (let fiche of fiches) {
                try {
                    let dropboxUrl = fiche.data.url.replace("dl=0", "dl=1");
                    if (!dropboxUrl.includes("dl=1")) {
                        dropboxUrl += (dropboxUrl.includes("?") ? "&" : "?") + "dl=1";
                    }
                    let contentResponse = await Zotero.HTTP.request("GET", dropboxUrl, {
                        timeout: 15000, responseType: "text"
                    });
                    let md = contentResponse.responseText;
                    let firstLine = md.split("\n").find(l => l.trim().length > 0) || "Fiche";
                    firstLine = firstLine.replace(/^#+\s*/, "");
                    let dateStr = fiche.data.dateAdded ? new Date(fiche.data.dateAdded).toLocaleDateString('fr-FR') : '';
                    ficheData.push({ description: firstLine, date: dateStr, markdown: md });
                } catch (e) {
                    this.log("Failed to download fiche: " + e);
                }
            }

            toast.close();

            if (ficheData.length === 0) {
                this.showNotification("Erreur", "Impossible de télécharger les fiches");
                return;
            }

            // 4. If single fiche, display directly
            if (ficheData.length === 1) {
                this.displayMarkdown(title, subtitle, ficheData[0].markdown);
                return;
            }

            // 5. Multiple fiches: show selection list window
            let self = this;
            let entriesHtml = ficheData.map((f, idx) => {
                return '<div class="entry" data-index="' + idx + '">' +
                    '<span class="entry-title">' + this.escapeHtml(f.description.substring(0, 80)) + '</span>' +
                    '<span class="entry-date">' + this.escapeHtml(f.date) + '</span>' +
                    '</div>';
            }).join('');

            let listHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
                '<title>Fiches de lecture</title>' +
                '<style>' +
                '* { box-sizing: border-box; }' +
                'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f7f5; color: #333; }' +
                'h2 { color: #2d5a27; margin: 0 0 15px 0; font-size: 1.2em; }' +
                '.entry { background: white; padding: 14px 18px; margin-bottom: 8px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 4px rgba(0,0,0,0.06); border-left: 3px solid #4a7c43; }' +
                '.entry:hover { background: #eef4ee; }' +
                '.entry-title { font-weight: 500; flex: 1; }' +
                '.entry-date { color: #888; font-size: 0.85em; margin-left: 12px; white-space: nowrap; }' +
                '</style></head><body>' +
                '<h2>' + this.escapeHtml(title.substring(0, 60)) + '</h2>' +
                entriesHtml +
                '</body></html>';

            let win = Services.ww.openWindow(
                null, "about:blank", "_blank",
                "chrome,centerscreen,resizable=yes,scrollbars=yes,width=650,height=400",
                null
            );

            win.addEventListener("load", function onLoad() {
                win.removeEventListener("load", onLoad);
                win.document.open();
                win.document.write(listHtml);
                win.document.close();
                win.document.title = "Fiches de lecture";

                // Bind click handlers
                let divs = win.document.querySelectorAll('.entry');
                for (let i = 0; i < divs.length; i++) {
                    divs[i].addEventListener('click', function() {
                        let idx = parseInt(this.getAttribute('data-index'));
                        let md = ficheData[idx].markdown;
                        win.close();
                        self.displayMarkdown(title, subtitle, md);
                    });
                }
            }, { once: true });

        } catch (e) {
            this.log("showReadingCards error: " + e);
            toast.error("Erreur: " + (e.message || "Connexion échouée"));
        }
    },

    // === COLLECTION SYNTHESES ===
    async showCollectionSyntheses() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Sélectionnez une collection");
            return;
        }

        let toast = this.Toast.progress("Synthèses - " + collection.name.substring(0, 25));
        toast.update("Recherche des synthèses...");

        try {
            // 1. List collection items, filter reports with "Synthèse" in title
            let url = this.config.apiUrl + "/collections/" + encodeURIComponent(collection.key) + "/items";
            let response = await Zotero.HTTP.request("GET", url, { timeout: 15000 });
            let data = JSON.parse(response.responseText);
            let items = data.items || [];

            let synthItems = items.filter(it => {
                return (it.title || "").toLowerCase().includes("synthèse") ||
                       (it.title || "").toLowerCase().includes("synthese");
            });

            if (synthItems.length === 0) {
                toast.error("Aucune synthèse trouvée - Utilisez 'Synthèse de la collection' pour en créer une.");
                return;
            }

            // 2. For each synthesis, get children to find MD attachment + first line
            toast.update("Chargement de " + synthItems.length + " synthèse(s)...");
            let synthData = [];

            for (let si of synthItems) {
                try {
                    let childUrl = this.config.apiUrl + "/item/" + encodeURIComponent(si.key) + "/children";
                    let childResp = await Zotero.HTTP.request("GET", childUrl, { timeout: 15000 });
                    let childData = JSON.parse(childResp.responseText);
                    let mdChild = (childData.children || []).find(c =>
                        c.data && c.data.contentType === "text/markdown"
                    );

                    if (!mdChild) continue;

                    let dropboxUrl = mdChild.data.url.replace("dl=0", "dl=1");
                    if (!dropboxUrl.includes("dl=1")) {
                        dropboxUrl += (dropboxUrl.includes("?") ? "&" : "?") + "dl=1";
                    }

                    let mdResp = await Zotero.HTTP.request("GET", dropboxUrl, {
                        timeout: 15000, responseType: "text"
                    });
                    let md = mdResp.responseText;
                    let firstLine = md.split("\n").find(l => l.trim().length > 0) || "Synthèse";
                    firstLine = firstLine.replace(/^#+\s*/, "");

                    let dateStr = mdChild.data.dateAdded
                        ? new Date(mdChild.data.dateAdded).toLocaleDateString('fr-FR') : '';

                    synthData.push({
                        title: si.title,
                        description: firstLine,
                        date: dateStr,
                        markdown: md
                    });
                } catch (e) {
                    this.log("Failed to load synthesis " + si.key + ": " + e);
                }
            }

            toast.close();

            if (synthData.length === 0) {
                this.showNotification("Erreur", "Impossible de charger les synthèses");
                return;
            }

            // 3. Single: display directly
            if (synthData.length === 1) {
                this.displayMarkdown(synthData[0].title, synthData[0].description, synthData[0].markdown);
                return;
            }

            // 4. Multiple: selection window
            let self = this;
            let entriesHtml = synthData.map((s, idx) => {
                return '<div class="entry" data-index="' + idx + '">' +
                    '<span class="entry-title">' + this.escapeHtml(s.description.substring(0, 80)) + '</span>' +
                    '<span class="entry-date">' + this.escapeHtml(s.date) + '</span>' +
                    '</div>';
            }).join('');

            let listHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
                '<title>Synthèses</title><style>' +
                '* { box-sizing: border-box; }' +
                'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f7f5; color: #333; }' +
                'h2 { color: #2d5a27; margin: 0 0 15px 0; font-size: 1.2em; }' +
                '.entry { background: white; padding: 14px 18px; margin-bottom: 8px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 4px rgba(0,0,0,0.06); border-left: 3px solid #4a7c43; }' +
                '.entry:hover { background: #eef4ee; }' +
                '.entry-title { font-weight: 500; flex: 1; }' +
                '.entry-date { color: #888; font-size: 0.85em; margin-left: 12px; white-space: nowrap; }' +
                '</style></head><body>' +
                '<h2>Synthèses - ' + this.escapeHtml(collection.name.substring(0, 40)) + '</h2>' +
                entriesHtml + '</body></html>';

            let win = Services.ww.openWindow(
                null, "about:blank", "_blank",
                "chrome,centerscreen,resizable=yes,scrollbars=yes,width=650,height=400",
                null
            );

            win.addEventListener("load", function onLoad() {
                win.removeEventListener("load", onLoad);
                win.document.open();
                win.document.write(listHtml);
                win.document.close();
                win.document.title = "Synthèses";

                let divs = win.document.querySelectorAll('.entry');
                for (let i = 0; i < divs.length; i++) {
                    divs[i].addEventListener('click', function() {
                        let idx = parseInt(this.getAttribute('data-index'));
                        let s = synthData[idx];
                        win.close();
                        self.displayMarkdown(s.title, s.description, s.markdown);
                    });
                }
            }, { once: true });

        } catch (e) {
            this.log("showCollectionSyntheses error: " + e);
            toast.error("Erreur: " + (e.message || "Connexion échouée"));
        }
    },

    // === SYNTHESIZE COLLECTION ===
    async synthesizeCollection() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Sélectionnez une collection");
            return;
        }

        let self = this;

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Synthèse - ${this.escapeHtml(collection.name)}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0; padding: 20px;
            background: #f5f7f5; color: #333;
        }
        h2 { color: #2d5a27; margin: 0 0 15px 0; font-size: 1.2em; }
        .form-group { margin-bottom: 12px; }
        label { display: block; font-weight: 500; margin-bottom: 4px; font-size: 0.9em; color: #555; }
        input[type="text"] {
            width: 100%; padding: 10px 12px; border: 1px solid #ccc;
            border-radius: 6px; font-size: 0.95em;
        }
        input[type="text"]:focus { outline: none; border-color: #4a7c43; }
        select {
            width: 100%; padding: 10px 12px; border: 1px solid #ccc;
            border-radius: 6px; font-size: 0.95em; background: white;
        }
        #btn-launch {
            background: linear-gradient(135deg, #2d5a27, #4a7c43);
            color: white; border: none; padding: 12px 24px;
            border-radius: 8px; font-size: 1em; cursor: pointer;
            width: 100%; margin-top: 8px; font-weight: 500;
        }
        #btn-launch:hover { opacity: 0.9; }
        #btn-launch:disabled { opacity: 0.5; cursor: not-allowed; }
        #sse-log {
            margin-top: 15px; background: #1e1e1e; color: #d4d4d4;
            border-radius: 8px; padding: 12px 15px; font-family: monospace;
            font-size: 0.85em; height: 250px; overflow-y: auto;
            display: none; white-space: pre-wrap;
        }
        .log-init { color: #569cd6; }
        .log-config { color: #9cdcfe; }
        .log-extraction { color: #dcdcaa; }
        .log-synthesis { color: #4ec9b0; }
        .log-storage { color: #c586c0; }
        .log-error { color: #f44747; }
        .log-complete { color: #6a9955; font-weight: bold; }
    </style>
</head>
<body>
    <h2>Synthèse : ${this.escapeHtml(collection.name)}</h2>
    <div class="form-group">
        <label for="focus">Focus de recherche</label>
        <input type="text" id="focus" placeholder="Ex: mécanismes d'action, effets secondaires...">
    </div>
    <div class="form-group">
        <label for="level">Niveau de détail</label>
        <select id="level">
            <option value="compact">Compact</option>
            <option value="moyen">Moyen</option>
            <option value="complet" selected>Complet</option>
        </select>
    </div>
    <button id="btn-launch">Lancer la synthèse</button>
    <div id="sse-log"></div>
</body>
</html>`;

        let win = Services.ww.openWindow(
            null, "about:blank", "_blank",
            "chrome,centerscreen,resizable=yes,scrollbars=yes,width=550,height=500",
            null
        );

        win.addEventListener("load", () => {
            win.document.open();
            win.document.write(html);
            win.document.close();
            win.document.title = "Synthèse - " + collection.name;

            let btn = win.document.getElementById('btn-launch');
            let focusInput = win.document.getElementById('focus');
            let levelSelect = win.document.getElementById('level');
            let logDiv = win.document.getElementById('sse-log');

            btn.addEventListener('click', () => {
                let focus = focusInput.value.trim();
                let level = levelSelect.value;

                btn.disabled = true;
                focusInput.disabled = true;
                levelSelect.disabled = true;
                logDiv.style.display = 'block';

                let sseUrl = self.config.paperReaderUrl + "/synthesize/collection/" +
                    encodeURIComponent(collection.key) + "/focused/stream?" +
                    "focus=" + encodeURIComponent(focus) +
                    "&level=" + encodeURIComponent(level);

                self.log("SSE synthesis: " + sseUrl);

                function appendLog(text, cssClass) {
                    let span = win.document.createElement('span');
                    span.className = cssClass || '';
                    span.textContent = text + "\n";
                    logDiv.appendChild(span);
                    logDiv.scrollTop = logDiv.scrollHeight;
                }

                let xhr = new XMLHttpRequest();
                let lastIndex = 0;

                xhr.open("GET", sseUrl, true);
                xhr.setRequestHeader("Accept", "text/event-stream");

                xhr.onprogress = () => {
                    let newData = xhr.responseText.substring(lastIndex);
                    lastIndex = xhr.responseText.length;
                    let lines = newData.split("\n");

                    for (let line of lines) {
                        if (!line.startsWith("data: ")) continue;
                        try {
                            let data = JSON.parse(line.substring(6));
                            let evType = data.event || data.step || "";

                            switch (evType) {
                                case "init":
                                    appendLog("Collection: " + (data.total_articles || data.count || "?") + " articles", "log-init");
                                    break;
                                case "config":
                                    appendLog("Providers: " + (data.providers || JSON.stringify(data.config || "")), "log-config");
                                    break;
                                case "extraction":
                                    let prog = data.current ? "[" + data.current + "/" + data.total + "] " : "";
                                    appendLog(prog + (data.title || data.message || "Extraction..."), "log-extraction");
                                    break;
                                case "synthesis":
                                    appendLog(data.message || "Synthèse en cours...", "log-synthesis");
                                    break;
                                case "storage":
                                    appendLog(data.message || "Sauvegarde...", "log-storage");
                                    break;
                                case "error":
                                    appendLog("ERREUR: " + (data.message || data.error || "Inconnue"), "log-error");
                                    break;
                                case "complete":
                                    appendLog("Synthèse terminée!", "log-complete");

                                    // Extract markdown and display
                                    let md = "";
                                    if (data.synthesis && data.synthesis.synthese_complete && data.synthesis.synthese_complete.full_text_markdown) {
                                        md = data.synthesis.synthese_complete.full_text_markdown;
                                    } else if (data.full_text_markdown) {
                                        md = data.full_text_markdown;
                                    } else if (data.result && data.result.full_text_markdown) {
                                        md = data.result.full_text_markdown;
                                    }

                                    if (md) {
                                        // Close dialog and display
                                        setTimeout(() => {
                                            win.close();
                                            self.displayMarkdown(
                                                "Synthèse - " + collection.name,
                                                focus || "Vue d'ensemble",
                                                md
                                            );
                                        }, 1500);
                                    } else {
                                        appendLog("Synthèse terminée mais aucun markdown trouvé dans la réponse.", "log-error");
                                        btn.disabled = false;
                                    }
                                    break;
                                default:
                                    if (data.message) {
                                        appendLog(data.message, "");
                                    }
                            }
                        } catch (e) {}
                    }
                };

                xhr.onerror = () => {
                    appendLog("Erreur de connexion au serveur", "log-error");
                    btn.disabled = false;
                    focusInput.disabled = false;
                    levelSelect.disabled = false;
                };

                xhr.ontimeout = () => {
                    appendLog("Timeout - la synthèse prend trop de temps", "log-error");
                    btn.disabled = false;
                    focusInput.disabled = false;
                    levelSelect.disabled = false;
                };

                xhr.timeout = 600000; // 10 minutes
                xhr.send();
            });
        }, { once: true });
    }
};
