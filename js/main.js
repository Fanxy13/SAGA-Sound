import { S, loadStore } from './store.js';
import * as PL from './player.js';
import { P, onPlayer, current, currentId } from './player.js';
import * as V from './views.js';
import * as SY from './sync.js';
import { radio } from './algo.js';
import { loadApi } from './sc.js';
import { icon } from './icons.js';
import { logo, wordmark, getList, trackArt, img, avatar, likesCover, playlistCover, markLoaded } from './ui.js';
import { Wave, loadWave } from './wave.js';
import { accentFrom, applyAccent } from './color.js';
import { $, $$, esc, art, fmtTime, debounce, rafOnce, clamp, gradientFor } from './util.js';

loadStore();

// ---------------- shell ----------------

const navItem = (k, href, label, ic) =>
  `<a href="${href}" data-nav="${k}">${icon(ic)}<span>${label}</span></a>`;

const NAV = [
  ['home', '#/', 'Start', 'home'],
  ['search', '#/search', 'Suche', 'search'],
  ['library', '#/library', 'Bibliothek', 'library'],
];

const ctrls = (big = false) => `<div class="ctrls${big ? ' big' : ''}">
  <button class="ib sm tgl" data-act="shuffle" data-st="shuffle" aria-label="Zufall">${icon('shuffle')}</button>
  <button class="ib" data-act="prev" aria-label="Zurück">${icon('prev')}</button>
  <button class="pp" data-act="toggle" aria-label="Abspielen / Pause">${icon('play', 'i-play')}${icon('pause', 'i-pause')}<span class="spin"></span></button>
  <button class="ib" data-act="next" aria-label="Weiter">${icon('next')}</button>
  <button class="ib sm tgl" data-act="repeat" data-st="repeat" aria-label="Wiederholen">${icon('repeat', 'i-rep')}${icon('repeat1', 'i-rep1')}</button>
</div>`;

document.body.insertAdjacentHTML(
  'afterbegin',
  `<div class="aura" aria-hidden="true"><i></i><i></i></div>
  <div class="app">
    <aside class="side">
      <a class="brand" href="#/" aria-label="SagaSound">${logo(30)}${wordmark()}</a>
      <nav class="nav">${NAV.map((n) => navItem(...n)).join('')}</nav>
      <div class="side-sec">
        <div class="side-h"><span>Playlists</span><button class="ib sm" data-act="new-playlist" aria-label="Neue Playlist">${icon('plus')}</button></div>
        <div class="side-list" id="side-list"></div>
      </div>
      <a class="credit" href="https://soundcloud.com" target="_blank" rel="noopener">Powered by SoundCloud</a>
    </aside>
    <main class="main" id="main">
      <div class="top" id="top">
        <div class="top-l"><button class="ib sm" data-act="back" aria-label="Zurück">${icon('left')}</button><button class="ib sm" data-act="fwd" aria-label="Vor">${icon('right')}</button></div>
        <a class="brand m" href="#/" aria-label="SagaSound">${logo(26)}${wordmark()}</a>
        <div class="top-r"><span class="sync" id="sync" title="Sync">${icon('sync')}</span><button class="me-btn" id="me-btn" data-act="settings" aria-label="Einstellungen"></button></div>
      </div>
      <div class="view" id="view"></div>
    </main>
  </div>
  <footer class="player" id="player">
    <div class="pb-prog"><i id="pb-mini"></i></div>
    <div class="pb-l">
      <button class="pb-art" data-act="np-open" aria-label="Jetzt läuft"><img id="pb-img" alt=""></button>
      <div class="pb-meta" data-act="np-open-m"><div class="pb-t" id="pb-t"></div><a class="pb-a" id="pb-a"></a></div>
      <button class="ib sm like" data-act="like-cur" id="pb-like" aria-label="Gefällt mir">${icon('heart')}</button>
    </div>
    <div class="pb-c">
      ${ctrls()}
      <div class="seek"><span class="t" id="pb-cur">0:00</span><div class="wave" id="pb-wave"></div><span class="t" id="pb-dur">0:00</span></div>
    </div>
    <div class="pb-r">
      <a class="ib sm" id="pb-sc" target="_blank" rel="noopener" aria-label="Auf SoundCloud">${icon('ext')}</a>
      <button class="ib sm" data-act="queue" data-st="queue" aria-label="Warteschlange">${icon('queue')}</button>
      <div class="vol"><button class="ib sm" data-act="mute" id="vol-btn" aria-label="Stumm">${icon('vol')}</button><input type="range" id="vol" min="0" max="100" step="1" aria-label="Lautstärke"></div>
      <button class="ib sm" data-act="np-open" aria-label="Vollbild">${icon('expand')}</button>
    </div>
    <button class="pp m" data-act="toggle" aria-label="Abspielen / Pause">${icon('play', 'i-play')}${icon('pause', 'i-pause')}<span class="spin"></span></button>
  </footer>
  <nav class="tabbar">${NAV.map((n) => navItem(...n)).join('')}</nav>
  <section class="np" id="np" aria-hidden="true">
    <div class="np-bg"><img id="np-bg" alt=""></div>
    <header class="np-top"><button class="ib" data-act="np-close" aria-label="Schließen">${icon('down')}</button><div class="np-ctx" id="np-ctx"></div><button class="ib" data-act="np-menu" aria-label="Mehr">${icon('more')}</button></header>
    <div class="np-main">
      <div class="np-art"><img id="np-img" alt=""></div>
      <div class="np-panel">
        <div class="np-meta"><div class="np-mt"><div class="np-t" id="np-t"></div><a class="np-a" id="np-a"></a></div><button class="ib like" data-act="like-cur" id="np-like" aria-label="Gefällt mir">${icon('heart')}</button></div>
        <div class="wave big" id="np-wave"></div>
        <div class="np-times"><span id="np-cur">0:00</span><span id="np-dur">0:00</span></div>
        ${ctrls(true)}
        <div class="np-sub">
          <a class="ib sm" id="np-sc" target="_blank" rel="noopener" aria-label="Auf SoundCloud">${icon('ext')}</a>
          <button class="ib sm" data-act="radio-cur" aria-label="Radio">${icon('radio')}</button>
          <button class="ib sm" data-act="queue" data-st="queue" aria-label="Warteschlange">${icon('queue')}</button>
        </div>
        <div class="np-next" id="np-next"></div>
      </div>
    </div>
  </section>
  <aside class="qp" id="qp" aria-hidden="true">
    <header class="qp-h"><h3>Warteschlange</h3><button class="ib sm" data-act="q-clear" aria-label="Leeren">${icon('trash')}</button><button class="ib sm" data-act="queue" aria-label="Schließen">${icon('x')}</button></header>
    <div class="qp-b" id="qp-b"></div>
  </aside>
  <div class="scrim" id="scrim" data-act="scrim"></div>
  <div class="menu" id="menu" role="menu" hidden></div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <button class="ib unlock-x" data-act="unlock-close" aria-label="Schließen">${icon('x')}</button>
  <div class="sc-host" id="sc-player"></div>
  <div class="sc-host" id="sc-scout"></div>
  <dialog class="dlg" id="dlg"></dialog>
  <input type="file" id="file" accept="application/json,.json" hidden>`,
);

