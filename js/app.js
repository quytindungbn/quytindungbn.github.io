import * as S from './state.js';
import { buildShell, updateActiveNav, renderSidebarProfile } from './components/shell.js';
import { closeAllModals } from './components/modal.js';
import { registerServiceWorker, autoSubscribeIfPossible } from './lib/push.js';
import './lib/installPwa.js'; // đăng ký lắng nghe beforeinstallprompt càng sớm càng tốt (xem file đó)
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
import * as AdminRequests from './views/admin/requests.js';
import * as AdminSettings from './views/admin/settings.js';
import * as AdminStaff from './views/admin/staff.js';

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
  { re: /^#\/admin\/yeu-cau$/, view: AdminRequests },
  { re: /^#\/admin\/cai-dat$/, view: AdminSettings, superOnly: true },
  { re: /^#\/admin\/nhan-vien$/, view: AdminStaff, requiresManageUsers: true },
  { re: /^#\/doi-mat-khau$/, view: ChangePasswordSelf },
];

let root;
let shellKey = null;
// Đường dẫn (hash) đã render() ĐẦY ĐỦ gần nhất — dùng để phân biệt "vừa mới
// vào trang này" (cần render() đầy đủ, có reset bộ lọc) với "vẫn đang đứng ở
// trang này nhưng có dữ liệu mới" (chỉ nên vẽ lại danh sách, giữ nguyên mọi
// bộ lọc/ô đang gõ — xem renderApp() và refresh() của từng view bên dưới).
let lastRoutePath = null;

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
      return { view: r.view, params, superOnly: !!r.superOnly, requiresManageUsers: !!r.requiresManageUsers };
    }
  }
  return null;
}

function clearFabs() { document.querySelectorAll('.fab').forEach((el) => el.remove()); }

function renderApp({ scrollTop = true, dataOnly = false } = {}) {
  const session = S.getSession();

  if (!session) {
    shellKey = null;
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
  const { path, query } = splitHash();
  const routes = session.role === 'admin' ? adminRoutes : customerRoutes;
  const defaultPath = session.role === 'admin' ? '#/admin' : '#/';
  let match = matchRoute(path, routes);
  if (!match || (match.superOnly && !isSuper) || (match.requiresManageUsers && !canManageUsers)) {
    // Trang không hợp lệ / không đủ quyền với vai trò hiện tại -> về trang mặc định
    if (location.hash !== defaultPath) { location.hash = defaultPath; return; }
    match = matchRoute(defaultPath, routes);
  }

  const newShellKey = session.role + ':' + isSuper + ':' + canManageUsers;
  if (shellKey !== newShellKey) {
    buildShell(root, session.role, isSuper, canManageUsers);
    shellKey = newShellKey;
  }
  document.getElementById('brand-name').textContent = S.getOrg().shortName;
  renderSidebarProfile();

  const headerEl = document.getElementById('app-header');
  const filterEl = document.getElementById('filter-slot');
  const contentEl = document.getElementById('app-content');

  // Có dữ liệu mới nhưng vẫn đang đứng nguyên ở trang này: nếu trang có khai
  // báo refresh() riêng thì chỉ gọi nó (vẽ lại danh sách bằng dữ liệu mới,
  // giữ nguyên mọi bộ lọc/tìm kiếm đang chọn) — KHÔNG gọi lại render() đầy đủ,
  // vì render() luôn reset bộ lọc về mặc định (chỉ nên xảy ra lúc mới vào
  // trang). Trang chưa có refresh() thì vẫn render() lại như cũ (không có gì
  // để giữ).
  if (dataOnly && lastRoutePath === path && typeof match.view.refresh === 'function') {
    match.view.refresh(contentEl, filterEl, match.params, query);
    updateActiveNav(path);
    return;
  }

  clearFabs();
  filterEl.innerHTML = '';
  if (scrollTop) window.scrollTo(0, 0);

  if (match.view.renderHeader) match.view.renderHeader(headerEl, match.params);
  match.view.render(contentEl, filterEl, match.params, query);
  lastRoutePath = path;
  updateActiveNav(path);
}

window.addEventListener('hashchange', () => { closeAllModals(); renderApp(); });
window.addEventListener('qtd:logout', () => { closeAllModals(); S.logout(); location.hash = '#/'; renderApp(); });

window.addEventListener('DOMContentLoaded', async () => {
  root = document.getElementById('root');
  registerServiceWorker(); // Đăng ký nhận thông báo đẩy — không đợi xong, không chặn tải app.
  await S.init();
  renderApp();
  startAutoRefresh();
  // Phiên đăng nhập cũ còn lưu sẵn (mở lại app không cần đăng nhập lại) cũng
  // tự xin quyền thông báo luôn — không đợi xong, không chặn tải app.
  const existingSession = S.getSession();
  if (existingSession) autoSubscribeIfPossible(existingSession.sbToken);
  // Tự động mời cài đặt app ngay khi vào (máy chưa cài) — gọi đúng 1 LẦN ở
  // đây, không lặp lại ở từng trang, xem installBtn.js.
  initAutoInstallPrompt();
});

// Mọi thay đổi dữ liệu (xóa/tạo/sửa...) đều gọi notify() và kích hoạt render
// lại ở đây — nhưng đây KHÔNG phải là chuyển trang, nên không cuộn lên đầu,
// để thao tác xong người dùng vẫn đang đứng đúng chỗ vừa thao tác.
S.subscribe(() => {
  if (root) renderApp({ scrollTop: false, dataOnly: true });
});

// Tự động tải lại dữ liệu mới — để khách/nhân viên KHÔNG cần thoát ra vào lại
// mới thấy dữ liệu mới (VD: admin vừa sửa hợp đồng ở máy khác). CHỈ làm mới
// khi có tín hiệu thật là người dùng có thể cần thấy dữ liệu mới (quay lại
// tab/app) — KHÔNG dùng bộ đếm thời gian (setInterval) nữa, vì cứ vài chục
// giây lại tự tải lại 1 lần sẽ làm mất bộ lọc đang chọn (Thôn/Xóm/sắp xếp...)
// và dữ liệu đang gõ dở, dù đã có cơ chế né ô đang gõ — vẫn gây khó chịu.
function startAutoRefresh() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') S.refreshSessionData();
  });
}
