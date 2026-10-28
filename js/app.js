import * as S from './state.js';
import { buildShell, getNavPaths, lockNavAutoHide, updateActiveNav, renderSidebarProfile, renderChatFab, renderSupportNavBadge, ADMIN_NAV, ADMIN_NAV_SUPPORT, ADMIN_NAV_TOOLS, ADMIN_NAV_MANAGE_USERS, ADMIN_NAV_MANAGE_ZALO_OA, ADMIN_NAV_BALANCE_SHEET, ADMIN_NAV_SUPER_ONLY } from './components/shell.js';
import { closeAllModals } from './components/modal.js';
import { toast } from './components/toast.js';
import { registerServiceWorker, autoSubscribeIfPossible } from './lib/push.js';
import './lib/installPwa.js';
import { initAutoInstallPrompt } from './components/installBtn.js';
import { renderLogin } from './views/login.js';
import { renderChangePassword } from './views/changePassword.js';

import * as Dashboard from './views/dashboard.js';
import * as ContractDetail from './views/contractDetail.js';
import * as RequestForm from './views/requestForm.js';
import * as Account from './views/account.js';
import * as ChangePasswordSelf from './views/changePasswordSelf.js';
import * as AdminOverview from './views/admin/overview.js';
import * as AdminCustomers from './views/admin/customers.js';
import * as AdminSettings from './views/admin/settings.js';
import * as AdminStaff from './views/admin/staff.js';
import * as AdminZaloOA from './views/admin/zaloOA.js';
import * as AdminSupport from './views/admin/support.js';
import * as AdminLogs from './views/admin/logs.js';
import * as AdminBalanceSheet from './views/admin/balanceSheet.js';
import * as AdminLoanCalc from './views/admin/loanCalc.js';