const main = $('#main');
const view = $('#view');

// ---------------- router ----------------

const ROUTES = {
  '': V.home,
  search: V.search,
  library: V.library,
  artist: V.artist,
  playlist: V.playlist,
  mix: V.mix,
  genre: V.genre,
};
const NAV_OF = { '': 'home', search: 'search', library: 'library', playlist: 'library' };

let route = { key: null, name: '' };
let viewOut = null;
let navClick = false;
const scrolls = new Map();

function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const [name = '', arg = ''] = path.split('/');
  return { key: h, name: ROUTES[name] ? name : '', arg: decodeURIComponent(arg), params: new URLSearchParams(qs || '') };
}

function render(soft = false) {
  const r = parse();
  const shelves = soft ? new Map($$('[data-sk]', view).map((x) => [x.dataset.sk, x.scrollLeft])) : null;
  const top = main.scrollTop;
  viewOut = ROUTES[r.name](r.arg, r.params);
  view.innerHTML = viewOut.html;
  viewOut.mount?.(view);
  V.mountLists(view);
  $$('.fit', view).forEach((h) => {
    const n = h.textContent.length;
    h.classList.toggle('long', n > 16);
    h.classList.toggle('xlong', n > 30);
  });
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (NAV_OF[r.name] || '')));
  markPlaying();
  syncPlayButtons();
  if (soft) {
    main.scrollTop = top;
    $$('[data-sk]', view).forEach((x) => shelves.has(x.dataset.sk) && (x.scrollLeft = shelves.get(x.dataset.sk)));
  } else {
    main.scrollTop = navClick ? 0 : scrolls.get(r.key) || 0;
    view.classList.remove('enter');
    void view.offsetWidth;
    view.classList.add('enter');
  }
  navClick = false;
  route = r;
}

addEventListener('hashchange', () => {
  scrolls.set(route.key, main.scrollTop);
  closeMenu();
  render();
});

