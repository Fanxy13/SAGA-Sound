import { debounce, uid } from './util.js';

const NS = 'sagasound:';
const MAX_TRACKS = 7000;
const MAX_HISTORY = 2500;

const PARTS = {
  core: ['me', 'likes', 'hidden', 'follows', 'playlists', 'seeds', 'prefs', 'synced', 'recent'],
  catalog: ['tracks', 'users'],
  history: ['history'],
  sources: ['sources'],
  session: ['session'],
};

const blank = () => ({
  me: null,
  likes: [], // [{id, at, src: 'sc' | 'ss'}], newest first
  hidden: [], // SoundCloud likes removed inside SagaSound
  follows: [], // [{id, at}]
  playlists: [], // [{id, title, kind: 'local' | 'sc', sc, tracks, art, uid, url, at}]
  seeds: [], // [{slug, uid}]
  prefs: { volume: 80, shuffle: false, repeat: 'off', autoplay: true },
  synced: 0,
  recent: [], // recently played contexts
  tracks: {},
  users: {},
  history: [], // [{id, at, ms, done, skip}], newest first
  sources: {}, // key -> {at, ids, ok}
  session: { queue: [], index: -1, pos: 0, ctx: null },
});

const listeners = new Map();
const dirty = new Set();
let likeSet = new Set();
let statsCache = null;