const customerRoutes = [
  { re: /^#\/$/, view: Dashboard },
  { re: /^#\/hop-dong\/([^/]+)$/, view: ContractDetail, params: ['id'] },
  { re: /^#\/yeu-cau-tu-van$/, view: RequestForm },
  { re: /^#\/tai-khoan$/, view: Account },
  { re: /^#\/doi-mat-khau$/, view: ChangePasswordSelf },
];
const adminRoutes = [
  { re: /^#\/admin$/, view: AdminOverview },
  { re: /^#\/admin\/khach-hang$/, view: AdminCustomers },

  { re: /^#\/admin\/ho-tro$/, view: AdminSupport },
  { re: /^#\/admin\/cai-dat$/, view: AdminSettings, superOnly: true },

  { re: /^#\/admin\/nhat-ky$/, view: AdminLogs, superOnly: true },
  { re: /^#\/admin\/zalo-oa$/, view: AdminZaloOA, requiresManageZaloOA: true },
  { re: /^#\/admin\/nhan-vien$/, view: AdminStaff, requiresManageUsers: true },
  { re: /^#\/admin\/can-doi-ke-toan$/, view: AdminBalanceSheet, requiresViewBalanceSheet: true },

  { re: /^#\/admin\/tinh-lai$/, view: AdminLoanCalc },
  { re: /^#\/doi-mat-khau$/, view: ChangePasswordSelf },
];

const NAV_LABEL_MAP = Object.fromEntries(
  [...ADMIN_NAV, ...ADMIN_NAV_BALANCE_SHEET, ...ADMIN_NAV_MANAGE_ZALO_OA, ...ADMIN_NAV_SUPPORT, ...ADMIN_NAV_TOOLS, ...ADMIN_NAV_MANAGE_USERS, ...ADMIN_NAV_SUPER_ONLY].map((item) => [item.path, item.label])
);
NAV_LABEL_MAP['#/doi-mat-khau'] = 'Đổi mật khẩu';

let root;
let shellKey = null;

let lastRoutePath = null;
const balanceSheetPath = '#/admin/can-doi-ke-toan';

const KEEP_SCROLL_PATHS = new Set([balanceSheetPath, '#/admin/khach-hang']);
const scrollMemo = new Map();

let lastSessionKey = undefined;
function sessionKey(session) {
  return session ? `${session.role}:${session.id}` : null;
}

let warmUpTimer = null;
function scheduleWarmUp() {
  clearTimeout(warmUpTimer);
  warmUpTimer = setTimeout(() => {
    if (document.visibilityState !== 'visible' || !S.getSession()) return;
    AdminSupport.prefetch?.();
    setTimeout(() => AdminBalanceSheet.prefetch?.(), 1500);
  }, 1200);
}

function splitHash() {
  const raw = location.hash || '#/';
  const [path, qs] = raw.split('?');
  return { path: path || '#/', query: new URLSearchParams(qs || '') };
}

function matchRoute(path, routes) {
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      (r.params || []).forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return { view: r.view, params, superOnly: !!r.superOnly, requiresManageUsers: !!r.requiresManageUsers, requiresManageZaloOA: !!r.requiresManageZaloOA, requiresViewBalanceSheet: !!r.requiresViewBalanceSheet };
    }
  }
  return null;
}

let menuSlide = null;
function bindMenuSwipe() {
  const phoneLayout = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 899px)').matches;
  const blocked = (el) => {
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.isContentEditable || (n.hasAttribute && n.hasAttribute('data-no-swipe'))) return true;
      if (n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };
  let t0 = null;
  document.addEventListener('touchstart', (e) => {
    t0 = null;
    if (e.touches.length !== 1 || !phoneLayout() || !S.getSession() || document.querySelector('.modal-overlay')) return;
    const t = e.touches[0];
    if (t.clientX <= 28 || t.clientX >= window.innerWidth - 28) return;
    if (!getNavPaths().includes(splitHash().path) || blocked(e.target)) return;
    t0 = { x: t.clientX, y: t.clientY, at: Date.now(), path: splitHash().path };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!t0) return;
    const t = e.touches[0]; const dx = t.clientX - t0.x; const dy = t.clientY - t0.y;
    if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.3) lockNavAutoHide(1200);
  }, { passive: true });
  document.addEventListener('touchcancel', () => { t0 = null; }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!t0) return;
    const start = t0; t0 = null;
    const t = e.changedTouches[0]; const dx = t.clientX - start.x; const dy = t.clientY - start.y;
    if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - start.at > 600) return;
    if (document.querySelector('.modal-overlay') || splitHash().path !== start.path || String(window.getSelection?.() || '')) return;
    const paths = getNavPaths(); const i = paths.indexOf(start.path);
    if (i < 0 || paths.length < 2) return;
    menuSlide = dx < 0 ? 'left' : 'right';
    lockNavAutoHide(1200);
    location.hash = paths[(i + (dx < 0 ? 1 : -1) + paths.length) % paths.length];
  }, { passive: true });
}

function clearFabs() { document.querySelectorAll('.fab').forEach((el) => el.remove()); }

function renderApp({ scrollTop = true, dataOnly = false } = {}) {
  const session = S.getSession();

  const curSessionKey = sessionKey(session);
  if (curSessionKey !== lastSessionKey) {

    AdminCustomers.resetFilters?.();
    AdminZaloOA.resetFilters?.();
    AdminSupport.resetFilters?.();
    AdminLogs.resetFilters?.();
    AdminOverview.resetSelection?.();
    scrollMemo.clear();
    if (KEEP_SCROLL_PATHS.has(lastRoutePath)) lastRoutePath = null;
    if (session && lastSessionKey !== undefined) scheduleWarmUp();
    lastSessionKey = curSessionKey;
    dataOnly = false;
  }

  if (!session) {
    shellKey = null;
    renderChatFab(null);
    renderLogin(root, () => renderApp());
    return;
  }

  if (session.role === 'customer') {
    const customer = S.getCustomer(session.id);
    if (!customer) { S.logout(); renderApp(); return; }
    if (customer.mustChangePassword) {
      shellKey = null;
      renderChangePassword(root, customer.id, () => renderApp(), { forced: true });
      return;
    }
  }

  if (session.role === 'admin') {
    const adminUser = S.getAdmin(session.id);
    if (!adminUser) { S.logout(); renderApp(); return; }
    if (adminUser.mustChangePassword) {
      shellKey = null;
      renderChangePassword(root, adminUser.id, () => renderApp(), { forced: true, role: 'admin' });
      return;
    }
  }

  const isSuper = session.role === 'admin' ? S.isSuperAdmin(session.id) : false;
  const canManageUsers = session.role === 'admin' ? S.canManageUsers(session.id) : false;
  const canManageZaloOA = session.role === 'admin' ? S.canManageZaloOA(session.id) : false;
  const canViewBalanceSheet = session.role === 'admin' ? S.canViewBalanceSheet(session.id) : false;
  const { path, query } = splitHash();
  if (KEEP_SCROLL_PATHS.has(lastRoutePath) && path !== lastRoutePath) scrollMemo.set(lastRoutePath, window.scrollY);
  const routes = session.role === 'admin' ? adminRoutes : customerRoutes;
  const defaultPath = session.role === 'admin' ? '#/admin' : '#/';
  let match = matchRoute(path, routes);
  if (!match || (match.superOnly && !isSuper) || (match.requiresManageUsers && !canManageUsers) || (match.requiresManageZaloOA && !canManageZaloOA) || (match.requiresViewBalanceSheet && !canViewBalanceSheet)) {

    if (location.hash !== defaultPath) { location.hash = defaultPath; return; }
    match = matchRoute(defaultPath, routes);
  }

  const newShellKey = session.role + ':' + isSuper + ':' + canManageUsers + ':' + canManageZaloOA + ':' + canViewBalanceSheet;
  if (shellKey !== newShellKey) {
    buildShell(root, session.role, isSuper, canManageUsers, canManageZaloOA, canViewBalanceSheet);
    shellKey = newShellKey;
  }
  document.getElementById('brand-name').textContent = S.getOrg().shortName;
  renderSidebarProfile();
  renderSupportNavBadge();
  if (session.role === 'admin') S.loadOpenNotes().then((ok) => { if (ok) renderSupportNavBadge(); });

  const headerEl = document.getElementById('app-header');
  const filterEl = document.getElementById('filter-slot');
  const contentEl = document.getElementById('app-content');

  if (dataOnly && lastRoutePath === path && typeof match.view.refresh === 'function') {
    match.view.refresh(contentEl, filterEl, match.params, query);
    updateActiveNav(path);
    renderChatFab(session);
    return;
  }

  clearFabs();
  filterEl.innerHTML = '';
  const returningToKept = KEEP_SCROLL_PATHS.has(path) && lastRoutePath !== path;
  const keptY = returningToKept ? (scrollMemo.get(path) || 0) : 0;
  if (scrollTop && !returningToKept) window.scrollTo(0, 0);

  headerEl.classList.remove('cw-off'); contentEl.classList.remove('cw-on');
  if (match.view.renderHeader) match.view.renderHeader(headerEl, match.params);
  if (returningToKept) match.view.prepareRestore?.(keptY);
  match.view.render(contentEl, filterEl, match.params, query);
  if (returningToKept) {
    lockNavAutoHide(900);
    window.scrollTo(0, keptY);
    requestAnimationFrame(() => {
      if (splitHash().path === path) window.scrollTo(0, keptY);
    });
  }
  if (menuSlide) {
    const from = menuSlide === 'left' ? 24 : -24; menuSlide = null;
    if (typeof contentEl.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      [filterEl, contentEl].forEach((el) => el.animate([{ transform: `translateX(${from}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' }));
    }
  }

  if (path !== lastRoutePath && path !== '#/admin/nhat-ky') {
    S.logAdminAction('nav-page', { pageLabel: NAV_LABEL_MAP[path] || path });
  }
  lastRoutePath = path;
  updateActiveNav(path);
  renderChatFab(session);
}

window.addEventListener('hashchange', () => {
  closeAllModals();
  renderApp();

  S.refreshSessionData({ minAgeMs: 15000 });
});

window.addEventListener('qtd:refresh-failed', () => toast('Chưa tải được dữ liệu mới — đang hiện dữ liệu lần trước. Kiểm tra mạng rồi tải lại trang.', 'error'));
window.addEventListener('qtd:logout', () => { closeAllModals(); S.logout(); location.hash = '#/'; renderApp(); });

window.addEventListener('DOMContentLoaded', async () => {
  root = document.getElementById('root');
  registerServiceWorker();
  await S.init();
  renderApp();
  S.refreshSessionData().finally(scheduleWarmUp);
  S.refreshOrgPublic();
  startAutoRefresh();
  bindMenuSwipe();

  const existingSession = S.getSession();
  if (existingSession) autoSubscribeIfPossible(existingSession.sbToken);

  initAutoInstallPrompt();
});

S.subscribe(() => {
  if (root) renderApp({ scrollTop: false, dataOnly: true });
});

function startAutoRefresh() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') S.refreshSessionData();
  });
}

setInterval(() => S.checkForceLogout(), 5000);
