# PDF Companion for Zotero

Plugin Zotero 7/8 d'integration avec l'infrastructure Onyx pour la gestion bibliographique automatisee.

## Backends requis

| Service | Port par defaut | Role |
|---------|----------------|------|
| zotero-manager | 8451 | API principale (PDF recovery, enrichissement, maintenance, ingestion) |
| paper-reader | 8462 | Analyse LLM des articles (fiches de lecture, syntheses) |

Les endpoints sont configurables dans les preferences du plugin (host + port).

## Fonctionnalites

### Recuperation automatique de PDF

A l'ajout d'un item dans Zotero, le plugin detecte automatiquement si un PDF est deja attache. Si non, il lance une recuperation via SSE (`/audit/recover-pdf-stream`) avec cascade de sources :

1. Unpaywall (open access)
2. PubMed Central
3. Publisher (DOI redirect)
4. Sci-Hub (optionnel)

Delai de declenchement configurable (defaut : 10s apres ajout).

### Enrichissement de metadonnees

Endpoint SSE `/enrich/item-stream/{key}`. Ajoute ou complete les champs manquants (abstract, DOI, ISSN, etc.) via des sources externes.

- **Item unique** : enrichissement direct avec notification du resultat
- **Batch** : selection multiple, progression `X/Y` dans un toast unique

### Remplacement de PDF

Upload d'un PDF local via `/item/{key}/replace-pdf/stream` (SSE). Supprime les anciens attachements PDF, attache le nouveau, sync automatique.

### Joindre un PDF local

Upload simple via `/item/{key}/attach-pdf` (POST multipart). Pas de SSE, notification a la fin.

### Lecture d'article (Paper Reader)

Trois modes de lecture via SSE (`/analyze/zotero-stream`) :

| Mode | Description |
|------|-------------|
| `standard` | Lecture rapide, fiche synthetique |
| `full` | Lecture complete, fiche detaillee |
| `section` | Analyse section par section |

Genere une fiche de lecture JSON attachee a l'item Zotero. Les fiches contiennent :
- Synthese de l'objectif, methodologie, resultats, discussion
- Points cles extraits avec citations sources
- Metadonnees de l'article

Les fiches existantes sont consultables via le menu "Afficher les lectures" (ouverture dans une fenetre HTML formatee avec sections colorees).

### Extraction et affichage des figures (v4.5.3)

Deux fonctionnalites pour les figures d'articles :

**Extraire les figures** (`POST /extract-figures/{zotero_key}`) :
- Extraction automatique des figures du PDF via Paper-Reader
- Upload sur Dropbox dans le dossier de l'article
- Creation d'un attachement JSON avec les metadonnees des figures

**Afficher les figures** :
- Galerie visuelle avec miniatures cliquables
- Modal plein ecran pour chaque figure
- Affichage du label, page et caption

### Maintenance de collection

Endpoint SSE `/maintenance/collection/{key}/stream`. Traite automatiquement tous les items d'une collection :
- Recuperation des PDFs manquants
- Enrichissement des metadonnees
- Progression item par item avec compteur

### Import de PDFs par ingestion GROBID

Selection de fichiers PDF locaux, ingestion via `/ingest/pdf` (POST multipart). Chaque PDF est analyse par GROBID pour extraire les metadonnees, puis l'item est cree et ajoute a la collection selectionnee.

### Synthese de collection

Interface formulaire dans une fenetre dediee. Parametres :
- **Focus** : orientation thematique de la synthese
- **Niveau** : compact / moyen / complet

SSE via `/synthesize/collection/{key}/focused/stream`. Affichage en temps reel du log dans un terminal integre, puis ouverture du Markdown genere dans une fenetre formatee.

### Consultation des syntheses

Charge les items "Synthese" d'une collection, telecharge les attachements Markdown associes, et affiche dans une fenetre HTML. Si plusieurs syntheses existent, une liste de selection est presentee.

## Architecture du plugin

### Fichiers

