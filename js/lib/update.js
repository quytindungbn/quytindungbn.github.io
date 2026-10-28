import { APP_VERSION } from '../version.js';
import { toast } from '../components/toast.js';

const TRIED_KEY = 'qtd_upd_tried';
const RESUME_AFTER_MS = 15000;
const PERIODIC_MS = 5 * 60 * 1000;
let checking = false;
let bar = null;
let hiddenAt = 0;

export const appVersionLabel = () => APP_VERSION;

const getTried = () => { try { return sessionStorage.getItem(TRIED_KEY); } catch { return null; } };
const setTried = (v) => { try { sessionStorage.setItem(TRIED_KEY, v); } catch { /* bỏ qua */ } };

async function fetchRemote() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const info = await res.json();
    return info && typeof info.v === 'string' ? info : null;
  } catch { return null; }
}

function safeToReload() {
  const a = document.activeElement;
  return !document.querySelector('.modal-overlay') && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}

async function applyUpdate(info) {
  setTried(info.v);
  await Promise.all((Array.isArray(info.files) ? info.files : []).map((f) => fetch(f, { cache: 'reload' }).catch(() => null)));
  location.reload();
}

function showBar(info) {
  if (bar || !document.body) return;
  bar = document.createElement('div');
  bar.className = 'upd-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>Có bản cập nhật mới</span><button type="button" class="upd-go">Tải lại</button>';
  bar.querySelector('.upd-go').addEventListener('click', () => { bar.querySelector('.upd-go').disabled = true; applyUpdate(info); });
  document.body.appendChild(bar);
}

export async function checkForUpdate({ auto = false, manual = false } = {}) {
  if (checking) return;
  checking = true;
  try {
    const info = await fetchRemote();
    if (!info) { if (manual) toast('Chưa kiểm tra được — hãy kiểm tra mạng rồi thử lại', 'error'); return; }
    if (info.v === APP_VERSION) {
      if (bar) { bar.remove(); bar = null; }
      if (manual) toast('Bạn đang dùng bản mới nhất', 'success');
      return;
    }
    if (manual) { toast('Đang cập nhật bản mới…'); await applyUpdate(info); return; }
    if (auto && getTried() !== info.v && safeToReload()) { await applyUpdate(info); return; }
    showBar(info);
  } finally { checking = false; }
}

export function initAutoUpdate() {
  setTimeout(() => checkForUpdate({ auto: true }), 2500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > RESUME_AFTER_MS) checkForUpdate({ auto: true });
    hiddenAt = 0;
  });
  setInterval(() => { if (document.visibilityState === 'visible') checkForUpdate(); }, PERIODIC_MS);
}
