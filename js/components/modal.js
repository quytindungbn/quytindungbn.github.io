import { icon } from '../icons.js';

const openOverlays = new Set();

let pendingProgrammaticBacks = 0;
window.addEventListener('popstate', () => {
  if (pendingProgrammaticBacks > 0) { pendingProgrammaticBacks--; return; }
  const entries = [...openOverlays];
  const top = entries[entries.length - 1];
  if (top) top.fromBackButton();
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const entries = [...openOverlays];
  const top = entries[entries.length - 1];
  if (top) top.close();
});

const deferredCloseTimers = [];
function scheduleHistoryBack() {
  const id = setTimeout(() => {
    const idx = deferredCloseTimers.indexOf(id);
    if (idx !== -1) deferredCloseTimers.splice(idx, 1);
    pendingProgrammaticBacks++;
    history.back();
  }, 0);
  deferredCloseTimers.push(id);
}

export function closeAllModals() {
  [...openOverlays].forEach((entry) => entry.cleanupDom());
  openOverlays.clear();

  deferredCloseTimers.splice(0).forEach((id) => clearTimeout(id));
}

export function openModal(opts) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet ${opts.sheetClass || ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${opts.title || ''}</h3>
        <button class="icon-btn" data-close>${icon('x')}</button>
      </div>
      <div class="modal-body">${opts.bodyHtml || ''}</div>
      ${opts.footHtml ? `<div class="modal-foot">${opts.footHtml}</div>` : ''}
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  if (deferredCloseTimers.length) clearTimeout(deferredCloseTimers.shift());
  else history.pushState({ qtdModal: true }, '', location.href);

  let entry;
  function cleanupDom() {
    if (!openOverlays.has(entry)) return;
    openOverlays.delete(entry);
    document.body.style.overflow = openOverlays.size ? document.body.style.overflow : '';
    overlay.remove();
    if (opts.onClose) opts.onClose();
  }

  function close() {
    if (!openOverlays.has(entry)) return;
    cleanupDom();
    scheduleHistoryBack();
  }
  entry = { cleanupDom, fromBackButton: cleanupDom, close };
  openOverlays.add(entry);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('[data-close]').addEventListener('click', close);

  const sheet = overlay.querySelector('.modal-sheet');
  if (opts.onMount) opts.onMount(sheet, close);
  return close;
}

export function confirmDialog({ title, message, confirmLabel = 'Xác nhận', danger = false, onConfirm }) {
  const close = openModal({
    title,
    bodyHtml: `<p style="font-size:14px;color:var(--text-muted);line-height:1.5">${message}</p>`,
    footHtml: `
      <button class="btn btn-outline btn-block" data-cancel>Hủy</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" data-ok>${confirmLabel}</button>
    `,
    onMount(root, closeFn) {
      root.querySelector('[data-cancel]').addEventListener('click', closeFn);
      root.querySelector('[data-ok]').addEventListener('click', () => {
        closeFn();
        onConfirm && onConfirm();
      });
    },
  });
  return close;
}
