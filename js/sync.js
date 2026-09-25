// Importing a SoundCloud profile and quietly discovering music around it.
import { S } from './store.js';
import { scout, resolve, apiUrl, parseInput } from './sc.js';
import { topArtists, artistsForYou } from './algo.js';
import { DAY } from './util.js';

export const status = { syncing: false, discovering: false };
const watchers = new Set();
export const onStatus = (fn) => watchers.add(fn);
const set = (k, v) => {
  status[k] = v;
  watchers.forEach((fn) => fn(status));
};

const SOURCE_TTL = 3 * DAY;

export const VIBES = [
  { id: 'lofi', label: 'Lo-Fi', slugs: ['chillhopdotcom', 'collegemusic'] },
  { id: 'house', label: 'House', slugs: ['defected', 'anjunadeep', 'spinninrecords'] },
  { id: 'rap', label: 'Rap', slugs: ['octobersveryown', 'uiceheidd', 'liluzivert'] },
  { id: 'bass', label: 'Bass', slugs: ['ukf', 'monstercat'] },
  { id: 'chill', label: 'Chill', slugs: ['mrsuicidesheep', 'majesticcasual'] },
  { id: 'techno', label: 'Techno', slugs: ['drumcode'] },
];

export async function connect(input) {
  const p = parseInput(input);
  if (!p) throw new Error('invalid');
  const m = p.url.match(/^https:\/\/soundcloud\.com\/([^/]+)/);
  const url = m ? `https://soundcloud.com/${m[1]}` : p.url;
  const r = await resolve(url);
  if (r.kind !== 'user') throw new Error('not-user');
  const slug = m?.[1]?.toLowerCase() || '';
  S.setMe({ id: r.id, name: r.author || r.title || slug, slug, avatar: r.thumb, url: r.authorUrl || url });
  syncMe(true);
}

export function disconnect() {
  S.setMe(null);
  S.synced = 0;
  S.touch('core');
}

export async function syncMe(first = false) {
  if (!S.me || status.syncing) return;
  set('syncing', true);
  const me = S.me.id;
  try {
    try {
      const likes = await scout.collect(apiUrl('user', me) + '/favorites', first);
      const ids = S.ingest(likes, { emit: false });
      S.importLikes(ids);
      S.setSource(`u:${me}:likes`, ids);
    } catch {}
    try {
      const own = await scout.collect(apiUrl('user', me), first);
      S.setSource(`u:${me}:tracks`, S.ingest(own, { emit: false }).filter((id) => S.tracks[id]?.uid === me));
    } catch {}
    try {
      importPlaylists(await scout.collect(apiUrl('user', me) + '/playlists'));
    } catch {}
    S.synced = Date.now();
    S.touch('core');
    S.emit('library');
  } finally {
    set('syncing', false);
  }
  discover();
  hydrate();
}

function importPlaylists(items) {
  for (const pl of items || []) {
    if (pl?.kind !== 'playlist' || !pl.id) continue;
    const ids = S.ingest(pl.tracks || [], { emit: false });
    S.upsertScPlaylist({
      sc: pl.id,
      title: pl.title || 'Playlist',
      uid: pl.user?.id || 0,
      art: pl.artwork_url || '',
      url: pl.permalink_url || '',
      tracks: ids,
    });
  }
}

let discovering = false;

export async function discover() {
  if (discovering) return;
  discovering = true;
  set('discovering', true);
  let budget = 26;
  const round = async (uids, kinds) => {
    for (const uid of uids) {
      for (const kind of kinds) {
        const key = `u:${uid}:${kind}`;
        if (budget <= 0 || S.sourceAge(key) < SOURCE_TTL) continue;
        budget--;
        try {
          const list = await scout.collect(apiUrl('user', uid) + (kind === 'likes' ? '/favorites' : ''));
          S.setSource(key, S.ingest(list, { emit: false }));
        } catch {
          S.setSource(key, [], false);
        }
      }
    }
  };
  try {
    await round(topArtists(8), ['likes', 'tracks']);
    await round(artistsForYou(6), ['tracks']);
  } finally {
    discovering = false;
    set('discovering', false);
  }
}

