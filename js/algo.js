// Local recommender. Everything runs in the browser on the listening data SagaSound keeps:
// likes, plays, skips, follows and the "sources" the scout collected (uploads and likes of
// the artists you care about). Scores are recomputed whenever the store changes.
import { S } from './store.js';
import { DAY, dayKey, hash, rng, shuffled } from './util.js';

const GENRES = [
  [/deutsch ?rap|german ?rap/, 'Deutschrap'],
  [/hip ?-?hop|\brap\b|drill|boom ?bap|grime/, 'Hip-Hop'],
  [/r ?& ?b|\brnb\b|\bsoul\b/, 'R&B'],
  [/lo-?fi|chillhop|jazzhop|beats to/, 'Lo-Fi'],
  [/drum ?(&|and|n'?) ?bass|\bdnb\b|d ?& ?b|jungle|liquid funk/, 'Drum & Bass'],
  [/dubstep|riddim|future bass|bass ?music|\bbass\b/, 'Bass'],
  [/house|garage|\bukg\b|disco/, 'House'],
  [/techno|minimal|industrial/, 'Techno'],
  [/trance|psy/, 'Trance'],
  [/phonk/, 'Phonk'],
  [/\btrap\b/, 'Trap'],
  [/latin|reggaeton|dembow|salsa|bachata/, 'Latin'],
  [/afro|amapiano|dancehall|reggae/, 'Afro'],
  [/ambient|downtempo|chill|lounge/, 'Chill'],
  [/electro|edm|dance|synthwave|electronica/, 'Electronic'],
  [/rock|metal|punk|grunge/, 'Rock'],
  [/indie|alternative|\balt\b/, 'Indie'],
  [/\bpop\b|k-?pop/, 'Pop'],
  [/jazz/, 'Jazz'],
  [/classical|piano|orchestral|soundtrack|score/, 'Klassik'],
  [/folk|country|singer|acoustic/, 'Acoustic'],
];

const genreMemo = new Map();

export function normGenre(raw) {
  const g = String(raw || '').trim().toLowerCase();
  if (!g) return '';
  if (genreMemo.has(g)) return genreMemo.get(g);
  let out = '';
  for (const [re, name] of GENRES) {
    if (re.test(g)) {
      out = name;
      break;
    }
  }
  if (!out) out = g.length > 22 ? '' : g.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  genreMemo.set(g, out);
  return out;
}

export function genreOf(t) {
  if (!t) return '';
  return normGenre(t.genre) || (t.tags?.length ? normGenre(t.tags.slice(0, 3).join(' ')) : '');
}

const bump = (m, k, w) => m.set(k, (m.get(k) || 0) + w);

function normalize(m) {
  let max = 0;
  for (const v of m.values()) max = Math.max(max, v);
  if (max > 0) for (const [k, v] of m) m.set(k, v / max);
}

function wmedian(pairs, dflt) {
  if (!pairs.length) return dflt;
  pairs.sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let acc = 0;
  for (const [v, w] of pairs) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return pairs[pairs.length - 1][0];
}

let M = null;

export function model() {
  if (M && M.v === S.v) return M;
  const now = Date.now();
  const T = S.tracks;
  const me = S.me?.id;
  const stats = S.playStats();

  const trackAff = new Map();
  S.likes.forEach((l, i) => {
    const age = (now - l.at) / DAY;
    bump(trackAff, l.id, 2.5 * Math.max(0.4, Math.exp(-age / 180)) + (i < 25 ? 0.6 : 0));
  });
  for (const [id, p] of stats) {
    const rec = Math.exp(-(now - p.last) / (45 * DAY));
    const w = Math.log1p(p.done) * 1.4 + Math.log1p(Math.max(0, p.n - p.done - p.skip)) * 0.3 - p.skip * 0.8;
    bump(trackAff, id, w * (0.3 + 0.7 * rec));
  }

  const artistAff = new Map();
  for (const [id, w] of trackAff) {
    const t = T[id];
    if (t?.uid && t.uid !== me) bump(artistAff, t.uid, w);
  }
  for (const [u, w] of artistAff) artistAff.set(u, Math.sign(w) * Math.sqrt(Math.abs(w)));
  S.follows.forEach((f) => bump(artistAff, f.id, 2.5));
  S.seeds.forEach((s) => s.uid && bump(artistAff, s.uid, 2));

  const genreAff = new Map();
  const tagAff = new Map();
  const durs = [];
  const pops = [];
  for (const [id, w] of trackAff) {
    const t = T[id];
    if (w <= 0 || !t?.ok) continue;
    const g = genreOf(t);
    if (g) bump(genreAff, g, w);
    t.tags?.forEach((tag) => bump(tagAff, tag, w));
    if (t.dur) durs.push([Math.log(t.dur), w]);
    pops.push([Math.log1p(t.plays || 0), w]);
  }
  // Seeds without listening history still say something about taste.
  if (!genreAff.size) {
    for (const s of S.seeds) {
      for (const id of S.sources[`u:${s.uid}:tracks`]?.ids || []) {
        const g = genreOf(T[id]);
        if (g) bump(genreAff, g, 1);
      }
    }
  }
  normalize(genreAff);
  normalize(tagAff);
  const pref = {
    dur: wmedian(durs, Math.log(240000)),
    pop: wmedian(pops, Math.log1p(40000)),
  };

  const cand = new Map();
  const addC = (id, w, via) => {
    let c = cand.get(id);
    if (!c) cand.set(id, (c = { ev: 0, via: new Set() }));
    c.ev += w;
    if (via) c.via.add(via);
  };
  for (const [key, src] of Object.entries(S.sources)) {
    const [kind, u, what] = key.split(':');
    const uid = Number(u);
    if (kind !== 'u' || uid === me || !src.ids?.length) continue;
    const a = Math.max(0, artistAff.get(uid) || 0);
    if (!a) continue;
    const w = a * (what === 'likes' ? 1 : 0.7);
    src.ids.forEach((id, i) => addC(id, w / (1 + i / 30), uid));
  }
  S.playlists.forEach((p) => p.tracks.forEach((id) => addC(id, 0.4, 'pl')));

  let maxEv = 0;
  for (const c of cand.values()) maxEv = Math.max(maxEv, c.ev);
  let maxA = 0;
  for (const v of artistAff.values()) maxA = Math.max(maxA, v);

  M = {
    v: S.v,
    now,
    day: dayKey(),
    stats,
    trackAff,
    artistAff,
    genreAff,
    tagAff,
    pref,
    cand,
    maxEv: maxEv || 1,
    maxA: maxA || 1,
    memo: new Map(),
  };
  return M;
}

export function score(id, m = model()) {
  const t = S.tracks[id];
  if (!t?.ok || t.policy === 'BLOCK' || t.bad) return -Infinity;
  const c = m.cand.get(id);
  const ev = c ? Math.pow(Math.min(1, c.ev / m.maxEv), 0.6) : 0;
  const ar = Math.max(0, m.artistAff.get(t.uid) || 0) / m.maxA;
  const g = m.genreAff.get(genreOf(t)) || 0;
  let tg = 0;
  for (const x of t.tags || []) tg = Math.max(tg, m.tagAff.get(x) || 0);
  const pop = 1 - Math.min(1, Math.abs(Math.log1p(t.plays || 0) - m.pref.pop) / 5);
  const fresh = t.date ? Math.exp(-(m.now - t.date) / (150 * DAY)) : 0;
  const dur = t.dur ? 1 - Math.min(1, Math.abs(Math.log(t.dur) - m.pref.dur) / 1.6) : 0.5;
  const jitter = (hash(id + m.day) % 1000) / 1000;
  let s = 0.36 * ev + 0.22 * ar + 0.16 * g + 0.06 * tg + 0.06 * pop + 0.05 * fresh + 0.04 * dur + 0.05 * jitter;
  const st = m.stats.get(id);
  if (st) {
    s -= 0.22 * Math.exp(-(m.now - st.last) / (3 * DAY));
    s -= 0.08 * Math.min(3, st.skip);
  }
  if (t.policy === 'SNIP') s -= 0.12;
  return s;
}

// Greedy pick with diversity: repeated artists and genres lose weight.
export function pick(ids, n, { perArtist = 2, exclude = null, boost = null } = {}, m = model()) {
  const pool = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id) || exclude?.has(id)) continue;
    seen.add(id);
    let s = score(id, m);
    if (!Number.isFinite(s)) continue;
    if (boost) s += boost(id);
    const t = S.tracks[id];
    pool.push({ id, s, u: t.uid, g: genreOf(t) });
  }
  pool.sort((a, b) => b.s - a.s);
  const cand = pool.slice(0, Math.max(n * 5, 60));
  const out = [];
  const perA = new Map();
  const perG = new Map();
  while (out.length < n && cand.length) {
    let bi = -1;
    let bv = -Infinity;
    for (let i = 0; i < cand.length; i++) {
      const x = cand[i];
      const k = perA.get(x.u) || 0;
      if (k >= perArtist) continue;
      const v = x.s * Math.pow(0.72, k) * Math.pow(0.97, perG.get(x.g) || 0);
      if (v > bv) {
        bv = v;
        bi = i;
      }
    }
    if (bi < 0) break;
    const [x] = cand.splice(bi, 1);
    out.push(x.id);
    perA.set(x.u, (perA.get(x.u) || 0) + 1);
    perG.set(x.g, (perG.get(x.g) || 0) + 1);
  }
  return out;
}

