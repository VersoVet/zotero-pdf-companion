# API Endpoints - Zotero PDF Companion

**Updated: 2026-06-19** - API endpoints documentation for Zotero PDF Companion plugin v4.16.2

Le plugin consomme deux services backend via API HTTP avec communication SSE.

## Services Backend

| Service | Host | Port | Role |
|---------|------|------|------|
| **zotero-manager** | 10.0.0.21 | 8451 | PDF recovery, metadata enrichment, maintenance, ingestion |
| **paper-reader** | 10.0.0.21 | 8462 | LLM article analysis (reading notes, syntheses) |

Configuration via preferences plugin:
```
extensions.pdfcompanion.serverHost = "10.0.0.21"  # Configurable
extensions.pdfcompanion.serverPort = 8451         # Configurable
paperReaderPort = 8462                            # Hard-coded
```

---

## zotero-manager (Port 8451)

### PDF Recovery - SSE Stream

**Endpoint**: `POST /audit/recover-pdf-stream`

Récupère automatiquement un PDF manquant avec cascade de sources.

**Request**:
```json
{
  "item_key": "ABC123XYZ",
  "doi": "10.1234/example",
  "title": "Article Title",
  "author": "Smith et al.",
  "publication_year": 2023,
  "source": "manual"  // ou "auto" (auto-detection trigger)
}
```

**Response (SSE)**: Événements `data: {json}` ligne par ligne
```json
{"step": 1, "event": "checking_unpaywall", "status": "Checking Unpaywall..."}
{"step": 2, "event": "source_found", "source": "unpaywall", "status": "PDF trouvé"}
{"step": 3, "event": "downloaded", "size_mb": 2.3, "status": "Downloaded"}
```

**Sources Cascade**:
1. Unpaywall (Open Access)
2. PubMed Central
3. Publisher (DOI redirect)
4. Sci-Hub (si useScihub: true)

**Final Response**:
```json
{
  "success": true,
  "pdf_url": "http://...",
  "size_mb": 2.3,
  "source": "unpaywall",
  "message": "PDF successfully recovered"
}
```

---

### Metadata Enrichment - SSE Stream

**Endpoint**: `GET /enrich/item-stream/{key}`

Enrichit les métadonnées d'un item (abstract, DOI, ISSN, publisher, etc.).

**Parameters**:
- `{key}`: Clé Zotero de l'item (ex: ABC123XYZ)

**Response (SSE)**:
```json
{"step": 1, "event": "fetching_metadata", "field": "abstract"}
{"step": 2, "event": "enriching", "field": "doi", "value": "10.1234/xxx"}
{"step": 3, "event": "complete", "fields_added": 3}
```

**Usage**:
- Item unique: enrichissement direct + notification résultat
- Batch (multi-select): progression `X/Y` dans toast unique

---

### PDF Replacement - SSE Stream

**Endpoint**: `POST /item/{key}/replace-pdf/stream`

Remplace le PDF attaché par un nouveau (supprime anciens, attache nouveau).

**Parameters**:
- `{key}`: Clé Zotero de l'item

**Request**: multipart/form-data
```
file: <PDF binary>
```

**Response (SSE)**:
```json
{"step": 1, "event": "removing_old_pdfs"}
{"step": 2, "event": "uploading_new", "size_mb": 1.5}
{"step": 3, "event": "syncing", "status": "Syncing with library"}
{"step": 4, "event": "complete"}
```

---

### PDF Attachment (Simple)

**Endpoint**: `POST /item/{key}/attach-pdf`

Attache un PDF local sans supprimer les anciens.

**Parameters**:
- `{key}`: Clé Zotero de l'item

**Request**: multipart/form-data
```
file: <PDF binary>
```

**Response**: JSON
```json
{
  "success": true,
  "attachment_key": "XYZ789",
  "message": "PDF attached successfully"
}
```

**Notification**: Toast notification à la fin (pas SSE).

---

### Figure Extraction

**Endpoint**: `POST /extract-figures/{zotero_key}`

Extrait les figures du PDF et les upload sur Dropbox.

