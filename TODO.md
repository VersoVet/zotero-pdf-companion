# TODO - Zotero PDF Companion

## Known Issues & Limitations

### ✅ [RESOLVED] CrossRef finds article but PDF behind paywall

**Status**: RESOLVED (Not a bug - expected behavior)  
**Severity**: Low (user education)  
**Reported**: 2026-05-04  
**Article**: DOI 10.1016/j.abb.2017.05.009 - "Repulsive surfaces and lamellar lubrication..."

**Root Cause**:
Article is published by **Elsevier BV** - a commercial paywall publisher.
- CrossRef correctly finds the article metadata ✅
- But PDF is **behind Elsevier paywall** 🔒
- **NO legal open access** available:
  - Unpaywall: ❌ Not OA
  - PubMed Central: ❌ Not available
  - Crossref: ❌ Paywall only

**System Behavior** (CORRECT):
1. Searches all legal sources (Unpaywall, PubMed, CrossRef) ✅
2. Finds article on CrossRef ✅
3. Cannot retrieve free PDF ❌
4. Reports "not found" as expected

**This is NOT a bug** - the system correctly identifies that the PDF
is not freely available. Many Elsevier articles (published pre-2020)
do not have open access.

**User Options**:
1. Access via university/institutional license (VPN)
2. Request PDF from authors directly
3. Attach PDF manually if you have it
4. Purchase access from publisher ($30-50)

---

## Bugs Actifs

### ✅ [FIXED] Enrichissement n'applique pas les modifications aux champs

**Status**: FIXED (commit 8c4cce5)  
**Severity**: Critical  
**Reported**: 2026-05-04  
**Fixed**: 2026-05-04

**Root Cause**:
`enrichMetadata()` recevait les champs enrichis du backend mais ne les appliquait JAMAIS à l'item Zotero. 
- Backend retourne : `result.fields_updated: {abstract: "...", doi: "10.xxx", ...}`
- Plugin collectait ces données pour logging UNIQUEMENT
- `item.reload()` ne rechargeait que depuis Zotero local, pas depuis le résultat du backend

**Solution Applied**:
1. Extraction des `fields_updated` du résultat final
2. Application via `item.setField(field, value)` pour chaque champ
3. Sauvegarde avec `item.saveTx()`
4. Logging détaillé pour chaque application

```js
// BEFORE: juste log + reload
await item.reload();

// AFTER:
for (let [field, value] of Object.entries(finalResult.result.fields_updated)) {
    item.setField(field, value);
}
await item.saveTx();
await item.reload();
```

**Result**: Enrichissement applique maintenant les métadonnées enrichies ✅

---

### ✅ [FIXED] Auto-enrichissement n'utilise pas recovery

**Status**: FIXED (commit 7eed245)  
**Severity**: High  
**Reported**: 2026-05-04  
**Fixed**: 2026-05-04

**Root Cause**:
`processPendingItems()` supprimait le mécanisme de vérification avant/après qui appelait `recoverPdf()` en fallback. Le code appelait SEULEMENT `enrichMetadata()` sans vérifier si la récupération réussie.

**Solution Applied**:
Restauré la logique de vérification (commit 6aefe26) :
1. Check PDF avant enrichissement
2. Appelle enrichMetadata() (contient déjà logique recovery)
3. Si PDF toujours absent APRÈS enrichment → appelle explicitement `recoverPdf(silent=true)`

```js
let hasPdf = await this.itemHasPdfAttachment(item);
await this.enrichMetadata(item);

if (!hasPdf) {
    let hasPdfNow = await this.itemHasPdfAttachment(item);
    if (!hasPdfNow) {
        await this.recoverPdf(item, true);  // silent=true
    }
}
```

**Result**: Auto-detection utilise maintenant la cascade complète (Unpaywall → PubMed → DOI → Sci-Hub) ✅

---

### 🟡 Version Mismatch

**Status**: OPEN  
**Severity**: Medium

**Problem**:
- `manifest.json` : version 4.13.1
- `onyx-manifest.json` : version 4.9.24
- Version mismatch de 0.3.7 entre les deux fichiers

**Fix**:
- [ ] Aligner versions (probablement faire: onyx-manifest.json = 4.13.1)
- [ ] Vérifier git log pour comprendre divergence

---

## Tâches Forge Validation (2026-05-04)

### ✅ Completed
- [x] Régénérer CLAUDE.md
- [x] Créer ARCHITECTURE.md
- [x] Créer API.md
- [x] Créer TODO.md

### 🔄 In Progress
- [ ] Corriger manifest.json (forge.type, forge.development, routing.port)
- [ ] Compléter .gitignore (patterns sécurité)

### ⏳ Pending
- [ ] Re-valider Forge (./forge-validate)
- [ ] Fix auto-enrichissement bug
- [ ] Synchroniser versions

---

## Feature Requests & Enhancements

### ✅ [COMPLETED] Expand PDF recovery sources

**Status**: COMPLETED (v4.16.0, 2026-05-04)  
**Implémenté dans**: backend zotero-manager (pdf_resolver.py)

