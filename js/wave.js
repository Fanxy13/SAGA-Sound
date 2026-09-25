// Waveform scrubber drawn on a canvas. Uses SoundCloud's waveform data when it can be read,
// otherwise falls back to a slim progress line.
import { clamp, fmtTime } from './util.js';

const cache = new Map();

export function loadWave(url) {
  if (!url) return Promise.resolve(null);
  const jsonUrl = url.replace(/\.png(\?.*)?$/, '.json');
  if (!/\.json(\?|$)/.test(jsonUrl)) return Promise.resolve(null);
  if (!cache.has(jsonUrl)) {
    cache.set(
      jsonUrl,
      fetch(jsonUrl)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const s = j?.samples;
          if (!Array.isArray(s) || s.length < 8) return null;
          const max = Math.max(j.height || 0, ...s) || 1;
          return s.map((v) => v / max);
        })
        .catch(() => null),
    );
  }
  return cache.get(jsonUrl);
}

export class Wave {
  constructor(el, onSeek) {
    this.el = el;
    this.onSeek = onSeek;
    this.samples = null;
    this.bars = null;
    this.p = 0;
    this.buf = 0;
    this.dur = 0;
    this.hover = -1;
    this.drag = false;
    this.dpr = 1;
    this.c = document.createElement('canvas');
    this.tip = document.createElement('span');
    this.tip.className = 'wave-tip';
    el.append(this.c, this.tip);
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', 'Position');
    el.tabIndex = 0;
    new ResizeObserver(() => this.resize()).observe(el);
    this.colors();

    const frac = (e) => {
      const r = this.el.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.dur) return;
      this.drag = true;
      el.setPointerCapture(e.pointerId);
      this.hover = frac(e);
      this.draw();
    });
    el.addEventListener('pointermove', (e) => {
      this.hover = frac(e);
      this.showTip(e);
      this.draw();
    });
    el.addEventListener('pointerup', (e) => {
      if (!this.drag) return;
      this.drag = false;
      const f = frac(e);
      this.p = f;
      this.onSeek(f * this.dur);
      this.draw();
    });
    el.addEventListener('pointerleave', () => {
      if (this.drag) return;
      this.hover = -1;
      this.tip.classList.remove('on');
      this.draw();
    });
    el.addEventListener('keydown', (e) => {
      if (!this.dur) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        this.onSeek(this.p * this.dur + (e.key === 'ArrowRight' ? 5000 : -5000));
      }
    });
  }

  showTip(e) {
    if (!this.dur) return;
    const r = this.el.getBoundingClientRect();
    this.tip.textContent = fmtTime(this.hover * this.dur);
    this.tip.style.left = `${clamp(e.clientX - r.left, 16, r.width - 16)}px`;
    this.tip.classList.add('on');
  }

  colors(c) {
    const cs = getComputedStyle(this.el);
    this.col = {
      a: c?.a || cs.getPropertyValue('--accent').trim() || '#ff5a36',
      b: c?.b || cs.getPropertyValue('--accent-2').trim() || '#ff3d7f',
      rest: 'rgba(255,255,255,0.16)',
      buf: 'rgba(255,255,255,0.26)',
      hover: 'rgba(255,255,255,0.5)',
    };
    this.draw();
  }

  set(samples) {
    this.samples = samples;
    this.bars = null;
    this.draw();
  }

  update(pos, dur, buf) {
    this.dur = dur || 0;
    this.p = this.drag ? this.p : dur ? clamp(pos / dur, 0, 1) : 0;
    this.buf = clamp(buf || 0, 0, 1);
    this.el.setAttribute('aria-valuenow', Math.round(this.p * 100));
    this.draw();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.c.width = Math.max(1, Math.round(r.width * dpr));
    this.c.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
    this.bars = null;
    this.draw();
  }

  computeBars() {
    const dpr = this.dpr || 1;
    const bw = 2 * dpr;
    const gap = 1.5 * dpr;
    const n = Math.max(8, Math.floor(this.c.width / (bw + gap)));
    const s = this.samples;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i / n) * s.length);
      const b = Math.max(a + 1, Math.floor(((i + 1) / n) * s.length));
      let m = 0;
      for (let k = a; k < b; k++) m = Math.max(m, s[k]);
      out[i] = Math.pow(m, 0.9);
    }
    this.bars = { v: out, bw, gap };
  }

  draw() {
    const { c } = this;
    const ctx = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const px = this.p * W;
    const bx = this.buf * W;
    const hx = this.hover >= 0 ? this.hover * W : -1;
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, this.col.a);
    grad.addColorStop(1, this.col.b);

    if (this.samples) {
      if (!this.bars) this.computeBars();
      const { v, bw, gap } = this.bars;
      for (let i = 0; i < v.length; i++) {
        const x = i * (bw + gap);
        const h = Math.max(2 * this.dpr, v[i] * H * 0.94);
        const y = (H - h) / 2;
        if (x + bw <= px) ctx.fillStyle = grad;
        else if (hx >= 0 && x <= hx) ctx.fillStyle = this.col.hover;
        else if (x <= bx) ctx.fillStyle = this.col.buf;
        else ctx.fillStyle = this.col.rest;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, bw, h, bw / 2) : ctx.rect(x, y, bw, h);
        ctx.fill();
      }
    } else {
      const lh = Math.max(3, 4 * (this.dpr || 1));
      const y = (H - lh) / 2;
      const line = (x0, x1, style) => {
        if (x1 <= x0) return;
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x0, y, x1 - x0, lh, lh / 2) : ctx.rect(x0, y, x1 - x0, lh);
        ctx.fill();
      };
      line(0, W, this.col.rest);
      line(0, bx, this.col.buf);
      if (hx > px) line(0, hx, this.col.hover);
      line(0, px, grad);
      if (this.dur && (hx >= 0 || this.drag)) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(Math.max(lh, px), H / 2, lh * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
