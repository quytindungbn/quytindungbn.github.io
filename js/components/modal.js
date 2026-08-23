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

// Đóng 1 modal rồi MỞ NGAY modal khác (rất hay gặp trong code: pattern
// `closeFn(); openXyz();` — "thay" modal chứ không phải đóng hẳn) tạo ra 1
// cuộc đua: history.back() của modal cũ là BẤT ĐỒNG BỘ (chỉ thật sự lùi ở 1
// tick sau), trong khi history.pushState() của modal mới chạy NGAY, ĐỒNG BỘ
// — 2 việc lệch pha nhau. Dồn qua vài lượt "thay modal" liên tiếp trong 1
// phiên (VD: xem chi tiết khách hàng -> Sửa -> Lưu), con trỏ lịch sử có thể
// bị lùi QUÁ số bước thật sự cần, tới tận 1 route CŨ khác (khác hash, VD:
// trang Tổng quan lúc mới đăng nhập) — hashchange tự bắn ra ở đó, TRÔNG Y HỆT
// "tự nhảy về trang chủ" dù người dùng chỉ vừa lưu xong 1 form.
//
// Sửa bằng cách HOÃN history.back() sang tick sau (setTimeout 0) thay vì gọi
// ngay trong close() — nếu modal MỚI mở ra kịp trong tick đó (đúng pattern
// closeFn();openXyz()), openModal() sẽ HỦY lượt back() đang hoãn đó và TÁI
// DÙNG đúng mục lịch sử vừa chiếm cho modal mới, khỏi cần push thêm. Nhờ vậy
// dù thay bao nhiêu modal liên tiếp cũng chỉ tốn ĐÚNG 1 mục lịch sử — nút
// "quay lại" vật lý vẫn đóng đúng modal đang hiện + về đúng trang, không lùi
// lố đi đâu cả. Trường hợp đóng modal thường (không mở gì thêm ngay sau) thì
// sau đúng 1 tick hoãn đó, back() vẫn chạy y hệt như trước, không đổi gì.
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

/** Đóng toàn bộ modal/bottom-sheet đang mở (dùng khi chuyển trang — hashchange đã tự đổi lịch sử rồi nên ở đây chỉ cần dọn DOM, không lùi lịch sử thêm). */
export function closeAllModals() {
  [...openOverlays].forEach((entry) => entry.cleanupDom());
  openOverlays.clear();
  // Hủy sạch mọi lượt back() còn đang hoãn (xem scheduleHistoryBack ở trên)
  // — chuyển trang xong rồi mà 1 lượt back() cũ còn treo lại tự chạy thêm
  // sau đó sẽ lùi lịch sử NGOÀI Ý MUỐN khỏi trang vừa chuyển tới.
  deferredCloseTimers.splice(0).forEach((id) => clearTimeout(id));
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
  // Chiếm 1 mục lịch sử riêng cho modal này — xem ghi chú ở đầu file. TRỪ khi
  // có modal khác VỪA đóng ngay trước đó còn đang hoãn lượt back() (pattern
  // `closeFn(); openXyz();`) — khi đó hủy lượt back() đang hoãn, TÁI DÙNG
  // đúng mục lịch sử của modal cũ cho modal này luôn, khỏi push thêm (xem
  // scheduleHistoryBack ở đầu file).
  if (deferredCloseTimers.length) clearTimeout(deferredCloseTimers.shift());
  else history.pushState({ qtdModal: true }, '', location.href);

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
   * `closeFn(); làmViệcTiếp()` vẫn chạy đúng thứ tự như trước), rồi HOÃN lùi
   * lại mục lịch sử đã chiếm lúc mở sang tick sau (xem scheduleHistoryBack). */
  function close() {
    if (!openOverlays.has(entry)) return;
    cleanupDom();
    scheduleHistoryBack();
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
