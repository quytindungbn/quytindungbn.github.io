// Trang "Quản lý OA" — quản lý gửi tin Zalo OA (ZBS Template Message), 2 tầng:
//   Tầng 1 "Danh sách OA": khách hàng nào "có Zalo, đủ điều kiện gửi" — theo
//     KHÁCH HÀNG (không hiện thông tin hợp đồng ở đây), CHUNG cho mọi người
//     có quyền (không riêng ai), giống "Use" không tự xóa khi hết hợp
//     đồng/dư nợ. Là điều kiện BẮT BUỘC để gửi tay mẫu "Đến hạn/Quá hạn" ở
//     chi tiết hợp đồng — mẫu này KHÔNG tự động gửi (chỉ gửi tay, giới hạn
//     5 ngày/lần cho mỗi hợp đồng).
//   Tầng 2 "Gửi tin tự động": CHỈ còn 2 mục báo lãi (Báo lãi tự động hàng
//     tháng / Gửi theo ngày cụ thể), RÚT RA từ khách đã ở Tầng 1 — RIÊNG TƯ
//     theo từng người tự chọn, 1 hợp đồng chỉ ở được 1 trong 2 mục (loại
//     trừ nhau) và chỉ 1 người chọn được — người khác cố chọn trùng bị
//     chặn, báo rõ tên người đã chọn + mục họ chọn.
//   "Quản lý gửi tin": log mọi lần gửi (tự động lẫn gửi tay) — thành công/lỗi,
//     lọc được theo trạng thái + khoảng thời gian.
//   "Cấu hình" (CHỈ quản trị viên toàn quyền): nhập Template ID cho 2 mẫu
//     ("Đến hạn" và "Báo lãi").
import * as S from '../../state.js';
import { icon } from '../../icons.js';
import { pageHeader } from '../../components/shell.js';
import { emptyState, openPicker, pillSelectHtml, searchBoxHtml, bindSearchBox } from '../../components/ui.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { formatDateTime, formatVND, colorFor, initials } from '../../utils.js';
import { openCustomerDetail, openContractView } from './customers.js';

const AUTO_SEND_SECTIONS = [
  { kind: 'lai_hang_thang_auto', title: 'Báo lãi tự động hàng tháng', addLabel: '+ Thêm hợp đồng' },
  { kind: 'lai_hang_thang_custom_day', title: 'Gửi theo ngày cụ thể', addLabel: '+ Thêm hợp đồng' },
];
const PAGE_SIZE = 20; // hiện ít trước, bấm "Xem thêm" mới tải thêm — tránh dồn cả danh sách dài gây chậm/khó kéo

let activeTab = 'oa';
let filterThon = [];
let filterXom = [];
let logStatusFilter = 'all'; // 'all' | 'success' | 'error'
let logFromDate = ''; // yyyy-mm-dd, rỗng = không giới hạn
let logToDate = '';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Quản lý OA' });
}

function currentAdmin() {
  const session = S.getSession();
  return S.getAdmin(session.id);
}

export function render(contentEl) {
  const admin = currentAdmin();
  const isSuper = admin.role === 'super';

  contentEl.innerHTML = `
    <div class="segmented-row mb-16">
      <button class="${activeTab === 'oa' ? 'active' : ''}" data-tab="oa">Danh sách OA</button>
      <button class="${activeTab === 'auto' ? 'active' : ''}" data-tab="auto">Gửi tin tự động</button>
      <button class="${activeTab === 'log' ? 'active' : ''}" data-tab="log">Quản lý gửi tin</button>
      ${isSuper ? `<button class="${activeTab === 'config' ? 'active' : ''}" data-tab="config">Cấu hình</button>` : ''}
    </div>
    <div id="zalo-tab-content"></div>
  `;
  contentEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { activeTab = btn.dataset.tab; render(contentEl); });
  });

  const slot = contentEl.querySelector('#zalo-tab-content');
  if (activeTab === 'oa') drawOATab(slot, admin);
  else if (activeTab === 'auto') drawAutoTab(slot, admin);
  else if (activeTab === 'log') drawLogTab(slot);
  else drawConfigTab(slot);
}