function memo(key, fn) {
  const m = model();
  if (!m.memo.has(key)) m.memo.set(key, fn(m));
  return m.memo.get(key);
}

const likedSet = () => new Set(S.likes.map((l) => l.id));

function interleave(a, b, ra = 3, rb = 2) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    for (let k = 0; k < ra && i < a.length; k++) out.push(a[i++]);
    for (let k = 0; k < rb && j < b.length; k++) out.push(b[j++]);
  }
  return [...new Set(out)];
}

export function topArtists(n = 10) {
  return memo('top' + n, (m) => {
    const me = S.me?.id;
    return [...m.artistAff.entries()]
      .filter(([u, w]) => w > 0 && u !== me && S.users[u])
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([u]) => u);
  });
}

export function forYou(n = 24) {
  return memo('fy' + n, (m) => {
    const liked = likedSet();
    return pick([...m.cand.keys()].filter((id) => !liked.has(id)), n, { perArtist: 2 }, m);
  });
}

export function fresh(n = 16) {
  return memo('fresh' + n, (m) => {
    const liked = likedSet();
    const cutoff = m.now - 60 * DAY;
    const ids = [...m.cand.keys()].filter((id) => !liked.has(id) && (S.tracks[id]?.date || 0) > cutoff);
    return pick(ids, n, { perArtist: 1 }, m);
  });
}