// Background updates (sync, discovery, likes) refresh the page without jumping around.
let lastSoft = 0;
const topics = new Set();
const soft = debounce(() => {
  if (!$('#menu').hidden || $('#dlg').open) return soft();
  if (topics.size && ![...topics].some((t) => viewOut?.deps?.includes(t))) return topics.clear();
  topics.clear();
  const wait = viewOut?.home ? 2500 - (Date.now() - lastSoft) : 0;
  if (wait > 0) return setTimeout(soft, wait);
  lastSoft = Date.now();
  render(true);
}, 350);

S.on('*', (topic) => {
  if (topic === 'library' || topic === 'catalog' || topic === '*') {
    renderSide();
    likeState();
  }
  if (topic === 'me' || topic === '*') renderMe();
  if (topic === 'catalog') onTrack();
  topics.add(topic);
  soft();
  if (topic === 'library') rediscover();
});

const rediscover = debounce(() => SY.discover(), 8000);

// ---------------- player ui ----------------

const pbWave = new Wave($('#pb-wave'), (ms) => PL.seek(ms));
const npWave = new Wave($('#np-wave'), (ms) => PL.seek(ms));

function setImg(el, src) {
  if (!src) {
    el.removeAttribute('src');
    el.classList.remove('ld');
    return;
  }
  if (el.getAttribute('src') === src) return;
  el.classList.remove('ld');
  el.onload = () => el.classList.add('ld');
  el.src = src;
}

let auraFlip = 0;
let auraSrc = null;
function aura(src) {
  if (src === auraSrc) return;
  auraSrc = src;
  const layers = $$('.aura i');
  const next = layers[auraFlip];
  auraFlip ^= 1;
  next.style.backgroundImage = src ? `url("${src}")` : '';
  next.classList.toggle('on', !!src);
  layers[auraFlip].classList.remove('on');
}

let shownId = null;
let shownWave = null;

function onTrack() {
  const t = current();
  const id = currentId();
  document.body.classList.toggle('has-track', !!t || id != null);
  if (id == null) return;
  const u = t && S.users[t.uid];
  const a = trackArt(t);
  setImg($('#pb-img'), a && art(a, 't300x300'));
  setImg($('#np-img'), a && art(a, 't500x500'));
  setImg($('#np-bg'), a && art(a, 't300x300'));
  for (const p of ['pb', 'np']) {
    $(`#${p}-t`).textContent = t?.title || '···';
    $(`#${p}-t`).title = t?.title || '';
    const al = $(`#${p}-a`);
    al.textContent = u?.name || '';
    al.href = t ? `#/artist/${t.uid}` : '#/';
  }
  const sc = t?.url || u?.url || 'https://soundcloud.com';
  $('#pb-sc').href = sc;
  $('#np-sc').href = sc;
  $('#np-ctx').textContent = P.ctx?.title || '';
  $('.pb-art').style.background = gradientFor(id);
  likeState();
  if (id !== shownId) {
    shownId = id;
    shownWave = null;
    pbWave.set(null);
    npWave.set(null);
    accentFrom(a ? art(a, 't67x67') : '', String(id)).then((c) => {
      if (currentId() !== id) return;
      const col = applyAccent(c);
      pbWave.colors(col);
      npWave.colors(col);
    });
    aura(a ? art(a, 't300x300') : '');
  }
  if (t?.wave && t.wave !== shownWave) {
    shownWave = t.wave;
    loadWave(t.wave).then((s) => {
      if (currentId() !== id) return;
      pbWave.set(s);
      npWave.set(s);
    });
  }
  markPlaying();
  renderQueue();
  title();
}

function onState() {
  const b = document.body.classList;
  b.toggle('playing', P.playing);
  b.toggle('loading', P.loading);
  b.toggle('reveal', P.blocked);
  $$('[data-st="shuffle"]').forEach((x) => x.classList.toggle('on', P.shuffle));
  $$('[data-st="repeat"]').forEach((x) => {
    x.classList.toggle('on', P.repeat !== 'off');
    x.classList.toggle('one', P.repeat === 'one');
  });
  const v = P.muted ? 0 : P.vol;
  const vol = $('#vol');
  if (document.activeElement !== vol) vol.value = v;
  vol.style.setProperty('--v', v + '%');
  $('#vol-btn').innerHTML = icon(v === 0 ? 'mute' : v < 50 ? 'vol1' : 'vol');
  syncPlayButtons();
  markPlaying();
  title();
}

