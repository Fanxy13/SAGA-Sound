import { S } from './store.js';
import { P } from './player.js';
import { icon } from './icons.js';
import * as A from './algo.js';
import { status as sync, VIBES, scoutArtist, hydrate, peek } from './sync.js';
import { isLink } from './sc.js';
import {
  reg, getList, logo, wordmark, trackCard, trackList, appendRows, mixCover, mixCard,
  likesCover, playlistCover, collCard, artistCard, avatar, shelf, skeletonShelf, empty, img, trackArt,
} from './ui.js';
import { esc, fmtTotal, fmtCount, timeAgo, gradientFor, greeting, debounce } from './util.js';

const hasAnything = () =>
  !!(S.me || S.likes.length || S.seeds.length || S.history.length || S.playlists.length || S.follows.length);

const whenFns = new Map();

export function mountLists(root) {
  const tls = root.querySelectorAll('.tl .tl-more');
  if (!tls.length) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const tl = e.target.closest('.tl');
        appendRows(tl, whenFns.get(tl.dataset.list));
        if (!tl.querySelector('.tl-more')) io.unobserve(e.target);
      }
    },
    { root: document.getElementById('main'), rootMargin: '800px' },
  );
  tls.forEach((m) => io.observe(m));
}

function listBlock(ids, ctx, whenFn) {
  const key = reg(ids, ctx);
  if (whenFn) whenFns.set(key, whenFn);
  return trackList(ids, key, whenFn ? { when: whenFn } : {});
}

function actions(key, { shuffle = true, extra = '' } = {}) {
  const playing = P.playing && getList(key)?.ctx && sameCtx(getList(key).ctx, P.ctx);
  return `<div class="actions">
    <button class="btn-play${playing ? ' is-on' : ''}" data-act="play-list" data-list="${key}" aria-label="Abspielen">${icon('play', 'i-play')}${icon('pause', 'i-pause')}</button>
    ${shuffle ? `<button class="ib lg" data-act="shuffle-list" data-list="${key}" aria-label="Zufall">${icon('shuffle')}</button>` : ''}
    ${extra}
  </div>`;
}

export const sameCtx = (a, b) => !!(a && b && a.type === b.type && String(a.id) === String(b.id));

// ---------------- home ----------------

function onboarding() {
  return {
    deps: ['library', 'me', '*'],
    html: `<div class="onb">
      <div class="onb-orb"></div><div class="onb-orb b"></div>
      <div class="onb-c">
        ${logo(72)}
        <h1 class="onb-t">${wordmark()}</h1>
        <form class="connect" data-form="connect" autocomplete="off">
          <label class="connect-f"><span>soundcloud.com/</span><input name="u" placeholder="dein-name" spellcheck="false" autocapitalize="off" autocorrect="off" enterkeyhint="go" aria-label="SoundCloud Profil"></label>
          <button class="connect-go" aria-label="Verbinden">${icon('arrow')}</button>
        </form>
        <div class="vibes">${VIBES.map((v) => `<button class="chip" data-act="vibe" data-vibe="${v.id}">${v.label}</button>`).join('')}</div>
      </div>
    </div>`,
  };
}

function tile({ href, title, cover, key }) {
  return `<div class="qt" data-href="${href}" tabindex="0" role="link">
    <div class="qt-cv">${cover}</div><span class="qt-t">${esc(title)}</span>
    ${key ? `<button class="qt-play" data-act="play-list" data-list="${key}" aria-label="Abspielen">${icon('play')}</button>` : ''}
  </div>`;
}

function tileFor(c) {
  if (c.type === 'playlist') {
    const p = S.playlist(c.id);
    return p && { href: `#/playlist/${p.id}`, title: p.title, cover: playlistCover(p), key: reg(p.tracks, c) };
  }
  if (c.type === 'mix') {
    const m = A.getMix(c.id);
    return m && m.tracks.length && { href: `#/mix/${m.id}`, title: c.title, cover: mixCover(m), key: reg(m.tracks, c) };
  }
  if (c.type === 'artist') {
    const u = S.users[c.id];
    const ids = artistPlayIds(Number(c.id));
    return u && { href: `#/artist/${u.id}`, title: u.name, cover: avatar(u, 'large'), key: ids.length ? reg(ids, c) : '' };
  }
  if (c.type === 'genre') {
    const ids = A.genreTracks(c.id);
    return { href: `#/genre/${c.id}`, title: c.title, cover: `<div class="fill" style="background:${gradientFor(c.title)}"></div>`, key: reg(ids, c) };
  }
  if (c.type === 'likes' && S.likes.length) {
    return { href: '#/library/likes', title: 'Likes', cover: likesCover(), key: reg(S.likes.map((l) => l.id), c) };
  }
  return null;
}

