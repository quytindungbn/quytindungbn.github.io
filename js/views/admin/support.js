import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { statusBadge, emptyState, openPicker, searchBoxHtml, bindSearchBox } from '../../components/ui.js';
import { toast } from '../../components/toast.js';
import { openChatPanel } from '../../components/chatPanel.js';
import { openCustomerDetail } from './customers.js';
import { formatVND, formatDateTime, initials, colorFor, escapeHtml, stripDiacritics } from '../../utils.js';

// ------------------------------------------------------------
// Trang "Hỗ trợ" — GỘP 2 mục menu cũ ("Yêu cầu tư vấn" + "Hỗ trợ") thành 1,
// hiện dưới dạng 2 tab trong CÙNG 1 trang: "Tư vấn" (yêu cầu tư vấn/vay mới
// — nội dung y hệt trang "Yêu cầu tư vấn" cũ) và "Hỗ trợ" (chat — nội dung y
// hệt trang "Hỗ trợ" cũ). Cả 2 đều có chấm đỏ báo số CHƯA ĐỌC, tự tắt ngay
// khi admin xem xong (xem markAllRequestsRead()/markChatRead() ở state.js).
//
// Tab "Hỗ trợ" CHỈ hiện cho ai có quyền xem chat (super hoặc canManageUsers,
// khớp đúng RLS bảng chat_messages) — nhân viên "chỉ xem" không có quyền
// này thấy đúng nội dung "Tư vấn" y hệt trang cũ, không có tab nào cả (giữ
// nguyên trải nghiệm/phạm vi cũ, chỉ đổi tên + vị trí mục menu).
// ------------------------------------------------------------

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Hỗ trợ' });
}

let activeTab = 'tuvan'; // 'tuvan' | 'hotro'
let activeStatus = 'all'; // bộ lọc trạng thái của tab "Tư vấn"
let searchQuery = ''; // ô tìm kiếm của tab "Hỗ trợ"
// Ghi nhớ ĐÚNG 1 lần "hash?query" gần nhất đã áp dụng tham số ?tab= từ URL
// (VD: link "Xem tất cả" cạnh "Yêu cầu mới nhất" ở trang Tổng quan trỏ tới
// #/admin/ho-tro?tab=tuvan, ép mở đúng tab "Tư vấn" dù đang đứng ở tab
// "Hỗ trợ" trước đó) — CHỈ áp dụng lúc thật sự vừa ĐIỀU HƯỚNG tới (hash đổi),
// không áp dụng lại ở các lượt render() tiếp theo do dữ liệu tự làm mới (hash
// không đổi) — nếu không, mỗi lần notify() sẽ ép quay lại đúng ?tab= cũ, làm
// người dùng không tài nào bấm chuyển sang tab khác được (xem render() bên dưới).
let lastNavKey = null;

/** Reset toàn bộ tab/bộ lọc về mặc định — chỉ gọi từ app.js lúc đổi người đang đăng nhập, xem ghi chú y hệt ở customers.js/zaloOA.js. */
export function resetFilters() {
  activeTab = 'tuvan';
  activeStatus = 'all';
  searchQuery = '';
  lastNavKey = null;
}

// Danh sách hội thoại chat đã tải lần gần nhất — giữ lại để lọc theo ô tìm
// kiếm KHÔNG cần gọi lại server mỗi lần gõ chữ (chỉ tải lại thật khi vào tab
// hoặc vừa đóng 1 khung chat, xem renderConversationList() bên dưới).
let lastConversations = [];

/**
 * Tab "Hỗ trợ" tải dữ liệu KIỂU BẤT ĐỒNG BỘ (khác tab "Tư vấn", vốn chỉ đọc
 * state đã có sẵn) — nếu người dùng chuyển sang trang khác TRONG LÚC đang
 * chờ tải, kết quả trả về muộn có thể đè nhầm lên đúng #app-content/
 * #filter-slot của trang MỚI (2 khối DOM này dùng CHUNG cho mọi trang, xem
 * app.js). Chặn bằng kiểm tra lại hash hiện tại trước khi đụng vào DOM.
 */
function isThisRouteActive() {
  return (location.hash || '#/').split('?')[0] === '#/admin/ho-tro';
}

export async function render(contentEl, filterEl, params, query) {
  if (location.hash !== lastNavKey) {
    lastNavKey = location.hash;
    const tabParam = query?.get('tab');
    if (tabParam === 'tuvan' || tabParam === 'hotro') activeTab = tabParam;
  }

  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  const canChat = S.canManageUsers(admin.id); // trùng đúng điều kiện RLS "admin sees chat"
  if (!canChat) activeTab = 'tuvan'; // phòng hờ mất quyền canManageUsers giữa chừng mà vẫn đang đứng ở tab Hỗ trợ

  renderFilterBar(contentEl, filterEl, admin, canChat);

  if (activeTab === 'hotro') await renderConversationList(contentEl, filterEl);
  else renderRequestsList(contentEl, admin);
}

