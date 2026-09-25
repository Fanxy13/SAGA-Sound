// Playlist cover maker: upload a photo (drag to position, zoom) or design one
// from a gradient preset, optionally with the title on top. Output is a 640px JPEG.
import { S } from './store.js';
import { icon } from './icons.js';
import { esc, rng, hash, clamp } from './util.js';
import { coverUrl, setCover, removeCover } from './covers.js';

const SIZE = 640;
const MARK = 'M5 16c1.7-5.6 3.8-5.6 5.5 0s3.8 5.6 5.5 0 3.8-5.6 5.5 0 3.8 5.6 5.5 0';

// [colour, x, y, radius] — positions and radius as fractions of the cover.
export const PRESETS = [
  { id: 'saga', base: '#1a0a24', ink: '#fff', blobs: [['#ff9a3c', 0.12, 0.08, 0.85], ['#ff4f5e', 0.92, 0.35, 0.8], ['#a85cff', 0.45, 1.05, 0.95]] },
  { id: 'ocean', base: '#03101d', ink: '#fff', blobs: [['#00c6ff', 0.1, 0.15, 0.85], ['#2b59ff', 0.95, 0.9, 0.95], ['#00ffc3', 0.85, 0.05, 0.6]] },
  { id: 'acid', base: '#0b0f06', ink: '#fff', blobs: [['#d4ff3a', 0.15, 0.12, 0.8], ['#1fd186', 0.9, 0.85, 0.9], ['#0a4d3c', 0.8, 0.2, 0.7]] },
  { id: 'berry', base: '#16000d', ink: '#fff', blobs: [['#ff2f92', 0.15, 0.85, 0.9], ['#7b2cff', 0.9, 0.15, 0.9], ['#ff8ad8', 0.7, 0.7, 0.5]] },
  { id: 'ember', base: '#150303', ink: '#fff', blobs: [['#ff5f1f', 0.85, 0.15, 0.85], ['#b3001b', 0.1, 0.9, 0.95], ['#ffc14d', 0.3, 0.2, 0.55]] },
  { id: 'aurora', base: '#020b12', ink: '#fff', blobs: [['#00ffa3', 0.1, 0.3, 0.7], ['#00b3ff', 0.5, 0.05, 0.7], ['#b400ff', 0.9, 0.5, 0.8], ['#ff006a', 0.6, 1, 0.7]] },
  { id: 'night', base: '#05050a', ink: '#fff', blobs: [['#27264f', 0.2, 0.2, 0.9], ['#5b3cc4', 0.9, 0.8, 0.7], ['#0f3057', 0.8, 0.1, 0.6]] },
  { id: 'mono', base: '#0a0a0a', ink: '#fff', blobs: [['#3a3a3a', 0.2, 0.15, 0.9], ['#1c1c1c', 0.85, 0.85, 0.9], ['#5a5a5a', 0.8, 0.2, 0.45]] },
  { id: 'peach', base: '#fff1e6', ink: '#1b1020', blobs: [['#ffb38a', 0.1, 0.1, 0.8], ['#ff7eb3', 0.95, 0.8, 0.8], ['#ffe29a', 0.8, 0.1, 0.6]] },
  { id: 'mint', base: '#eafff6', ink: '#0d2a22', blobs: [['#8ef0c8', 0.15, 0.85, 0.85], ['#7cc6ff', 0.9, 0.15, 0.8], ['#d9ff9e', 0.7, 0.65, 0.5]] },
];

const presetOf = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const swatchBg = (p) =>
  p.blobs
    .slice(0, 3)
    .map(([c, x, y]) => `radial-gradient(circle at ${Math.round(x * 100)}% ${Math.round(y * 100)}%, ${c} 0%, transparent 62%)`)
    .join(', ') + `, ${p.base}`;

