// Trang "Quản lý User" — quản lý tài khoản trong hệ thống ở 1 chỗ: "Use"
// (tài khoản khách hàng) và "Quản trị viên" (super toàn quyền hoặc staff chỉ
// xem, có phân quyền theo Thôn/Xóm). Vào được trang này: quản trị viên toàn
// quyền, HOẶC nhân viên "chỉ xem" được cấp riêng cờ canManageUsers (xem
// checkbox "Cho phép quản lý User" trong adminPermissionSectionHtml()) —
// route đã đặt requiresManageUsers ở app.js. NHƯNG nhân viên có cờ này CHỈ
// quản lý được Use KHÁCH HÀNG (tạo/cấp lại mật khẩu/khóa/xóa) — KHÔNG được
// tạo/sửa/xóa/xem chi tiết bất kỳ tài khoản Quản trị viên/nhân viên nào
// khác (kể cả 1 nhân viên chỉ xem khác), server tự chặn 403 nếu cố gọi
// (xem SUPER_ONLY_TYPES trong create-account/index.ts) — UI cũng tự ẩn hết
// các lựa chọn/nút liên quan tới tài khoản Quản trị viên với nhóm này.
import * as S from '../../state.js';
import { icon } from '../../icons.js';
import { pageHeader } from '../../components/shell.js';
import { emptyState, openResetPasswordModal, statusDotsHtml, searchBoxHtml, bindSearchBox } from '../../components/ui.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { initials, colorFor, maskCccd, formatNumber, escapeHtml } from '../../utils.js';
import { openCustomerDetail } from './customers.js';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Quản lý User' });
}

let filterRole = 'all'; // 'all' | 'use' | 'admin'
let query = '';

export function render(contentEl, filterEl) {
  filterRole = 'all';
  query = '';
  // Ô tìm kiếm nằm ở filterEl (không bị vẽ lại cùng danh sách) để không mất
  // focus/con trỏ mỗi khi gõ — giống cách trang Khách hàng & Hợp đồng làm.
  filterEl.innerHTML = `<div style="padding:10px 14px 0">${searchBoxHtml('search-input', 'Tìm theo tên, CCCD, SĐT, tên đăng nhập...', '')}</div>`;
  bindSearchBox(filterEl, 'search-input', (v) => { query = v; draw(contentEl); });
  draw(contentEl);
}

/**
 * Có dữ liệu mới nhưng vẫn đang đứng ở trang này (xem renderApp() trong
 * app.js) — chỉ vẽ lại danh sách bằng draw(), KHÔNG gọi render() nên bộ lọc
 * (Tất cả/Use/Quản trị viên) và ô tìm kiếm đang gõ được giữ nguyên.
 */
export function refresh(contentEl) {
  draw(contentEl);
}

function permissionSummary(a) {
  const xomLabels = a.allowedXom.map((key) => {
    const { thon, xom } = S.parseXomKey(key);
    return thon ? `${xom} (${thon})` : `Xóm ${xom}`; // fallback nếu còn dữ liệu cũ lưu bare xom (trước bản sửa lỗi trùng tên Xóm)
  });
  const parts = [...a.allowedThon, ...xomLabels];
  return parts.length ? parts.join(', ') : 'Chưa gán địa bàn nào';
}

