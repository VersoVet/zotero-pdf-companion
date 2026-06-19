/**
 * PDF Sources Module - Cascading PDF recovery from 8+ sources
 * Each source is tried in order until PDF is found
 */

PdfCompanion.PdfSources = {
    /**
     * Cascade order for PDF recovery
     * Each source is tried until PDF is found
     */
    CASCADE_ORDER: [
        "arxiv",
        "unpaywall",
        "europe_pmc",
        "pubmed",
        "hindawi",
        "core",
        "publisher_doi",
        "scihub"
    ],

    /**
     * Search arXiv for preprints
     * Coverage: physics, math, CS, biology preprints
     */
    async searchArxiv(item) {
        let title = item.getField("title") || "";
        let authors = item.getCreators().map(c => c.lastName).slice(0, 3).join(" ");

        if (!title) return { found: false, source: "arxiv", reason: "no_title" };

        try {
            PdfCompanion.log("[arXiv] Searching: " + title.substring(0, 80));

            // Query arXiv API by title
            let query = encodeURIComponent(`title:"${title}"`);
            let arxivUrl = `http://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=5`;

            let response = await new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                xhr.timeout = 15000;
                xhr.onload = () => resolve(xhr.responseText);
                xhr.onerror = () => reject(new Error("arXiv connection failed"));
                xhr.ontimeout = () => reject(new Error("arXiv timeout"));
                xhr.open("GET", arxivUrl);
                xhr.send();
            });

            // Parse arXiv response (XML)
            let parser = new DOMParser();
            let xmlDoc = parser.parseFromString(response, "text/xml");
            let entries = xmlDoc.getElementsByTagName("entry");

            if (entries.length > 0) {
                // Try first result
                let pdfLink = null;
                let links = entries[0].getElementsByTagName("link");
                for (let i = 0; i < links.length; i++) {
                    if (links[i].getAttribute("type") === "application/pdf") {
                        pdfLink = links[i].getAttribute("href");
                        break;
                    } else if (links[i].getAttribute("title") === "pdf") {
                        pdfLink = links[i].getAttribute("href");
                        break;
                    }
                }

                if (pdfLink) {
                    // arXiv PDF links are like: http://arxiv.org/pdf/xxxx.xxxx
                    // Convert to direct download: http://arxiv.org/pdf/xxxx.xxxx.pdf
                    if (!pdfLink.endsWith(".pdf")) pdfLink += ".pdf";

                    PdfCompanion.log("[arXiv] ✅ Found: " + pdfLink);
                    return {
                        found: true,
                        source: "arxiv",
                        pdf_url: pdfLink,
                        message: "Preprint found on arXiv"
                    };
                }
            }

            PdfCompanion.log("[arXiv] ❌ Not found");
            return { found: false, source: "arxiv", reason: "not_found" };

        } catch (e) {
            PdfCompanion.log("[arXiv] Error: " + e.message);
            return { found: false, source: "arxiv", reason: "error", error: e.message };
        }
    },

    /**
     * Search Europe PMC for biomedical articles
     * Better coverage than PubMed
     */
    async searchEuropePmc(item) {
        let doi = item.getField("DOI");
        let title = item.getField("title");

        if (!doi && !title) return { found: false, source: "europe_pmc", reason: "no_doi_title" };

        try {
            let query = doi || title;
            let europePmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&isOpenAccess=Y&pageSize=10`;

            PdfCompanion.log("[Europe PMC] Searching: " + query.substring(0, 80));

            let response = await new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                xhr.timeout = 15000;
                xhr.responseType = "json";
                xhr.onload = () => resolve(xhr.response);
                xhr.onerror = () => reject(new Error("Europe PMC connection failed"));
                xhr.ontimeout = () => reject(new Error("Europe PMC timeout"));
                xhr.open("GET", europePmcUrl);
                xhr.send();
            });

            if (response.resultList && response.resultList.result && response.resultList.result.length > 0) {
                let result = response.resultList.result[0];

                // Check if open access PDF available
                if (result.isOpenAccess === "Y" && result.fullTextUrlList) {
                    for (let urlInfo of result.fullTextUrlList.fullTextUrl) {
                        if (urlInfo.documentStyle === "pdf") {
                            PdfCompanion.log("[Europe PMC] ✅ Found: " + urlInfo.url);
                            return {
                                found: true,
                                source: "europe_pmc",
                                pdf_url: urlInfo.url,
                                message: "Article found on Europe PMC"
                            };
                        }
                    }
                }
            }

            PdfCompanion.log("[Europe PMC] ❌ Not found");
            return { found: false, source: "europe_pmc", reason: "not_found" };

        } catch (e) {
            PdfCompanion.log("[Europe PMC] Error: " + e.message);
            return { found: false, source: "europe_pmc", reason: "error", error: e.message };
        }
    },

    /**
     * Search CORE for open access articles
     * Global OA aggregator with 200M+ articles
     */
    async searchCore(item) {
        let doi = item.getField("DOI");
        let title = item.getField("title");

        if (!doi && !title) return { found: false, source: "core", reason: "no_doi_title" };

        try {
            let query = doi || title;
            // CORE requires API key, using free endpoint
            let coreUrl = `https://api.core.ac.uk/v1/search?q=${encodeURIComponent(query)}&pageSize=10`;

            PdfCompanion.log("[CORE] Searching: " + query.substring(0, 80));

            let response = await new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                xhr.timeout = 15000;
                xhr.responseType = "json";
                xhr.onload = () => resolve(xhr.response);
                xhr.onerror = () => reject(new Error("CORE connection failed"));
                xhr.ontimeout = () => reject(new Error("CORE timeout"));
                xhr.open("GET", coreUrl);
                xhr.send();
            });

            if (response.results && response.results.length > 0) {
                let article = response.results[0];

                // Check for PDF URL
                if (article.pdfUrl) {
                    PdfCompanion.log("[CORE] ✅ Found: " + article.pdfUrl);
                    return {
                        found: true,
                        source: "core",
                        pdf_url: article.pdfUrl,
                        message: "Open access article found on CORE"
                    };
                } else if (article.downloadUrl) {
                    PdfCompanion.log("[CORE] ✅ Found: " + article.downloadUrl);
                    return {
                        found: true,
                        source: "core",
                        pdf_url: article.downloadUrl,
                        message: "Open access article found on CORE"
                    };
                }
            }

            PdfCompanion.log("[CORE] ❌ Not found");
            return { found: false, source: "core", reason: "not_found" };

        } catch (e) {
            PdfCompanion.log("[CORE] Error: " + e.message);
            return { found: false, source: "core", reason: "error", error: e.message };
        }
    },

    /**
     * Search Hindawi for open access articles
     * Major OA publisher with 300+ journals
     */
    async searchHindawi(item) {
        let doi = item.getField("DOI");
        let title = item.getField("title");

        if (!doi && !title) return { found: false, source: "hindawi", reason: "no_doi_title" };

        try {
            // Check if article is from Hindawi (DOI contains "hindawi")
            if (doi && doi.toLowerCase().includes("hindawi")) {
                let hindawiPdfUrl = `https://downloads.hindawi.com/journals/${doi.split(".hindawi.")[1]}.pdf`;
                PdfCompanion.log("[Hindawi] ✅ Found: " + hindawiPdfUrl);
                return {
                    found: true,
                    source: "hindawi",
                    pdf_url: hindawiPdfUrl,
                    message: "Article found on Hindawi (OA publisher)"
                };
            }

            PdfCompanion.log("[Hindawi] ❌ Not found (not Hindawi article)");
            return { found: false, source: "hindawi", reason: "not_hindawi" };

        } catch (e) {
            PdfCompanion.log("[Hindawi] Error: " + e.message);
            return { found: false, source: "hindawi", reason: "error", error: e.message };
        }
    },

    /**
     * Execute cascade search until PDF found
     * Returns result with source that succeeded
     */
    async cascadeSearch(item, toast) {
        let title = item.getField("title") || "Unknown";
        let results = [];

        for (let source of this.CASCADE_ORDER) {
            if (toast) {
                let statusMsg = this.getSourceSearchMessage(source);
                toast.update(statusMsg);
            }

            let result;

            switch (source) {
                case "arxiv":
                    result = await this.searchArxiv(item);
                    break;
                case "unpaywall":
                    result = { found: false, source: "unpaywall" }; // Handled by backend
                    continue;
                case "europe_pmc":
                    result = await this.searchEuropePmc(item);
                    break;
                case "pubmed":
                    result = { found: false, source: "pubmed" }; // Handled by backend
                    continue;
                case "hindawi":
                    result = await this.searchHindawi(item);
                    break;
                case "core":
                    result = await this.searchCore(item);
                    break;
                case "publisher_doi":
                    result = { found: false, source: "publisher_doi" }; // Handled by backend
                    continue;
                case "scihub":
                    result = { found: false, source: "scihub" }; // Handled by backend
                    continue;
                default:
                    continue;
            }

            results.push(result);
            PdfCompanion.log(`[Cascade] ${source}: ${result.found ? "✅ FOUND" : "❌ not found"}`);

            // Stop on first success
            if (result.found && result.pdf_url) {
                PdfCompanion.log("[Cascade] ✅ PDF FOUND from: " + source);
                return {
                    status: "success",
                    source: source,
                    pdf_url: result.pdf_url,
                    message: result.message || `PDF found on ${source}`
                };
            }
        }

        // If no source found PDF, log all attempts
        PdfCompanion.log("[Cascade] ❌ PDF not found in any source");
        PdfCompanion.log("[Cascade] Attempts: " + results.map(r => `${r.source}:${r.found ? "✅" : "❌"}`).join(", "));

        return {
            status: "not_found",
            message: "PDF not available from any open source",
            attempts: results
        };
    },

    /**
     * Get user-friendly message for search step
     */
    getSourceSearchMessage(source) {
        let messages = {
            "arxiv": "🔍 Searching arXiv (preprints)...",
            "unpaywall": "🔍 Searching Unpaywall (OA)...",
            "europe_pmc": "🔍 Searching Europe PMC...",
            "pubmed": "🔍 Searching PubMed Central...",
            "hindawi": "🔍 Searching Hindawi (OA publisher)...",
            "core": "🔍 Searching CORE (OA aggregator)...",
            "publisher_doi": "🔍 Checking publisher...",
            "scihub": "🔍 Checking Sci-Hub..."
        };
        return messages[source] || `🔍 Searching ${source}...`;
    }
};