export function artistPlayIds(uid) {
  const own = A.artistTracks(uid).sort((a, b) => b.plays - a.plays).map((t) => t.id);
  return own.length ? own : (S.sources[`u:${uid}:tracks`]?.ids || []);
}

function sagaHero(saga) {
  if (saga.tracks.length < 6) return '';
  const key = reg(saga.tracks, { type: 'mix', id: 'saga', title: 'Saga Mix' });
  const arts = [];
  for (const id of saga.tracks) {
    const a = trackArt(S.tracks[id]);
    if (a && !arts.includes(a)) arts.push(a);
    if (arts.length === 5) break;
  }
  const names = [...new Set(saga.tracks.slice(0, 16).map((id) => S.users[S.tracks[id]?.uid]?.name).filter(Boolean))].slice(0, 4);
  const playing = P.playing && sameCtx(P.ctx, { type: 'mix', id: 'saga' });
  return `<section class="saga" data-href="#/mix/saga">
    <div class="saga-bg">${arts.slice(0, 3).map((a) => img(a, 't300x300')).join('')}</div>
    <div class="saga-body">
      <div class="saga-k">${icon('spark')}<span>${new Date().toLocaleDateString('de', { weekday: 'long' })}</span></div>
      <h2 class="saga-t">Saga Mix</h2>
      <p class="saga-s">${esc(names.join(' · '))}</p>
      <div class="actions">
        <button class="btn-play${playing ? ' is-on' : ''}" data-act="play-list" data-list="${key}" aria-label="Abspielen">${icon('play', 'i-play')}${icon('pause', 'i-pause')}</button>
        <button class="ib lg" data-act="shuffle-list" data-list="${key}" aria-label="Zufall">${icon('shuffle')}</button>
      </div>
    </div>
    <div class="saga-stack">${arts.map((a, i) => `<div class="st s${i}">${img(a, 't500x500')}</div>`).join('')}</div>
  </section>`;
}

