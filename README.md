# Postkarten Collagen Creator

Eine reine Frontend-Web-App zum Erstellen von Postkarten-Collagen (z. B. für
Druckdienste wie Pokamax), komplett ohne Build-Schritt oder Backend – ideal
für GitHub Pages.

## Format

Die App verwendet aktuell ein einziges Design: das **Jumbo-Postkarten-Format**
von POKAmax (23,0 × 12,0 cm, Lieferformat 2787 × 1488 px).

Beim Druck wird am Rand standardmäßig ein Beschnitt von 35 px (ca. 6 mm)
abgeschnitten. Im Editor markiert eine gestrichelte Linie diesen
Sicherheitsbereich (lässt sich über den Button „Sicherheitsbereich“ ein-
und ausblenden); wichtige Bildinhalte oder Text sollten nicht außerhalb
davon platziert werden. Die Markierung ist nur eine Editor-Hilfslinie und
erscheint nicht im exportierten PNG.

## Funktionen

- Hintergrundbild auswählen (füllt die gesamte Postkarte, Bildausschnitt wie
  `background-size: cover`)
- Beliebig viele Fotos hinzufügen, die in einem weißen Rahmen mit gleich
  breitem Rand auf allen vier Seiten dargestellt werden
- Seitenverhältnis des Bildausschnitts pro Foto umschalten (Pille oben links
  am Foto: 2:3 bzw. 3:2)
- Fotos per Ziehen verschieben, über die Ecke skalieren (Seitenverhältnis
  des Rahmens bleibt erhalten) und löschen
- Bildausschnitt anpassen: über den ✋-Button (oder Doppelklick auf das Foto)
  in den Anpassungsmodus wechseln und das Bild im Rahmen verschieben
  (ziehen) sowie zoomen (Mausrad oder die +/−-Buttons) – wichtig, da
  hochgeladene Fotos meist ein anderes Seitenverhältnis haben als der Rahmen
- Ein Textelement (z. B. „Viele Grüße aus …“) hinzufügen, frei positionieren,
  per Doppelklick bearbeiten und in der Größe ändern – schwarze Schrift mit
  dünnem weißen Rand
- Export der fertigen Collage als PNG in voller Druckauflösung

## Lokal starten

Da es sich um eine reine statische Seite handelt, reicht ein beliebiger
statischer Webserver, z. B.:

```bash
python3 -m http.server 8000
```

Anschließend `http://localhost:8000` im Browser öffnen.

## GitHub Pages einrichten

1. Repository-Einstellungen öffnen: **Settings → Pages**
2. Unter **Build and deployment** die Quelle **Deploy from a branch** wählen
3. Branch auf den Branch mit diesem Code setzen (z. B. `main`) und als Ordner
   **/ (root)** auswählen
4. Speichern – die Seite ist danach unter der angezeigten GitHub-Pages-URL
   erreichbar

Es ist keine weitere Konfiguration (kein Build, kein Node/npm) nötig, da alle
Dateien (`index.html`, `style.css`, `app.js`) direkt ausgeliefert werden.

## Struktur

```
index.html   Grundgerüst & Toolbar
style.css    Layout & Design
app.js       Gesamte Editor-Logik (Zustand, Interaktion, PNG-Export)
```

## Neue Designs hinzufügen (zukünftig)

Der Code ist bewusst so gehalten, dass sich weitere Designs/Formate später
ergänzen lassen (eigene Canvas-Maße, Rahmenstile etc.), aktuell ist jedoch
nur das eine Jumbo-Design aktiv.