const onProgress = rafOnce(() => {
  const dur = P.dur || current()?.dur || 0;
  pbWave.update(P.pos, dur, P.buf);
  if (document.body.classList.contains('np-open')) npWave.update(P.pos, dur, P.buf);
  const cur = fmtTime(P.pos);
  const d = fmtTime(dur);
  $('#pb-cur').textContent = cur;
  $('#pb-dur').textContent = d;
  $('#np-cur').textContent = cur;
  $('#np-dur').textContent = d;
  $('#pb-mini').style.transform = `scaleX(${dur ? clamp(P.pos / dur, 0, 1) : 0})`;
});

function likeState() {
  const on = currentId() != null && S.isLiked(currentId());
  $$('[data-act="like-cur"]').forEach((x) => x.classList.toggle('on', on));
}

function markPlaying() {
  const id = currentId();
  $$('.is-cur').forEach((el) => String(el.dataset.track) !== String(id) && el.classList.remove('is-cur'));
  if (id != null) $$(`[data-track="${id}"]`).forEach((el) => el.classList.add('is-cur'));
}

function syncPlayButtons() {
  $$('.btn-play[data-list]').forEach((b) => {
    const L = getList(b.dataset.list);
    b.classList.toggle('is-on', P.playing && !!L && V.sameCtx(L.ctx, P.ctx));
  });
}

function title() {
  const t = current();
  document.title = t && P.playing ? `${t.title} · ${S.users[t.uid]?.name || ''}` : 'SagaSound';
}

onPlayer('track', onTrack);
onPlayer('state', onState);
onPlayer('progress', onProgress);
onPlayer('queue', () => {
  renderQueue();
  markPlaying();
});
onPlayer('error', () => toast('Nicht verfügbar', 'x'));

$('#vol').addEventListener('input', (e) => PL.setVolume(Number(e.target.value)));
$('.vol').addEventListener('wheel', (e) => {
  e.preventDefault();
  PL.setVolume(P.vol + (e.deltaY < 0 ? 5 : -5));
}, { passive: false });

// ---------------- queue + now playing ----------------

function qrow(id, i, now = false) {
  const t = S.tracks[id];
  const u = t && S.users[t.uid];
  return `<div class="qrow${now ? ' now' : ''}" data-act="q-jump" data-qi="${i}" data-track="${id}">
    <div class="r-cv" style="background:${gradientFor(id)}">${img(trackArt(t), 'large')}</div>
    <div class="r-main"><div class="r-t">${esc(t?.title || '···')}</div><div class="r-s">${esc(u?.name || '')}</div></div>
    ${now ? '<span class="eq"><i></i><i></i><i></i><i></i></span>' : `<button class="ib sm" data-act="q-remove" data-qi="${i}" aria-label="Entfernen">${icon('x')}</button>`}
  </div>`;
}

function renderQueue() {
  const i = P.index;
  if (document.body.classList.contains('q-open')) {
    const up = P.queue.slice(i + 1, i + 151).map((id, k) => qrow(id, i + 1 + k)).join('');
    $('#qp-b').innerHTML =
      (i >= 0 ? `<div class="qp-k">Jetzt</div>${qrow(P.queue[i], i, true)}` : '') +
      (up ? `<div class="qp-k">Als Nächstes</div>${up}` : '') || `<div class="empty">${icon('queue')}</div>`;
  }
  if (document.body.classList.contains('np-open')) {
    const up = P.queue.slice(i + 1, i + 5);
    $('#np-next').innerHTML = up.length ? `<div class="qp-k">Als Nächstes</div>${up.map((id, k) => qrow(id, i + 1 + k)).join('')}` : '';
  }
  markPlaying();
}

function openNP() {
  if (currentId() == null) return;
  document.body.classList.add('np-open');
  $('#np').setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    npWave.resize();
    onProgress();
  });
  renderQueue();
}

function closeNP() {
  document.body.classList.remove('np-open');
  $('#np').setAttribute('aria-hidden', 'true');
}

function toggleQueue(force) {
  const on = force ?? !document.body.classList.contains('q-open');
  document.body.classList.toggle('q-open', on);
  $('#qp').setAttribute('aria-hidden', String(!on));
  $$('[data-st="queue"]').forEach((x) => x.classList.toggle('on', on));
  if (on) renderQueue();
}

// Swipe down closes the now-playing sheet on touch screens.
{
  let y0 = null;
  const np = $('#np');
  np.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' && !e.target.closest('.wave, button, a, input')) y0 = e.clientY;
  });
  np.addEventListener('pointerup', (e) => {
    if (y0 != null && e.clientY - y0 > 90) closeNP();
    y0 = null;
  });
  np.addEventListener('pointercancel', () => (y0 = null));
}

// ---------------- sidebar / header ----------------