export function home() {
  if (!hasAnything()) return onboarding();
  const busy = sync.syncing || sync.discovering;
  const saga = A.sagaMix();
  const mx = A.mixes();
  const fy = A.forYou(20);
  const fyKey = reg(fy, { type: 'foryou', id: 'foryou', title: 'Für dich' });

  const tiles = [];
  const addTile = (t) => t && tiles.length < 8 && !tiles.some((x) => x.href === t.href) && tiles.push(t);
  if (S.likes.length) addTile(tileFor({ type: 'likes', id: 'likes', title: 'Likes' }));
  if (saga.tracks.length) addTile({ href: '#/mix/saga', title: 'Saga Mix', cover: mixCover(saga), key: reg(saga.tracks, { type: 'mix', id: 'saga', title: 'Saga Mix' }) });
  S.recent.forEach((c) => addTile(tileFor(c)));
  mx.forEach((m) => addTile({ href: `#/mix/${m.id}`, title: `${m.title} Mix`, cover: mixCover(m), key: reg(m.tracks, { type: 'mix', id: m.id, title: `${m.title} Mix` }) }));
  S.playlists.forEach((p) => addTile(tileFor({ type: 'playlist', id: p.id, title: p.title })));

  const parts = [];
  parts.push(`<header class="home-h"><h1>${greeting()}</h1></header>`);
  if (tiles.length >= 2) parts.push(`<div class="quick">${tiles.map(tile).join('')}</div>`);
  parts.push(sagaHero(saga));
  if (fy.length) parts.push(shelf('Für dich', fy.map((id, i) => trackCard(id, fyKey, i)), { key: 'fy' }));
  else if (busy) parts.push(skeletonShelf());
  if (mx.length) parts.push(shelf('Deine Mixes', mx.map(mixCard), { key: 'mixes' }));
  for (const b of A.because(2)) {
    const u = S.users[b.uid];
    const k = reg(b.tracks, { type: 'artist-likes', id: b.uid, title: u.name });
    parts.push(shelf(`Weil du <a href="#/artist/${u.id}">${esc(u.name)}</a> hörst`, b.tracks.map((id, i) => trackCard(id, k, i)), { key: 'bc' + b.uid }));
  }
  const fr = A.fresh(14);
  if (fr.length >= 4) {
    const k = reg(fr, { type: 'fresh', id: 'fresh', title: 'Neu' });
    parts.push(shelf('Neu für dich', fr.map((id, i) => trackCard(id, k, i)), { key: 'fresh' }));
  }
  const afy = A.artistsForYou(12);
  if (afy.length >= 3) parts.push(shelf('Künstler für dich', afy.map(artistCard), { key: 'afy' }));
  const re = A.rediscover(14);
  if (re.length >= 4) {
    const k = reg(re, { type: 'rediscover', id: 're', title: 'Wiederentdecken' });
    parts.push(shelf('Wiederentdecken', re.map((id, i) => trackCard(id, k, i)), { key: 're' }));
  }
  const recent = S.recentTracks(16).filter((id) => S.tracks[id]?.ok);
  if (recent.length >= 3) {
    const k = reg(recent, { type: 'history', id: 'recent', title: 'Zuletzt gehört' });
    parts.push(shelf('Zuletzt gehört', recent.map((id, i) => trackCard(id, k, i)), { key: 'recent', href: '#/library/history' }));
  }
  if (busy && fy.length < 8) parts.push(skeletonShelf());
  if (fy.length < 10 && !busy) {
    parts.push(`<section class="shelf"><header class="sh-h"><h2>Vibes</h2></header><div class="vibes left">${VIBES.map((v) => `<button class="chip" data-act="vibe" data-vibe="${v.id}">${v.label}</button>`).join('')}</div></section>`);
  }
  return { html: `<div class="page home">${parts.join('')}</div>`, home: true, deps: ['sources', 'library', 'me', '*'] };
}

// ---------------- search ----------------

function genreGrid() {
  const gs = A.genres(18);
  if (!gs.length) return empty('search');
  return `<section class="shelf"><header class="sh-h"><h2>Genres</h2></header><div class="ggrid">${gs
    .map(({ g }) => `<a class="gtile" href="#/genre/${A.slugify(g)}" style="background:${gradientFor(g)}"><span>${esc(g)}</span></a>`)
    .join('')}</div></section>`;
}

export function searchResults(q) {
  if (!q.trim()) return genreGrid();
  const r = A.search(q);
  const parts = ['<div id="peek"></div>'];
  if (r.tracks.length) {
    const ctx = { type: 'search', id: q, title: q };
    const key = reg(r.tracks, ctx);
    parts.push(`<section class="shelf"><header class="sh-h"><h2>Tracks</h2></header>${trackList(r.tracks.slice(0, 30), key)}</section>`);
  }
  if (r.artists.length) parts.push(shelf('Künstler', r.artists.map(artistCard), { key: 's-art' }));
  if (r.playlists.length) {
    parts.push(shelf('Playlists', r.playlists.map((id) => {
      const p = S.playlist(id);
      return collCard({ href: `#/playlist/${p.id}`, title: p.title, sub: `${p.tracks.length} Tracks`, cover: playlistCover(p), key: reg(p.tracks, { type: 'playlist', id: p.id, title: p.title }) });
    }), { key: 's-pl' }));
  }
  if (parts.length === 1 && !looksResolvable(q)) parts.push(empty('search'));
  return parts.join('');
}

const looksResolvable = (q) => isLink(q) || /^[a-z0-9][a-z0-9_-]{2,40}$/i.test(q.trim());