**Cascade 10 sources (ordre d'exécution)**:
1. **Unpaywall** - OA metadata
2. **arXiv** - Préprints (physics, math, CS, bio)
3. **Europe PMC** - Biomedical OA (45M+ articles)
4. **CORE** - Multi-disciplinary OA (200M+ articles)
5. **CrossRef** - Liens PDF dans métadonnées
6. **Direct Publisher** - MDPI, Frontiers CDN
7. **DOI Redirect** - Scraping page éditeur
8. **Hindawi** - Éditeur OA (DOIs hindawi)
9. **PubMed Central** - NIH/NCBI
10. **Sci-Hub** - Fallback (via PubMed puis DOI)

Messages numérotés `[1/10]` à `[10/10]` avec emoji ✅/❌ dans SSE.

---

### 🟠 [ENHANCEMENT] Add Google Scholar PDF recovery

**Status**: Proposed  
**Priority**: Medium  
**Difficulty**: High

**Benefits**:
- Find pre-prints and post-prints (often free)
- Access via university repositories
- Better coverage for older/niche articles

**Challenges**:
- Google Scholar has NO official API
- Blocks automated requests (scraping)
- Scraping violates Terms of Service

**Solutions**:
1. **SerpAPI (Recommended)**
   - Official API for Google Scholar
   - Reliable, legal, no scraping
   - Cost: ~$0.01 per request
   - Integrates with Node.js/Python

2. **ScraperAPI (Risky)**
   - Proxy-based, bypasses blocks
   - But: violates Google ToS, can be detected
   - Higher latency, less reliable

3. **Custom Scraper (Not Recommended)**
   - Parse Google Scholar HTML directly
   - Fragile: breaks when Google changes layout
   - High maintenance burden

**Recommendation**:
- If budget available: SerpAPI + scholarly.js library
- Otherwise: improve Unpaywall/PubMed coverage instead
- Unpaywall + PubMed already cover ~60% of cases

---

## Features Complètement Implémentés

### ✅ Core Features (Production)
- [x] PDF Recovery (Unpaywall → PubMed → DOI → Sci-Hub)
- [x] Metadata Enrichment (abstract, DOI, ISSN, etc.)
- [x] PDF Replacement/Attachment
- [x] Paper Reading (LLM analysis - 3 modes)
- [x] Figure Extraction & Display
- [x] Collection Maintenance (batch recovery + enrich)
- [x] PDF Ingestion (GROBID parsing)
- [x] Collection Synthesis (focused + deep modes)
- [x] Toast Notification System (custom overlay)
- [x] Logging Window (100 entries, export)
- [x] Zotero 6.999-8.0.* compatibility

### ✅ Backend Integration
- [x] Migrate to Axon (10.0.0.21)
- [x] SSE Communication (all endpoints)
- [x] OAuth/Vault for credentials
- [x] Paper-Reader integration (8462)

### ✅ UI/UX
- [x] Three context menus (Tools, item, collection)
- [x] Preferences dialog (host, port)
- [x] Toast progress notifications
- [x] Dedicated logs window
- [x] Reading notes display (HTML formatted)
- [x] Figure gallery viewer

---

## Known Limitations

### ⚠️ Paper-Reader Port Hard-Coded
**Issue**: `paperReaderPort = 8462` en dur dans `pdfcompanion.js`  
**Impact**: Pas de flexibilité si Paper-Reader sur port différent  
**Priority**: Low  
**Fix**: Rendre configurable via preferences UI  

**Code Location**: `pdfcompanion.js:15`
```js
paperReaderPort: 8462  // TODO: make configurable
```

---

### ⚠️ SSL/TLS Self-Signed Certs
**Issue**: Backend Axon utilise certificats auto-signés  
**Current**: Bypass implémenté dans fetch wrapper  
**Status**: Working but risky for production  
**Improvement**: Valider certificat ou ajouter pinning  

---

## Maintenance Schedule

| Task | Frequency | Last Done | Next |
|------|-----------|-----------|------|
| Bump version (manifest.json + onyx-manifest.json) | Per release | 2024-01 | TBD |
| Test Zotero 8 compatibility | Monthly | 2024-01 | TBD |
| Review backend URLs | Monthly | 2024-01 | TBD |
| Clear log buffer if needed | Manual | N/A | On demand |
| Check Paper-Reader availability | Daily (in tests) | 2024-01 | TBD |

---

## Documentation TODOs

- [ ] Add code comments in `pdfcompanion.js` (>2500 lignes, hard to follow)
- [ ] Document SSE format in code comments
- [ ] Add inline examples for each endpoint
- [ ] Create TROUBLESHOOTING.md for common issues

---

## Release Notes (Latest)

### v4.13.1 (2024-01-??)
- Feat: Migrate backend to Axon (10.0.0.21)
- Fix: Correct z490 IP address to 172.16.0.3
- Fix: Correct API endpoints to match API.md documentation
- Feat: Integrate focused-deep endpoint with new parameters
- Debug: Add detailed logging for which ZoteroPane method works

### v4.13.0 (2024-01-??)
- Feat: Add Zotero 8 compatibility (getSelectedItems fallback)
- Debug: Improve logging for method resolution

### v4.5.3 (2023-12-??)
- Feat: Figure extraction and gallery display
- Feat: Dropbox integration for figure storage

### v4.5.2 (2023-12-??)
- Feat: Dedicated logs window with export button
- Feat: Auto-scroll to bottom + manual scroll controls

### v4.5.0 (2023-12-??)
- Feat: Toast overlay notification system (replaces Zotero.ProgressWindow)
- Fix: Multi-monitor support (no more separate OS windows)

---

## Next Steps (Priority Order)

1. **FIX AUTO-ENRICHISSEMENT** (Critical)
   - Debug: Appel endpoint recovery vs enrich
   - Test: Cascade sources en auto vs manual
   - Deploy: Fix + validation
   - Time estimate: 1-2 hours

2. **Sync Versions**
   - Align manifest.json & onyx-manifest.json
   - Understand divergence in git history

3. **Complete Forge Validation**
   - Fix manifest.json validation errors
   - Re-run ./forge-validate

4. **Consider Making Paper-Reader Port Configurable**
   - Low priority, but improves flexibility