function renderSide() {
  const items = [];
  if (S.likes.length) items.push(`<a class="si" href="#/library/likes"><span class="si-cv">${likesCover()}</span><span class="si-t">Likes</span><span class="si-n">${S.likes.length}</span></a>`);
  S.playlists.forEach((p) => items.push(`<a class="si" href="#/playlist/${p.id}"><span class="si-cv">${playlistCover(p)}</span><span class="si-t">${esc(p.title)}</span></a>`));
  $('#side-list').innerHTML = items.join('');
}

function renderMe() {
  const u = S.me && (S.users[S.me.id] || S.me);
  $('#me-btn').innerHTML = u ? avatar(u, 'large') : icon('user');
  $('#me-btn').classList.toggle('has', !!u);
}

SY.onStatus((s) => $('#sync').classList.toggle('on', s.syncing || s.discovering));

main.addEventListener('scroll', rafOnce(() => $('#top').classList.toggle('solid', main.scrollTop > 8)), { passive: true });

// ---------------- menu, toast, dialogs ----------------

let menuItems = [];
let menuAt = null;

function openMenu(items, at) {
  const m = $('#menu');
  menuItems = items.filter(Boolean);
  menuAt = at;
  m.innerHTML = menuItems
    .map((it, i) => (it === '-' ? '<hr>' : `<button class="mi${it.danger ? ' danger' : ''}" data-mi="${i}" role="menuitem">${icon(it.icon)}<span>${esc(it.label)}</span>${it.sub ? icon('right', 'mi-sub') : ''}</button>`))
    .join('');
  m.hidden = false;
  document.body.classList.add('menu-open');
  if (matchMedia('(max-width: 820px)').matches) {
    m.style.left = m.style.top = '';
    return;
  }
  const mw = m.offsetWidth;
  const mh = m.offsetHeight;
  let x = at.right - mw;
  if (x < 8) x = at.left;
  let y = at.bottom + 6;
  if (y + mh > innerHeight - 8) y = at.top - mh - 6;
  m.style.left = clamp(x, 8, innerWidth - mw - 8) + 'px';
  m.style.top = clamp(y, 8, innerHeight - mh - 8) + 'px';
}

function closeMenu() {
  $('#menu').hidden = true;
  document.body.classList.remove('menu-open');
}

$('#menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mi]');
  if (!b) return;
  e.stopPropagation();
  const it = menuItems[Number(b.dataset.mi)];
  if (it.sub) return openMenu(it.sub(), menuAt);
  closeMenu();
  it.run();
});

const rectAt = (el, e) =>
  el?.getBoundingClientRect() || { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };

function trackMenu(id, rowEl, at) {
  const t = S.tracks[id];
  if (!t?.ok) return;
  const liked = S.isLiked(id);
  const L = rowEl ? getList(rowEl.dataset.list) : null;
  const pl = L?.ctx?.type === 'playlist' ? S.playlist(L.ctx.id) : null;
  openMenu(
    [
      { icon: 'next', label: 'Als Nächstes', run: () => (PL.playNext([id]), toast('Als Nächstes', 'next')) },
      { icon: 'end', label: 'Zur Warteschlange', run: () => (PL.enqueue([id]), toast('Warteschlange', 'end')) },
      { icon: 'listPlus', label: 'Zur Playlist', sub: () => playlistPicker([id]) },
      { icon: 'heart', label: liked ? 'Like entfernen' : 'Gefällt mir', run: () => S.toggleLike(id) },
      { icon: 'radio', label: 'Radio', run: () => startRadio(id) },
      '-',
      { icon: 'user', label: 'Künstler', run: () => go(`#/artist/${t.uid}`) },
      t.url && { icon: 'ext', label: 'SoundCloud', run: () => open(t.url, '_blank', 'noopener') },
      t.url && { icon: 'link', label: 'Link kopieren', run: () => copy(t.url) },
      pl?.kind === 'local' && { icon: 'trash', label: 'Entfernen', danger: true, run: () => S.removeFromPlaylist(pl.id, Number(rowEl.dataset.i)) },
    ],
    at,
  );
}

function playlistPicker(ids) {
  return [
    { icon: 'plus', label: 'Neue Playlist', run: () => newPlaylist(ids) },
    ...S.playlists
      .filter((p) => p.kind === 'local')
      .map((p) => ({ icon: 'queue', label: p.title, run: () => toast(S.addToPlaylist(p.id, ids) ? p.title : 'Schon drin', 'check') })),
  ];
}

