// One IndexedDB database for everything too big for localStorage:
// custom playlist covers, imported audio files and their artwork.
const DB_NAME = 'sagasound';
const VERSION = 2;
const STORES = ['covers', 'files', 'art'];
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no-idb'));
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        STORES.forEach((s) => d.objectStoreNames.contains(s) || d.createObjectStore(s));
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('idb-blocked'));
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    let result;
    fn(t.objectStore(store), (v) => (result = v));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const idbGet = (store, key) => tx(store, 'readonly', (st, done) => (st.get(key).onsuccess = (e) => done(e.target.result)));
export const idbPut = (store, key, value) => tx(store, 'readwrite', (st) => st.put(value, key));
export const idbDel = (store, key) => tx(store, 'readwrite', (st) => st.delete(key));
export const idbClear = (store) => tx(store, 'readwrite', (st) => st.clear());

export const idbAll = (store) =>
  tx(store, 'readonly', (st, done) => {
    const out = [];
    st.openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return done(out);
      out.push([c.key, c.value]);
      c.continue();
    };
  });
