import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { emptyState, searchBoxHtml, bindSearchBox } from '../../components/ui.js';
import { openChatPanel } from '../../components/chatPanel.js';
import { initials, colorFor, formatDateTime, escapeHtml, stripDiacritics } from '../../utils.js';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Hỗ trợ' });
}

let searchQuery = '';
/** Reset ô tìm kiếm — chỉ gọi từ app.js lúc đổi người đang đăng nhập, xem ghi chú y hệt ở customers.js/requests.js/zaloOA.js. */
export function resetFilters() {
  searchQuery = '';
}

// Danh sách hội thoại đã tải lần gần nhất — giữ lại để lọc theo ô tìm kiếm
// KHÔNG cần gọi lại server mỗi lần gõ chữ (chỉ tải lại thật khi vào trang
// hoặc vừa đóng 1 khung chat, xem renderList() bên dưới).
let lastConversations = [];

/**
 * render() tải dữ liệu KIỂU BẤT ĐỒNG BỘ (khác mọi view khác trong app, vốn
 * chỉ đọc state đã có sẵn) — nếu người dùng chuyển sang trang khác (hoặc
 * đóng khung chat, xem onClose bên dưới) TRONG LÚC đang chờ tải, kết quả trả
 * về muộn có thể đè nhầm lên đúng #app-content/#filter-slot của trang MỚI
 * (2 khối DOM này dùng CHUNG cho mọi trang, xem app.js). Chặn bằng kiểm tra
 * lại hash hiện tại còn đúng là "Hỗ trợ" hay không trước khi đụng vào DOM ở
 * mỗi bước (đầu hàm + sau mỗi lần await).
 */
function isThisRouteActive() {
  return (location.hash || '#/').split('?')[0] === '#/admin/ho-tro';
}

export async function render(contentEl, filterEl) {
  if (!isThisRouteActive()) return;
  filterEl.innerHTML = `<div style="padding:10px 14px">${searchBoxHtml('support-search', 'Tìm theo tên/SĐT khách hàng...', searchQuery)}</div>`;
  bindSearchBox(filterEl, 'support-search', (v) => { searchQuery = v; renderList(contentEl, filterEl); });

  contentEl.innerHTML = `<div class="card card-pad text-sm text-muted" style="text-align:center">Đang tải...</div>`;
  try {
    lastConversations = await S.listChatConversations();
  } catch (e) {
    if (isThisRouteActive()) contentEl.innerHTML = `<div class="card card-pad">${emptyState({ iconName: 'message', title: 'Không tải được', message: e.message || 'Có lỗi xảy ra, thử lại sau.' })}</div>`;
    return;
  }
  if (!isThisRouteActive()) return;
  renderList(contentEl, filterEl);
}

function renderList(contentEl, filterEl) {
  const q = stripDiacritics(searchQuery.trim().toLowerCase());
  const rows = lastConversations.filter((conv) => {
    if (!q) return true;
    const c = S.getCustomer(conv.customerId);
    const hay = stripDiacritics(`${c?.name || ''} ${c?.phone || ''}`.toLowerCase());
    return hay.includes(q);
  });

  contentEl.innerHTML = rows.length ? rows.map((conv) => {
    const c = S.getCustomer(conv.customerId);
    const name = c?.name || 'Khách hàng đã xóa';
    return `
    <div class="card order-card" data-id="${conv.customerId}" style="cursor:pointer">
      <div class="flex items-center gap-10">
        <div class="row-thumb" style="width:40px;height:40px;font-size:14px;background:${colorFor(conv.customerId)};flex:none">${initials(name)}</div>
        <div style="min-width:0;flex:1">
          <div class="flex items-center gap-8">
            <span class="fw-700" style="font-size:14px">${name}</span>
            ${conv.unreadCount ? `<span class="badge badge-red">${conv.unreadCount}</span>` : ''}
          </div>
          <div class="text-sm text-muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${conv.lastSenderRole === 'admin' ? 'Bạn: ' : ''}${escapeHtml(conv.lastMessage)}</div>
        </div>
        <div class="text-sm text-muted" style="flex:none;white-space:nowrap">${formatDateTime(conv.lastAt)}</div>
      </div>
    </div>`;
  }).join('') : `<div class="card card-pad">${emptyState({
    iconName: 'message',
    title: q ? 'Không tìm thấy' : 'Chưa có hội thoại nào',
    message: q ? 'Không có khách hàng nào khớp tìm kiếm.' : 'Khi khách hàng gửi tin nhắn hỗ trợ qua nút chat, hội thoại sẽ hiện ở đây.',
  })}</div>`;

  contentEl.querySelectorAll('[data-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const customerId = row.dataset.id;
      const c = S.getCustomer(customerId);
      openChatPanel(customerId, c?.name || 'Hỗ trợ', {
        // Đóng khung chat xong tải lại danh sách THẬT (khác renderList() khi gõ
        // tìm kiếm) — để chấm đỏ "chưa đọc" vừa xem xong tự tắt ngay, không
        // cần rời trang rồi quay lại mới thấy đúng.
        onClose: () => { render(contentEl, filterEl); },
      });
    });
  });
}
