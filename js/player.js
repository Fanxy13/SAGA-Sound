// Playback controller. SagaSound owns the queue, shuffle, repeat, endless radio and history;
// the sound comes from one of two engines:
//  - 'sc':   the official SoundCloud widget (hidden iframe)
//  - 'file': a plain <audio> element for imported files
//
// Background tabs: browsers refuse to start a freshly loaded widget document while the tab is
// hidden, and the widget reloads its iframe for every load(). So SoundCloud tracks are played
// inside a SoundCloud collection that contains them (likes, uploads, playlists, discovery
// sources). Later tracks from the same collection switch with skip() inside the same document,
// which keeps working in the background. If the next queued track lives elsewhere while the tab
// is hidden, playback continues inside the current collection instead of stopping.
import { S } from './store.js';
import { Widget, apiUrl } from './sc.js';
import { radio, pick } from './algo.js';
import { fileUrl, fileArt, isLocal } from './files.js';
import { art, clamp, debounce, shuffled } from './util.js';

const w = new Widget('player', 'sc-player');
const au = new Audio();
au.preload = 'auto';

export const P = {
  queue: [],
  index: -1,
  ctx: null,
  original: null,
  playing: false,
  loading: false,
  blocked: false,
  pos: 0,
  dur: 0,
  buf: 0,
  vol: 80,
  muted: false,
  shuffle: false,
  repeat: 'off',
  autoplay: true,
};

const subs = {};
export const onPlayer = (evt, fn) => (subs[evt] ||= new Set()).add(fn);
const fire = (evt, data) => subs[evt]?.forEach((fn) => fn(P, data));

export const currentId = () => P.queue[P.index];
export const current = () => S.tracks[currentId()];

let active = null; // engine of the current track
let doc = null; // what the widget iframe holds: { key, url, ids }
let docPlayed = false; // the widget document has played audio (needed to switch tracks in a hidden tab)
let expect = null; // track the widget should be playing; checked on the next PLAY
const single = new Set(); // tracks whose collection index turned out wrong: load them on their own
let loadedId = null;
let wantPlay = false;
let listened = 0;
let lastPos = 0;
let started = false;
let errors = 0;
let pendingSeek = 0;
let guard = null;
let primed = false;
let silentUrl = '';

const hidden = () => document.visibilityState === 'hidden';
// Chromium and WebKit hold back new players in hidden tabs; Firefox does not, so it keeps the queue order.
const bgDefers = !/Firefox\//.test(navigator.userAgent);

// ---------- shared event handling ----------

function onPlay(src) {
  if (src !== active) return;
  if (src === 'sc') docPlayed = true;
  P.playing = true;
  P.loading = false;
  P.blocked = false;
  errors = 0;
  clearTimeout(guard);
  if (pendingSeek) {
    seekEngine(pendingSeek);
    pendingSeek = 0;
  }
  if (src === 'sc' && expect != null) verify(expect);
  fire('state');
  media();
}

function onPause(src) {
  if (src !== active || P.loading) return;
  P.playing = false;
  fire('state');
  media();
}

function onProgress(src, pos, rel, buf) {
  if (src !== active || P.loading || !loadedId) return;
  const d = pos - lastPos;
  if (d > 0 && d < 3000) listened += d;
  lastPos = pos;
  P.pos = pos;
  if (buf != null) P.buf = buf;
  if (!P.dur && rel > 0.01) P.dur = pos / rel;
  fire('progress');
}

function onFinish(src) {
  if (src !== active || P.loading || !loadedId) return;
  commit(true);
  if (P.repeat === 'one') restart();
  else advance(false);
}

// widget
w.on('PLAY', () => onPlay('sc'));
w.on('PAUSE', () => onPause('sc'));
w.on('PLAY_PROGRESS', (e) => onProgress('sc', e.currentPosition || 0, e.relativePosition || 0, e.loadProgress ?? e.loadedProgress));
w.on('LOAD_PROGRESS', (e) => {
  const lp = e.loadProgress ?? e.loadedProgress;
  if (active === 'sc' && lp != null) {
    P.buf = lp;
    fire('progress');
  }
});
w.on('SEEK', (e) => {
  if (active !== 'sc' || P.loading) return;
  P.pos = e.currentPosition ?? P.pos;
  lastPos = P.pos;
  fire('progress');
});
w.on('FINISH', () => onFinish('sc'));
w.on('ERROR', () => active === 'sc' && !P.loading && failed());

