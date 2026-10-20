import { icon } from '../icons.js';
import { openModal } from './modal.js';
import * as S from '../state.js';
import { initials, colorFor, maskCccd } from '../utils.js';
import { isStandalone } from '../lib/installPwa.js';
import { bindInstallButton } from './installBtn.js';
import { openChatPanel } from './chatPanel.js';

export const CUSTOMER_NAV = [
  { path: '#/', label: 'Trang chủ', shortLabel: 'Trang chủ', icon: 'landmark' },
  { path: '#/yeu-cau-tu-van', label: 'Yêu cầu tư vấn', shortLabel: 'Yêu cầu', icon: 'clipboard' },
  { path: '#/tai-khoan', label: 'Tài khoản', shortLabel: 'Tài khoản', icon: 'idCard' },
];

// `group` = tiêu đề nhóm hiện trên sidebar (máy tính) và trong bảng "Thêm" (điện thoại); các mục cùng nhóm đứng liền nhau.
export const ADMIN_NAV = [
  { path: '#/admin', label: 'Tổng quan', shortLabel: 'Tổng quan', icon: 'dashboard', group: 'Quản lý' },
  { path: '#/admin/khach-hang', label: 'Khách hàng & Hợp đồng', shortLabel: 'Khách hàng', icon: 'users', group: 'Quản lý' },
];
// "Hỗ trợ" gồm hai tab trong cùng trang; luôn hiện cho mọi quản trị viên.
export const ADMIN_NAV_SUPPORT = [
  { path: '#/admin/ho-tro', label: 'Hỗ trợ', shortLabel: 'Hỗ trợ', icon: 'message', group: 'Chăm sóc khách' },
];
// "Quản lý User" hiện ra cho quản trị viên toàn quyền HOẶC nhân viên được
// cấp riêng cờ canManageUsers (xem js/views/admin/staff.js) — không còn
// bó cứng "chỉ toàn quyền" như "Cài đặt" nữa.
export const ADMIN_NAV_MANAGE_USERS = [
  { path: '#/admin/nhan-vien', label: 'Quản lý User', shortLabel: 'User', icon: 'idCard', group: 'Hệ thống' },
];
// "Quản lý OA" hiện ra cho quản trị viên toàn quyền HOẶC nhân viên được cấp
// riêng cờ canManageZaloOA (xem js/state.js) — y hệt kiểu ADMIN_NAV_MANAGE_USERS.
export const ADMIN_NAV_MANAGE_ZALO_OA = [
  { path: '#/admin/zalo-oa', label: 'Quản lý OA', shortLabel: 'Quản lý OA', icon: 'send', group: 'Chăm sóc khách' },
];
export const ADMIN_NAV_BALANCE_SHEET = [
  { path: '#/admin/can-doi-ke-toan', label: 'Quản trị', shortLabel: 'Quản trị', icon: 'chart', group: 'Quản lý' },
];
export const ADMIN_NAV_SUPER_ONLY = [
  { path: '#/admin/cai-dat', label: 'Cài đặt', shortLabel: 'Cài đặt', icon: 'settings', group: 'Hệ thống' },
  // "Nhật ký" ghi lại các thao tác quan trọng của MỌI quản trị viên/nhân
  // viên (đăng nhập, tạo/xóa/sửa tài khoản, xóa hợp đồng, nhập Excel...) —
  // CHỈ quản trị viên toàn quyền mới xem được, chặn ở CẢ nav này (ẩn mục)
  // LẪN RLS thật ở tầng database (xem docs/supabase-migration.md mục
  // 10.33) — ẩn mục ở đây chỉ là tiện cho giao diện, không phải lớp bảo mật
  // thật sự.
  { path: '#/admin/nhat-ky', label: 'Nhật ký', shortLabel: 'Nhật ký', icon: 'clock', group: 'Hệ thống' },
];
// Bốn mục đầu hiện trực tiếp trên điện thoại; các mục sau nằm trong "Thêm".
const BOTTOM_NAV_MAX_DIRECT = 4;

/**
 * Điện thoại: vuốt xuống (đang đọc danh sách) thì thanh menu dưới (Tổng quan,
 * Khách hàng...) tự trượt ẩn để thêm chỗ xem; vuốt lên (hoặc về gần đầu trang,
 * hoặc đổi trang) thì hiện lại. Chỉ gắn 1 lần — thanh menu dùng chung cho mọi
 * trang. Trạng thái nằm ở class "nav-hidden" trên <body> để nút chat nổi và
 * nút "về đầu trang" (đặt theo thanh menu) trượt xuống theo — xem css.
 */