export function because(k = 2, n = 14) {
  return memo('bc' + k, (m) => {
    const liked = likedSet();
    const pool = topArtists(6).filter((u) => S.sources[`u:${u}:likes`]?.ids?.length);
    const chosen = shuffled(pool, rng('bc' + m.day)).slice(0, k);
    const out = [];
    for (const uid of chosen) {
      const ids = S.sources[`u:${uid}:likes`].ids.filter((id) => !liked.has(id) && S.tracks[id]?.uid !== uid);
      const tracks = pick(ids, n, { perArtist: 2 }, m);
      if (tracks.length >= 4) out.push({ uid, tracks });
    }
    return out;
  });
}

export function artistsForYou(n = 12) {
  return memo('afy' + n, (m) => {
    const me = S.me?.id;
    const known = new Set(topArtists(12));
    S.follows.forEach((f) => known.add(f.id));
    const agg = new Map();
    for (const [id, c] of m.cand) {
      const t = S.tracks[id];
      if (!t?.ok || !t.uid || t.uid === me || known.has(t.uid)) continue;
      bump(agg, t.uid, c.ev * (1 + (m.genreAff.get(genreOf(t)) || 0)));
    }
    return [...agg.entries()]
      .filter(([u]) => S.users[u])
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([u]) => u);
  });
}