// ------------------------------------------------------------
// Bộ lọc Thôn/Xóm dùng chung — KHÔNG gắn cứng vào 1 biến module-level, để
// dùng lại được cho cả bộ lọc ở tab lẫn bộ lọc RIÊNG bên trong từng popup
// (mỗi nơi tự giữ state của mình qua get/set, tránh đụng lẫn nhau).
// ------------------------------------------------------------
function thonXomFilterPillsHtml(idPrefix, thon, xom) {
  return `
    ${pillSelectHtml(`${idPrefix}-thon`, multiPillLabel('Thôn', thon), thon.length > 0)}
    ${pillSelectHtml(`${idPrefix}-xom`, multiPillLabel('Xóm', xom), xom.length > 0)}
  `;
}
function bindThonXomFilterPills(wrap, idPrefix, allowedThon, getState, setState, onChange) {
  wrap.querySelector(`#${idPrefix}-thon`).addEventListener('click', () => {
    openPicker({
      title: 'Chọn Thôn (chọn được nhiều)', selected: getState().thon, multiSelect: true,
      options: allowedThon.map((t) => ({ value: t, label: t })),
      onSelect: (vals) => { setState(vals, []); onChange(); },
    });
  });
  wrap.querySelector(`#${idPrefix}-xom`).addEventListener('click', () => {
    const xomList = S.distinctXom(getState().thon.length ? getState().thon : undefined);
    openPicker({
      title: 'Chọn Xóm (chọn được nhiều)', selected: getState().xom, multiSelect: true,
      options: xomList.map((x) => ({ value: x, label: x })),
      onSelect: (vals) => { setState(getState().thon, vals); onChange(); },
    });
  });
  wrap.querySelectorAll('[data-pill-clear]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.pillClear;
      if (id === `${idPrefix}-thon`) setState([], []);
      else if (id === `${idPrefix}-xom`) setState(getState().thon, []);
      onChange();
    });
  });
}
function multiPillLabel(label, arr) {
  if (!arr.length) return label;
  return `${label}: ${arr.length} đã chọn `;
}

