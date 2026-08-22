import { icon } from '../icons.js';

const openOverlays = new Set(); // Set<{ cleanupDom(), fromBackButton() }>

// Nút "quay lại" của điện thoại/trình duyệt vốn điều hướng lịch sử TRÌNH
// DUYỆT, không biết gì về modal (modal chỉ là 1 lớp DOM phủ lên trên, không
// nằm trong lịch sử) — nên trước đây bấm "quay lại" khi đang mở modal sẽ
// nhảy thẳng ra khỏi TRANG hiện tại (đổi hash) thay vì đóng modal trước,
// giống hệt "về lại trang đầu" dù người dùng chỉ muốn lùi lại 1 bước. Sửa
// bằng cách cho MỖI modal khi mở tự "chiếm" 1 mục lịch sử (history.pushState)
// — bấm "quay lại" lúc đó sẽ trúng đúng mục này trước, ta bắt được qua sự
// kiện 'popstate' và chỉ đóng ĐÚNG modal trên cùng, không đổi trang.
//
// Đếm số lần chính close() (khi người dùng bấm "x"/backdrop/nút trong modal)
// tự gọi history.back() để giữ lịch sử cân bằng — 'popstate' tương ứng lúc
// đó KHÔNG được đóng nhầm thêm 1 modal nữa (đã đóng đồng bộ ngay trong
// close() rồi, xem hàm đó bên dưới).
let pendingProgrammaticBacks = 0;
window.addEventListener('popstate', () => {
  if (pendingProgrammaticBacks > 0) { pendingProgrammaticBacks--; return; }
  const entries = [...openOverlays];
  const top = entries[entries.length - 1]; // modal mở SAU CÙNG (trên cùng) đóng trước, đúng thứ tự chồng modal
  if (top) top.fromBackButton();
});

/** Đóng toàn bộ modal/bottom-sheet đang mở (dùng khi chuyển trang — hashchange đã tự đổi lịch sử rồi nên ở đây chỉ cần dọn DOM, không lùi lịch sử thêm). */
export function closeAllModals() {
  [...openOverlays].forEach((entry) => entry.cleanupDom());
  openOverlays.clear();
}

/**
 * Mở một modal/bottom-sheet.
 * opts: { title, bodyHtml, footHtml, onMount(root), onClose }
 * Trả về hàm close() — LUÔN gọi được không tham số (kể cả khi gán thẳng làm
 * event handler, VD: `btn.addEventListener('click', closeFn)` — cách dùng
 * phổ biến khắp nơi trong dự án — Event truyền vào bị bỏ qua, không ảnh
 * hưởng gì).
 */
export function openModal(opts) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet" role="dialog" aria-modal="true">
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
  // Chiếm 1 mục lịch sử riêng cho modal này — xem ghi chú ở đầu file.
  history.pushState({ qtdModal: true }, '', location.href);

  let entry; // gán sau khi khai báo cleanupDom/close để 2 hàm đó tham chiếu đúng entry của chính mình
  function cleanupDom() {
    if (!openOverlays.has(entry)) return;
    openOverlays.delete(entry);
    document.body.style.overflow = openOverlays.size ? document.body.style.overflow : '';
    overlay.remove();
    if (opts.onClose) opts.onClose();
  }
  /** Đóng do NGƯỜI DÙNG chủ động (x/backdrop/nút trong modal) hoặc code gọi
   * trực tiếp — dọn DOM NGAY, ĐỒNG BỘ (giữ đúng hành vi cũ để code gọi
   * `closeFn(); làmViệcTiếp()` vẫn chạy đúng thứ tự như trước), rồi tự lùi
   * lại đúng mục lịch sử đã chiếm lúc mở để giữ lịch sử cân bằng. */
  function close() {
    if (!openOverlays.has(entry)) return;
    cleanupDom();
    pendingProgrammaticBacks++;
    history.back();
  }
  entry = { cleanupDom, fromBackButton: cleanupDom };
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