let noise = null;
function grain(ctx) {
  if (!noise) {
    noise = document.createElement('canvas');
    noise.width = noise.height = 160;
    const n = noise.getContext('2d');
    const img = n.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    n.putImageData(img, 0, 0);
  }
  ctx.save();
  ctx.globalAlpha = 0.09;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(noise, 'repeat');
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.restore();
}

function mesh(ctx, preset, seed) {
  const r = rng(`${preset.id}:${seed}`);
  ctx.fillStyle = preset.base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (const [c, x, y, rad] of preset.blobs) {
    const j = seed ? 0.34 : 0;
    const cx = (x + (r() - 0.5) * j) * SIZE;
    const cy = (y + (r() - 0.5) * j) * SIZE;
    const rr = rad * (seed ? 0.8 + r() * 0.45 : 1) * SIZE;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0, rgba(c, 1));
    g.addColorStop(0.5, rgba(c, 0.55));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
}

function wrap(ctx, words, maxW) {
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (!cur || ctx.measureText(t).width <= maxW) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function title(ctx, text, layout, ink, onPhoto) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || layout === 'none') return;
  const pad = SIZE * 0.08;
  const maxW = SIZE - pad * 2;
  const center = layout === 'center';
  let fs = center ? 132 : 150;
  let lines = [];
  for (; fs >= 30; fs -= 4) {
    ctx.font = `800 ${fs}px Geist, ui-sans-serif, system-ui, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(-0.045 * fs).toFixed(1)}px`;
    lines = wrap(ctx, words, maxW);
    const fits = lines.every((l) => ctx.measureText(l).width <= maxW);
    if (fits && lines.length <= 3 && lines.length * fs * 0.95 <= SIZE * (center ? 0.7 : 0.52)) break;
  }
  const lh = fs * 0.95;
  const light = ink === '#fff';
  if (!center && light) {
    const g = ctx.createLinearGradient(0, SIZE * 0.45, 0, SIZE);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${onPhoto ? 0.5 : 0.28})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  ctx.save();
  ctx.fillStyle = ink;
  ctx.textBaseline = 'alphabetic';
  if (onPhoto) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 36;
  }
  if (center) {
    ctx.textAlign = 'center';
    const y0 = SIZE / 2 - (lines.length * lh) / 2 + fs * 0.76;
    lines.forEach((l, i) => ctx.fillText(l, SIZE / 2, y0 + i * lh));
  } else {
    ctx.textAlign = 'left';
    const y0 = SIZE - pad - (lines.length - 1) * lh;
    lines.forEach((l, i) => ctx.fillText(l, pad - fs * 0.03, y0 + i * lh));
    ctx.shadowBlur = 0;
    const k = 2.3;
    ctx.translate(pad - 5 * k, pad - 10.4 * k);
    ctx.scale(k, k);
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = 2.7;
    ctx.lineCap = 'round';
    ctx.stroke(new Path2D(MARK));
  }
  ctx.restore();
}

async function decode(file) {
  let src;
  try {
    src = await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    src = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
  }
  // Keep dragging smooth: work on a copy no larger than 1600px.
  const w = src.width;
  const h = src.height;
  const k = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  src.close?.();
  return c;
}

