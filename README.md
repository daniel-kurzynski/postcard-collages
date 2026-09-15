# Postcard Collage Creator

This is a private, personal project: a small tool I built for myself to
put together photo collages for the postcards I send. It is tailored to
the one postcard format I use and is not meant as a general-purpose
product, so there is no roadmap, no support, and no promise that it will
work for anyone else's use case. Feel free to look around anyway.

Technically it is a pure frontend web app with no build step and no
backend, so it can be hosted straight from GitHub Pages.

## Formats

The **Format** button (or the format line under the title) switches the
card between these formats, each in landscape or portrait:

| Format | Use | Export size (landscape) |
| --- | --- | --- |
| POKAmax Jumbo | postcard, 23.0 × 12.0 cm | 2787 × 1488 px |
| 10 × 15 cm | photo print (4 × 6″), 300 dpi | 1800 × 1200 px |
| 13 × 18 cm | photo print (5 × 7″), 300 dpi | 2100 × 1500 px |
| 16:9 | panorama print, e.g. 10 × 18 cm | 2560 × 1440 px |

Switching keeps the collage: the background tiles are all ratios and simply
re-flow, and photos and text are scaled to stay roughly where they were.
The last choice is remembered in the browser.

Printing trims off a bleed on every edge (about 35 px ≈ 6 mm on the
POKAmax card, ~30 px on the photo prints). The editor always shows a dotted
guide marking this safety area; important photo content or text shouldn't
be placed outside it. The guide is an editing aid only and is never drawn
into the exported PNG.

## Features

- The background is a collage grid of tiles: tap a tile to choose its
  photo (cropped to fill the tile, like `background-size: cover`; drag
  inside the tile to move the photo around within it). A tile can be split
  into left/right or top/bottom halves, and each half split again, as often
  as there is room; the white border between two tiles can be dragged to
  change how they share the space, and a tile can be removed again (its
  neighbour takes over the space). A fresh card is a single tile covering
  the whole postcard, so one full-bleed background photo is still the
  simplest case
- Add any number of photos (several at once via the file picker), shown in
  a white frame with an equal-width border on all four sides
- Pick a photo's crop aspect ratio from the pill top-left on each photo:
  9:16, 2:3, 3:4, 1:1, 4:3, 3:2 or 16:9 (2:3 is the default)
- All controls live on the selected element itself (crisp SVG icons, no
  emoji); the **?** button in the toolbar opens a short guide to them
- Drag photos to move them, drag the corner handle to resize (the frame's
  own aspect ratio is preserved), and delete them
- Tilt a photo, frame and all, a few degrees to the left or right with the
  ↺/↻ pill at the bottom of a selected photo (3° per tap, up to ±45°); tap
  the angle in the middle to straighten it again. The tilt is rendered
  identically in the export
- Adjust the crop: open crop mode via the crop handle bottom-left (or
  double-click the photo) and pan the image within the frame (drag) and
  zoom it (mouse wheel, pinch, or the −/+ buttons) independently of
  moving/resizing the frame — useful since uploaded photos rarely already
  match the frame's ratio. The handle turns into a check while crop mode
  is active; tap it to finish
- Add a text element (e.g. "Greetings from ..."), position it freely, edit
  it via the pencil handle or a double-click, and resize it — black text
  with a thin white outline
- Nudge the selected element with the arrow keys (Shift for bigger steps),
  delete it with <kbd>Del</kbd> (on a background tile: empties it, or
  removes an already empty tile), and press <kbd>Esc</kbd> to leave crop
  mode or deselect
- Export the finished collage as a PNG at full print resolution (the file
  name carries the format and orientation)
- Feedback (failed image loads, export done) appears as a small toast at
  the bottom of the screen rather than in blocking dialogs
- The page warns before it is closed or reloaded while a collage is in
  progress, since nothing is saved anywhere
- Light and dark colour schemes follow the system setting
- The card is scaled so that it always fits on screen without scrolling.
  In portrait and on desktops the toolbar sits above the card; on phones
  held in landscape it becomes a narrow column of icon buttons at the right
  edge so the card can use the full screen height
- On a phone the browser's own bars still cost card height, so there is a
  full-screen button (Android; iPhones don't allow it for web pages), and
  the app ships a web manifest so "Add to Home screen" installs it as an
  app that always opens without browser bars

## Running locally

Since this is a purely static site, any static web server works, e.g.:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Setting up GitHub Pages

1. Open the repository settings: **Settings → Pages**
2. Under **Build and deployment**, choose the source **Deploy from a
   branch**
3. Set the branch to the one containing this code (e.g. `main`) and the
   folder to **/ (root)**
4. Save — the site is then available at the shown GitHub Pages URL

No further configuration (no build step, no Node/npm) is needed, since
`index.html`, `style.css`, and `app.js` are served directly.

## Structure

```
index.html          Page structure, toolbar, SVG icon sprite, help dialog
style.css           Layout & styling
app.js              All editor logic (state, interaction, PNG export)
manifest.webmanifest, icons/   Web app manifest for "Add to Home screen"
```

## Adding more formats

Formats are the `FORMATS` table at the top of `app.js`: an id, a name and
description for the picker, the landscape pixel size, and the safety
margin. Adding a row is all it takes.