export function rediscover(n = 14) {
  return memo('re' + n, (m) => {
    const cutoff = m.now - 21 * DAY;
    const r = rng('re' + m.day);
    const ids = S.likes
      .filter((l) => S.tracks[l.id]?.ok && !((m.stats.get(l.id)?.last || 0) > cutoff))
      .map((l) => l.id);
    return ids
      .map((id, i) => ({ id, s: (i / Math.max(1, ids.length)) * 0.6 + (m.stats.get(id)?.done ? 0.3 : 0) + r() * 0.6 }))
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.id);
  });
}

export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function mixes() {
  return memo('mixes', (m) => {
    const liked = S.likes.map((l) => l.id).filter((id) => S.tracks[id]?.ok);
    const likedS = new Set(liked);
    const byG = new Map();
    const put = (id, key) => {
      const g = genreOf(S.tracks[id]);
      if (!g) return;
      let b = byG.get(g);
      if (!b) byG.set(g, (b = { liked: [], cand: [] }));
      b[key].push(id);
    };
    liked.forEach((id) => put(id, 'liked'));
    for (const id of m.cand.keys()) if (S.tracks[id]?.ok && !likedS.has(id)) put(id, 'cand');
    const genres = [...byG.entries()]
      .map(([g, b]) => ({ g, b, w: (m.genreAff.get(g) || 0) + Math.min(b.liked.length, 40) * 0.01 + Math.min(b.cand.length, 60) * 0.002 }))
      .filter((x) => x.b.liked.length + x.b.cand.length >= 8)
      .sort((a, b) => b.w - a.w)
      .slice(0, 6);
    const out = genres.map(({ g, b }) => ({
      id: 'g-' + slugify(g),
      title: g,
      kind: 'genre',
      tracks: interleave(pick(b.cand, 26, { perArtist: 2 }, m), pick(b.liked, 16, { perArtist: 3 }, m)),
    }));
    for (const uid of topArtists(2)) {
      const own = S.sources[`u:${uid}:tracks`]?.ids || [];
      const theirLikes = S.sources[`u:${uid}:likes`]?.ids || [];
      const byThem = liked.filter((id) => S.tracks[id]?.uid === uid);
      const tracks = interleave(pick([...own, ...byThem], 14, { perArtist: 14 }, m), pick(theirLikes, 20, { perArtist: 2 }, m), 2, 3);
      if (tracks.length >= 8) out.push({ id: 'a-' + uid, title: S.users[uid]?.name || 'Mix', kind: 'artist', uid, tracks });
    }
    return out;
  });
}

export function sagaMix() {
  return memo('saga', (m) => {
    const disc = forYou(30);
    const known = pick(S.likes.map((l) => l.id), 14, { perArtist: 2 }, m);
    const tracks = interleave(disc, known, 2, 1);
    return { id: 'saga', title: 'Saga Mix', kind: 'saga', tracks };
  });
}

export function likesMix() {
  return { id: 'likes', title: 'Likes', kind: 'likes', tracks: S.likes.map((l) => l.id) };
}

export function getMix(id) {
  if (id === 'saga') return sagaMix();
  if (id === 'likes') return likesMix();
  return mixes().find((x) => x.id === id) || null;
}