function playlistMenu(pid, at) {
  const p = S.playlist(pid);
  if (!p) return;
  openMenu(
    [
      { icon: 'end', label: 'Zur Warteschlange', run: () => PL.enqueue(p.tracks) },
      p.kind === 'local' && { icon: 'settings', label: 'Umbenennen', run: () => ask({ icon: 'queue', value: p.title }).then((v) => v && S.renamePlaylist(p.id, v)) },
      p.kind === 'sc' && { icon: 'sync', label: 'Aktualisieren', run: () => p.url && SY.addLink(p.url).then(() => toast(p.title, 'sync')) },
      p.url && { icon: 'ext', label: 'SoundCloud', run: () => open(p.url, '_blank', 'noopener') },
      '-',
      { icon: 'trash', label: 'Löschen', danger: true, run: () => (S.deletePlaylist(p.id), go('#/library/playlists')) },
    ],
    at,
  );
}

let toastT = 0;
function toast(msg, ic = 'check') {
  const t = $('#toast');
  t.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2200);
}

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Link kopiert', 'link'), () => toast('Link', 'link'));
}

function go(hash) {
  navClick = true;
  closeNP();
  toggleQueue(false);
  if (location.hash === hash) render();
  else location.hash = hash;
}

function ask({ icon: ic = 'plus', value = '', placeholder = '' } = {}) {
  const d = $('#dlg');
  d.className = 'dlg';
  d.innerHTML = `<form class="ask">
    <div class="ask-in">${icon(ic)}<input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"></div>
    <div class="ask-a"><button type="button" class="pill ghost" data-close>Abbrechen</button><button class="pill solid">OK</button></div>
  </form>`;
  return new Promise((resolve) => {
    const f = d.querySelector('form');
    const inp = f.querySelector('input');
    let val = null;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      val = inp.value.trim() || null;
      d.close();
    });
    d.addEventListener('close', () => resolve(val), { once: true });
    d.showModal();
    inp.focus();
    inp.select();
  });
}

async function newPlaylist(ids = []) {
  const name = await ask({ icon: 'queue', placeholder: 'Playlist' });
  if (!name) return;
  const p = S.createPlaylist(name);
  if (ids.length) {
    S.addToPlaylist(p.id, ids);
    toast(p.title, 'check');
  } else go(`#/playlist/${p.id}`);
}

async function addLinkDialog() {
  const v = await ask({ icon: 'link', placeholder: 'soundcloud.com/…' });
  if (!v) return;
  toast('···', 'sync');
  try {
    const r = await SY.addLink(v);
    toast('Hinzugefügt', 'check');
    if (r.kind === 'playlist') go(`#/playlist/${r.id}`);
    if (r.kind === 'user') go(`#/artist/${r.id}`);
  } catch {
    toast('Nicht gefunden', 'x');
  }
}

