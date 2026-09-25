// Playback controller. Audio runs through the official SoundCloud widget (hidden iframe);
// SagaSound owns the queue, shuffle, repeat, endless radio and listening history.
import { S } from './store.js';
import { Widget, apiUrl } from './sc.js';
import { radio } from './algo.js';
import { art, clamp, debounce, shuffled } from './util.js';

const w = new Widget('player', 'sc-player');

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

let loadedId = null;
let wantPlay = false;
let listened = 0;
let lastPos = 0;
let started = false;
let errors = 0;
let pendingSeek = 0;
let guard = null;

// ---------- widget events ----------

w.on('PLAY', () => {
  P.playing = true;
  P.loading = false;
  P.blocked = false;
  errors = 0;
  clearTimeout(guard);
  if (pendingSeek) {
    w.call('seekTo', pendingSeek);
    pendingSeek = 0;
  }
  fire('state');
  media();
});

w.on('PAUSE', () => {
  if (P.loading) return;
  P.playing = false;
  fire('state');
  media();
});

w.on('PLAY_PROGRESS', (e) => {
  if (P.loading || !loadedId) return;
  const pos = e.currentPosition || 0;
  const d = pos - lastPos;
  if (d > 0 && d < 3000) listened += d;
  lastPos = pos;
  P.pos = pos;
  const lp = e.loadProgress ?? e.loadedProgress;
  if (lp != null) P.buf = lp;
  if (!P.dur && e.relativePosition > 0.01) P.dur = pos / e.relativePosition;
  fire('progress');
});

w.on('LOAD_PROGRESS', (e) => {
  const lp = e.loadProgress ?? e.loadedProgress;
  if (lp != null) {
    P.buf = lp;
    fire('progress');
  }
});

w.on('SEEK', (e) => {
  if (P.loading) return;
  P.pos = e.currentPosition ?? P.pos;
  lastPos = P.pos;
  fire('progress');
});

w.on('FINISH', () => {
  if (P.loading || !loadedId) return;
  commit(true);
  if (P.repeat === 'one') restart();
  else next(false);
});

w.on('ERROR', () => {
  if (!P.loading) failed();
});

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
  try {
    await w.load(apiUrl('track', id), { auto_play: true });
  } catch (e) {
    if (e.message === 'superseded' || currentId() !== id) return;
    return failed();
  }
  if (currentId() !== id) return;
  loadedId = id;
  started = true;
  P.loading = false;
  w.call('setVolume', P.muted ? 0 : P.vol);
  w.get('getCurrentSound')
    .then((s) => {
      if (s?.id !== id) return;
      S.ingest([s]);
      if (S.tracks[id]?.dur) P.dur = S.tracks[id].dur;
      fire('track');
      media();
    })
    .catch(() => {});
  w.get('getDuration')
    .then((d) => {
      if (currentId() === id && d > 0) {
        P.dur = d;
        fire('progress');
      }
    })
    .catch(() => {});
  // Some browsers (mostly iOS) refuse to start audio in an iframe without a tap inside it.
  guard = setTimeout(async () => {
    if (currentId() !== id || P.playing || !wantPlay) return;
    const paused = await w.get('isPaused').catch(() => true);
    if (paused && currentId() === id && !P.playing) {
      P.blocked = true;
      fire('state');
    }
  }, 4000);
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
    if (currentId() === id) next(false);
  }, 900);
}

function restart() {
  listened = 0;
  lastPos = 0;
  started = true;
  w.call('seekTo', 0);
  w.call('play');
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
  start(i);
}

export function shufflePlay(ids, ctx) {
  if (!P.shuffle) toggleShuffle();
  playList(ids, Math.floor(Math.random() * ids.length), ctx);
}

export function toggle() {
  if (P.index < 0 || !P.queue.length) return;
  if (!loadedId && !P.loading) return start(P.index, P.pos);
  if (P.loading) return;
  if (P.playing) {
    wantPlay = false;
    w.call('pause');
  } else {
    wantPlay = true;
    w.call('play');
  }
}

export function next(user = true) {
  if (user) commit(false, true);
  if (P.index < P.queue.length - 1) return start(P.index + 1);
  if (P.repeat === 'all' && P.queue.length) return start(0);
  if (P.autoplay && P.queue.length) {
    const exclude = new Set([...P.queue.slice(-300), ...S.recentTracks(40)]);
    const more = radio(currentId(), 15, exclude);
    if (more.length) {
      P.queue.push(...more);
      if (P.original) P.original.push(...more);
      return start(P.index + 1);
    }
  }
  if (!user) {
    P.playing = false;
    fire('state');
  }
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
  if (loadedId) w.call('seekTo', ms);
  else pendingSeek = ms;
  fire('progress');
  persist();
}

export const seekBy = (d) => seek(P.pos + d);

export function setVolume(v) {
  P.vol = clamp(Math.round(v), 0, 100);
  P.muted = false;
  w.call('setVolume', P.vol);
  S.setPref('volume', P.vol);
  fire('state');
}

export function toggleMute() {
  P.muted = !P.muted;
  w.call('setVolume', P.muted ? 0 : P.vol);
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
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || '',
      artist: S.users[t.uid]?.name || '',
      album: P.ctx?.title || 'SagaSound',
      artwork: t.art ? [{ src: art(t.art, 't500x500'), sizes: '500x500', type: 'image/jpeg' }] : [],
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
