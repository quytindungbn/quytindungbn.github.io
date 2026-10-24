import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { statusBadge, emptyState, openPicker, searchBoxHtml, bindSearchBox } from '../../components/ui.js';
import { toast } from '../../components/toast.js';
import { openChatPanel, DEFAULT_CHAT_TITLE } from '../../components/chatPanel.js';
import { openCustomerDetail } from './customers.js';
import { formatVND, formatDateTime, initials, colorFor, escapeHtml, stripDiacritics } from '../../utils.js';
import { lsGetJson, lsSetJson } from '../../lib/kvCache.js';

// ------------------------------------------------------------
// Trang "Hỗ trợ" — GỘP 2 mục menu cũ ("Yêu cầu tư vấn" + "Hỗ trợ") thành 1,
// hiện dưới dạng 2 tab trong CÙNG 1 trang. Tên 2 tab CỐ Ý đảo ngược so với
// tên gọi kỹ thuật của từng phần (xem `activeTab` bên dưới) theo đúng yêu
// cầu — "Hỗ trợ" (tab) = danh sách yêu cầu tư vấn/vay mới (mỗi yêu cầu = 1
// lần cần được HỖ TRỢ xử lý), "Tư vấn" (tab) = khung chat (trò chuyện trực
// tiếp = TƯ VẤN cho khách ngay lúc đó) — khớp đúng cách đặt tên trực quan
// hơn theo góc nhìn người dùng, dù bên trong code vẫn gọi 2 phần này là
// 'requests'/'chat' cho dễ đọc (KHÔNG đổi theo tên hiển thị, tránh phải sửa
// lại toàn bộ code mỗi khi đổi tên hiển thị lần nữa).
//
// Cả 2 tab đều có chấm đỏ báo số CHƯA ĐỌC, tự tắt ngay khi admin xem xong
// (xem markAllRequestsRead()/markChatRead() ở state.js).
//
// Tab chat CHỈ hiện cho ai có quyền xem chat (super hoặc canManageUsers,
// khớp đúng RLS bảng chat_messages) — nhân viên "chỉ xem" không có quyền
// này thấy đúng nội dung yêu cầu tư vấn y hệt trang cũ, không có tab nào cả
// (giữ nguyên trải nghiệm/phạm vi cũ, chỉ đổi tên + vị trí mục menu).
// ------------------------------------------------------------

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Hỗ trợ' });
}

let activeTab = 'requests'; // 'requests' (hiển thị "Hỗ trợ") | 'chat' (hiển thị "Tư vấn")
let activeStatus = 'all'; // bộ lọc trạng thái của tab yêu cầu tư vấn
let searchQuery = ''; // ô tìm kiếm của tab chat
// Ghi nhớ ĐÚNG 1 lần "hash?query" gần nhất đã áp dụng tham số ?tab= từ URL
// (VD: link "Xem tất cả" cạnh "Yêu cầu mới nhất" ở trang Tổng quan trỏ tới
// #/admin/ho-tro?tab=requests, ép mở đúng tab yêu cầu tư vấn dù đang đứng ở
// tab chat trước đó) — CHỈ áp dụng lúc thật sự vừa ĐIỀU HƯỚNG tới (hash
// đổi), không áp dụng lại ở các lượt render() tiếp theo do dữ liệu tự làm
// mới (hash không đổi) — nếu không, mỗi lần notify() sẽ ép quay lại đúng
// ?tab= cũ, làm người dùng không tài nào bấm chuyển sang tab khác được (xem
// render() bên dưới).
let lastNavKey = null;

/** Reset toàn bộ tab/bộ lọc về mặc định — chỉ gọi từ app.js lúc đổi người đang đăng nhập, xem ghi chú y hệt ở customers.js/zaloOA.js. */
export function resetFilters() {
  activeTab = 'requests';
  activeStatus = 'all';
  searchQuery = '';
  lastNavKey = null;
  lastConversations = [];
  lastConversationsAt = 0;
}