let navAutoHideBound = false;
function bindBottomNavAutoHide() {
  if (navAutoHideBound) return;
  navAutoHideBound = true;
  const SHOW_ABOVE = 80;  // gần đầu trang (px): luôn hiện menu
  const STEP = 10;        // phải vuốt quá ngưỡng này mới đổi, tránh giật khi tay rung nhẹ
  let lastY = window.scrollY;
  const setHidden = (hidden) => document.body.classList.toggle('nav-hidden', hidden);
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y <= SHOW_ABOVE) { setHidden(false); lastY = y; return; }
    const dy = y - lastY;
    if (Math.abs(dy) < STEP) return;
    setHidden(dy > 0);
    lastY = y;
  }, { passive: true });
  window.addEventListener('hashchange', () => { setHidden(false); lastY = window.scrollY; });
}

function matchPath(navPath, current) {
  if (navPath === '#/') return current === '#/' || current === '' || current === '#';
  // "Tổng quan" (#/admin) là tiền tố của MỌI trang quản trị — chỉ sáng khi đúng trang này, không sáng kèm các menu khác.
  if (navPath === '#/admin') return current === navPath;
  return current === navPath || current.startsWith(navPath + '/');
}

/**
 * Thông tin đăng nhập hiện tại (tên, chức danh, tên đăng nhập/CCCD) — dùng
 * cho khối hồ sơ ở sidebar (desktop) và bảng "Thêm" (mobile), để người dùng
 * luôn thấy mình đang đăng nhập bằng tài khoản nào + vai trò gì.
 */
function getProfileInfo() {
  const session = S.getSession();
  if (!session) return null;
  if (session.role === 'admin') {
    const admin = S.getAdmin(session.id);
    if (!admin) return null;
    const roleLabel = admin.role === 'super' ? 'Quản trị viên toàn quyền'
      : admin.canManageUsers ? 'Quản trị viên chỉ xem · Quản lý User' : 'Quản trị viên chỉ xem';
    return {
      name: admin.name,
      roleLabel,
      loginId: '@' + admin.username,
      seed: admin.id,
    };
  }
  const customer = S.getCustomer(session.id);
  if (!customer) return null;
  return {
    name: customer.name,
    roleLabel: 'Khách hàng',
    loginId: `CCCD ${maskCccd(customer.cccd)}`,
    seed: customer.id,
  };
}

function profileBlockHtml(info) {
  if (!info) return '';
  return `
    <div class="sidebar-profile">
      <div class="row-thumb" style="width:38px;height:38px;font-size:14px;background:${colorFor(info.seed)}">${initials(info.name)}</div>
      <div class="row-main">
        <div class="row-title">${info.name}</div>
        <div class="row-sub">${info.roleLabel} · ${info.loginId}</div>
      </div>
    </div>
  `;
}

