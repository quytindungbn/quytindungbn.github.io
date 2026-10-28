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

export const ADMIN_NAV = [
  { path: '#/admin', label: 'Tổng quan', shortLabel: 'Tổng quan', icon: 'dashboard', group: 'Quản lý' },
  { path: '#/admin/khach-hang', label: 'Khách hàng & Hợp đồng', shortLabel: 'Khách hàng', icon: 'users', group: 'Quản lý' },
];

export const ADMIN_NAV_SUPPORT = [
  { path: '#/admin/ho-tro', label: 'Hỗ trợ', shortLabel: 'Hỗ trợ', icon: 'message', group: 'Chăm sóc khách' },
];

export const ADMIN_NAV_TOOLS = [
  { path: '#/admin/tinh-lai', label: 'Tính lãi vay', shortLabel: 'Tính lãi', icon: 'calculator', group: 'Công cụ' },
];
export const ADMIN_NAV_MANAGE_USERS = [
  { path: '#/admin/nhan-vien', label: 'Quản lý User', shortLabel: 'User', icon: 'idCard', group: 'Hệ thống' },
];

export const ADMIN_NAV_MANAGE_ZALO_OA = [
  { path: '#/admin/zalo-oa', label: 'Quản lý OA', shortLabel: 'Quản lý OA', icon: 'send', group: 'Chăm sóc khách' },
];
export const ADMIN_NAV_BALANCE_SHEET = [
  { path: '#/admin/can-doi-ke-toan', label: 'Quản trị', shortLabel: 'Quản trị', icon: 'chart', group: 'Quản lý' },
];
export const ADMIN_NAV_SUPER_ONLY = [
  { path: '#/admin/cai-dat', label: 'Cài đặt', shortLabel: 'Cài đặt', icon: 'settings', group: 'Hệ thống' },

  { path: '#/admin/nhat-ky', label: 'Nhật ký', shortLabel: 'Nhật ký', icon: 'clock', group: 'Hệ thống' },
];

const BOTTOM_NAV_MAX_DIRECT = 4;

let navPaths = [];
// Thứ tự các menu của tài khoản đang đăng nhập (cùng thứ tự với thanh menu) — dùng cho vuốt chuyển menu trên điện thoại.
export const getNavPaths = () => navPaths;

let navAutoHideBound = false;
function bindBottomNavAutoHide() {
  if (navAutoHideBound) return;
  navAutoHideBound = true;
  const SHOW_ABOVE = 80;
  const STEP = 10;
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

  if (navPath === '#/admin') return current === navPath;
  return current === navPath || current.startsWith(navPath + '/');
}

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

  const nav = role === 'admin'
    ? [...ADMIN_NAV, ...(canViewBalanceSheet ? ADMIN_NAV_BALANCE_SHEET : []), ...(canManageZaloOA ? ADMIN_NAV_MANAGE_ZALO_OA : []), ...ADMIN_NAV_SUPPORT, ...ADMIN_NAV_TOOLS, ...(canManageUsers ? ADMIN_NAV_MANAGE_USERS : []), ...(isSuper ? ADMIN_NAV_SUPER_ONLY : [])]
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
  navPaths = nav.map((item) => item.path);
  renderSidebarNav(nav);
  renderBottomNav(nav);
  bindBottomNavAutoHide();
  renderSidebarProfile();
  document.getElementById('btn-logout-side').addEventListener('click', onLogoutClick);
  const installBtnSide = document.getElementById('btn-install-side');
  if (installBtnSide) bindInstallButton(installBtnSide);
}

export function renderSidebarProfile() {
  const slot = document.getElementById('sidebar-profile-slot');
  if (slot) slot.innerHTML = profileBlockHtml(getProfileInfo());
}

function totalSupportUnread() {
  const session = S.getSession();
  if (!session || session.role !== 'admin') return 0;
  return (S.getState()?.chatUnreadCount || 0) + S.countUnreadRequests(session.id);
}

function dueNotesCount() {
  const session = S.getSession();
  return session && session.role === 'admin' ? S.listDueNotes().length : 0;
}

function unreadBadgeHtml(path, cls = 'nav-badge') {
  const count = path === '#/admin/ho-tro' ? totalSupportUnread() : path === '#/admin' ? dueNotesCount() : 0;
  return count ? `<span class="${cls}${path === '#/admin' ? ' is-due' : ''}">${count > 99 ? '99+' : count}</span>` : '';
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

  el.innerHTML = direct.map((item) => `<a href="${item.path}" data-path="${item.path}">${icon(item.icon)}<span>${item.shortLabel || item.label}</span>${unreadBadgeHtml(item.path, 'bottom-nav-badge')}</a>`).join('')
    + `<button class="more-btn" id="btn-more-bottom" ${supportInMore ? 'data-support-overflow="true"' : ''}>${icon('more')}<span>Thêm</span>${supportInMore ? unreadBadgeHtml('#/admin/ho-tro', 'bottom-nav-badge') : ''}</button>`;
  const moreBtn = document.getElementById('btn-more-bottom');
  if (moreBtn) moreBtn.addEventListener('click', () => openMoreSheet(overflow));
}

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

export function renderChatFab(session) {
  let btn = document.getElementById('chat-fab');
  if (!session || session.role !== 'customer') { if (btn) btn.remove(); return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'chat-fab';
    btn.className = 'fab';
    btn.title = 'Hỗ trợ tư vấn';

    btn.addEventListener('click', () => openChatPanel(btn.dataset.customerId));
    document.body.appendChild(btn);
  }
  btn.dataset.customerId = session.id;
  const unread = S.getState()?.chatUnreadCount || 0;
  btn.innerHTML = `${icon('message', 'icon-sm')}${unread ? `<span class="fab-badge">${unread > 9 ? '9+' : unread}</span>` : ''}`;
}

function setNavBadge(item, count, due = false) {
  const cls = item.closest('#bottom-nav') ? 'bottom-nav-badge' : 'nav-badge';
  let badge = item.querySelector(`.${cls}`);
  if (!count) { if (badge) badge.remove(); return; }
  if (!badge) { badge = document.createElement('span'); badge.className = due ? `${cls} is-due` : cls; item.appendChild(badge); }
  badge.textContent = count > 99 ? '99+' : String(count);
}

export function renderSupportNavBadge() {
  const unread = totalSupportUnread();
  const targets = [...document.querySelectorAll('a[data-path="#/admin/ho-tro"]')];
  const moreBtn = document.querySelector('#btn-more-bottom[data-support-overflow="true"]');
  if (moreBtn) targets.push(moreBtn);
  targets.forEach((item) => setNavBadge(item, unread));
  const due = dueNotesCount();
  document.querySelectorAll('a[data-path="#/admin"]').forEach((item) => setNavBadge(item, due, true));
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
