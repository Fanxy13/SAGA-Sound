// Small HTML building blocks shared by all views.
import { S } from './store.js';
import { icon } from './icons.js';
import { genreOf } from './algo.js';
import { art, esc, fmtTime, gradientFor, initials } from './util.js';

// Every rendered list registers its track ids + play context under a short key,
// so a click anywhere inside it knows what to queue.
const lists = new Map();
let seq = 0;

export function reg(ids, ctx) {
  const k = 'L' + ++seq;
  lists.set(k, { ids, ctx });
  if (lists.size > 600) lists.delete(lists.keys().next().value);
  return k;
}
export const getList = (k) => lists.get(k);

// Images that already loaded once render without the fade-in on later re-renders.
const loaded = new Set();
export const markLoaded = (src) => src && loaded.add(src);

let logoSeq = 0;
export function logo(size = 28) {
  const id = 'lg' + ++logoSeq;
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a3c"/><stop offset=".5" stop-color="#ff4f5e"/><stop offset="1" stop-color="#a85cff"/></linearGradient></defs><rect width="32" height="32" rx="9.5" fill="url(#${id})"/><path d="M5 16c1.7-5.6 3.8-5.6 5.5 0s3.8 5.6 5.5 0 3.8-5.6 5.5 0 3.8 5.6 5.5 0" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round"/></svg>`;
}

export const wordmark = () => `<span class="wm"><b>Saga</b>Sound</span>`;

export const trackArt = (t) => t?.art || S.users[t?.uid]?.avatar || '';

export function img(src, size = 't300x300', cls = '') {
  if (!src) return '';
  const url = art(src, size);
  const c = [cls, loaded.has(url) ? 'ld' : ''].filter(Boolean).join(' ');
  return `<img${c ? ` class="${c}"` : ''} src="${esc(url)}" alt="" loading="lazy" decoding="async">`;
}

export const eq = () => '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

export function trackCard(id, key, i) {
  const t = S.tracks[id];
  if (!t?.ok) return '';
  const u = S.users[t.uid];
  return `<article class="card tc" data-act="play" data-track="${id}" data-list="${key}" data-i="${i}">
    <div class="cv" style="background:${gradientFor(id)}">${img(trackArt(t))}${eq()}<button class="cv-play" data-act="play" aria-label="Abspielen">${icon('play')}</button></div>
    <div class="card-t" title="${esc(t.title)}">${esc(t.title)}</div>
    <a class="card-s" href="#/artist/${t.uid}">${esc(u?.name || '')}</a>
  </article>`;
}

export function trackRow(id, key, i, { when = '' } = {}) {
  const t = S.tracks[id];
  if (!t?.ok) {
    return `<div class="row ghost" data-track="${id}" data-list="${key}" data-i="${i}"><span class="r-n">${i + 1}</span><div class="r-cv sk"></div><div class="r-main"><i class="sk sk-t"></i><i class="sk sk-s"></i></div></div>`;
  }
  const u = S.users[t.uid];
  const liked = S.isLiked(id);
  const g = when || genreOf(t);
  return `<div class="row${t.policy === 'BLOCK' || t.bad ? ' off' : ''}" data-act="play" data-track="${id}" data-list="${key}" data-i="${i}">
    <span class="r-n"><b>${i + 1}</b>${eq()}${icon('play', 'r-pi')}</span>
    <div class="r-cv" style="background:${gradientFor(id)}">${img(trackArt(t), 'large')}</div>
    <div class="r-main"><div class="r-t">${esc(t.title)}${t.policy === 'SNIP' ? '<span class="tag">30s</span>' : ''}</div><a class="r-s" href="#/artist/${t.uid}">${esc(u?.name || '')}</a></div>
    <span class="r-g">${esc(g)}</span>
    <button class="ib r-like${liked ? ' on' : ''}" data-act="like" aria-label="Gefällt mir">${icon('heart')}</button>
    <span class="r-d">${fmtTime(t.dur)}</span>
    <button class="ib r-more" data-act="menu" aria-label="Mehr">${icon('more')}</button>
  </div>`;
}

export function mosaic(ids) {
  const arts = [];
  for (const id of ids) {
    const a = trackArt(S.tracks[id]);
    if (a && !arts.includes(a)) arts.push(a);
    if (arts.length === 4) break;
  }
  if (arts.length === 4) return `<div class="mosaic">${arts.map((a) => img(a)).join('')}</div>`;
  return arts.length ? img(arts[0], 't500x500') : '';
}