**Parameters**:
- `{zotero_key}`: Clé Zotero de l'item

**Request**: JSON
```json
{
  "dropbox_token": "...",
  "extract_captions": true
}
```

**Response**:
```json
{
  "success": true,
  "figures_count": 5,
  "figures": [
    {
      "index": 1,
      "label": "Figure 1",
      "caption": "Example figure caption",
      "page": 3
    }
  ],
  "dropbox_path": "/Articles/Example/figures.json"
}
```

**Attachment JSON**: Créé dans Zotero avec métadonnées des figures.

---

### Collection Maintenance - SSE Stream

**Endpoint**: `GET /maintenance/collection/{key}/stream`

Traite tous les items d'une collection (batch):
- Récupération PDFs manquants
- Enrichissement métadonnées
- Progression item par item

**Parameters**:
- `{key}`: Clé Zotero de la collection

**Response (SSE)**:
```json
{"step": 1, "event": "starting", "total_items": 42}
{"step": 2, "event": "processing_item", "item_no": 1, "title": "Article A", "progress": "1/42"}
{"step": 3, "event": "pdf_recovered", "source": "unpaywall"}
{"step": 4, "event": "metadata_enriched", "fields": 3}
...
{"step": 42, "event": "complete", "recovered": 10, "enriched": 25}
```

---

### PDF Ingestion - GROBID Parsing

**Endpoint**: `POST /ingest/pdf`

Ingère des PDFs locaux, extrait métadonnées via GROBID, crée items Zotero.

**Request**: multipart/form-data
```
files: [file1.pdf, file2.pdf, ...]
collection_key: XYZ789  // Clé collection cible
```

**Response**: JSON
```json
{
  "success": true,
  "items_created": 2,
  "items": [
    {
      "key": "ABC123",
      "title": "Parsed Title",
      "authors": "Author A, Author B",
      "year": 2023
    }
  ]
}
```

---

### Collection Synthesis - Focused/Deep

**Endpoint**: `GET /synthesize/collection/{key}/focused/stream`

Génère une synthèse LLM de la collection avec paramètres de focalisation.

**Parameters**:
- `{key}`: Clé Zotero de la collection
- Query params:
  - `focus`: Orientation thématique (ex: "research methodology")
  - `level`: compact / medium / full
  - `include_subcollections`: true/false

**Request**:
```json
{
  "focus": "Machine Learning applications",
  "level": "medium",
  "include_subcollections": true
}
```

**Response (SSE)**: Logs en temps réel du LLM
```json
{"step": 1, "event": "analyzing_items", "count": 42}
{"step": 2, "event": "llm_processing", "progress": "10/42"}
{"step": 3, "event": "log", "text": "[LLM] Analyzing paper 1..."}
...
{"step": N, "event": "complete", "markdown_attachment": "XYZ789"}
```

**Final Result**: Markdown attaché à un item "Synthesis" dans la collection.

---

## paper-reader (Port 8462)

### Article Analysis - LLM Reading

**Endpoint**: `POST /analyze/zotero-stream`

Analyse un article et génère une fiche de lecture LLM.

**Request**:
```json
{
  "item_key": "ABC123XYZ",
  "pdf_url": "http://...",
  "mode": "standard",  // standard, full, section
  "options": {
    "include_figures": true,
    "extract_citations": true
  }
}
```

**Modes**:

| Mode | Description | Output |
|------|-------------|--------|
| `standard` | Lecture rapide, synthèse | Fiche synthétique (~500 mots) |
| `full` | Lecture complète, détail | Fiche détaillée (~2000 mots) |
| `section` | Analyse section par section | Sections numérotées avec synthèse |

**Response (SSE)**:
```json
{"step": 1, "event": "downloading_pdf", "url": "..."}
{"step": 2, "event": "parsing_text", "pages": 12}
{"step": 3, "event": "llm_analyzing", "progress": "30%"}
{"step": 4, "event": "generating_notes", "mode": "standard"}
{"step": 5, "event": "complete", "word_count": 542}
```