function draw(contentEl) {
  // "Use" ở trang này chỉ tính khách hàng ĐÃ có tài khoản đăng nhập (salt+hash) —
  // hồ sơ nhập từ Excel chưa được "Tạo User" thuộc về trang Khách hàng & Hợp
  // đồng, không phải Use, để 2 khái niệm không lẫn vào nhau.
  const customers = S.getState().customers.filter((c) => c.salt && c.hash);
  const admins = S.listAdmins();
  const lockedCount = customers.filter((c) => S.isCustomerLocked(c)).length;
  const loggedInCount = customers.filter((c) => S.hasCustomerLoggedIn(c)).length;
  const pushOnCount = customers.filter((c) => S.hasPushEnabled(c.id)).length;
  const tree = S.thonXomTree();

  let rows = [];
  if (filterRole !== 'admin') customers.forEach((c) => rows.push({ kind: 'use', data: c }));
  if (filterRole !== 'use') admins.forEach((a) => rows.push({ kind: 'admin', data: a }));
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    rows = rows.filter(({ kind, data }) => kind === 'use'
      ? data.name.toLowerCase().includes(q) || data.cccd.includes(q) || (data.phone || '').includes(q)
      : data.name.toLowerCase().includes(q) || data.username.toLowerCase().includes(q));
  }

  contentEl.innerHTML = `
    <div class="grid-4 mb-16">
      <div class="stat-tile c-blue">
        <div class="stat-label">Use đã tạo</div>
        <div class="stat-value">${formatNumber(customers.length)}</div>
        ${lockedCount ? `<div class="stat-trend" style="color:var(--danger)">${formatNumber(lockedCount)} đang tạm khóa</div>` : `<div class="stat-trend">Tất cả đang hoạt động</div>`}
      </div>
      <div class="stat-tile c-purple">
        <div class="stat-label">Quản trị viên đã tạo</div>
        <div class="stat-value">${formatNumber(admins.length)}</div>
        <div class="stat-trend">${formatNumber(admins.filter((a) => a.role === 'super').length)} toàn quyền · ${formatNumber(admins.filter((a) => a.role === 'staff').length)} chỉ xem</div>
      </div>
      <div class="stat-tile c-green" data-stat="logged-in" style="cursor:pointer">
        <div class="stat-label">Use đã đăng nhập</div>
        <div class="stat-value">${formatNumber(loggedInCount)}</div>
        <div class="stat-trend">/ ${formatNumber(customers.length)} Use</div>
      </div>
      <div class="stat-tile c-orange" data-stat="push-on" style="cursor:pointer">
        <div class="stat-label">Use đã bật thông báo</div>
        <div class="stat-value">${formatNumber(pushOnCount)}</div>
        <div class="stat-trend">/ ${formatNumber(loggedInCount)} đã đăng nhập</div>
      </div>
    </div>

    <div class="card card-pad mb-16">
      <button class="btn btn-primary btn-block" id="btn-add-user">${icon('plus', 'icon-sm')} Tạo User</button>
    </div>

    <div class="chip-row mb-16">
      <button class="chip ${filterRole === 'all' ? 'active' : ''}" data-role="all">Tất cả</button>
      <button class="chip ${filterRole === 'use' ? 'active' : ''}" data-role="use">Use (khách hàng)</button>
      <button class="chip ${filterRole === 'admin' ? 'active' : ''}" data-role="admin">Quản trị viên</button>
    </div>

    <div class="card card-pad">
      <div class="text-sm text-muted mb-8">${rows.length} tài khoản</div>
      ${rows.length ? rows.map((r) => r.kind === 'use' ? userRowHtml(r.data) : adminRowHtml(r.data)).join('')
        : emptyState({ iconName: 'idCard', title: 'Không có tài khoản phù hợp', message: 'Bấm "Tạo User" để tạo tài khoản đầu tiên.' })}
    </div>
  `;

  contentEl.querySelectorAll('[data-role]').forEach((btn) => {
    btn.addEventListener('click', () => { filterRole = btn.dataset.role; draw(contentEl); });
  });
  contentEl.querySelector('#btn-add-user').addEventListener('click', () => openCreateUserModal(tree, contentEl));
  contentEl.querySelectorAll('[data-open-use]').forEach((row) => {
    row.addEventListener('click', () => openCustomerDetail(row.dataset.openUse, { readOnly: false, context: 'use' }));
  });
  contentEl.querySelectorAll('[data-open-admin]').forEach((row) => {
    row.addEventListener('click', () => openAdminDetail(S.getAdmin(row.dataset.openAdmin), tree, contentEl));
  });
  const loggedInTile = contentEl.querySelector('[data-stat="logged-in"]');
  if (loggedInTile) loggedInTile.addEventListener('click', () => openStatListModal('Use đã đăng nhập', customers.filter((c) => S.hasCustomerLoggedIn(c))));
  const pushOnTile = contentEl.querySelector('[data-stat="push-on"]');
  if (pushOnTile) pushOnTile.addEventListener('click', () => openStatListModal('Use đã bật thông báo', customers.filter((c) => S.hasPushEnabled(c.id))));
}

