(() => {
  "use strict";

  // Jumbo postcard (Pokamax): 23.0 x 12.0 cm @ ~307 dpi
  const CANVAS_W = 2787;
  const CANVAS_H = 1488;

  // Photo frame: white border, equal thickness on all four sides, sized as
  // a fraction of the frame's own outer width (so it scales with the frame).
  const BORDER_RATIO = 0.03;
  // Crop aspect ratios offered in the ratio menu, ordered tall → square → wide.
  const RATIO_PRESETS = [
    { w: 9, h: 16 },
    { w: 2, h: 3 },
    { w: 3, h: 4 },
    { w: 1, h: 1 },
    { w: 4, h: 3 },
    { w: 3, h: 2 },
    { w: 16, h: 9 },
  ];
  const DEFAULT_RATIO = RATIO_PRESETS[1]; // 2:3

  const FONT_FAMILY = "'Caveat', cursive";
  const MIN_PHOTO_W = 180;
  const MIN_FONT_SIZE = 30;
  const MAX_FONT_SIZE = 600;
  const MIN_IMG_SCALE = 1;
  const MAX_IMG_SCALE = 6;

  // Photo tilt: degrees added per tap on the ↺/↻ buttons, and the range a
  // photo can be tilted to either side.
  const TILT_STEP = 3;
  const MAX_TILT = 45;

  // Arrow-key nudge distance in canvas px (Shift for the larger step).
  const NUDGE_STEP = 10;
  const NUDGE_STEP_LARGE = 50;

  // POKAmax cuts ~35px (~6mm) off every edge in production ("Beschnitt").
  // This is a visual editing guide only and is never drawn into the export.
  const SAFE_MARGIN = 35;

  // Background collage grid: the white gutter between two neighbouring
  // cells, and the smallest width/height a cell can be split or dragged
  // down to (both in canvas px; 36 px is about 3 mm).
  const GUTTER = 36;
  const MIN_CELL = 160;
  // A press on a background cell that travels less than this (screen px)
  // counts as a tap (select); anything further drags the cell's photo.
  const TAP_SLOP = 6;

  // On-screen size of the card: at most this wide, and never so tall that it
  // pokes below the viewport (see fitStage), but not shrunk below the
  // minimum either; past that point the page simply scrolls.
  const STAGE_MAX_W = 1100;
  const STAGE_MIN_W = 320;

  let nextId = 1;
  const genId = () => "l" + nextId++;

  const state = {
    grid: null, // background cell tree, see "Background grid" below
    photos: [], // { id, img, src, x, y, w, h, ratioW, ratioH, imgScale, panX, panY, rotation, isPanning }
    text: null, // { id, content, x, y, fontSize }
    selectedId: null, // selected photo/text layer
    selectedCellId: null, // selected background cell (never both at once)
  };

  let scale = 1;

  const app = document.getElementById("app");
  const stage = document.getElementById("stage");
  const stageWrapper = document.getElementById("stageWrapper");
  const bgLayer = document.getElementById("bgLayer");
  const layersContainer = document.getElementById("layersContainer");
  const cellControls = document.getElementById("cellControls");
  const safeZone = document.getElementById("safeZone");
  const cellInput = document.getElementById("cellInput");
  const photoInput = document.getElementById("photoInput");
  const addTextBtn = document.getElementById("addTextBtn");
  const resetBtn = document.getElementById("resetBtn");
  const exportBtn = document.getElementById("exportBtn");
  const exportLabel = document.getElementById("exportLabel");
  const helpBtn = document.getElementById("helpBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const helpDialog = document.getElementById("helpDialog");
  const helpCloseBtn = document.getElementById("helpCloseBtn");
  const toastEl = document.getElementById("toast");
  const viewportMeta = document.getElementById("viewportMeta");

  // ---- Small UI helpers ----

  // Inline SVG referencing the icon sprite in index.html.
  function iconSvg(name, className = "icon") {
    return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }

  let toastTimer = null;
  function showToast(message, { error = false, duration } = {}) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.toggle("error", error);
    toastEl.hidden = false;
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, duration ?? (error ? 6000 : 3000));
  }

  // Object URLs instead of base64 data URLs: a multi-megabyte phone photo
  // as a data URL is a huge string that gets re-parsed every time the
  // preview is rebuilt, which is noticeable on mobile. The URL is revoked
  // via releaseImage() once the layer goes away.
  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const src = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, src });
      img.onerror = () => {
        URL.revokeObjectURL(src);
        reject(
          new Error(
            `"${file.name}" could not be opened. It may not be an image format this browser supports (e.g. HEIC on Chrome).`
          )
        );
      };
      img.src = src;
    });
  }

  function releaseImage(layer) {
    if (layer && layer.src) URL.revokeObjectURL(layer.src);
  }

  function hasContent() {
    return Boolean(gridHasContent() || state.photos.length || state.text);
  }

  // Caps the card's width so its full height fits between the toolbar and
  // the bottom of the viewport. Matters most on phones held in landscape,
  // where a full-width card is taller than the screen and the only place
  // left to scroll is the margin beside it (the card itself swallows touch
  // gestures for dragging). Any spare width ends up as side margin.
  function fitStage() {
    const docTop = stageWrapper.getBoundingClientRect().top + window.scrollY;
    // Whatever the page reserves below the card (its own bottom padding and
    // the phone's safe-area inset) also has to fit in the viewport.
    const below =
      parseFloat(getComputedStyle(app).paddingBottom) +
      parseFloat(getComputedStyle(document.documentElement).paddingBottom);
    const availH = window.innerHeight - docTop - below;
    const fitW = availH * (CANVAS_W / CANVAS_H);
    stage.style.maxWidth = clamp(fitW, STAGE_MIN_W, STAGE_MAX_W) + "px";
  }

  function updateScale() {
    scale = stage.clientWidth / CANVAS_W;
  }

  function worldToScreen(v) {
    return v * scale;
  }
  function screenToWorld(v) {
    return v / scale;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  // Converts a drag delta (in world units, screen orientation) into a tilted
  // photo's own coordinate system, so resizing and crop-panning follow the
  // frame's edges rather than the screen axes. Identity at 0°.
  function toLocalDelta(p, dx, dy) {
    const a = degToRad(p.rotation || 0);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return { dx: dx * cos + dy * sin, dy: -dx * sin + dy * cos };
  }

  function getLayerById(id) {
    if (state.text && state.text.id === id) return state.text;
    return state.photos.find((p) => p.id === id) || null;
  }

  function getLayerEl(id) {
    return layersContainer.querySelector(`[data-id="${id}"]`);
  }

  function formatTilt(deg) {
    if (deg === 0) return "0°";
    return (deg < 0 ? "−" : "+") + Math.abs(deg) + "°";
  }

  // Touch pointers can go away (lifted, or the gesture cancelled by the OS)
  // in the moment between a pointerdown and these calls, which throws.
  // That's a normal race on touch devices, not a bug worth surfacing.
  function safeSetPointerCapture(el, pointerId) {
    try {
      el.setPointerCapture(pointerId);
    } catch (err) {
      /* pointer already gone */
    }
  }
  function safeReleasePointerCapture(el, pointerId) {
    try {
      el.releasePointerCapture(pointerId);
    } catch (err) {
      /* pointer already gone */
    }
  }

  // ---- Photo frame / crop geometry (shared by preview + export) ----

  function outerHeightFor(w, ratioW, ratioH) {
    const b = w * BORDER_RATIO;
    const innerW = w - 2 * b;
    const innerH = innerW / (ratioW / ratioH);
    return innerH + 2 * b;
  }

  function getInnerRect(p) {
    const b = p.w * BORDER_RATIO;
    const iw = p.w - 2 * b;
    const ih = iw / (p.ratioW / p.ratioH);
    return { b, iw, ih, ix: p.x + b, iy: p.y + b };
  }

  // How the source image is scaled/positioned to cover the inner (iw x ih)
  // box, given the layer's zoom (imgScale >= 1) and pan (panX/panY in 0..1).
  function getCropGeometry(p, iw, ih) {
    const nw = p.img.naturalWidth || p.img.width;
    const nh = p.img.naturalHeight || p.img.height;
    const baseScale = Math.max(iw / nw, ih / nh);
    const effScale = baseScale * (p.imgScale || 1);
    const drawnW = nw * effScale;
    const drawnH = nh * effScale;
    const rangeX = Math.max(0, drawnW - iw);
    const rangeY = Math.max(0, drawnH - ih);
    return {
      drawnW,
      drawnH,
      rangeX,
      rangeY,
      offsetX: rangeX * (p.panX ?? 0.5),
      offsetY: rangeY * (p.panY ?? 0.5),
    };
  }

  // ---- Background grid ----
  //
  // The card's background is a collage grid: a binary tree whose leaves are
  // cells, each holding at most one photo (cropped to cover the cell, as the
  // single background used to be), and whose inner nodes split their area
  // in two, side by side ("col") or stacked ("row"), with a white gutter in
  // between. `ratio` is the share of the space (minus the gutter) that the
  // first child gets; dragging the gutter changes it. A fresh card is one
  // empty cell covering everything, and since a cell can only ever be
  // replaced by its sibling, there is always at least one.

  function makeLeaf() {
    return { type: "leaf", id: genId(), img: null, src: null, panX: 0.5, panY: 0.5, rect: null };
  }

  function makeSplit(dir, a, b) {
    return { type: "split", id: genId(), dir, ratio: 0.5, a, b, rect: null };
  }

  const FULL_RECT = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };

  // Smallest area the subtree fits in without any cell going below MIN_CELL.
  function minSize(node) {
    if (node.type === "leaf") return { w: MIN_CELL, h: MIN_CELL };
    const a = minSize(node.a);
    const b = minSize(node.b);
    return node.dir === "col"
      ? { w: a.w + GUTTER + b.w, h: Math.max(a.h, b.h) }
      : { w: Math.max(a.w, b.w), h: a.h + GUTTER + b.h };
  }

  // The [lo, hi] range node.ratio may take so both children still fit in
  // `rect`, or null if they can't both fit however the gutter is placed.
  function ratioRange(node, rect) {
    const along = node.dir === "col" ? "w" : "h";
    const avail = rect[along] - GUTTER;
    const lo = minSize(node.a)[along] / avail;
    const hi = 1 - minSize(node.b)[along] / avail;
    return lo <= hi ? [lo, hi] : null;
  }

  // Lays the tree out inside `rect`, storing each node's rect on it and
  // calling the visitors (splits before their children, so the DOM order
  // built from this puts gutters after the cells they separate). A ratio
  // that stopped fitting because an ancestor shrank is pulled back into
  // range on the way, so cells never drop below MIN_CELL while the whole
  // subtree still fits at all.
  function walkGrid(node, rect, visit = {}, parent = null) {
    node.rect = rect;
    if (node.type === "leaf") {
      if (visit.leaf) visit.leaf(node, rect, parent);
      return;
    }
    const range = ratioRange(node, rect);
    if (range) node.ratio = clamp(node.ratio, range[0], range[1]);
    if (visit.split) visit.split(node, rect, parent);
    const { x, y, w, h } = rect;
    if (node.dir === "col") {
      const wa = (w - GUTTER) * node.ratio;
      walkGrid(node.a, { x, y, w: wa, h }, visit, node);
      walkGrid(node.b, { x: x + wa + GUTTER, y, w: w - GUTTER - wa, h }, visit, node);
    } else {
      const ha = (h - GUTTER) * node.ratio;
      walkGrid(node.a, { x, y, w, h: ha }, visit, node);
      walkGrid(node.b, { x, y: y + ha + GUTTER, w, h: h - GUTTER - ha }, visit, node);
    }
  }

  function gridCells() {
    const cells = [];
    walkGrid(state.grid, FULL_RECT, { leaf: (cell) => cells.push(cell) });
    return cells;
  }

  function gridHasContent() {
    return state.grid.type === "split" || gridCells().some((cell) => cell.img);
  }

  function findNode(id, node = state.grid, parent = null) {
    if (node.id === id) return { node, parent };
    if (node.type === "leaf") return null;
    return findNode(id, node.a, node) || findNode(id, node.b, node);
  }

  function replaceNode(parent, oldNode, newNode) {
    if (!parent) state.grid = newNode;
    else if (parent.a === oldNode) parent.a = newNode;
    else parent.b = newNode;
  }

  function canSplit(cell, dir) {
    const along = dir === "col" ? "w" : "h";
    return Boolean(cell.rect) && (cell.rect[along] - GUTTER) / 2 >= MIN_CELL;
  }

  // Splits a cell in two equal halves; its photo stays in the first half
  // and the second starts empty.
  function splitCell(id, dir) {
    const found = findNode(id);
    if (!found || !canSplit(found.node, dir)) return;
    replaceNode(found.parent, found.node, makeSplit(dir, found.node, makeLeaf()));
    render();
  }

  // Removes a cell; its sibling takes over their parent's whole area. The
  // root cell has no sibling and stays.
  function removeCell(id) {
    const found = findNode(id);
    if (!found || !found.parent) return;
    const { node, parent } = found;
    const sibling = parent.a === node ? parent.b : parent.a;
    const { parent: grandparent } = findNode(parent.id);
    releaseImage(node);
    replaceNode(grandparent, parent, sibling);
    if (state.selectedCellId === id) state.selectedCellId = null;
    render();
  }

  function setCellImage(cell, loaded) {
    releaseImage(cell);
    cell.img = loaded ? loaded.img : null;
    cell.src = loaded ? loaded.src : null;
    cell.panX = 0.5;
    cell.panY = 0.5;
    render();
  }

  // Selection mirrors the photo layers': classes are toggled in place so
  // the element a gesture holds on to survives.
  function selectCell(id) {
    if (id) select(null);
    if (state.selectedCellId === id) return;
    closeRatioMenus();
    state.selectedCellId = id;
    updateCellClasses();
  }

  function updateCellClasses() {
    cellEls.forEach((el, id) => el.classList.toggle("selected", id === state.selectedCellId));
    pillEls.forEach((el, id) => el.classList.toggle("selected", id === state.selectedCellId));
  }

  let pendingCellId = null;
  function pickCellPhoto(id) {
    pendingCellId = id;
    cellInput.click();
  }

  cellInput.addEventListener("change", async () => {
    const file = cellInput.files[0];
    // Clear before the (async) load so picking the same file again works
    // even if this attempt fails.
    cellInput.value = "";
    const found = pendingCellId ? findNode(pendingCellId) : null;
    pendingCellId = null;
    if (!file || !found) return;
    let loaded;
    try {
      loaded = await loadImageFile(file);
    } catch (err) {
      showToast(err.message, { error: true });
      return;
    }
    setCellImage(found.node, loaded);
  });

  // The cells and gutters live in the background layer, underneath the
  // photos; each cell's control pill lives in its own layer on top of them,
  // so a photo lying across a cell can't cover its buttons.
  const cellEls = new Map(); // cell id -> element in bgLayer
  const dividerEls = new Map(); // split id -> gutter element in bgLayer
  const pillEls = new Map(); // cell id -> pill element in cellControls

  function buildBackground() {
    bgLayer.innerHTML = "";
    cellControls.innerHTML = "";
    cellEls.clear();
    dividerEls.clear();
    pillEls.clear();
    walkGrid(state.grid, FULL_RECT, {
      leaf(cell, rect, parent) {
        const el = buildCellEl(cell);
        cellEls.set(cell.id, el);
        bgLayer.appendChild(el);
        const pill = buildCellPill(cell, Boolean(parent));
        pillEls.set(cell.id, pill);
        cellControls.appendChild(pill);
      },
      split(node) {
        const el = buildDividerEl(node);
        dividerEls.set(node.id, el);
        bgLayer.appendChild(el);
      },
    });
    updateCellClasses();
    layoutBackground();
  }

  // Positions the existing cell, gutter and pill elements; used both after
  // building them and whenever only geometry changed (gutter drag, resize).
  function layoutBackground() {
    walkGrid(state.grid, FULL_RECT, {
      leaf(cell, rect) {
        const el = cellEls.get(cell.id);
        if (el) applyCellGeometry(cell, el);
        const pill = pillEls.get(cell.id);
        if (pill) {
          pill.style.left = worldToScreen(rect.x + rect.w / 2) + "px";
          pill.style.top = worldToScreen(rect.y + rect.h / 2) + "px";
          pill.querySelector(".split-col").disabled = !canSplit(cell, "col");
          pill.querySelector(".split-row").disabled = !canSplit(cell, "row");
        }
      },
      split(node, rect) {
        const el = dividerEls.get(node.id);
        if (!el) return;
        const g = worldToScreen(GUTTER);
        if (node.dir === "col") {
          el.style.left = worldToScreen(rect.x + (rect.w - GUTTER) * node.ratio) + "px";
          el.style.top = worldToScreen(rect.y) + "px";
          el.style.width = g + "px";
          el.style.height = worldToScreen(rect.h) + "px";
        } else {
          el.style.left = worldToScreen(rect.x) + "px";
          el.style.top = worldToScreen(rect.y + (rect.h - GUTTER) * node.ratio) + "px";
          el.style.width = worldToScreen(rect.w) + "px";
          el.style.height = g + "px";
        }
      },
    });
  }

  function applyCellGeometry(cell, el) {
    const r = cell.rect;
    el.style.left = worldToScreen(r.x) + "px";
    el.style.top = worldToScreen(r.y) + "px";
    el.style.width = worldToScreen(r.w) + "px";
    el.style.height = worldToScreen(r.h) + "px";
    const img = el.querySelector("img");
    if (!img) return;
    const { drawnW, drawnH, offsetX, offsetY } = getCropGeometry(cell, r.w, r.h);
    img.style.width = worldToScreen(drawnW) + "px";
    img.style.height = worldToScreen(drawnH) + "px";
    img.style.left = worldToScreen(-offsetX) + "px";
    img.style.top = worldToScreen(-offsetY) + "px";
  }

  function buildCellEl(cell) {
    const el = document.createElement("div");
    el.className = "cell " + (cell.img ? "has-photo" : "empty");
    el.dataset.cell = cell.id;
    if (cell.img) {
      const img = document.createElement("img");
      img.src = cell.src;
      img.draggable = false;
      el.appendChild(img);
    }
    attachCellGestures(cell, el);
    return el;
  }

  // A tap on a cell selects it (tapping the selected cell deselects); a
  // drag moves the photo around within the cell, which is all the cropping
  // a cell photo needs since it always covers its cell.
  function attachCellGestures(cell, el) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      closeRatioMenus();
      safeSetPointerCapture(el, e.pointerId);
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startPanX = cell.panX;
      const startPanY = cell.panY;
      let dragging = false;

      function onMove(ev) {
        if (ev.pointerId !== e.pointerId) return;
        const dxs = ev.clientX - startClientX;
        const dys = ev.clientY - startClientY;
        if (!dragging) {
          if (!cell.img || Math.hypot(dxs, dys) < TAP_SLOP) return;
          dragging = true;
          selectCell(cell.id);
          el.classList.add("dragging");
        }
        const { rangeX, rangeY } = getCropGeometry(cell, cell.rect.w, cell.rect.h);
        cell.panX = rangeX > 0 ? clamp(startPanX - screenToWorld(dxs) / rangeX, 0, 1) : 0.5;
        cell.panY = rangeY > 0 ? clamp(startPanY - screenToWorld(dys) / rangeY, 0, 1) : 0.5;
        applyCellGeometry(cell, el);
      }
      function onUp(ev) {
        if (ev.pointerId !== e.pointerId) return;
        safeReleasePointerCapture(el, ev.pointerId);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        el.classList.remove("dragging");
        if (!dragging && ev.type === "pointerup") {
          selectCell(state.selectedCellId === cell.id ? null : cell.id);
        }
      }
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    });
  }

  // Empty cells always show their pill (that is how a photo gets in);
  // filled cells only while selected (see CSS).
  function buildCellPill(cell, removable) {
    const pill = document.createElement("div");
    pill.className = "pill cell-pill" + (cell.img ? "" : " empty");
    pill.dataset.cell = cell.id;
    pill.appendChild(
      makePillButton(
        iconSvg("image") + `<span>${cell.img ? "Replace" : "Choose photo"}</span>`,
        cell.img ? "Replace this tile's photo" : "Choose a photo for this tile",
        () => pickCellPhoto(cell.id),
        "cell-photo"
      )
    );
    pill.appendChild(
      makePillButton(iconSvg("split-cols"), "Split into left and right", () => splitCell(cell.id, "col"), "split-col")
    );
    pill.appendChild(
      makePillButton(iconSvg("split-rows"), "Split into top and bottom", () => splitCell(cell.id, "row"), "split-row")
    );
    if (removable) {
      pill.appendChild(
        makePillButton(iconSvg("x"), "Remove this tile (its neighbour takes the space)", () => removeCell(cell.id), "cell-remove")
      );
    }
    return pill;
  }

  function buildDividerEl(node) {
    const el = document.createElement("div");
    el.className = "divider divider-" + node.dir;
    el.dataset.split = node.id;
    el.title = "Drag to resize the tiles";
    el.innerHTML = '<span class="grip"></span>';
    el.addEventListener("pointerdown", (e) => startDividerDrag(e, node, el));
    return el;
  }

  // ---- Drag: move a gutter between two cells ----

  function startDividerDrag(e, node, el) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    closeRatioMenus();
    safeSetPointerCapture(el, e.pointerId);
    el.classList.add("dragging");
    const stageRect = stage.getBoundingClientRect();

    function onMove(ev) {
      if (ev.pointerId !== e.pointerId) return;
      const rect = node.rect;
      const range = ratioRange(node, rect);
      if (!range) return;
      // The pointer sits in the middle of the gutter; work out where that
      // puts the gutter's leading edge as a share of the splittable space.
      const isCol = node.dir === "col";
      const pos = isCol
        ? screenToWorld(ev.clientX - stageRect.left) - rect.x
        : screenToWorld(ev.clientY - stageRect.top) - rect.y;
      const avail = (isCol ? rect.w : rect.h) - GUTTER;
      node.ratio = clamp((pos - GUTTER / 2) / avail, range[0], range[1]);
      layoutBackground();
    }
    function onUp(ev) {
      if (ev.pointerId !== e.pointerId) return;
      safeReleasePointerCapture(el, ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.classList.remove("dragging");
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }

  // ---- Rendering ----

  function render() {
    fitStage();
    updateScale();

    buildBackground();

    layersContainer.innerHTML = "";
    state.photos.forEach((p) => layersContainer.appendChild(buildPhotoEl(p)));
    if (state.text) layersContainer.appendChild(buildTextEl(state.text));
    applySafeZone();
  }

  function applySafeZone() {
    const m = worldToScreen(SAFE_MARGIN);
    safeZone.style.left = m + "px";
    safeZone.style.top = m + "px";
    safeZone.style.right = m + "px";
    safeZone.style.bottom = m + "px";
  }

  // Re-fits the card and repositions the existing layer elements after the
  // viewport changed, without rebuilding them. Rebuilding would cut off an
  // in-progress drag (whose element and pointer capture would vanish) and
  // throw away a text edit, and on phones the browser fires resize for
  // things as mundane as the address bar sliding away.
  function relayout() {
    if (stage.classList.contains("editing-text")) return; // keyboard open
    fitStage();
    updateScale();
    layoutBackground();
    state.photos.forEach((p) => {
      const el = getLayerEl(p.id);
      if (el) applyPhotoGeometry(p, el);
    });
    if (state.text) {
      const el = getLayerEl(state.text.id);
      if (el) applyTextGeometry(state.text, el);
    }
    applySafeZone();
  }

  function makeHandle(className, html, title) {
    const h = document.createElement("div");
    h.className = "handle " + className;
    h.innerHTML = html;
    h.title = title;
    h.setAttribute("role", "button");
    h.setAttribute("aria-label", title);
    return h;
  }

  function buildHandles(layerEl, onDelete, onResizeStart) {
    const del = makeHandle("handle-delete", iconSvg("x"), "Delete");
    del.addEventListener("pointerdown", (e) => e.stopPropagation());
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      onDelete();
    });
    layerEl.appendChild(del);

    const resize = makeHandle("handle-resize", iconSvg("resize"), "Resize");
    resize.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      onResizeStart(e);
    });
    layerEl.appendChild(resize);
  }

  function applyLayerPosition(layer, el) {
    el.style.left = worldToScreen(layer.x) + "px";
    el.style.top = worldToScreen(layer.y) + "px";
  }

  function applyPhotoGeometry(p, el) {
    applyLayerPosition(p, el);
    el.style.width = worldToScreen(p.w) + "px";
    el.style.height = worldToScreen(p.h) + "px";
    // Rotation is about the frame's centre (transform-origin in CSS), and
    // the export rotates about the same point, so preview and PNG match.
    el.style.transform = p.rotation ? `rotate(${p.rotation}deg)` : "";

    const { b, iw, ih } = getInnerRect(p);
    const cropBox = el.querySelector(".crop-box");
    cropBox.style.left = worldToScreen(b) + "px";
    cropBox.style.top = worldToScreen(b) + "px";
    cropBox.style.width = worldToScreen(iw) + "px";
    cropBox.style.height = worldToScreen(ih) + "px";

    const { drawnW, drawnH, offsetX, offsetY } = getCropGeometry(p, iw, ih);
    const img = cropBox.querySelector("img");
    img.style.width = worldToScreen(drawnW) + "px";
    img.style.height = worldToScreen(drawnH) + "px";
    img.style.left = worldToScreen(-offsetX) + "px";
    img.style.top = worldToScreen(-offsetY) + "px";
  }

  function setPhotoScale(p, el, scale) {
    p.imgScale = clamp(scale, MIN_IMG_SCALE, MAX_IMG_SCALE);
    applyPhotoGeometry(p, el);
  }

  function zoomPhoto(p, el, factor) {
    setPhotoScale(p, el, (p.imgScale || 1) * factor);
  }

  function setTilt(p, el, deg) {
    p.rotation = clamp(Math.round(deg), -MAX_TILT, MAX_TILT);
    const label = el.querySelector(".tilt-label");
    if (label) label.textContent = formatTilt(p.rotation);
    applyPhotoGeometry(p, el);
  }

  function tiltPhoto(p, el, deltaDeg) {
    setTilt(p, el, (p.rotation || 0) + deltaDeg);
  }

  // The on-photo pills (crop zoom, tilt) are made of these. pointerdown is
  // stopped so a tap doesn't start a frame drag; dblclick is stopped so two
  // quick taps on "+" don't also toggle crop mode via the layer's dblclick.
  function makePillButton(html, title, onClick, className) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = html;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    if (className) btn.className = className;
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.addEventListener("dblclick", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  // Pointer/touch gestures on a photo layer: one finger moves the frame (or
  // pans the crop in arrange mode), two fingers pinch-zoom the crop while
  // in arrange mode. Tracking every active pointer here (rather than only
  // the first) is what lets a second touch join mid-gesture on mobile.
  function attachPhotoGestures(p, el) {
    const pointers = new Map(); // pointerId -> {x, y}
    let pinch = null; // { startDist, startScale }

    function pinchDistance() {
      const pts = [...pointers.values()];
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }

    el.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1) {
        if (p.isPanning) startPan(e, p, el, () => pointers.size > 1);
        else startMove(e, p, el);
        return;
      }

      if (pointers.size === 2 && p.isPanning) {
        pinch = {
          startDist: Math.max(1, pinchDistance()),
          startScale: p.imgScale || 1,
        };
      }
    });

    el.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const factor = pinchDistance() / pinch.startDist;
        setPhotoScale(p, el, pinch.startScale * factor);
      }
    });

    function release(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    }
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);

    el.addEventListener("dblclick", (e) => {
      if (e.target.closest(".handle")) return;
      togglePanning(p, el);
    });
    el.addEventListener(
      "wheel",
      (e) => {
        if (!p.isPanning) return;
        e.preventDefault();
        zoomPhoto(p, el, e.deltaY < 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false }
    );
  }

  function buildPhotoEl(p) {
    const el = document.createElement("div");
    el.className =
      "layer" +
      (state.selectedId === p.id ? " selected" : "") +
      (p.isPanning ? " panning" : "");
    el.dataset.id = p.id;

    const frame = document.createElement("div");
    frame.className = "photo-frame";

    const cropBox = document.createElement("div");
    cropBox.className = "crop-box";
    const img = document.createElement("img");
    img.src = p.src;
    img.draggable = false;
    cropBox.appendChild(img);
    frame.appendChild(cropBox);
    el.appendChild(frame);

    applyPhotoGeometry(p, el);
    attachPhotoGestures(p, el);

    buildHandles(
      el,
      () => deleteLayer(p.id),
      (e) => startResizePhoto(e, p, el)
    );

    // Aspect ratio: the pill shows the current ratio and opens a menu of all
    // presets just inside the frame's top edge.
    const ratioBtn = makeHandle("handle-ratio", `${p.ratioW}:${p.ratioH}`, "Aspect ratio");
    const ratioMenu = document.createElement("div");
    ratioMenu.className = "pill ratio-menu";
    RATIO_PRESETS.forEach((r) => {
      const opt = makePillButton(`${r.w}:${r.h}`, `Aspect ratio ${r.w}:${r.h}`, () => {
        setRatio(p, el, r);
        ratioMenu.classList.remove("open");
      }, "ratio-option");
      opt.dataset.ratio = `${r.w}:${r.h}`;
      opt.classList.toggle("current", r.w === p.ratioW && r.h === p.ratioH);
      ratioMenu.appendChild(opt);
    });
    ratioBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    ratioBtn.addEventListener("dblclick", (e) => e.stopPropagation());
    ratioBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      ratioMenu.classList.toggle("open");
    });
    el.appendChild(ratioBtn);
    el.appendChild(ratioMenu);

    const panBtn = makeHandle(
      "handle-pan",
      iconSvg("crop", "icon icon-crop") + iconSvg("check", "icon icon-done"),
      "Adjust crop (pan/zoom)"
    );
    panBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    panBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanning(p, el);
    });
    el.appendChild(panBtn);

    // Crop zoom (shown in crop mode) and tilt (shown otherwise) share the
    // bottom-centre spot, so only one of them is ever visible.
    const zoomPill = document.createElement("div");
    zoomPill.className = "pill zoom-pill";
    zoomPill.appendChild(makePillButton(iconSvg("minus"), "Zoom out", () => zoomPhoto(p, el, 1 / 1.2)));
    zoomPill.appendChild(makePillButton(iconSvg("plus"), "Zoom in", () => zoomPhoto(p, el, 1.2)));
    el.appendChild(zoomPill);

    const tiltPill = document.createElement("div");
    tiltPill.className = "pill tilt-pill";
    tiltPill.appendChild(
      makePillButton(iconSvg("rotate-left"), `Tilt left (${TILT_STEP}°)`, () => tiltPhoto(p, el, -TILT_STEP))
    );
    tiltPill.appendChild(
      makePillButton(formatTilt(p.rotation || 0), "Straighten (reset tilt)", () => setTilt(p, el, 0), "tilt-label")
    );
    tiltPill.appendChild(
      makePillButton(iconSvg("rotate-right"), `Tilt right (${TILT_STEP}°)`, () => tiltPhoto(p, el, TILT_STEP))
    );
    el.appendChild(tiltPill);

    return el;
  }

  function setRatio(p, el, r) {
    p.ratioW = r.w;
    p.ratioH = r.h;
    p.h = outerHeightFor(p.w, p.ratioW, p.ratioH);
    p.imgScale = 1;
    p.panX = 0.5;
    p.panY = 0.5;
    const label = `${r.w}:${r.h}`;
    el.querySelector(".handle-ratio").textContent = label;
    el.querySelectorAll(".ratio-option").forEach((opt) => {
      opt.classList.toggle("current", opt.dataset.ratio === label);
    });
    applyPhotoGeometry(p, el);
  }

  function closeRatioMenus() {
    layersContainer.querySelectorAll(".ratio-menu.open").forEach((m) => m.classList.remove("open"));
  }

  function togglePanning(p, el) {
    closeRatioMenus();
    const next = !p.isPanning;
    state.photos.forEach((other) => {
      if (other !== p && other.isPanning) {
        other.isPanning = false;
        const oel = getLayerEl(other.id);
        if (oel) oel.classList.remove("panning");
      }
    });
    p.isPanning = next;
    select(p.id);
    el.classList.toggle("panning", next);
  }

  function buildTextEl(t) {
    const el = document.createElement("div");
    el.className =
      "layer text-layer" + (state.selectedId === t.id ? " selected" : "");
    el.dataset.id = t.id;
    applyTextGeometry(t, el);

    // The editable text lives in its own child element, separate from the
    // delete/resize handles below. Handles are also children of `el` (for
    // corner positioning), so if `el` itself became contentEditable, a
    // "select all" while editing (which double-click/double-tap starts
    // with) would select the handle icons too, letting them be typed over
    // or leak into the saved text content.
    const textContent = document.createElement("span");
    textContent.className = "text-content";
    textContent.textContent = t.content;
    textContent.spellcheck = false;
    el.appendChild(textContent);

    el.addEventListener("pointerdown", (e) => {
      if (textContent.isContentEditable) return;
      startMove(e, t, el);
    });
    el.addEventListener("dblclick", (e) => {
      if (e.target.closest(".handle") || textContent.isContentEditable) return;
      startEditingText(el, textContent, t);
    });

    buildHandles(
      el,
      () => deleteLayer(t.id),
      (e) => startResizeText(e, t, el)
    );

    // Double-tap works too, but an explicit button is far more discoverable,
    // especially on touch screens where there are no hover tooltips.
    const editBtn = makeHandle("handle-edit", iconSvg("edit"), "Edit text");
    editBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!textContent.isContentEditable) startEditingText(el, textContent, t);
    });
    el.appendChild(editBtn);
    return el;
  }

  function applyTextGeometry(t, el) {
    applyLayerPosition(t, el);
    el.style.fontSize = worldToScreen(t.fontSize) + "px";
    el.style.webkitTextStrokeWidth = worldToScreen(t.fontSize * 0.08) + "px";
  }

  function startEditingText(el, textContent, t) {
    el.classList.add("editing");
    // touch-action is restrictive by intersecting every ancestor's value,
    // so `.stage`'s touch-action: none (needed while dragging/resizing
    // layers) would otherwise still block native touch text-selection
    // gestures on `textContent` even though it opts back into "auto".
    stage.classList.add("editing-text");
    textContent.contentEditable = "true";

    // Mobile Safari zooms the whole page in when a small-font editable
    // element is focused. Cap the zoom while editing, then restore
    // whatever zoom range the page normally allows.
    const originalViewport = viewportMeta.getAttribute("content");
    viewportMeta.setAttribute("content", originalViewport + ", maximum-scale=1");

    textContent.focus();
    const range = document.createRange();
    range.selectNodeContents(textContent);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const commit = () => {
      textContent.removeEventListener("blur", commit);
      textContent.contentEditable = "false";
      el.classList.remove("editing");
      stage.classList.remove("editing-text");
      viewportMeta.setAttribute("content", originalViewport);
      const value = textContent.innerText.replace(/\r/g, "");
      t.content = value.trim() === "" ? t.content : value;
      render();
    };
    textContent.addEventListener("blur", commit);
    textContent.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        textContent.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        textContent.blur();
      }
    });
  }

  // ---- Selection ----

  // Toggles the "selected" class on existing DOM nodes without rebuilding
  // the layer tree, so an in-progress drag/resize gesture (which holds a
  // reference to its DOM element and pointer capture) is never invalidated
  // by a selection change at the start of that same gesture.
  function select(id) {
    if (id) selectCell(null);
    if (state.selectedId === id) return;
    closeRatioMenus();
    const prevId = state.selectedId;
    const prevEl = layersContainer.querySelector(".layer.selected");
    if (prevEl) prevEl.classList.remove("selected");
    state.selectedId = id;

    if (prevId) {
      const prevPhoto = state.photos.find((ph) => ph.id === prevId);
      if (prevPhoto && prevPhoto.isPanning) {
        prevPhoto.isPanning = false;
        if (prevEl) prevEl.classList.remove("panning");
      }
    }

    if (id) {
      const el = getLayerEl(id);
      if (el) el.classList.add("selected");
    }
  }

  function deselect() {
    select(null);
  }

  function deleteLayer(id) {
    state.photos = state.photos.filter((p) => {
      if (p.id !== id) return true;
      releaseImage(p);
      return false;
    });
    if (state.text && state.text.id === id) state.text = null;
    if (state.selectedId === id) state.selectedId = null;
    render();
  }

  // Cells and gutters stop propagation, so this only fires for the bare
  // stage (e.g. the rounded corners) and the pass-through containers.
  stage.addEventListener("pointerdown", (e) => {
    if (e.target === stage || e.target === bgLayer || e.target === layersContainer || e.target === cellControls) {
      deselect();
      selectCell(null);
    }
  });

  const ARROW_DELTAS = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  window.addEventListener("keydown", (e) => {
    if (helpDialog.open) return;
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

    if (e.key === "Escape") {
      const panningPhoto = state.photos.find((p) => p.isPanning);
      if (panningPhoto) {
        panningPhoto.isPanning = false;
        const el = getLayerEl(panningPhoto.id);
        if (el) el.classList.remove("panning");
      } else if (state.selectedCellId) {
        selectCell(null);
      } else {
        deselect();
      }
      return;
    }

    if (state.selectedCellId) {
      // Delete empties a tile first; on an already empty tile it removes it.
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const found = findNode(state.selectedCellId);
        if (!found) return;
        if (found.node.img) setCellImage(found.node, null);
        else removeCell(found.node.id);
      }
      return;
    }

    if (!state.selectedId) return;
    const layer = getLayerById(state.selectedId);
    const el = getLayerEl(state.selectedId);
    if (!layer || !el) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteLayer(state.selectedId);
      return;
    }

    const arrow = ARROW_DELTAS[e.key];
    if (arrow) {
      e.preventDefault();
      const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      layer.x += arrow[0] * step;
      layer.y += arrow[1] * step;
      applyLayerPosition(layer, el);
    }
  });

  // ---- Drag: move ----

  function startMove(e, layer, el) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    closeRatioMenus();
    select(layer.id);
    safeSetPointerCapture(el, e.pointerId);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startX = layer.x;
    const startY = layer.y;

    function onMove(ev) {
      if (ev.pointerId !== e.pointerId) return;
      const dx = screenToWorld(ev.clientX - startClientX);
      const dy = screenToWorld(ev.clientY - startClientY);
      layer.x = startX + dx;
      layer.y = startY + dy;
      applyLayerPosition(layer, el);
    }
    function onUp(ev) {
      if (ev.pointerId !== e.pointerId) return;
      safeReleasePointerCapture(el, ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }

  // ---- Drag: pan the image within its (fixed) frame ----

  // isMultiTouch reports whether a second finger is currently down (pinch
  // zoom). While it is, this one-finger pan stands down instead of fighting
  // the pinch, and re-baselines so the crop doesn't jump when the pinch ends.
  function startPan(e, p, el, isMultiTouch = () => false) {
    e.preventDefault();
    e.stopPropagation();
    closeRatioMenus();
    select(p.id);
    safeSetPointerCapture(el, e.pointerId);
    const { iw, ih } = getInnerRect(p);
    let startClientX = e.clientX;
    let startClientY = e.clientY;
    let startPanX = p.panX ?? 0.5;
    let startPanY = p.panY ?? 0.5;

    function onMove(ev) {
      if (ev.pointerId !== e.pointerId) return;
      if (isMultiTouch()) {
        startClientX = ev.clientX;
        startClientY = ev.clientY;
        startPanX = p.panX ?? 0.5;
        startPanY = p.panY ?? 0.5;
        return;
      }
      // The pinch may have changed the zoom, so the pan range is re-read
      // on every move rather than captured once at pan start.
      const { rangeX, rangeY } = getCropGeometry(p, iw, ih);
      const { dx, dy } = toLocalDelta(
        p,
        screenToWorld(ev.clientX - startClientX),
        screenToWorld(ev.clientY - startClientY)
      );
      p.panX = rangeX > 0 ? clamp(startPanX - dx / rangeX, 0, 1) : 0.5;
      p.panY = rangeY > 0 ? clamp(startPanY - dy / rangeY, 0, 1) : 0.5;
      applyPhotoGeometry(p, el);
    }
    function onUp(ev) {
      if (ev.pointerId !== e.pointerId) return;
      safeReleasePointerCapture(el, ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }

  // ---- Drag: resize photo (uniform, aspect-locked per its own ratio) ----

  function startResizePhoto(e, p, el) {
    e.preventDefault();
    closeRatioMenus();
    select(p.id);
    const handle = e.currentTarget;
    safeSetPointerCapture(handle, e.pointerId);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startW = p.w;

    function onMove(ev) {
      if (ev.pointerId !== e.pointerId) return;
      // Project the drag onto the (possibly tilted) frame's own x-axis.
      const { dx: dxWorld } = toLocalDelta(
        p,
        screenToWorld(ev.clientX - startClientX),
        screenToWorld(ev.clientY - startClientY)
      );
      const newW = clamp(startW + dxWorld, MIN_PHOTO_W, CANVAS_W * 1.3);
      p.w = newW;
      p.h = outerHeightFor(p.w, p.ratioW, p.ratioH);
      applyPhotoGeometry(p, el);
    }
    function onUp(ev) {
      if (ev.pointerId !== e.pointerId) return;
      safeReleasePointerCapture(handle, ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  // ---- Drag: resize text (font size) ----

  function startResizeText(e, t, el) {
    e.preventDefault();
    select(t.id);
    const handle = e.currentTarget;
    safeSetPointerCapture(handle, e.pointerId);
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const startDist = Math.max(20, Math.hypot(e.clientX - centerX, e.clientY - centerY));
    const startFont = t.fontSize;

    function onMove(ev) {
      if (ev.pointerId !== e.pointerId) return;
      const dist = Math.hypot(ev.clientX - centerX, ev.clientY - centerY);
      const factor = dist / startDist;
      t.fontSize = clamp(startFont * factor, MIN_FONT_SIZE, MAX_FONT_SIZE);
      applyTextGeometry(t, el);
    }
    function onUp(ev) {
      if (ev.pointerId !== e.pointerId) return;
      safeReleasePointerCapture(handle, ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  // ---- Toolbar actions ----

  // Preset spawn spots (fractions of the canvas) so newly added photos fan
  // out instead of landing almost exactly on top of the previous one.
  const PHOTO_SPAWN_SPOTS = [
    [0.06, 0.10],
    [0.60, 0.08],
    [0.10, 0.50],
    [0.58, 0.48],
    [0.34, 0.30],
  ];

  function addPhoto({ img, src }) {
    const count = state.photos.length;
    const w = CANVAS_W * 0.22;
    const [fx, fy] = PHOTO_SPAWN_SPOTS[count % PHOTO_SPAWN_SPOTS.length];
    const extraCycles = Math.floor(count / PHOTO_SPAWN_SPOTS.length);
    const jitter = extraCycles * CANVAS_W * 0.03;
    const ratioW = DEFAULT_RATIO.w;
    const ratioH = DEFAULT_RATIO.h;
    const layer = {
      id: genId(),
      img,
      src,
      x: CANVAS_W * fx + jitter,
      y: CANVAS_H * fy + jitter,
      w,
      h: outerHeightFor(w, ratioW, ratioH),
      ratioW,
      ratioH,
      imgScale: 1,
      panX: 0.5,
      panY: 0.5,
      rotation: 0,
      isPanning: false,
    };
    state.photos.push(layer);
    state.selectedId = layer.id;
  }

  photoInput.addEventListener("change", async () => {
    const files = [...photoInput.files];
    photoInput.value = "";
    if (!files.length) return;
    const failed = [];
    for (const file of files) {
      try {
        addPhoto(await loadImageFile(file));
      } catch (err) {
        failed.push(err.message);
      }
    }
    render();
    if (failed.length) showToast(failed.join(" "), { error: true });
  });

  addTextBtn.addEventListener("click", () => {
    if (state.text) {
      state.selectedId = state.text.id;
      render();
      return;
    }
    state.text = {
      id: genId(),
      content: "Greetings from ...",
      x: CANVAS_W * 0.5,
      y: CANVAS_H * 0.86,
      fontSize: 130,
    };
    state.selectedId = state.text.id;
    render();
  });

  resetBtn.addEventListener("click", () => {
    if (!hasContent()) return;
    if (!confirm("Reset everything? This clears the whole collage.")) return;
    gridCells().forEach(releaseImage);
    state.photos.forEach(releaseImage);
    state.grid = makeLeaf();
    state.photos = [];
    state.text = null;
    state.selectedId = null;
    state.selectedCellId = null;
    render();
  });

  // ---- Export ----

  function drawText(ctx, t) {
    const lines = t.content.split("\n");
    const lineHeight = t.fontSize * 1.15;
    const totalH = lines.length * lineHeight;
    ctx.font = `700 ${t.fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = t.fontSize * 0.08;
    lines.forEach((line, i) => {
      const ly = t.y - totalH / 2 + lineHeight * (i + 0.5);
      ctx.strokeStyle = "#ffffff";
      ctx.strokeText(line, t.x, ly);
      ctx.fillStyle = "#000000";
      ctx.fillText(line, t.x, ly);
    });
  }

  async function ensureFontsLoaded() {
    try {
      await document.fonts.load(`700 100px 'Caveat'`);
      await document.fonts.ready;
    } catch (err) {
      /* ignore, fall back to default font */
    }
  }

  exportBtn.addEventListener("click", async () => {
    if (!hasContent()) {
      showToast("Nothing to export yet. Add a background photo or some photos first.");
      return;
    }
    exportBtn.disabled = true;
    exportLabel.textContent = "Exporting…";
    try {
      await ensureFontsLoaded();
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Background grid: the white canvas already provides the gutters (and
      // empty cells); each photo is clipped to its cell.
      walkGrid(state.grid, FULL_RECT, {
        leaf(cell, r) {
          if (!cell.img) return;
          const { drawnW, drawnH, offsetX, offsetY } = getCropGeometry(cell, r.w, r.h);
          ctx.save();
          ctx.beginPath();
          ctx.rect(r.x, r.y, r.w, r.h);
          ctx.clip();
          ctx.drawImage(cell.img, r.x - offsetX, r.y - offsetY, drawnW, drawnH);
          ctx.restore();
        },
      });

      for (const p of state.photos) {
        const b = p.w * BORDER_RATIO;
        ctx.save();
        if (p.rotation) {
          // Same pivot as the CSS transform-origin: the frame's centre.
          const cx = p.x + p.w / 2;
          const cy = p.y + p.h / 2;
          ctx.translate(cx, cy);
          ctx.rotate(degToRad(p.rotation));
          ctx.translate(-cx, -cy);
        }

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = p.w * 0.055;
        ctx.shadowOffsetY = p.w * 0.022;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.restore();

        const { iw, ih, ix, iy } = getInnerRect(p);
        const { drawnW, drawnH, offsetX, offsetY } = getCropGeometry(p, iw, ih);
        ctx.save();
        ctx.beginPath();
        ctx.rect(ix, iy, iw, ih);
        ctx.clip();
        ctx.drawImage(p.img, ix - offsetX, iy - offsetY, drawnW, drawnH);
        ctx.restore();

        ctx.restore();
      }

      if (state.text && state.text.content.trim()) {
        drawText(ctx, state.text);
      }

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("the browser could not encode the PNG");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "postcard-jumbo.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast("Exported postcard-jumbo.png at full print size.");
    } catch (err) {
      showToast("Export failed: " + (err && err.message ? err.message : err), { error: true });
    } finally {
      exportBtn.disabled = false;
      exportLabel.textContent = "Export PNG";
    }
  });

  // ---- Full screen ----

  // On a phone in landscape the card is limited by the screen height, and
  // the browser's own bars take a good slice of it; since this page never
  // scrolls they don't slide away on their own either. Full screen (Android
  // Chrome; iPhones don't allow it for pages) gives that height back.
  if (document.fullscreenEnabled) {
    fullscreenBtn.hidden = false;
    fullscreenBtn.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      } catch (err) {
        showToast("Full screen is not available in this browser.", { error: true });
      }
    });
    document.addEventListener("fullscreenchange", () => {
      const on = Boolean(document.fullscreenElement);
      fullscreenBtn.classList.toggle("active", on);
      const title = on ? "Exit full screen" : "Full screen";
      fullscreenBtn.title = title;
      fullscreenBtn.setAttribute("aria-label", title);
      fullscreenBtn.querySelector(".icon-label").textContent = on ? "Exit" : "Full screen";
      relayout();
    });
  }

  // ---- Help ----

  helpBtn.addEventListener("click", () => helpDialog.showModal());
  helpCloseBtn.addEventListener("click", () => helpDialog.close());
  // Clicking the dimmed backdrop (the dialog element itself, outside its
  // content box) closes it.
  helpDialog.addEventListener("click", (e) => {
    if (e.target === helpDialog) helpDialog.close();
  });

  // ---- Leaving the page ----

  // Nothing is persisted, so an accidental back-swipe or tab close would
  // throw the whole collage away. Ask first once there's something to lose.
  window.addEventListener("beforeunload", (e) => {
    if (!hasContent()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // ---- Responsive ----

  let resizeRaf = null;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      relayout();
    });
  });

  state.grid = makeLeaf();
  render();
})();
