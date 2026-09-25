// Custom playlist covers. Images live in IndexedDB (localStorage as a fallback)
// and are rendered through object URLs, so the regular store stays small.
import { S } from './store.js';
import { idbAll, idbPut, idbDel, idbClear } from './idb.js';

const LS = 'sagasound:cover:';
const urls = new Map();

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

function forget(pid) {
  const old = urls.get(pid);
  if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
  urls.delete(pid);
}

export const coverUrl = (pid) => urls.get(pid) || '';

export async function initCovers() {
  try {
    for (const [pid, blob] of await idbAll('covers')) if (blob instanceof Blob) urls.set(pid, URL.createObjectURL(blob));
  } catch {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS) && !urls.has(k.slice(LS.length))) urls.set(k.slice(LS.length), localStorage.getItem(k));
    }
  } catch {}
}

export async function setCover(pid, blob) {
  try {
    await idbPut('covers', pid, blob);
  } catch {
    localStorage.setItem(LS + pid, await blobToDataUrl(blob));
  }
  forget(pid);
  urls.set(pid, URL.createObjectURL(blob));
  S.emit('library');
}

export async function removeCover(pid) {
  try {
    await idbDel('covers', pid);
  } catch {}
  try {
    localStorage.removeItem(LS + pid);
  } catch {}
  forget(pid);
  S.emit('library');
}

export async function clearCovers() {
  try {
    await idbClear('covers');
  } catch {}
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(LS))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
  [...urls.keys()].forEach(forget);
}

// For backups: every cover as a data URL.
export async function exportCovers() {
  const out = {};
  for (const [pid, url] of urls) {
    try {
      out[pid] = url.startsWith('data:') ? url : await blobToDataUrl(await (await fetch(url)).blob());
    } catch {}
  }
  return out;
}

export async function importCovers(map) {
  for (const [pid, dataUrl] of Object.entries(map || {})) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) continue;
    try {
      await setCover(pid, await (await fetch(dataUrl)).blob());
    } catch {}
  }
}