// ------------------------------------------------------------
// Tab "Danh sách OA" (Tầng 1) — CHUNG cho mọi người có quyền. KHÔNG hiện
// thông tin hợp đồng ở đây (chỉ khi thêm vào Tầng 2 mới cần chọn hợp đồng).
// ------------------------------------------------------------
function drawOATab(slot, admin) {
  const isStaff = admin.role === 'staff';
  const allowedThon = isStaff ? (admin.allowedThon || []) : S.distinctThon();

  slot.innerHTML = `
    <button class="btn btn-primary btn-sm mb-8" id="btn-add-oa">${icon('plus', 'icon-sm')} Thêm khách hàng vào OA</button>
    <div class="filter-row mb-8" id="oa-filter-pills"></div>
    <div id="oa-list"></div>
  `;
  slot.querySelector('#btn-add-oa').addEventListener('click', () => openAddCustomerToOAModal(admin, drawList));
  renderPills();
  drawList();

  function renderPills() {
    const wrap = slot.querySelector('#oa-filter-pills');
    wrap.innerHTML = thonXomFilterPillsHtml('oa-pill', filterThon, filterXom);
    bindThonXomFilterPills(wrap, 'oa-pill', allowedThon,
      () => ({ thon: filterThon, xom: filterXom }),
      (t, x) => { filterThon = t; filterXom = x; },
      () => { renderPills(); drawList(); });
  }

  function drawList() {
    const listEl = slot.querySelector('#oa-list');
    let rows = S.listZaloCustomers().map((r) => ({ r, customer: S.getCustomer(r.customerId) })).filter((x) => x.customer);
    if (filterThon.length) rows = rows.filter((x) => filterThon.includes(x.customer.thon));
    if (filterXom.length) rows = rows.filter((x) => filterXom.includes(x.customer.xom));

    listEl.innerHTML = `
      <div class="text-sm text-muted mb-8">${rows.length} khách hàng trong danh sách OA</div>
      ${rows.length ? rows.map(({ r, customer }) => `
        <div class="list-row" data-open="${customer.id}" style="cursor:pointer;padding:12px 4px">
          <div class="row-thumb" style="background:${colorFor(customer.id)}">${initials(customer.name)}</div>
          <div class="row-main">
            <div class="row-title">${customer.name}</div>
            <div class="row-sub">${[customer.xom, customer.thon].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</div>
          </div>
          ${customer.phone ? `<a href="tel:${customer.phone.replace(/\s/g, '')}" data-stop-row title="Gọi/tìm Zalo nhanh" style="color:var(--color-primary);font-weight:700;white-space:nowrap;text-decoration:none">${customer.phone}</a>` : ''}
        </div>
      `).join('') : emptyState({ iconName: 'message', title: 'Chưa có khách hàng nào', message: 'Bấm "Thêm khách hàng vào OA" ở trên, hoặc thêm ở chi tiết khách hàng (mục Khách hàng & Hợp đồng).' })}
    `;
    listEl.querySelectorAll('[data-open]').forEach((row) => {
      row.addEventListener('click', () => openCustomerDetail(row.dataset.open, { readOnly: false, context: 'customer' }));
    });
    // SĐT nằm TRONG dòng bấm-để-xem — chặn nổi bọt để bấm gọi không mở luôn chi tiết khách hàng.
    listEl.querySelectorAll('[data-stop-row]').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  }
}

/** Popup tìm + thêm (chọn nhiều) khách hàng vào Tầng 1 "Danh sách OA". */
function openAddCustomerToOAModal(admin, onDone) {
  const zaloIds = new Set(S.listZaloCustomers().map((r) => r.customerId));
  const isStaff = admin.role === 'staff';
  const allowedThon = isStaff ? (admin.allowedThon || []) : S.distinctThon();
  let query = '';
  let pThon = [];
  let pXom = [];
  const selected = new Set();

  const close = openModal({
    title: 'Thêm khách hàng vào OA',
    bodyHtml: `
      ${searchBoxHtml('add-oa-search', 'Tìm theo tên, số CCCD, SĐT...', '')}
      <div class="filter-row mb-8" id="add-oa-pills"></div>
      <div id="add-oa-list" class="mt-8"></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" id="add-oa-confirm" disabled>Thêm đã chọn (0)</button>`,
    onMount(sheet, closeFn) {
      function getFiltered() {
        // Chỉ gửi được Zalo cho khách CÓ SĐT — khách chưa có SĐT ẩn khỏi
        // danh sách này luôn, khỏi thêm nhầm rồi không gửi được.
        let list = S.listCustomers({ adminId: isStaff ? admin.id : undefined }).filter((c) => !zaloIds.has(c.id) && c.phone);
        if (pThon.length) list = list.filter((c) => pThon.includes(c.thon));
        if (pXom.length) list = list.filter((c) => pXom.includes(c.xom));
        if (query) {
          const q = query.toLowerCase();
          list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.cccd || '').includes(query) || (c.phone || '').includes(query));
        }
        return list;
      }
      function renderPills() {
        const wrap = sheet.querySelector('#add-oa-pills');
        wrap.innerHTML = thonXomFilterPillsHtml('add-oa-pill', pThon, pXom);
        bindThonXomFilterPills(wrap, 'add-oa-pill', allowedThon,
          () => ({ thon: pThon, xom: pXom }),
          (t, x) => { pThon = t; pXom = x; },
          () => { renderPills(); draw(); });
      }
      function updateConfirmBtn() {
        const btn = sheet.querySelector('#add-oa-confirm');
        btn.textContent = `Thêm đã chọn (${selected.size})`;
        btn.disabled = selected.size === 0;
      }
      function draw() {
        // Hiện TOÀN BỘ khách phù hợp (không phân trang) — mục này cần thấy
        // hết để tích chọn nhiều cùng lúc, có ô tìm + lọc Thôn/Xóm để thu hẹp.
        const list = getFiltered();
        // Checkbox + avatar thu nhỏ hơn hẳn mặc định (danh sách chọn nhiều,
        // ưu tiên chỗ cho tên — tên dài dễ bị che nếu 2 thứ này quá to).
        sheet.querySelector('#add-oa-list').innerHTML = list.length ? list.map((c) => `
          <div class="list-row" data-row="${c.id}" style="cursor:pointer;padding:8px 4px">
            <input type="checkbox" data-check="${c.id}" ${selected.has(c.id) ? 'checked' : ''} style="width:16px;height:16px;flex-shrink:0"/>
            <div class="row-thumb" style="background:${colorFor(c.id)};width:28px;height:28px;font-size:11px;border-radius:8px;flex-shrink:0">${initials(c.name)}</div>
            <div class="row-main">
              <div class="row-title" style="font-size:13.5px">${c.name}</div>
              <div class="row-sub">${c.address || [c.xom, c.thon, c.tinh].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</div>
            </div>
            <b style="font-size:13px;white-space:nowrap;flex-shrink:0">${c.phone}</b>
          </div>
        `).join('') : `<p class="text-sm text-muted">Không có khách hàng phù hợp (đã lọc bớt khách chưa có SĐT hoặc đã có sẵn trong danh sách OA).</p>`;
        sheet.querySelectorAll('[data-row]').forEach((row) => {
          row.addEventListener('click', (e) => {
            if (e.target.matches('[data-check]')) return; // để checkbox tự xử lý, khỏi bấm 2 lần
            const id = row.dataset.row;
            if (selected.has(id)) selected.delete(id); else selected.add(id);
            row.querySelector('[data-check]').checked = selected.has(id);
            updateConfirmBtn();
          });
        });
        sheet.querySelectorAll('[data-check]').forEach((cb) => {
          cb.addEventListener('change', () => {
            if (cb.checked) selected.add(cb.dataset.check); else selected.delete(cb.dataset.check);
            updateConfirmBtn();
          });
        });
      }
      sheet.querySelector('#add-oa-confirm').addEventListener('click', async () => {
        const ids = [...selected];
        if (!ids.length) return;
        const btn = sheet.querySelector('#add-oa-confirm');
        btn.disabled = true;
        let okCount = 0;
        for (const id of ids) {
          try { await S.addZaloCustomer(id); okCount++; } catch (err) { toast(`${err.message || 'Lỗi'} (bỏ qua, tiếp tục thêm phần còn lại)`, 'error'); }
        }
        if (okCount) toast(`Đã thêm ${okCount} khách hàng vào danh sách OA`, 'success');
        closeFn();
        if (onDone) onDone();
      });
      bindSearchBox(sheet, 'add-oa-search', (v) => { query = v; draw(); });
      renderPills();
      draw();
    },
  });
  return close;
}