function openSettings() {
  const d = $('#dlg');
  const me = S.me;
  const u = me && (S.users[me.id] || me);
  d.className = 'dlg set';
  d.innerHTML = `<div class="set-b">
    <button class="ib sm dlg-x" data-close aria-label="Schließen">${icon('x')}</button>
    ${
      me
        ? `<div class="set-me"><div class="set-av">${avatar(u, 't300x300')}</div><div class="set-id"><div class="set-n">${esc(me.name)}</div><a class="set-u" href="${esc(me.url)}" target="_blank" rel="noopener">${esc((me.url || '').replace(/^https?:\/\//, ''))}</a></div></div>
           <div class="set-row"><button class="pill" data-set="sync">${icon('sync')}<span>Sync</span></button><button class="pill ghost" data-set="logout">${icon('logout')}<span>Trennen</span></button></div>`
        : `<div class="set-logo">${logo(44)}</div><form class="connect sm" data-form="connect" autocomplete="off"><label class="connect-f"><span>soundcloud.com/</span><input name="u" placeholder="dein-name" spellcheck="false" autocapitalize="off" aria-label="SoundCloud Profil"></label><button class="connect-go" aria-label="Verbinden">${icon('arrow')}</button></form>`
    }
    <div class="set-list">
      <label class="set-item">${icon('radio')}<span>Autoplay</span><input type="checkbox" class="switch" data-set="autoplay"${P.autoplay ? ' checked' : ''}></label>
      <button class="set-item" data-set="export">${icon('download')}<span>Backup</span></button>
      <button class="set-item" data-set="import">${icon('upload')}<span>Import</span></button>
      <button class="set-item danger" data-set="reset">${icon('trash')}<span>Zurücksetzen</span></button>
    </div>
    <div class="set-foot">${logo(16)}<span>SagaSound</span><span class="dot"></span><a href="https://soundcloud.com" target="_blank" rel="noopener">Powered by SoundCloud</a></div>
  </div>`;
  d.showModal();
}

$('#dlg').addEventListener('click', async (e) => {
  const d = $('#dlg');
  if (e.target === d || e.target.closest('[data-close]')) return d.close();
  const b = e.target.closest('[data-set]');
  if (!b) return;
  const k = b.dataset.set;
  if (k === 'autoplay') return PL.setAutoplay(b.checked);
  if (k === 'sync') {
    d.close();
    toast('Sync', 'sync');
    await SY.syncMe(true);
  } else if (k === 'logout') {
    SY.disconnect();
    d.close();
    render();
  } else if (k === 'export') {
    const blob = new Blob([JSON.stringify(S.exportData())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sagasound-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } else if (k === 'import') {
    $('#file').click();
  } else if (k === 'reset') {
    if (!b.classList.contains('confirm')) {
      b.classList.add('confirm');
      b.querySelector('span').textContent = 'Sicher?';
      return;
    }
    S.reset();
    location.hash = '#/';
    location.reload();
  }
});

$('#file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  try {
    S.importData(JSON.parse(await f.text()));
    PL.restore();
    $('#dlg').close();
    render();
    toast('Importiert', 'check');
  } catch {
    toast('Ungültig', 'x');
  }
});

function startRadio(id) {
  const t = S.tracks[id];
  PL.playList([id, ...radio(id, 30, new Set([id]))], 0, { type: 'radio', id, title: t ? `${t.title} Radio` : 'Radio' });
}

// ---------------- global events ----------------

const ACT = {
  play(el) {
    const tr = el.closest('[data-track]');
    if (!tr) return;
    const id = Number(tr.dataset.track);
    const L = getList(tr.dataset.list);
    if (id === currentId() && P.index >= 0) return PL.toggle();
    if (!L) return PL.playList([id], 0, null);
    PL.playList(L.ids, Number(tr.dataset.i) || 0, L.ctx);
  },
  'play-list'(el) {
    const L = getList(el.dataset.list);
    if (!L?.ids.length) return;
    if (V.sameCtx(L.ctx, P.ctx) && P.index >= 0) return PL.toggle();
    PL.playList(L.ids, 0, L.ctx);
  },
  'shuffle-list'(el) {
    const L = getList(el.dataset.list);
    if (L?.ids.length) PL.shufflePlay(L.ids, L.ctx);
  },
  async 'artist-play'(el) {
    const uid = Number(el.dataset.uid);
    const ctx = { type: 'artist', id: uid, title: S.users[uid]?.name || '' };
    let ids = V.artistPlayIds(uid);
    if (!ids.length) {
      el.classList.add('busy');
      await SY.scoutArtist(uid);
      el.classList.remove('busy');
      ids = V.artistPlayIds(uid);
    }
    if (ids.length) PL.playList(ids, 0, ctx);
  },
  like(el) {
    const id = Number(el.closest('[data-track]').dataset.track);
    el.classList.toggle('on', S.toggleLike(id));
  },
  'like-cur'() {
    const id = currentId();
    if (id != null) S.toggleLike(id);
    likeState();
  },
  menu(el) {
    const tr = el.closest('[data-track]');
    trackMenu(Number(tr.dataset.track), tr, el.getBoundingClientRect());
  },
  'np-menu'(el) {
    if (currentId() != null) trackMenu(currentId(), null, el.getBoundingClientRect());
  },
  'pl-more'(el) {
    playlistMenu(el.dataset.pid, el.getBoundingClientRect());
  },
  toggle: () => PL.toggle(),
  next: () => PL.next(),
  prev: () => PL.prev(),
  shuffle: () => PL.toggleShuffle(),
  repeat: () => PL.cycleRepeat(),
  mute: () => PL.toggleMute(),
  queue: () => toggleQueue(),
  'np-open': openNP,
  'np-open-m'(el, e) {
    if (matchMedia('(max-width: 820px)').matches && !e.target.closest('a')) openNP();
  },
  'np-close': closeNP,
  'radio-cur': () => currentId() != null && startRadio(currentId()),
  settings: openSettings,
  follow(el) {
    const on = S.toggleFollow(Number(el.dataset.uid));
    toast(on ? 'Folge ich' : 'Entfolgt', on ? 'following' : 'x');
  },
  'new-playlist': () => newPlaylist(),
  'add-link': addLinkDialog,
  vibe(el) {
    const v = SY.VIBES.find((x) => x.id === el.dataset.vibe);
    if (!v) return;
    el.classList.add('on');
    SY.addVibe(v).then(() => soft());
    if (!location.hash || location.hash === '#/') setTimeout(() => render(true), 900);
  },
  'clear-search'() {
    const q = $('#q');
    q.value = '';
    q.dispatchEvent(new Event('input'));
    q.focus();
  },
  'scroll-l': (el) => scrollShelf(el, -1),
  'scroll-r': (el) => scrollShelf(el, 1),
  'q-jump': (el) => PL.jump(Number(el.dataset.qi)),
  'q-remove': (el) => PL.removeAt(Number(el.dataset.qi)),
  'q-clear': () => PL.clearUpcoming(),
  'unlock-close'() {
    P.blocked = false;
    document.body.classList.remove('reveal');
  },
  scrim() {
    toggleQueue(false);
    ACT['unlock-close']();
  },
  back: () => history.back(),
  fwd: () => history.forward(),
  async 'peek-add'(el) {
    el.classList.add('busy');
    try {
      const r = await SY.addLink(el.dataset.url);
      toast('Hinzugefügt', 'check');
      if (r.kind === 'playlist') go(`#/playlist/${r.id}`);
      else if (r.kind === 'user') go(`#/artist/${r.id}`);
      else if (r.kind === 'track') PL.playList([r.id], 0, null);
    } catch {
      toast('Nicht gefunden', 'x');
    }
    el.classList.remove('busy');
  },
};

function scrollShelf(btn, dir) {
  const row = btn.closest('.shelf')?.querySelector('.sh-row');
  row?.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: 'smooth' });
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t.closest('#menu')) closeMenu();
  const a = t.closest('a[href]');
  if (a) {
    if (a.getAttribute('href').startsWith('#')) {
      navClick = true;
      closeNP();
      if (matchMedia('(max-width: 820px)').matches) toggleQueue(false);
    }
    return;
  }
  const act = t.closest('[data-act]');
  if (act) {
    ACT[act.dataset.act]?.(act, e);
    return;
  }
  const h = t.closest('[data-href]');
  if (h) go(h.dataset.href);
});

