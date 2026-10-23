// Bộ nhớ đệm bền trên máy (IndexedDB) cho các bảng dữ liệu LỚN tải theo trang (VD: bảng cân đối kế toán) — để tải lại trang/vào lại vẫn hiện
// ngay bản đã có, rồi mới đối chiếu với máy chủ ngầm. Mọi hàm đều KHÔNG BAO GIỜ throw/treo: trình duyệt chặn IndexedDB (cửa sổ ẩn danh, hết dung lượng...)
// thì coi như không có đệm, app chạy y như cũ (đọc trả null, ghi bỏ qua).
const DB_NAME = 'qtd_cache';
const STORE = 'kv';
const OP_TIMEOUT_MS = 2000; // IndexedDB treo (hiếm) thì bỏ qua đệm, không để trang đứng chờ

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch { /* đã có */ } };
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

/** Đọc 1 giá trị đã lưu; không có/lỗi -> null. */
export function kvGet(key) { return run('readonly', (store) => store.get(key)); }

/** Ghi 1 giá trị (đè bản cũ); lỗi -> bỏ qua âm thầm. */
export async function kvSet(key, value) { await run('readwrite', (store) => store.put(value, key)); }

/** Xóa toàn bộ đệm (đăng xuất) — không để dữ liệu của người trước lộ sang người sau dùng chung máy. */
export async function kvClear() { await run('readwrite', (store) => store.clear()); }

// ---- Đệm NHỎ (danh sách hội thoại...) dùng localStorage: đọc ĐỒNG BỘ nên vẽ được ngay ở lượt render đầu, không phải chờ ----
const LS_PREFIX = 'qtd_cache:';

export function lsGetJson(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function lsSetJson(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch { /* đầy/bị chặn: bỏ qua */ }
}

/** Đăng xuất: xóa mọi đệm của người đang dùng (cả IndexedDB lẫn localStorage). */
export async function clearDeviceCaches() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* bỏ qua */ }
  await kvClear();
}