/** Bấm vào ô thống kê "Use đã đăng nhập"/"Use đã bật thông báo" — ra đúng danh sách những Use đó, bấm vào 1 dòng mở luôn chi tiết Use đó. */
function openStatListModal(title, list) {
  openModal({
    title: `${title} (${list.length})`,
    bodyHtml: list.length ? list.map((c) => userRowHtml(c)).join('') : emptyState({ iconName: 'idCard', title: 'Chưa có Use nào', message: 'Danh sách hiện đang trống.' }),
    onMount(sheet, closeFn) {
      sheet.querySelectorAll('[data-open-use]').forEach((row) => {
        row.addEventListener('click', () => { closeFn(); openCustomerDetail(row.dataset.openUse, { readOnly: false, context: 'use' }); });
      });
    },
  });
}

function userRowHtml(c) {
  const locked = S.isCustomerLocked(c);
  return `
    <div class="list-row" data-open-use="${c.id}" style="cursor:pointer">
      <div class="row-thumb" style="background:${colorFor(c.id)}">${initials(c.name)}</div>
      <div class="row-main">
        <div class="row-title">${c.name} <span class="badge badge-blue">Use</span>${locked ? ' <span class="badge badge-red">Đang khóa</span>' : ''}</div>
        <div class="row-sub">${maskCccd(c.cccd)} · ${c.phone || 'Chưa có SĐT'}</div>
      </div>
      ${statusDotsHtml(S.hasCustomerLoggedIn(c), S.hasPushEnabled(c.id))}
    </div>`;
}

function adminRowHtml(a) {
  const roleLabel = a.role === 'super' ? 'Toàn quyền' : 'Chỉ xem';
  return `
    <div class="list-row" data-open-admin="${a.id}" style="cursor:pointer">
      <div class="row-thumb" style="background:${colorFor(a.id)}">${initials(a.name)}</div>
      <div class="row-main">
        <div class="row-title">${a.name} <span class="badge ${a.role === 'super' ? 'badge-purple' : 'badge-green'}">Quản trị viên · ${roleLabel}</span>${a.role === 'staff' && a.canManageUsers ? ' <span class="badge badge-blue">+ Quản lý User</span>' : ''}${a.role === 'staff' && a.canManageZaloOA ? ' <span class="badge badge-blue">+ Quản lý OA</span>' : ''}</div>
        <div class="row-sub">@${a.username}${a.role === 'staff' ? ' · Xem được: ' + permissionSummary(a) : ''}</div>
      </div>
    </div>`;
}

function showCredential(title, username, password) {
  openModal({
    title,
    bodyHtml: `
      <p class="text-sm text-muted mb-16">Gửi thông tin sau cho người dùng:</p>
      <div class="card card-pad" style="background:var(--surface-alt)">
        <div class="oc-line"><span>Tên đăng nhập</span><b>${username}</b></div>
        <div class="oc-line"><span>Mật khẩu</span><b>${password}</b></div>
      </div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-close>Đã hiểu</button>`,
    onMount(sheet, closeFn) { sheet.querySelector('[data-close]').addEventListener('click', closeFn); },
  });
}