| Fichier | Role |
|---------|------|
| `manifest.json` | Manifeste Zotero 7/8 (WebExtension-like) |
| `bootstrap.js` | Point d'entree : lifecycle `install/startup/shutdown/uninstall` |
| `pdfcompanion.js` | Logique principale (~2000 lignes) |
| `prefs.js` | Valeurs par defaut des preferences |
| `options.xhtml` | Page de configuration (host, port) |
| `options.js` | Logique de la page de configuration |
| `deploy.sh` | Script de build XPI + deploiement SSH vers le PC Zotero |

### Menus

Le plugin injecte trois menus dans l'UI Zotero :

- **Tools > PDF Companion** : toutes les actions + test connexion + logs
- **Clic-droit item > PDF Companion** : actions sur l'item selectionne
- **Clic-droit collection > PDF Companion** : import, maintenance, synthese

### Fenetre de logs (v4.5.2)

Accessible via `Tools > PDF Companion > Show Logs`. Affiche les 100 dernieres entrees du buffer de log dans une fenetre dediee :

- Zone scrollable avec style console sombre
- Timestamps en surbrillance verte
- Bouton **Copy to Clipboard** pour copier tout le log
- Boutons **Scroll to Top/Bottom** pour navigation rapide
- Auto-scroll vers le bas au chargement
- Fenetre redimensionnable (900x600px)

### Systeme de notification : Toast Overlay (v4.5.0)

Remplace `Zotero.ProgressWindow` (fenetres OS separees, bug multi-moniteurs Gecko #98830) par un overlay injecte dans le DOM de la fenetre principale Zotero.

**Composant** : `PdfCompanion.Toast`

```
Injection DOM :
  <head> <- <style id="pdfcompanion-toast-style">
  <body> <- <div id="pdfcompanion-toast-container">  (position: fixed, bottom-right, z-index 99999)
              <- <div class="pdfcompanion-toast">     (par notification)
```

**API** :
```js
// Notification simple (auto-close)
PdfCompanion.Toast.notify(headline, message, duration)

// Progression SSE (spinner anime)
let toast = PdfCompanion.Toast.progress(headline)
toast.update(text)        // met a jour le message
toast.setHeadline(text)   // change le titre
toast.success(text)       // icone check verte + auto-close 4s
toast.error(text)         // icone croix rouge + auto-close 5s
toast.close()             // ferme immediatement
```

Caracteristiques :
- Fond sombre semi-transparent, 320px, coins arrondis, ombre
- Icones SVG inline (spinner, check, cross) - zero dependance externe
- Animation CSS fade-in/out
- Clic pour fermer
- Guard `closed` : les methodes sont no-op apres `close()`/`success()`/`error()`
- Fallback no-op si aucune fenetre disponible

### Communication SSE

Toutes les operations longues utilisent le pattern SSE (Server-Sent Events) via `XMLHttpRequest` :

```
xhr.open(method, url)
xhr.setRequestHeader("Accept", "text/event-stream")
xhr.onprogress -> parse "data: {json}" -> toast.update()
xhr.onload -> resolve final result
```

Le parsing SSE est ligne par ligne dans `onprogress`. Chaque event `data:` contient un JSON avec un champ `step` ou `event` indiquant la progression.

### Auto-detection

Un `Zotero.Notifier` observe les ajouts d'items. Apres un delai (10s), le plugin verifie si l'item est un type academique (journalArticle, conferencePaper, preprint, book, thesis) et s'il a deja un PDF. Selon le cas :
- **Pas de PDF** : recovery + enrichissement
- **PDF present** : enrichissement seul

## Deploiement

```bash
./deploy.sh
```

1. Build du XPI (zip des fichiers du plugin)
2. Recuperation du mot de passe SSH via OnyxVault
3. SCP vers le profil Zotero du PC distant
4. Mise a jour de `extensions.json` via PowerShell distant
5. Verification de taille

Redemarrer Zotero apres deploiement.

## Configuration

Preferences accessibles via `Options` du plugin dans Zotero :

| Preference | Defaut | Description |
|-----------|--------|-------------|
| `extensions.pdfcompanion.serverHost` | `10.0.0.21` | IP du serveur backend (Axon) |
| `extensions.pdfcompanion.serverPort` | `8451` | Port zotero-manager |

Le port Paper Reader (8462) est en dur dans le code.