export const S = {
  ...blank(),
  v: 0,

  on(topic, fn) {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic).add(fn);
    return () => listeners.get(topic).delete(fn);
  },

  emit(topic) {
    S.v++;
    if (topic === 'history' || topic === '*') statsCache = null;
    if (topic === 'library' || topic === '*') likeSet = new Set(S.likes.map((l) => l.id));
    for (const t of [topic, '*']) listeners.get(t)?.forEach((fn) => fn(topic));
  },

  touch(...parts) {
    parts.forEach((p) => dirty.add(p));
    flushSoon();
  },

  // ---------- catalog ----------
  track: (id) => S.tracks[id],
  user: (id) => S.users[id],

  ingest(sounds, { emit = true } = {}) {
    const ids = [];
    const seen = new Set();
    const now = Date.now();
    for (const s of sounds || []) {
      const u = userFrom(s?.user);
      if (u) S.users[u.id] = mergeUser(S.users[u.id], u);
      const t = trackFrom(s);
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      ids.push(t.id);
      const old = S.tracks[t.id];
      if (old?.ok && !t.ok) {
        old.seen = now;
        continue;
      }
      t.seen = now;
      S.tracks[t.id] = t;
    }
    prune();
    S.touch('catalog');
    if (emit) S.emit('catalog');
    return ids;
  },

  addUser(u) {
    if (!u?.id) return;
    S.users[u.id] = mergeUser(S.users[u.id], u);
    S.touch('catalog');
  },

  stubs() {
    const want = new Set();
    S.likes.forEach((l) => want.add(l.id));
    S.playlists.forEach((p) => p.tracks.forEach((id) => want.add(id)));
    return [...want].filter((id) => !S.tracks[id]?.ok);
  },

  // ---------- likes ----------
  isLiked: (id) => likeSet.has(id),

  toggleLike(id) {
    if (likeSet.has(id)) {
      const l = S.likes.find((x) => x.id === id);
      S.likes = S.likes.filter((x) => x.id !== id);
      if (l?.src === 'sc' && !S.hidden.includes(id)) S.hidden.push(id);
    } else {
      S.likes.unshift({ id, at: Date.now(), src: 'ss' });
      S.hidden = S.hidden.filter((x) => x !== id);
    }
    S.touch('core');
    S.emit('library');
    return likeSet.has(id);
  },

  importLikes(ids) {
    const known = new Map(S.likes.map((l) => [l.id, l]));
    const hidden = new Set(S.hidden);
    const now = Date.now();
    const firstKnown = ids.findIndex((id) => known.has(id));
    const head = [];
    const tail = [];
    ids.forEach((id, i) => {
      if (known.has(id) || hidden.has(id)) return;
      if (firstKnown === -1 || i < firstKnown) head.push(id);
      else tail.push(id);
    });
    const oldest = S.likes.length ? S.likes[S.likes.length - 1].at : now;
    S.likes = [
      ...head.map((id, i) => ({ id, at: now - i * 60e3, src: 'sc' })),
      ...S.likes,
      ...tail.map((id, i) => ({ id, at: oldest - (i + 1) * 60e3, src: 'sc' })),
    ];
    S.touch('core');
    S.emit('library');
    return head.length + tail.length;
  },

  // ---------- follows ----------
  isFollowing: (id) => S.follows.some((f) => f.id === id),

  toggleFollow(id) {
    if (S.isFollowing(id)) S.follows = S.follows.filter((f) => f.id !== id);
    else S.follows.unshift({ id, at: Date.now() });
    S.touch('core');
    S.emit('library');
    return S.isFollowing(id);
  },

  // ---------- playlists ----------
  playlist: (id) => S.playlists.find((p) => p.id === id),

  createPlaylist(title) {
    const p = { id: 'p' + uid(), title: title || 'Neue Playlist', kind: 'local', tracks: [], at: Date.now() };
    S.playlists.unshift(p);
    S.touch('core');
    S.emit('library');
    return p;
  },

  addToPlaylist(pid, ids) {
    const p = S.playlist(pid);
    if (!p) return 0;
    const add = ids.filter((id) => !p.tracks.includes(id));
    p.tracks.push(...add);
    S.touch('core');
    S.emit('library');
    return add.length;
  },

  removeFromPlaylist(pid, index) {
    const p = S.playlist(pid);
    if (!p) return;
    p.tracks.splice(index, 1);
    S.touch('core');
    S.emit('library');
  },

  renamePlaylist(pid, title) {
    const p = S.playlist(pid);
    if (!p || !title) return;
    p.title = title;
    S.touch('core');
    S.emit('library');
  },

  deletePlaylist(pid) {
    S.playlists = S.playlists.filter((p) => p.id !== pid);
    S.touch('core');
    S.emit('library');
  },

  upsertScPlaylist(pl) {
    const id = 'sc' + pl.sc;
    const old = S.playlist(id);
    const next = { id, kind: 'sc', at: old?.at || Date.now(), ...pl };
    if (old) Object.assign(old, next);
    else S.playlists.unshift(next);
    S.touch('core');
    S.emit('library');
    return id;
  },

  // ---------- history ----------
  addHistory(entry) {
    S.history.unshift({ at: Date.now(), ...entry });
    if (S.history.length > MAX_HISTORY) S.history.length = MAX_HISTORY;
    S.touch('history');
    S.emit('history');
  },

  playStats() {
    if (statsCache) return statsCache;
    const m = new Map();
    for (const h of S.history) {
      let s = m.get(h.id);
      if (!s) m.set(h.id, (s = { n: 0, done: 0, skip: 0, last: h.at, ms: 0 }));
      s.n++;
      if (h.done) s.done++;
      if (h.skip) s.skip++;
      s.ms += h.ms || 0;
    }
    return (statsCache = m);
  },

  recentTracks(n = 30) {
    const out = [];
    const seen = new Set();
    for (const h of S.history) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(h.id);
      if (out.length >= n) break;
    }
    return out;
  },

  touchContext(ctx) {
    if (!ctx?.type || ctx.type === 'queue' || ctx.type === 'radio') return;
    S.recent = [{ ...ctx, at: Date.now() }, ...S.recent.filter((c) => !(c.type === ctx.type && c.id === ctx.id))].slice(0, 12);
    S.touch('core');
    S.emit('recent');
  },

  // ---------- discovery sources ----------
  setSource(key, ids, ok = true) {
    S.sources[key] = { at: Date.now(), ids: ids.slice(0, 200), ok };
    S.touch('sources');
    S.emit('sources');
  },

  sourceAge(key) {
    const s = S.sources[key];
    return s ? Date.now() - s.at : Infinity;
  },

  // ---------- prefs / session ----------
  setPref(k, v) {
    S.prefs[k] = v;
    S.touch('core');
    S.emit('prefs');
  },

  saveSession(sess) {
    S.session = sess;
    S.touch('session');
  },

  setMe(me) {
    S.me = me;
    if (me) S.addUser({ id: me.id, name: me.name, slug: me.slug, avatar: me.avatar, url: me.url });
    S.touch('core');
    S.emit('me');
  },

  // ---------- backup ----------
  exportData() {
    const out = { app: 'sagasound', v: 1, at: Date.now() };
    for (const keys of Object.values(PARTS)) keys.forEach((k) => (out[k] = S[k]));
    return out;
  },

  importData(data) {
    if (!data || data.app !== 'sagasound') throw new Error('invalid');
    const b = blank();
    for (const keys of Object.values(PARTS)) {
      keys.forEach((k) => {
        if (data[k] !== undefined && typeof data[k] === typeof b[k]) S[k] = data[k];
      });
    }
    S.prefs = { ...b.prefs, ...S.prefs };
    S.touch(...Object.keys(PARTS));
    flush();
    S.emit('*');
  },

  reset() {
    Object.keys(PARTS).forEach((p) => localStorage.removeItem(NS + p));
    Object.assign(S, blank());
    dirty.clear();
    S.emit('*');
  },
};