/** Cây chọn quyền 2 cấp: tích cả Thôn = xem trọn Thôn đó; tích riêng từng Xóm (dạng chip) = chỉ xem Xóm đó dù Thôn không được cấp trọn. */
function permissionTreeHtml(tree, admin) {
  if (!tree.length) return `<p class="text-sm text-muted">Chưa có dữ liệu Thôn/Xóm nào trong danh sách khách hàng.</p>`;
  return `
    <div class="flex gap-8 mb-8">
      <button type="button" class="btn btn-outline btn-sm" data-perm-select-all>Chọn tất cả</button>
      <button type="button" class="btn btn-outline btn-sm" data-perm-clear-all>Bỏ chọn tất cả</button>
    </div>
    <div class="flex-col gap-10">${tree.map(({ thon, xomList }) => `
    <div class="card card-pad" style="background:var(--surface-alt)">
      <label class="flex items-center gap-8" style="font-size:14px;font-weight:700;cursor:pointer">
        <input type="checkbox" name="thon" value="${thon}" ${admin?.allowedThon.includes(thon) ? 'checked' : ''}/>
        ${icon('mapPin', 'icon-sm')} ${thon} <span class="text-faint" style="font-weight:500">(cả thôn)</span>
      </label>
      ${xomList.length ? `
      <div class="chip-row mt-8" style="flex-wrap:wrap">
        ${xomList.map((x) => `
          <label class="chip xom-chip ${admin?.allowedXom.includes(S.xomKey(thon, x)) ? 'active' : ''}" style="cursor:pointer">
            <input type="checkbox" name="xom" value="${S.xomKey(thon, x)}" ${admin?.allowedXom.includes(S.xomKey(thon, x)) ? 'checked' : ''} style="position:absolute;opacity:0;width:0;height:0"/>
            ${x}
          </label>`).join('')}
      </div>` : ''}
    </div>`).join('')}</div>`;
}
function bindPermissionTreeChips(sheet) {
  sheet.querySelectorAll('.xom-chip input[name="xom"]').forEach((cb) => {
    cb.addEventListener('change', () => cb.closest('label').classList.toggle('active', cb.checked));
  });
  const selectAllBtn = sheet.querySelector('[data-perm-select-all]');
  const clearAllBtn = sheet.querySelector('[data-perm-clear-all]');
  if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
    sheet.querySelectorAll('input[name="thon"], input[name="xom"]').forEach((cb) => {
      cb.checked = true;
      if (cb.name === 'xom') cb.closest('label').classList.add('active');
    });
  });
  if (clearAllBtn) clearAllBtn.addEventListener('click', () => {
    sheet.querySelectorAll('input[name="thon"], input[name="xom"]').forEach((cb) => {
      cb.checked = false;
      if (cb.name === 'xom') cb.closest('label').classList.remove('active');
    });
  });
}

/**
 * Khối "Địa bàn được xem" — chỉ có ý nghĩa với role='staff'. Kèm thêm 1
 * checkbox riêng "Cho phép quản lý User" — nhân viên chỉ xem được tích thêm
 * quyền này thì vào được hẳn trang Quản lý User (tạo/sửa/xóa Use + nhân
 * viên khác), coi như "toàn quyền thu nhỏ", không cần nâng hẳn lên Toàn
 * quyền. `admin` truyền vào có thể là vai trò ĐANG CHỌN THỬ (pendingRole,
 * chưa lưu) chứ không nhất thiết vai trò thật đang lưu trong CSDL — xem
 * openAdminDetail(): đổi vai trò tại chỗ là đổi luôn khối này theo, không
 * cần lưu xong mở lại mới thấy cây Thôn/Xóm để chọn.
 */
function adminPermissionSectionHtml(admin, tree, isSelf = false) {
  if (admin.role !== 'staff') return `<p class="field-hint mt-16">Quản trị viên toàn quyền xem được mọi địa bàn và quản lý User, không cần gán riêng.</p>`;
  // Khóa cứng checkbox "Cho phép quản lý User" khi tự xem CHÍNH MÌNH — nếu
  // không khóa, nhân viên đang có quyền này có thể tự bỏ tích rồi lưu, LẬP
  // TỨC mất quyền vào trang này ngay giữa chừng (route tự đá về trang mặc
  // định do không còn đủ quyền requiresManageUsers) — đúng lỗi "đang sửa xong
  // tự nhảy ra trang ngoài" đã gặp. Y hệt cách khối đổi vai trò đã tự chặn
  // isSelf ở trên.
  const lockCheckbox = isSelf ? 'checked disabled' : (admin.canManageUsers ? 'checked' : '');
  // Cờ quản lý gửi tin Zalo OA — RIÊNG, không khóa cứng khi tự xem chính mình
  // như canManageUsers ở trên, vì trang "Quản lý OA" không có gì để "tự nhảy
  // ra giữa chừng" nghiêm trọng như Quản lý User (không đang đứng sẵn ở đó
  // lúc sửa quyền này).
  const zaloChecked = admin.canManageZaloOA ? 'checked' : '';
  return `
    <div class="section-head mt-16"><h2 style="font-size:14px">Địa bàn được xem</h2></div>
    <form id="perm-form">
      ${permissionTreeHtml(tree, admin)}
      <label class="flex items-center gap-8 mt-16" style="cursor:${isSelf ? 'default' : 'pointer'};font-weight:700;font-size:14px">
        <input type="checkbox" name="canManageUsers" ${lockCheckbox}/>
        Cho phép quản lý User
      </label>
      ${isSelf
        ? `<div class="field-hint">Không thể tự bỏ quyền này của chính mình (sẽ tự mất quyền vào trang này ngay lập tức) — cần quản trị viên toàn quyền hoặc 1 nhân viên khác có quyền này thao tác giúp.</div>`
        : `<div class="field-hint">Tích vào đây thì nhân viên này vào được trang "Quản lý User" — tự tạo/sửa/xóa Use và nhân viên khác (không tạo được tài khoản Toàn quyền, không đụng được tài khoản Toàn quyền khác).</div>`}
      <label class="flex items-center gap-8 mt-16" style="cursor:pointer;font-weight:700;font-size:14px">
        <input type="checkbox" name="canManageZaloOA" ${zaloChecked}/>
        Cho phép quản lý gửi tin Zalo OA
      </label>
      <div class="field-hint">Tích vào đây thì nhân viên này vào được trang "Quản lý OA" — thêm/bớt khách hàng vào danh sách gửi Zalo tự động, gửi tay, xem log gửi tin — CHỈ trong đúng Thôn/Xóm được gán ở trên.</div>
    </form>
  `;
}

