// Your own audio files (MP3, M4A, WAV, …). Files stay in this browser (IndexedDB) and play
// through a normal <audio> element. Local tracks and artists use negative ids so they never
// collide with SoundCloud ids.
import { S } from './store.js';
import { idbAll, idbGet, idbPut, idbDel, idbClear } from './idb.js';
import { hash } from './util.js';

const audioUrls = new Map(); // id -> object URL (small LRU, audio is loaded on demand)
const artUrls = new Map(); // id -> object URL of embedded artwork

export const isLocal = (id) => Number(id) < 0;
export const fileArt = (id) => artUrls.get(Number(id)) || '';

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|webm)$/i;
export const isAudioFile = (f) => !!f && (f.type?.startsWith('audio/') || AUDIO_EXT.test(f.name || ''));

export async function initFiles() {
  try {
    for (const [id, blob] of await idbAll('art')) if (blob instanceof Blob) artUrls.set(Number(id), URL.createObjectURL(blob));
  } catch {}
}

export async function fileUrl(id) {
  id = Number(id);
  if (audioUrls.has(id)) {
    const u = audioUrls.get(id);
    audioUrls.delete(id);
    audioUrls.set(id, u);
    return u;
  }
  let blob = null;
  try {
    blob = await idbGet('files', id);
  } catch {}
  if (!(blob instanceof Blob)) return '';
  const u = URL.createObjectURL(blob);
  audioUrls.set(id, u);
  while (audioUrls.size > 4) {
    const [oldId, oldUrl] = audioUrls.entries().next().value;
    audioUrls.delete(oldId);
    setTimeout(() => URL.revokeObjectURL(oldUrl), 60000);
  }
  return u;
}

// ---------- tags ----------

const synch = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const latin1 = (bytes) => new TextDecoder('iso-8859-1').decode(bytes);

function unsync(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return Uint8Array.from(out);
}

function text(d) {
  if (!d.length) return '';
  const enc = d[0];
  const bytes = d.subarray(1);
  let s;
  if (enc === 0) s = latin1(bytes);
  else if (enc === 1) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) s = new TextDecoder('utf-16be').decode(bytes.subarray(2));
    else s = new TextDecoder('utf-16le').decode(bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2) : bytes);
  } else if (enc === 2) s = new TextDecoder('utf-16be').decode(bytes);
  else s = new TextDecoder('utf-8').decode(bytes);
  return s.split('\u0000').find((x) => x.trim()) || '';
}

function picture(d) {
  const enc = d[0];
  let p = 1;
  let mime = '';
  while (p < d.length && d[p] !== 0) mime += String.fromCharCode(d[p++]);
  p += 2; // terminator + picture type
  if (enc === 1 || enc === 2) {
    while (p + 1 < d.length && !(d[p] === 0 && d[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    while (p < d.length && d[p] !== 0) p++;
    p++;
  }
  const img = d.slice(p);
  if (img.length < 64) return null;
  if (!mime.includes('/')) mime = /png/i.test(mime) ? 'image/png' : 'image/jpeg';
  return new Blob([img], { type: mime.toLowerCase() });
}

function id3v2(b) {
  const ver = b[3];
  if (ver < 3 || ver > 4) return {};
  const flags = b[5];
  const size = synch(b, 6);
  let body = b.subarray(10, Math.min(b.length, 10 + size));
  if (flags & 0x80 && ver === 3) body = unsync(body);
  let p = 0;
  if (flags & 0x40) p = ver === 4 ? synch(body, 0) : be32(body, 0) + 4;
  const out = {};
  while (p + 10 <= body.length) {
    const id = String.fromCharCode(body[p], body[p + 1], body[p + 2], body[p + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = ver === 4 ? synch(body, p + 4) : be32(body, p + 4);
    const fmt = body[p + 9];
    let start = p + 10;
    p = start + len;
    if (len <= 0 || p > body.length) break;
    if (ver === 3 ? fmt & 0xc0 : fmt & 0x0c) continue; // compressed / encrypted
    if (ver === 4 && fmt & 0x01) start += 4; // data length indicator
    let data = body.subarray(start, p);
    if (ver === 4 && fmt & 0x02) data = unsync(data);
    if (id === 'TIT2') out.title = text(data);
    else if (id === 'TPE1') out.artist = text(data);
    else if (id === 'TPE2' && !out.albumArtist) out.albumArtist = text(data);
    else if (id === 'TALB') out.album = text(data);
    else if (id === 'TCON') out.genre = text(data);
    else if (id === 'APIC' && !out.art) out.art = picture(data);
  }
  return out;
}

function id3v1(b) {
  const field = (a, z) => latin1(b.subarray(a, z)).replace(/\u0000.*$/s, '').trim();
  return { title: field(3, 33), artist: field(33, 63), album: field(63, 93) };
}

// "01 - Artist - Title (Official Video).mp3" -> { artist, title }
export function fromFilename(name) {
  let s = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ');
  s = s.replace(/\s*[([](?:official|offizielles|lyrics?|audio|video|music video|visuali[sz]er|hd|hq|4k|free download)[^)\]]*[)\]]/gi, ' ');
  s = s.replace(/^\d{1,3}\s*[.\-–]\s*(?=\S)/, '').replace(/\s+/g, ' ').trim();
  const parts = s.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: s || 'Unbenannt' };
}

const cleanGenre = (g) => String(g || '').replace(/^\(\d+\)\s*/, '').replace(/^\d+$/, '').trim();

async function readTags(file) {
  let tags = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const size = synch(head, 6);
      tags = id3v2(new Uint8Array(await file.slice(0, Math.min(file.size, 10 + size)).arrayBuffer()));
    }
    if ((!tags.title || !tags.artist) && file.size > 128) {
      const tail = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
      if (tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47) {
        const v1 = id3v1(tail);
        tags.title ||= v1.title;
        tags.artist ||= v1.artist;
        tags.album ||= v1.album;
      }
    }
  } catch {}
  return tags;
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      a.removeAttribute('src');
      resolve(v);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => finish(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : 0);
    a.onerror = () => finish(-1);
    setTimeout(() => finish(0), 10000);
    a.src = url;
  });
}

