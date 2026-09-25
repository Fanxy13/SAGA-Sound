export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const DAY = 864e5;

export function fmtTime(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function fmtTotal(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (m < 60) return `${m} Min`;
  const h = Math.floor(m / 60);
  return `${h} Std ${m % 60} Min`;
}

const compact = new Intl.NumberFormat('de', { notation: 'compact', maximumFractionDigits: 1 });
export const fmtCount = (n) => compact.format(n || 0);

export function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60e3) return 'gerade';
  if (d < 3600e3) return `vor ${Math.floor(d / 60e3)} Min`;
  if (d < DAY) return `vor ${Math.floor(d / 3600e3)} Std`;
  if (d < 2 * DAY) return 'gestern';
  if (d < 7 * DAY) return `vor ${Math.floor(d / DAY)} Tagen`;
  return new Date(ts).toLocaleDateString('de', { day: 'numeric', month: 'short' });
}

export function hash(str) {
  let h = 0x811c9dc5;
  str = String(str);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function rafOnce(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

// SoundCloud artwork comes as "...-large.jpg" (100px); swap the size token.
export function art(url, size = 't300x300') {
  if (!url) return '';
  return url.replace(/-(large|t\d+x\d+|crop|original|small|badge|tiny|mini)(\.\w+)(\?.*)?$/, `-${size}$2`);
}

// Stable hue for things without artwork (mixes, fallback covers).
export const hueOf = (key) => hash(key) % 360;

export function gradientFor(key) {
  const h = hueOf(key);
  return `radial-gradient(120% 90% at 15% 10%, hsl(${h} 85% 62%) 0%, transparent 60%),` +
    `radial-gradient(90% 80% at 90% 30%, hsl(${(h + 55) % 360} 90% 56%) 0%, transparent 62%),` +
    `radial-gradient(110% 90% at 50% 110%, hsl(${(h + 300) % 360} 80% 45%) 0%, transparent 65%),` +
    `hsl(${h} 30% 12%)`;
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || '').join('').toUpperCase() || '?';
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 11) return 'Guten Morgen';
  if (h >= 11 && h < 18) return 'Guten Tag';
  if (h >= 18 && h < 23) return 'Guten Abend';
  return 'Gute Nacht';
}
