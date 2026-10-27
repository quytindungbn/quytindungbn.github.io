import * as S from './state.js';
import { buildShell, updateActiveNav, renderSidebarProfile, renderChatFab, renderSupportNavBadge, ADMIN_NAV, ADMIN_NAV_SUPPORT, ADMIN_NAV_TOOLS, ADMIN_NAV_MANAGE_USERS, ADMIN_NAV_MANAGE_ZALO_OA, ADMIN_NAV_BALANCE_SHEET, ADMIN_NAV_SUPER_ONLY } from './components/shell.js';
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
let balanceSheetScrollY = 0;

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
    balanceSheetScrollY = 0;
    if (lastRoutePath === balanceSheetPath) lastRoutePath = null;
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
  if (lastRoutePath === balanceSheetPath && path !== balanceSheetPath) balanceSheetScrollY = window.scrollY;
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
  const returningToBalanceSheet = path === balanceSheetPath && lastRoutePath !== balanceSheetPath;
  if (scrollTop && !returningToBalanceSheet) window.scrollTo(0, 0);

  headerEl.classList.remove('cw-off'); contentEl.classList.remove('cw-on');
  if (match.view.renderHeader) match.view.renderHeader(headerEl, match.params);
  match.view.render(contentEl, filterEl, match.params, query);
  if (returningToBalanceSheet) requestAnimationFrame(() => {
    if (splitHash().path === balanceSheetPath) window.scrollTo(0, balanceSheetScrollY);
  });

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
