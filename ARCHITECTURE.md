# Architecture - Zotero PDF Companion

**Updated: 2026-06-19** - Architecture documentation for v4.16.2

## Vue d'ensemble

Plugin Zotero 7/8 intégrant l'infrastructure Onyx pour la gestion automatisée des PDFs et enrichissement bibliographique. Communication via SSE (Server-Sent Events) avec deux services backend:

- **zotero-manager** (8451): Récupération PDF, enrichissement, maintenance, ingestion
- **paper-reader** (8462): Analyse LLM des articles (lectures, synthèses)

## Structure des Fichiers

```
zotero-pdf-companion-plugin/
├── manifest.json              # Config WebExtension (Zotero 7/8)
├── onyx-manifest.json         # Config Forge/deployment
├── bootstrap.js               # Lifecycle: install/startup/shutdown/uninstall
├── pdfcompanion.js           # Logique principale (~2500 lignes)
├── prefs.js                  # Valeurs par défaut preferences
├── options.xhtml             # UI configuration (host, port)
├── options.js                # Logique page options
├── deploy.sh                 # Build XPI + deploy SSH
└── skin/
    ├── icon.png              # 48x48
    └── icon@2x.png           # 96x96
```

## Composants Principaux

### 1. **bootstrap.js** - Cycle de Vie
- `install()`: Enregistrement plugin
- `startup()`: Initialisation preferences, chargement pdfcompanion.js
- `onMainWindowLoad()`: Injection menus/listeners dans fenêtres Zotero
- `onMainWindowUnload()`: Nettoyage
- `shutdown()`: Libération ressources

### 2. **pdfcompanion.js** - Logique Métier

Objet global `PdfCompanion` avec:

#### Configuration
```js
config: {
  apiUrl: "http://10.0.0.21:8451",
  paperReaderUrl: "http://10.0.0.21:8462",
  useScihub: true,
  triggerDelay: 10000  // ms
}
```

#### Modules
- **PDF Recovery**: `/audit/recover-pdf-stream` → cascade 10 sources (backend)
- **Metadata Enrichment**: `/enrich/item-stream/{key}` → Abstract, DOI, ISSN, etc.
- **PDF Replacement**: `/item/{key}/replace-pdf/stream` → Détache anciens, attach nouveau
- **Paper Reading**: `/analyze/zotero-stream` → Analyse LLM (3 modes: standard/full/section)
- **Figure Extraction**: `POST /extract-figures/{zotero_key}` → Dropbox + JSON metadata
- **Collection Maintenance**: `/maintenance/collection/{key}/stream` → Batch recovery + enrichment
- **PDF Ingestion**: `POST /ingest/pdf` → GROBID parsing → item création
- **Collection Synthesis**: `/synthesize/collection/{key}/focused/stream` → Synthèse LLM

#### Toast Notification System (v4.5.0)
Overlay custom au lieu de `Zotero.ProgressWindow`:

```js
PdfCompanion.Toast = {
  notify(headline, msg, duration),    // Notif simple
  progress(headline),                 // SSE avec spinner
  // Méthodes: update(), setHeadline(), success(), error(), close()
}
```

#### Auto-detection
`Zotero.Notifier` observe ajouts items:
- Délai 10s avant vérification
- Types: journalArticle, conferencePaper, preprint, book, thesis
- PDF présent local (Chrome extension) → migration Dropbox via `/attach-pdf`
- PDF absent → cascade 10 sources + enrichissement

#### Menus Injectés
- **Tools > PDF Companion**: Actions + test connexion + logs
- **Clic-droit item**: Actions sur item sélectionné
- **Clic-droit collection**: Import, maintenance, synthèse

#### Fenêtre de Logs (v4.5.2)
- 100 dernières entrées
- Style console sombre
- Timestamps colorés (vert)
- Copy/Scroll buttons
- Fenêtre redimensionnable 900x600px

### 3. **prefs.js** - Preferences Par Défaut
```js
pref("extensions.pdfcompanion.serverHost", "10.0.0.21");
pref("extensions.pdfcompanion.serverPort", 8451);
```