// ---------- normalisation of SoundCloud widget objects ----------

function parseTags(s) {
  if (!s) return [];
  const out = [];
  String(s).replace(/"([^"]+)"|(\S+)/g, (_, q, w) => {
    const t = (q || w).trim().toLowerCase();
    if (t && t.length < 40 && !out.includes(t)) out.push(t);
    return '';
  });
  return out.slice(0, 12);
}

export function userFrom(u) {
  if (!u || !u.id) return null;
  const avatar = u.avatar_url && !/default_avatar/.test(u.avatar_url) ? u.avatar_url : '';
  return {
    id: u.id,
    name: u.username || u.full_name || u.permalink || '',
    slug: u.permalink || '',
    avatar,
    url: u.permalink_url || (u.permalink ? `https://soundcloud.com/${u.permalink}` : ''),
    verified: !!u.verified,
    followers: u.followers_count ?? null,
  };
}

function mergeUser(old, u) {
  if (!old) return u;
  const out = { ...old };
  for (const [k, v] of Object.entries(u)) if (v !== '' && v != null) out[k] = v;
  return out;
}

export function trackFrom(s) {
  if (!s || !s.id || (s.kind && s.kind !== 'track')) return null;
  if (!s.title) return { id: s.id, ok: false };
  return {
    id: s.id,
    ok: true,
    title: s.title,
    uid: s.user?.id ?? s.user_id ?? 0,
    art: s.artwork_url || '',
    dur: s.duration || s.full_duration || 0,
    full: s.full_duration || s.duration || 0,
    genre: String(s.genre || '').trim(),
    tags: parseTags(s.tag_list),
    plays: s.playback_count ?? 0,
    likes: s.likes_count ?? s.favoritings_count ?? 0,
    date: Date.parse(s.created_at || s.display_date || '') || 0,
    url: s.permalink_url || '',
    wave: s.waveform_url || '',
    policy: s.policy || '',
  };
}

// ---------- persistence ----------

function prune() {
  const ids = Object.keys(S.tracks);
  if (ids.length <= MAX_TRACKS) return;
  const keep = new Set();
  S.likes.forEach((l) => keep.add(String(l.id)));
  S.playlists.forEach((p) => p.tracks.forEach((id) => keep.add(String(id))));
  S.history.slice(0, 800).forEach((h) => keep.add(String(h.id)));
  (S.session.queue || []).forEach((id) => keep.add(String(id)));
  const drop = ids
    .filter((id) => !keep.has(id))
    .sort((a, b) => (S.tracks[a].seen || 0) - (S.tracks[b].seen || 0));
  const target = ids.length - Math.floor(MAX_TRACKS * 0.85);
  drop.slice(0, Math.max(0, target)).forEach((id) => delete S.tracks[id]);
}

function write(part) {
  const data = {};
  PARTS[part].forEach((k) => (data[k] = S[k]));
  const json = JSON.stringify(data);
  try {
    localStorage.setItem(NS + part, json);
  } catch {
    if (part !== 'catalog') return;
    // Storage full: drop the least recently seen half of the catalog and retry once.
    const ids = Object.keys(S.tracks).sort((a, b) => (S.tracks[a].seen || 0) - (S.tracks[b].seen || 0));
    ids.slice(0, Math.floor(ids.length / 2)).forEach((id) => delete S.tracks[id]);
    try {
      localStorage.setItem(NS + 'catalog', JSON.stringify({ tracks: S.tracks, users: S.users }));
    } catch {}
  }
}

function flush() {
  dirty.forEach(write);
  dirty.clear();
}

const flushSoon = debounce(flush, 500);

export function loadStore() {
  const b = blank();
  for (const [part, keys] of Object.entries(PARTS)) {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(NS + part) || 'null');
    } catch {}
    if (!data) continue;
    keys.forEach((k) => {
      if (data[k] !== undefined && data[k] !== null && typeof data[k] === typeof b[k]) S[k] = data[k];
    });
  }
  S.prefs = { ...b.prefs, ...S.prefs };
  likeSet = new Set(S.likes.map((l) => l.id));
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}