// ------------------------------------------------------------
// Tab "Gửi tin tự động" (Tầng 2) — CHỈ hiện lựa chọn của CHÍNH người đang
// xem (server/RLS đã tự lọc). 2 mục quản lý riêng, loại trừ nhau.
// ------------------------------------------------------------
const AUTO_PREVIEW_COUNT = 4; // trang chính chỉ hiện vài dòng đầu — bấm "Xem chi tiết" mới ra hết + có tìm/lọc

function drawAutoTab(slot, admin) {
  slot.innerHTML = `
    <p class="text-sm text-muted mb-8">Chỉ hiện đúng những lựa chọn CHÍNH BẠN đã chọn — đồng nghiệp khác (kể cả cùng địa bàn) không thấy được lựa chọn của bạn và ngược lại. 1 hợp đồng chỉ ở được 1 trong 2 mục dưới đây.</p>
    ${AUTO_SEND_SECTIONS.map((s) => `
      <div class="card card-pad mb-16">
        <div class="section-head" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <h2 style="font-size:14px">${s.title}</h2>
          <button class="btn btn-outline btn-sm" data-view-all="${s.kind}" style="display:none;white-space:nowrap;flex-shrink:0">Xem chi tiết</button>
        </div>
        <div id="auto-list-${s.kind}"></div>
        <button class="btn btn-outline btn-sm btn-block mt-8" data-add-kind="${s.kind}">${s.addLabel}</button>
      </div>
    `).join('')}
  `;
  AUTO_SEND_SECTIONS.forEach((s) => drawSection(s.kind));
  slot.querySelectorAll('[data-add-kind]').forEach((btn) => {
    btn.addEventListener('click', () => openAddAutoSendModal(btn.dataset.addKind, admin, () => AUTO_SEND_SECTIONS.forEach((s) => drawSection(s.kind))));
  });
  // Gắn 1 LẦN duy nhất ở đây (nút "Xem chi tiết" nằm trong tiêu đề, KHÔNG bị
  // vẽ lại mỗi lần drawSection() như danh sách bên dưới) — tránh gắn trùng
  // nhiều listener nếu bind lại mỗi lần drawSection() chạy.
  slot.querySelectorAll('[data-view-all]').forEach((btn) => {
    const kind = btn.dataset.viewAll;
    btn.addEventListener('click', () => openAutoSendListModal(kind, admin, () => drawSection(kind)));
  });

  function drawSection(kind) {
    const listEl = slot.querySelector(`#auto-list-${kind}`);
    const viewAllBtn = slot.querySelector(`[data-view-all="${kind}"]`);
    const allRows = S.listZaloAutoSendByKind(kind)
      .map((r) => ({ r, customer: S.getCustomer(r.customerId), contract: S.getContract(r.contractId) }))
      .filter((x) => x.customer && x.contract);
    const preview = allRows.slice(0, AUTO_PREVIEW_COUNT);
    listEl.innerHTML = preview.length ? preview.map(({ r, customer, contract }) => autoSendRowHtml(kind, r, customer, contract)).join('') : `<p class="text-sm text-muted">Chưa có hợp đồng nào.</p>`;
    bindAutoRowHandlers(listEl, kind, () => drawSection(kind));
    if (viewAllBtn) {
      const hasMore = allRows.length > AUTO_PREVIEW_COUNT;
      viewAllBtn.style.display = hasMore ? '' : 'none';
      viewAllBtn.textContent = `Xem chi tiết (${allRows.length})`;
    }
  }
}