### 4. **options.xhtml + options.js** - Interface Configuration
Formulaire pour:
- Host serveur (défaut: 10.0.0.21)
- Port zotero-manager (défaut: 8451)

### 5. **deploy.sh** - Deployment Automation
1. Build XPI (zip plugin files)
2. Récupère mot passe SSH via OnyxVault
3. SCP vers profil Zotero (172.16.0.2)
4. Mise à jour extensions.json via PowerShell distant
5. Vérification taille

## Communication Backend

### Protocole SSE
Toutes opérations longues utilisent Server-Sent Events:

```
1. XMLHttpRequest.open(POST, url)
2. xhr.setRequestHeader("Accept", "text/event-stream")
3. xhr.onprogress() → parse "data: {json}" → toast.update()
4. xhr.onload() → resolve result
```

Chaque event `data:` contient JSON avec champ `step` ou `event` pour progression.
Plugin lit `data.event || data.step` pour compatibilité avec les deux formats backend.

### Endpoints Utilisés

#### zotero-manager (8451)
- `POST /audit/recover-pdf-stream` → Recovery avec cascade sources
- `GET /enrich/item-stream/{key}` → Enrichissement métadonnées
- `POST /item/{key}/replace-pdf/stream` → Remplacement PDF
- `POST /item/{key}/attach-pdf` → Ajout PDF simple
- `POST /extract-figures/{zotero_key}` → Extraction figures
- `GET /maintenance/collection/{key}/stream` → Maintenance batch
- `POST /ingest/pdf` → Ingestion GROBID
- `GET /synthesize/collection/{key}/focused/stream` → Synthèse

#### paper-reader (8462)
- `POST /analyze/zotero-stream` → Analyse articles (3 modes)

## Versions et Compatibilité

- **Zotero**: 6.999 - 8.0.*
- **Manifest Version**: 2 (WebExtension-like)
- **Plugin Version**: 4.16.2
- **Backend**: Axon (10.0.0.21)

## Dépendances

### Runtime
- Zotero API (Notifier, Prefs, debug)
- XMLHttpRequest (SSE)
- DOM manipulation (menus, overlays)

### Deployment
- OpenSSL (certificats self-signed)
- SSH (SCP transfer)
- PowerShell (Windows remote)
- OnyxVault (credentials)

## Points d'Extension

### Avant Chaque Commit
1. Tester plugin dans Zotero 7 ET 8
2. Vérifier SSE parsing (network tab)
3. Tester menus (3 contextes)
4. Vérifier logs (100+ entries)
5. Valider déploiement: `./deploy.sh`

### Maintenance
- Buffer logs: 100 entrées max (rotating)
- Version bump: manifest.json + onyx-manifest.json sync
- Backend URLs: tester accessibilité
- Toast lifecycle: guard `closed` prevents no-ops

## Utility Features (v4.16.2)

### Copy Item ID / Copy Collection ID

**Nouvelles fonctionnalités**:
- `copyItemId()`: Copie l'ID Zotero d'un item au presse-papiers
- `copyCollectionId()`: Copie l'ID d'une collection au presse-papiers

**Implémentation**:
- Clipboard API: `Zotero.Utilities.Internal.copyTextToClipboard()` avec fallback
- Toast notification avec l'ID copié
- Menu items ajoutés à:
  - Tools > PDF Companion > Copy Item ID
  - Item context menu > PDF Companion > Copy Item ID
  - Collection context menu > PDF Companion > Copy Collection ID

**Avantages**:
- Permet export/automation avec IDs Zotero
- API clipboard compatible Zotero 7 & 8
- Fallback graceful si API change

## Décisions Architecturales

1. **Toast custom vs Zotero.ProgressWindow**: Overlay dans DOM (problème multi-moniteur Gecko #98830)
2. **SSE vs WebSocket**: Pas besoin bidirectionnel, SSE plus simple
3. **Configuration preferences**: Évite hardcoding, permet test multi-hosts
4. **Auto-detection avec délai**: Laisse Zotero finir initialisation item
5. **Logging circulaire (100 max)**: Balance verbosité vs mémoire
6. **Clipboard API abstraction**: Try/catch pour compatibilité Zotero 7/8
