(() => {
  "use strict";

  // Jumbo postcard (Pokamax): 23.0 x 12.0 cm @ ~307 dpi
  const CANVAS_W = 2787;
  const CANVAS_H = 1488;

  // Polaroid-style photo frame, defined in frame units (aspect-ratio locked).
  const INNER_W = 200;
  const INNER_H = 300; // inner image area is 2:3
  const BORDER_SIDE = 22;
  const BORDER_TOP = 22;
  const BORDER_BOTTOM = 60;
  const OUTER_W = INNER_W + BORDER_SIDE * 2;
  const OUTER_H = INNER_H + BORDER_TOP + BORDER_BOTTOM;
  const OUTER_ASPECT = OUTER_W / OUTER_H;

  const FONT_FAMILY = "'Caveat', cursive";
  const MIN_PHOTO_W = OUTER_W * 0.4;
  const MIN_FONT_SIZE = 30;
  const MAX_FONT_SIZE = 600;

  const state = {
    background: null, // { img, src }
    photos: [], // { id, img, x, y, w, h }
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
  const bgInput = document.getElementById("bgInput");
  const photoInput = document.getElementById("photoInput");
  const addTextBtn = document.getElementById("addTextBtn");
  const resetBtn = document.getElementById("resetBtn");
  const exportBtn = document.getElementById("exportBtn");

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
  }

  function buildHandles(layerEl, onDelete, onResizeStart) {
    const del = document.createElement("div");
    del.className = "handle handle-delete";
    del.textContent = "✕";
    del.addEventListener("pointerdown", (e) => e.stopPropagation());
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      onDelete();
    });
    layerEl.appendChild(del);

    const resize = document.createElement("div");
    resize.className = "handle handle-resize";
    resize.textContent = "⤡";
    resize.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      onResizeStart(e);
    });
    layerEl.appendChild(resize);
  }

  function buildPhotoEl(p) {
    const el = document.createElement("div");
    el.className = "layer" + (state.selectedId === p.id ? " selected" : "");
    el.dataset.id = p.id;
    el.style.left = worldToScreen(p.x) + "px";
    el.style.top = worldToScreen(p.y) + "px";
    el.style.width = worldToScreen(p.w) + "px";
    el.style.height = worldToScreen(p.h) + "px";

    const frame = document.createElement("div");
    frame.className = "photo-frame";
    frame.style.position = "absolute";
    frame.style.inset = "0";

    const k = p.w / OUTER_W;
    const img = document.createElement("img");
    img.src = p.src;
    img.style.left = worldToScreen(BORDER_SIDE * k) + "px";
    img.style.top = worldToScreen(BORDER_TOP * k) + "px";
    img.style.width = worldToScreen(INNER_W * k) + "px";
    img.style.height = worldToScreen(INNER_H * k) + "px";
    frame.appendChild(img);
    el.appendChild(frame);

    el.addEventListener("pointerdown", (e) => startMove(e, p, el));
    buildHandles(
      el,
      () => deleteLayer(p.id),
      (e) => startResizePhoto(e, p, el)
    );
    return el;
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
    el.textContent = t.content;
    el.spellcheck = false;

    el.addEventListener("pointerdown", (e) => {
      if (el.isContentEditable) return;
      startMove(e, t, el);
    });
    el.addEventListener("dblclick", () => startEditingText(el, t));

    buildHandles(
      el,
      () => deleteLayer(t.id),
      (e) => startResizeText(e, t, el)
    );
    return el;
  }

  function startEditingText(el, t) {
    el.classList.add("editing");
    el.contentEditable = "true";
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const commit = () => {
      el.removeEventListener("blur", commit);
      el.contentEditable = "false";
      el.classList.remove("editing");
      const value = el.innerText.replace(/\r/g, "");
      t.content = value.trim() === "" ? t.content : value;
      render();
    };
    el.addEventListener("blur", commit);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        el.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        el.blur();
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
    const prevEl = layersContainer.querySelector(".layer.selected");
    if (prevEl) prevEl.classList.remove("selected");
    state.selectedId = id;
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
    el.setPointerCapture(e.pointerId);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startX = layer.x;
    const startY = layer.y;

    function onMove(ev) {
      const dx = screenToWorld(ev.clientX - startClientX);
      const dy = screenToWorld(ev.clientY - startClientY);
      layer.x = startX + dx;
      layer.y = startY + dy;
      el.style.left = worldToScreen(layer.x) + "px";
      el.style.top = worldToScreen(layer.y) + "px";
    }
    function onUp(ev) {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }

  // ---- Drag: resize photo (uniform, aspect-locked) ----

  function startResizePhoto(e, p, el) {
    e.preventDefault();
    select(p.id);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startClientX = e.clientX;
    const startW = p.w;

    function onMove(ev) {
      const dxWorld = screenToWorld(ev.clientX - startClientX);
      let newW = clamp(startW + dxWorld, MIN_PHOTO_W, CANVAS_W * 1.3);
      p.w = newW;
      p.h = newW / OUTER_ASPECT;
      applyPhotoGeometry(p, el);
    }
    function onUp(ev) {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function applyPhotoGeometry(p, el) {
    el.style.width = worldToScreen(p.w) + "px";
    el.style.height = worldToScreen(p.h) + "px";
    const k = p.w / OUTER_W;
    const img = el.querySelector("img");
    img.style.left = worldToScreen(BORDER_SIDE * k) + "px";
    img.style.top = worldToScreen(BORDER_TOP * k) + "px";
    img.style.width = worldToScreen(INNER_W * k) + "px";
    img.style.height = worldToScreen(INNER_H * k) + "px";
  }

  // ---- Drag: resize text (font size) ----

  function startResizeText(e, t, el) {
    e.preventDefault();
    select(t.id);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const startDist = Math.max(20, Math.hypot(e.clientX - centerX, e.clientY - centerY));
    const startFont = t.fontSize;

    function onMove(ev) {
      const dist = Math.hypot(ev.clientX - centerX, ev.clientY - centerY);
      const factor = dist / startDist;
      t.fontSize = clamp(startFont * factor, MIN_FONT_SIZE, MAX_FONT_SIZE);
      el.style.fontSize = worldToScreen(t.fontSize) + "px";
      el.style.webkitTextStrokeWidth = worldToScreen(t.fontSize * 0.08) + "px";
    }
    function onUp(ev) {
      handle.releasePointerCapture(ev.pointerId);
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
    const h = w / OUTER_ASPECT;
    const [fx, fy] = PHOTO_SPAWN_SPOTS[count % PHOTO_SPAWN_SPOTS.length];
    const extraCycles = Math.floor(count / PHOTO_SPAWN_SPOTS.length);
    const jitter = extraCycles * CANVAS_W * 0.03;
    const layer = {
      id: genId(),
      img,
      src,
      x: CANVAS_W * fx + jitter,
      y: CANVAS_H * fy + jitter,
      w,
      h,
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
      content: "Viele Grüße aus ...",
      x: CANVAS_W * 0.5,
      y: CANVAS_H * 0.86,
      fontSize: 130,
    };
    state.selectedId = state.text.id;
    render();
  });

  resetBtn.addEventListener("click", () => {
    if (!confirm("Wirklich alles zurücksetzen?")) return;
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
    exportBtn.textContent = "Exportiere …";
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
        const k = p.w / OUTER_W;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 14 * k;
        ctx.shadowOffsetY = 6 * k;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.restore();

        const ix = p.x + BORDER_SIDE * k;
        const iy = p.y + BORDER_TOP * k;
        const iw = INNER_W * k;
        const ih = INNER_H * k;
        ctx.save();
        ctx.beginPath();
        ctx.rect(ix, iy, iw, ih);
        ctx.clip();
        drawCover(ctx, p.img, ix, iy, iw, ih);
        ctx.restore();
      }

      if (state.text && state.text.content.trim()) {
        drawText(ctx, state.text);
      }

      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "postkarte-jumbo.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }, "image/png");
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = "Als PNG exportieren";
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