const inflight = new Set();

// Loads one artist's uploads and likes (for artist pages).
export async function scoutArtist(uid, first = true) {
  const jobs = ['tracks', 'likes'].map(async (kind) => {
    const key = `u:${uid}:${kind}`;
    if (S.sourceAge(key) < SOURCE_TTL || inflight.has(key)) return;
    inflight.add(key);
    try {
      const list = await scout.collect(apiUrl('user', uid) + (kind === 'likes' ? '/favorites' : ''), first);
      S.setSource(key, S.ingest(list, { emit: false }));
    } catch {
      S.setSource(key, [], false);
    } finally {
      inflight.delete(key);
    }
  });
  await Promise.all(jobs);
}

export async function addVibe(v) {
  set('discovering', true);
  try {
    for (const slug of v.slugs) {
      try {
        const r = await resolve(`https://soundcloud.com/${slug}`);
        if (r.kind !== 'user') continue;
        S.addUser({ id: r.id, name: r.author || r.title || slug, slug, avatar: r.thumb, url: r.authorUrl });
        if (!S.seeds.some((s) => s.uid === r.id)) S.seeds.push({ slug, uid: r.id, vibe: v.id });
        S.touch('core');
        S.emit('library');
        const list = await scout.collect(apiUrl('user', r.id), true);
        S.setSource(`u:${r.id}:tracks`, S.ingest(list, { emit: false }));
      } catch {}
    }
  } finally {
    set('discovering', false);
  }
  discover();
}

const hydrating = new Set();

// Playlists arrive with only the first few tracks filled in; fetch the rest one by one.
export async function hydrate(ids = S.stubs(), first = false) {
  const todo = ids.filter((id) => !S.tracks[id]?.ok && !hydrating.has(id)).slice(0, 80);
  todo.forEach((id) => hydrating.add(id));
  for (const id of todo) {
    try {
      if (S.tracks[id]?.ok) continue;
      const s = await scout.one(apiUrl('track', id), first);
      if (s?.id === id) S.ingest([s]);
    } catch {
    } finally {
      hydrating.delete(id);
    }
  }
}

// Paste any SoundCloud link: tracks get liked, playlists saved, artists followed.
export async function addLink(input) {
  const p = parseInput(input);
  if (!p) throw new Error('invalid');
  const r = await resolve(p.url);
  if (r.kind === 'track') {
    const s = await scout.one(apiUrl('track', r.id), true);
    const [id] = S.ingest([s]);
    if (id && !S.isLiked(id)) S.toggleLike(id);
    return { kind: 'track', id };
  }
  if (r.kind === 'playlist') {
    const list = await scout.collect(apiUrl('playlist', r.id), true);
    const ids = S.ingest(list, { emit: false });
    const pid = S.upsertScPlaylist({ sc: r.id, title: r.title || 'Playlist', art: r.thumb, url: p.url, tracks: ids });
    hydrate(ids.filter((id) => !S.tracks[id]?.ok), true);
    return { kind: 'playlist', id: pid };
  }
  S.addUser({ id: r.id, name: r.author || r.title, avatar: r.thumb, url: r.authorUrl || p.url });
  if (!S.isFollowing(r.id)) S.toggleFollow(r.id);
  scoutArtist(r.id);
  return { kind: 'user', id: r.id };
}

// Resolve without saving (search results).
export async function peek(input) {
  const p = parseInput(input);
  if (!p) return null;
  const r = await resolve(p.url);
  if (r.kind === 'user') S.addUser({ id: r.id, name: r.author || r.title, avatar: r.thumb, url: r.authorUrl || p.url });
  return r;
}

export function maybeResync() {
  if (S.me && Date.now() - (S.synced || 0) > 6 * 3600e3) syncMe();
  else discover();
}
