// Picks a vivid accent from the current artwork and tints the whole app with it.
import { hash } from './util.js';

const cache = new Map();

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function extract(img) {
  const n = 28;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, n, n);
  const d = ctx.getImageData(0, 0, n, n).data;
  const bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (l < 0.1 || l > 0.93 || s < 0.18) continue;
    const w = s * s * Math.max(0.05, 1 - Math.abs(l - 0.55) * 1.5);
    const k = Math.round(h / 24) % 15;
    const b = bins.get(k) || { w: 0, x: 0, y: 0, s: 0, l: 0 };
    const rad = (h * Math.PI) / 180;
    b.w += w;
    b.x += Math.cos(rad) * w;
    b.y += Math.sin(rad) * w;
    b.s += s * w;
    b.l += l * w;
    bins.set(k, b);
  }
  let best = null;
  for (const b of bins.values()) if (!best || b.w > best.w) best = b;
  if (!best || best.w < 0.6) return null;
  const h = ((Math.atan2(best.y, best.x) * 180) / Math.PI + 360) % 360;
  return { h: Math.round(h), s: Math.min(0.95, Math.max(0.62, best.s / best.w)), l: Math.min(0.66, Math.max(0.56, best.l / best.w)) };
}

export const fallbackAccent = (key) => ({ h: hash(key || 'saga') % 360, s: 0.86, l: 0.62 });

export function accentFrom(url, key) {
  if (!url) return Promise.resolve(fallbackAccent(key));
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const t = setTimeout(() => resolve(fallbackAccent(key)), 6000);
    img.onload = () => {
      clearTimeout(t);
      try {
        resolve(extract(img) || fallbackAccent(key));
      } catch {
        resolve(fallbackAccent(key));
      }
    };
    img.onerror = () => {
      clearTimeout(t);
      resolve(fallbackAccent(key));
    };
    img.src = url;
  });
  cache.set(url, p);
  return p;
}

export function applyAccent({ h, s, l }) {
  const st = document.documentElement.style;
  const S = Math.round(s * 100);
  const L = Math.round(l * 100);
  const a = `hsl(${h} ${S}% ${L}%)`;
  const b = `hsl(${(h + 326) % 360} ${Math.min(100, S + 4)}% ${Math.max(48, L - 6)}%)`;
  st.setProperty('--accent', a);
  st.setProperty('--accent-2', b);
  st.setProperty('--accent-soft', `hsl(${h} ${S}% ${L}% / 0.16)`);
  st.setProperty('--accent-glow', `hsl(${h} ${S}% ${L}% / 0.45)`);
  return { a, b };
}
