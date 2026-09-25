// Everything that talks to SoundCloud: the official HTML5 Widget API (playback + metadata)
// and the public oEmbed endpoint (resolving links and profile names). No API key needed.
import { sleep } from './util.js';

const API_JS = 'https://w.soundcloud.com/player/api.js';
const PLAYER = 'https://w.soundcloud.com/player/';
const OEMBED = 'https://soundcloud.com/oembed';

const BASE = {
  auto_play: false,
  buying: false,
  sharing: false,
  download: false,
  liking: false,
  show_artwork: true,
  show_playcount: false,
  show_user: true,
  show_comments: false,
  show_reposts: false,
  show_teaser: false,
  hide_related: true,
  visual: false,
  single_active: false,
  color: '#ff5a36',
};

let apiPromise = null;

export function loadApi() {
  if (window.SC?.Widget) return Promise.resolve(window.SC);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = API_JS;
    s.async = true;
    const fail = (e) => {
      apiPromise = null;
      s.remove();
      reject(e);
    };
    const t = setTimeout(() => fail(new Error('sc-timeout')), 15000);
    s.onload = () => {
      clearTimeout(t);
      window.SC?.Widget ? resolve(window.SC) : fail(new Error('sc-missing'));
    };
    s.onerror = () => {
      clearTimeout(t);
      fail(new Error('sc-offline'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export const apiUrl = (kind, id) => `https://api.soundcloud.com/${kind}s/${id}`;

function src(url, params) {
  const q = new URLSearchParams();
  q.set('url', url);
  for (const [k, v] of Object.entries({ ...BASE, ...params })) q.set(k, String(v));
  return PLAYER + '?' + q;
}

const EVENTS = ['READY', 'PLAY', 'PAUSE', 'FINISH', 'SEEK', 'PLAY_PROGRESS', 'LOAD_PROGRESS', 'ERROR'];

export class Widget {
  constructor(name, hostId) {
    this.name = name;
    this.hostId = hostId;
    this.iframe = null;
    this.w = null;
    this.handlers = {};
    this.pending = null;
  }

  on(evt, fn) {
    (this.handlers[evt] ||= []).push(fn);
  }

  _emit(evt, data) {
    if (evt === 'READY') this.pending?.done();
    if (evt === 'ERROR') this.pending?.fail(new Error('sc-error'));
    this.handlers[evt]?.forEach((fn) => fn(data || {}));
  }

  async _create(url, params) {
    const SC = await loadApi();
    const f = document.createElement('iframe');
    f.title = 'SoundCloud';
    f.allow = 'autoplay; encrypted-media';
    f.src = src(url, params);
    document.getElementById(this.hostId).appendChild(f);
    this.iframe = f;
    let w = null;
    for (let i = 0; i < 20 && !w; i++) {
      try {
        w = SC.Widget(f);
      } catch {
        await sleep(60);
      }
    }
    if (!w) throw new Error('sc-widget');
    this.w = w;
    const E = SC.Widget.Events;
    EVENTS.forEach((k) => E[k] && w.bind(E[k], (d) => this._emit(k, d)));
  }

  // Resolves once the widget reports READY for the new sound.
  load(url, params = {}, timeout = 15000) {
    this.pending?.fail(new Error('superseded'));
    return new Promise((resolve, reject) => {
      const p = {
        done: () => {
          if (this.pending !== p) return;
          clearTimeout(p.t);
          this.pending = null;
          resolve();
        },
        fail: (e) => {
          if (this.pending !== p) return;
          clearTimeout(p.t);
          this.pending = null;
          reject(e);
        },
      };
      p.t = setTimeout(() => p.fail(new Error('sc-timeout')), timeout);
      this.pending = p;
      if (!this.w) this._create(url, params).catch(p.fail);
      else this.w.load(url, { ...BASE, ...params, callback: () => p.done() });
    });
  }

  call(method, ...args) {
    try {
      this.w?.[method](...args);
    } catch {}
  }

  get(method, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.w) return reject(new Error('no-widget'));
      const t = setTimeout(() => reject(new Error('sc-timeout')), timeout);
      try {
        this.w[method]((v) => {
          clearTimeout(t);
          resolve(v);
        });
      } catch (e) {
        clearTimeout(t);
        reject(e);
      }
    });
  }
}

// A second, silent widget used only to read collections (likes, uploads, playlists).
// Jobs run one at a time so SoundCloud never sees bursts.
export const scout = (() => {
  let w = null;
  const q = [];
  let running = false;

  const hydrated = (s) => !!(s && s.title);

  async function run(job) {
    w ||= new Widget('scout', 'sc-scout');
    await w.load(job.url, {}, 20000);
    if (job.one) {
      await sleep(250);
      return await w.get('getCurrentSound', 8000);
    }
    let best = [];
    let bestH = -1;
    let stable = 0;
    for (let i = 0; i < 18 && stable < 3; i++) {
      await sleep(i === 0 ? 400 : 700);
      let list;
      try {
        list = await w.get('getSounds', 6000);
      } catch {
        continue;
      }
      list = Array.isArray(list) ? list.filter(Boolean) : [];
      const h = list.reduce((n, s) => n + (hydrated(s) ? 1 : 0), 0);
      if (list.length === best.length && h === bestH) stable++;
      else {
        stable = 0;
        best = list;
        bestH = h;
      }
    }
    return best;
  }

  async function pump() {
    if (running) return;
    running = true;
    while (q.length) {
      const job = q.shift();
      try {
        job.resolve(await run(job));
      } catch (e) {
        job.reject(e);
      }
      await sleep(350);
    }
    running = false;
  }

  function add(job, first) {
    return new Promise((resolve, reject) => {
      Object.assign(job, { resolve, reject });
      first ? q.unshift(job) : q.push(job);
      pump();
    });
  }

  return {
    collect: (url, first = false) => add({ url }, first),
    one: (url, first = false) => add({ url, one: true }, first),
    get busy() {
      return running || q.length > 0;
    },
  };
})();

// ---------- oEmbed ----------

function innerResource(html) {
  let s = String(html || '').replace(/&amp;/g, '&');
  const m = s.match(/src=["']([^"']+)["']/i);
  if (!m) return null;
  let u = '';
  try {
    u = new URL(m[1]).searchParams.get('url') || '';
  } catch {
    return null;
  }
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(u); i++) {
    try {
      u = decodeURIComponent(u);
    } catch {
      break;
    }
  }
  const r = u.match(/api\.soundcloud\.com\/(tracks|playlists|users)\/(?:soundcloud:(?:tracks|playlists|users):)?(\d+)/i);
  return r ? { kind: r[1].toLowerCase().slice(0, -1), id: Number(r[2]) } : null;
}