/**
 * Dòng hiển thị 1 hợp đồng trong 1 trong 2 mục Tầng 2 — dùng chung cho preview
 * lẫn popup "Xem chi tiết". Hàng trên hiện ĐỦ tên khách + mã hợp đồng (+ ngày
 * gửi đã chọn với mục "Gửi theo ngày cụ thể") — không còn bị số tiền chen vào
 * cùng hàng gây che khuất. Hàng dưới: địa chỉ bên trái, số tiền in đậm màu
 * xanh (color-primary) bên phải — GIỐNG NHAU cho cả 2 mục.
 */
function autoSendRowHtml(kind, r, customer, contract) {
  const addr = [customer.xom, customer.thon].filter(Boolean).join(', ') || 'Chưa có địa bàn';
  const dayLabel = kind === 'lai_hang_thang_custom_day' ? ` · Ngày ${r.customDay || '?'}` : '';
  return `
    <div class="list-row" data-row="${r.id}" data-contract="${contract.id}" data-customer="${customer.id}" style="cursor:pointer;padding:8px 4px">
      <div class="row-main">
        <div class="row-title" style="font-size:13.5px">${customer.name} · ${contract.code}${dayLabel}</div>
        <div class="row-sub" style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <span>${addr}</span>
          <b style="color:var(--color-primary);font-size:13px;white-space:nowrap;flex-shrink:0">${formatVND(contract.balance)}</b>
        </div>
      </div>
      <button class="icon-btn" data-remove="${r.id}" title="Bỏ khỏi danh sách">${icon('trash', 'icon-sm')}</button>
    </div>
  `;
}

/** Gắn sự kiện click-mở-chi-tiết/sửa-ngày + bấm-xóa cho danh sách dòng Tầng 2 — dùng chung cho preview lẫn popup. */
function bindAutoRowHandlers(listEl, kind, refresh) {
  listEl.querySelectorAll('[data-row]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove]')) return;
      if (kind === 'lai_hang_thang_custom_day') {
        openEditCustomDayModal(row.dataset.row, refresh);
      } else {
        openContractView(row.dataset.customer, S.getContract(row.dataset.contract), { readOnly: true });
      }
    });
  });
  listEl.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDialog({
        title: 'Bỏ khỏi danh sách gửi tự động?',
        message: 'Hợp đồng này sẽ không còn được tự động gửi tin Zalo nữa (vẫn gửi tay được bình thường).',
        danger: true, confirmLabel: 'Bỏ khỏi danh sách',
        onConfirm: async () => {
          try { await S.removeZaloAutoSend(btn.dataset.remove); toast('Đã bỏ khỏi danh sách', 'success'); refresh(); }
          catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
        },
      });
    });
  });
}

/** Popup "Xem chi tiết" — toàn bộ danh sách của 1 mục Tầng 2, có tìm + lọc Thôn/Xóm. */
function openAutoSendListModal(kind, admin, onDone) {
  const isStaff = admin.role === 'staff';
  const allowedThon = isStaff ? (admin.allowedThon || []) : S.distinctThon();
  let query = '';
  let pThon = [];
  let pXom = [];
  const section = AUTO_SEND_SECTIONS.find((s) => s.kind === kind);

  const close = openModal({
    title: section ? section.title : 'Danh sách',
    bodyHtml: `
      ${searchBoxHtml('auto-list-search', 'Tìm theo tên khách hoặc mã hợp đồng...', '')}
      <div class="filter-row mb-8" id="auto-list-pills"></div>
      <div id="auto-list-full" class="mt-8"></div>
    `,
    onMount(sheet) {
      function getRows() {
        let rows = S.listZaloAutoSendByKind(kind)
          .map((r) => ({ r, customer: S.getCustomer(r.customerId), contract: S.getContract(r.contractId) }))
          .filter((x) => x.customer && x.contract);
        if (pThon.length) rows = rows.filter((x) => pThon.includes(x.customer.thon));
        if (pXom.length) rows = rows.filter((x) => pXom.includes(x.customer.xom));
        if (query) {
          const q = query.toLowerCase();
          rows = rows.filter((x) => x.customer.name.toLowerCase().includes(q) || x.contract.code.toLowerCase().includes(q));
        }
        return rows;
      }
      function renderPills() {
        const wrap = sheet.querySelector('#auto-list-pills');
        wrap.innerHTML = thonXomFilterPillsHtml('auto-list-pill', pThon, pXom);
        bindThonXomFilterPills(wrap, 'auto-list-pill', allowedThon,
          () => ({ thon: pThon, xom: pXom }),
          (t, x) => { pThon = t; pXom = x; },
          () => { renderPills(); draw(); });
      }
      function refreshAll() { draw(); if (onDone) onDone(); }
      function draw() {
        const rows = getRows();
        const listEl = sheet.querySelector('#auto-list-full');
        listEl.innerHTML = rows.length ? rows.map(({ r, customer, contract }) => autoSendRowHtml(kind, r, customer, contract)).join('')
          : `<p class="text-sm text-muted">Không có hợp đồng nào phù hợp.</p>`;
        bindAutoRowHandlers(listEl, kind, refreshAll);
      }
      bindSearchBox(sheet, 'auto-list-search', (v) => { query = v; draw(); });
      renderPills();
      draw();
    },
  });
  return close;
}

