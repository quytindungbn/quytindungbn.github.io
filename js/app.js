import * as S from './state.js';
import { buildShell, updateActiveNav, renderSidebarProfile, renderChatFab, renderSupportNavBadge, ADMIN_NAV, ADMIN_NAV_MANAGE_USERS, ADMIN_NAV_MANAGE_ZALO_OA, ADMIN_NAV_SUPER_ONLY } from './components/shell.js';
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
import * as AdminSettings from './views/admin/settings.js';
import * as AdminStaff from './views/admin/staff.js';
import * as AdminZaloOA from './views/admin/zaloOA.js';
import * as AdminSupport from './views/admin/support.js';
import * as AdminLogs from './views/admin/logs.js';

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
  // "Hỗ trợ" GỘP "Yêu cầu tư vấn" + chat thành 1 trang (2 tab bên trong, xem
  // js/views/admin/support.js) — luôn mở được cho MỌI quản trị viên (không
  // riêng canManageUsers, giữ đúng phạm vi cũ của "Yêu cầu tư vấn"); tab con
  // "Hỗ trợ" (chat) bên trong trang tự ẩn/hiện theo quyền, không cần chặn ở
  // cấp route.
  { re: /^#\/admin\/ho-tro$/, view: AdminSupport },
  { re: /^#\/admin\/cai-dat$/, view: AdminSettings, superOnly: true },
  // "Nhật ký" — CHỈ quản trị viên toàn quyền (role='super') mở được, xem
  // js/views/admin/logs.js. superOnly:true chặn ở route (khớp RLS thật ở
  // tầng database — mục 10.33 docs).
  { re: /^#\/admin\/nhat-ky$/, view: AdminLogs, superOnly: true },
  { re: /^#\/admin\/zalo-oa$/, view: AdminZaloOA, requiresManageZaloOA: true },
  { re: /^#\/admin\/nhan-vien$/, view: AdminStaff, requiresManageUsers: true },
  { re: /^#\/doi-mat-khau$/, view: ChangePasswordSelf },
];

// Nhãn hiển thị đúng theo path — dùng để ghi Nhật ký sử dụng mỗi lần chuyển
// trang thật sự (xem renderApp() bên dưới), khỏi phải ghi cứng lại 1 danh
// sách riêng — lấy thẳng từ đúng label đang hiện trên menu.
const NAV_LABEL_MAP = Object.fromEntries(
  [...ADMIN_NAV, ...ADMIN_NAV_MANAGE_ZALO_OA, ...ADMIN_NAV_MANAGE_USERS, ...ADMIN_NAV_SUPER_ONLY].map((item) => [item.path, item.label])
);
NAV_LABEL_MAP['#/doi-mat-khau'] = 'Đổi mật khẩu'; // có route nhưng không nằm trong menu chính (link riêng ở sidebar)

let root;
let shellKey = null;
// Đường dẫn (hash) đã render() ĐẦY ĐỦ gần nhất — dùng để phân biệt "vừa mới
// vào trang này" (cần render() đầy đủ, có reset bộ lọc) với "vẫn đang đứng ở
// trang này nhưng có dữ liệu mới" (chỉ nên vẽ lại danh sách, giữ nguyên mọi
// bộ lọc/ô đang gõ — xem renderApp() và refresh() của từng view bên dưới).
let lastRoutePath = null;
// "Chữ ký" của người đang đăng nhập lần render() gần nhất (role:id, hoặc
// null nếu chưa đăng nhập) — dùng để phát hiện đúng lúc ĐỔI NGƯỜI (đăng
// xuất, đăng nhập tài khoản khác, hết phiên) để reset bộ lọc/tìm kiếm của
// các trang có lưu bộ lọc kiểu "giữ nguyên khi quay lại" (module-level, sống
// suốt vòng đời trang web, KHÔNG tự mất khi đổi người dùng — xem
// resetFilters() ở customers.js/zaloOA.js/requests.js). undefined = chưa
// render() lần nào, để phân biệt với null (đã render() 1 lần lúc chưa đăng
// nhập) — cả 2 đều coi là "trạng thái ban đầu", không cần reset gì thêm.
let lastSessionKey = undefined;
function sessionKey(session) {
  return session ? `${session.role}:${session.id}` : null;
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
      return { view: r.view, params, superOnly: !!r.superOnly, requiresManageUsers: !!r.requiresManageUsers, requiresManageZaloOA: !!r.requiresManageZaloOA };
    }
  }
  return null;
}

function clearFabs() { document.querySelectorAll('.fab').forEach((el) => el.remove()); }

function renderApp({ scrollTop = true, dataOnly = false } = {}) {
  const session = S.getSession();

  const curSessionKey = sessionKey(session);
  if (curSessionKey !== lastSessionKey) {
    // Vừa đổi người đang đăng nhập — reset bộ lọc/tìm kiếm còn lưu ở các
    // trang, rồi ép render() ĐẦY ĐỦ (bỏ qua nhánh dataOnly giữ nguyên bộ
    // lọc) dù đang đứng đúng route cũ, để người mới vào không thấy sót lại
    // bộ lọc/kết quả tìm kiếm của người trước.
    AdminCustomers.resetFilters?.();
    AdminZaloOA.resetFilters?.();
    AdminSupport.resetFilters?.();
    AdminLogs.resetFilters?.();
    lastSessionKey = curSessionKey;
    dataOnly = false;
  }

  if (!session) {
    shellKey = null;
    renderChatFab(null); // dọn nút chat nổi nếu vừa đăng xuất (còn sót lại từ phiên khách hàng trước)
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
  const { path, query } = splitHash();
  const routes = session.role === 'admin' ? adminRoutes : customerRoutes;
  const defaultPath = session.role === 'admin' ? '#/admin' : '#/';
  let match = matchRoute(path, routes);
  if (!match || (match.superOnly && !isSuper) || (match.requiresManageUsers && !canManageUsers) || (match.requiresManageZaloOA && !canManageZaloOA)) {
    // Trang không hợp lệ / không đủ quyền với vai trò hiện tại -> về trang mặc định
    if (location.hash !== defaultPath) { location.hash = defaultPath; return; }
    match = matchRoute(defaultPath, routes);
  }

  const newShellKey = session.role + ':' + isSuper + ':' + canManageUsers + ':' + canManageZaloOA;
  if (shellKey !== newShellKey) {
    buildShell(root, session.role, isSuper, canManageUsers, canManageZaloOA);
    shellKey = newShellKey;
  }
  document.getElementById('brand-name').textContent = S.getOrg().shortName;
  renderSidebarProfile();
  renderSupportNavBadge();

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
    renderChatFab(session); // nút đã có sẵn từ lần render() đầy đủ trước đó — chỉ cập nhật lại số tin chưa đọc
    return;
  }

  clearFabs();
  filterEl.innerHTML = '';
  if (scrollTop) window.scrollTo(0, 0);

  if (match.view.renderHeader) match.view.renderHeader(headerEl, match.params);
  match.view.render(contentEl, filterEl, match.params, query);
  // Ghi Nhật ký sử dụng mỗi lần THẬT SỰ chuyển sang 1 trang khác (so path
  // với lastRoutePath — path không đổi thì không ghi lại, tránh spam lúc
  // renderApp() gọi lại nhiều lần trên CÙNG 1 trang vì có dữ liệu mới/đổi
  // quyền, xem ghi chú dataOnly ở trên). logAdminAction() tự bỏ qua nếu
  // không phải phiên quản trị viên. RIÊNG trang "Nhật ký" (#/admin/nhat-ky)
  // KHÔNG tự ghi log vào chính nó — mỗi lần vào xem nhật ký lại tự thêm 1
  // dòng "Vào trang Nhật ký" đứng đầu danh sách, che mất đúng thao tác vừa
  // làm trước đó mà người dùng đang muốn kiểm tra.
  if (path !== lastRoutePath && path !== '#/admin/nhat-ky') {
    S.logAdminAction('nav-page', { pageLabel: NAV_LABEL_MAP[path] || path });
  }
  lastRoutePath = path;
  updateActiveNav(path);
  renderChatFab(session); // clearFabs() ở trên vừa dọn nút cũ (nếu có) — tạo lại (hoặc bỏ qua nếu không phải khách hàng)
}

window.addEventListener('hashchange', () => {
  closeAllModals();
  renderApp();
  // Mỗi lần chuyển trang cũng tranh thủ tải lại dữ liệu quyền/phạm vi Thôn-Xóm
  // của CHÍNH người đang đăng nhập — để khi admin khác vừa đổi quyền cho họ
  // (VD: cấp thêm Thôn/Xóm được xem, bật/tắt quyền Quản lý User) thì họ thấy
  // đúng ngay ở lần bấm menu kế tiếp, KHÔNG cần đăng xuất/đăng nhập lại. Chạy
  // ngầm (không await) — refreshSessionData() tự gọi notify() khi xong, kích
  // hoạt vẽ lại (xem S.subscribe bên dưới); trang không còn đủ quyền (VD: bị
  // rút quyền khi đang đứng ở đó) sẽ tự bị renderApp() điều hướng về mặc định.
  S.refreshSessionData();
});
window.addEventListener('qtd:logout', () => { closeAllModals(); S.logout(); location.hash = '#/'; renderApp(); });

window.addEventListener('DOMContentLoaded', async () => {
  root = document.getElementById('root');
  registerServiceWorker(); // Đăng ký nhận thông báo đẩy — không đợi xong, không chặn tải app.
  await S.init(); // KHÔNG còn chờ mạng nữa (xem ghi chú trong state.js) — trả về gần như ngay lập tức.
  renderApp(); // Vẽ màn hình đầu tiên NGAY bằng dữ liệu đã có sẵn (demo hoặc cache lần trước), không đợi Supabase.
  S.refreshOrgPublic(); // Tải tên quỹ/banner THẬT ngầm phía sau — không await, xong tự cập nhật lại đúng chỗ (S.subscribe bên dưới).
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
// mới thấy dữ liệu mới (VD: admin vừa sửa hợp đồng/đổi quyền ở máy khác). CHỈ
// làm mới khi có tín hiệu thật là người dùng có thể cần thấy dữ liệu mới
// (quay lại tab/app, hoặc chuyển trang — xem thêm listener 'hashchange' ở
// trên) — KHÔNG dùng bộ đếm thời gian (setInterval) TẢI LẠI TOÀN BỘ DỮ LIỆU
// nữa, vì cứ vài chục giây lại tự tải lại 1 lần sẽ làm mất bộ lọc đang chọn
// (Thôn/Xóm/sắp xếp...) và dữ liệu đang gõ dở, dù đã có cơ chế né ô đang gõ
// — vẫn gây khó chịu. (Có 1 bộ đếm giờ RIÊNG, RẤT NHẸ, chỉ kiểm tra đúng 2
// cột — xem setInterval(S.checkForceLogout...) ngay bên dưới — đó là ngoại
// lệ DUY NHẤT, KHÔNG áp dụng nguyên tắc này vì nó không bao giờ đụng tới màn
// hình đang xem trừ khi thật sự cần đăng xuất ngay.)
function startAutoRefresh() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') S.refreshSessionData();
  });
}

// Đăng xuất ngay khi bị cấp lại mật khẩu/bấm "Đăng xuất" (xem
// S.checkForceLogout()) CẦN xảy ra tức thì, không thể đợi người dùng tự quay
// lại tab/chuyển trang mới phát hiện ra (đó là đúng nhược điểm của cơ chế
// startAutoRefresh() ở trên — CHỦ Ý chỉ chạy theo tín hiệu, không phải theo
// thời gian). checkForceLogout() được thiết kế RIÊNG để an toàn khi chạy định
// kỳ (chỉ đọc 2 cột của CHÍNH mình, không bao giờ vẽ lại màn hình trừ khi
// thật sự cần đăng xuất — xem ghi chú đầy đủ trong js/state.js) nên đặt hẳn 1
// bộ đếm giờ riêng cho việc NÀY, tách biệt hoàn toàn với cơ chế tải lại dữ
// liệu chung ở trên.
setInterval(() => S.checkForceLogout(), 5000);