export function mixCover(mix, big = false) {
  const arts = [];
  for (const id of mix.tracks) {
    const a = trackArt(S.tracks[id]);
    if (a && !arts.includes(a)) arts.push(a);
    if (arts.length === 3) break;
  }
  const label = mix.kind === 'artist' ? S.users[mix.uid]?.name || mix.title : mix.title;
  return `<div class="mixcv${big ? ' big' : ''}" style="background:${gradientFor(mix.id)}">
    <div class="mix-arts">${arts.map((a, i) => img(a, 't300x300', 'm' + i)).join('')}</div>
    <div class="mix-l"><span>${esc(label)}</span><small>${mix.kind === 'saga' ? '' : 'Mix'}</small></div>
  </div>`;
}

export function likesCover() {
  return `<div class="likescv">${icon('heart')}</div>`;
}

export function playlistCover(p) {
  return (p.art ? img(p.art, 't500x500') : mosaic(p.tracks)) || `<div class="fill" style="background:${gradientFor(p.id)}">${icon('music')}</div>`;
}

export function collCard({ href, title, sub = '', cover, key, round = false }) {
  return `<article class="card coll${round ? ' round' : ''}" data-href="${href}">
    <div class="cv">${cover}${key ? `<button class="cv-play" data-act="play-list" data-list="${key}" aria-label="Abspielen">${icon('play')}</button>` : ''}</div>
    <a class="card-t" href="${href}">${esc(title)}</a>
    ${sub ? `<div class="card-s">${esc(sub)}</div>` : ''}
  </article>`;
}

export function mixCard(mix) {
  const key = reg(mix.tracks, { type: 'mix', id: mix.id, title: mix.kind === 'artist' ? `${mix.title} Mix` : mix.kind === 'saga' ? mix.title : `${mix.title} Mix` });
  const names = [...new Set(mix.tracks.slice(0, 12).map((id) => S.users[S.tracks[id]?.uid]?.name).filter(Boolean))].slice(0, 3);
  return collCard({ href: `#/mix/${mix.id}`, title: mix.kind === 'saga' ? mix.title : `${mix.title} Mix`, sub: names.join(', '), cover: mixCover(mix), key });
}

export function avatar(u, size = 't300x300') {
  const ini = `<span class="ini" style="background:${gradientFor('u' + (u?.id || 0))}">${esc(initials(u?.name))}</span>`;
  return u?.avatar ? ini + img(u.avatar, size) : ini;
}

export function artistCard(uid) {
  const u = S.users[uid];
  if (!u) return '';
  return `<article class="card artist" data-href="#/artist/${uid}">
    <div class="cv round">${avatar(u)}<button class="cv-play" data-act="artist-play" data-uid="${uid}" aria-label="Abspielen">${icon('play')}</button></div>
    <a class="card-t" href="#/artist/${uid}">${esc(u.name)}</a>
  </article>`;
}

export function shelf(title, items, { href = '', key = '' } = {}) {
  const list = items.filter(Boolean);
  if (!list.length) return '';
  return `<section class="shelf">
    <header class="sh-h"><h2>${title}</h2>${href ? `<a class="sh-more" href="${href}">Alle</a>` : ''}<div class="sh-nav"><button class="ib sm" data-act="scroll-l" aria-label="Zurück">${icon('left')}</button><button class="ib sm" data-act="scroll-r" aria-label="Weiter">${icon('right')}</button></div></header>
    <div class="sh-row" data-sk="${esc(key || title)}">${list.join('')}</div>
  </section>`;
}

export function skeletonShelf(n = 6) {
  const card = '<div class="card sk-card"><div class="cv sk"></div><i class="sk sk-t"></i><i class="sk sk-s"></i></div>';
  return `<section class="shelf"><header class="sh-h"><i class="sk sk-h"></i></header><div class="sh-row">${card.repeat(n)}</div></section>`;
}

const CHUNK = 120;

// Long track lists render in chunks; views.mountLists() appends the rest while scrolling.
export function trackList(ids, key, opts = {}) {
  const first = ids.slice(0, CHUNK).map((id, i) => trackRow(id, key, i, opts.when ? { when: opts.when(id, i) } : {}));
  return `<div class="tl" data-list="${key}" data-shown="${Math.min(CHUNK, ids.length)}">${first.join('')}${ids.length > CHUNK ? '<div class="tl-more"></div>' : ''}</div>`;
}

export function appendRows(tl, whenFn) {
  const { ids } = getList(tl.dataset.list) || {};
  if (!ids) return;
  const shown = Number(tl.dataset.shown);
  const next = ids.slice(shown, shown + CHUNK);
  const more = tl.querySelector('.tl-more');
  more?.insertAdjacentHTML('beforebegin', next.map((id, j) => trackRow(id, tl.dataset.list, shown + j, whenFn ? { when: whenFn(id, shown + j) } : {})).join(''));
  tl.dataset.shown = String(shown + next.length);
  if (shown + next.length >= ids.length) more?.remove();
}

export function empty(name = 'disc') {
  return `<div class="empty">${icon(name)}</div>`;
}
