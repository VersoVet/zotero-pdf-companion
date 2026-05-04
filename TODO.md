# TODO - Zotero PDF Companion

## Known Issues & Limitations

### 🟡 [INVESTIGATING] CrossRef download fails for some articles

**Status**: Under investigation  
**Severity**: Medium  
**Reported**: 2026-05-04  
**Article**: "Proteomic, mechanical, and biochemical characterization of cartilage development"

**Symptom**:
- Backend finds article on CrossRef ✅
- But PDF download fails ❌
- Toast shows progress but no PDF attached

**Possible Causes**:
1. CrossRef API returns DOI but without PDF URL
2. PDF URL is behind paywall (no open access)
3. SSL/certificate issue downloading from CrossRef server
4. Timeout during large file download
5. Article metadata doesn't include PDF link

**How to Debug**:
1. Check Tools > PDF Companion > Show Logs
   - Look for "crossref" events
   - Find exact error message
2. Note DOI of article (from Zotero)
3. Try other sources (Unpaywall, PubMed, Sci-Hub)
   - If one works: CrossRef-specific issue
   - If none work: broader problem

**Workaround**:
- Use Sci-Hub as fallback
- Or attach PDF manually via "Joindre un PDF"

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
