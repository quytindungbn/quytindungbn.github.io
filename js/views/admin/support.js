import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { statusBadge, emptyState, openPicker, searchBoxHtml, bindSearchBox } from '../../components/ui.js';
import { toast } from '../../components/toast.js';
import { openChatPanel, DEFAULT_CHAT_TITLE } from '../../components/chatPanel.js';
import { openCustomerDetail } from './customers.js';
import { formatVND, formatDateTime, initials, colorFor, escapeHtml, stripDiacritics } from '../../utils.js';
import { lsGetJson, lsSetJson } from '../../lib/kvCache.js';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Hỗ trợ' });
}

let activeTab = 'requests';
let activeStatus = 'all';
let searchQuery = '';

let lastNavKey = null;

export function resetFilters() {
  activeTab = 'requests';
  activeStatus = 'all';
  searchQuery = '';
  lastNavKey = null;
  lastConversations = [];
  lastConversationsAt = 0;
}

let lastConversations = [];

let lastConversationsAt = 0;
let conversationsPromise = null;
const CONV_FRESH_MS = 20000;

const convCacheKey = (adminId) => `conv:${adminId}`;
function restoreConversationsCache(adminId) {
  const cached = lsGetJson(convCacheKey(adminId));
  if (!cached || !Array.isArray(cached.rows)) return false;
  lastConversations = cached.rows;
  lastConversationsAt = 1;
  return true;
}

function isThisRouteActive() {
  return (location.hash || '#/').split('?')[0] === '#/admin/ho-tro';
}

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
  const canChat = S.canManageUsers(admin.id);
  if (!canChat) activeTab = 'requests';

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

  filterEl.innerHTML = `<div class="sup-align">${tabsHtml}${subFilterHtml}</div>`;

  filterEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { activeTab = btn.dataset.tab; render(contentEl, filterEl); });
  });
  if (activeTab === 'requests') {
    filterEl.querySelectorAll('[data-s]').forEach((chip) => {
      chip.addEventListener('click', () => { activeStatus = chip.dataset.s; render(contentEl, filterEl); });
    });
  } else {

    bindSearchBox(filterEl, 'support-search', (v) => { searchQuery = v; drawConversationList(contentEl, filterEl); });
  }
}

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

  S.markAllRequestsRead(admin.id).catch(() => {});
}

function loadConversations() {

  if (!conversationsPromise) {
    const ownerId = S.getSession()?.id;
    conversationsPromise = S.listChatConversations()
      .then((rows) => {
        if (S.getSession()?.id !== ownerId) return rows;
        lastConversations = rows;
        lastConversationsAt = Date.now();
        lsSetJson(convCacheKey(ownerId), { at: lastConversationsAt, rows });
        return rows;
      })
      .finally(() => { conversationsPromise = null; });
  }
  return conversationsPromise;
}

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
  if (haveCache) drawConversationList(contentEl, filterEl);
  else contentEl.innerHTML = `<div class="card card-pad text-sm text-muted" style="text-align:center">Đang tải...</div>`;
  if (haveCache && Date.now() - lastConversationsAt < CONV_FRESH_MS) return;
  try {
    await loadConversations();
  } catch (e) {
    if (haveCache) return;
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

        onClose: () => { lastConversationsAt = 1; render(contentEl, filterEl); },
      });
    });
  });
}
