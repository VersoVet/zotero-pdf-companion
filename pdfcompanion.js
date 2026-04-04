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
    paperReaderPort: 8462,  // Paper-Reader HTTP port

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
            paperReaderUrl: "http://" + this.getServerHost() + ":" + this.paperReaderPort,  // Paper-Reader HTTP:8462 (100% HTTP)
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

    // Helper: Fetch wrapper for SSL self-signed cert handling
    async safeFetch(url, options = {}) {
        try {
            // Use Zotero.HTTP.request instead of native fetch for SSL handling
            let response = await Zotero.HTTP.request("GET", url, {
                timeout: options.timeout || 15000,
                responseType: "json",
                ignoreErrors: true,  // Ignore SSL certificate errors
                ...options
            });
            // Convert response to fetch-like interface
            return {
                ok: true,
                json: async () => JSON.parse(response.responseText),
                text: async () => response.responseText
            };
        } catch (e) {
            this.log("safeFetch error for " + url + ": " + e.message);
            return {
                ok: false,
                json: async () => ({ error: e.message }),
                text: async () => e.message
            };
        }
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
            if (!win) {
                PdfCompanion.log("Toast.progress: no window, using fallback");
                return this._fallbackProgress(headline);
            }
            let doc = win.document;
            let self = this;

            let el = this._createToastEl(doc, headline, '', this._spinnerSvg);
            if (!el) {
                PdfCompanion.log("Toast.progress: no element created, using fallback");
                return this._fallbackProgress(headline);
            }

            let iconSpan = el.querySelector('.pdfcompanion-toast-icon');
            if (iconSpan) iconSpan.classList.add('spinner');
            let headlineSpan = el.querySelector('.pdfcompanion-toast-headline-text');
            let msgDiv = el.querySelector('.pdfcompanion-toast-msg');
            PdfCompanion.log("Toast.progress: created, msgDiv=" + (msgDiv ? "OK" : "NULL"));

            let closed = false;
            return {
                update(text) {
                    if (closed) return;
                    if (msgDiv) {
                        msgDiv.textContent = text || '';
                    } else {
                        PdfCompanion.log("Toast.update: msgDiv is null!");
                    }
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

            // Menu item "Lecture..." - unified dialog
            let analyzeItem = doc.createXULElement('menuitem');
            analyzeItem.id = 'pdfcompanion-tools-lecture';
            analyzeItem.setAttribute('label', 'Lecture...');
            analyzeItem.addEventListener('command', () => this.openUnifiedLectureDialog());
            menupopup.appendChild(analyzeItem);

            // Separator before Maintenance
            let sepMaintenance = doc.createXULElement('menuseparator');
            sepMaintenance.id = 'pdfcompanion-tools-sep-maintenance';
            menupopup.appendChild(sepMaintenance);

            // === Submenu: Maintenance ===
            let toolsMaintenanceMenu = doc.createXULElement('menu');
            toolsMaintenanceMenu.id = 'pdfcompanion-tools-maintenance';
            toolsMaintenanceMenu.setAttribute('label', 'Maintenance');
            let toolsMaintenancePopup = doc.createXULElement('menupopup');
            let toolsMaintenanceItems = [
                { id: 'enrich', label: 'Enrichir', action: () => this.enrichMetadataForSelected() },
                { id: 'fetch', label: 'Telecharger un PDF', action: () => this.fetchPdfForSelected() },
                { id: 'local', label: 'Joindre un PDF', action: () => this.attachLocalPdfForSelected() },
                { id: 'replace', label: 'Remplacer un PDF', action: () => this.replacePdfForSelected() }
            ];
            for (let item of toolsMaintenanceItems) {
                let menuitem = doc.createXULElement('menuitem');
                menuitem.id = 'pdfcompanion-tools-' + item.id;
                menuitem.setAttribute('label', item.label);
                menuitem.addEventListener('command', item.action);
                toolsMaintenancePopup.appendChild(menuitem);
            }
            toolsMaintenanceMenu.appendChild(toolsMaintenancePopup);
            menupopup.appendChild(toolsMaintenanceMenu);

            // === Submenu: Iconographie ===
            let toolsIconMenu = doc.createXULElement('menu');
            toolsIconMenu.id = 'pdfcompanion-tools-iconography';
            toolsIconMenu.setAttribute('label', 'Iconographie');
            let toolsIconPopup = doc.createXULElement('menupopup');
            let toolsIconItems = [
                { id: 'extractfig', label: 'Extraire les figures', action: () => this.extractFiguresForSelected() },
                { id: 'showfig', label: 'Afficher les figures', action: () => this.showFigures() }
            ];
            for (let item of toolsIconItems) {
                let menuitem = doc.createXULElement('menuitem');
                menuitem.id = 'pdfcompanion-tools-' + item.id;
                menuitem.setAttribute('label', item.label);
                menuitem.addEventListener('command', item.action);
                toolsIconPopup.appendChild(menuitem);
            }
            toolsIconMenu.appendChild(toolsIconPopup);
            menupopup.appendChild(toolsIconMenu);

            // === Other items ===
            let sep = doc.createXULElement('menuseparator');
            sep.id = 'pdfcompanion-tools-sep1';
            menupopup.appendChild(sep);

            let batchMonitorItem = doc.createXULElement('menuitem');
            batchMonitorItem.id = 'pdfcompanion-tools-batchmonitor';
            batchMonitorItem.setAttribute('label', 'Moniteur de lectures');
            batchMonitorItem.addEventListener('command', () => this.openBatchMonitor());
            menupopup.appendChild(batchMonitorItem);

            let sep2 = doc.createXULElement('menuseparator');
            sep2.id = 'pdfcompanion-tools-sep2';
            menupopup.appendChild(sep2);

            let copyItem = doc.createXULElement('menuitem');
            copyItem.id = 'pdfcompanion-tools-copyid';
            copyItem.setAttribute('label', 'Copy Item ID');
            copyItem.addEventListener('command', () => this.copyItemId());
            menupopup.appendChild(copyItem);

            let testItem = doc.createXULElement('menuitem');
            testItem.id = 'pdfcompanion-tools-test';
            testItem.setAttribute('label', 'Test Connection');
            testItem.addEventListener('command', () => this.testConnection());
            menupopup.appendChild(testItem);

            let logsItem = doc.createXULElement('menuitem');
            logsItem.id = 'pdfcompanion-tools-logs';
            logsItem.setAttribute('label', 'Show Logs');
            logsItem.addEventListener('command', () => this.showLogs());
            menupopup.appendChild(logsItem);

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

            // Menu item "Lecture..." - unified dialog
            let ctxAnalyzeItem = doc.createXULElement('menuitem');
            ctxAnalyzeItem.id = 'pdfcompanion-context-lecture';
            ctxAnalyzeItem.setAttribute('label', 'Lecture...');
            ctxAnalyzeItem.addEventListener('command', () => this.openUnifiedLectureDialog());
            menupopup.appendChild(ctxAnalyzeItem);

            // Separator before Maintenance
            let ctxSepMaintenance = doc.createXULElement('menuseparator');
            ctxSepMaintenance.id = 'pdfcompanion-context-sep-maintenance';
            menupopup.appendChild(ctxSepMaintenance);

            // === Submenu: Maintenance ===
            let maintenanceMenu = doc.createXULElement('menu');
            maintenanceMenu.id = 'pdfcompanion-context-maintenance';
            maintenanceMenu.setAttribute('label', 'Maintenance');
            let maintenancePopup = doc.createXULElement('menupopup');
            let maintenanceItems = [
                { id: 'enrich', label: 'Enrichir', action: () => this.enrichMetadataForSelected() },
                { id: 'fetch', label: 'Telecharger un PDF', action: () => this.fetchPdfForSelected() },
                { id: 'local', label: 'Joindre un PDF', action: () => this.attachLocalPdfForSelected() },
                { id: 'replace', label: 'Remplacer un PDF', action: () => this.replacePdfForSelected() }
            ];
            for (let item of maintenanceItems) {
                let menuitem = doc.createXULElement('menuitem');
                menuitem.id = 'pdfcompanion-context-' + item.id;
                menuitem.setAttribute('label', item.label);
                menuitem.addEventListener('command', item.action);
                maintenancePopup.appendChild(menuitem);
            }
            maintenanceMenu.appendChild(maintenancePopup);
            menupopup.appendChild(maintenanceMenu);

            // === Submenu: Iconographie ===
            let iconMenu = doc.createXULElement('menu');
            iconMenu.id = 'pdfcompanion-context-iconography';
            iconMenu.setAttribute('label', 'Iconographie');
            let iconPopup = doc.createXULElement('menupopup');
            let iconItems = [
                { id: 'extractfig', label: 'Extraire les figures', action: () => this.extractFiguresForSelected() },
                { id: 'showfig', label: 'Afficher les figures', action: () => this.showFigures() }
            ];
            for (let item of iconItems) {
                let menuitem = doc.createXULElement('menuitem');
                menuitem.id = 'pdfcompanion-context-' + item.id;
                menuitem.setAttribute('label', item.label);
                menuitem.addEventListener('command', item.action);
                iconPopup.appendChild(menuitem);
            }
            iconMenu.appendChild(iconPopup);
            menupopup.appendChild(iconMenu);

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

            // Menu item "Synthese..." - unified synthesis dialog
            let synthesisItem = doc.createXULElement('menuitem');
            synthesisItem.id = 'pdfcompanion-collection-synthesis';
            synthesisItem.setAttribute('label', 'Synthese...');
            synthesisItem.addEventListener('command', () => this.openUnifiedSynthesisDialog());
            menupopup.appendChild(synthesisItem);

            // Menu item "Creer documents..." - document export dialog
            let exportItem = doc.createXULElement('menuitem');
            exportItem.id = 'pdfcompanion-collection-export';
            exportItem.setAttribute('label', 'Creer documents...');
            exportItem.addEventListener('command', () => this.openDocumentExportDialog());
            menupopup.appendChild(exportItem);

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

                // Enrich metadata only
                this.log("Auto-enriching: " + title);
                await this.enrichMetadata(item);
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

    // silent=true: no toast/notifications, returns result object
    // silent=false (default): shows toast and notifications
    async recoverPdf(item, silent = false) {
        let title = item.getField("title") || "Unknown";
        this.log("Recovering PDF for: " + title);

        let toast = silent ? null : this.Toast.progress("PDF Companion - " + title.substring(0, 30));
        if (toast) toast.update("Connecting...");

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
                                if (toast) toast.update(data.message || self.getStepText(data));
                                if (data.event === "complete" || data.event === "error") {
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

            if (toast) toast.close();

            // In silent mode, just return the result
            if (silent) {
                return finalResult;
            }

            // Normal mode: show notifications
            if (!finalResult) {
                this.showNotification("Error", "No response from server");
                return null;
            }

            if (finalResult.status === "success") {
                this.showNotification("PDF Found!", this.getSourceLabel(finalResult.data?.source || finalResult.source) + " - " + title.substring(0, 40));
                try { Zotero.Sync.Runner.sync(); } catch (e) {}
            } else {
                this.showNotification("PDF Not Found", title.substring(0, 40) + " - " + (finalResult.message || "Not available"));
            }
            return finalResult;

        } catch (e) {
            if (toast) toast.close();
            if (!silent) {
                this.showNotification("Error", e.message || "Connection failed");
            }
            return { status: "error", message: e.message };
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
        return labels[data.event] || data.message || data.event;
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
                                toast.update(data.message || self.getReplaceStepText(data));
                                if (data.event === "complete" || data.event === "error") {
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
        let evt = data.event || data.step;
        let text = labels[evt] || data.message || evt || "Processing...";
        if (data.message && evt !== "error" && evt !== "complete") {
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
                                    toast.update((i + 1) + "/" + total + " - " + (data.message || data.event));
                                    if (data.event === "complete" || data.event === "error") result = data;
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
        let toast = this.Toast.progress("Enrichissement - " + title.substring(0, 30));

        // Track all changes for final summary
        let changes = [];
        let pdfSource = null;

        // First, try to recover PDF if not present (uses endpoint that manages #no-pdf tag)
        toast.update("Verification PDF...");
        let hasPdf = false;
        let attachmentIDs = item.getAttachments();
        for (let attId of attachmentIDs) {
            let att = await Zotero.Items.getAsync(attId);
            if (att && att.attachmentContentType === "application/pdf") {
                hasPdf = true;
                break;
            }
        }
        if (!hasPdf) {
            this.log("Enrichissement: no PDF, trying to recover first...");
            let pdfResult = await this.recoverPdf(item, false); // Show PDF recovery details
            if (pdfResult && pdfResult.status === "success") {
                pdfSource = pdfResult.data?.source || pdfResult.source || "unknown";
                changes.push("PDF attache (" + this.getSourceLabel(pdfSource) + ")");
                await item.reload();
            }
        }

        // Now proceed with metadata enrichment
        toast.update("Enrichissement metadonnees...");

        try {
            let url = this.config.apiUrl + "/enrich/item-stream/" + encodeURIComponent(item.key);
            let self = this;

            this.log("[Enrich] Lancement: " + url);

            // Collect fields updated for summary
            let fieldsUpdated = [];
            let eventCount = 0;

            let finalResult = await new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                let lastIndex = 0;
                let result = null;
                let resolved = false;

                xhr.open("GET", url, true);
                xhr.setRequestHeader("Accept", "text/event-stream");

                xhr.onprogress = () => {
                    try {
                        let newData = xhr.responseText.substring(lastIndex);
                        lastIndex = xhr.responseText.length;
                        let lines = newData.split("\n");
                        for (let line of lines) {
                            if (line.startsWith("data: ")) {
                                try {
                                    let data = JSON.parse(line.substring(6));
                                    eventCount++;
                                    this.log("[Enrich Event " + eventCount + "] " + JSON.stringify(data));

                                    let msg = data.message || data.event || "";
                                    toast.update(msg);

                                    // Track what was done
                                    if (data.field_updated || data.field) {
                                        fieldsUpdated.push(data.field_updated || data.field);
                                    }
                                    if (data.fields_updated && Array.isArray(data.fields_updated)) {
                                        fieldsUpdated = fieldsUpdated.concat(data.fields_updated);
                                    }

                                    if (data.event === "complete" || data.event === "error" || data.event === "enrichment_complete") {
                                        this.log("[Enrich] Event final: " + data.event + ", status: " + data.status);
                                        // Merge final result fields
                                        if (data.fields_updated) {
                                            fieldsUpdated = fieldsUpdated.concat(data.fields_updated);
                                        }
                                        if (data.data?.fields_updated) {
                                            fieldsUpdated = fieldsUpdated.concat(data.data.fields_updated);
                                        }
                                        result = data;
                                        this.log("[Enrich] Result stored: " + JSON.stringify(result).substring(0, 200));
                                    }
                                } catch (parseErr) {
                                    this.log("[Enrich Parse Error] " + parseErr + " (line: " + line.substring(0, 100) + ")");
                                }
                            }
                        }
                    } catch (progressErr) {
                        this.log("[Enrich Progress Error] " + progressErr);
                    }
                };

                xhr.onload = () => {
                    this.log("[Enrich] onload - eventCount: " + eventCount + ", result exists: " + (result !== null) + ", result status: " + (result?.status));
                    if (!resolved) {
                        resolved = true;
                        if (result) {
                            this.log("[Enrich] Resolving with result status: " + result.status);
                        } else {
                            this.log("[Enrich] WARNING: result is null on onload");
                        }
                        resolve(result);
                    }
                };

                xhr.onerror = () => {
                    this.log("[Enrich] onerror - status: " + xhr.status);
                    if (!resolved) {
                        resolved = true;
                        reject(new Error("Connection failed (status: " + xhr.status + ")"));
                    }
                };

                xhr.ontimeout = () => {
                    this.log("[Enrich] ontimeout");
                    if (!resolved) {
                        resolved = true;
                        reject(new Error("Timeout"));
                    }
                };

                xhr.timeout = 120000;
                this.log("[Enrich] Envoi requete...");
                xhr.send();
            });

            toast.close();

            this.log("[Enrich] Traitement du résultat final - status: " + (finalResult?.status) + ", fields: " + fieldsUpdated.length);

            // Remove duplicates from fieldsUpdated
            fieldsUpdated = [...new Set(fieldsUpdated)];

            if (finalResult && (finalResult.status === "success" || finalResult.status === "partial")) {
                // Build unified summary message
                // Add metadata changes
                if (fieldsUpdated.length > 0) {
                    changes.push("Metadonnees: " + fieldsUpdated.join(", "));
                }

                let summaryMsg;
                if (changes.length > 0) {
                    summaryMsg = changes.join("\n");
                } else {
                    summaryMsg = "Aucune modification";
                }

                this.log("[Enrich] Success: " + summaryMsg);
                this.showNotification("Enrichissement termine!", summaryMsg);
                await item.reload();
            } else {
                let errMsg = finalResult?.message || finalResult?.error || "Erreur inconnue";
                this.log("[Enrich] Echec: " + errMsg + " (result: " + JSON.stringify(finalResult) + ")");
                this.showNotification("Echec enrichissement", errMsg);
            }
        } catch (e) {
            toast.close();
            this.log("[Enrich] Exception: " + e.message + " (stack: " + e.stack + ")");
            this.showNotification("Erreur", e.message || "Connexion echouee");
        }
    },

    // === FOCUSED LECTURE ===
    async openFocusedLectureDialog() {
        // DEPRECATED: Redirect to unified dialog
        this.log("openFocusedLectureDialog is deprecated, using openUnifiedLectureDialog");
        return this.openUnifiedLectureDialog();
    },

    async runFocusedLecture(item, focus, provider, storeDropbox, linkZotero) {
        let title = item.getField("title") || "Article";
        let toast = this.Toast.progress("Lecture focus - " + title.substring(0, 20));

        this.log("=== FOCUSED LECTURE START ===");
        this.log("Item: " + item.key + " | Focus: " + focus + " | Provider: " + provider);

        try {
            // Build URL like summarizePaper does (simple concatenation)
            let url = this.config.paperReaderUrl + "/analyze/zotero-stream?" +
                "zotero_key=" + encodeURIComponent(item.key) +
                "&focus=" + encodeURIComponent(focus) +
                "&lecture_mode=" + encodeURIComponent("standard") +
                "&provider=" + encodeURIComponent(provider || "claude_cli");

            this.log("URL: " + url.substring(0, 100) + "...");

            let self = this;
            let finalResult = null;
            let lastIndex = 0;

            // Use Zotero.HTTP.request with requestObserver for SSE streaming (like summarizePaper)
            await Zotero.HTTP.request("GET", url, {
                headers: { "Accept": "text/event-stream" },
                timeout: 900000, // 15 minutes
                responseType: "text",
                ignoreErrors: true,  // Ignore SSL certificate errors for self-signed certs
                requestObserver: function(xhr) {
                    xhr.onprogress = function() {
                        try {
                            let newData = xhr.responseText.substring(lastIndex);
                            lastIndex = xhr.responseText.length;
                            let lines = newData.split("\n");

                            for (let line of lines) {
                                if (line.startsWith("data: ")) {
                                    try {
                                        let data = JSON.parse(line.substring(6));
                                        self.log("SSE focused: event=" + data.event + " progress=" + data.progress);

                                        // Update progress with label
                                        let label = self.getFocusedLectureLabel(data);
                                        toast.update(label);

                                        // Check for final result
                                        if (data.event === "termine" || data.done === true) {
                                            finalResult = { status: "success", data: data };
                                            self.log("✓ Final event received: " + data.event);
                                        } else if (data.event === "error" || data.event === "erreur") {
                                            finalResult = { status: "error", message: data.message || "Erreur" };
                                            self.log("✗ Error event: " + data.message);
                                        }
                                    } catch (e) {
                                        self.log("Parse error: " + e.message);
                                    }
                                }
                            }
                        } catch (e) {
                            self.log("onprogress error: " + e.message);
                        }
                    };
                }
            });

            toast.close();

            // Handle result
            this.log("Processing result...");
            if (!finalResult) {
                this.log("✗ No result received");
                this.showNotification("Erreur", "Pas de réponse du serveur");
                return;
            }

            if (finalResult.status === "success") {
                let data = finalResult.data;
                let summary = "Extraction terminee!";

                if (data.findings && data.findings.length > 0) {
                    summary += "\n" + data.findings.length + " element(s) trouves";
                    this.log("  Findings: " + data.findings.length);
                }
                if (data.quotes && data.quotes.length > 0) {
                    summary += "\n" + data.quotes.length + " citation(s)";
                    this.log("  Quotes: " + data.quotes.length);
                }
                if (data.dropbox_url) {
                    summary += "\n📎 Dropbox OK";
                    this.log("  Dropbox: OK");
                }

                this.log("✓ SUCCESS");
                this.showNotification("Lecture focus terminee!", summary);
                try { Zotero.Sync.Runner.sync(); } catch (e) {}
            } else {
                this.log("✗ Error: " + finalResult.message);
                this.showNotification("Erreur", finalResult.message || "Echec de l'extraction");
            }
        } catch (e) {
            toast.close();
            this.log("✗ EXCEPTION: " + e.message);
            this.showNotification("Erreur", e.message || "Connexion échouée");
        }

        this.log("=== FOCUSED LECTURE END ===");
    },

    getFocusedLectureLabel(data) {
        let labels = {
            "zotero": "Récupération depuis Zotero...",
            "validation": "Validation du PDF...",
            "extraction": "Extraction du contenu...",
            "llm": "Analyse LLM...",
            "dropbox": "Sauvegarde Dropbox...",
            "attachment": "Création attachment Zotero...",
            "termine": "Termine!"
        };
        let evt = data.event;
        let text = labels[evt] || data.message || evt || "Traitement...";
        if (data.progress) {
            text += " (" + data.progress + "%)";
        }
        return text;
    },

    // === PAPER READER ===
    async openLectureDialog() {
        // DEPRECATED: Redirect to unified dialog
        this.log("openLectureDialog is deprecated, using openUnifiedLectureDialog");
        return this.openUnifiedLectureDialog();
    },

    async openLectureDialogFallback(item) {
        let title = item.getField("title") || "Article";
        let ps = Services.prompt;
        let modes = ["Standard - Analyse rapide", "Complete - Analyse approfondie", "Par section - Analyse detaillee", "These - Analyse these/memoire"];
        let modeValues = ["standard", "full", "section", "thesis"];
        let providers = ["Claude (CLI) - Recommande", "SambaNova - Rapide", "Groq - Tres rapide"];
        let providerValues = ["claude_cli", "sambanova", "groq"];

        let modeSelected = { value: 0 };
        let modeOk = ps.select(Zotero.getMainWindow(), "Lecture d'article", "Type de lecture:", modes, modeSelected);
        if (!modeOk) return;

        let providerSelected = { value: 0 };
        let providerOk = ps.select(Zotero.getMainWindow(), "Modele LLM", "Choisir le modele:", providers, providerSelected);
        if (!providerOk) return;

        let extractFigures = ps.confirm(Zotero.getMainWindow(), "Extraction figures", "Extraire les figures?");

        await this.summarizePaper(item, modeValues[modeSelected.value], providerValues[providerSelected.value], extractFigures);
    },

    async summarizePaper(item, mode, provider, extractFigures, focus) {
        let title = item.getField("title") || "Unknown";
        let modeLabels = { "standard": "Standard", "full": "Complete", "section": "Par section", "thesis": "These" };
        let modeLabel = modeLabels[mode] || mode;
        provider = provider || "claude_cli";
        extractFigures = extractFigures || false;
        focus = focus || null;

        let toast = this.Toast.progress("Lecture " + modeLabel + " - " + title.substring(0, 20));
        toast.update("Connexion (" + provider + ")...");

        try {
            let url = this.config.paperReaderUrl + "/analyze/zotero-stream?" +
                "zotero_key=" + encodeURIComponent(item.key) +
                "&lecture_mode=" + encodeURIComponent(mode) +
                "&provider=" + encodeURIComponent(provider) +
                "&extract_figures=" + (extractFigures ? "true" : "false");

            if (focus) {
                url += "&focus=" + encodeURIComponent(focus);
            }

            this.log("SSE Paper Reader: " + url + " (mode=" + mode + ", focus=" + (focus ? "yes" : "no") + ")");

            let self = this;
            let finalResult = null;

            // Use Zotero.HTTP.request with streaming callback
            let lastIndex = 0;
            await Zotero.HTTP.request("GET", url, {
                headers: { "Accept": "text/event-stream" },
                timeout: 900000, // 15 minutes
                responseType: "text",
                ignoreErrors: true,  // Ignore SSL certificate errors for self-signed certs
                requestObserver: function(xhr) {
                    xhr.onprogress = function() {
                        let newData = xhr.responseText.substring(lastIndex);
                        lastIndex = xhr.responseText.length;
                        let lines = newData.split("\n");
                        for (let line of lines) {
                            if (line.startsWith("data: ")) {
                                try {
                                    let data = JSON.parse(line.substring(6));
                                    self.log("SSE analyze: " + JSON.stringify(data));
                                    toast.update(data.message || self.getAnalyzeStepText(data));
                                    let evt = data.event || data.step;
                                    if (data.done === true || evt === "termine" || evt === "complete") {
                                        finalResult = { status: "success", data: data };
                                    } else if (evt === "error" || evt === "erreur") {
                                        finalResult = { status: "error", message: data.message || "Erreur inconnue" };
                                    }
                                } catch (e) {
                                    self.log("SSE parse error: " + e);
                                }
                            }
                        }
                    };
                }
            });

            toast.close();

            if (!finalResult) {
                this.showNotification("Erreur", "Pas de réponse du serveur");
                return;
            }

            if (finalResult.status === "success") {
                let ficheId = finalResult.data?.fiche_id || "";
                let msg = title.substring(0, 40) + " - Fiche creee";
                if (ficheId) msg += " (" + ficheId + ")";
                this.showNotification("Lecture terminee!", msg);
                // Reload item to show new tags (paper-reader-analyzed, #lecture)
                await item.reload();
                try { Zotero.Sync.Runner.sync(); } catch (e) {}
            } else {
                this.showNotification("Echec de la lecture", finalResult.message || "Erreur inconnue");
            }
        } catch (e) {
            toast.close();
            this.log("Paper Reader SSE error: " + e);
            this.showNotification("Erreur", e.message || "Connexion échouée");
        }
    },

    async openUnifiedLectureDialog() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "Aucun item selectionne");
            return;
        }
        items = items.filter(item => !item.isAttachment() && !item.isNote());
        if (items.length !== 1) {
            this.showNotification("PDF Companion", "Selectionnez un seul article");
            return;
        }
        let item = items[0];
        let title = item.getField("title") || "Article";
        let itemKey = item.key;

        let self = this;

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Lecture d'article</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1e1e1e;
            color: #e0e0e0;
            padding: 0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 18px 22px;
            flex-shrink: 0;
        }
        .header h1 {
            font-size: 1.2em;
            font-weight: 600;
            margin-bottom: 6px;
        }
        .header .subtitle {
            font-size: 0.85em;
            opacity: 0.9;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .form-container {
            padding: 18px 22px;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 16px;
            overflow-y: auto;
        }
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .form-group > label {
            font-weight: 600;
            font-size: 0.9em;
            color: #b0b0b0;
            margin-bottom: 4px;
        }
        .radio-group {
            background: #2a2a2a;
            border-radius: 6px;
            padding: 8px 12px;
        }
        .radio-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 4px;
            cursor: pointer;
            border-radius: 4px;
        }
        .radio-item:hover {
            background: #353535;
        }
        .radio-item input[type="radio"] {
            width: 16px;
            height: 16px;
            accent-color: #667eea;
            cursor: pointer;
        }
        .radio-item label {
            cursor: pointer;
            font-size: 0.9em;
            color: #e0e0e0;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 14px;
            background: #2a2a2a;
            border-radius: 6px;
            cursor: pointer;
        }
        .checkbox-group:hover {
            background: #353535;
        }
        .checkbox-group input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: #667eea;
            cursor: pointer;
        }
        .checkbox-label {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .checkbox-label span {
            font-weight: 500;
            color: #e0e0e0;
            font-size: 0.95em;
        }
        .checkbox-label small {
            color: #888;
            font-size: 0.8em;
        }
        .text-input {
            width: 100%;
            padding: 12px;
            border: 1px solid #444;
            border-radius: 6px;
            background: #2a2a2a;
            color: #e0e0e0;
            font-size: 0.95em;
            resize: vertical;
            min-height: 80px;
        }
        .text-input:focus {
            outline: none;
            border-color: #667eea;
        }
        .text-input::placeholder {
            color: #666;
        }
        .hidden {
            display: none;
        }
        .button-row {
            display: flex;
            gap: 10px;
            padding: 16px 22px;
            background: #252525;
            border-top: 1px solid #333;
            flex-shrink: 0;
        }
        .btn {
            flex: 1;
            padding: 12px 16px;
            border: none;
            border-radius: 6px;
            font-size: 0.95em;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        .btn-secondary {
            background: #3c3c3c;
            color: #e0e0e0;
            border: 1px solid #555;
        }
        .btn-secondary:hover {
            background: #4a4a4a;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Lecture d'article</h1>
        <div class="subtitle" title="${this.escapeHtml(title)}">${this.escapeHtml(title.length > 50 ? title.substring(0, 50) + "..." : title)}</div>
    </div>
    <div class="form-container">
        <div class="form-group">
            <label>Type de lecture</label>
            <div class="radio-group">
                <div class="radio-item">
                    <input type="radio" name="lectureMode" id="modeStandard" value="standard" checked>
                    <label for="modeStandard">Standard - Analyse rapide</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="lectureMode" id="modeFull" value="full">
                    <label for="modeFull">Complete - Analyse approfondie</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="lectureMode" id="modeSection" value="section">
                    <label for="modeSection">Par section - Analyse detaillee</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="lectureMode" id="modeThesis" value="thesis">
                    <label for="modeThesis">These - Analyse these/memoire</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="lectureMode" id="modeFocus" value="focus">
                    <label for="modeFocus">Focus - Sujet specifique</label>
                </div>
            </div>
        </div>

        <div class="form-group hidden" id="focusGroup">
            <label>Question de focus</label>
            <textarea class="text-input" id="focusText" placeholder="Ex: effets secondaires, mecanismes d'action, indications, posologie..."></textarea>
        </div>

        <div class="form-group">
            <label>Modele LLM</label>
            <div class="radio-group">
                <div class="radio-item">
                    <input type="radio" name="llmProvider" id="providerClaude" value="claude_cli" checked>
                    <label for="providerClaude">Claude (CLI) - Recommande</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="llmProvider" id="providerSambanova" value="sambanova">
                    <label for="providerSambanova">SambaNova - Rapide</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="llmProvider" id="providerGroq" value="groq">
                    <label for="providerGroq">Groq - Tres rapide</label>
                </div>
            </div>
        </div>

        <label class="checkbox-group" for="extractFigures">
            <input type="checkbox" id="extractFigures">
            <div class="checkbox-label">
                <span>Extraire les figures</span>
                <small>Plus lent, utilise Docling pour l'extraction</small>
            </div>
        </label>
    </div>
    <div class="button-row">
        <button class="btn btn-secondary" onclick="window.close()">Annuler</button>
        <button class="btn btn-primary" onclick="startLecture()">Lancer la lecture</button>
    </div>
    <script>
        function getSelectedRadio(name) {
            var radios = document.getElementsByName(name);
            for (var i = 0; i < radios.length; i++) {
                if (radios[i].checked) return radios[i].value;
            }
            return null;
        }

        function toggleFocusGroup() {
            var mode = getSelectedRadio('lectureMode');
            var focusGroup = document.getElementById('focusGroup');
            if (mode === 'focus') {
                focusGroup.classList.remove('hidden');
                setTimeout(function() {
                    document.getElementById('focusText').focus();
                }, 50);
            } else {
                focusGroup.classList.add('hidden');
            }
        }

        function startLecture() {
            var mode = getSelectedRadio('lectureMode') || 'standard';
            var provider = getSelectedRadio('llmProvider') || 'claude_cli';
            var extractFigures = document.getElementById('extractFigures').checked;
            var focus = null;

            if (mode === 'focus') {
                focus = document.getElementById('focusText').value.trim();
                if (!focus) {
                    alert('Veuillez entrer une question de focus');
                    document.getElementById('focusText').focus();
                    return;
                }
            }

            if (window.pdfCompanionCallback) {
                window.pdfCompanionCallback(mode, provider, extractFigures, focus);
            }
            window.close();
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.ctrlKey) {
                startLecture();
            } else if (e.key === 'Escape') {
                window.close();
            }
        });

        // Setup radio listeners for focus group visibility
        var radios = document.getElementsByName('lectureMode');
        for (var i = 0; i < radios.length; i++) {
            radios[i].addEventListener('change', toggleFocusGroup);
        }
    </script>
</body>
</html>`;

        try {
            let win = Services.ww.openWindow(
                null,
                "about:blank",
                "_blank",
                "chrome,centerscreen,resizable=yes,width=480,height=660",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = "Lecture d'article";

                win.pdfCompanionCallback = async (mode, provider, extractFigures, focus) => {
                    self.log("Unified lecture dialog: mode=" + mode + ", provider=" + provider + ", focus=" + (focus || "null"));
                    if (mode === "focus") {
                        await self.summarizePaper(item, "standard", provider, extractFigures, focus);
                    } else {
                        await self.summarizePaper(item, mode, provider, extractFigures, focus);
                    }
                };
            }, { once: true });

            this.log("Opened unified lecture dialog for: " + title);
        } catch (e) {
            this.log("openUnifiedLectureDialog error: " + e);
            this.openLectureDialogFallback(item);
        }
    },

    getAnalyzeStepText(data) {
        let labels = {
            "zotero": "Recuperation depuis Zotero...",
            "analyse": "Analyse du PDF...",
            "extraction": "Extraction du contenu...",
            "docling": "Extraction figures (Docling)...",
            "llm": "Traitement LLM...",
            "validation": "Validation des donnees...",
            "section": "Analyse par section...",
            "synthese": "Synthese en cours...",
            "generation": "Generation de la fiche...",
            "sauvegarde": "Sauvegarde...",
            "tagging": "Ajout des tags...",
            "termine": "Termine!",
            "complete": "Termine!"
        };
        let evt = data.event || data.step;
        let text = labels[evt] || data.message || evt || "Traitement...";
        if (data.message && evt !== "termine" && evt !== "complete" && !labels[evt]) {
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
            let response = await Zotero.HTTP.request("GET", this.config.paperReaderUrl + "/health", {
                timeout: 5000,
                ignoreErrors: true  // Ignore SSL certificate errors for self-signed certs
            });
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
        let logCount = this.logBuffer.length;

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>PDF Companion Logs</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1e1e1e;
            color: #d4d4d4;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
        }
        .header h1 {
            font-size: 1.2em;
            font-weight: 600;
        }
        .header .info {
            font-size: 0.85em;
            opacity: 0.9;
        }
        .toolbar {
            background: #2d2d2d;
            padding: 10px 20px;
            display: flex;
            gap: 10px;
            border-bottom: 1px solid #404040;
            flex-shrink: 0;
        }
        .btn {
            background: #0e639c;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: background 0.2s;
        }
        .btn:hover { background: #1177bb; }
        .btn-secondary {
            background: #3c3c3c;
            border: 1px solid #555;
        }
        .btn-secondary:hover { background: #4a4a4a; }
        .btn-danger {
            background: #c53030;
        }
        .btn-danger:hover { background: #e53e3e; }
        .log-container {
            flex: 1;
            overflow: auto;
            padding: 15px 20px;
        }
        .log-content {
            font-family: "SF Mono", Monaco, "Cascadia Code", Consolas, monospace;
            font-size: 12px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .log-line {
            padding: 2px 0;
        }
        .log-line:hover {
            background: #2a2a2a;
        }
        .timestamp {
            color: #6a9955;
        }
        .message {
            color: #d4d4d4;
        }
        .copied-toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #22c55e;
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            font-weight: 500;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s;
            z-index: 1000;
        }
        .copied-toast.show {
            opacity: 1;
            transform: translateY(0);
        }
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #888;
        }
        .empty-state .icon {
            font-size: 3em;
            margin-bottom: 15px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>PDF Companion Logs</h1>
        <div class="info">${logCount} entries</div>
    </div>
    <div class="toolbar">
        <button class="btn" onclick="copyLogs()">
            <span>📋</span> Copy to Clipboard
        </button>
        <button class="btn btn-secondary" onclick="scrollToBottom()">
            <span>⬇</span> Scroll to Bottom
        </button>
        <button class="btn btn-secondary" onclick="scrollToTop()">
            <span>⬆</span> Scroll to Top
        </button>
        <div style="flex:1"></div>
        <button class="btn btn-danger" onclick="window.close()">
            <span>✕</span> Close
        </button>
    </div>
    <div class="log-container" id="logContainer">
        ${logCount === 0 ? `
            <div class="empty-state">
                <div class="icon">📄</div>
                <div>No logs yet</div>
            </div>
        ` : `
            <div class="log-content" id="logContent">${this.escapeHtml(logs).split('\\n').map(line => {
                let match = line.match(/^(\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z)\\s*-\\s*(.*)$/);
                if (match) {
                    return '<div class="log-line"><span class="timestamp">' + match[1] + '</span> - <span class="message">' + match[2] + '</span></div>';
                }
                return '<div class="log-line">' + line + '</div>';
            }).join('')}</div>
        `}
    </div>
    <div class="copied-toast" id="toast">Copied to clipboard!</div>
    <script>
        const rawLogs = ${JSON.stringify(logs)};

        function copyLogs() {
            navigator.clipboard.writeText(rawLogs).then(() => {
                showToast();
            }).catch(() => {
                // Fallback for older browsers
                const ta = document.createElement('textarea');
                ta.value = rawLogs;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                showToast();
            });
        }

        function showToast() {
            const toast = document.getElementById('toast');
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
        }

        function scrollToBottom() {
            const container = document.getElementById('logContainer');
            container.scrollTop = container.scrollHeight;
        }

        function scrollToTop() {
            const container = document.getElementById('logContainer');
            container.scrollTop = 0;
        }

        // Auto-scroll to bottom on load
        setTimeout(scrollToBottom, 100);
    </script>
</body>
</html>`;

        try {
            let win = Services.ww.openWindow(
                null,
                "about:blank",
                "_blank",
                "chrome,centerscreen,resizable=yes,scrollbars=yes,width=900,height=600",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = "PDF Companion Logs";
            }, { once: true });

            this.log("Opened logs window");
        } catch (e) {
            this.log("showLogs error: " + e);
            // Fallback to simple alert
            Services.prompt.alert(null, "PDF Companion Logs", logs);
        }
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

        // Copy to clipboard using Zotero 8 API
        const { Clipboard } = require("zotero/lib/clipboard");
        Clipboard.copyText(key);

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

        let toast = this.Toast.progress("Chargement fiche...");

        try {
            // Get all attachments
            let attachmentIDs = item.getAttachments();
            let fiches = [];

            for (let attID of attachmentIDs) {
                let att = await Zotero.Items.getAsync(attID);
                if (!att) continue;

                let attTitle = att.getField("title") || "";
                let url = att.getField("url") || "";
                let contentType = att.attachmentContentType || "";

                // Check if it's a Paper-Reader JSON fiche
                if ((contentType === "application/json" || url.endsWith(".json")) &&
                    (attTitle.includes("Paper-Reader") || attTitle.includes("Analyse"))) {

                    // Convert Dropbox URL to direct download
                    let downloadUrl = url.replace("dl=0", "dl=1");
                    this.log("Downloading fiche: " + downloadUrl);
                    toast.update("Telechargement fiche...");

                    try {
                        let response = await Zotero.HTTP.request("GET", downloadUrl, { timeout: 30000 });
                        let json = JSON.parse(response.responseText);
                        fiches.push({
                            id: json.id || attTitle,
                            date: json.created_at || att.dateAdded,
                            data: json
                        });
                    } catch (e) {
                        this.log("Failed to download fiche: " + e);
                    }
                }
            }

            toast.close();

            if (fiches.length === 0) {
                this.showNotification("Aucune fiche", "Pas de fiche Paper-Reader trouvee pour cet item.");
                return;
            }

            // Use the most recent fiche
            fiches.sort((a, b) => new Date(b.date) - new Date(a.date));
            let fiche = fiches[0].data;
            let synthesis = fiche.synthesis || {};

            // Build HTML
            let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Fiche - ${this.escapeHtml(title)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f8f9fa;
            color: #333;
            line-height: 1.7;
            padding: 30px;
        }
        .container { max-width: 900px; margin: 0 auto; }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px 30px;
            border-radius: 12px;
            margin-bottom: 25px;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
        }
        .header h1 { font-size: 1.4em; font-weight: 600; margin-bottom: 12px; }
        .meta { font-size: 0.85em; opacity: 0.9; }
        .meta span { margin-right: 15px; }
        .badge {
            display: inline-block;
            background: rgba(255,255,255,0.2);
            padding: 3px 10px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 0.8em;
        }
        .section {
            background: white;
            padding: 25px 30px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .section h2 {
            color: #667eea;
            font-size: 1.1em;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #eef;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .section h2 .icon { font-size: 1.2em; }
        .section p { margin-bottom: 12px; text-align: justify; }
        .insights {
            background: #fafbfc;
            border-left: 4px solid #667eea;
            padding: 20px;
            border-radius: 0 10px 10px 0;
        }
        .insight {
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid #eee;
        }
        .insight:last-child { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
        .insight-topic {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.75em;
            text-transform: uppercase;
            margin-bottom: 8px;
        }
        .insight-text { font-size: 0.95em; }
        .quote {
            background: #f5f5ff;
            border-left: 3px solid #764ba2;
            padding: 10px 15px;
            margin-top: 10px;
            font-style: italic;
            font-size: 0.85em;
            color: #555;
        }
        .no-content {
            text-align: center;
            padding: 40px;
            color: #888;
        }
        @media print {
            body { background: white; padding: 20px; }
            .section { box-shadow: none; border: 1px solid #ddd; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${this.escapeHtml(title)}</h1>
            <div class="meta">
                <span><strong>Auteurs:</strong> ${this.escapeHtml(authors)}</span>
                ${year ? `<span><strong>Annee:</strong> ${year}</span>` : ''}
                <span class="badge">ID: ${item.key}</span>
                <span class="badge">${fiche.lecture_mode || 'standard'}</span>
            </div>
        </div>`;

            // Objective section
            if (synthesis.objective_synthesis) {
                html += `
        <div class="section">
            <h2><span class="icon">🎯</span> Objectif</h2>
            <p>${this.escapeHtml(synthesis.objective_synthesis)}</p>
        </div>`;
            }

            // Methodology section
            if (synthesis.methodology_synthesis) {
                html += `
        <div class="section">
            <h2><span class="icon">🔬</span> Methodologie</h2>
            <p>${this.escapeHtml(synthesis.methodology_synthesis)}</p>
        </div>`;
            }

            // Results section
            if (synthesis.results_synthesis) {
                html += `
        <div class="section">
            <h2><span class="icon">📊</span> Resultats</h2>
            <p>${this.escapeHtml(synthesis.results_synthesis)}</p>
        </div>`;
            }

            // Discussion section
            if (synthesis.discussion_synthesis) {
                html += `
        <div class="section">
            <h2><span class="icon">💬</span> Discussion</h2>
            <p>${this.escapeHtml(synthesis.discussion_synthesis)}</p>
        </div>`;
            }

            // Key insights
            if (synthesis.key_insights && synthesis.key_insights.length > 0) {
                html += `
        <div class="section">
            <h2><span class="icon">💡</span> Points cles (${synthesis.key_insights.length})</h2>
            <div class="insights">`;

                for (let insight of synthesis.key_insights) {
                    html += `
                <div class="insight">
                    <span class="insight-topic">${this.escapeHtml(insight.topic || 'insight')}</span>
                    <div class="insight-text">${this.escapeHtml(insight.synthesis || '')}</div>
                    ${insight.source_quote ? `<div class="quote">"${this.escapeHtml(insight.source_quote.substring(0, 300))}${insight.source_quote.length > 300 ? '...' : ''}"</div>` : ''}
                </div>`;
                }

                html += `
            </div>
        </div>`;
            }

            // Check if no content at all
            if (!synthesis.objective_synthesis && !synthesis.methodology_synthesis &&
                !synthesis.results_synthesis && !synthesis.discussion_synthesis &&
                (!synthesis.key_insights || synthesis.key_insights.length === 0)) {
                html += `<div class="no-content">Fiche vide ou format non reconnu.</div>`;
            }

            html += `
    </div>
</body>
</html>`;

            // Open window
            let win = Services.ww.openWindow(
                null,
                "about:blank",
                "_blank",
                "chrome,centerscreen,resizable=yes,scrollbars=yes,width=950,height=800",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = "Fiche - " + title.substring(0, 40);
            }, { once: true });

            this.log("Opened fiche window for: " + item.key);

        } catch (e) {
            toast.close();
            this.log("showFormattedNotes error: " + e);
            this.showNotification("Erreur", "Impossible d'afficher la fiche: " + e.message);
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

    // === OPEN COLLECTION SUMMARY ===
    async openCollectionSummary() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Selectionnez une collection");
            return;
        }

        let toast = this.Toast.progress("Collection Summary");
        toast.update("Recherche...");

        try {
            // Search for Collection Summary item
            let url = this.config.apiUrl + "/collections/" + encodeURIComponent(collection.key) + "/items";
            let response = await Zotero.HTTP.request("GET", url, { timeout: 15000 });
            let data = JSON.parse(response.responseText);
            let items = data.items || [];

            // Find the Collection Summary item (has paper-reader-collection-summary tag or starts with emoji)
            let summaryItem = items.find(it => {
                let title = it.title || "";
                let tags = (it.tags || []).map(t => typeof t === 'string' ? t : t.tag);
                return tags.includes("paper-reader-collection-summary") ||
                       title.startsWith("📚") ||
                       title.includes("Syntheses & Documents") ||
                       title.includes("Synthèses & Documents");
            });

            if (!summaryItem) {
                toast.close();
                // No summary exists - offer to create one
                this.showNotification("Pas de Collection Summary",
                    "Utilisez 'Creer synthese PRISMA' pour generer le premier document.");
                return;
            }

            toast.update("Chargement des documents...");

            // Get children (attachments) of the Collection Summary
            let childUrl = this.config.apiUrl + "/item/" + encodeURIComponent(summaryItem.key) + "/children";
            let childResp = await Zotero.HTTP.request("GET", childUrl, { timeout: 15000 });
            let childData = JSON.parse(childResp.responseText);
            let children = childData.children || [];

            toast.close();

            if (children.length === 0) {
                this.showNotification("Collection Summary vide",
                    "Aucun document attache. Utilisez 'Creer synthese PRISMA'.");
                return;
            }

            // Display the Collection Summary with attachments
            this.displayCollectionSummary(collection.name, summaryItem, children);

        } catch (e) {
            toast.close();
            this.log("openCollectionSummary error: " + e);
            this.showNotification("Erreur", "Impossible de charger le Collection Summary");
        }
    },

    displayCollectionSummary(collectionName, summaryItem, attachments) {
        let self = this;

        // Build attachment list HTML
        let attachmentRows = attachments.map((att, idx) => {
            let data = att.data || att;
            let title = data.title || "Document";
            let url = data.url || "";
            let contentType = data.contentType || "";
            let dateAdded = data.dateAdded ? new Date(data.dateAdded).toLocaleDateString('fr-FR') : "";

            // Determine icon based on content type
            let icon = "📄";
            if (contentType.includes("word") || title.toLowerCase().includes("prisma")) icon = "📊";
            else if (contentType.includes("markdown") || title.toLowerCase().includes("synthese")) icon = "📝";
            else if (contentType.includes("json")) icon = "📋";

            return `
                <div class="attachment-row" data-url="${this.escapeHtml(url)}" data-idx="${idx}">
                    <span class="att-icon">${icon}</span>
                    <span class="att-title">${this.escapeHtml(title)}</span>
                    <span class="att-date">${dateAdded}</span>
                    <button class="att-btn open-btn" data-url="${this.escapeHtml(url)}">Ouvrir</button>
                </div>
            `;
        }).join("");

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>📚 ${this.escapeHtml(collectionName)} - Collection Summary</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            color: #e0e0e0;
            padding: 20px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .header h1 {
            font-size: 1.8em;
            color: #00d4aa;
            margin-bottom: 10px;
        }
        .header .subtitle {
            color: #8b949e;
            font-size: 0.95em;
        }
        .stats {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-bottom: 30px;
        }
        .stat-box {
            background: rgba(255,255,255,0.05);
            padding: 15px 25px;
            border-radius: 10px;
            text-align: center;
        }
        .stat-value {
            font-size: 1.8em;
            font-weight: bold;
            color: #00d4aa;
        }
        .stat-label {
            font-size: 0.85em;
            color: #8b949e;
        }
        .attachments-section {
            background: rgba(255,255,255,0.03);
            border-radius: 12px;
            padding: 20px;
        }
        .section-title {
            font-size: 1.1em;
            color: #58a6ff;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .attachment-row {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            border-radius: 8px;
            margin-bottom: 8px;
            background: rgba(255,255,255,0.02);
            transition: background 0.2s;
        }
        .attachment-row:hover {
            background: rgba(255,255,255,0.08);
        }
        .att-icon {
            font-size: 1.4em;
            margin-right: 12px;
        }
        .att-title {
            flex: 1;
            font-weight: 500;
        }
        .att-date {
            color: #8b949e;
            font-size: 0.85em;
            margin-right: 15px;
        }
        .att-btn {
            background: #238636;
            color: white;
            border: none;
            padding: 6px 14px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85em;
        }
        .att-btn:hover {
            background: #2ea043;
        }
        .no-attachments {
            text-align: center;
            padding: 40px;
            color: #8b949e;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📚 ${this.escapeHtml(collectionName)}</h1>
            <div class="subtitle">Collection Summary - Syntheses & Documents</div>
        </div>

        <div class="stats">
            <div class="stat-box">
                <div class="stat-value">${attachments.length}</div>
                <div class="stat-label">Documents</div>
            </div>
        </div>

        <div class="attachments-section">
            <div class="section-title">📎 Documents disponibles</div>
            ${attachmentRows || '<div class="no-attachments">Aucun document</div>'}
        </div>
    </div>

    <script>
        document.querySelectorAll('.open-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                let url = this.getAttribute('data-url');
                if (url && !url.includes('file://')) {
                    // Add dl=1 for Dropbox direct download
                    if (url.includes('dropbox.com') && !url.includes('dl=1')) {
                        url = url.replace('dl=0', 'dl=1');
                        if (!url.includes('dl=1')) url += (url.includes('?') ? '&' : '?') + 'dl=1';
                    }
                    window.open(url, '_blank');
                } else {
                    alert('Document non disponible en ligne');
                }
            });
        });
    </script>
</body>
</html>`;

        let win = Services.ww.openWindow(
            null, "about:blank", "_blank",
            "chrome,centerscreen,resizable=yes,scrollbars=yes,width=850,height=650",
            null
        );

        win.addEventListener("load", () => {
            win.document.documentElement.innerHTML = html;
        }, { once: true });
    },

    // === CREATE PRISMA SYNTHESIS ===
    async createPrismaSynthesis() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Selectionnez une collection");
            return;
        }

        let toast = this.Toast.progress("PRISMA - " + collection.name.substring(0, 25));
        toast.update("Demarrage...");

        let self = this;
        let finalFilename = null;

        try {
            let url = this.config.paperReaderUrl + "/synthesize/collection/" +
                encodeURIComponent(collection.key) + "/stream-v2";

            this.log("GET stream-v2: " + url);

            await new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                xhr.open("GET", url, true);
                xhr.setRequestHeader("Accept", "text/event-stream");

                let buffer = "";

                xhr.onprogress = function() {
                    let newData = xhr.responseText.substring(buffer.length);
                    buffer = xhr.responseText;

                    let lines = newData.split("\n");
                    for (let line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                let data = JSON.parse(line.substring(6));
                                self.log("PRISMA SSE: " + data.stage + " - " + data.message);

                                // Update toast based on stage
                                if (data.stage === "error") {
                                    toast.error(data.message);
                                    reject(new Error(data.message));
                                    return;
                                }

                                if (data.message) {
                                    toast.update(data.message);
                                }

                                // Capture filename when complete
                                if (data.stage === "complete" && data.filename) {
                                    finalFilename = data.filename;
                                }
                            } catch (parseErr) {
                                // Ignore partial JSON
                            }
                        }
                    }
                };

                xhr.onload = function() {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        reject(new Error("HTTP " + xhr.status));
                    }
                };

                xhr.onerror = function() {
                    reject(new Error("Connexion echouee"));
                };

                xhr.send();
            });

            // If we have a filename, download from Dropbox and open
            if (finalFilename) {
                toast.update("Telechargement du document...");

                // Construct Dropbox URL from collection path
                let dropboxUrl = "https://www.dropbox.com/home/Apps/ZoteroManager/collections/" +
                    collection.key + "/" + finalFilename + "?dl=1";

                this.log("Downloading PRISMA doc from: " + dropboxUrl);

                try {
                    let docResponse = await Zotero.HTTP.request("GET", dropboxUrl, {
                        timeout: 60000,
                        responseType: "arraybuffer"
                    });

                    // Save to temp directory
                    toast.update("Ouverture du document...");
                    let tempDir = Zotero.getTempDirectory().path;
                    let filePath = PathUtils.join(tempDir, finalFilename);

                    await IOUtils.write(filePath, new Uint8Array(docResponse.response));
                    this.log("PRISMA document saved to: " + filePath);

                    toast.success("Document PRISMA pret!");

                    // Open with default application
                    let file = Zotero.File.pathToFile(filePath);
                    file.launch();

                } catch (dlError) {
                    this.log("Download error (file will be in Dropbox): " + dlError);
                    toast.success("Document genere dans Dropbox");
                    this.showNotification("PRISMA genere",
                        "Fichier: " + finalFilename + "\nOuvrez Dropbox > Apps > ZoteroManager > collections");
                }
            } else {
                toast.success("Synthese PRISMA terminee");
            }

        } catch (e) {
            toast.close();
            this.log("createPrismaSynthesis error: " + e);

            let errMsg = e.message || "Connexion echouee";
            if (errMsg.includes("No fiches") || errMsg.includes("fiches found") || errMsg.includes("No analyzed")) {
                this.showNotification("Pas de fiches",
                    "Utilisez d'abord 'Lire l'article' sur les items de cette collection.");
            } else {
                this.showNotification("Erreur PRISMA", errMsg.substring(0, 100));
            }
        }
    },

    // === PRISMA SYNTHESIS V2 DIALOG ===
    async openPrismaDialog() {
        // DEPRECATED: Redirect to unified dialog
        this.log("openPrismaDialog is deprecated, using openUnifiedSynthesisDialog");
        return this.openUnifiedSynthesisDialog();

        // Old code below is no longer used (for reference only)
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Selectionnez une collection");
            return;
        }

        let collectionName = collection.name;
        let self = this;

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Synthese PRISMA</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1e1e1e;
            color: #e0e0e0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: linear-gradient(135deg, #5a272d 0%, #7c4349 100%);
            color: white;
            padding: 18px 22px;
            flex-shrink: 0;
        }
        .header h1 {
            font-size: 1.2em;
            font-weight: 600;
            margin-bottom: 6px;
        }
        .header .subtitle {
            font-size: 0.85em;
            opacity: 0.9;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .form-container {
            padding: 18px 22px;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 16px;
            overflow-y: auto;
        }
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .form-group > label {
            font-weight: 600;
            font-size: 0.9em;
            color: #b0b0b0;
            margin-bottom: 4px;
        }
        .radio-group {
            background: #2a2a2a;
            border-radius: 6px;
            padding: 8px 12px;
        }
        .radio-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 4px;
            cursor: pointer;
            border-radius: 4px;
        }
        .radio-item:hover {
            background: #353535;
        }
        .radio-item input[type="radio"] {
            width: 16px;
            height: 16px;
            accent-color: #7c4349;
            cursor: pointer;
        }
        .radio-item label {
            cursor: pointer;
            font-size: 0.9em;
            color: #e0e0e0;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: #2a2a2a;
            border-radius: 6px;
            cursor: pointer;
        }
        .checkbox-group:hover {
            background: #353535;
        }
        .checkbox-group input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: #7c4349;
            cursor: pointer;
        }
        .checkbox-label {
            font-size: 0.9em;
            color: #e0e0e0;
        }
        .input-group {
            background: #2a2a2a;
            border-radius: 6px;
            padding: 12px;
        }
        .input-group input[type="text"] {
            width: 100%;
            padding: 10px;
            background: #1e1e1e;
            border: 1px solid #444;
            border-radius: 4px;
            color: #e0e0e0;
            font-size: 0.9em;
        }
        .input-group input[type="text"]:focus {
            outline: none;
            border-color: #7c4349;
        }
        .input-group input[type="text"]:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .button-row {
            display: flex;
            gap: 10px;
            padding: 16px 22px;
            background: #252525;
            border-top: 1px solid #333;
            flex-shrink: 0;
        }
        .btn {
            flex: 1;
            padding: 12px 16px;
            border: none;
            border-radius: 6px;
            font-size: 0.95em;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary {
            background: linear-gradient(135deg, #5a272d 0%, #7c4349 100%);
            color: white;
        }
        .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(124, 67, 73, 0.4);
        }
        .btn-secondary {
            background: #3c3c3c;
            color: #e0e0e0;
            border: 1px solid #555;
        }
        .btn-secondary:hover {
            background: #4a4a4a;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Synthese PRISMA</h1>
        <div class="subtitle" title="${this.escapeHtml(collectionName)}">${this.escapeHtml(collectionName.length > 45 ? collectionName.substring(0, 45) + "..." : collectionName)}</div>
    </div>
    <div class="form-container">
        <div class="form-group">
            <label>Mode de lecture</label>
            <div class="radio-group">
                <div class="radio-item">
                    <input type="radio" name="lectureMode" id="modeStandard" value="standard" checked>
                    <label for="modeStandard">Standard - Analyse rapide</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="lectureMode" id="modeFull" value="full">
                    <label for="modeFull">Complete - Analyse approfondie</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="lectureMode" id="modeThesis" value="thesis">
                    <label for="modeThesis">These - Qualite doctorale</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="lectureMode" id="modeFocus" value="focus">
                    <label for="modeFocus">Focus - Sujet specifique</label>
                </div>
            </div>
        </div>

        <div class="form-group" id="focusGroup" style="display: none;">
            <label>Sujet de focus</label>
            <div class="input-group">
                <input type="text" id="focusInput" placeholder="Ex: biomarqueurs, traitement, diagnostic..." />
            </div>
        </div>

        <div class="form-group">
            <label>Modele LLM</label>
            <div class="radio-group">
                <div class="radio-item">
                    <input type="radio" name="provider" id="providerClaude" value="claude_cli">
                    <label for="providerClaude">Claude (CLI) - Recommande</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="provider" id="providerSambanova" value="sambanova" checked>
                    <label for="providerSambanova">SambaNova - Rapide</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="provider" id="providerGroq" value="groq">
                    <label for="providerGroq">Groq - Tres rapide</label>
                </div>
            </div>
        </div>

        <label class="checkbox-group" for="chkLecture">
            <input type="checkbox" id="chkLecture" checked>
            <span class="checkbox-label">Analyser les articles sans fiche de lecture</span>
        </label>

        <label class="checkbox-group" for="chkReplace">
            <input type="checkbox" id="chkReplace">
            <span class="checkbox-label">Remplacer les syntheses existantes</span>
        </label>
    </div>
    <div class="button-row">
        <button class="btn btn-secondary" onclick="window.close()">Annuler</button>
        <button class="btn btn-primary" onclick="startPrisma()">Generer PRISMA</button>
    </div>
    <script>
        // Show/hide focus input based on mode selection
        document.querySelectorAll('input[name="lectureMode"]').forEach(radio => {
            radio.addEventListener('change', function() {
                let focusGroup = document.getElementById('focusGroup');
                let focusInput = document.getElementById('focusInput');
                if (this.value === 'focus') {
                    focusGroup.style.display = 'flex';
                    focusInput.disabled = false;
                } else {
                    focusGroup.style.display = 'none';
                    focusInput.disabled = true;
                }
            });
        });

        function getSelectedRadio(name) {
            let radios = document.getElementsByName(name);
            for (let i = 0; i < radios.length; i++) {
                if (radios[i].checked) return radios[i].value;
            }
            return null;
        }

        function startPrisma() {
            let lectureMode = getSelectedRadio('lectureMode') || 'standard';
            let provider = getSelectedRadio('provider') || 'sambanova';
            let lecture = document.getElementById('chkLecture').checked;
            let replace = document.getElementById('chkReplace').checked;
            let focus = null;

            if (lectureMode === 'focus') {
                focus = document.getElementById('focusInput').value.trim();
                if (!focus) {
                    alert('Veuillez specifier un sujet de focus');
                    return;
                }
            }

            if (window.pdfCompanionCallback) {
                window.pdfCompanionCallback(lectureMode, provider, lecture, replace, focus);
            }
            window.close();
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                startPrisma();
            } else if (e.key === 'Escape') {
                window.close();
            }
        });
    </script>