function renderFilterBar(contentEl, filterEl, admin, canChat) {
  const reqUnread = S.countUnreadRequests(admin.id);
  const chatUnread = S.getState()?.chatUnreadCount || 0;
  const tabsHtml = canChat ? `
    <div class="tabs" style="margin:10px 14px 0">
      <button data-tab="tuvan" class="${activeTab === 'tuvan' ? 'active' : ''}">Tư vấn${reqUnread ? `<span class="tab-badge">${reqUnread}</span>` : ''}</button>
      <button data-tab="hotro" class="${activeTab === 'hotro' ? 'active' : ''}">Hỗ trợ${chatUnread ? `<span class="tab-badge">${chatUnread}</span>` : ''}</button>
    </div>` : '';
  const subFilterHtml = activeTab === 'tuvan' ? `
    <div class="chip-row" style="padding:10px 14px">
      <button class="chip ${activeStatus === 'all' ? 'active' : ''}" data-s="all">Tất cả</button>
      ${S.REQUEST_STATUS.map((s) => `<button class="chip ${activeStatus === s.id ? 'active' : ''}" data-s="${s.id}">${s.label}</button>`).join('')}
    </div>` : `
    <div style="padding:10px 14px">${searchBoxHtml('support-search', 'Tìm theo tên/SĐT khách hàng...', searchQuery)}</div>`;

  filterEl.innerHTML = tabsHtml + subFilterHtml;

  filterEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { activeTab = btn.dataset.tab; render(contentEl, filterEl); });
  });
  if (activeTab === 'tuvan') {
    filterEl.querySelectorAll('[data-s]').forEach((chip) => {
      chip.addEventListener('click', () => { activeStatus = chip.dataset.s; render(contentEl, filterEl); });
    });
  } else {
    // CHỈ lọc lại cục bộ trên lastConversations đã tải sẵn (drawConversationList),
    // KHÔNG gọi lại renderConversationList() (sẽ tải lại server + hiện "Đang
    // tải..." mỗi lần gõ 1 chữ — không cần thiết, dữ liệu đã có sẵn rồi).
    bindSearchBox(filterEl, 'support-search', (v) => { searchQuery = v; drawConversationList(contentEl, filterEl); });
  }
}

// ---------------- Tab "Tư vấn" (yêu cầu tư vấn/vay mới) ----------------
function renderRequestsList(contentEl, admin) {
  const isStaff = admin.role === 'staff';
  let list = S.listRequests({ status: activeStatus });
  if (isStaff) {
    const allowedIds = new Set(S.listCustomers({ adminId: admin.id }).map((c) => c.id));
    list = list.filter((r) => allowedIds.has(r.customerId));
  }
  contentEl.innerHTML = list.length ? list.map((r) => {
    const cust = S.getCustomer(r.customerId);
    return `
    <div class="card order-card" data-id="${r.id}">
      <div class="oc-top">
        <span class="oc-code">${cust ? cust.name : '—'} · ${cust ? cust.phone : ''}</span>
        ${statusBadge(S.REQUEST_STATUS_MAP[r.status])}
      </div>
      <div class="oc-line"><span>Loại</span><b>${S.REQUEST_TYPE.find((t) => t.id === r.type)?.label}</b></div>
      ${r.amount ? `<div class="oc-line"><span>Số tiền</span><b>${formatVND(r.amount)}</b></div>` : ''}
      <div class="oc-line"><span>Nội dung</span><b>${r.note || r.purpose || '—'}</b></div>
      <div class="oc-line"><span>Ngày gửi</span><b>${formatDateTime(r.createdAt)}</b></div>
      <div class="oc-foot">
        ${r.type === 'quen_mat_khau' && cust && !isStaff ? `<button class="link-more" data-reset-pw="${cust.id}" style="border:none;background:none;cursor:pointer;margin-right:12px">Cấp lại mật khẩu →</button>` : ''}
        <button class="link-more" data-update="${r.id}" style="border:none;background:none;cursor:pointer">Cập nhật trạng thái →</button>
      </div>
    </div>`;
  }).join('') : `<div class="card card-pad">${emptyState({ iconName: 'clipboard', title: 'Không có yêu cầu', message: 'Chưa có yêu cầu tư vấn nào phù hợp.' })}</div>`;

  contentEl.querySelectorAll('[data-reset-pw]').forEach((btn) => {
    btn.addEventListener('click', () => openCustomerDetail(btn.dataset.resetPw));
  });
  contentEl.querySelectorAll('[data-update]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openPicker({
        title: 'Cập nhật trạng thái', options: S.REQUEST_STATUS.map((s) => ({ value: s.id, label: s.label })),
        selected: null,
        onSelect: async (val) => {
          try { await S.updateRequestStatus(btn.dataset.update, val); toast('Đã cập nhật trạng thái', 'success'); }
          catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
        },
      });
    });
  });

  // Danh sách đã hiện TRỌN VẸN nội dung từng yêu cầu ngay tại đây (không như
  // tab "Hỗ trợ", chỉ hiện xem trước) — nên coi như admin ĐÃ ĐỌC ngay khi
  // tab này hiện ra, tự tắt chấm đỏ. Không chặn/chờ gì (chạy ngầm).
  S.markAllRequestsRead(admin.id).catch(() => {});
}

// ---------------- Tab "Hỗ trợ" (chat) ----------------
async function renderConversationList(contentEl, filterEl) {
  contentEl.innerHTML = `<div class="card card-pad text-sm text-muted" style="text-align:center">Đang tải...</div>`;
  try {
    lastConversations = await S.listChatConversations();
  } catch (e) {
    if (isThisRouteActive()) contentEl.innerHTML = `<div class="card card-pad">${emptyState({ iconName: 'message', title: 'Không tải được', message: e.message || 'Có lỗi xảy ra, thử lại sau.' })}</div>`;
    return;
  }
  if (!isThisRouteActive()) return;
  drawConversationList(contentEl, filterEl);
}

function drawConversationList(contentEl, filterEl) {
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
        // Đóng khung chat xong tải lại danh sách THẬT (khác drawConversationList()
        // khi gõ tìm kiếm) — để chấm đỏ "chưa đọc" vừa xem xong tự tắt ngay,
        // không cần rời trang rồi quay lại mới thấy đúng.
        onClose: () => { render(contentEl, filterEl); },
      });
    });
  });
}