// Danh sách hội thoại chat đã tải lần gần nhất — giữ lại để lọc theo ô tìm
// kiếm KHÔNG cần gọi lại server mỗi lần gõ chữ (chỉ tải lại thật khi vào tab
// hoặc vừa đóng 1 khung chat, xem renderConversationList() bên dưới).
let lastConversations = [];
// Lần gần nhất tải danh sách hội thoại (0 = chưa tải). Vào lại tab "Tư vấn" thì hiện NGAY danh sách đã có, chỉ tải lại ngầm khi đã cũ hơn CONV_FRESH_MS
// (trước đây mỗi lần vào/mỗi lần dữ liệu làm mới đều hiện "Đang tải..." rồi gọi máy chủ lại từ đầu).
let lastConversationsAt = 0;
let conversationsPromise = null;
const CONV_FRESH_MS = 20000;
// Danh sách hội thoại còn được lưu trên máy (localStorage) theo từng quản trị viên: tải lại trang/vào lại là hiện ngay bản lần trước (kể cả khi
// máy chủ chậm), rồi cập nhật ngầm — trước đây chỉ giữ trong bộ nhớ nên mỗi lần tải lại trang lại phải chờ máy chủ từ đầu.
const convCacheKey = (adminId) => `conv:${adminId}`;
function restoreConversationsCache(adminId) {
  const cached = lsGetJson(convCacheKey(adminId));
  if (!cached || !Array.isArray(cached.rows)) return false;
  lastConversations = cached.rows;
  lastConversationsAt = 1; // coi như đã cũ: hiện bản này ngay rồi tải lại ngầm
  return true;
}

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

/**
 * Có dữ liệu phiên mới nhưng vẫn đứng ở trang này (xem renderApp() trong app.js): chỉ vẽ lại từ dữ liệu đã có — KHÔNG tải lại danh sách
 * hội thoại từ máy chủ trừ khi đã cũ, không nháy "Đang tải...", không đụng ô tìm kiếm đang gõ.
 */
export function refresh(contentEl, filterEl, params, query) {
  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  const canChat = S.canManageUsers(admin.id);
  if (!canChat) activeTab = 'requests';
  if (!filterEl.contains(document.activeElement)) renderFilterBar(contentEl, filterEl, admin, canChat);
  if (activeTab === 'chat') renderConversationList(contentEl, filterEl);
  else renderRequestsList(contentEl, admin);
}

export async function render(contentEl, filterEl, params, query) {
  if (location.hash !== lastNavKey) {
    lastNavKey = location.hash;
    const tabParam = query?.get('tab');
    if (tabParam === 'requests' || tabParam === 'chat') activeTab = tabParam;
  }

  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  const canChat = S.canManageUsers(admin.id); // trùng đúng điều kiện RLS "admin sees chat"
  if (!canChat) activeTab = 'requests'; // phòng hờ mất quyền canManageUsers giữa chừng mà vẫn đang đứng ở tab chat

  renderFilterBar(contentEl, filterEl, admin, canChat);

  if (activeTab === 'chat') await renderConversationList(contentEl, filterEl);
  else renderRequestsList(contentEl, admin);
}

function renderFilterBar(contentEl, filterEl, admin, canChat) {
  const reqUnread = S.countUnreadRequests(admin.id);
  const chatUnread = S.getState()?.chatUnreadCount || 0;
  const tabsHtml = canChat ? `
    <div class="tabs sup-tabs">
      <button data-tab="requests" class="${activeTab === 'requests' ? 'active' : ''}">Hỗ trợ${reqUnread ? `<span class="tab-badge">${reqUnread}</span>` : ''}</button>
      <button data-tab="chat" class="${activeTab === 'chat' ? 'active' : ''}">Tư vấn${chatUnread ? `<span class="tab-badge">${chatUnread}</span>` : ''}</button>
    </div>` : '';
  const subFilterHtml = activeTab === 'requests' ? `
    <div class="chip-row sup-chips">
      <button class="chip ${activeStatus === 'all' ? 'active' : ''}" data-s="all">Tất cả</button>
      ${S.REQUEST_STATUS.map((s) => `<button class="chip ${activeStatus === s.id ? 'active' : ''}" data-s="${s.id}">${s.label}</button>`).join('')}
    </div>` : `
    <div class="sup-search">${searchBoxHtml('support-search', 'Tìm theo tên/SĐT khách hàng...', searchQuery)}</div>`;

  // Cả cụm nút/ô tìm kiếm nằm trong khung cùng lề trái-phải với danh sách bên dưới (xem .sup-align trong styles.css).
  filterEl.innerHTML = `<div class="sup-align">${tabsHtml}${subFilterHtml}</div>`;

  filterEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { activeTab = btn.dataset.tab; render(contentEl, filterEl); });
  });
  if (activeTab === 'requests') {
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

// ---------------- Tab "Hỗ trợ" (yêu cầu tư vấn/vay mới) ----------------
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
    btn.addEventListener('click', () => openCustomerDetail(btn.dataset.resetPw, { showActions: true }));
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
  // tab "Tư vấn" (chat), chỉ hiện xem trước) — nên coi như admin ĐÃ ĐỌC ngay
  // khi tab này hiện ra, tự tắt chấm đỏ. Không chặn/chờ gì (chạy ngầm).
  S.markAllRequestsRead(admin.id).catch(() => {});
}