// Endless playback after the queue runs out, seeded by the last track.
export function radio(seedId, n = 12, exclude = new Set()) {
  const m = model();
  const t = S.tracks[seedId];
  if (!t) return forYou(n).filter((id) => !exclude.has(id));
  const g = genreOf(t);
  const pool = new Set();
  (S.sources[`u:${t.uid}:likes`]?.ids || []).forEach((id) => pool.add(id));
  (S.sources[`u:${t.uid}:tracks`]?.ids || []).forEach((id) => pool.add(id));
  for (const [id, c] of m.cand) if (c.via.has(t.uid) || genreOf(S.tracks[id]) === g) pool.add(id);
  S.likes.forEach((l) => genreOf(S.tracks[l.id]) === g && pool.add(l.id));
  pool.delete(seedId);
  const tags = new Set(t.tags || []);
  const boost = (id) => {
    const x = S.tracks[id];
    let b = genreOf(x) === g ? 0.12 : 0;
    if (x.uid === t.uid) b += 0.04;
    if (x.tags?.some((tag) => tags.has(tag))) b += 0.05;
    return b;
  };
  const out = pick([...pool], n, { perArtist: 1, exclude, boost }, m);
  if (out.length < n) {
    const more = forYou(40).filter((id) => !exclude.has(id) && !out.includes(id) && id !== seedId);
    out.push(...more.slice(0, n - out.length));
  }
  return out;
}

export function similarArtists(uid, n = 10) {
  const me = S.me?.id;
  const counts = new Map();
  const add = (u, w) => {
    if (u && u !== uid && u !== me && S.users[u]) bump(counts, u, w);
  };
  (S.sources[`u:${uid}:likes`]?.ids || []).forEach((id) => add(S.tracks[id]?.uid, 1));
  for (const [key, src] of Object.entries(S.sources)) {
    if (!key.endsWith(':likes') || !src.ids.some((id) => S.tracks[id]?.uid === uid)) continue;
    src.ids.forEach((id) => add(S.tracks[id]?.uid, 0.5));
    add(Number(key.split(':')[1]), 1.5);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([u]) => u);
}

export function artistTracks(uid) {
  return Object.values(S.tracks).filter((t) => t.ok && t.uid === uid);
}

export function genres(n = 16) {
  return memo('genres' + n, () => {
    const counts = new Map();
    for (const t of Object.values(S.tracks)) {
      const g = t.ok && genreOf(t);
      if (g) bump(counts, g, 1);
    }
    return [...counts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, n).map(([g, c]) => ({ g, c }));
  });
}

export function genreTracks(slug, n = 80) {
  return memo('gt' + slug, (m) => {
    const ids = Object.values(S.tracks)
      .filter((t) => t.ok && slugify(genreOf(t)) === slug)
      .map((t) => t.id);
    return pick(ids, n, { perArtist: 4 }, m);
  });
}

export function genreName(slug) {
  for (const t of Object.values(S.tracks)) {
    const g = t.ok && genreOf(t);
    if (g && slugify(g) === slug) return g;
  }
  return slug;
}

export function search(q, limit = 50) {
  const s = q.trim().toLowerCase();
  if (!s) return { tracks: [], artists: [], playlists: [] };
  const terms = s.split(/\s+/);
  const tracks = [];
  for (const t of Object.values(S.tracks)) {
    if (!t.ok) continue;
    const u = S.users[t.uid];
    const title = t.title.toLowerCase();
    const name = (u?.name || '').toLowerCase();
    const hay = `${title} ${name} ${t.genre.toLowerCase()} ${(t.tags || []).join(' ')}`;
    if (!terms.every((x) => hay.includes(x))) continue;
    let sc = title.startsWith(s) ? 3 : title.includes(s) ? 2 : 0;
    if (name.startsWith(s)) sc += 2;
    if (S.isLiked(t.id)) sc += 1;
    sc += Math.log10(1 + (t.plays || 0)) * 0.15;
    tracks.push([t.id, sc]);
  }
  tracks.sort((a, b) => b[1] - a[1]);
  const m = model();
  const artists = Object.values(S.users)
    .filter((u) => u.name && u.name.toLowerCase().includes(s))
    .map((u) => [u.id, (u.name.toLowerCase().startsWith(s) ? 2 : 0) + Math.max(0, m.artistAff.get(u.id) || 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id]) => id);
  const playlists = S.playlists.filter((p) => p.title.toLowerCase().includes(s)).map((p) => p.id);
  return { tracks: tracks.slice(0, limit).map((x) => x[0]), artists, playlists };
}
