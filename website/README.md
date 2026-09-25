# AI Foam Cut – Website

Rein statische Seite im Ordner `site/`: `index.html` (deutsch), `index-en.html` (englisch),
`rechtliches.html`, `style.css`, `img/`. Kein Server, keine Datenbank, keine Abhängigkeiten,
kein Skript von Dritten. Damit läuft sie bei jedem Hoster für statische Seiten.

Seit der Umstellung auf Open Source (GPL-3.0) gibt es keine Demo-Lizenzen und keinen Verkauf
mehr. Die frühere Schnittstelle `/api/demo` samt Worker-Skript und KV-Speicher ist entfallen —
`wrangler.jsonc` liefert nur noch statische Dateien aus.

## Veröffentlichen

Mit Cloudflare (aktuelle Einrichtung, Domain `ai-foam-cut.com`):

```
npx wrangler deploy
```

Ohne Cloudflare genügt es, den Inhalt von `site/` hochzuladen — z. B. Netlify Drop,
GitHub Pages, Vercel oder Neocities. `index.html` ist die Startseite.

## Beim Ändern beachten

- **PayPal.me-Adresse**: eingetragen (`https://paypal.me/AIfoamcut`) — steht im Abschnitt
  „Projekt unterstützen“ / „Support the project“ in **beiden** Sprachfassungen.
- **Repository-Adresse**: Alle Links zeigen auf `github.com/aifoamcut/ai-foam-cut`.
  Falls das Repository anders heißt, in beiden Sprachfassungen ersetzen.
- **Version im Download-Kasten**: Zeile mit `class="download-meta"` in beiden Fassungen.

## Downloads

Die Programmdateien liegen **nicht** auf dieser Website, sondern bei GitHub:

- fertige Windows-Version: `releases/latest/download/AI-Foam-Cut.exe`
- Quellcode: das Repository selbst

Für eine neue Version genügt ein GitHub-Release mit der .exe unter genau diesem Namen; die
Links auf der Website bleiben unverändert. Nur die Versionsangabe im Download-Kasten anpassen.

## Kontakt

Im Abschnitt „Kontakt“ steht nur ein `mailto:`-Link auf ai.foam.cut@gmail.com (kein Formular,
kein Dienst nötig). Adresse bei Bedarf im Abschnitt `id="kontakt"` ändern.

## Screenshots austauschen

Die Bilder in `site/img/` sind Screenshots aus der laufenden App (Discus-Tragfläche geladen,
dunkles Thema). Neue Bilder unter gleichem Namen ersetzen:

| Datei | Inhalt |
|---|---|
| gcode.jpg | Hero: G-Code-3D-Simulation |
| tragflaeche.jpg, kern.jpg, negativ.jpg, material.jpg | Galerie „Vier Ansichten“ |
| dxf.jpg, modell.jpg, platte.jpg | DXF-Formen / 3D-Modell / Plattenmodus |
| winglet.jpg, negform.jpg, negschnitt.jpg | Randbogen, Winglet, Formenbau |
| matdb.jpg, cad.jpg, rippen.jpg, schneiden.jpg | kleine Galerie Spezialfunktionen |

## Lizenz

Der Programmcode von AI Foam Cut steht unter der GPL-3.0-or-later. Texte, Screenshots und
Gestaltung dieser Website sind davon nicht umfasst (siehe `site/rechtliches.html`).