// ---------------- Tab "Tư vấn" (chat) ----------------
function loadConversations() {
  // Dùng chung một lượt tải đang chạy, không bắn nhiều lượt cùng lúc
  if (!conversationsPromise) {
    const ownerId = S.getSession()?.id;
    conversationsPromise = S.listChatConversations()
      .then((rows) => {
        if (S.getSession()?.id !== ownerId) return rows; // đã đổi/đăng xuất giữa chừng: không ghi đè của người khác
        lastConversations = rows;
        lastConversationsAt = Date.now();
        lsSetJson(convCacheKey(ownerId), { at: lastConversationsAt, rows });
        return rows;
      })
      .finally(() => { conversationsPromise = null; });
  }
  return conversationsPromise;
}

/**
 * Tải sẵn danh sách hội thoại ngầm (app.js gọi sau khi mở app xong) — lúc bấm vào "Tư vấn" thì đã có sẵn. Chỉ làm khi người này xem được chat;
 * lỗi thì bỏ qua (vào tab sẽ tự tải lại và báo lỗi nếu cần).
 */
export function prefetch() {
  const session = S.getSession();
  if (!session || session.role !== 'admin') return;
  const admin = S.getAdmin(session.id);
  if (!admin || !S.canManageUsers(admin.id)) return;
  if (!lastConversationsAt) restoreConversationsCache(session.id);
  if (lastConversationsAt > 1 && Date.now() - lastConversationsAt < CONV_FRESH_MS) return;
  loadConversations().catch(() => {});
}

async function renderConversationList(contentEl, filterEl) {
  if (!lastConversationsAt) restoreConversationsCache(S.getSession()?.id);
  const haveCache = lastConversationsAt > 0;
  if (haveCache) drawConversationList(contentEl, filterEl); // hiện ngay danh sách đã có
  else contentEl.innerHTML = `<div class="card card-pad text-sm text-muted" style="text-align:center">Đang tải...</div>`;
  if (haveCache && Date.now() - lastConversationsAt < CONV_FRESH_MS) return;
  try {
    await loadConversations();
  } catch (e) {
    if (haveCache) return; // tải lại ngầm không được thì cứ giữ danh sách đang hiện
    if (isThisRouteActive()) contentEl.innerHTML = `<div class="card card-pad">${emptyState({ iconName: 'message', title: 'Không tải được', message: e.message || 'Có lỗi xảy ra, thử lại sau.' })}</div>`;
    return;
  }
  if (!isThisRouteActive() || activeTab !== 'chat') return;
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
      openChatPanel(customerId, c?.name || DEFAULT_CHAT_TITLE, {
        // Đóng khung chat xong tải lại danh sách THẬT (khác drawConversationList()
        // khi gõ tìm kiếm) — để chấm đỏ "chưa đọc" vừa xem xong tự tắt ngay,
        // không cần rời trang rồi quay lại mới thấy đúng.
        onClose: () => { lastConversationsAt = 1; render(contentEl, filterEl); }, // đánh dấu danh sách đã cũ -> hiện bản đang có rồi tải lại ngầm
      });
    });
  });
}