// <audio>
const buffered = () => {
  try {
    return au.duration ? au.buffered.end(au.buffered.length - 1) / au.duration : 0;
  } catch {
    return 0;
  }
};
au.addEventListener('playing', () => onPlay('file'));
au.addEventListener('pause', () => !au.ended && onPause('file'));
au.addEventListener('timeupdate', () => onProgress('file', au.currentTime * 1000, au.duration ? au.currentTime / au.duration : 0, buffered()));
au.addEventListener('ended', () => onFinish('file'));
au.addEventListener('durationchange', () => {
  if (active === 'file' && Number.isFinite(au.duration) && au.duration > 0) {
    P.dur = au.duration * 1000;
    fire('progress');
  }
});
au.addEventListener('error', () => {
  if (active === 'file' && au.src && au.src !== silentUrl && !P.loading) failed();
});

// ---------- engines ----------

function seekEngine(ms) {
  if (active === 'file') au.currentTime = ms / 1000;
  else w.call('seekTo', ms);
}

function volumeEngine() {
  const v = P.muted ? 0 : P.vol;
  w.call('setVolume', v);
  au.volume = v / 100;
}

// Imported files play through the page's own <audio>. Browsers only let a hidden tab start that
// element if it has played before, so it plays a moment of silence on the first user action.
function prime() {
  if (primed || active === 'file' || !S.hasFiles()) return;
  primed = true;
  try {
    if (!silentUrl) silentUrl = URL.createObjectURL(silentWav());
    au.src = silentUrl;
    au.play()?.then(() => au.pause(), () => {});
  } catch {}
}

function silentWav() {
  const n = 800;
  const b = new DataView(new ArrayBuffer(44 + n));
  const str = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  b.setUint32(4, 36 + n, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true);
  b.setUint32(28, 8000, true);
  b.setUint16(32, 1, true);
  b.setUint16(34, 8, true);
  str(36, 'data');
  b.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
  return new Blob([b.buffer], { type: 'audio/wav' });
}

// ---------- SoundCloud collections ----------

let hosts = null;
let hostsV = -1;

// track id -> collections that contain it, with the position the widget will show it at
function hostIndex() {
  if (hosts && hostsV === S.v) return hosts;
  const m = new Map();
  const add = (key, url, ids) => {
    if (!ids || ids.length < 2) return;
    ids.forEach((id, idx) => {
      if (!(id > 0)) return;
      let list = m.get(id);
      if (!list) m.set(id, (list = []));
      list.push({ key, url, ids, idx });
    });
  };
  for (const [key, src] of Object.entries(S.sources)) {
    const [kind, uid, what] = key.split(':');
    if (kind === 'u' && src.ok !== false) add(key, apiUrl('user', uid) + (what === 'likes' ? '/favorites' : ''), src.ids);
  }
  for (const p of S.playlists) if (p.kind === 'sc' && p.sc) add(`p:${p.sc}`, apiUrl('playlist', p.sc), p.tracks);
  hosts = m;
  hostsV = S.v;
  return m;
}

function ctxHostKey() {
  const c = P.ctx;
  if (!c) return '';
  if (c.type === 'likes') return `u:${S.me?.id}:likes`;
  if (c.type === 'uploads') return `u:${S.me?.id}:tracks`;
  if (c.type === 'artist' || c.type === 'artist-new') return `u:${c.id}:tracks`;
  if (c.type === 'artist-likes') return `u:${c.id}:likes`;
  if (c.type === 'playlist') {
    const p = S.playlist(c.id);
    return p?.kind === 'sc' ? `p:${p.sc}` : '';
  }
  return '';
}