</body>
</html>`;

        try {
            let win = Services.ww.openWindow(
                null,
                "about:blank",
                "_blank",
                "chrome,centerscreen,resizable=yes,width=480,height=680",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = "Synthese PRISMA";

                win.pdfCompanionCallback = async (lectureMode, provider, lecture, replace, focus) => {
                    self.log("PRISMA dialog: mode=" + lectureMode + ", provider=" + provider +
                            ", lecture=" + lecture + ", replace=" + replace + ", focus=" + focus);
                    await self.runPrismaSynthesisV2(collection, lectureMode, provider, lecture, replace, focus);
                };
            }, { once: true });

            this.log("Opened PRISMA dialog for collection: " + collectionName);
        } catch (e) {
            this.log("openPrismaDialog error: " + e);
            this.showNotification("Erreur", "Impossible d'ouvrir le dialog: " + e.message);
        }
    },

    async runPrismaSynthesisV2(collection, lectureMode, provider, lecture, replace, focus) {
        let toast = this.Toast.progress("PRISMA - " + collection.name.substring(0, 25));
        toast.update("Demarrage...");

        let self = this;
        let finalFilename = null;

        try {
            // Build URL with parameters
            let url = this.config.paperReaderUrl + "/synthesize/collection/" +
                encodeURIComponent(collection.key) + "/stream-v2?" +
                "lecture_mode=" + encodeURIComponent(lectureMode) +
                "&lecture=" + (lecture ? "true" : "false");

            if (provider) {
                url += "&provider=" + encodeURIComponent(provider);
            }
            if (replace) {
                url += "&replace=" + (replace ? "true" : "false");
            }

            // Prepare body with focus
            let requestBody = null;
            if (focus) {
                requestBody = JSON.stringify({ focus: focus });
            }

            this.log("GET stream-v2: " + url + (requestBody ? " with body: " + requestBody : ""));

            await new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                xhr.open("GET", url, true);
                xhr.timeout = 600000; // 10 minutes
                if (requestBody) {
                    xhr.setRequestHeader("Content-Type", "application/json");
                }

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(xhr.responseText);
                    } else {
                        reject(new Error("HTTP " + xhr.status + ": " + xhr.responseText));
                    }
                };

                xhr.onerror = () => reject(new Error("Network error"));
                xhr.ontimeout = () => reject(new Error("Timeout"));

                let buffer = "";
                xhr.onprogress = () => {
                    buffer += xhr.responseText.substring(buffer.length);
                    let lines = buffer.split("\n");

                    for (let i = 0; i < lines.length - 1; i++) {
                        let line = lines[i].trim();
                        if (line.startsWith("data: ")) {
                            try {
                                let data = JSON.parse(line.substring(6));
                                self.log("PRISMA-v2 SSE: " + data.stage + " - " + data.message);

                                if (data.stage === "error") {
                                    toast.error(data.message);
                                    reject(new Error(data.message));
                                    return;
                                } else if (data.stage === "complete") {
                                    finalFilename = data.filename || null;
                                    toast.success("Generation terminee!");
                                } else {
                                    toast.update(data.message);
                                }
                            } catch (parseErr) {
                                self.log("SSE parse error: " + parseErr);
                            }
                        }
                    }
                };

                xhr.send(requestBody);
            });

            if (finalFilename) {
                this.showNotification("PRISMA genere",
                    "Document: " + finalFilename + "\nAttache a la collection");
            } else {
                toast.success("Synthese PRISMA terminee");
            }

        } catch (e) {
            toast.close();
            this.log("runPrismaSynthesisV2 error: " + e);

            let errMsg = e.message || "Connexion echouee";
            if (errMsg.includes("No fiches") || errMsg.includes("fiches found") || errMsg.includes("No analyzed")) {
                this.showNotification("Pas de fiches",
                    "Activez 'Analyser les articles' ou utilisez d'abord 'Lire l'article' sur les items.");
            } else {
                this.showNotification("Erreur PRISMA", errMsg.substring(0, 100));
            }
        }
    },

    showWordExportResult(collectionName, result) {
        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Export Word - ${this.escapeHtml(collectionName)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: white;
            border-radius: 16px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
        }
        .icon {
            font-size: 4em;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            font-size: 1.5em;
            margin-bottom: 10px;
        }
        .collection-name {
            color: #667eea;
            font-size: 1.1em;
            margin-bottom: 25px;
        }
        .stats {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-bottom: 30px;
        }
        .stat {
            text-align: center;
        }
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            color: #667eea;
        }
        .stat-label {
            font-size: 0.85em;
            color: #666;
        }
        .download-btn {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 40px;
            border-radius: 30px;
            text-decoration: none;
            font-weight: 600;
            font-size: 1.1em;
            transition: transform 0.2s, box-shadow 0.2s;
            margin-bottom: 15px;
        }
        .download-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
        }
        .filename {
            font-family: monospace;
            font-size: 0.85em;
            color: #888;
            word-break: break-all;
        }
        .meta {
            margin-top: 25px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            font-size: 0.8em;
            color: #999;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">📄</div>
        <h1>Document Word genere!</h1>
        <div class="collection-name">${this.escapeHtml(collectionName)}</div>

        <div class="stats">
            <div class="stat">
                <div class="stat-value">${result.articles_included || 0}</div>
                <div class="stat-label">Articles</div>
            </div>
            <div class="stat">
                <div class="stat-value">${result.topics_found || 0}</div>
                <div class="stat-label">Themes</div>
            </div>
            <div class="stat">
                <div class="stat-value">${result.file_size_mb || '?'}</div>
                <div class="stat-label">MB</div>
            </div>
        </div>

        <a href="${this.escapeHtml(result.dropbox_url)}" class="download-btn" target="_blank">
            Telecharger le document
        </a>

        <div class="filename">${this.escapeHtml(result.filename || 'synthesis.docx')}</div>

        <div class="meta">
            Genere en ${result.processing_time_seconds || '?'}s
        </div>
    </div>
</body>
</html>`;

        try {
            let win = Services.ww.openWindow(
                null,
                "about:blank",
                "_blank",
                "chrome,centerscreen,resizable=yes,scrollbars=yes,width=550,height=550",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = "Export Word - " + collectionName.substring(0, 30);
            }, { once: true });

            this.log("Opened Word export result window");
        } catch (e) {
            this.log("showWordExportResult error: " + e);
            // Fallback: open URL directly
            Zotero.launchURL(result.dropbox_url);
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
            this.showNotification("PDF Companion", "Aucun item selectionne");
            return;
        }

        let item = items[0];
        if (item.isAttachment() || item.isNote()) {
            this.showNotification("PDF Companion", "Selectionnez un article, pas un attachement");
            return;
        }

        let title = item.getField("title") || "Unknown";
        let authors = item.getCreators().map(c => (c.firstName || "") + " " + (c.lastName || c.name || "")).join(", ");
        let year = item.getField("year") || "";

        let toast = this.Toast.progress("Lectures - " + title.substring(0, 25));
        toast.update("Recherche des fiches...");

        try {
            // 1. Get children via API
            let url = this.config.apiUrl + "/item/" + item.key + "/children";
            let response = await Zotero.HTTP.request("GET", url, { timeout: 15000 });
            let children = JSON.parse(response.responseText);

            // 2. Filter for Paper-Reader JSON fiches
            let fiches = children.children.filter(c => {
                let t = (c.data.title || "").toLowerCase();
                let ct = (c.data.contentType || "");
                let u = (c.data.url || "");
                return (t.includes("paper-reader") || t.includes("analyse")) &&
                       (ct === "application/json" || u.endsWith(".json"));
            });

            if (fiches.length === 0) {
                toast.error("Aucune fiche trouvee - Utilisez 'Lire l'article' pour en creer une.");
                return;
            }

            // 3. Download all JSONs
            toast.update("Telechargement de " + fiches.length + " fiche(s)...");
            let ficheData = [];
            for (let fiche of fiches) {
                try {
                    let dropboxUrl = fiche.data.url.replace("dl=0", "dl=1");
                    if (!dropboxUrl.includes("dl=1")) {
                        dropboxUrl += (dropboxUrl.includes("?") ? "&" : "?") + "dl=1";
                    }
                    let contentResponse = await Zotero.HTTP.request("GET", dropboxUrl, {
                        timeout: 30000, responseType: "text"
                    });
                    let json = JSON.parse(contentResponse.responseText);
                    let mode = json.lecture_mode || "standard";
                    let dateStr = fiche.data.dateAdded ? new Date(fiche.data.dateAdded).toLocaleDateString('fr-FR') : '';
                    ficheData.push({
                        id: json.id || fiche.data.title,
                        mode: mode,
                        date: dateStr,
                        data: json
                    });
                } catch (e) {
                    this.log("Failed to download fiche: " + e);
                }
            }

            toast.close();

            if (ficheData.length === 0) {
                this.showNotification("Erreur", "Impossible de telecharger les fiches");
                return;
            }

            // Sort by date (most recent first)
            ficheData.sort((a, b) => new Date(b.date) - new Date(a.date));

            // 4. If single fiche, display directly
            if (ficheData.length === 1) {
                this.displayFicheJson(title, authors, year, item.key, ficheData[0].data);
                return;
            }

            // 5. Multiple fiches: show selection list window
            let self = this;
            let entriesHtml = ficheData.map((f, idx) => {
                let modeLabel = { standard: "Standard", full: "Complete", section: "Par section" }[f.mode] || f.mode;
                return '<div class="entry" data-index="' + idx + '">' +
                    '<span class="entry-mode">' + this.escapeHtml(modeLabel) + '</span>' +
                    '<span class="entry-id">' + this.escapeHtml(f.id.substring(0, 40)) + '</span>' +
                    '<span class="entry-date">' + this.escapeHtml(f.date) + '</span>' +
                    '</div>';
            }).join('');

            let listHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
                '<title>Fiches de lecture</title>' +
                '<style>' +
                '* { box-sizing: border-box; }' +
                'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; background: #f8f9fa; color: #333; }' +
                'h2 { color: #667eea; margin: 0 0 5px 0; font-size: 1.1em; }' +
                '.subtitle { color: #666; font-size: 0.85em; margin-bottom: 15px; }' +
                '.entry { background: white; padding: 14px 18px; margin-bottom: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); border-left: 3px solid #667eea; }' +
                '.entry:hover { background: #f0f0ff; }' +
                '.entry-mode { background: #667eea; color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.75em; text-transform: uppercase; }' +
                '.entry-id { flex: 1; font-family: monospace; font-size: 0.85em; color: #555; }' +
                '.entry-date { color: #888; font-size: 0.85em; white-space: nowrap; }' +
                '</style></head><body>' +
                '<h2>' + this.escapeHtml(title.substring(0, 60)) + '</h2>' +
                '<div class="subtitle">' + fiches.length + ' fiche(s) disponible(s)</div>' +
                entriesHtml +
                '</body></html>';

            let win = Services.ww.openWindow(
                null, "about:blank", "_blank",
                "chrome,centerscreen,resizable=yes,scrollbars=yes,width=700,height=400",
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
                        win.close();
                        self.displayFicheJson(title, authors, year, item.key, ficheData[idx].data);
                    });
                }
            }, { once: true });

        } catch (e) {
            this.log("showReadingCards error: " + e);
            toast.error("Erreur: " + (e.message || "Connexion echouee"));
        }
    },

    // Display a Paper-Reader JSON fiche in a formatted window
    displayFicheJson(title, authors, year, itemKey, fiche) {
        let synthesis = fiche.synthesis || {};

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Fiche - ${this.escapeHtml(title)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f8f9fa;
            color: #333;
            line-height: 1.7;
            padding: 30px;
        }
        .container { max-width: 900px; margin: 0 auto; }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px 30px;
            border-radius: 12px;
            margin-bottom: 25px;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
        }
        .header h1 { font-size: 1.4em; font-weight: 600; margin-bottom: 12px; }
        .meta { font-size: 0.85em; opacity: 0.9; }
        .meta span { margin-right: 15px; }
        .badge {
            display: inline-block;
            background: rgba(255,255,255,0.2);
            padding: 3px 10px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 0.8em;
        }
        .section {
            background: white;
            padding: 25px 30px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .section h2 {
            color: #667eea;
            font-size: 1.1em;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #eef;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .section h2 .icon { font-size: 1.2em; }
        .section p { margin-bottom: 12px; text-align: justify; }
        .insights {
            background: #fafbfc;
            border-left: 4px solid #667eea;
            padding: 20px;
            border-radius: 0 10px 10px 0;
        }
        .insight {
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid #eee;
        }
        .insight:last-child { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
        .insight-topic {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.75em;
            text-transform: uppercase;
            margin-bottom: 8px;
        }
        .insight-text { font-size: 0.95em; }
        .quote {
            background: #f5f5ff;
            border-left: 3px solid #764ba2;
            padding: 10px 15px;
            margin-top: 10px;
            font-style: italic;
            font-size: 0.85em;
            color: #555;
        }
        .no-content {
            text-align: center;
            padding: 40px;
            color: #888;
        }
        @media print {
            body { background: white; padding: 20px; }
            .section { box-shadow: none; border: 1px solid #ddd; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${this.escapeHtml(title)}</h1>
            <div class="meta">
                <span><strong>Auteurs:</strong> ${this.escapeHtml(authors || 'N/A')}</span>
                ${year ? `<span><strong>Annee:</strong> ${year}</span>` : ''}
                <span class="badge">ID: ${itemKey}</span>
                <span class="badge">${fiche.lecture_mode || 'standard'}</span>
            </div>
        </div>`;

        // Objective section
        if (synthesis.objective_synthesis) {
            html += `
        <div class="section">
            <h2><span class="icon">🎯</span> Objectif</h2>
            <p>${this.escapeHtml(synthesis.objective_synthesis)}</p>
        </div>`;
        }

        // Methodology section
        if (synthesis.methodology_synthesis) {
            html += `
        <div class="section">
            <h2><span class="icon">🔬</span> Methodologie</h2>
            <p>${this.escapeHtml(synthesis.methodology_synthesis)}</p>
        </div>`;
        }

        // Results section
        if (synthesis.results_synthesis) {
            html += `
        <div class="section">
            <h2><span class="icon">📊</span> Resultats</h2>
            <p>${this.escapeHtml(synthesis.results_synthesis)}</p>
        </div>`;
        }

        // Discussion section
        if (synthesis.discussion_synthesis) {
            html += `
        <div class="section">
            <h2><span class="icon">💬</span> Discussion</h2>
            <p>${this.escapeHtml(synthesis.discussion_synthesis)}</p>
        </div>`;
        }

        // Key insights
        if (synthesis.key_insights && synthesis.key_insights.length > 0) {
            html += `
        <div class="section">
            <h2><span class="icon">💡</span> Points cles (${synthesis.key_insights.length})</h2>
            <div class="insights">`;

            for (let insight of synthesis.key_insights) {
                html += `
                <div class="insight">
                    <span class="insight-topic">${this.escapeHtml(insight.topic || 'insight')}</span>
                    <div class="insight-text">${this.escapeHtml(insight.synthesis || '')}</div>
                    ${insight.source_quote ? `<div class="quote">"${this.escapeHtml(insight.source_quote.substring(0, 300))}${insight.source_quote.length > 300 ? '...' : ''}"</div>` : ''}
                </div>`;
            }

            html += `
            </div>
        </div>`;
        }

        // Check if no content at all
        if (!synthesis.objective_synthesis && !synthesis.methodology_synthesis &&
            !synthesis.results_synthesis && !synthesis.discussion_synthesis &&
            (!synthesis.key_insights || synthesis.key_insights.length === 0)) {
            html += `<div class="no-content">Fiche vide ou format non reconnu.</div>`;
        }

        html += `
    </div>
</body>
</html>`;

        // Open window
        try {
            let win = Services.ww.openWindow(
                null,
                "about:blank",
                "_blank",
                "chrome,centerscreen,resizable=yes,scrollbars=yes,width=950,height=800",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = "Fiche - " + title.substring(0, 40);
            }, { once: true });

            this.log("Opened fiche JSON window for: " + itemKey);
        } catch (e) {
            this.log("displayFicheJson error: " + e);
            this.showNotification("Erreur", "Impossible d'afficher la fiche");
        }
    },

    // === FIGURES EXTRACTION & DISPLAY ===
    async extractFiguresForSelected() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "Aucun item selectionne");
            return;
        }
        let item = items[0];
        if (item.isAttachment() || item.isNote()) {
            this.showNotification("PDF Companion", "Selectionnez un article, pas un attachement");
            return;
        }
        await this.extractFigures(item);
    },

    async extractFigures(item) {
        let title = item.getField("title") || "Unknown";
        let toast = this.Toast.progress("Extraction figures - " + title.substring(0, 25));
        toast.update("Demarrage extraction...");

        try {
            let result = await this.extractFiguresSSE(item, toast);
            if (!result) {
                toast.error("Timeout - extraction trop longue");
                return;
            }

            // Handle result
            if (result.status === "success" || result.status === "partial") {
                let count = result.figures_extracted || 0;
                let summary = count + " figure(s) extraite(s)";
                if (result.note_key) summary += "\nNote creee";
                if (result.attachment_keys && result.attachment_keys.length > 0) {
                    summary += "\n" + result.attachment_keys.length + " attachments";
                }
                toast.success(summary);
                this.log("Figures extracted: " + JSON.stringify(result));
                try { Zotero.Sync.Runner.sync(); } catch (e) {}
            } else {
                let errMsg = (result.errors && result.errors.length > 0) ? result.errors[0] : "Echec extraction";
                toast.error(errMsg);
            }
        } catch (e) {
            toast.error("Erreur: " + (e.message || "Connexion echouee"));
            this.log("extractFigures error: " + e);
        }
    },

    // Extract figures using SSE (Server-Sent Events) via XMLHttpRequest
    async extractFiguresSSE(item, toast) {
        let baseUrl = this.config.paperReaderUrl + "/extract-figures/" + encodeURIComponent(item.key) + "/stream";
        this.log("Starting SSE extraction: " + baseUrl);

        // Map of stage keys to emoji
        const stageEmoji = {
            "pdf_fetch": "📥",
            "extraction": "⚙️",
            "download": "🖼️",
            "upload_dropbox": "☁️",
            "tagging": "🏷️",
            "complete": "✅",
            "error": "❌"
        };

        return new Promise((resolve, reject) => {
            try {
                let xhr = new XMLHttpRequest();
                let lastProcessedIndex = 0;
                let resolved = false;
                let timeout = setTimeout(() => {
                    xhr.abort();
                    if (!resolved) {
                        resolved = true;
                        reject(new Error("SSE timeout"));
                    }
                }, 240000); // 4 minute timeout

                xhr.onprogress = () => {
                    try {
                        // Get all text received so far
                        let text = xhr.responseText;

                        // Log first chunk
                        if (lastProcessedIndex === 0 && text.length > 0) {
                            let preview = text.substring(0, 200).replace(/\n/g, ' ');
                            this.log("SSE first data: " + preview);
                        }

                        // Split by newlines and process new lines
                        let lines = text.split('\n');

                        // Process only new lines
                        for (let i = lastProcessedIndex; i < lines.length; i++) {
                            let line = lines[i].trim();

                            if (line.startsWith('data: ')) {
                                let jsonStr = line.substring(6); // Remove 'data: ' prefix
                                try {
                                    let data = JSON.parse(jsonStr);
                                    this.log("SSE event: " + JSON.stringify(data));

                                    // Update toast based on stage
                                    if (data.stage && toast) {
                                        let emoji = stageEmoji[data.stage] || "•";
                                        let msg = emoji + " " + (data.status || data.stage);
                                        if (data.progress !== undefined) {
                                            msg += " (" + Math.round(data.progress) + "%)";
                                        }
                                        toast.update(msg);
                                    }

                                    // Check if complete
                                    if (data.stage === "complete") {
                                        clearTimeout(timeout);
                                        if (!resolved) {
                                            resolved = true;
                                            resolve(data);
                                        }
                                        xhr.abort();
                                        return;
                                    }
                                } catch (parseErr) {
                                    this.log("SSE parse error: " + parseErr + " (line: " + line + ")");
                                }
                            }
                        }
                        lastProcessedIndex = lines.length;
                    } catch (e) {
                        this.log("SSE onprogress error: " + e);
                    }
                };

                xhr.onload = () => {
                    clearTimeout(timeout);
                    this.log("SSE onload - status: " + xhr.status + ", length: " + xhr.responseText.length);

                    // If we got here without a "complete" event, parse final response
                    if (xhr.responseText && xhr.responseText.length > 0) {
                        let lines = xhr.responseText.split('\n');
                        for (let i = 0; i < lines.length; i++) {
                            let line = lines[i].trim();
                            if (line.startsWith('data: ')) {
                                try {
                                    let data = JSON.parse(line.substring(6));
                                    if (data.stage === "complete") {
                                        this.log("SSE final result: " + JSON.stringify(data));
                                        resolve(data);
                                        return;
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                    this.log("SSE connection closed without complete event");
                };

                xhr.onerror = () => {
                    clearTimeout(timeout);
                    if (!resolved) {
                        resolved = true;
                        this.log("SSE connection error");
                        reject(new Error("SSE connection error"));
                    }
                };

                xhr.onabort = () => {
                    clearTimeout(timeout);
                    if (!resolved) {
                        resolved = true;
                        this.log("SSE connection aborted");
                        reject(new Error("SSE aborted"));
                    }
                };

                this.log("Opening SSE connection...");
                xhr.open('POST', baseUrl, true);
                xhr.setRequestHeader('Accept', 'text/event-stream');
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify({}));

            } catch (e) {
                this.log("SSE setup error: " + e);
                reject(e);
            }
        });
    },

    async extractFiguresCollection() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Selectionnez une collection");
            return;
        }

        let toast = this.Toast.progress("Figures - " + collection.name.substring(0, 25));
        toast.update("Analyse de la collection...");

        try {
            // Get all items in collection
            let childItems = collection.getChildItems();
            let articles = childItems.filter(item => {
                let itemType = item.itemType;
                return ["journalArticle", "conferencePaper", "preprint", "report", "thesis", "book", "bookSection"].includes(itemType);
            });

            if (articles.length === 0) {
                toast.error("Aucun article dans la collection");
                return;
            }

            this.log("Collection " + collection.name + ": " + articles.length + " articles");
            toast.update("Verification tags: 0/" + articles.length);

            // Check which articles need figure extraction (no #figures tag)
            let toExtract = [];
            for (let i = 0; i < articles.length; i++) {
                let item = articles[i];
                let tags = item.getTags();
                let hasFiguresTag = tags.some(t => t.tag === "#figures");

                if (!hasFiguresTag) {
                    // Also check if item has PDF attachment
                    let attachments = item.getAttachments();
                    let hasPdf = false;
                    for (let attId of attachments) {
                        let att = Zotero.Items.get(attId);
                        if (att && att.attachmentContentType === "application/pdf") {
                            hasPdf = true;
                            break;
                        }
                    }
                    if (hasPdf) {
                        toExtract.push(item);
                    }
                }

                if ((i + 1) % 10 === 0) {
                    toast.update("Verification tags: " + (i + 1) + "/" + articles.length);
                }
            }

            this.log("Articles to extract: " + toExtract.length + "/" + articles.length);

            if (toExtract.length === 0) {
                toast.success("Tous les articles ont deja leurs figures extraites");
                return;
            }

            // Confirm extraction
            let ps = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                .getService(Components.interfaces.nsIPromptService);
            let proceed = ps.confirm(
                Zotero.getMainWindow(),
                "Extraction figures",
                toExtract.length + " article(s) sans figures detecte(s).\n\nLancer l'extraction? (peut prendre plusieurs minutes)"
            );

            if (!proceed) {
                toast.close();
                return;
            }

            // Extract figures for each article
            let stats = { success: 0, failed: 0, totalFigures: 0 };

            for (let i = 0; i < toExtract.length; i++) {
                let item = toExtract[i];
                let title = (item.getField("title") || "Unknown").substring(0, 30);
                toast.update("Article " + (i + 1) + "/" + toExtract.length + ": " + title);

                try {
                    let result = await this.extractFiguresForItem(item);
                    if (result && result.status === "success") {
                        stats.success++;
                        stats.totalFigures += result.figures_extracted || 0;
                        toast.update("Article " + (i + 1) + "/" + toExtract.length + ": " + (result.figures_extracted || 0) + " figures");
                    } else {
                        stats.failed++;
                    }
                } catch (err) {
                    this.log("Extract error for " + item.key + ": " + err);
                    stats.failed++;
                }

                // Small delay between extractions
                await new Promise(r => setTimeout(r, 500));
            }

            // Final summary
            let summary = stats.success + "/" + toExtract.length + " articles traites\n" +
                stats.totalFigures + " figures extraites";
            if (stats.failed > 0) {
                summary += "\n" + stats.failed + " echec(s)";
            }
            toast.success(summary);
            this.log("Collection figures extraction complete: " + JSON.stringify(stats));

            // Sync
            try { Zotero.Sync.Runner.sync(); } catch (e) {}

        } catch (e) {
            toast.error("Erreur: " + (e.message || "Erreur inconnue"));
            this.log("extractFiguresCollection error: " + e);
        }
    },

    // Helper: extract figures for single item using SSE (returns result)
    async extractFiguresForItem(item) {
        try {
            return await this.extractFiguresSSE(item);
        } catch (e) {
            this.log("extractFiguresForItem error: " + e);
            return { status: "error", message: e.message || "Extraction failed" };
        }
    },

    async showFigures() {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) {
            this.showNotification("PDF Companion", "Aucun item selectionne");
            return;
        }

        let item = items[0];
        if (item.isAttachment() || item.isNote()) {
            this.showNotification("PDF Companion", "Selectionnez un article, pas un attachement");
            return;
        }

        let title = item.getField("title") || "Unknown";
        let toast = this.Toast.progress("Figures - " + title.substring(0, 25));
        toast.update("Recherche des figures...");

        try {
            // Get children via API
            let url = this.config.apiUrl + "/item/" + item.key + "/children";
            let response = await Zotero.HTTP.request("GET", url, { timeout: 15000 });
            let children = JSON.parse(response.responseText);

            // Filter for figures metadata JSON
            let figuresAtt = children.children.filter(c => {
                let t = (c.data.title || "").toLowerCase();
                return t.includes("figures extraites") || t.includes("figures_metadata");
            });

            if (figuresAtt.length === 0) {
                toast.error("Aucune figure - Utilisez 'Extraire les figures' d'abord.");
                return;
            }

            // Download the most recent figures metadata
            toast.update("Telechargement des metadonnees...");
            let att = figuresAtt[figuresAtt.length - 1]; // most recent
            let dropboxUrl = att.data.url.replace("dl=0", "dl=1");

            let contentResponse = await Zotero.HTTP.request("GET", dropboxUrl, {
                timeout: 30000, responseType: "text"
            });
            let figuresData = JSON.parse(contentResponse.responseText);
            toast.close();

            // Handle both array format and object with figures key
            let figures = Array.isArray(figuresData) ? figuresData : (figuresData.figures || []);

            if (figures.length === 0) {
                this.showNotification("Aucune figure", "Pas de figures dans ce fichier.");
                return;
            }

            // Display figures gallery
            this.displayFiguresGallery(title, item.key, figures);

        } catch (e) {
            toast.close();
            this.log("showFigures error: " + e);
            this.showNotification("Erreur", e.message || "Connexion echouee");
        }
    },

    displayFiguresGallery(title, itemKey, figures) {
        // figures is now directly an array
        let count = figures.length;

        let figuresHtml = figures.map((fig, idx) => {
            let thumbUrl = (fig.thumb_url || fig.native_url || "").replace("dl=0", "dl=1");
            let nativeUrl = (fig.native_url || "").replace("dl=0", "dl=1");
            let caption = fig.caption || "";
            let label = fig.original_label || fig.label || fig.figure_id || ("Figure " + (idx + 1));
            let page = fig.page ? "Page " + fig.page : "";

            return `
            <div class="figure-card">
                <div class="figure-img-container" onclick="openFull('${this.escapeHtml(nativeUrl)}')">
                    <img src="${this.escapeHtml(thumbUrl)}" alt="${this.escapeHtml(label)}" loading="lazy">
                </div>
                <div class="figure-info">
                    <div class="figure-header">
                        <div class="figure-label">${this.escapeHtml(label)}</div>
                        <button class="copy-btn" onclick="copyUrl('${this.escapeHtml(nativeUrl)}', this)" title="Copier l'URL">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                    ${page ? `<div class="figure-page">${page}</div>` : ''}
                    ${caption ? `<div class="figure-caption">${this.escapeHtml(caption.substring(0, 150))}${caption.length > 150 ? '...' : ''}</div>` : ''}
                </div>
            </div>`;
        }).join('');

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Figures - ${this.escapeHtml(title)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1a1a2e;
            color: #eee;
            padding: 20px;
            min-height: 100vh;
        }
        .header {
            background: linear-gradient(135deg, #16213e 0%, #1a1a2e 100%);
            padding: 20px 25px;
            border-radius: 12px;
            margin-bottom: 25px;
            border: 1px solid #0f3460;
        }
        .header h1 { font-size: 1.2em; font-weight: 600; margin-bottom: 8px; color: #e94560; }
        .header .meta { font-size: 0.85em; color: #888; }
        .header .badge {
            display: inline-block;
            background: #0f3460;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 0.8em;
            margin-right: 10px;
        }
        .gallery {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 20px;
        }
        .figure-card {
            background: #16213e;
            border-radius: 10px;
            overflow: hidden;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            border: 1px solid #0f3460;
        }
        .figure-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 8px 25px rgba(233, 69, 96, 0.2);
        }
        .figure-img-container {
            width: 100%;
            height: 200px;
            overflow: hidden;
            background: #0f0f1a;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .figure-img-container img {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        }
        .figure-info {
            padding: 15px;
        }
        .figure-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
        }
        .figure-label {
            font-weight: 600;
            color: #e94560;
        }
        .copy-btn {
            background: #0f3460;
            border: none;
            color: #aaa;
            padding: 6px 8px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .copy-btn:hover {
            background: #e94560;
            color: white;
        }
        .copy-btn.copied {
            background: #28a745;
            color: white;
        }
        .figure-page {
            font-size: 0.8em;
            color: #666;
            margin-bottom: 8px;
        }
        .figure-caption {
            font-size: 0.85em;
            color: #aaa;
            line-height: 1.4;
        }
        .no-figures {
            text-align: center;
            padding: 60px;
            color: #666;
        }
        /* Modal for full-size image */
        .modal {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.95);
            z-index: 1000;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .modal.active { display: flex; }
        .modal img {
            max-width: 95%;
            max-height: 95%;
            object-fit: contain;
            border-radius: 8px;
        }
        .modal-close {
            position: absolute;
            top: 20px;
            right: 30px;
            font-size: 2em;
            color: white;
            cursor: pointer;
            z-index: 1001;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${this.escapeHtml(title.substring(0, 80))}</h1>
        <div class="meta">
            <span class="badge">${count} figure(s)</span>
            <span class="badge">ID: ${itemKey}</span>
        </div>
    </div>

    <div class="gallery">
        ${figuresHtml || '<div class="no-figures">Aucune figure disponible</div>'}
    </div>

    <div class="modal" id="modal" onclick="closeModal()">
        <span class="modal-close">&times;</span>
        <img id="modalImg" src="" alt="Full size">
    </div>

    <script>
        function openFull(url) {
            if (!url) return;
            document.getElementById('modalImg').src = url;
            document.getElementById('modal').classList.add('active');
        }
        function closeModal() {
            document.getElementById('modal').classList.remove('active');
            document.getElementById('modalImg').src = '';
        }
        function copyUrl(url, btn) {
            event.stopPropagation();
            navigator.clipboard.writeText(url).then(() => {
                btn.classList.add('copied');
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                }, 2000);
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });
    </script>
</body>
</html>`;

        try {
            let win = Services.ww.openWindow(
                null,
                "about:blank",
                "_blank",
                "chrome,centerscreen,resizable=yes,scrollbars=yes,width=1100,height=800",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = "Figures - " + title.substring(0, 40);
            }, { once: true });

            this.log("Opened figures gallery for: " + itemKey);
        } catch (e) {
            this.log("displayFiguresGallery error: " + e);
            this.showNotification("Erreur", "Impossible d'afficher les figures");
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

    // === BIBLIOGRAPHIC SYNTHESIS (Paper-Reader) ===
    async openSynthesisDialog() {
        // DEPRECATED: Redirect to unified dialog
        this.log("openSynthesisDialog is deprecated, using openUnifiedSynthesisDialog");
        return this.openUnifiedSynthesisDialog();

        // Old code below is no longer used (for reference only)
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Selectionnez une collection");
            return;
        }

        let collectionName = collection.name;
        let collectionKey = collection.key;
        let self = this;

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Synthese Bibliographique</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1e1e1e;
            color: #e0e0e0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: linear-gradient(135deg, #2d5a27 0%, #4a7c43 100%);
            color: white;
            padding: 18px 22px;
            flex-shrink: 0;
        }
        .header h1 {
            font-size: 1.2em;
            font-weight: 600;
            margin-bottom: 6px;
        }
        .header .subtitle {
            font-size: 0.85em;
            opacity: 0.9;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .form-container {
            padding: 18px 22px;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 16px;
            overflow-y: auto;
        }
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .form-group > label {
            font-weight: 600;
            font-size: 0.9em;
            color: #b0b0b0;
            margin-bottom: 4px;
        }
        .radio-group {
            background: #2a2a2a;
            border-radius: 6px;
            padding: 8px 12px;
        }
        .radio-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 4px;
            cursor: pointer;
            border-radius: 4px;
        }
        .radio-item:hover {
            background: #353535;
        }
        .radio-item input[type="radio"] {
            width: 16px;
            height: 16px;
            accent-color: #4a7c43;
            cursor: pointer;
        }
        .radio-item label {
            cursor: pointer;
            font-size: 0.9em;
            color: #e0e0e0;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: #2a2a2a;
            border-radius: 6px;
            cursor: pointer;
        }
        .checkbox-group:hover {
            background: #353535;
        }
        .checkbox-group input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: #4a7c43;
            cursor: pointer;
        }
        .checkbox-label {
            font-size: 0.9em;
            color: #e0e0e0;
        }
        .button-row {
            display: flex;
            gap: 10px;
            padding: 16px 22px;
            background: #252525;
            border-top: 1px solid #333;
            flex-shrink: 0;
        }
        .btn {
            flex: 1;
            padding: 12px 16px;
            border: none;
            border-radius: 6px;
            font-size: 0.95em;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary {
            background: linear-gradient(135deg, #2d5a27 0%, #4a7c43 100%);
            color: white;
        }
        .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(74, 124, 67, 0.4);
        }
        .btn-secondary {
            background: #3c3c3c;
            color: #e0e0e0;
            border: 1px solid #555;
        }
        .btn-secondary:hover {
            background: #4a4a4a;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Synthese Bibliographique</h1>
        <div class="subtitle" title="${this.escapeHtml(collectionName)}">${this.escapeHtml(collectionName.length > 45 ? collectionName.substring(0, 45) + "..." : collectionName)}</div>
    </div>
    <div class="form-container">
        <div class="form-group">
            <label>Niveau de synthese</label>
            <div class="radio-group">
                <div class="radio-item">
                    <input type="radio" name="level" id="levelCompact" value="compact">
                    <label for="levelCompact">Compact - Resume concis</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="level" id="levelMoyen" value="moyen" checked>
                    <label for="levelMoyen">Moyen - Synthese equilibree</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="level" id="levelComplet" value="complet">
                    <label for="levelComplet">Complet - Analyse detaillee</label>
                </div>
            </div>
        </div>
        <div class="form-group">
            <label>Modele LLM</label>
            <div class="radio-group">
                <div class="radio-item">
                    <input type="radio" name="provider" id="providerClaude" value="claude_cli" checked>
                    <label for="providerClaude">Claude (CLI) - Recommande</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="provider" id="providerSambanova" value="sambanova">
                    <label for="providerSambanova">SambaNova - Rapide</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="provider" id="providerGroq" value="groq">
                    <label for="providerGroq">Groq - Tres rapide</label>
                </div>
            </div>
        </div>
    </div>
    <div class="button-row">
        <button class="btn btn-secondary" onclick="window.close()">Annuler</button>
        <button class="btn btn-primary" onclick="startSynthesis()">Lancer la synthese</button>
    </div>
    <script>
        function getSelectedRadio(name) {
            var radios = document.getElementsByName(name);
            for (var i = 0; i < radios.length; i++) {
                if (radios[i].checked) return radios[i].value;
            }
            return null;
        }

        function startSynthesis() {
            var level = getSelectedRadio('level') || 'moyen';
            var provider = getSelectedRadio('provider') || 'claude_cli';

            if (window.pdfCompanionCallback) {
                window.pdfCompanionCallback(level, provider);
            }
            window.close();
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                startSynthesis();
            } else if (e.key === 'Escape') {
                window.close();
            }
        });
    </script>
</body>
</html>`;

        try {
            let win = Services.ww.openWindow(
                null,
                "about:blank",
                "_blank",
                "chrome,centerscreen,resizable=yes,width=440,height=520",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = "Synthese Bibliographique";

                win.pdfCompanionCallback = async (level, provider) => {
                    self.log("Synthesis dialog: level=" + level + ", provider=" + provider);
                    await self.runCollectionSynthesis(collection, level, provider);
                };
            }, { once: true });

            this.log("Opened synthesis dialog for collection: " + collectionName);
        } catch (e) {
            this.log("openSynthesisDialog error: " + e);
            this.showNotification("Erreur", "Impossible d'ouvrir le dialog: " + e.message);
        }
    },

    async runCollectionSynthesis(collection, level, provider) {
        let url = this.config.paperReaderUrl + "/synthesize/collection/" +
            encodeURIComponent(collection.key) + "/stream-v2?" +
            "lecture_mode=" + encodeURIComponent(level) +
            "&lecture=true";

        if (provider) {
            url += "&provider=" + encodeURIComponent(provider);
        }

        this.log("SSE Synthesis URL: " + url);

        let self = this;
        let toast = this.Toast.progress("Synthese - " + collection.name.substring(0, 25));
        let finalResult = null;

        await new Promise((resolve, reject) => {
            let xhr = new XMLHttpRequest();
            let lastIndex = 0;

            xhr.open("GET", url, true);
            xhr.setRequestHeader("Accept", "text/event-stream");

            xhr.onprogress = function() {
                let newData = xhr.responseText.substring(lastIndex);
                lastIndex = xhr.responseText.length;
                let lines = newData.split("\n");

                for (let line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        let data = JSON.parse(line.substring(6));
                        let evType = data.event || data.type || data.phase || "unknown";
                        self.log("Synthesis SSE: " + evType);

                        switch (evType) {
                            case "init":
                                if (data.collection_name) {
                                    toast.update("Collection: " + data.collection_name);
                                }
                                break;
                            case "pdf_check":
                                toast.update("Verification: " + data.total_articles + " articles");
                                break;
                            case "article_check":
                            case "article_valid":
                                toast.update("PDF " + data.index + "/" + data.total);
                                break;
                            case "pdf_check_complete":
                                toast.update("PDFs verifies: " + data.valid + " / " + (data.valid + data.skipped));
                                break;
                            case "fiche_generation":
                                toast.update("Generation fiches: " + data.total + " articles");
                                break;
                            case "lecture_check":
                            case "lecture_found":
                                toast.update("Fiche " + data.index + "/" + data.total);
                                break;
                            case "lecture_start":
                            case "lecture_progress":
                                toast.update("Generation fiche...");
                                break;
                            case "lecture_done":
                                toast.update("Fiche generee");
                                break;
                            case "fiche_generation_complete":
                                toast.update("Fiches pretes: " + data.fiches_count);
                                break;
                            case "synthesis":
                                toast.update("Synthese LLM...");
                                break;
                            case "synthesis_start":
                                toast.update("Synthese: " + (data.fiches_count || "?") + " fiches");
                                break;
                            case "synthesis_progress":
                                toast.update("Synthese LLM...");
                                break;
                            case "synthesis_done":
                                toast.update("Synthese terminee");
                                break;
                            case "dropbox_upload":
                                toast.update("Upload Dropbox...");
                                break;
                            case "zotero_attachment":
                                toast.update("Attachment Zotero...");
                                break;
                            case "complete":
                                finalResult = data;
                                break;
                            case "error":
                                toast.error(data.message || data.error || "Erreur");
                                reject(new Error(data.error || data.message));
                                return;
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            };

            xhr.onload = function() {
                self.log("Synthesis completed: " + xhr.status);
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve();
                } else {
                    reject(new Error("HTTP " + xhr.status));
                }
            };

            xhr.onerror = function() {
                self.log("Synthesis XHR error");
                reject(new Error("Connexion echouee"));
            };

            xhr.send();
        }).catch(e => {
            self.log("Synthesis error: " + e);
            toast.error("Erreur: " + (e.message || "Connexion echouee"));
            throw e;
        });

        if (finalResult) {
            let summary = "Synthese terminee!";
            if (finalResult.dropbox_url) {
                summary += "\nDropbox: " + finalResult.dropbox_url;
            }
            if (finalResult.attachment_key) {
                summary += "\nAttache a la collection";
            }
            toast.success(summary);
            this.log("Synthesis complete: " + JSON.stringify(finalResult));
        } else {
            toast.success("Synthese terminee");
            this.log("Synthesis finished (no result data)");
        }
    },

    // === DIALOG PARAMETRES SYNTHESE ===
    async showSynthesisParamsDialog() {
        return new Promise((resolve) => {
            let win = Services.ww.openWindow(
                null, "about:blank", "_blank",
                "chrome,centerscreen,resizable=yes,width=400,height=300",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Paramètres Synthèse</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f0f0f0;
            padding: 15px;
        }
        .container {
            max-width: 420px;
            background: white;
            border-radius: 8px;
            padding: 18px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            max-height: 80vh;
            overflow-y: auto;
        }
        h2 {
            margin: 0 0 18px 0;
            font-size: 1.1em;
            color: #333;
        }
        .form-group {
            margin-bottom: 12px;
        }
        .form-group label {
            display: block;
            font-weight: 500;
            margin-bottom: 4px;
            color: #333;
            font-size: 0.9em;
        }
        .checkbox-label {
            display: flex;
            align-items: center;
            cursor: pointer;
            color: #333;
            font-size: 0.9em;
            font-weight: normal;
        }
        input[type="checkbox"] {
            margin-right: 8px;
            width: 16px;
            height: 16px;
            cursor: pointer;
        }
        input[type="text"] {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 0.9em;
            margin-top: 3px;
        }
        select {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 0.9em;
            margin-top: 3px;
        }
        .buttons {
            display: flex;
            gap: 10px;
            margin-top: 18px;
        }
        button {
            flex: 1;
            padding: 10px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.95em;
            font-weight: 500;
        }
        .btn-ok {
            background: #28a745;
            color: white;
        }
        .btn-cancel {
            background: #ccc;
            color: #333;
        }
        .btn-ok:hover { background: #218838; }
        .btn-cancel:hover { background: #bbb; }
        .section-title {
            font-size: 0.85em;
            font-weight: 600;
            color: #666;
            margin-top: 12px;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h2>Paramètres Synthèse</h2>

        <div class="section-title">Options de traitement</div>
        <div class="form-group">
            <label class="checkbox-label">
                <input type="checkbox" id="lecture" checked>
                Analyser les articles manquants
            </label>
        </div>
        <div class="form-group">
            <label class="checkbox-label">
                <input type="checkbox" id="replace" checked>
                Remplacer les synthèses existantes
            </label>
        </div>

        <div class="section-title">Configuration</div>
        <div class="form-group">
            <label for="mode">Mode de lecture</label>
            <select id="mode">
                <option value="standard" selected>Standard (5-8 keypoints, revue rapide)</option>
                <option value="full">Full (6-10 keypoints, revue détaillée)</option>
                <option value="thesis">Thesis (10-15 keypoints, travail académique)</option>
                <option value="section">Section (analyse par sections du document)</option>
                <option value="prisma">PRISMA (revue systématique)</option>
            </select>
        </div>

        <div class="form-group">
            <label for="level">Niveau de détail</label>
            <select id="level">
                <option value="complet" selected>Complet (exhaustif)</option>
                <option value="moyen">Moyen (équilibré)</option>
                <option value="compact">Compact (essentiel)</option>
            </select>
        </div>

        <div class="form-group">
            <label for="provider">Provider LLM</label>
            <select id="provider">
                <option value="claude_cli" selected>Claude CLI (recommandé)</option>
                <option value="sambanova">SambaNova Cloud</option>
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI GPT-4</option>
            </select>
        </div>

        <div class="form-group">
            <label for="focus">Focus de recherche (optionnel)</label>
            <input type="text" id="focus" placeholder="Ex: mécanismes d'action, effets secondaires...">
        </div>

        <div class="form-group">
            <label for="language">Langue</label>
            <select id="language">
                <option value="fr" selected>Français</option>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="de">Deutsch</option>
            </select>
        </div>

        <div class="buttons">
            <button class="btn-ok" id="btn-ok">OK</button>
            <button class="btn-cancel" id="btn-cancel">Annuler</button>
        </div>
    </div>

    <script>
        let result = null;

        document.getElementById("btn-ok").onclick = () => {
            result = {
                lecture: document.getElementById("lecture").checked,
                replace: document.getElementById("replace").checked,
                lecture_mode: document.getElementById("mode").value,
                level: document.getElementById("level").value,
                provider: document.getElementById("provider").value,
                focus: document.getElementById("focus").value.trim() || null,
                language: document.getElementById("language").value
            };
            window.close();
        };

        document.getElementById("btn-cancel").onclick = () => {
            window.close();
        };

        // Passer le résultat au parent
        window.onunload = () => {
            if (window.opener && window.opener.pendingSynthesisParams) {
                window.opener.pendingSynthesisParams = result;
            }
        };
    </script>
</body>
</html>`);
                win.document.close();
            });

            // Vérifier périodiquement si le dialogue est fermé
            let checkInterval = setInterval(() => {
                if (win.closed) {
                    clearInterval(checkInterval);
                    resolve(this.pendingSynthesisParams);
                    this.pendingSynthesisParams = null;
                }
            }, 100);
        });
    },

    // === SYNTHESIZE COLLECTION V2 (nouvel endpoint) ===
    async synthesizeCollectionV2() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Sélectionnez une collection");
            return;
        }

        // Ouvrir fenêtre de choix des paramètres
        let params = await this.showSynthesisParamsDialog();
        if (!params) {
            return; // Annulé
        }

        let self = this;
        let url = this.config.paperReaderUrl + "/synthesize/collection/" +
                  encodeURIComponent(collection.key) + "/stream-v2?" +
                  "lecture=" + (params.lecture ? "true" : "false") +
                  "&lecture_mode=" + encodeURIComponent(params.lecture_mode) +
                  "&replace=" + (params.replace ? "true" : "false") +
                  "&provider=" + encodeURIComponent(params.provider);

        // Prepare body with optional parameters
        let requestBody = null;
        if (params.focus || params.level !== "complet" || params.language !== "fr") {
            requestBody = JSON.stringify({
                focus: params.focus || undefined,
                level: params.level,
                language: params.language
            });
        }

        this.log("Synthèse v2: " + url + (requestBody ? " with body: " + requestBody : ""));
        let toast = this.Toast.progress("Synthèse - " + collection.name.substring(0, 30));

        await new Promise((resolve, reject) => {
            let xhr = new XMLHttpRequest();
            let lastIndex = 0;

            xhr.open("GET", url, true);
            xhr.setRequestHeader("Accept", "text/event-stream");
            if (requestBody) {
                xhr.setRequestHeader("Content-Type", "application/json");
            }

            xhr.onprogress = function() {
                let newData = xhr.responseText.substring(lastIndex);
                lastIndex = xhr.responseText.length;
                let lines = newData.split("\n");

                for (let line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        let data = JSON.parse(line.substring(6));
                        let phase = data.phase || "unknown";

                        switch (phase) {
                            case "init":
                                toast.update("Initialisation...");
                                break;
                            case "pdf_check":
                                toast.update("Vérification PDFs: " + data.total_articles + " articles");
                                break;
                            case "article_check":
                            case "article_valid":
                                toast.update("PDF " + data.index + "/" + data.total);
                                break;
                            case "pdf_check_complete":
                                toast.update("PDFs: " + data.valid + " valides, " + data.skipped + " skippés");
                                break;
                            case "fiche_check":
                                toast.update("Vérification fiches...");
                                break;
                            case "fiche_generation":
                                toast.update("Analyse articles: " + data.total + " articles");
                                break;
                            case "lecture_start":
                                toast.update("Analyse: " + (data.title || data.zotero_key || ""));
                                break;
                            case "lecture_progress":
                                toast.update("Analyse: " + data.step + "...");
                                break;
                            case "fiche_generation_complete":
                                toast.update("Fiches prêtes: " + data.fiches_count);
                                break;
                            case "synthesis":
                                toast.update("Synthèse LLM...");
                                break;
                            case "storage":
                                toast.update("Stockage...");
                                break;
                            case "complete":
                                toast.success("Synthèse complétée!");
                                self.log("Synthèse v2 complètée: " + JSON.stringify(data).substring(0, 200));
                                break;
                            case "error":
                                toast.error("Erreur: " + (data.error || data.message || "Erreur inconnue"));
                                self.log("Synthèse v2 erreur: " + data.error);
                                break;
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            };

            xhr.onload = function() {
                self.log("Synthèse v2 complètée: status " + xhr.status);
                resolve();
            };

            xhr.onerror = function() {
                self.log("Synthèse v2 erreur connexion");
                toast.error("Erreur de connexion");
                reject(new Error("Connexion échouée"));
            };

            xhr.send(requestBody);
        });
    },

    async openUnifiedSynthesisDialog() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Selectionnez une collection");
            return;
        }

        let collectionName = collection.name;
        let collectionKey = collection.key;
        let self = this;

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Synthese de Collection</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1e1e1e;
            color: #e0e0e0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: linear-gradient(135deg, #2d5a27 0%, #4a7c43 100%);
            color: white;
            padding: 18px 22px;
            flex-shrink: 0;
        }
        .header h1 {
            font-size: 1.2em;
            font-weight: 600;
            margin-bottom: 6px;
        }
        .header .subtitle {
            font-size: 0.85em;
            opacity: 0.9;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .form-container {
            padding: 18px 22px;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 16px;
            overflow-y: auto;
        }
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .form-group > label {
            font-weight: 600;
            font-size: 0.9em;
            color: #b0b0b0;
            margin-bottom: 4px;
        }
        .radio-group {
            background: #2a2a2a;
            border-radius: 6px;
            padding: 8px 12px;
        }
        .radio-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 4px;
            cursor: pointer;
            border-radius: 4px;
        }
        .radio-item:hover {
            background: #353535;
        }
        .radio-item input[type="radio"] {
            width: 16px;
            height: 16px;
            accent-color: #4a7c43;
            cursor: pointer;
        }
        .radio-item label {
            cursor: pointer;
            font-size: 0.9em;
            color: #e0e0e0;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: #2a2a2a;
            border-radius: 6px;
            cursor: pointer;
        }
        .checkbox-group:hover {
            background: #353535;
        }
        .checkbox-group input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: #4a7c43;
            cursor: pointer;
        }
        .checkbox-label {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .checkbox-label span {
            font-weight: 500;
            color: #e0e0e0;
            font-size: 0.95em;
        }
        .checkbox-label small {
            color: #888;
            font-size: 0.8em;
        }
        .text-input {
            width: 100%;
            padding: 12px;
            border: 1px solid #444;
            border-radius: 6px;
            background: #2a2a2a;
            color: #e0e0e0;
            font-size: 0.95em;
            resize: vertical;
            min-height: 80px;
        }
        .text-input:focus {
            outline: none;
            border-color: #4a7c43;
        }
        .text-input::placeholder {
            color: #666;
        }
        select {
            width: 100%;
            padding: 12px;
            border: 1px solid #444;
            border-radius: 6px;
            background: #2a2a2a;
            color: #e0e0e0;
            font-size: 0.95em;
            cursor: pointer;
        }
        select:focus {
            outline: none;
            border-color: #4a7c43;
        }
        select option {
            background: #1e1e1e;
            color: #e0e0e0;
        }
        .hidden {
            display: none;
        }
        .button-row {
            display: flex;
            gap: 10px;
            padding: 16px 22px;
            background: #252525;
            border-top: 1px solid #333;
            flex-shrink: 0;
        }
        .btn {
            flex: 1;
            padding: 12px 16px;
            border: none;
            border-radius: 6px;
            font-size: 0.95em;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary {
            background: linear-gradient(135deg, #2d5a27 0%, #4a7c43 100%);
            color: white;
        }
        .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(74, 124, 67, 0.4);
        }
        .btn-secondary {
            background: #3c3c3c;
            color: #e0e0e0;
            border: 1px solid #555;
        }
        .btn-secondary:hover {
            background: #4a4a4a;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Synthese de Collection</h1>
        <div class="subtitle" title="${this.escapeHtml(collectionName)}">${this.escapeHtml(collectionName.length > 50 ? collectionName.substring(0, 50) + "..." : collectionName)}</div>
    </div>
    <div class="form-container">
        <div class="form-group">
            <label>Mode de lecture</label>
            <select id="lectureMode">
                <option value="standard" selected>Standard - 4-6 keypoints, veille bibliographique rapide</option>
                <option value="full">Full - 6-10 keypoints, revue systématique détaillée</option>
                <option value="section">Section - 4-8 keypoints, analyse par sections GROBID</option>
                <option value="thesis">Thesis - 10-15 keypoints, qualité doctorale pour publication</option>
                <option value="prisma">PRISMA - Format PRISMA pour méta-analyses systématiques</option>
            </select>
        </div>

        <div class="form-group">
            <label>Focus d'analyse (optionnel)</label>
            <textarea class="text-input" id="focusText" placeholder="Ex: mécanismes d'action, effets secondaires, biomarqueurs..."></textarea>
        </div>

        <div class="form-group">
            <label>Modele LLM</label>
            <div class="radio-group">
                <div class="radio-item">
                    <input type="radio" name="llmProvider" id="providerClaude" value="claude_cli" checked>
                    <label for="providerClaude">Claude (CLI)</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="llmProvider" id="providerSambanova" value="sambanova">
                    <label for="providerSambanova">SambaNova</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="llmProvider" id="providerGroq" value="groq">
                    <label for="providerGroq">Groq</label>
                </div>
            </div>
        </div>

        <div class="form-group">
            <label>Options</label>
            <label class="checkbox-group" for="analyzeNoFiche">
                <input type="checkbox" id="analyzeNoFiche" checked>
                <div class="checkbox-label">
                    <span>Analyser articles sans fiche</span>
                    <small>Re-generer les fiches manquantes</small>
                </div>
            </label>
            <label class="checkbox-group" for="replaceExisting">
                <input type="checkbox" id="replaceExisting">
                <div class="checkbox-label">
                    <span>Remplacer syntheses existantes</span>
                    <small>Supprimer et regenerer les syntheses</small>
                </div>
            </label>
        </div>
    </div>
    <div class="button-row">
        <button class="btn btn-secondary" onclick="window.close()">Annuler</button>
        <button class="btn btn-primary" onclick="startSynthesis()">Generer la synthese</button>
    </div>
    <script>
        function getSelectedRadio(name) {
            var radios = document.getElementsByName(name);
            for (var i = 0; i < radios.length; i++) {
                if (radios[i].checked) return radios[i].value;
            }
            return null;
        }

        function startSynthesis() {
            var lectureMode = document.getElementById('lectureMode').value || 'standard';
            var llmProvider = getSelectedRadio('llmProvider') || 'claude_cli';
            var analyzeNoFiche = document.getElementById('analyzeNoFiche').checked;
            var replaceExisting = document.getElementById('replaceExisting').checked;
            var focus = document.getElementById('focusText').value.trim() || null;

            if (window.pdfCompanionCallback) {
                // Pass null as synthesisType (first param) since it's now part of lectureMode
                window.pdfCompanionCallback(null, lectureMode, llmProvider, analyzeNoFiche, replaceExisting, focus);
            }
            window.close();
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.ctrlKey) {
                startSynthesis();
            } else if (e.key === 'Escape') {
                window.close();
            }
        });
    </script>
</body>
</html>`;

        try {
            let win = Services.ww.openWindow(
                null,
                "about:blank",
                "_blank",
                "chrome,centerscreen,resizable=yes,width=500,height=750",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = "Synthese de Collection";

                win.pdfCompanionCallback = async (synthesisType, lectureMode, llmProvider, analyzeNoFiche, replaceExisting, focus) => {
                    self.log("Unified synthesis dialog: mode=" + lectureMode + ", lecture=" + analyzeNoFiche + ", replace=" + replaceExisting + (focus ? ", focus=" + focus : ""));
                    await self.runUnifiedSynthesis(collection, null, lectureMode, llmProvider, analyzeNoFiche, replaceExisting, focus);
                };
            }, { once: true });

            this.log("Opened unified synthesis dialog for collection: " + collectionName);
        } catch (e) {
            this.log("openUnifiedSynthesisDialog error: " + e);
            this.showNotification("Erreur", "Impossible d'ouvrir le dialogue");
        }
    },

    async runUnifiedSynthesis(collection, synthesisType, lectureMode, llmProvider, analyzeNoFiche, replaceExisting, focus) {
        let self = this;
        let collectionName = collection.name;

        // lectureMode now contains the full mode (standard, full, section, thesis, prisma)
        let url = this.config.paperReaderUrl + "/synthesize/collection/" +
                  encodeURIComponent(collection.key) + "/stream-v2?" +
                  "lecture_mode=" + encodeURIComponent(lectureMode) +
                  "&lecture=" + (analyzeNoFiche ? "true" : "false") +
                  "&provider=" + encodeURIComponent(llmProvider) +
                  "&replace=" + (replaceExisting ? "true" : "false");

        // Prepare body for focus parameter (if provided)
        let requestBody = null;
        if (focus) {
            requestBody = JSON.stringify({ focus: focus });
        }

        this.log("Unified synthesis: " + url + (requestBody ? " with body: " + requestBody : ""));
        let modeLabel = lectureMode === "prisma" ? "PRISMA" :
                        lectureMode === "thesis" ? "Thesis" :
                        lectureMode === "full" ? "Full" :
                        lectureMode === "section" ? "Section" : "Standard";
        let toast = this.Toast.progress("Synthese " + modeLabel + " - " + collectionName.substring(0, 30));

        await new Promise((resolve, reject) => {
            let xhr = new XMLHttpRequest();
            let lastIndex = 0;

            xhr.open("GET", url, true);
            xhr.setRequestHeader("Accept", "text/event-stream");
            if (requestBody) {
                xhr.setRequestHeader("Content-Type", "application/json");
            }

            xhr.onprogress = function() {
                let newData = xhr.responseText.substring(lastIndex);
                lastIndex = xhr.responseText.length;
                let lines = newData.split("\n");

                for (let line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        let data = JSON.parse(line.substring(6));
                        let phase = data.phase || "unknown";

                        switch (phase) {
                            case "init":
                                toast.update("Initialisation...");
                                break;
                            case "pdf_check":
                                toast.update("Verification PDFs: " + data.total_articles + " articles");
                                break;
                            case "article_check":
                            case "article_valid":
                                toast.update("PDF " + data.index + "/" + data.total);
                                break;
                            case "pdf_check_complete":
                                toast.update("PDFs: " + data.valid + " valides, " + data.skipped + " skippes");
                                break;
                            case "fiche_check":
                                toast.update("Verification fiches...");
                                break;
                            case "fiche_generation":
                                toast.update("Analyse articles: " + data.total + " articles");
                                break;
                            case "lecture_start":
                                toast.update("Analyse: " + (data.title || data.zotero_key || ""));
                                break;
                            case "lecture_progress":
                                toast.update("Analyse: " + data.step + "...");
                                break;
                            case "fiche_generation_complete":
                                toast.update("Fiches pretes: " + data.fiches_count);
                                break;
                            case "synthesis":
                                toast.update("Synthese LLM...");
                                break;
                            case "storage":
                                toast.update("Stockage...");
                                break;
                            case "complete":
                                toast.success("Synthese completee!");
                                self.log("Unified synthesis complete: " + JSON.stringify(data).substring(0, 200));
                                break;
                            case "error":
                                toast.error("Erreur: " + (data.error || data.message || "Erreur inconnue"));
                                self.log("Unified synthesis error: " + data.error);
                                break;
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            };

            xhr.onload = function() {
                self.log("Unified synthesis complete: status " + xhr.status);
                resolve();
            };

            xhr.onerror = function() {
                self.log("Unified synthesis connection error");
                toast.error("Erreur de connexion");
                reject(new Error("Connexion echouee"));
            };

            try {
                xhr.send(requestBody);
            } catch (e) {
                self.log("Unified synthesis xhr.send error: " + e.message);
                toast.error("Erreur: " + e.message);
                reject(e);
            }
        });
    },

    async openDocumentExportDialog() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Selectionnez une collection");
            return;
        }

        let collectionName = collection.name;
        let collectionKey = collection.key;
        let self = this;

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Export de Documents</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1e1e1e;
            color: #e0e0e0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: linear-gradient(135deg, #c0504d 0%, #953735 100%);
            color: white;
            padding: 18px 22px;
            flex-shrink: 0;
        }
        .header h1 {
            font-size: 1.2em;
            font-weight: 600;
            margin-bottom: 6px;
        }
        .header .subtitle {
            font-size: 0.85em;
            opacity: 0.9;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .form-container {
            padding: 18px 22px;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 16px;
            overflow-y: auto;
        }
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .form-group > label {
            font-weight: 600;
            font-size: 0.9em;
            color: #b0b0b0;
            margin-bottom: 4px;
        }
        .radio-group {
            background: #2a2a2a;
            border-radius: 6px;
            padding: 8px 12px;
        }
        .radio-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 4px;
            cursor: pointer;
            border-radius: 4px;
        }
        .radio-item:hover {
            background: #353535;
        }
        .radio-item input[type="radio"] {
            width: 16px;
            height: 16px;
            accent-color: #c0504d;
            cursor: pointer;
        }
        .radio-item label {
            cursor: pointer;
            font-size: 0.9em;
            color: #e0e0e0;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: #2a2a2a;
            border-radius: 6px;
            cursor: pointer;
        }
        .checkbox-group:hover {
            background: #353535;
        }
        .checkbox-group input[type="checkbox"] {
            width: 18px;
            height: 18px;
            accent-color: #c0504d;
            cursor: pointer;
        }
        .checkbox-label {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .checkbox-label span {
            font-weight: 500;
            color: #e0e0e0;
            font-size: 0.95em;
        }
        .checkbox-label small {
            color: #888;
            font-size: 0.8em;
        }
        .text-input {
            width: 100%;
            padding: 12px;
            border: 1px solid #444;
            border-radius: 6px;
            background: #2a2a2a;
            color: #e0e0e0;
            font-size: 0.95em;
        }
        .text-input:focus {
            outline: none;
            border-color: #c0504d;
        }
        .text-input::placeholder {
            color: #666;
        }
        .hidden {
            display: none;
        }
        .button-row {
            display: flex;
            gap: 10px;
            padding: 16px 22px;
            background: #252525;
            border-top: 1px solid #333;
            flex-shrink: 0;
        }
        .btn {
            flex: 1;
            padding: 12px 16px;
            border: none;
            border-radius: 6px;
            font-size: 0.95em;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary {
            background: linear-gradient(135deg, #c0504d 0%, #953735 100%);
            color: white;
        }
        .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(192, 80, 77, 0.4);
        }
        .btn-secondary {
            background: #3c3c3c;
            color: #e0e0e0;
            border: 1px solid #555;
        }
        .btn-secondary:hover {
            background: #4a4a4a;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Export de Documents</h1>
        <div class="subtitle" title="${this.escapeHtml(collectionName)}">${this.escapeHtml(collectionName.length > 50 ? collectionName.substring(0, 50) + "..." : collectionName)}</div>
    </div>
    <div class="form-container">
        <div class="form-group">
            <label>Format de document</label>
            <div class="radio-group">
                <div class="radio-item">
                    <input type="radio" name="documentFormat" id="formatWord" value="word" checked>
                    <label for="formatWord">Word (.docx) - Document texte</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="documentFormat" id="formatPptx" value="pptx">
                    <label for="formatPptx">PowerPoint (.pptx) - Presentation</label>
                </div>
            </div>
        </div>

        <div class="form-group" id="writingLevelGroup">
            <label>Niveau de redaction</label>
            <div class="radio-group">
                <div class="radio-item">
                    <input type="radio" name="writingLevel" id="levelPopular" value="vulgarization">
                    <label for="levelPopular">Vulgarisation - Grand public</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="writingLevel" id="levelScientific" value="scientific" checked>
                    <label for="levelScientific">Scientifique - Chercheurs</label>
                </div>
                <div class="radio-item">
                    <input type="radio" name="writingLevel" id="levelAcademic" value="academic">
                    <label for="levelAcademic">Universitaire - Academique</label>
                </div>
            </div>
        </div>

        <div class="form-group">
            <label>Titre du document</label>
            <input type="text" class="text-input" id="docTitle" placeholder="Ex: Synthese bibliographique - [Collection]" value="Synthese - ${this.escapeHtml(collectionName)}">
        </div>

        <div class="form-group">
            <label>Options</label>
            <label class="checkbox-group" for="attachZotero">
                <input type="checkbox" id="attachZotero" checked>
                <div class="checkbox-label">
                    <span>Attacher a Zotero</span>
                    <small>Creer une piece jointe dans la collection</small>
                </div>
            </label>
            <label class="checkbox-group" for="uploadDropbox">
                <input type="checkbox" id="uploadDropbox" checked>
                <div class="checkbox-label">
                    <span>Uploader sur Dropbox</span>
                    <small>Sauvegarder automatiquement</small>
                </div>
            </label>
        </div>
    </div>
    <div class="button-row">
        <button class="btn btn-secondary" onclick="window.close()">Annuler</button>
        <button class="btn btn-primary" onclick="startExport()">Generer le document</button>
    </div>
    <script>
        function getSelectedRadio(name) {
            var radios = document.getElementsByName(name);
            for (var i = 0; i < radios.length; i++) {
                if (radios[i].checked) return radios[i].value;
            }
            return null;
        }

        function toggleWritingLevel() {
            var format = getSelectedRadio('documentFormat');
            var writingLevelGroup = document.getElementById('writingLevelGroup');
            if (format === 'word') {
                writingLevelGroup.classList.remove('hidden');
            } else {
                writingLevelGroup.classList.add('hidden');
            }
        }

        function startExport() {
            var format = getSelectedRadio('documentFormat') || 'word';
            var writingLevel = getSelectedRadio('writingLevel') || 'scientific';
            var title = document.getElementById('docTitle').value.trim();
            var attachZotero = document.getElementById('attachZotero').checked;
            var uploadDropbox = document.getElementById('uploadDropbox').checked;

            if (!title) {
                alert('Veuillez entrer un titre pour le document');
                document.getElementById('docTitle').focus();
                return;
            }

            if (window.pdfCompanionCallback) {
                window.pdfCompanionCallback(format, writingLevel, title, attachZotero, uploadDropbox);
            }
            window.close();
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.ctrlKey) {
                startExport();
            } else if (e.key === 'Escape') {
                window.close();
            }
        });

        // Setup radio listeners for writing level visibility
        var radios = document.getElementsByName('documentFormat');
        for (var i = 0; i < radios.length; i++) {
            radios[i].addEventListener('change', toggleWritingLevel);
        }
    </script>
</body>
</html>`;

        try {
            let win = Services.ww.openWindow(
                null,
                "about:blank",
                "_blank",
                "chrome,centerscreen,resizable=yes,width=500,height=650",
                null
            );

            win.addEventListener("load", () => {
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = "Export de Documents";

                win.pdfCompanionCallback = async (format, writingLevel, title, attachZotero, uploadDropbox) => {
                    self.log("Document export dialog: format=" + format + ", level=" + writingLevel);
                    if (format === "word") {
                        await self.exportWordDocument(collection, writingLevel, title, attachZotero, uploadDropbox);
                    } else {
                        await self.exportPptxPresentation(collection, title, attachZotero, uploadDropbox);
                    }
                };
            }, { once: true });

            this.log("Opened document export dialog for collection: " + collectionName);
        } catch (e) {
            this.log("openDocumentExportDialog error: " + e);
            this.showNotification("Erreur", "Impossible d'ouvrir le dialogue");
        }
    },

    async exportWordDocument(collection, writingLevel, title, attachZotero, uploadDropbox) {
        let self = this;
        let toast = this.Toast.progress("Export Word - " + title.substring(0, 30));

        try {
            let url = this.config.paperReaderUrl + "/export/document";
            let body = JSON.stringify({
                source_type: "collection",
                source_id: collection.key,
                writing_level: writingLevel,
                format: "docx",
                title: title,
                attach_to_zotero: attachZotero,
                upload_to_dropbox: uploadDropbox
            });

            this.log("Word export request: " + url);

            let response = await Zotero.HTTP.request("POST", url, {
                headers: { "Content-Type": "application/json" },
                body: body,
                timeout: 300000,  // 5 minutes
                ignoreErrors: true
            });

            toast.close();

            if (response.status === 200 || response.status === 201) {
                let data = JSON.parse(response.responseText);
                this.showNotification("Export reussi!", title);
                this.log("Word document exported: " + (data.file_path || "success"));
            } else {
                this.showNotification("Erreur d'export", "Statut: " + response.status);
                this.log("Word export error: " + response.status);
            }
        } catch (e) {
            toast.close();
            this.log("Word export error: " + e.message);
            this.showNotification("Erreur", "Export impossible: " + e.message);
        }
    },

    async exportPptxPresentation(collection, title, attachZotero, uploadDropbox) {
        let self = this;
        let toast = this.Toast.progress("Export PowerPoint - " + title.substring(0, 30));

        try {
            // Use existing PPTX export logic
            let url = "http://10.0.0.44:8480/api/generate/paper-reader";
            let body = JSON.stringify({
                zotero_collection_key: collection.key,
                title: title,
                attach_to_zotero: attachZotero,
                upload_to_dropbox: uploadDropbox
            });

            this.log("PPTX export request: " + url);

            let response = await Zotero.HTTP.request("POST", url, {
                headers: { "Content-Type": "application/json" },
                body: body,
                timeout: 300000,  // 5 minutes
                ignoreErrors: true
            });

            toast.close();

            if (response.status === 200 || response.status === 201) {
                let data = JSON.parse(response.responseText);
                this.showNotification("Export reussi!", title);
                this.log("PPTX presentation exported: " + (data.file_path || "success"));
            } else {
                this.showNotification("Erreur d'export", "Statut: " + response.status);
                this.log("PPTX export error: " + response.status);
            }
        } catch (e) {
            toast.close();
            this.log("PPTX export error: " + e.message);
            this.showNotification("Erreur", "Export impossible: " + e.message);
        }
    },

    // === SYNTHESIZE COLLECTION (Markdown - ancien) ===
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
                let levelValue = levelSelect.value;

                btn.disabled = true;
                focusInput.disabled = true;
                levelSelect.disabled = true;
                logDiv.style.display = 'block';

                let sseUrl = self.config.paperReaderUrl + "/synthesize/collection/" +
                    encodeURIComponent(collection.key) + "/stream-v2?" +
                    "lecture_mode=standard" +
                    "&lecture=true";

                // Build request body with focus and level
                let requestBody = null;
                if (focus || levelValue !== "complet") {
                    requestBody = JSON.stringify({
                        focus: focus || undefined,
                        level: levelValue
                    });
                }

                self.log("SSE synthesis: " + sseUrl + (requestBody ? " with body: " + requestBody : ""));

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
                if (requestBody) {
                    xhr.setRequestHeader("Content-Type", "application/json");
                }

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
                xhr.send(requestBody);
            });
        }, { once: true });
    },

    // === BATCH READING (LECTURE COMPLETE) ===
    async startBatchReading() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("PDF Companion", "Selectionnez une collection");
            return;
        }

        let self = this;

        // Create the batch reading monitor window
        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Lecture complete - ${this.escapeHtml(collection.name)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1a1a2e;
            color: #e0e0e0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 20px;
            flex-shrink: 0;
        }
        .header h1 {
            font-size: 1.1em;
            font-weight: 600;
            margin-bottom: 5px;
        }
        .header .meta {
            font-size: 0.85em;
            opacity: 0.9;
        }
        .toolbar {
            background: #16213e;
            padding: 10px 15px;
            display: flex;
            gap: 10px;
            align-items: center;
            border-bottom: 1px solid #0f3460;
            flex-shrink: 0;
        }
        .btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s;
        }
        .btn:hover { background: #5a6fd6; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-danger { background: #dc3545; }
        .btn-danger:hover { background: #c82333; }
        .btn-secondary { background: #495057; }
        .status-badge {
            background: #28a745;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8em;
            margin-left: auto;
        }
        .status-badge.pending { background: #ffc107; color: #333; }
        .status-badge.running { background: #17a2b8; }
        .status-badge.error { background: #dc3545; }
        .main-container {
            display: flex;
            flex: 1;
            overflow: hidden;
        }
        .left-panel {
            width: 320px;
            background: #16213e;
            border-right: 1px solid #0f3460;
            display: flex;
            flex-direction: column;
            flex-shrink: 0;
        }
        .panel-header {
            padding: 12px 15px;
            background: #0f3460;
            font-weight: 600;
            font-size: 0.9em;
            display: flex;
            justify-content: space-between;
        }
        .panel-header .count {
            background: #667eea;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.85em;
        }
        .article-list {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }
        .article-item {
            padding: 10px 12px;
            margin-bottom: 6px;
            background: #1a1a2e;
            border-radius: 6px;
            border-left: 3px solid #495057;
            font-size: 0.85em;
            cursor: default;
        }
        .article-item.pending { border-left-color: #ffc107; }
        .article-item.processing { border-left-color: #17a2b8; background: #1f2d4a; }
        .article-item.success { border-left-color: #28a745; }
        .article-item.error { border-left-color: #dc3545; }
        .article-title {
            font-weight: 500;
            margin-bottom: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .article-meta {
            font-size: 0.8em;
            color: #888;
        }
        .article-status {
            font-size: 0.75em;
            margin-top: 4px;
            color: #aaa;
        }
        .center-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .sse-container {
            flex: 1;
            overflow-y: auto;
            padding: 15px;
            background: #0d1117;
            font-family: "SF Mono", Monaco, Consolas, monospace;
            font-size: 0.85em;
            line-height: 1.6;
        }
        .sse-event {
            padding: 6px 10px;
            margin-bottom: 4px;
            border-radius: 4px;
            background: rgba(255,255,255,0.03);
        }
        .sse-event.start { border-left: 3px solid #667eea; }
        .sse-event.progress { border-left: 3px solid #17a2b8; }
        .sse-event.success { border-left: 3px solid #28a745; }
        .sse-event.error { border-left: 3px solid #dc3545; color: #f8d7da; }
        .sse-event.complete { border-left: 3px solid #28a745; background: rgba(40,167,69,0.1); }
        .sse-time {
            color: #6a9955;
            margin-right: 10px;
        }
        .sse-type {
            color: #569cd6;
            margin-right: 8px;
            font-weight: 600;
        }
        .stats-bar {
            padding: 12px 15px;
            background: #16213e;
            border-top: 1px solid #0f3460;
            display: flex;
            gap: 25px;
            font-size: 0.85em;
        }
        .stat {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .stat-value {
            font-weight: 600;
            font-size: 1.1em;
        }
        .stat-value.success { color: #28a745; }
        .stat-value.error { color: #dc3545; }
        .stat-value.pending { color: #ffc107; }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.85em;
        }
        .checkbox-group input { cursor: pointer; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Lecture complete - ${this.escapeHtml(collection.name)}</h1>
        <div class="meta">Collection key: ${collection.key}</div>
    </div>

    <div class="toolbar">
        <button class="btn" id="btn-start">Demarrer</button>
        <button class="btn btn-danger" id="btn-cancel" disabled>Annuler</button>
        <button class="btn btn-secondary" id="btn-refresh">Actualiser</button>
        <div class="checkbox-group">
            <input type="checkbox" id="chk-subcollections" checked>
            <label for="chk-subcollections">Inclure sous-collections</label>
        </div>
        <span class="status-badge pending" id="status-badge">En attente</span>
    </div>

    <div class="main-container">
        <div class="left-panel">
            <div class="panel-header">
                <span>Articles</span>
                <span class="count" id="article-count">0</span>
            </div>
            <div class="article-list" id="article-list">
                <div style="padding: 20px; text-align: center; color: #666;">
                    Cliquez sur "Demarrer" pour charger les articles
                </div>
            </div>
        </div>

        <div class="center-panel">
            <div class="sse-container" id="sse-log"></div>
            <div class="stats-bar">
                <div class="stat">
                    <span>Total:</span>
                    <span class="stat-value" id="stat-total">0</span>
                </div>
                <div class="stat">
                    <span>Traites:</span>
                    <span class="stat-value success" id="stat-success">0</span>
                </div>
                <div class="stat">
                    <span>Echecs:</span>
                    <span class="stat-value error" id="stat-error">0</span>
                </div>
                <div class="stat">
                    <span>En attente:</span>
                    <span class="stat-value pending" id="stat-pending">0</span>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;

        let win = Services.ww.openWindow(
            null, "about:blank", "_blank",
            "chrome,centerscreen,resizable=yes,scrollbars=yes,width=1100,height=700",
            null
        );

        win.addEventListener("load", () => {
            win.document.open();
            win.document.write(html);
            win.document.close();
            win.document.title = "Lecture complete - " + collection.name;

            let btnStart = win.document.getElementById('btn-start');
            let btnCancel = win.document.getElementById('btn-cancel');
            let btnRefresh = win.document.getElementById('btn-refresh');
            let chkSubcollections = win.document.getElementById('chk-subcollections');
            let statusBadge = win.document.getElementById('status-badge');
            let articleList = win.document.getElementById('article-list');
            let articleCount = win.document.getElementById('article-count');
            let sseLog = win.document.getElementById('sse-log');
            let statTotal = win.document.getElementById('stat-total');
            let statSuccess = win.document.getElementById('stat-success');
            let statError = win.document.getElementById('stat-error');
            let statPending = win.document.getElementById('stat-pending');

            let articles = {};
            let currentXhr = null;
            let sseConnected = false;
            let pollInterval = null;
            let stats = { total: 0, success: 0, error: 0, pending: 0 };

            function updateStats() {
                statTotal.textContent = stats.total;
                statSuccess.textContent = stats.success;
                statError.textContent = stats.error;
                statPending.textContent = stats.pending;
            }

            function addSseEvent(type, message) {
                let time = new Date().toLocaleTimeString('fr-FR');
                let div = win.document.createElement('div');
                div.className = 'sse-event ' + type;
                div.innerHTML = '<span class="sse-time">' + time + '</span>' +
                    '<span class="sse-type">[' + type.toUpperCase() + ']</span>' +
                    '<span class="sse-message">' + self.escapeHtml(message) + '</span>';
                sseLog.appendChild(div);
                sseLog.scrollTop = sseLog.scrollHeight;
            }

            function updateArticle(key, status, message) {
                if (!articles[key]) return;
                let el = articles[key].element;
                el.className = 'article-item ' + status;
                let statusEl = el.querySelector('.article-status');
                if (statusEl && message) {
                    statusEl.textContent = message;
                }
            }

            function renderArticles(articleData) {
                articleList.innerHTML = '';
                articles = {};
                stats = { total: articleData.length, success: 0, error: 0, pending: articleData.length };

                for (let art of articleData) {
                    let div = win.document.createElement('div');
                    div.className = 'article-item pending';
                    div.innerHTML =
                        '<div class="article-title">' + self.escapeHtml((art.title || 'Sans titre').substring(0, 50)) + '</div>' +
                        '<div class="article-meta">' + self.escapeHtml(art.authors || 'Auteur inconnu') + '</div>' +
                        '<div class="article-status">En attente</div>';
                    articleList.appendChild(div);
                    articles[art.key] = { data: art, element: div };
                }

                articleCount.textContent = articleData.length;
                updateStats();
            }

            // Refresh status from API
            async function refreshStatus() {
                try {
                    let response = await fetch(self.config.paperReaderUrl + "/lecture/status");
                    let data = await response.json();

                    if (data.running) {
                        statusBadge.textContent = 'En cours';
                        statusBadge.className = 'status-badge running';
                        btnStart.disabled = true;
                        btnCancel.disabled = false;

                        // Connect to SSE if not already connected
                        if (!sseConnected && !currentXhr) {
                            let batchId = data.current_batch ? data.current_batch.id : null;
                            connectSSE(batchId);
                        }
                    } else {
                        statusBadge.textContent = 'Inactif';
                        statusBadge.className = 'status-badge pending';
                        btnStart.disabled = false;
                        btnCancel.disabled = true;
                        stopSSE();
                        stopPolling();
                    }

                    // Use current_batch articles if available
                    if (data.current_batch && data.current_batch.articles) {
                        renderArticlesFromStatus(data.current_batch.articles);
                        addSseEvent('progress', 'Status: ' + (data.running ? 'en cours' : 'inactif') +
                            ' - ' + (data.current_batch.total_articles - data.current_batch.processed) + ' en attente');
                    } else {
                        // Fallback to queue
                        let queueResponse = await fetch(self.config.paperReaderUrl + "/lecture/queue");
                        let queueData = await queueResponse.json();

                        if (queueData.items && queueData.items.length > 0) {
                            renderArticlesFromStatus(queueData.items);
                        }
                        addSseEvent('progress', 'Status: ' + (data.running ? 'en cours' : 'inactif') +
                            ' - ' + (queueData.pending || 0) + ' en attente');
                    }
                } catch (e) {
                    addSseEvent('error', 'Erreur refresh: ' + e.message);
                }
            }

            // Start batch reading
            async function startBatch() {
                let includeSubcollections = chkSubcollections.checked;

                btnStart.disabled = true;
                btnCancel.disabled = false;
                statusBadge.textContent = 'Demarrage...';
                statusBadge.className = 'status-badge running';

                articleList.innerHTML = '<div style="padding: 20px; text-align: center; color: #17a2b8;">Chargement des articles...</div>';
                sseLog.innerHTML = '';
                addSseEvent('start', 'Demarrage synthese - Collection: ' + collection.name);
                if (includeSubcollections) {
                    addSseEvent('start', 'Mode: avec sous-collections');
                }

                let url = self.config.paperReaderUrl + "/synthesize/collection/" + encodeURIComponent(collection.key) + "/stream-v2";
                self.log("Starting collection synthesis: " + url);

                try {
                    statusBadge.textContent = 'En cours';
                    statusBadge.className = 'status-badge running';
                    addSseEvent('progress', 'Connexion au stream SSE de synthese...');

                    // Connect directly to synthesis stream
                    connectSSE(null);
                } catch (e) {
                    addSseEvent('error', 'Erreur de connexion: ' + e.message);
                    statusBadge.textContent = 'Erreur';
                    statusBadge.className = 'status-badge error';
                    btnStart.disabled = false;
                    btnCancel.disabled = true;
                }
            }

            // Connect to SSE stream for real-time updates
            function connectSSE(batchId) {
                if (currentXhr) {
                    currentXhr.abort();
                }

                // Use the synthesis collection stream endpoint
                let sseUrl = self.config.paperReaderUrl + "/synthesize/collection/" + encodeURIComponent(collection.key) + "/stream-v2";

                self.log("Connecting to SSE: " + sseUrl);
                addSseEvent('progress', 'Connexion au stream SSE...');

                currentXhr = new XMLHttpRequest();
                let lastIndex = 0;

                currentXhr.open("GET", sseUrl, true);
                currentXhr.setRequestHeader("Accept", "text/event-stream");

                currentXhr.onprogress = function() {
                    if (!sseConnected) {
                        sseConnected = true;
                        addSseEvent('success', 'Stream SSE connecte');
                    }

                    let newData = currentXhr.responseText.substring(lastIndex);
                    lastIndex = currentXhr.responseText.length;
                    let lines = newData.split("\n");

                    for (let line of lines) {
                        if (!line.startsWith("data: ")) continue;
                        try {
                            let data = JSON.parse(line.substring(6));
                            handleSSEEvent(data);
                        } catch (e) {}
                    }
                };

                currentXhr.onload = function() {
                    sseConnected = false;
                    addSseEvent('progress', 'Stream SSE termine');
                    // Refresh final status
                    refreshStatus();
                };

                currentXhr.onerror = function() {
                    sseConnected = false;
                    addSseEvent('error', 'Erreur connexion SSE - passage en mode polling');
                    // Fallback to polling
                    startPolling();
                };

                currentXhr.send();
            }

            // Handle SSE events
            function handleSSEEvent(data) {
                // Support both 'event' and 'phase' fields
                let evType = data.phase || data.event || data.type || 'info';

                switch (evType) {
                    case 'init':
                        addSseEvent('start', data.message || 'Synthese initialisee');
                        break;

                    case 'collection_info':
                        let artCount = data.articles_count || '?';
                        addSseEvent('progress', 'Collection: ' + data.collection_name + ' (' + artCount + ' articles)');
                        stats.pending = artCount;
                        updateStats();
                        break;

                    case 'heartbeat':
                        if (data.elapsed_seconds) {
                            addSseEvent('progress', 'Synthese en cours... (' + data.elapsed_seconds + 's)');
                        }
                        break;

                    case 'dropbox_uploaded':
                        addSseEvent('success', 'Fichiers disponibles sur Dropbox');
                        if (data.markdown_url) {
                            addSseEvent('progress', '📄 Markdown: ' + data.markdown_url);
                        }
                        if (data.docx_url) {
                            addSseEvent('progress', '📋 DOCX: ' + data.docx_url);
                        }
                        break;

                    case 'zotero_attached':
                        addSseEvent('success', 'Item cree dans Zotero: ' + (data.title || data.item_key || ''));
                        stats.success++;
                        stats.pending--;
                        updateStats();
                        break;

                    case 'complete':
                        statusBadge.textContent = 'Termine';
                        statusBadge.className = 'status-badge';
                        statusBadge.style.background = '#28a745';
                        btnStart.disabled = false;
                        btnCancel.disabled = true;
                        let durMsg = data.duration_seconds ? ' (' + data.duration_seconds + 's)' : '';
                        addSseEvent('complete', 'Synthese completee!' + durMsg);
                        break;

                    case 'error':
                        statusBadge.textContent = 'Erreur';
                        statusBadge.className = 'status-badge error';
                        btnStart.disabled = false;
                        btnCancel.disabled = true;
                        addSseEvent('error', data.message || data.error || 'Erreur');
                        break;

                    default:
                        if (data.message) {
                            addSseEvent('progress', data.message);
                        }
                }
            }

            function updateArticleStatus(key, status, message) {
                if (!articles[key]) return;
                let el = articles[key].element;
                el.className = 'article-item ' + status;
                let statusEl = el.querySelector('.article-status');
                if (statusEl) {
                    statusEl.textContent = message || status;
                }
            }

            // Fallback polling if SSE fails
            function startPolling() {
                if (pollInterval) return;
                pollInterval = setInterval(async () => {
                    try {
                        let resp = await fetch(self.config.paperReaderUrl + '/lecture/status');
                        let data = await resp.json();
                        if (data.current_batch && data.current_batch.articles) {
                            renderArticlesFromStatus(data.current_batch.articles);
                        }
                        if (!data.running) {
                            stopPolling();
                            statusBadge.textContent = 'Termine';
                            btnStart.disabled = false;
                            btnCancel.disabled = true;
                        }
                    } catch (e) {}
                }, 10000);
            }

            function stopPolling() {
                if (pollInterval) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                }
            }

            function stopSSE() {
                if (currentXhr) {
                    currentXhr.abort();
                    currentXhr = null;
                }
                sseConnected = false;
            }

            function renderArticlesFromStatus(articleData) {
                articleList.innerHTML = '';
                articles = {};
                let successCount = 0, errorCount = 0, pendingCount = 0;

                for (let art of articleData) {
                    let artStatus = art.status || 'pending';
                    if (artStatus === 'completed') { artStatus = 'success'; successCount++; }
                    else if (artStatus === 'failed') { artStatus = 'error'; errorCount++; }
                    else { pendingCount++; }

                    let div = win.document.createElement('div');
                    div.className = 'article-item ' + artStatus;
                    div.innerHTML =
                        '<div class="article-title">' + self.escapeHtml((art.title || 'Sans titre').substring(0, 50)) + '</div>' +
                        '<div class="article-meta">' + self.escapeHtml(art.authors || 'Auteur inconnu') + '</div>' +
                        '<div class="article-status">' + self.escapeHtml(art.error || artStatus) + '</div>';
                    articleList.appendChild(div);
                    articles[art.zotero_key] = { data: art, element: div };
                }

                articleCount.textContent = articleData.length;
                stats.total = articleData.length;
                stats.success = successCount;
                stats.error = errorCount;
                stats.pending = pendingCount;
                updateStats();
            }

            // Cancel batch
            async function cancelBatch() {
                try {
                    stopSSE();
                    stopPolling();
                    await fetch(self.config.paperReaderUrl + "/lecture/cancel", { method: "POST" });
                    addSseEvent('error', 'Annulation demandee...');
                    statusBadge.textContent = 'Annule';
                    statusBadge.className = 'status-badge error';
                    btnCancel.disabled = true;
                    btnStart.disabled = false;
                } catch (e) {
                    addSseEvent('error', 'Erreur annulation: ' + e.message);
                }
            }

            // Cleanup on window close
            win.addEventListener('unload', () => {
                stopSSE();
                stopPolling();
            });

            btnStart.addEventListener('click', startBatch);
            btnCancel.addEventListener('click', cancelBatch);
            btnRefresh.addEventListener('click', refreshStatus);

            // Initial status check
            refreshStatus();
        }, { once: true });

        this.log("Opened batch reading monitor for: " + collection.name);
    },

    // === BATCH MONITOR (from main menu) ===
    async openBatchMonitor() {
        let self = this;

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Moniteur de lectures</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1a1a2e;
            color: #e0e0e0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 20px;
            flex-shrink: 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header h1 {
            font-size: 1.1em;
            font-weight: 600;
        }
        .header-actions {
            display: flex;
            gap: 10px;
        }
        .btn {
            background: rgba(255,255,255,0.2);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s;
        }
        .btn:hover { background: rgba(255,255,255,0.3); }
        .btn-danger { background: #dc3545; }
        .main-container {
            display: flex;
            flex: 1;
            overflow: hidden;
        }
        .left-panel {
            width: 350px;
            background: #16213e;
            border-right: 1px solid #0f3460;
            display: flex;
            flex-direction: column;
            flex-shrink: 0;
        }
        .panel-header {
            padding: 12px 15px;
            background: #0f3460;
            font-weight: 600;
            font-size: 0.9em;
            display: flex;
            justify-content: space-between;
        }
        .article-list {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }
        .article-item {
            padding: 10px 12px;
            margin-bottom: 6px;
            background: #1a1a2e;
            border-radius: 6px;
            border-left: 3px solid #495057;
            font-size: 0.85em;
        }
        .article-item.pending { border-left-color: #ffc107; }
        .article-item.processing { border-left-color: #17a2b8; background: #1f2d4a; }
        .article-item.success { border-left-color: #28a745; }
        .article-item.error { border-left-color: #dc3545; }
        .article-title {
            font-weight: 500;
            margin-bottom: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .article-meta {
            font-size: 0.8em;
            color: #888;
        }
        .center-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .sse-container {
            flex: 1;
            overflow-y: auto;
            padding: 15px;
            background: #0d1117;
            font-family: "SF Mono", Monaco, Consolas, monospace;
            font-size: 0.85em;
            line-height: 1.6;
        }
        .sse-event {
            padding: 6px 10px;
            margin-bottom: 4px;
            border-radius: 4px;
            background: rgba(255,255,255,0.03);
        }
        .sse-event.info { border-left: 3px solid #667eea; }
        .sse-event.success { border-left: 3px solid #28a745; }
        .sse-event.error { border-left: 3px solid #dc3545; }
        .sse-time { color: #6a9955; margin-right: 10px; }
        .status-panel {
            padding: 15px;
            background: #16213e;
            border-bottom: 1px solid #0f3460;
        }
        .status-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
        }
        .status-card {
            background: #0f3460;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
        }
        .status-value {
            font-size: 1.8em;
            font-weight: bold;
            margin-bottom: 4px;
        }
        .status-value.running { color: #17a2b8; }
        .status-value.success { color: #28a745; }
        .status-value.error { color: #dc3545; }
        .status-value.pending { color: #ffc107; }
        .status-label { font-size: 0.8em; color: #888; }
        .no-batch {
            padding: 40px;
            text-align: center;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Moniteur de lectures batch</h1>
        <div class="header-actions">
            <button class="btn" id="btn-refresh">Actualiser</button>
            <button class="btn btn-danger" id="btn-cancel" disabled>Annuler</button>
        </div>
    </div>

    <div class="main-container">
        <div class="left-panel">
            <div class="panel-header">
                <span>File d'attente</span>
                <span id="queue-count">0</span>
            </div>
            <div class="article-list" id="article-list">
                <div class="no-batch">Aucun batch en cours</div>
            </div>
        </div>

        <div class="center-panel">
            <div class="status-panel">
                <div class="status-grid">
                    <div class="status-card">
                        <div class="status-value" id="stat-running">-</div>
                        <div class="status-label">Status</div>
                    </div>
                    <div class="status-card">
                        <div class="status-value success" id="stat-success">0</div>
                        <div class="status-label">Succes</div>
                    </div>
                    <div class="status-card">
                        <div class="status-value error" id="stat-error">0</div>
                        <div class="status-label">Echecs</div>
                    </div>
                    <div class="status-card">
                        <div class="status-value pending" id="stat-pending">0</div>
                        <div class="status-label">En attente</div>
                    </div>
                </div>
            </div>
            <div class="sse-container" id="sse-log">
                <div class="no-batch">Cliquez sur "Actualiser" pour voir le status</div>
            </div>
        </div>
    </div>
</body>
</html>`;

        let win = Services.ww.openWindow(
            null, "about:blank", "_blank",
            "chrome,centerscreen,resizable=yes,scrollbars=yes,width=1000,height=650",
            null
        );

        win.addEventListener("load", () => {
            win.document.open();
            win.document.write(html);
            win.document.close();
            win.document.title = "Moniteur de lectures";

            let btnRefresh = win.document.getElementById('btn-refresh');
            let btnCancel = win.document.getElementById('btn-cancel');
            let articleList = win.document.getElementById('article-list');
            let queueCount = win.document.getElementById('queue-count');
            let sseLog = win.document.getElementById('sse-log');
            let statRunning = win.document.getElementById('stat-running');
            let statSuccess = win.document.getElementById('stat-success');
            let statError = win.document.getElementById('stat-error');
            let statPending = win.document.getElementById('stat-pending');

            function addLog(type, message) {
                if (sseLog.querySelector('.no-batch')) {
                    sseLog.innerHTML = '';
                }
                let time = new Date().toLocaleTimeString('fr-FR');
                let div = win.document.createElement('div');
                div.className = 'sse-event ' + type;
                div.innerHTML = '<span class="sse-time">' + time + '</span>' + self.escapeHtml(message);
                sseLog.appendChild(div);
                sseLog.scrollTop = sseLog.scrollHeight;
            }

            async function refresh() {
                try {
                    // Get status
                    let statusResp = await fetch(self.config.paperReaderUrl + "/lecture/status");
                    let status = await statusResp.json();

                    statRunning.textContent = status.running ? 'En cours' : 'Inactif';
                    statRunning.className = 'status-value ' + (status.running ? 'running' : '');
                    btnCancel.disabled = !status.running;

                    if (status.current_batch) {
                        let batch = status.current_batch;
                        statSuccess.textContent = batch.success || 0;
                        statError.textContent = batch.failed || 0;
                        statPending.textContent = batch.pending || 0;
                        addLog('info', 'Collection: ' + (batch.collection_name || batch.collection_key || 'N/A'));
                    }

                    // Get queue
                    let queueResp = await fetch(self.config.paperReaderUrl + "/lecture/queue");
                    let queue = await queueResp.json();

                    queueCount.textContent = queue.total || 0;

                    if (queue.items && queue.items.length > 0) {
                        articleList.innerHTML = '';
                        for (let item of queue.items) {
                            let status = item.status || 'pending';
                            let div = win.document.createElement('div');
                            div.className = 'article-item ' + status;
                            div.innerHTML =
                                '<div class="article-title">' + self.escapeHtml((item.title || 'Sans titre').substring(0, 45)) + '</div>' +
                                '<div class="article-meta">' + self.escapeHtml(item.authors || item.key) + '</div>';
                            articleList.appendChild(div);
                        }
                    } else {
                        articleList.innerHTML = '<div class="no-batch">File d\'attente vide</div>';
                    }

                    addLog('info', 'Status actualise - ' + (queue.pending || 0) + ' en attente');

                } catch (e) {
                    addLog('error', 'Erreur: ' + e.message);
                }
            }

            async function cancel() {
                try {
                    await fetch(self.config.paperReaderUrl + "/lecture/cancel", { method: "POST" });
                    addLog('info', 'Annulation demandee...');
                    btnCancel.disabled = true;
                    setTimeout(refresh, 2000);
                } catch (e) {
                    addLog('error', 'Erreur annulation: ' + e.message);
                }
            }

            btnRefresh.addEventListener('click', refresh);
            btnCancel.addEventListener('click', cancel);

            // Initial load
            refresh();

            // Auto-refresh every 10 seconds if batch is running
            let refreshInterval = setInterval(async () => {
                try {
                    let resp = await fetch(self.config.paperReaderUrl + "/lecture/status");
                    let data = await resp.json();
                    if (data.running) {
                        refresh();
                    }
                } catch (e) {}
            }, 10000);

            win.addEventListener('unload', () => {
                clearInterval(refreshInterval);
            });

        }, { once: true });

        this.log("Opened batch monitor window");
    },

    // === PPTX PRESENTATION GENERATION ===
    generatePptxPresentation() {
        let collection = this.getSelectedCollection();
        if (!collection) {
            this.showNotification("Erreur", "Sélectionnez une collection");
            return;
        }

        let self = this;

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Présentation PPTX - ${this.escapeHtml(collection.name)}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0; padding: 20px;
            background: #f5f7f5; color: #333;
        }
        h2 { color: #2d5a27; margin: 0 0 15px 0; font-size: 1.2em; }
        .info-box {
            background: #e8f5e9; border-left: 4px solid #2d5a27;
            padding: 12px; margin-bottom: 15px; border-radius: 4px; font-size: 0.9em;
        }
        .form-group { margin-bottom: 12px; }
        label { display: block; font-weight: 500; margin-bottom: 4px; font-size: 0.9em; color: #555; }
        input[type="text"] {
            width: 100%; padding: 10px 12px; border: 1px solid #ccc;
            border-radius: 6px; font-size: 0.95em;
        }
        input[type="text"]:focus { outline: none; border-color: #4a7c43; }
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
            font-size: 0.85em; height: 280px; overflow-y: auto;
            display: none; white-space: pre-wrap; line-height: 1.4;
        }
        .log-info { color: #569cd6; }
        .log-success { color: #6a9955; }
        .log-running { color: #dcdcaa; }
        .log-complete { color: #4ec9b0; font-weight: bold; }
        .log-error { color: #f44747; }
        .log-download { color: #569cd6; text-decoration: underline; cursor: pointer; }
        .progress-bar {
            width: 100%; height: 8px; background: #e0e0e0;
            border-radius: 4px; margin-top: 10px; overflow: hidden;
        }
        .progress-fill {
            height: 100%; background: linear-gradient(90deg, #2d5a27, #4a7c43);
            width: 0%; transition: width 0.3s ease;
        }
    </style>
</head>
<body>
    <h2>Présentation PPTX : ${this.escapeHtml(collection.name)}</h2>
    <div class="info-box">
        Génération d'une présentation PowerPoint à partir des articles de la collection.
    </div>
    <div class="form-group">
        <label for="title">Titre de la présentation</label>
        <input type="text" id="title" placeholder="Ex: Synthèse des articles...">
    </div>
    <button id="btn-launch">Lancer la génération</button>
    <div class="progress-bar" id="progress-bar" style="display:none;">
        <div class="progress-fill" id="progress-fill"></div>
    </div>
    <div id="sse-log"></div>
</body>
</html>`;

        let win = Services.ww.openWindow(
            null, "about:blank", "_blank",
            "chrome,centerscreen,resizable=yes,scrollbars=yes,width=650,height=600",
            null
        );

        win.addEventListener("load", () => {
            win.document.open();
            win.document.write(html);
            win.document.close();
            win.document.title = "Présentation PPTX - " + collection.name;

            let btn = win.document.getElementById('btn-launch');
            let titleInput = win.document.getElementById('title');
            let logDiv = win.document.getElementById('sse-log');
            let progressBar = win.document.getElementById('progress-bar');
            let progressFill = win.document.getElementById('progress-fill');

            btn.addEventListener('click', () => {
                let title = titleInput.value.trim() || collection.name;

                btn.disabled = true;
                titleInput.disabled = true;
                logDiv.style.display = 'block';
                progressBar.style.display = 'block';

                function appendLog(text, cssClass) {
                    let span = win.document.createElement('span');
                    span.className = cssClass || '';
                    span.textContent = text + "\n";
                    logDiv.appendChild(span);
                    logDiv.scrollTop = logDiv.scrollHeight;
                }

                appendLog('[INFO] Envoi de la requête...', 'log-info');

                // Step 1: Create the job
                Zotero.HTTP.request("POST", "http://10.0.0.44:8480/api/generate/paper-reader", {
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        collection_key: collection.key,
                        collection_name: collection.name,
                        title: title
                    }),
                    timeout: 10000
                }).then(resp => {
                    let r = (typeof resp === 'string') ? resp : (resp.responseText || resp.response || JSON.stringify(resp));
                    let job = JSON.parse(r);
                    let jobId = job.job_id;

                    appendLog('[✓] Job créé: ' + jobId, 'log-success');
                    self.log("[PPTX] Job ID: " + jobId);

                    // Step 2: Poll the status every 3 seconds
                    let pollCount = 0;
                    let pollInterval = setInterval(() => {
                        pollCount++;

                        Zotero.HTTP.request("GET", "http://10.0.0.44:8480/api/generate/" + jobId + "/status", {
                            timeout: 5000
                        }).then(statusResp => {
                            let sr = (typeof statusResp === 'string') ? statusResp : (statusResp.responseText || statusResp.response || JSON.stringify(statusResp));
                            let status = JSON.parse(sr);

                            let progress = status.progress || 0;
                            let step = status.current_step || '-';
                            let statusText = status.status || 'unknown';

                            appendLog('[POLL ' + pollCount + '] status=' + statusText + ' | step=' + step + ' | progress=' + progress + '%', 'log-running');
                            progressFill.style.width = progress + '%';

                            self.log("[PPTX] [" + pollCount + "] " + statusText + " - " + step + " (" + progress + "%)");

                            if (statusText === "completed") {
                                clearInterval(pollInterval);
                                progressFill.style.width = '100%';
                                let downloadUrl = "http://10.0.0.44:8480/api/download/" + jobId;
                                appendLog('\n[✓] COMPLETED!', 'log-complete');
                                appendLog('[INFO] Attaching to Zotero...', 'log-info');

                                // Attach to "Synthèses & Productions" item (K5D5C5NB)
                                Zotero.HTTP.request("POST", "http://10.0.0.44:8331/item/K5D5C5NB/attachment", {
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        url: downloadUrl,
                                        title: "Présentation PPTX - " + (title || collection.name),
                                        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                                        tags: ["#pptx"],
                                        linkMode: "linked_url"
                                    }),
                                    timeout: 30000
                                }).then(attachResp => {
                                    let ar = (typeof attachResp === 'string') ? attachResp : (attachResp.responseText || attachResp.response || JSON.stringify(attachResp));
                                    let attachResult = JSON.parse(ar);

                                    if (attachResult.status === "success" || attachResult.success) {
                                        appendLog('[✓] Attached to item K5D5C5NB with tag #pptx', 'log-success');
                                        self.log("[PPTX] ✓ Attached to Synthèses & Productions");
                                    } else {
                                        appendLog('[⚠] Attachment status: ' + (attachResult.status || 'unknown'), 'log-running');
                                        self.log("[PPTX] Attachment: " + JSON.stringify(attachResult));
                                    }

                                    appendLog('\nDownload: ' + downloadUrl, 'log-download');
                                    let downloadSpan = win.document.createElement('span');
                                    downloadSpan.className = 'log-download';
                                    downloadSpan.textContent = downloadUrl;
                                    downloadSpan.style.cursor = 'pointer';
                                    downloadSpan.addEventListener('click', () => {
                                        Services.ww.openWindow(null, downloadUrl, "_blank", "", null);
                                    });
                                    logDiv.appendChild(downloadSpan);
                                    logDiv.scrollTop = logDiv.scrollHeight;

                                    self.log("[PPTX] ✓ DONE! " + downloadUrl);
                                }).catch(e => {
                                    appendLog('[⚠] Attachment error: ' + e.message, 'log-running');
                                    appendLog('Download: ' + downloadUrl, 'log-download');

                                    let downloadSpan = win.document.createElement('span');
                                    downloadSpan.className = 'log-download';
                                    downloadSpan.textContent = downloadUrl;
                                    downloadSpan.style.cursor = 'pointer';
                                    downloadSpan.addEventListener('click', () => {
                                        Services.ww.openWindow(null, downloadUrl, "_blank", "", null);
                                    });
                                    logDiv.appendChild(downloadSpan);
                                    logDiv.scrollTop = logDiv.scrollHeight;

                                    self.log("[PPTX] ⚠ Attachment failed, but PPTX ready: " + downloadUrl);
                                });
                            } else if (statusText === "failed" || statusText === "error") {
                                clearInterval(pollInterval);
                                let errorMsg = status.error || 'Unknown error';
                                appendLog('\n[✗] ERROR: ' + errorMsg, 'log-error');
                                appendLog('', '');
                                appendLog('Please check the server logs for details.', 'log-error');
                                appendLog('', '');
                                btn.disabled = false;
                                titleInput.disabled = false;
                                self.log("[PPTX] ✗ FAILED: " + errorMsg);
                            }
                        }).catch(e => {
                            appendLog('[✗] Poll error: ' + e.message, 'log-error');
                            self.log("[PPTX] Poll error: " + e);
                        });

                    }, 3000);  // Poll every 3 seconds

                }).catch(e => {
                    appendLog('[✗] Erreur: ' + e.message, 'log-error');
                    logDiv.scrollTop = logDiv.scrollHeight;
                    btn.disabled = false;
                    titleInput.disabled = false;
                    self.log("[PPTX] Error: " + e);
                });
            });
        }, { once: true });
    }
};