/** Popup sửa ngày gửi (mục "Gửi theo ngày cụ thể"). */
function openEditCustomDayModal(id, onDone) {
  const row = S.listZaloAutoSend().find((r) => r.id === id);
  const close = openModal({
    title: 'Sửa ngày gửi hàng tháng',
    bodyHtml: `<div class="field"><label>Ngày trong tháng (1-30)</label><input type="number" id="edit-day-input" min="1" max="30" value="${row ? row.customDay || 1 : 1}"/></div>`,
    footHtml: `<button class="btn btn-primary btn-block" id="edit-day-confirm">Lưu</button>`,
    onMount(sheet, closeFn) {
      bindDayInputClamp(sheet.querySelector('#edit-day-input'));
      sheet.querySelector('#edit-day-confirm').addEventListener('click', async () => {
        const day = clampDay(sheet.querySelector('#edit-day-input').value);
        try {
          await S.updateZaloAutoSendDay(id, day);
          toast('Đã sửa ngày gửi', 'success');
          closeFn();
          if (onDone) onDone();
        } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
      });
    },
  });
  return close;
}

/** Popup tìm + thêm 1 hợp đồng vào 1 trong 2 mục Tầng 2 — chỉ liệt kê hợp đồng của khách ĐÃ ở Tầng 1 và CHƯA ở mục nào (loại trừ nhau). */
function openAddAutoSendModal(kind, admin, onDone) {
  const zaloCustomerIds = [...new Set(S.listZaloCustomers().map((r) => r.customerId))];
  const usedContractIds = new Set(S.listZaloAutoSend().map((r) => r.contractId));
  const isStaff = admin.role === 'staff';
  const allowedThon = isStaff ? (admin.allowedThon || []) : S.distinctThon();
  let query = '';
  let pThon = [];
  let pXom = [];
  let visibleCount = PAGE_SIZE;
  const isCustomDay = kind === 'lai_hang_thang_custom_day';

  const close = openModal({
    title: isCustomDay ? 'Thêm vào "Gửi theo ngày cụ thể"' : 'Thêm vào "Báo lãi tự động hàng tháng"',
    bodyHtml: `
      ${isCustomDay ? `<div class="field"><label>Ngày trong tháng (1-30) — áp dụng cho hợp đồng bạn chọn thêm bên dưới</label><input type="number" id="day-input" min="1" max="30" value="1"/></div>` : ''}
      ${searchBoxHtml('add-auto-search', 'Tìm theo tên khách hoặc mã hợp đồng...', '')}
      <div class="filter-row mb-8" id="add-auto-pills"></div>
      <div id="add-auto-list" class="mt-8"></div>
      <button class="btn btn-outline btn-sm btn-block mt-8" id="add-auto-more" style="display:none">Xem thêm</button>
    `,
    onMount(sheet) {
      function getRows() {
        let rows = [];
        for (const custId of zaloCustomerIds) {
          const customer = S.getCustomer(custId);
          if (!customer) continue;
          if (pThon.length && !pThon.includes(customer.thon)) continue;
          if (pXom.length && !pXom.includes(customer.xom)) continue;
          const contracts = S.listContractsByCustomer(custId).filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan' && !usedContractIds.has(ct.id));
          for (const contract of contracts) rows.push({ customer, contract });
        }
        if (query) {
          const q = query.toLowerCase();
          rows = rows.filter(({ customer, contract }) => customer.name.toLowerCase().includes(q) || contract.code.toLowerCase().includes(q));
        }
        return rows;
      }
      function renderPills() {
        const wrap = sheet.querySelector('#add-auto-pills');
        wrap.innerHTML = thonXomFilterPillsHtml('add-auto-pill', pThon, pXom);
        bindThonXomFilterPills(wrap, 'add-auto-pill', allowedThon,
          () => ({ thon: pThon, xom: pXom }),
          (t, x) => { pThon = t; pXom = x; },
          () => { visibleCount = PAGE_SIZE; renderPills(); draw(); });
      }
      function draw() {
        const all = getRows();
        const rows = all.slice(0, visibleCount);
        sheet.querySelector('#add-auto-list').innerHTML = rows.length ? rows.map(({ customer, contract }) => `
          <div class="list-row" data-add="${contract.id}" style="cursor:pointer;padding:8px 4px">
            <div class="row-main">
              <div class="row-title" style="font-size:13.5px">${customer.name} · ${contract.code}</div>
              <div class="row-sub">${[customer.xom, customer.thon].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</div>
            </div>
            <b style="color:var(--color-primary);font-size:13px;white-space:nowrap">${formatVND(contract.balance)}</b>
          </div>
        `).join('') : `<p class="text-sm text-muted">Không có hợp đồng nào để thêm — khách phải có trong Danh sách OA, có hợp đồng còn hoạt động, và chưa ở mục nào khác.</p>`;
        sheet.querySelector('#add-auto-more').style.display = all.length > visibleCount ? '' : 'none';
        sheet.querySelectorAll('[data-add]').forEach((row) => {
          row.addEventListener('click', async () => {
            const customDay = isCustomDay ? clampDay(sheet.querySelector('#day-input').value) : null;
            try {
              await S.addZaloAutoSend(row.dataset.add, kind, customDay);
              toast('Đã thêm vào danh sách gửi tự động', 'success');
              if (onDone) onDone();
              usedContractIds.add(row.dataset.add);
              draw(); // cho thêm tiếp hợp đồng khác liền tay, không cần mở lại popup
            } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          });
        });
      }
      sheet.querySelector('#add-auto-more').addEventListener('click', () => { visibleCount += PAGE_SIZE; draw(); });
      bindSearchBox(sheet, 'add-auto-search', (v) => { query = v; visibleCount = PAGE_SIZE; draw(); });
      if (isCustomDay) bindDayInputClamp(sheet.querySelector('#day-input'));
      renderPills();
      draw();
    },
  });
  return close;
}