// The collection that fits best: the playing context first, then the one that also holds most
// of the upcoming queue, then the one with the most music after this track.
function pickHost(id) {
  if (single.has(id)) return null;
  const list = hostIndex().get(id);
  if (!list?.length) return null;
  const upcoming = P.queue.slice(P.index + 1, P.index + 16);
  const ck = ctxHostKey();
  let best = null;
  let bestScore = -Infinity;
  for (const h of list) {
    const set = new Set(h.ids);
    const overlap = upcoming.reduce((n, x) => n + (set.has(x) ? 1 : 0), 0);
    const score = (h.key === ck ? 1000 : 0) + overlap * 10 + Math.min(h.ids.length - h.idx - 1, 30);
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

// Next track to play from the collection the widget already holds (background continuation).
function continuation() {
  if (!doc || doc.ids.length < 2) return null;
  const cur = Math.max(0, doc.ids.indexOf(loadedId));
  const avoid = new Set([...S.recentTracks(80), ...P.queue.slice(Math.max(0, P.index - 100), P.index + 1)]);
  const cands = [];
  for (let k = 1; k < doc.ids.length && cands.length < 25; k++) {
    const id = doc.ids[(cur + k) % doc.ids.length];
    const t = S.tracks[id];
    if (id != null && !avoid.has(id) && !t?.bad && t?.policy !== 'BLOCK') cands.push(id);
  }
  if (!cands.length) return null;
  return pick(cands, 1, { perArtist: 1 })[0] ?? cands[0];
}

// Make sure the widget plays the planned sound; its list can differ from what the scout saw.
async function verify(id) {
  expect = null;
  const s = await w.get('getCurrentSound').catch(() => null);
  if (currentId() !== id || active !== 'sc' || !s?.id) return;
  if (s.id === id) {
    S.ingest([s]);
    if (S.tracks[id]?.dur) P.dur = S.tracks[id].dur;
    fire('track');
    media();
    w.get('getDuration')
      .then((d) => {
        if (currentId() === id && d > 0) {
          P.dur = d;
          fire('progress');
        }
      })
      .catch(() => {});
    return;
  }
  const list = await w.get('getSounds').catch(() => null);
  if (currentId() !== id) return;
  const k = Array.isArray(list) ? list.findIndex((x) => x?.id === id) : -1;
  if (k >= 0 && doc) {
    doc.ids = list.map((x) => x?.id);
    expect = id;
    w.call('skip', k);
    w.call('play');
    return;
  }
  if (hidden()) {
    // Can't reload in the background: keep what is playing and show it.
    S.ingest([s]);
    P.queue.splice(P.index, 0, s.id);
    loadedId = s.id;
    fire('track');
    fire('queue');
    return;
  }
  single.add(id);
  start(P.index, 0);
}

function armGuard(id) {
  clearTimeout(guard);
  // Some browsers (mostly iOS) refuse to start audio in an iframe without a tap inside it.
  guard = setTimeout(async () => {
    if (currentId() !== id || P.playing || !wantPlay || active !== 'sc' || hidden()) return;
    const paused = await w.get('isPaused').catch(() => true);
    if (paused && currentId() === id && !P.playing && !hidden()) {
      P.blocked = true;
      fire('state');
    }
  }, 4500);
}

// ---------- history ----------

function commit(done = false, skipped = false) {
  const id = loadedId;
  if (!id || !started) return;
  started = false;
  const dur = P.dur || S.tracks[id]?.dur || 0;
  const ms = dur ? Math.min(listened, dur) : listened;
  listened = 0;
  if (ms < 4000 && !done) return;
  const full = done || (dur > 0 && ms > dur * 0.85);
  const skip = !full && skipped && ms < Math.min(30000, dur * 0.35 || 30000);
  S.addHistory({ id, ms: Math.round(ms), done: !!full, skip: !!skip });
}

// ---------- core ----------

async function start(i, pos = 0) {
  if (i < 0 || i >= P.queue.length) return;
  const id = P.queue[i];
  P.index = i;
  P.pos = pos;
  P.buf = 0;
  P.dur = S.tracks[id]?.dur || 0;
  P.loading = true;
  P.playing = false;
  P.blocked = false;
  loadedId = null;
  lastPos = pos;
  listened = 0;
  wantPlay = true;
  pendingSeek = pos > 1500 ? pos : 0;
  clearTimeout(guard);
  fire('track');
  fire('state');
  fire('queue');
  persist();
  media();
  if (isLocal(id)) return startFile(id);
  return startSC(id);
}

async function startFile(id) {
  active = 'file';
  expect = null;
  w.call('pause');
  const url = await fileUrl(id);
  if (currentId() !== id || active !== 'file') return;
  if (!url) return failed();
  au.src = url;
  volumeEngine();
  if (pendingSeek) {
    au.currentTime = pendingSeek / 1000;
    pendingSeek = 0;
  }
  loadedId = id;
  started = true;
  try {
    await au.play();
  } catch (e) {
    if (currentId() !== id || active !== 'file' || e?.name === 'AbortError') return;
    if (e?.name === 'NotAllowedError') {
      P.loading = false;
      P.playing = false;
      return fire('state');
    }
    failed();
  }
}

async function startSC(id) {
  if (active === 'file') au.pause();
  active = 'sc';
  const k = doc ? doc.ids.indexOf(id) : -1;
  if (k >= 0) {
    // Same widget document: no reload, so this also works while the tab is in the background.
    expect = id;
    loadedId = id;
    started = true;
    volumeEngine();
    w.call('skip', k);
    w.call('play');
    armGuard(id);
    return;
  }
  const h = pickHost(id);
  const url = h ? h.url : apiUrl('track', id);
  expect = id;
  doc = null;
  try {
    await w.load(url, h ? { auto_play: true, start_track: h.idx } : { auto_play: true });
  } catch (e) {
    if (e.message === 'superseded' || currentId() !== id) return;
    return failed();
  }
  if (currentId() !== id || active !== 'sc') return;
  doc = { key: h ? h.key : `t:${id}`, url, ids: h ? h.ids.slice() : [id] };
  docPlayed = false;
  loadedId = id;
  started = true;
  volumeEngine();
  if (h) {
    const idx = await w.get('getCurrentSoundIndex').catch(() => h.idx);
    if (currentId() === id && idx !== h.idx) {
      w.call('skip', h.idx);
      w.call('play');
    }
  }
  armGuard(id);
  fire('state');
}

function failed() {
  const id = currentId();
  if (S.tracks[id]) S.tracks[id].bad = Date.now();
  P.loading = false;
  P.playing = false;
  loadedId = null;
  fire('state');
  fire('error', id);
  if (++errors >= 4) {
    errors = 0;
    return;
  }
  setTimeout(() => {
    if (currentId() === id) advance(false);
  }, 900);
}

function restart() {
  listened = 0;
  lastPos = 0;
  started = true;
  if (active === 'file') {
    au.currentTime = 0;
    au.play().catch(() => {});
  } else {
    w.call('seekTo', 0);
    w.call('play');
  }
}

function advance(user) {
  let i = P.index + 1;
  if (i >= P.queue.length) {
    if (P.repeat === 'all' && P.queue.length) i = 0;
    else if (P.autoplay && P.queue.length) {
      const exclude = new Set([...P.queue.slice(-300), ...S.recentTracks(40)]);
      const more = radio(currentId(), 15, exclude);
      P.queue.push(...more);
      P.original?.push(...more);
    }
  }
  const nextId = P.queue[i];
  if (nextId == null) {
    if (!user) {
      P.playing = false;
      fire('state');
    }
    return;
  }
  if (bgDefers && hidden() && !isLocal(nextId) && doc && docPlayed && !doc.ids.includes(nextId)) {
    const cont = continuation();
    if (cont != null) {
      P.queue.splice(P.index + 1, 0, cont);
      return start(P.index + 1);
    }
  }
  start(i);
}

// ---------- public controls ----------

export function playList(ids, startAt = 0, ctx = null) {
  const list = ids.filter((id) => id != null && !S.tracks[id]?.bad);
  if (!list.length) return;
  commit(false, true);
  let i = clamp(list.indexOf(ids[startAt]), 0, list.length - 1);
  P.original = null;
  P.queue = list.slice(0, 1500);
  if (P.shuffle) {
    const first = P.queue[i];
    P.original = P.queue.slice();
    P.queue = [first, ...shuffled(P.queue.filter((_, k) => k !== i))];
    i = 0;
  }
  P.ctx = ctx;
  S.touchContext(ctx);
  prime();
  start(i);
}

export function shufflePlay(ids, ctx) {
  if (!P.shuffle) toggleShuffle();
  playList(ids, Math.floor(Math.random() * ids.length), ctx);
}

export function toggle() {
  if (P.index < 0 || !P.queue.length) return;
  prime();
  if (!loadedId && !P.loading) return start(P.index, P.pos);
  if (P.loading) return;
  if (P.playing) {
    wantPlay = false;
    if (active === 'file') au.pause();
    else w.call('pause');
  } else {
    wantPlay = true;
    if (active === 'file') au.play().catch(() => {});
    else w.call('play');
  }
}

export function next(user = true) {
  if (user) commit(false, true);
  advance(user);
}

export function prev() {
  if (P.index < 0) return;
  if (P.pos > 4000 || P.index === 0) return seek(0);
  commit(false, true);
  start(P.index - 1);
}

export function jump(i) {
  if (i === P.index || i < 0 || i >= P.queue.length) return;
  commit(false, true);
  start(i);
}

export function seek(ms) {
  if (P.index < 0) return;
  ms = Math.max(0, P.dur ? Math.min(ms, P.dur - 500) : ms);
  P.pos = ms;
  lastPos = ms;
  if (loadedId) seekEngine(ms);
  else pendingSeek = ms;
  fire('progress');
  persist();
}

export const seekBy = (d) => seek(P.pos + d);

export function setVolume(v) {
  P.vol = clamp(Math.round(v), 0, 100);
  P.muted = false;
  volumeEngine();
  S.setPref('volume', P.vol);
  fire('state');
}

export function toggleMute() {
  P.muted = !P.muted;
  volumeEngine();
  fire('state');
}

export function toggleShuffle() {
  P.shuffle = !P.shuffle;
  S.setPref('shuffle', P.shuffle);
  if (P.index >= 0) {
    const cur = currentId();
    if (P.shuffle) {
      P.original = P.queue.slice();
      P.queue = [...P.queue.slice(0, P.index + 1), ...shuffled(P.queue.slice(P.index + 1))];
    } else if (P.original) {
      const i = P.original.indexOf(cur);
      if (i >= 0) {
        P.queue = P.original;
        P.index = i;
      }
      P.original = null;
    }
  }
  fire('state');
  fire('queue');
  persist();
}

export function cycleRepeat() {
  P.repeat = { off: 'all', all: 'one', one: 'off' }[P.repeat] || 'off';
  S.setPref('repeat', P.repeat);
  fire('state');
}

export function setAutoplay(on) {
  P.autoplay = !!on;
  S.setPref('autoplay', P.autoplay);
  fire('state');
}

export function playNext(ids) {
  if (P.index < 0) return playList(ids, 0, { type: 'queue' });
  P.queue.splice(P.index + 1, 0, ...ids);
  P.original?.push(...ids);
  fire('queue');
  persist();
}

export function enqueue(ids) {
  if (P.index < 0) return playList(ids, 0, { type: 'queue' });
  P.queue.push(...ids);
  P.original?.push(...ids);
  fire('queue');
  persist();
}

export function removeAt(i) {
  if (i === P.index || i < 0 || i >= P.queue.length) return;
  P.queue.splice(i, 1);
  if (i < P.index) P.index--;
  fire('queue');
  persist();
}

// Drops a track everywhere in the queue (e.g. a deleted file).
export function forget(id) {
  if (currentId() === id) {
    if (active === 'file') au.pause();
    if (P.index < P.queue.length - 1) next(false);
    else {
      P.playing = false;
      loadedId = null;
    }
  }
  const cur = currentId();
  P.queue = P.queue.filter((x) => x !== id);
  P.original = P.original?.filter((x) => x !== id) || null;
  P.index = Math.max(-1, P.queue.indexOf(cur));
  fire('queue');
  fire('track');
  fire('state');
  persist();
}

export function clearUpcoming() {
  P.queue.length = P.index + 1;
  P.original = null;
  fire('queue');
  persist();
}

// ---------- session ----------

const persist = debounce(() => {
  S.saveSession({ queue: P.queue.slice(0, 600), index: P.index, pos: Math.round(P.pos), ctx: P.ctx });
}, 700);

setInterval(() => P.playing && persist(), 5000);

export function restore() {
  P.shuffle = !!S.prefs.shuffle;
  P.repeat = S.prefs.repeat || 'off';
  P.autoplay = S.prefs.autoplay !== false;
  P.vol = S.prefs.volume ?? 80;
  const s = S.session;
  if (s?.queue?.length && s.index >= 0 && s.index < s.queue.length) {
    P.queue = s.queue;
    P.index = s.index;
    P.pos = s.pos || 0;
    P.ctx = s.ctx || null;
    P.dur = S.tracks[currentId()]?.dur || 0;
  }
  fire('track');
  fire('state');
  fire('progress');
  media();
}

// ---------- OS media controls ----------

function media() {
  const t = current();
  if (!('mediaSession' in navigator) || !t) return;
  try {
    const cover = isLocal(t.id) ? fileArt(t.id) : t.art ? art(t.art, 't500x500') : '';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || '',
      artist: S.users[t.uid]?.name || '',
      album: P.ctx?.title || 'SagaSound',
      artwork: cover ? [{ src: cover, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.playbackState = P.playing ? 'playing' : 'paused';
  } catch {}
}

if ('mediaSession' in navigator) {
  const h = {
    play: () => !P.playing && toggle(),
    pause: () => P.playing && toggle(),
    previoustrack: prev,
    nexttrack: () => next(),
    seekbackward: () => seekBy(-10000),
    seekforward: () => seekBy(10000),
    seekto: (d) => d.seekTime != null && seek(d.seekTime * 1000),
  };
  for (const [k, fn] of Object.entries(h)) {
    try {
      navigator.mediaSession.setActionHandler(k, fn);
    } catch {}
  }
}