document.addEventListener('contextmenu', (e) => {
  const tr = e.target.closest('[data-track]');
  if (!tr || !S.tracks[tr.dataset.track]?.ok || tr.classList.contains('qrow')) return;
  e.preventDefault();
  trackMenu(Number(tr.dataset.track), tr, rectAt(null, e));
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const input = f.querySelector('input');
  if (f.dataset.form === 'search') return input.blur();
  if (f.dataset.form === 'connect') {
    if (!input.value.trim() || f.classList.contains('busy')) return shake(f);
    f.classList.add('busy');
    try {
      await SY.connect(input.value);
      if ($('#dlg').open) $('#dlg').close();
      go('#/');
    } catch {
      shake(f);
      toast('Nicht gefunden', 'x');
    }
    f.classList.remove('busy');
  }
});

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

// Fade images in once they arrive; hide the broken ones.
document.addEventListener(
  'load',
  (e) => {
    if (e.target.tagName !== 'IMG') return;
    e.target.classList.add('ld');
    markLoaded(e.target.getAttribute('src'));
  },
  true,
);
document.addEventListener('error', (e) => e.target.tagName === 'IMG' && e.target.classList.add('err'), true);

addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (e.key === 'Escape') {
    if (!$('#menu').hidden) return closeMenu();
    if (document.body.classList.contains('q-open')) return toggleQueue(false);
    if (document.body.classList.contains('np-open')) return closeNP();
    if (P.blocked) return ACT['unlock-close']();
  }
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable || $('#dlg').open) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Enter' && e.target.matches('[data-href]')) return go(e.target.dataset.href);
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const map = {
    ' ': () => PL.toggle(),
    ArrowRight: () => (e.shiftKey ? PL.next() : PL.seekBy(10000)),
    ArrowLeft: () => (e.shiftKey ? PL.prev() : PL.seekBy(-10000)),
    ArrowUp: () => PL.setVolume(P.vol + 5),
    ArrowDown: () => PL.setVolume(P.vol - 5),
    m: () => PL.toggleMute(),
    l: () => ACT['like-cur'](),
    s: () => PL.toggleShuffle(),
    r: () => PL.cycleRepeat(),
    n: () => PL.next(),
    p: () => PL.prev(),
    q: () => toggleQueue(),
    f: () => (document.body.classList.contains('np-open') ? closeNP() : openNP()),
    '/': () => go('#/search'),
  };
  if (!map[k]) return;
  if (e.target.closest?.('.wave') && (k === 'ArrowRight' || k === 'ArrowLeft')) return;
  e.preventDefault();
  map[k]();
});

// ---------------- boot ----------------

{
  const col = applyAccent({ h: 14, s: 0.92, l: 0.6 });
  pbWave.colors(col);
  npWave.colors(col);
}
renderSide();
renderMe();
PL.restore();
onState();
render();
loadApi().catch(() => {});
setTimeout(() => {
  SY.maybeResync();
  const stubs = S.stubs();
  if (stubs.length && !S.me) SY.hydrate(stubs);
}, 1200);