// Waveform: decode at a low sample rate and keep ~420 peak values (base64, 1 byte each).
async function peaksOf(file, n = 420) {
  if (file.size > 80e6) return '';
  try {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) return '';
    const ctx = new Ctx(1, 8000, 8000);
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const ch = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / n));
    const vals = [];
    let max = 0;
    for (let i = 0; i < n; i++) {
      let m = 0;
      const end = Math.min(ch.length, (i + 1) * step);
      for (let k = i * step; k < end; k += 2) {
        const v = Math.abs(ch[k]);
        if (v > m) m = v;
      }
      vals.push(m);
      if (m > max) max = m;
    }
    const bytes = vals.map((v) => Math.round((v / (max || 1)) * 255));
    return btoa(String.fromCharCode(...bytes));
  } catch {
    return '';
  }
}

export function peaksToSamples(b64) {
  try {
    return Array.from(atob(b64), (c) => c.charCodeAt(0) / 255);
  } catch {
    return null;
  }
}

export const artistIdFor = (name) => -(1 + (hash('artist:' + String(name || '').trim().toLowerCase()) % 2147483000));

let lastId = 0;
function newId() {
  let id = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
  if (id >= lastId) id = lastId - 1;
  lastId = id;
  return id;
}

// Imports files one by one; onStep(done, total) reports progress. Returns the new track ids.
export async function importFiles(list, onStep = () => {}) {
  const files = [...list].filter(isAudioFile);
  const ids = [];
  let skipped = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onStep(i, files.length);
    const dur = await probeDuration(f);
    if (dur < 0) {
      skipped++;
      continue;
    }
    const tags = await readTags(f);
    const guess = fromFilename(f.name);
    const title = (tags.title || guess.title).trim();
    const artist = (tags.artist || tags.albumArtist || guess.artist || 'Unbekannt').trim();
    const id = newId();
    try {
      await idbPut('files', id, f);
    } catch {
      skipped++;
      continue;
    }
    if (tags.art) {
      try {
        await idbPut('art', id, tags.art);
        artUrls.set(id, URL.createObjectURL(tags.art));
      } catch {}
    }
    const uid = artistIdFor(artist);
    S.addUser({ id: uid, name: artist, slug: '', avatar: '', url: '', local: true });
    S.addLocalTrack({
      id,
      ok: true,
      local: true,
      title,
      uid,
      art: '',
      dur,
      full: dur,
      genre: cleanGenre(tags.genre),
      tags: [],
      plays: 0,
      likes: 0,
      date: f.lastModified || Date.now(),
      url: '',
      wave: '',
      policy: '',
      album: tags.album || '',
      peaks: await peaksOf(f),
      file: { name: f.name, size: f.size, type: f.type },
    });
    ids.push(id);
  }
  onStep(files.length, files.length);
  S.emit('library');
  return { ids, skipped: skipped + (list.length - files.length) };
}

export async function deleteFile(id) {
  id = Number(id);
  try {
    await idbDel('files', id);
    await idbDel('art', id);
  } catch {}
  const u = audioUrls.get(id);
  if (u) URL.revokeObjectURL(u);
  audioUrls.delete(id);
  const a = artUrls.get(id);
  if (a) URL.revokeObjectURL(a);
  artUrls.delete(id);
  S.removeLocalTrack(id);
}

export async function clearFiles() {
  try {
    await idbClear('files');
    await idbClear('art');
  } catch {}
  [...audioUrls.values(), ...artUrls.values()].forEach((u) => URL.revokeObjectURL(u));
  audioUrls.clear();
  artUrls.clear();
}
