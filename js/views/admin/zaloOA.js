// Trang "Quản lý OA" — quản lý gửi tin Zalo OA (ZBS Template Message), 2 tầng:
//   Tầng 1 "Danh sách OA": khách hàng nào "có Zalo, đủ điều kiện gửi" — theo
//     KHÁCH HÀNG (không hiện thông tin hợp đồng ở đây), CHUNG cho mọi người
//     có quyền (không riêng ai), giống "Use" không tự xóa khi hết hợp
//     đồng/dư nợ. "Đến hạn/Quá hạn" tự động áp dụng cho MỌI hợp đồng của
//     khách trong danh sách này, không cần chọn riêng.
//   Tầng 2 "Gửi tin tự động": CHỈ còn 2 mục báo lãi (Báo lãi tự động hàng
//     tháng / Gửi theo ngày cụ thể), RÚT RA từ khách đã ở Tầng 1 — RIÊNG TƯ
//     theo từng người tự chọn, 1 hợp đồng chỉ ở được 1 trong 2 mục (loại
//     trừ nhau) và chỉ 1 người chọn được — người khác cố chọn trùng bị
//     chặn, báo rõ tên người đã chọn + mục họ chọn.
//   "Quản lý gửi tin": log mọi lần gửi (tự động lẫn gửi tay) — thành công/lỗi.
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
  let visibleCount = PAGE_SIZE;
  const selected = new Set();

  const close = openModal({
    title: 'Thêm khách hàng vào OA',
    bodyHtml: `
      ${searchBoxHtml('add-oa-search', 'Tìm theo tên, số CCCD, SĐT...', '')}
      <div class="filter-row mb-8" id="add-oa-pills"></div>
      <div id="add-oa-list" class="mt-8"></div>
      <button class="btn btn-outline btn-sm btn-block mt-8" id="add-oa-more" style="display:none">Xem thêm</button>
    `,
    footHtml: `<button class="btn btn-primary btn-block" id="add-oa-confirm" disabled>Thêm đã chọn (0)</button>`,
    onMount(sheet, closeFn) {
      function getFiltered() {
        let list = S.listCustomers({ adminId: isStaff ? admin.id : undefined }).filter((c) => !zaloIds.has(c.id));
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
          () => { visibleCount = PAGE_SIZE; renderPills(); draw(); });
      }
      function updateConfirmBtn() {
        const btn = sheet.querySelector('#add-oa-confirm');
        btn.textContent = `Thêm đã chọn (${selected.size})`;
        btn.disabled = selected.size === 0;
      }
      function draw() {
        const all = getFiltered();
        const list = all.slice(0, visibleCount);
        sheet.querySelector('#add-oa-list').innerHTML = list.length ? list.map((c) => `
          <div class="list-row" data-row="${c.id}" style="cursor:pointer;padding:8px 4px">
            <input type="checkbox" data-check="${c.id}" ${selected.has(c.id) ? 'checked' : ''} style="width:18px;height:18px;flex-shrink:0"/>
            <div class="row-thumb" style="background:${colorFor(c.id)}">${initials(c.name)}</div>
            <div class="row-main">
              <div class="row-title" style="font-size:13.5px">${c.name}</div>
              <div class="row-sub">${c.address || [c.xom, c.thon, c.tinh].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</div>
            </div>
            ${c.phone ? `<span style="color:var(--text-muted);font-size:12.5px;white-space:nowrap">${c.phone}</span>` : ''}
          </div>
        `).join('') : `<p class="text-sm text-muted">Không có khách hàng phù hợp (đã lọc bớt khách đã có sẵn trong danh sách OA).</p>`;
        sheet.querySelector('#add-oa-more').style.display = all.length > visibleCount ? '' : 'none';
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
      sheet.querySelector('#add-oa-more').addEventListener('click', () => { visibleCount += PAGE_SIZE; draw(); });
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
      bindSearchBox(sheet, 'add-oa-search', (v) => { query = v; visibleCount = PAGE_SIZE; draw(); });
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
function drawAutoTab(slot, admin) {
  slot.innerHTML = `
    <p class="text-sm text-muted mb-8">Chỉ hiện đúng những lựa chọn CHÍNH BẠN đã chọn — đồng nghiệp khác (kể cả cùng địa bàn) không thấy được lựa chọn của bạn và ngược lại. 1 hợp đồng chỉ ở được 1 trong 2 mục dưới đây.</p>
    ${AUTO_SEND_SECTIONS.map((s) => `
      <div class="card card-pad mb-16">
        <div class="section-head"><h2 style="font-size:14px">${s.title}</h2></div>
        <div id="auto-list-${s.kind}"></div>
        <button class="btn btn-outline btn-sm btn-block mt-8" data-add-kind="${s.kind}">${s.addLabel}</button>
      </div>
    `).join('')}
  `;
  AUTO_SEND_SECTIONS.forEach((s) => drawSection(s.kind));
  slot.querySelectorAll('[data-add-kind]').forEach((btn) => {
    btn.addEventListener('click', () => openAddAutoSendModal(btn.dataset.addKind, admin, () => AUTO_SEND_SECTIONS.forEach((s) => drawSection(s.kind))));
  });

  function drawSection(kind) {
    const listEl = slot.querySelector(`#auto-list-${kind}`);
    const rows = S.listZaloAutoSendByKind(kind)
      .map((r) => ({ r, customer: S.getCustomer(r.customerId), contract: S.getContract(r.contractId) }))
      .filter((x) => x.customer && x.contract);
    listEl.innerHTML = rows.length ? rows.map(({ r, customer, contract }) => `
      <div class="list-row" data-row="${r.id}" data-contract="${contract.id}" data-customer="${customer.id}" style="cursor:pointer;padding:8px 4px">
        <div class="row-main">
          <div class="row-title" style="font-size:13.5px">${customer.name} · ${contract.code}</div>
          <div class="row-sub">${formatVND(contract.balance)}${r.customDay ? ` · Ngày ${r.customDay} hàng tháng (bấm để sửa ngày)` : ''}</div>
        </div>
        <button class="icon-btn" data-remove="${r.id}" title="Bỏ khỏi danh sách">${icon('trash', 'icon-sm')}</button>
      </div>
    `).join('') : `<p class="text-sm text-muted">Chưa có hợp đồng nào.</p>`;
    listEl.querySelectorAll('[data-row]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove]')) return;
        if (kind === 'lai_hang_thang_custom_day') {
          openEditCustomDayModal(row.dataset.row, () => drawSection(kind));
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
            try { await S.removeZaloAutoSend(btn.dataset.remove); toast('Đã bỏ khỏi danh sách', 'success'); drawSection(kind); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    });
  }
}

/** Popup sửa ngày gửi (mục "Gửi theo ngày cụ thể"). */
function openEditCustomDayModal(id, onDone) {
  const row = S.listZaloAutoSend().find((r) => r.id === id);
  const close = openModal({
    title: 'Sửa ngày gửi hàng tháng',
    bodyHtml: `<div class="field"><label>Ngày trong tháng (1-28)</label><input type="number" id="edit-day-input" min="1" max="28" value="${row ? row.customDay || 1 : 1}"/></div>`,
    footHtml: `<button class="btn btn-primary btn-block" id="edit-day-confirm">Lưu</button>`,
    onMount(sheet, closeFn) {
      sheet.querySelector('#edit-day-confirm').addEventListener('click', async () => {
        const day = Number(sheet.querySelector('#edit-day-input').value) || 1;
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
      ${isCustomDay ? `<div class="field"><label>Ngày trong tháng (1-28) — áp dụng cho hợp đồng bạn chọn thêm bên dưới</label><input type="number" id="day-input" min="1" max="28" value="1"/></div>` : ''}
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
            const customDay = isCustomDay ? (Number(sheet.querySelector('#day-input').value) || 1) : null;
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
      renderPills();
      draw();
    },
  });
  return close;
}

// ------------------------------------------------------------
// Tab "Quản lý gửi tin" (log)
// ------------------------------------------------------------
function drawLogTab(slot) {
  const logs = S.listZaloSendLog();
  const successCount = logs.filter((l) => l.status === 'success').length;
  const errorCount = logs.filter((l) => l.status === 'error').length;
  slot.innerHTML = `
    <div class="text-sm text-muted mb-8">${logs.length} lần gửi gần nhất · <b style="color:var(--success)">${successCount} thành công</b> · <b style="color:var(--danger)">${errorCount} lỗi</b></div>
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
    }).join('') : emptyState({ iconName: 'message', title: 'Chưa có lần gửi nào', message: 'Log sẽ hiện ở đây sau khi hệ thống gửi tin Zalo (tự động hoặc gửi tay).' })}
  `;
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
