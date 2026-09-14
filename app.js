(() => {
  "use strict";

  // Jumbo postcard (Pokamax): 23.0 x 12.0 cm @ ~307 dpi
  const CANVAS_W = 2787;
  const CANVAS_H = 1488;

  // Photo frame: white border, equal thickness on all four sides, sized as
  // a fraction of the frame's own outer width (so it scales with the frame).
  const BORDER_RATIO = 0.09;
  const RATIO_PRESETS = [
    { w: 2, h: 3 },
    { w: 3, h: 2 },
  ];

  const FONT_FAMILY = "'Caveat', cursive";
  const MIN_PHOTO_W = 180;
  const MIN_FONT_SIZE = 30;
  const MAX_FONT_SIZE = 600;
  const MIN_IMG_SCALE = 1;
  const MAX_IMG_SCALE = 6;

  // POKAmax cuts ~35px (~6mm) off every edge in production ("Beschnitt").
  // This is a visual editing guide only and is never drawn into the export.
  const SAFE_MARGIN = 35;

  const state = {
    background: null, // { img, src }
    photos: [], // { id, img, src, x, y, w, h, ratioW, ratioH, imgScale, panX, panY, isPanning }
    text: null, // { id, content, x, y, fontSize }
    selectedId: null,
  };

  let scale = 1;
  let nextId = 1;
  const genId = () => "l" + nextId++;

  const stage = document.getElementById("stage");
  const bgLayer = document.getElementById("bgLayer");
  const emptyHint = document.getElementById("emptyHint");
  const layersContainer = document.getElementById("layersContainer");
  const safeZone = document.getElementById("safeZone");
  const bgInput = document.getElementById("bgInput");
  const photoInput = document.getElementById("photoInput");
  const addTextBtn = document.getElementById("addTextBtn");
  const resetBtn = document.getElementById("resetBtn");
  const exportBtn = document.getElementById("exportBtn");
  const viewportMeta = document.getElementById("viewportMeta");

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve({ img, src: reader.result });
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
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

  // ---- Rendering ----

  function render() {
    updateScale();

    if (state.background) {
      bgLayer.innerHTML = "";
      const img = document.createElement("img");
      img.src = state.background.src;
      bgLayer.appendChild(img);
      emptyHint.style.display = "none";
    } else {
      bgLayer.innerHTML = "";
      emptyHint.style.display = "flex";
    }

    layersContainer.innerHTML = "";
    state.photos.forEach((p) => layersContainer.appendChild(buildPhotoEl(p)));
    if (state.text) layersContainer.appendChild(buildTextEl(state.text));

    const m = worldToScreen(SAFE_MARGIN);
    safeZone.style.left = m + "px";
    safeZone.style.top = m + "px";
    safeZone.style.right = m + "px";
    safeZone.style.bottom = m + "px";
  }

  function buildHandles(layerEl, onDelete, onResizeStart) {
    const del = document.createElement("div");
    del.className = "handle handle-delete";
    del.textContent = "✕";
    del.title = "Delete";
    del.addEventListener("pointerdown", (e) => e.stopPropagation());
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      onDelete();
    });
    layerEl.appendChild(del);

    const resize = document.createElement("div");
    resize.className = "handle handle-resize";
    resize.textContent = "⤡";
    resize.title = "Resize";
    resize.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      onResizeStart(e);
    });
    layerEl.appendChild(resize);
  }

  function applyPhotoGeometry(p, el) {
    el.style.left = worldToScreen(p.x) + "px";
    el.style.top = worldToScreen(p.y) + "px";
    el.style.width = worldToScreen(p.w) + "px";
    el.style.height = worldToScreen(p.h) + "px";

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
        if (p.isPanning) startPan(e, p, el);
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

    el.addEventListener("dblclick", () => togglePanning(p, el));
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

    const ratioBtn = document.createElement("div");
    ratioBtn.className = "handle handle-ratio";
    ratioBtn.textContent = `${p.ratioW}:${p.ratioH}`;
    ratioBtn.title = "Switch aspect ratio";
    ratioBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    ratioBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cycleRatio(p, el, ratioBtn);
    });
    el.appendChild(ratioBtn);

    const panBtn = document.createElement("div");
    panBtn.className = "handle handle-pan";
    panBtn.textContent = "✋";
    panBtn.title = "Adjust crop (pan/zoom)";
    panBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    panBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanning(p, el);
    });
    el.appendChild(panBtn);

    const zoomPill = document.createElement("div");
    zoomPill.className = "zoom-pill";
    const zoomOutBtn = document.createElement("button");
    zoomOutBtn.type = "button";
    zoomOutBtn.textContent = "−";
    zoomOutBtn.title = "Zoom out";
    zoomOutBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    zoomOutBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      zoomPhoto(p, el, 1 / 1.2);
    });
    const zoomInBtn = document.createElement("button");
    zoomInBtn.type = "button";
    zoomInBtn.textContent = "+";
    zoomInBtn.title = "Zoom in";
    zoomInBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    zoomInBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      zoomPhoto(p, el, 1.2);
    });
    zoomPill.appendChild(zoomOutBtn);
    zoomPill.appendChild(zoomInBtn);
    el.appendChild(zoomPill);

    return el;
  }

  function cycleRatio(p, el, ratioBtn) {
    const idx = RATIO_PRESETS.findIndex(
      (r) => r.w === p.ratioW && r.h === p.ratioH
    );
    const next = RATIO_PRESETS[(idx + 1) % RATIO_PRESETS.length];
    p.ratioW = next.w;
    p.ratioH = next.h;
    p.h = outerHeightFor(p.w, p.ratioW, p.ratioH);
    p.imgScale = 1;
    p.panX = 0.5;
    p.panY = 0.5;
    ratioBtn.textContent = `${p.ratioW}:${p.ratioH}`;
    applyPhotoGeometry(p, el);
  }

  function togglePanning(p, el) {
    const next = !p.isPanning;
    state.photos.forEach((other) => {
      if (other !== p && other.isPanning) {
        other.isPanning = false;
        const oel = layersContainer.querySelector(`[data-id="${other.id}"]`);
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
    el.style.left = worldToScreen(t.x) + "px";
    el.style.top = worldToScreen(t.y) + "px";
    el.style.fontSize = worldToScreen(t.fontSize) + "px";
    el.style.webkitTextStrokeWidth = worldToScreen(t.fontSize * 0.08) + "px";

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
    el.addEventListener("dblclick", () => startEditingText(el, textContent, t));

    buildHandles(
      el,
      () => deleteLayer(t.id),
      (e) => startResizeText(e, t, el)
    );
    return el;
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
    if (state.selectedId === id) return;
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
      const el = layersContainer.querySelector(`[data-id="${id}"]`);
      if (el) el.classList.add("selected");
    }
  }

  function deselect() {
    select(null);
  }

  function deleteLayer(id) {
    state.photos = state.photos.filter((p) => p.id !== id);
    if (state.text && state.text.id === id) state.text = null;
    if (state.selectedId === id) state.selectedId = null;
    render();
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.target === stage || e.target === bgLayer || e.target === layersContainer || e.target === emptyHint) {
      deselect();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const panningPhoto = state.photos.find((p) => p.isPanning);
      if (panningPhoto) {
        panningPhoto.isPanning = false;
        const el = layersContainer.querySelector(`[data-id="${panningPhoto.id}"]`);
        if (el) el.classList.remove("panning");
        return;
      }
    }
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
    if (!state.selectedId) return;
    e.preventDefault();
    deleteLayer(state.selectedId);
  });

  // ---- Drag: move ----

  function startMove(e, layer, el) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
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
      el.style.left = worldToScreen(layer.x) + "px";
      el.style.top = worldToScreen(layer.y) + "px";
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

  function startPan(e, p, el) {
    e.preventDefault();
    e.stopPropagation();
    select(p.id);
    safeSetPointerCapture(el, e.pointerId);
    const { iw, ih } = getInnerRect(p);
    const { rangeX, rangeY } = getCropGeometry(p, iw, ih);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startPanX = p.panX ?? 0.5;
    const startPanY = p.panY ?? 0.5;

    function onMove(ev) {
      if (ev.pointerId !== e.pointerId) return;
      const dxWorld = screenToWorld(ev.clientX - startClientX);
      const dyWorld = screenToWorld(ev.clientY - startClientY);
      p.panX = rangeX > 0 ? clamp(startPanX - dxWorld / rangeX, 0, 1) : 0.5;
      p.panY = rangeY > 0 ? clamp(startPanY - dyWorld / rangeY, 0, 1) : 0.5;
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
    select(p.id);
    const handle = e.currentTarget;
    safeSetPointerCapture(handle, e.pointerId);
    const startClientX = e.clientX;
    const startW = p.w;

    function onMove(ev) {
      if (ev.pointerId !== e.pointerId) return;
      const dxWorld = screenToWorld(ev.clientX - startClientX);
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
      el.style.fontSize = worldToScreen(t.fontSize) + "px";
      el.style.webkitTextStrokeWidth = worldToScreen(t.fontSize * 0.08) + "px";
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

  bgInput.addEventListener("change", async () => {
    const file = bgInput.files[0];
    if (!file) return;
    const { img, src } = await loadImageFile(file);
    state.background = { img, src };
    bgInput.value = "";
    render();
  });

  // Preset spawn spots (fractions of the canvas) so newly added photos fan
  // out instead of landing almost exactly on top of the previous one.
  const PHOTO_SPAWN_SPOTS = [
    [0.06, 0.10],
    [0.60, 0.08],
    [0.10, 0.50],
    [0.58, 0.48],
    [0.34, 0.30],
  ];

  photoInput.addEventListener("change", async () => {
    const file = photoInput.files[0];
    if (!file) return;
    const { img, src } = await loadImageFile(file);
    const count = state.photos.length;
    const w = CANVAS_W * 0.22;
    const [fx, fy] = PHOTO_SPAWN_SPOTS[count % PHOTO_SPAWN_SPOTS.length];
    const extraCycles = Math.floor(count / PHOTO_SPAWN_SPOTS.length);
    const jitter = extraCycles * CANVAS_W * 0.03;
    const ratioW = RATIO_PRESETS[0].w;
    const ratioH = RATIO_PRESETS[0].h;
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
      isPanning: false,
    };
    state.photos.push(layer);
    state.selectedId = layer.id;
    photoInput.value = "";
    render();
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
    if (!confirm("Reset everything?")) return;
    state.background = null;
    state.photos = [];
    state.text = null;
    state.selectedId = null;
    render();
  });

  // ---- Export ----

  function drawCover(ctx, img, dx, dy, dw, dh) {
    const ir = img.width / img.height;
    const dr = dw / dh;
    let sx, sy, sw, sh;
    if (ir > dr) {
      sh = img.height;
      sw = sh * dr;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = sw / dr;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

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
    exportBtn.disabled = true;
    exportBtn.textContent = "Exporting…";
    try {
      await ensureFontsLoaded();
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      if (state.background) {
        drawCover(ctx, state.background.img, 0, 0, CANVAS_W, CANVAS_H);
      }

      for (const p of state.photos) {
        const b = p.w * BORDER_RATIO;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = b * 0.6;
        ctx.shadowOffsetY = b * 0.25;
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
      }

      if (state.text && state.text.content.trim()) {
        drawText(ctx, state.text);
      }

      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "postcard-jumbo.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }, "image/png");
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = "Export as PNG";
    }
  });

  // ---- Responsive ----

  let resizeRaf = null;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      render();
    });
  });

  render();
})();