/** Ngày gửi hàng tháng chỉ hợp lệ 1-30 (tháng nào cũng có) — ép về đúng khoảng khi lưu. */
function clampDay(value) {
  const n = Number(value) || 1;
  return Math.min(30, Math.max(1, n));
}
/** Chặn gõ tay vượt khoảng ngay khi nhập — thuộc tính max của input number chỉ chặn nút mũi tên, không chặn gõ tay. */
function bindDayInputClamp(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener('input', () => {
    if (inputEl.value === '') return;
    const clamped = clampDay(inputEl.value);
    if (String(clamped) !== inputEl.value) inputEl.value = clamped;
  });
}

// ------------------------------------------------------------
// Tab "Quản lý gửi tin" (log)
// ------------------------------------------------------------
function drawLogTab(slot) {
  slot.innerHTML = `
    <div class="segmented-row mb-8" id="log-status-filter">
      <button class="${logStatusFilter === 'all' ? 'active' : ''}" data-status="all">Tất cả</button>
      <button class="${logStatusFilter === 'success' ? 'active' : ''}" data-status="success">Thành công</button>
      <button class="${logStatusFilter === 'error' ? 'active' : ''}" data-status="error">Lỗi</button>
    </div>
    <div class="field-row mb-8">
      <div class="field"><label>Từ ngày</label><input type="date" id="log-from" value="${logFromDate}"/></div>
      <div class="field"><label>Đến ngày</label><input type="date" id="log-to" value="${logToDate}"/></div>
    </div>
    <div id="log-list"></div>
  `;
  slot.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      logStatusFilter = btn.dataset.status;
      slot.querySelectorAll('[data-status]').forEach((b) => b.classList.toggle('active', b.dataset.status === logStatusFilter));
      drawList();
    });
  });
  slot.querySelector('#log-from').addEventListener('change', (e) => { logFromDate = e.target.value; drawList(); });
  slot.querySelector('#log-to').addEventListener('change', (e) => { logToDate = e.target.value; drawList(); });
  drawList();

  function drawList() {
    // Nguồn dữ liệu là 200 lần gửi GẦN NHẤT (toàn hệ thống, xem state.js) —
    // lọc theo khoảng ngày cũ hơn phạm vi đó sẽ không thấy đủ, chấp nhận
    // được với quy mô hiện tại.
    let logs = S.listZaloSendLog();
    if (logStatusFilter !== 'all') logs = logs.filter((l) => l.status === logStatusFilter);
    if (logFromDate) logs = logs.filter((l) => new Date(l.sentAt) >= new Date(`${logFromDate}T00:00:00`));
    if (logToDate) logs = logs.filter((l) => new Date(l.sentAt) <= new Date(`${logToDate}T23:59:59`));
    const successCount = logs.filter((l) => l.status === 'success').length;
    const errorCount = logs.filter((l) => l.status === 'error').length;
    const hasFilter = logStatusFilter !== 'all' || logFromDate || logToDate;
    slot.querySelector('#log-list').innerHTML = `
      <div class="text-sm text-muted mb-8">${logs.length} lần gửi${hasFilter ? ' (đã lọc)' : ' gần nhất'} · <b style="color:var(--success)">${successCount} thành công</b> · <b style="color:var(--danger)">${errorCount} lỗi</b></div>
      ${logs.length ? logs.map((l) => {
        const customer = S.getCustomer(l.customerId);
        const contract = l.contractId ? S.getContract(l.contractId) : null;
        return `
        <div class="list-row" style="padding:12px 4px">
          <div class="row-thumb" style="background:${l.status === 'success' ? 'var(--success)' : 'var(--danger)'}">${icon(l.status === 'success' ? 'check' : 'x', 'icon-sm')}</div>
          <div class="row-main">
            <div class="row-title">${customer ? customer.name : '—'}${contract ? ' · ' + contract.code : ''}</div>
            <div class="row-sub">${formatDateTime(l.sentAt)} · ${l.triggeredBy === 'manual' ? 'Gửi tay' : 'Tự động'}${l.status === 'error' && l.errorMessage ? ' · ' + l.errorMessage : ''}</div>
          </div>
        </div>`;
      }).join('') : emptyState({ iconName: 'message', title: 'Không có lần gửi nào phù hợp', message: hasFilter ? 'Thử bỏ bớt bộ lọc trạng thái/thời gian.' : 'Log sẽ hiện ở đây sau khi hệ thống gửi tin Zalo (tự động hoặc gửi tay).' })}
    `;
  }
}

