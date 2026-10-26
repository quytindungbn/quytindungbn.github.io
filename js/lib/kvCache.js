const DB_NAME = 'qtd_cache';
const STORE = 'kv';
const OP_TIMEOUT_MS = 2000;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch {  } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function withTimeout(promise) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), OP_TIMEOUT_MS))]);
}

function run(mode, fn) {
  return withTimeout(openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result?.result ?? null);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  }).catch(() => null));
}

export function kvGet(key) { return run('readonly', (store) => store.get(key)); }

export async function kvSet(key, value) { await run('readwrite', (store) => store.put(value, key)); }

export async function kvClear() { await run('readwrite', (store) => store.clear()); }

const LS_PREFIX = 'qtd_cache:';

export function lsGetJson(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function lsSetJson(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch {  }
}

export async function clearDeviceCaches() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
    }
  } catch {  }
  await kvClear();
}