const oembedCache = new Map();

export async function resolve(url) {
  if (oembedCache.has(url)) return oembedCache.get(url);
  const res = await fetch(`${OEMBED}?format=json&url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'not-found' : 'oembed-' + res.status);
  const j = await res.json();
  const r = innerResource(j.html);
  if (!r) throw new Error('unsupported');
  const out = {
    ...r,
    title: j.title || '',
    author: j.author_name || '',
    authorUrl: j.author_url || '',
    thumb: j.thumbnail_url || '',
    url,
  };
  oembedCache.set(url, out);
  return out;
}

// Accepts "name", "soundcloud.com/name", full links, on.soundcloud.com short links.
export function parseInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(soundcloud\.com|on\.soundcloud\.com)\/(\S+)$/i);
  if (m) {
    const path = m[2].split(/[?#]/)[0].replace(/\/+$/, '');
    const host = m[1].toLowerCase() === 'on.soundcloud.com' ? 'on.soundcloud.com' : 'soundcloud.com';
    return { url: `https://${host}/${path}`, slug: host === 'soundcloud.com' && !path.includes('/') ? path.toLowerCase() : '' };
  }
  if (/^[a-z0-9][a-z0-9_-]{1,60}$/i.test(s)) return { url: `https://soundcloud.com/${s.toLowerCase()}`, slug: s.toLowerCase() };
  return null;
}

export const isLink = (s) => /soundcloud\.com\//i.test(String(s || ''));