// ------------------------------------------------------------
// Tab "Cấu hình" (chỉ super) — 2 mẫu: Đến hạn + Báo lãi.
// ------------------------------------------------------------
function drawConfigTab(slot) {
  const org = S.getOrg();
  slot.innerHTML = `
    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Trạng thái</h2></div>
      <p class="text-sm text-muted">
        ${org.zaloTemplateDueId ? `Mẫu "Đến hạn/Quá hạn" đã cấu hình — tự động gửi cho MỌI hợp đồng của khách trong "Danh sách OA" khi đến/quá hạn.` : `Chưa cấu hình mẫu "Đến hạn/Quá hạn".`}
        ${org.zaloTemplateInterestId ? ` Mẫu "Báo lãi" đã cấu hình — dùng cho 2 mục ở "Gửi tin tự động" và gửi tay khi hợp đồng chưa đến hạn.` : ` Chưa cấu hình mẫu "Báo lãi".`}
      </p>
    </div>

    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Mẫu tin theo tình huống</h2></div>
      <p class="text-sm text-muted mb-8">
        Template ID lấy từ trang quản lý mẫu ZBS Template Message (mục "Quản lý Template" trên Zalo) —
        mẫu phải ở trạng thái <b>"Đã duyệt"</b> mới dùng được.
      </p>
      <form id="zalo-form">
        <div class="field">
          <label>Mẫu "Đến hạn/Quá hạn" (Template ID)</label>
          <input name="zaloTemplateDueId" value="${esc(org.zaloTemplateDueId)}" placeholder="VD: 519351"/>
        </div>
        <div class="field">
          <label>Mẫu "Báo lãi" (Template ID)</label>
          <input name="zaloTemplateInterestId" value="${esc(org.zaloTemplateInterestId)}" placeholder="Dán Template ID khi đã tạo xong mẫu này bên Zalo"/>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Lưu cấu hình</button>
      </form>
    </div>

    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Kết nối kỹ thuật (App ID/Secret Key/Token)</h2></div>
      <p class="text-sm text-muted">
        Vì lý do an toàn, 4 thông tin này (App ID, Secret Key, Access Token, Refresh Token) KHÔNG cấu
        hình qua màn hình này — chúng chỉ được lưu ở phía máy chủ (Supabase Secrets + 1 bảng riêng chỉ
        server đọc được), không hiện ra trình duyệt kể cả với quản trị viên toàn quyền. Việc thiết lập
        ban đầu đã làm cùng nhau qua chat — nếu cần đổi App/Token mới, báo lại để cập nhật.
      </p>
    </div>
  `;

  slot.querySelector('#zalo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await S.updateOrg({ zaloTemplateDueId: fd.get('zaloTemplateDueId').trim(), zaloTemplateInterestId: fd.get('zaloTemplateInterestId').trim() });
      toast('Đã lưu cấu hình Zalo OA', 'success');
      drawConfigTab(slot);
    } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
  });
}
function esc(s) { return String(s || '').replace(/"/g, '&quot;'); }