**Output JSON** (attaché à l'item):
```json
{
  "mode": "standard",
  "title": "Article Title",
  "summary": "...",
  "objectives": "Research questions and aims",
  "methodology": "Methods used",
  "key_results": ["Result 1", "Result 2"],
  "discussion": "Interpretation and implications",
  "key_takeaways": ["Point 1", "Point 2"],
  "citations": ["Ref 1", "Ref 2"],
  "metadata": {
    "generated_at": "2024-01-15T10:30:00Z",
    "reading_time_minutes": 15
  }
}
```

**Display Existing Notes**: Fenêtre HTML formatée avec sections colorées (Tools > PDF Companion > Show Reading Notes).

---

## Configuration SSE

### Headers Requis
```
Accept: text/event-stream
Content-Type: application/json
```

### Format SSE
Chaque ligne reçue:
```
data: {"step": N, "event": "...", "status": "..."}

```

### Parsing Client
```js
xhr.onprogress = () => {
  const lines = xhr.responseText.split('\n');
  const lastLine = lines[lines.length - 2];  // Avant dernière ligne
  if (lastLine.startsWith('data: ')) {
    const json = JSON.parse(lastLine.substring(6));
    toast.update(json.status);
  }
}
```

---

## Error Handling

### HTTP Errors
```json
{
  "error": "PDF not found in any source",
  "code": "PDF_NOT_FOUND",
  "message": "No PDF available for this DOI",
  "retry_possible": true
}
```

### SSE Errors
Même format JSON dans le stream avec champ `event: "error"`:
```json
{"step": 1, "event": "error", "message": "Network timeout", "retry": true}
```

### Client Guard
- Toast: ferme automatiquement après `success()` ou `error()` (5s)
- Guard `closed`: empêche no-ops après `close()`
- Fallback: pas de fenêtre disponible → no-op silencieux

---

## Utility Functions (v4.16.2)

### Copy Item ID

**Menu**: Tools > PDF Companion > Copy Item ID (ou item context menu)

Copie l'ID Zotero (clé) de l'item sélectionné au presse-papiers.

**Usage**:
- Sélectionner un item dans la bibliothèque
- Menu Tools > PDF Companion > Copy Item ID
- Ou clic-droit sur item > PDF Companion > Copy Item ID
- ID copié au presse-papiers, notification affichée

**Response**: Toast notification avec ID + confirmation

### Copy Collection ID

**Menu**: Collection context menu (clic-droit sur collection)

Copie l'ID Zotero (clé) de la collection sélectionnée au presse-papiers.

**Usage**:
- Clic-droit sur collection dans l'arbre
- PDF Companion > Copy Collection ID
- ID copié au presse-papiers, notification affichée

**Response**: Toast notification avec ID + confirmation

---

## Testing

### Vérifier Connectivité
```js
// Via console Zotero
var xhr = new XMLHttpRequest();
xhr.open('GET', 'http://10.0.0.21:8451/health');
xhr.send();
// Doit retourner 200 OK
```

### Test Recovery
```js
PdfCompanion.recoverPDF({
  item_key: "XYZ789",
  doi: "10.1234/test"
});
// Affiche toast avec progression
```

### Test Enrichment
```js
PdfCompanion.enrichItem("XYZ789");
// Affiche toast avec progression
```

---

## Versions et Maintenance

| Version | Date | Changes |
|---------|------|---------|
| 4.13.1 | 2024-01 | Migrate backend to Axon (10.0.0.21) |
| 4.13.0 | 2024-01 | Add Zotero 8 compatibility fixes |
| 4.5.3 | 2023-12 | Add figure extraction and display |
| 4.5.2 | 2023-12 | Add dedicated logs window |
| 4.5.1 | 2023-12 | Add Toast overlay notification system |

---

## Deployment Notes

- Backend URLs: configurables via preferences plugin
- Paper-Reader: hard-codé à port 8462 (TODO: rendre configurable)
- SSE timeout: 30s par défaut (ajustable)
- Auto-recovery delay: 10s (délai avant déclenchement)