export async function openCoverEditor(pid, { toast = () => {} } = {}) {
  const p = S.playlist(pid);
  if (!p) return;
  const d = document.getElementById('dlg');
  const saved = p.cover || {};
  const st = {
    mode: saved.mode === 'image' ? 'image' : 'design',
    preset: saved.preset || PRESETS[hash(pid) % PRESETS.length].id,
    seed: saved.seed || 0,
    layout: saved.layout || 'bottom',
    text: saved.text ?? p.title,
    img: null,
    zoom: 1,
    ox: 0,
    oy: 0,
  };
  const hasOwn = !!coverUrl(pid);

  d.className = 'dlg ce-dlg';
  d.innerHTML = `<div class="ce">
    <button class="ib sm dlg-x" data-close aria-label="Schließen">${icon('x')}</button>
    <div class="ce-stage">
      <canvas width="${SIZE}" height="${SIZE}" aria-label="Cover"></canvas>
      <label class="ce-drop">${icon('imageUp')}<input type="file" accept="image/*" hidden></label>
    </div>
    <div class="ce-panel">
      <div class="seg" role="tablist">
        <button data-ce-mode="design" role="tab">${icon('palette')}<span>Design</span></button>
        <button data-ce-mode="image" role="tab">${icon('image')}<span>Bild</span></button>
      </div>
      <div class="ce-design">
        <div class="ce-sw">${PRESETS.map((pr) => `<button class="sw" data-ce-preset="${pr.id}" style="background:${swatchBg(pr)}" aria-label="${pr.id}"></button>`).join('')}
          <button class="sw dice" data-ce="dice" aria-label="Würfeln">${icon('dice')}</button></div>
      </div>
      <div class="ce-image">
        <div class="ce-zoom">${icon('zoomOut')}<input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">${icon('zoomIn')}</div>
        <button class="pill" data-ce="pick">${icon('imageUp')}<span>Bild wählen</span></button>
      </div>
      <div class="ce-text">
        <label class="ce-in">${icon('type')}<input maxlength="60" value="${esc(st.text)}" spellcheck="false" aria-label="Text"></label>
        <div class="seg sm">
          <button data-ce-layout="bottom" aria-label="Unten">${icon('alignStart')}</button>
          <button data-ce-layout="center" aria-label="Mitte">${icon('alignCenter')}</button>
          <button data-ce-layout="none" aria-label="Ohne Text">${icon('noText')}</button>
        </div>
      </div>
      <div class="ce-actions">
        ${hasOwn ? `<button class="ib" data-ce="remove" aria-label="Cover entfernen">${icon('trash')}</button>` : ''}
        <button class="pill solid" data-ce="save">${icon('check')}<span>Speichern</span></button>
      </div>
    </div>
  </div>`;

  const cv = d.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const file = d.querySelector('input[type=file]');
  const zoom = d.querySelector('.ce-zoom input');
  const text = d.querySelector('.ce-in input');

  const draw = () => {
    ctx.save();
    ctx.clearRect(0, 0, SIZE, SIZE);
    const pr = presetOf(st.preset);
    if (st.mode === 'image' && st.img) {
      const base = Math.max(SIZE / st.img.width, SIZE / st.img.height) * st.zoom;
      const w = st.img.width * base;
      const h = st.img.height * base;
      st.ox = clamp(st.ox, -(w - SIZE) / 2, (w - SIZE) / 2);
      st.oy = clamp(st.oy, -(h - SIZE) / 2, (h - SIZE) / 2);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(st.img, (SIZE - w) / 2 + st.ox, (SIZE - h) / 2 + st.oy, w, h);
    } else {
      mesh(ctx, pr, st.seed);
      grain(ctx);
    }
    ctx.restore();
    const photo = st.mode === 'image' && !!st.img;
    title(ctx, st.text, st.layout, photo ? '#fff' : pr.ink, photo);
  };

  const sync = () => {
    d.querySelectorAll('[data-ce-mode]').forEach((b) => b.classList.toggle('on', b.dataset.ceMode === st.mode));
    d.querySelectorAll('[data-ce-preset]').forEach((b) => b.classList.toggle('on', b.dataset.cePreset === st.preset));
    d.querySelectorAll('[data-ce-layout]').forEach((b) => b.classList.toggle('on', b.dataset.ceLayout === st.layout));
    d.querySelector('.ce').dataset.mode = st.mode;
    d.querySelector('.ce').classList.toggle('no-img', st.mode === 'image' && !st.img);
    zoom.value = st.zoom;
    zoom.style.setProperty('--v', `${((st.zoom - 1) / 3) * 100}%`);
    draw();
  };

  const load = async (f) => {
    if (!f?.type?.startsWith('image/')) return;
    try {
      st.img = await decode(f);
    } catch {
      return toast('Bild nicht lesbar', 'x');
    }
    st.mode = 'image';
    st.zoom = 1;
    st.ox = st.oy = 0;
    if (!saved.text && st.text === p.title) st.layout = 'none';
    sync();
  };

  // Re-open an uploaded cover so it can be re-positioned (its text is already baked in).
  if (st.mode === 'image' && hasOwn) {
    try {
      st.img = await decode(await (await fetch(coverUrl(pid))).blob());
      st.layout = 'none';
    } catch {}
  }

  d.onclick = async (e) => {
    const b = e.target.closest('[data-ce-mode],[data-ce-preset],[data-ce-layout],[data-ce]');
    if (!b) return;
    if (b.dataset.ceMode) st.mode = b.dataset.ceMode;
    else if (b.dataset.cePreset) {
      st.preset = b.dataset.cePreset;
      st.mode = 'design';
    } else if (b.dataset.ceLayout) st.layout = b.dataset.ceLayout;
    else if (b.dataset.ce === 'dice') {
      st.seed = (hash(Date.now() + ':' + st.seed) % 9999) + 1;
      st.mode = 'design';
    } else if (b.dataset.ce === 'pick') return file.click();
    else if (b.dataset.ce === 'remove') {
      await removeCover(pid);
      S.setPlaylistCover(pid, null);
      d.close();
      return toast('Cover entfernt', 'check');
    } else if (b.dataset.ce === 'save') {
      b.disabled = true;
      draw();
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
      try {
        if (!blob) throw new Error('blob');
        await setCover(pid, blob);
        S.setPlaylistCover(pid, { mode: st.mode, preset: st.preset, seed: st.seed, layout: st.layout, text: st.text, at: Date.now() });
        d.close();
        toast('Cover gespeichert', 'check');
      } catch {
        b.disabled = false;
        toast('Speichern fehlgeschlagen', 'x');
      }
      return;
    }
    sync();
  };

  file.onchange = () => {
    load(file.files?.[0]);
    file.value = '';
  };
  zoom.oninput = () => {
    st.zoom = Number(zoom.value);
    zoom.style.setProperty('--v', `${((st.zoom - 1) / 3) * 100}%`);
    draw();
  };
  text.oninput = () => {
    st.text = text.value;
    if (st.layout === 'none' && st.text.trim()) st.layout = 'bottom';
    sync();
  };

  const stage = d.querySelector('.ce-stage');
  stage.ondragover = (e) => {
    e.preventDefault();
    stage.classList.add('over');
  };
  stage.ondragleave = () => stage.classList.remove('over');
  stage.ondrop = (e) => {
    e.preventDefault();
    stage.classList.remove('over');
    load(e.dataTransfer?.files?.[0]);
  };

  // Drag to position, wheel / pinch-free zoom via the slider or the mouse wheel.
  let drag = null;
  cv.onpointerdown = (e) => {
    if (st.mode !== 'image' || !st.img) return;
    drag = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy };
    cv.setPointerCapture(e.pointerId);
    d.classList.add('dragging');
  };
  cv.onpointermove = (e) => {
    if (!drag) return;
    const k = SIZE / cv.getBoundingClientRect().width;
    st.ox = drag.ox + (e.clientX - drag.x) * k;
    st.oy = drag.oy + (e.clientY - drag.y) * k;
    draw();
  };
  cv.onpointerup = cv.onpointercancel = () => {
    drag = null;
    setTimeout(() => d.classList.remove('dragging'), 0);
  };
  cv.onwheel = (e) => {
    if (st.mode !== 'image' || !st.img) return;
    e.preventDefault();
    st.zoom = clamp(st.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 1, 4);
    zoom.value = st.zoom;
    zoom.style.setProperty('--v', `${((st.zoom - 1) / 3) * 100}%`);
    draw();
  };

  d.addEventListener('close', () => (d.onclick = null), { once: true });
  try {
    await document.fonts?.load('800 100px Geist');
  } catch {}
  sync();
  d.showModal();
}