function openAdminDetail(admin, tree, contentEl) {
  const session = S.getSession();
  const isSelf = session?.id === admin.id;
  const viewerIsSuper = S.isSuperAdmin(session?.id);

  // Nhân viên "chỉ xem" có quyền Quản lý User (không phải Toàn quyền thật)
  // CHỈ quản lý được Use KHÁCH HÀNG — không được đụng vào bất kỳ tài khoản
  // Quản trị viên/nhân viên nào khác (server cũng tự chặn 403 nếu cố gọi,
  // xem SUPER_ONLY_TYPES trong create-account/index.ts). Ở đây chỉ hiện
  // thông tin, không có nút thao tác nào — tránh hiện nút mà bấm vào lại
  // báo lỗi, gây hiểu nhầm là làm được.
  if (!viewerIsSuper) {
    openModal({
      title: admin.name,
      bodyHtml: `
        <div class="oc-line"><span>Tên đăng nhập</span><b>@${admin.username}</b></div>
        <div class="oc-line"><span>Vai trò</span><b>${admin.role === 'super' ? 'Quản trị viên toàn quyền' : 'Quản trị viên chỉ xem'}</b></div>
        ${admin.role === 'staff' ? `<div class="oc-line" style="align-items:flex-start"><span>Địa bàn được xem</span><b style="text-align:right;max-width:65%">${permissionSummary(admin)}</b></div>` : ''}
        <p class="field-hint mt-16">Bạn chỉ quản lý được Use khách hàng — chỉ quản trị viên toàn quyền mới quản lý được tài khoản Quản trị viên/nhân viên khác.</p>
      `,
    });
    return;
  }

  let pendingRole = admin.role; // chỉ đổi cục bộ trong popup, lưu khi bấm "Lưu quyền"
  // Chỉ hiện nút "Lưu quyền" khi có gì đó THẬT SỰ có thể lưu: hoặc người xem
  // đổi được vai trò (viewerIsSuper && !isSelf — dù target đang là Toàn
  // quyền, vẫn cần nút để hạ xuống Chỉ xem), hoặc target là "staff" nên có
  // cây Thôn/Xóm để sửa. Không rơi vào 2 trường hợp này (VD: nhân viên chỉ
  // xem thường tự mở xem 1 quản trị viên toàn quyền khác) thì không có gì để
  // lưu, ẩn hẳn nút đi — y hệt hành vi cũ.
  const canShowSaveBtn = (viewerIsSuper && !isSelf) || admin.role === 'staff';

  const close = openModal({
    title: admin.name,
    bodyHtml: `
      <div class="oc-line"><span>Tên đăng nhập</span><b>@${admin.username}</b></div>
      ${viewerIsSuper && !isSelf ? `
      <div class="field">
        <label>Vai trò</label>
        <div class="radio-row" id="role-radio-row">
          <div class="radio-opt ${admin.role === 'staff' ? 'active' : ''}" data-role="staff">Chỉ xem (nhân viên)</div>
          <div class="radio-opt ${admin.role === 'super' ? 'active' : ''}" data-role="super">Toàn quyền</div>
        </div>
      </div>
      ` : `<div class="oc-line"><span>Vai trò</span><b>${admin.role === 'super' ? 'Quản trị viên toàn quyền' : 'Quản trị viên chỉ xem'}</b></div>
      ${isSelf ? `<p class="field-hint">Không thể tự đổi vai trò của chính mình đang đăng nhập.</p>` : ''}`}
      <div id="perm-section">${adminPermissionSectionHtml({ ...admin, role: pendingRole }, tree, isSelf)}</div>
      ${canShowSaveBtn ? `<button class="btn btn-primary btn-block mt-16" id="btn-save-perm">Lưu quyền</button>` : ''}
      <div class="flex gap-8 mt-16 flex-wrap">
        <button class="btn btn-outline btn-sm" id="btn-reset-pw">${icon('key', 'icon-sm')} Cấp lại mật khẩu</button>
        ${!isSelf ? `<button class="btn btn-outline btn-sm" id="btn-force-logout">${icon('logout', 'icon-sm')} Đăng xuất</button>` : ''}
        ${!isSelf ? `<button class="btn btn-danger-outline btn-sm" id="btn-del-admin">${icon('trash', 'icon-sm')} Xóa</button>` : ''}
      </div>
      ${isSelf ? `<p class="field-hint mt-8">Không thể tự xóa tài khoản đang đăng nhập.</p>` : ''}
    `,
    onMount(sheet, closeFn) {
      bindPermissionTreeChips(sheet);

      const roleRow = sheet.querySelector('#role-radio-row');
      const permSection = sheet.querySelector('#perm-section');
      if (roleRow) {
        roleRow.querySelectorAll('[data-role]').forEach((opt) => opt.addEventListener('click', () => {
          pendingRole = opt.dataset.role;
          roleRow.querySelectorAll('[data-role]').forEach((o) => o.classList.toggle('active', o.dataset.role === pendingRole));
          // Đổi vai trò tại chỗ là đổi luôn khối "Địa bàn được xem" theo —
          // chọn "Chỉ xem" hiện ngay cây Thôn/Xóm để chọn, không cần lưu
          // xong mở lại; chọn "Toàn quyền" thì khối này ẩn đi luôn.
          permSection.innerHTML = adminPermissionSectionHtml({ ...admin, role: pendingRole }, tree, isSelf);
          bindPermissionTreeChips(sheet);
        }));
      }

      const saveBtn = sheet.querySelector('#btn-save-perm');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          saveBtn.disabled = true;
          try {
            // Đổi vai trò TRƯỚC (nếu có) — server chỉ nhận cập nhật Thôn/Xóm
            // cho tài khoản ĐANG LÀ 'staff', nên nếu vừa hạ Toàn quyền xuống
            // Chỉ xem thì phải đổi vai trò xong xuôi rồi mới lưu quyền theo.
            if (pendingRole !== admin.role) await S.updateStaffRole(admin.id, pendingRole);
            if (pendingRole === 'staff') {
              const formEl = sheet.querySelector('#perm-form');
              const fd = formEl ? new FormData(formEl) : new FormData();
              // Checkbox "canManageUsers" bị khóa (disabled) khi tự xem chính
              // mình — input disabled KHÔNG được đưa vào FormData, nên
              // fd.get() trả về null dù đang tích sẵn -> phải tự giữ nguyên
              // giá trị cũ, không đọc từ form (không sẽ vô tình gửi lên
              // false, tự xóa quyền của chính mình).
              const canManage = isSelf ? admin.canManageUsers : fd.get('canManageUsers') === 'on';
              const canManageZalo = fd.get('canManageZaloOA') === 'on';
              await S.updateStaffPermissions(admin.id, fd.getAll('thon'), fd.getAll('xom'), canManage, canManageZalo);
            }
            toast('Đã lưu quyền', 'success');
            closeFn();
            draw(contentEl);
          } catch (err) {
            toast(err.message || 'Có lỗi xảy ra', 'error');
            saveBtn.disabled = false;
          }
        });
      }

      sheet.querySelector('#btn-reset-pw').addEventListener('click', () => {
        openResetPasswordModal({
          title: 'Cấp lại mật khẩu',
          onConfirm: async (val) => {
            const temp = await S.resetStaffPassword(admin.id, val);
            closeFn();
            showCredential('Đã cấp lại mật khẩu', admin.username, temp);
          },
        });
      });
      const forceLogoutBtn = sheet.querySelector('#btn-force-logout');
      if (forceLogoutBtn) forceLogoutBtn.addEventListener('click', () => {
        confirmDialog({
          title: 'Đăng xuất tài khoản này?',
          message: `"${admin.name}" (@${admin.username}) sẽ bị đăng xuất khỏi mọi nơi đang đăng nhập, không cần đổi mật khẩu.`,
          confirmLabel: 'Đăng xuất',
          onConfirm: async () => {
            try { await S.forceLogoutStaff(admin.id); toast('Đã đăng xuất tài khoản này', 'success'); closeFn(); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
      const delBtn = sheet.querySelector('#btn-del-admin');
      if (delBtn) delBtn.addEventListener('click', () => {
        confirmDialog({
          title: 'Xóa quản trị viên?', message: `Xóa tài khoản "${admin.name}" (@${admin.username})?`,
          confirmLabel: 'Xóa', danger: true,
          onConfirm: async () => {
            try {
              await S.deleteStaffAdmin(admin.id);
              closeFn();
              toast('Đã xóa quản trị viên', 'success');
              draw(contentEl);
            } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    },
  });
  return close;
}

function openCreateUserModal(tree, contentEl) {
  let kind = 'use'; // 'use' | 'admin'
  let adminRole = 'staff'; // 'staff' | 'super'
  // Đổi Vai trò (data-admin-role) vẽ lại cả form -> phải tự giữ lại những gì
  // đã gõ (tên đăng nhập/họ tên/mật khẩu) trước khi vẽ lại, không thì mất
  // trắng mỗi lần đổi qua lại giữa "Chỉ xem"/"Toàn quyền".
  let adminUsername = '', adminName = '', adminPassword = '';
  // Nhân viên có cờ canManageUsers (không phải Toàn quyền thật) vào được
  // trang này nhưng KHÔNG được tự tạo tài khoản Toàn quyền — server cũng tự
  // chặn lại (403/ép về staff) nếu cố tình gửi lên, đây chỉ là ẩn lựa chọn
  // đó khỏi giao diện cho đỡ rối, tránh tưởng nhầm là tạo được.
  const viewerIsSuper = S.isSuperAdmin(S.getSession()?.id);

  const close = openModal({
    title: 'Tạo User',
    bodyHtml: `<div id="cu-body"></div>`,
    footHtml: `<button class="btn btn-primary btn-block" id="cu-save">Tạo User</button>`,
    onMount(sheet, closeFn) {
      const body = sheet.querySelector('#cu-body');
      function draw2() {
        body.innerHTML = `
          ${viewerIsSuper ? `
          <div class="field">
            <label>Loại tài khoản</label>
            <div class="radio-row">
              <div class="radio-opt ${kind === 'use' ? 'active' : ''}" data-kind="use">Use (khách hàng)</div>
              <div class="radio-opt ${kind === 'admin' ? 'active' : ''}" data-kind="admin">Quản trị viên</div>
            </div>
          </div>
          ` : ''}
          ${kind === 'use' ? `
          <form id="use-form">
            <div class="field"><label>Số CCCD</label><input name="cccd" required pattern="\\d{9,12}"/></div>
            <div class="field">
              <label>Mật khẩu đăng nhập</label>
              <input name="password" placeholder="Để trống sẽ tự sinh mật khẩu"/>
              <div class="field-hint">Đây là mật khẩu để User đăng nhập lần đầu — có thể tự đặt hoặc để trống cho hệ thống tự sinh, hiện ra sau khi lưu để gửi cho khách.</div>
            </div>
            <div class="field-hint mb-8">Không cần nhập họ tên/SĐT/địa chỉ — nhập file Excel có CCCD này thì User sẽ tự động đồng bộ lấy đúng thông tin, tự thấy ngay hợp đồng khớp CCCD.</div>
          </form>
          ` : `
          <form id="admin-form">
            <div class="field"><label>Tên đăng nhập</label><input name="username" required placeholder="VD: nhanvien2" value="${escapeHtml(adminUsername)}"/></div>
            <div class="field"><label>Họ tên</label><input name="name" required value="${escapeHtml(adminName)}"/></div>
            <div class="field">
              <label>Mật khẩu</label>
              <input name="password" placeholder="Để trống sẽ tự sinh mật khẩu" value="${escapeHtml(adminPassword)}"/>
            </div>
            ${viewerIsSuper ? `
            <div class="field">
              <label>Vai trò</label>
              <div class="radio-row">
                <div class="radio-opt ${adminRole === 'staff' ? 'active' : ''}" data-admin-role="staff">Chỉ xem (nhân viên)</div>
                <div class="radio-opt ${adminRole === 'super' ? 'active' : ''}" data-admin-role="super">Toàn quyền</div>
              </div>
            </div>
            ` : ''}
            ${adminRole === 'staff' ? `
            <div class="field">
              <label>Địa bàn được xem</label>
              <div class="field-hint mb-8">Tích cả Thôn để xem toàn bộ Xóm trong Thôn đó, hoặc bấm riêng từng Xóm nếu chỉ cần xem 1 phần của Thôn.</div>
              ${permissionTreeHtml(tree, null)}
              <label class="flex items-center gap-8 mt-16" style="cursor:pointer;font-weight:700;font-size:14px">
                <input type="checkbox" name="canManageUsers"/>
                Cho phép quản lý User
              </label>
              <div class="field-hint">Tích vào đây thì nhân viên này vào được trang "Quản lý User" — tự tạo/sửa/xóa Use và nhân viên khác (không tạo được tài khoản Toàn quyền).</div>
            </div>
            ` : `<p class="field-hint">Quản trị viên toàn quyền xem được mọi địa bàn và truy cập Cài đặt, Quản lý User.</p>`}
          </form>
          `}
        `;
        body.querySelectorAll('[data-kind]').forEach((opt) => opt.addEventListener('click', () => { kind = opt.dataset.kind; draw2(); }));
        body.querySelectorAll('[data-admin-role]').forEach((opt) => opt.addEventListener('click', () => {
          // Giữ lại dữ liệu đã nhập trước khi vẽ lại form theo vai trò mới.
          const form = body.querySelector('#admin-form');
          if (form) {
            adminUsername = form.username.value;
            adminName = form.name.value;
            adminPassword = form.password.value;
          }
          adminRole = opt.dataset.adminRole;
          draw2();
        }));
        bindPermissionTreeChips(body);
      }
      draw2();

      sheet.querySelector('#cu-save').addEventListener('click', async () => {
        if (kind === 'use') {
          const form = sheet.querySelector('#use-form');
          if (!form.reportValidity()) return;
          const fd = new FormData(form);
          try {
            const res = await S.activateCustomerAccount({ cccd: fd.get('cccd'), password: fd.get('password') });
            closeFn();
            toast('Đã tạo User mới', 'success');
            showCredential('Đã tạo User', res.customer.cccd, res.tempPassword);
            draw(contentEl);
          } catch (err) {
            toast(err.message || 'Có lỗi xảy ra', 'error');
          }
        } else {
          const form = sheet.querySelector('#admin-form');
          if (!form.reportValidity()) return;
          const fd = new FormData(form);
          try {
            const { staff, tempPassword } = await S.addStaffAdmin({
              username: fd.get('username'), name: fd.get('name'), password: fd.get('password'),
              role: adminRole, allowedThon: fd.getAll('thon'), allowedXom: fd.getAll('xom'),
              canManageUsers: fd.get('canManageUsers') === 'on',
            });
            closeFn();
            toast('Đã tạo quản trị viên', 'success');
            showCredential('Đã tạo quản trị viên', staff.username, tempPassword);
            draw(contentEl);
          } catch (err) {
            toast(err.message || 'Có lỗi xảy ra', 'error');
          }
        }
      });
    },
  });
  return close;
}
