import { icon } from '../icons.js';
import { openModal } from './modal.js';
import * as S from '../state.js';
import { initials, colorFor, maskCccd, escapeHtml } from '../utils.js';
import { isStandalone } from '../lib/installPwa.js';
import { bindInstallButton } from './installBtn.js';
import { openChatPanel } from './chatPanel.js';
import { appVersionLabel, checkForUpdate } from '../lib/update.js';
import { diagLog, diagReport } from '../lib/diag.js';

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
export const getNavPaths = () => navPaths;

let navAutoHideBound = false;
let navLockUntil = 0;
let navArmed = null;
export const lockNavAutoHide = (ms = 900) => { navLockUntil = Math.max(navLockUntil, Date.now() + ms); };
function setNavHidden(hidden, why = '') {
  const was = document.body.classList.contains('nav-hidden');
  document.body.classList.toggle('nav-hidden', hidden);
  if (was !== hidden) diagLog(hidden ? 'thanh menu ẨN' : 'thanh menu HIỆN', why);
}
export const showBottomNav = (ms = 1500, why = 'showBottomNav') => { navArmed = null; lockNavAutoHide(ms); setNavHidden(false, why); };
const hideBottomNav = (why) => { if (Date.now() >= navLockUntil) setNavHidden(true, why); };
function bindBottomNavAutoHide() {
  if (navAutoHideBound) return;
  navAutoHideBound = true;
  const SHOW_ABOVE = 80;
  const HIDE_AFTER = 48;
  const HIDE_LIVE = 140;
  const SHOW_AFTER = 14;
  const SCROLLED = 24;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let lastY = window.scrollY;
  let lastTouch = 0;
  let g = null;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y <= SHOW_ABOVE) { setNavHidden(false, 'đầu trang'); lastY = y; return; }
    if (navArmed) {
      if (Date.now() > navArmed.until) navArmed = null;
      else if (y - navArmed.sy >= SCROLLED) { navArmed = null; hideBottomNav('cuộn xuống'); return; }
    }
    if (!fine || Date.now() - lastTouch < 3000) return;
    if (Date.now() < navLockUntil) { lastY = y; return; }
    const dy = y - lastY;
    if (Math.abs(dy) < 10) return;
    lastY = y;
    setNavHidden(dy > 0, 'cuộn chuột');
  }, { passive: true });
  window.addEventListener('touchstart', (e) => {
    lastTouch = Date.now();
    navArmed = null;
    const t = e.touches[0];
    g = e.touches.length === 1 && !e.target.closest('.modal-overlay') ? { x0: t.clientX, y0: t.clientY, minY: t.clientY, side: false, sy: window.scrollY, at: lastTouch } : null;
    if (g) diagLog('chạm', `x=${Math.round(t.clientX)} y=${Math.round(t.clientY)} cuộn=${Math.round(window.scrollY)}`);
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    lastTouch = Date.now();
    if (!g || e.touches.length !== 1) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - g.x0;
    const dy = y - g.y0;
    if (!g.side && Math.abs(dx) >= 16 && Math.abs(dx) >= Math.abs(dy)) { g.side = true; diagLog('ngón đi ngang', `dx=${Math.round(dx)} dy=${Math.round(dy)}`); }
    if (g.side) { showBottomNav(1500, 'vuốt ngang'); return; }
    g.minY = Math.min(g.minY, y);
    const up = g.y0 - g.minY;
    if (y - g.minY >= SHOW_AFTER) setNavHidden(false, 'ngón đi xuống');
    else if (up >= HIDE_LIVE && Math.abs(dx) * 4 <= up && window.scrollY > SHOW_ABOVE) hideBottomNav('kéo dọc dài');
  }, { passive: true });
  const endTouch = (e) => {
    lastTouch = Date.now();
    const s = g;
    g = null;
    if (!s) return;
    const t = e.changedTouches && e.changedTouches[0];
    const dx = t ? t.clientX - s.x0 : 0;
    const dy = t ? t.clientY - s.y0 : 0;
    diagLog(e.type === 'touchcancel' ? 'hủy chạm' : 'nhấc tay', `dx=${Math.round(dx)} dy=${Math.round(dy)} ${lastTouch - s.at}ms cuộn ${Math.round(s.sy)}→${Math.round(window.scrollY)}${s.side ? ' ngang' : ''}`);
    if (e.type === 'touchcancel') return;
    if (s.side) { showBottomNav(1500, 'vuốt ngang'); return; }
    const up = s.y0 - s.minY;
    if (!t || up < HIDE_AFTER || t.clientY - s.minY >= SHOW_AFTER || Math.abs(dx) > 0.6 * up) return;
    if (window.scrollY - s.sy >= SCROLLED && window.scrollY > SHOW_ABOVE) hideBottomNav('cuộn xuống');
    else navArmed = { sy: s.sy, until: Date.now() + 700 };
  };
  window.addEventListener('touchend', endTouch, { passive: true });
  window.addEventListener('touchcancel', endTouch, { passive: true });
  window.addEventListener('hashchange', () => { navArmed = null; setNavHidden(false, 'đổi trang'); lastY = window.scrollY; });
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
          <button type="button" class="app-ver" data-app-ver title="Kiểm tra cập nhật">Phiên bản ${appVersionLabel()}</button>
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
  root.querySelectorAll('[data-app-ver]').forEach(bindVersionButton);
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
      <button type="button" class="app-ver" data-app-ver>Phiên bản ${appVersionLabel()} · Kiểm tra cập nhật</button>
    `,
    footHtml: `
      ${!isStandalone() ? `<button class="btn btn-outline btn-block" id="sheet-install">${icon('download', 'icon-sm')} Cài ứng dụng</button>` : ''}
      <button class="btn btn-outline btn-block" id="sheet-logout">${icon('logout', 'icon-sm')} Đăng xuất</button>
    `,
    onMount(sheet, closeFn) {

      sheet.querySelector('#sheet-logout').addEventListener('click', () => { closeFn(); onLogoutClick(); });
      bindVersionButton(sheet.querySelector('[data-app-ver]'));
      const installBtn = sheet.querySelector('#sheet-install');
      if (installBtn) bindInstallButton(installBtn);
    },
  });
}

function openDiag() {
  const text = diagReport();
  openModal({
    title: 'Chẩn đoán',
    sheetClass: 'diag-sheet',
    bodyHtml: `<pre class="diag-pre">${escapeHtml(text)}</pre>`,
    footHtml: '<button type="button" class="btn btn-outline btn-block" data-diag-copy>Sao chép</button>',
    onMount(sheet) {
      const btn = sheet.querySelector('[data-diag-copy]');
      btn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text); btn.textContent = 'Đã sao chép'; } catch {
          const r = document.createRange();
          r.selectNodeContents(sheet.querySelector('.diag-pre'));
          const sel = getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          btn.textContent = 'Đã chọn chữ — sao chép bằng máy';
        }
      });
    },
  });
}

function bindVersionButton(btn) {
  let timer = 0;
  let long = false;
  btn.addEventListener('pointerdown', () => { long = false; clearTimeout(timer); timer = setTimeout(() => { long = true; openDiag(); }, 800); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, () => clearTimeout(timer)));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('click', () => { if (long) { long = false; return; } checkForUpdate({ manual: true }); });
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