export function buildShell(root, role, isSuper, canManageUsers, canManageZaloOA, canViewBalanceSheet = false) {
  // Giữ nguyên quyền truy cập; chỉ sắp thứ tự: Tổng quan, Khách hàng,
  // Quản trị, Quản lý OA, Hỗ trợ, Quản lý User, rồi Cài đặt/Nhật ký.
  const nav = role === 'admin'
    ? [...ADMIN_NAV, ...(canViewBalanceSheet ? ADMIN_NAV_BALANCE_SHEET : []), ...(canManageZaloOA ? ADMIN_NAV_MANAGE_ZALO_OA : []), ...ADMIN_NAV_SUPPORT, ...(canManageUsers ? ADMIN_NAV_MANAGE_USERS : []), ...(isSuper ? ADMIN_NAV_SUPER_ONLY : [])]
    : CUSTOMER_NAV;
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="logo-mark">${icon('landmark')}</div>
          <div>
            <strong id="brand-name">QTD Bình Nguyên</strong>
            <span>${role === 'admin' ? 'Trang quản trị' : 'Cổng khách hàng'}</span>
          </div>
        </div>
        <nav class="sidebar-nav" id="sidebar-nav"></nav>
        <div class="sidebar-foot">
          <div id="sidebar-profile-slot"></div>
          <div class="sidebar-tools">
            ${!isStandalone() ? `<button type="button" class="sidebar-tool" id="btn-install-side" title="Cài ứng dụng" aria-label="Cài ứng dụng">${icon('download')}</button>` : ''}
            <a href="#/doi-mat-khau" class="sidebar-tool" title="Đổi mật khẩu" aria-label="Đổi mật khẩu">${icon('lock')}</a>
            <button type="button" class="sidebar-tool" id="btn-logout-side" title="Đăng xuất" aria-label="Đăng xuất">${icon('logout')}</button>
          </div>
        </div>
      </aside>
      <div class="main-col">
        <header class="app-header" id="app-header"></header>
        <div id="filter-slot"></div>
        <main class="app-content" id="app-content"></main>
      </div>
      <nav class="bottom-nav" id="bottom-nav"></nav>
    </div>
  `;
  renderSidebarNav(nav);
  renderBottomNav(nav);
  bindBottomNavAutoHide();
  renderSidebarProfile();
  document.getElementById('btn-logout-side').addEventListener('click', onLogoutClick);
  const installBtnSide = document.getElementById('btn-install-side');
  if (installBtnSide) bindInstallButton(installBtnSide);
}

/**
 * Vẽ lại riêng khối hồ sơ (tên/chức danh/tên đăng nhập) ở sidebar — gọi lại
 * ở MỌI lần render trang (không chỉ lúc buildShell dựng khung mới), vì
 * shellKey ở app.js chỉ đổi khi role/isSuper đổi: 2 tài khoản CÙNG vai trò
 * đăng nhập nối tiếp nhau (VD: nhân viên A đăng xuất, nhân viên B đăng nhập)
 * sẽ dùng chung 1 khung sidebar đã dựng sẵn — nếu không refresh riêng khối
 * này thì vẫn hiện tên/tài khoản của người TRƯỚC.
 */
export function renderSidebarProfile() {
  const slot = document.getElementById('sidebar-profile-slot');
  if (slot) slot.innerHTML = profileBlockHtml(getProfileInfo());
}

/**
 * Tổng số CHƯA ĐỌC gộp chung của mục "Hỗ trợ" (GỘP 2 tab "Tư vấn" + "Hỗ trợ"
 * chat, xem js/views/admin/support.js) — chat + yêu cầu tư vấn cộng lại,
 * đọc trực tiếp state.chatUnreadCount/state.requests (đã tải kèm lúc
 * loadAdminSessionData()/refreshSessionData(), xem js/state.js), KHÔNG gọi
 * mạng riêng gì thêm ở đây.
 */
function totalSupportUnread() {
  const session = S.getSession();
  if (!session || session.role !== 'admin') return 0;
  return (S.getState()?.chatUnreadCount || 0) + S.countUnreadRequests(session.id);
}

/** Chấm đỏ gắn cho đúng mục "Hỗ trợ" (path #/admin/ho-tro) — dùng chung cho sidebar, bảng "Thêm" (mobile), xem renderSidebarNav/openMoreSheet. `cls` khác nhau tùy vị trí đặt (xem CSS .nav-badge/.bottom-nav-badge). */
function unreadBadgeHtml(path, cls = 'nav-badge') {
  if (path !== '#/admin/ho-tro') return '';
  const unread = totalSupportUnread();
  return unread ? `<span class="${cls}">${unread > 99 ? '99+' : unread}</span>` : '';
}

function renderSidebarNav(nav) {
  const el = document.getElementById('sidebar-nav');
  let lastGroup = '';
  el.innerHTML = nav.map((item) => {
    const title = item.group && item.group !== lastGroup ? `<div class="nav-group-title">${item.group}</div>` : '';
    lastGroup = item.group || lastGroup;
    return `${title}<a href="${item.path}" data-path="${item.path}">${icon(item.icon)}<span>${item.label}</span>${unreadBadgeHtml(item.path)}</a>`;
  }).join('');
}

const CHANGE_PW_ITEM = { path: '#/doi-mat-khau', label: 'Đổi mật khẩu', icon: 'lock', group: 'Tài khoản' };

function renderBottomNav(nav) {
  const el = document.getElementById('bottom-nav');
  const direct = nav.slice(0, BOTTOM_NAV_MAX_DIRECT);
  const overflow = [...nav.slice(BOTTOM_NAV_MAX_DIRECT), CHANGE_PW_ITEM];
  const supportInMore = overflow.some((item) => item.path === '#/admin/ho-tro');
  // Luôn còn ít nhất "Đổi mật khẩu" trong "Thêm" nên nút Thêm luôn hiện trên mobile.
  el.innerHTML = direct.map((item) => `<a href="${item.path}" data-path="${item.path}">${icon(item.icon)}<span>${item.shortLabel || item.label}</span>${unreadBadgeHtml(item.path, 'bottom-nav-badge')}</a>`).join('')
    + `<button class="more-btn" id="btn-more-bottom" ${supportInMore ? 'data-support-overflow="true"' : ''}>${icon('more')}<span>Thêm</span>${supportInMore ? unreadBadgeHtml('#/admin/ho-tro', 'bottom-nav-badge') : ''}</button>`;
  const moreBtn = document.getElementById('btn-more-bottom');
  if (moreBtn) moreBtn.addEventListener('click', () => openMoreSheet(overflow));
}

/** Bảng "Thêm" — gộp các mục menu còn lại + Đổi mật khẩu + Đăng xuất, tránh nhồi quá nhiều mục vào 1 hàng menu. */
function openMoreSheet(overflowItems) {
  let lastGroup = '';
  openModal({
    title: 'Thêm',
    sheetClass: 'more-sheet',
    bodyHtml: `
      ${profileBlockHtml(getProfileInfo())}
      <div class="more-list">
        ${overflowItems.map((item) => {
          const title = item.group && item.group !== lastGroup ? `<div class="more-group">${item.group}</div>` : '';
          lastGroup = item.group || lastGroup;
          return `${title}
          <a href="${item.path}" data-path="${item.path}" class="list-row">
            <div class="row-thumb">${icon(item.icon, 'icon-sm')}</div>
            <div class="row-main"><div class="row-title">${item.label}</div></div>
            ${unreadBadgeHtml(item.path)}
          </a>`;
        }).join('')}
      </div>
    `,
    footHtml: `
      ${!isStandalone() ? `<button class="btn btn-outline btn-block" id="sheet-install">${icon('download', 'icon-sm')} Cài ứng dụng</button>` : ''}
      <button class="btn btn-outline btn-block" id="sheet-logout">${icon('logout', 'icon-sm')} Đăng xuất</button>
    `,
    onMount(sheet, closeFn) {
      // KHÔNG gắn closeFn (đóng modal kiểu có history.back()) cho các link
      // điều hướng #/... — click vào <a href> đã tự đổi hash (tự đẩy 1 mục
      // lịch sử mới) rồi, nếu đồng thời closeFn cũng gọi history.back() thì
      // 2 thao tác đổi lịch sử này đá nhau, có thể khiến việc chuyển trang bị
      // hủy/lùi ngược lại — đúng lỗi "bấm mục trong Thêm không vào được".
      // Bảng "Thêm" vẫn tự đóng bình thường vì app.js đã gọi closeAllModals()
      // (chỉ dọn DOM, không đụng lịch sử) mỗi khi hashchange.
      sheet.querySelector('#sheet-logout').addEventListener('click', () => { closeFn(); onLogoutClick(); });
      const installBtn = sheet.querySelector('#sheet-install');
      if (installBtn) bindInstallButton(installBtn);
    },
  });
}

function onLogoutClick() {
  openModal({
    title: 'Đăng xuất?',
    bodyHtml: `<p style="font-size:14px;color:var(--text-muted)">Bạn sẽ cần đăng nhập lại để tiếp tục sử dụng.</p>`,
    footHtml: `
      <button class="btn btn-outline btn-block" data-cancel>Hủy</button>
      <button class="btn btn-primary btn-block" data-ok>Đăng xuất</button>
    `,
    onMount(root, close) {
      root.querySelector('[data-cancel]').addEventListener('click', close);
      root.querySelector('[data-ok]').addEventListener('click', () => {
        close();
        window.dispatchEvent(new CustomEvent('qtd:logout'));
      });
    },
  });
}

/**
 * Nút chat nổi "Hỗ trợ" — CHỈ hiện cho khách hàng (quản trị viên/nhân viên có
 * trang "Hỗ trợ" riêng trong menu, xem ADMIN_NAV_MANAGE_USERS), ở MỌI trang
 * (không phải 1 route riêng) kèm chấm đỏ số tin nhắn chưa đọc. Gọi lại ở MỌI
 * lần renderApp() (kể cả dataOnly, xem app.js) để số chưa đọc luôn đúng theo
 * dữ liệu mới nhất (tải qua state.chatUnreadCount cùng lúc với
 * refreshSessionData(), không cần polling riêng gì thêm ở đây) — nút chỉ
 * TẠO 1 lần, các lần sau chỉ cập nhật lại số.
 */
export function renderChatFab(session) {
  let btn = document.getElementById('chat-fab');
  if (!session || session.role !== 'customer') { if (btn) btn.remove(); return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'chat-fab';
    btn.className = 'fab';
    btn.title = 'Hỗ trợ tư vấn';
    // Đọc customerId từ dataset (gán lại MỖI lần dưới đây) thay vì đóng kín
    // trong closure lúc tạo nút — nút chỉ tạo 1 LẦN DUY NHẤT rồi tái dùng ở
    // mọi lần gọi sau (xem if (!btn) ở trên), closure session.id lúc tạo sẽ
    // bị "đông cứng" nếu lỡ có 2 khách hàng nối tiếp dùng chung 1 nút (dù
    // thực tế luôn đi qua nhánh !session dọn nút giữa 2 lượt đăng nhập, vẫn
    // phòng hờ cho chắc).
    // KHÔNG truyền title cụ thể — để openChatPanel() tự dùng tiêu đề mặc định
    // của chính nó (DEFAULT_CHAT_TITLE trong chatPanel.js, "Hỗ trợ tư vấn") —
    // 1 nguồn duy nhất, khỏi phải sửa 2 chỗ mỗi lần đổi chữ.
    btn.addEventListener('click', () => openChatPanel(btn.dataset.customerId));
    document.body.appendChild(btn);
  }
  btn.dataset.customerId = session.id;
  const unread = S.getState()?.chatUnreadCount || 0;
  btn.innerHTML = `${icon('message', 'icon-sm')}${unread ? `<span class="fab-badge">${unread > 9 ? '9+' : unread}</span>` : ''}`;
}

/**
 * Cập nhật lại chấm đỏ số tin CHƯA ĐỌC ở mục menu "Hỗ trợ" và nút "Thêm"
 * — mục này chỉ được DỰNG LẠI (renderSidebarNav) lúc buildShell() chạy (đổi
 * role/quyền), không phải mỗi lần render() như renderChatFab, nên cần hàm
 * riêng gọi lại ở MỌI lần renderApp() (xem app.js) để số luôn đúng theo dữ
 * liệu mới nhất — chỉ SỬA lại đúng span đã có sẵn, không vẽ lại cả mục menu.
 */
export function renderSupportNavBadge() {
  const unread = totalSupportUnread();
  const targets = [...document.querySelectorAll('a[data-path="#/admin/ho-tro"]')];
  const moreBtn = document.querySelector('#btn-more-bottom[data-support-overflow="true"]');
  if (moreBtn) targets.push(moreBtn);
  targets.forEach((item) => {
    const cls = item.closest('#bottom-nav') ? 'bottom-nav-badge' : 'nav-badge';
    let badge = item.querySelector(`.${cls}`);
    if (!unread) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = cls; item.appendChild(badge); }
    badge.textContent = unread > 99 ? '99+' : String(unread);
  });
}

export function updateActiveNav(hash) {
  document.querySelectorAll('.sidebar-nav a, .bottom-nav a').forEach((a) => {
    a.classList.toggle('active', matchPath(a.dataset.path, hash));
  });
}

export function pageHeader({ title, back, actions = [] }) {
  return `
    <div class="flex items-center gap-8" style="width:100%">
      ${back ? `<button class="icon-btn back-btn" id="btn-back">${icon('arrowLeft')}</button>` : `<div class="avatar">${icon('landmark', 'icon-sm')}</div>`}
      <h1>${title}</h1>
      <div class="header-actions">
        ${actions.map((a) => `<button class="icon-btn" data-action="${a.action}">${icon(a.icon)}</button>`).join('')}
      </div>
    </div>
  `;
}
export function bindHeaderActions(headerEl, handlers) {
  const backBtn = headerEl.querySelector('#btn-back');
  if (backBtn && handlers.back) backBtn.addEventListener('click', handlers.back);
  headerEl.querySelectorAll('[data-action]').forEach((btn) => {
    const act = btn.dataset.action;
    if (handlers[act]) btn.addEventListener('click', handlers[act]);
  });
}