let peekSeq = 0;
export async function runPeek(q) {
  const el = document.getElementById('peek');
  if (!el || !looksResolvable(q)) return;
  const my = ++peekSeq;
  el.innerHTML = '<div class="peek sk"></div>';
  let r = null;
  try {
    r = await peek(q.trim());
  } catch {}
  if (my !== peekSeq || !document.getElementById('peek')) return;
  if (!r) {
    el.innerHTML = '';
    if (!document.querySelector('#sres .shelf')) el.innerHTML = empty('search');
    return;
  }
  const kindIcon = { track: 'music', playlist: 'queue', user: 'user' }[r.kind];
  const href = r.kind === 'user' ? `#/artist/${r.id}` : '';
  el.innerHTML = `<div class="peek" ${href ? `data-href="${href}"` : ''}>
    <div class="peek-cv${r.kind === 'user' ? ' round' : ''}">${r.thumb ? img(r.thumb, 't300x300') : icon(kindIcon)}</div>
    <div class="peek-m"><div class="peek-t">${esc(r.kind === 'track' ? r.title.replace(new RegExp(`\\s+by\\s+${escapeRe(r.author)}$`), '') : r.title || r.author)}</div><div class="peek-s">${icon(kindIcon)}<span>${esc(r.author)}</span></div></div>
    <button class="btn-play sm" data-act="peek-add" data-url="${esc(r.url)}" aria-label="Hinzufügen">${icon(r.kind === 'user' ? 'follow' : r.kind === 'playlist' ? 'plus' : 'heart')}</button>
  </div>`;
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function search(_, params) {
  const q = params.get('q') || '';
  return {
    html: `<div class="page search">
      <form class="sbar" data-form="search" role="search">${icon('search')}<input id="q" name="q" value="${esc(q)}" placeholder="Suchen oder Link einfügen" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="Suche"><button type="button" class="ib sm" data-act="clear-search" aria-label="Leeren">${icon('x')}</button></form>
      <div id="sres">${searchResults(q)}</div>
    </div>`,
    search: true,
    mount(root) {
      const inp = root.querySelector('#q');
      if (!matchMedia('(hover: none)').matches) {
        inp.focus();
        inp.setSelectionRange(q.length, q.length);
      }
      const update = debounce(() => {
        const v = inp.value;
        history.replaceState(null, '', '#/search' + (v ? '?q=' + encodeURIComponent(v) : ''));
        const res = document.getElementById('sres');
        res.innerHTML = searchResults(v);
        mountLists(res);
        runPeek(v);
      }, 160);
      inp.addEventListener('input', update);
      if (q) runPeek(q);
    },
  };
}

// ---------------- library ----------------

const SORTS = [
  ['recent', 'clock'],
  ['az', 'sort'],
  ['plays', 'history'],
];

export function library(tab = 'likes', params) {
  tab = tab || 'likes';
  const tabs = [
    ['likes', 'Likes'],
    ['playlists', 'Playlists'],
    ['artists', 'Künstler'],
    ['history', 'Verlauf'],
  ];
  if (S.me && S.sources[`u:${S.me.id}:tracks`]?.ids?.length) tabs.push(['uploads', 'Uploads']);
  let body = '';

  if (tab === 'likes') {
    const sort = params.get('sort') || 'recent';
    let ids = S.likes.map((l) => l.id);
    if (sort === 'az') ids = [...ids].sort((a, b) => (S.tracks[a]?.title || '').localeCompare(S.tracks[b]?.title || '', 'de'));
    if (sort === 'plays') {
      const st = S.playStats();
      ids = [...ids].sort((a, b) => (st.get(b)?.n || 0) - (st.get(a)?.n || 0));
    }
    const ctx = { type: 'likes', id: 'likes', title: 'Likes' };
    const key = reg(ids, ctx);
    const next = SORTS[(SORTS.findIndex((s) => s[0] === sort) + 1) % SORTS.length];
    const sortBtn = `<a class="ib lg" href="#/library/likes?sort=${next[0]}" aria-label="Sortieren">${icon(SORTS.find((s) => s[0] === sort)?.[1] || 'clock')}</a>`;
    body = ids.length
      ? `<div class="lib-top">${actions(key, { extra: sortBtn })}<span class="count">${fmtCount(ids.length)}</span></div>${listBlock(ids, ctx)}`
      : empty('heart');
  } else if (tab === 'playlists') {
    const cards = [`<article class="card coll new" data-act="new-playlist"><div class="cv"><div class="fill">${icon('plus')}</div></div><div class="card-t">Neu</div></article>`];
    if (S.likes.length) cards.push(collCard({ href: '#/library/likes', title: 'Likes', sub: `${S.likes.length} Tracks`, cover: likesCover(), key: reg(S.likes.map((l) => l.id), { type: 'likes', id: 'likes', title: 'Likes' }) }));
    S.playlists.forEach((p) => cards.push(collCard({ href: `#/playlist/${p.id}`, title: p.title, sub: `${p.tracks.length} Tracks`, cover: playlistCover(p), key: reg(p.tracks, { type: 'playlist', id: p.id, title: p.title }) })));
    body = `<div class="grid">${cards.join('')}</div>`;
  } else if (tab === 'artists') {
    const ids = [...new Set([...S.follows.map((f) => f.id), ...A.topArtists(60)])].filter((u) => S.users[u]);
    body = ids.length ? `<div class="grid">${ids.map(artistCard).join('')}</div>` : empty('user');
  } else if (tab === 'history') {
    const hist = S.history.slice(0, 400);
    const ids = hist.map((h) => h.id);
    const ctx = { type: 'history', id: 'history', title: 'Verlauf' };
    body = ids.length ? listBlock(ids, ctx, (_, i) => timeAgo(hist[i]?.at || Date.now())) : empty('history');
  } else if (tab === 'uploads') {
    const ids = S.sources[`u:${S.me?.id}:tracks`]?.ids || [];
    const ctx = { type: 'uploads', id: 'uploads', title: 'Uploads' };
    const key = reg(ids, ctx);
    body = `<div class="lib-top">${actions(key)}</div>${listBlock(ids, ctx)}`;
  }

  return {
    deps: ['library', 'catalog', 'history', 'me', '*'],
    html: `<div class="page lib">
      <header class="page-h"><h1>Bibliothek</h1><button class="ib lg" data-act="add-link" aria-label="Link hinzufügen">${icon('plus')}</button></header>
      <nav class="chips">${tabs.map(([k, l]) => `<a class="chip${k === tab ? ' on' : ''}" href="#/library/${k}">${l}</a>`).join('')}</nav>
      ${body}
    </div>`,
  };
}

// ---------------- artist ----------------

export function artist(uidStr) {
  const uid = Number(uidStr);
  const u = S.users[uid];
  if (!u) return { html: `<div class="page">${empty('user')}</div>` };
  const loading = S.sourceAge(`u:${uid}:tracks`) === Infinity;
  const tracks = A.artistTracks(uid);
  const top = [...tracks].sort((a, b) => b.plays - a.plays).map((t) => t.id);
  const newest = [...tracks].filter((t) => t.date).sort((a, b) => b.date - a.date).slice(0, 14).map((t) => t.id);
  const theirLikes = (S.sources[`u:${uid}:likes`]?.ids || []).filter((id) => S.tracks[id]?.ok && S.tracks[id].uid !== uid).slice(0, 24);
  const sim = A.similarArtists(uid, 14);
  const following = S.isFollowing(uid);
  const ctx = { type: 'artist', id: uid, title: u.name };
  const key = reg(top, ctx);
  const followBtn = `<button class="pill${following ? ' on' : ''}" data-act="follow" data-uid="${uid}">${icon(following ? 'following' : 'follow')}<span>${following ? 'Folge ich' : 'Folgen'}</span></button>`;
  const ext = u.url ? `<a class="ib lg" href="${esc(u.url)}" target="_blank" rel="noopener" aria-label="Auf SoundCloud">${icon('ext')}</a>` : '';
  const parts = [];
  parts.push(`<header class="a-hero">
    <div class="a-bg">${u.avatar ? img(u.avatar, 't500x500') : `<div class="fill" style="background:${gradientFor('u' + uid)}"></div>`}</div>
    <div class="a-av">${avatar(u, 't500x500')}</div>
    <div class="a-meta"><h1 class="fit">${esc(u.name)}${u.verified ? `<span class="verified">${icon('check')}</span>` : ''}</h1>
      <div class="a-s">${[u.followers != null ? `${fmtCount(u.followers)} Follower` : '', tracks.length ? `${tracks.length} Tracks` : ''].filter(Boolean).join(' · ')}</div></div>
  </header>`);
  parts.push(top.length ? actions(key, { extra: followBtn + ext }) : `<div class="actions">${followBtn}${ext}</div>`);
  if (top.length) parts.push(`<section class="shelf"><header class="sh-h"><h2>Beliebt</h2></header>${trackList(top.slice(0, 10), key)}</section>`);
  else if (loading) parts.push(skeletonShelf());
  if (newest.length >= 3) {
    const k = reg(newest, { ...ctx, type: 'artist-new' });
    parts.push(shelf('Neu', newest.map((id, i) => trackCard(id, k, i)), { key: 'a-new' }));
  }
  if (theirLikes.length) {
    const k = reg(theirLikes, { type: 'artist-likes', id: uid, title: u.name });
    parts.push(shelf(`Likes von ${esc(u.name)}`, theirLikes.map((id, i) => trackCard(id, k, i)), { key: 'a-likes' }));
  }
  if (sim.length) parts.push(shelf('Ähnlich', sim.map(artistCard), { key: 'a-sim' }));
  return {
    html: `<div class="page artist">${parts.join('')}</div>`,
    deps: ['sources', 'catalog', 'library', '*'],
    mount() {
      scoutArtist(uid);
    },
  };
}

// ---------------- collections ----------------

function collPage({ kind, title, sub, cover, ids, ctx, extra = '', coverClass = '' }) {
  const key = reg(ids, ctx);
  return `<div class="page coll-page">
    <header class="c-hero">
      <div class="c-cv ${coverClass}">${cover}</div>
      <div class="c-meta"><div class="c-k">${kind}</div><h1 class="fit">${esc(title)}</h1><div class="c-s">${sub}</div></div>
    </header>
    ${ids.length ? actions(key, { extra }) : `<div class="actions">${extra}</div>`}
    ${ids.length ? trackList(ids, key) : empty('music')}
  </div>`;
}

const totalOf = (ids) => ids.reduce((s, id) => s + (S.tracks[id]?.dur || 0), 0);
const metaOf = (ids) => `${ids.length} Tracks${totalOf(ids) ? ' · ' + fmtTotal(totalOf(ids)) : ''}`;

export function playlist(id) {
  const p = S.playlist(id);
  if (!p) return { html: `<div class="page">${empty('queue')}</div>` };
  const ctx = { type: 'playlist', id: p.id, title: p.title };
  const owner = p.uid && S.users[p.uid];
  const extra = `<button class="ib lg" data-act="pl-more" data-pid="${p.id}" aria-label="Mehr">${icon('more')}</button>`;
  return {
    html: collPage({
      kind: p.kind === 'sc' ? 'SoundCloud' : 'Playlist',
      title: p.title,
      sub: `${owner ? `<a href="#/artist/${owner.id}">${esc(owner.name)}</a> · ` : ''}${metaOf(p.tracks)}`,
      cover: playlistCover(p),
      ids: p.tracks,
      ctx,
      extra,
    }),
    deps: ['library', 'catalog', '*'],
    mount() {
      const stubs = p.tracks.filter((t) => !S.tracks[t]?.ok);
      if (stubs.length) hydrate(stubs, true);
    },
  };
}

export function mix(id) {
  const m = A.getMix(id);
  if (!m) return { html: `<div class="page">${empty('disc')}</div>` };
  if (m.kind === 'likes') {
    location.replace('#/library/likes');
    return { html: '' };
  }
  const title = m.kind === 'saga' ? m.title : `${m.title} Mix`;
  return {
    html: collPage({ kind: 'Mix', title, sub: metaOf(m.tracks), cover: mixCover(m, true), ids: m.tracks, ctx: { type: 'mix', id: m.id, title } }),
  };
}

export function genre(slug) {
  const name = A.genreName(slug);
  const ids = A.genreTracks(slug);
  return {
    html: collPage({
      kind: 'Genre',
      title: name,
      sub: metaOf(ids),
      cover: `<div class="fill gcv" style="background:${gradientFor(name)}"><span>${esc(name)}</span></div>`,
      ids,
      ctx: { type: 'genre', id: slug, title: name },
    }),
  };
}

