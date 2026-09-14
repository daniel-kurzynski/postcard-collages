# Postcard Collage Creator

A pure frontend web app for creating postcard collages (e.g. for print
services like POKAmax), with no build step and no backend — ideal for
GitHub Pages.

## Format

The app currently supports a single design: the **POKAmax Jumbo postcard
format** (23.0 × 12.0 cm, delivery size 2787 × 1488 px).

Printing trims off a bleed of about 35 px (~6 mm) on every edge. The editor
always shows a dotted guide marking this safety area; important photo
content or text shouldn't be placed outside it. The guide is an editing aid
only and is never drawn into the exported PNG.

## Features

- Choose a background image (fills the whole postcard, cropped like
  `background-size: cover`)
- Add any number of photos (several at once via the file picker), shown in
  a white frame with an equal-width border on all four sides
- Switch a photo's inner crop aspect ratio (pill top-left on each photo:
  2:3 or 3:2)
- Drag photos to move them, drag the corner handle to resize (the frame's
  own aspect ratio is preserved), and delete them
- Tilt a photo, frame and all, a few degrees to the left or right with the
  ↺/↻ pill at the bottom of a selected photo (3° per tap, up to ±45°); tap
  the angle in the middle to straighten it again. The tilt is rendered
  identically in the export
- Adjust the crop: open the arrange mode via the ✋ handle (or double-click
  the photo) and pan the image within the frame (drag) and zoom it (mouse
  wheel or the +/− buttons) independently of moving/resizing the frame —
  useful since uploaded photos rarely already match the frame's ratio
- Add a text element (e.g. "Greetings from ..."), position it freely, edit
  it via double-click, and resize it — black text with a thin white outline
- Nudge the selected element with the arrow keys (Shift for bigger steps),
  delete it with <kbd>Del</kbd>, and press <kbd>Esc</kbd> to leave crop mode
  or deselect
- Export the finished collage as a PNG at full print resolution
- The page warns before it is closed or reloaded while a collage is in
  progress, since nothing is saved anywhere

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
index.html   Page structure & toolbar
style.css    Layout & styling
app.js       All editor logic (state, interaction, PNG export)
```

## Adding more designs (future)

The code is deliberately structured so more designs/formats could be added
later (their own canvas size, frame style, etc.), but only the one Jumbo
design is active right now.
