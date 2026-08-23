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
import { formatDateTime, formatVND, colorFor, initials, maskCccd } from '../../utils.js';
import { openCustomerDetail } from './customers.js';

const AUTO_SEND_SECTIONS = [
  { kind: 'lai_hang_thang_auto', title: 'Báo lãi tự động hàng tháng', addLabel: '+ Thêm hợp đồng' },
  { kind: 'lai_hang_thang_custom_day', title: 'Gửi theo ngày cụ thể', addLabel: '+ Thêm hợp đồng' },
];

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

function thonXomFilterPillsHtml(idPrefix) {
  return `
    ${pillSelectHtml(`${idPrefix}-thon`, multiPillLabel('Thôn', filterThon), filterThon.length > 0)}
    ${pillSelectHtml(`${idPrefix}-xom`, multiPillLabel('Xóm', filterXom), filterXom.length > 0)}
  `;
}
function bindThonXomFilterPills(wrap, idPrefix, allowedThon, onChange) {
  wrap.querySelector(`#${idPrefix}-thon`).addEventListener('click', () => {
    openPicker({
      title: 'Chọn Thôn (chọn được nhiều)', selected: filterThon, multiSelect: true,
      options: allowedThon.map((t) => ({ value: t, label: t })),
      onSelect: (vals) => { filterThon = vals; filterXom = []; onChange(); },
    });
  });
  wrap.querySelector(`#${idPrefix}-xom`).addEventListener('click', () => {
    const xomList = S.distinctXom(filterThon.length ? filterThon : undefined);
    openPicker({
      title: 'Chọn Xóm (chọn được nhiều)', selected: filterXom, multiSelect: true,
      options: xomList.map((x) => ({ value: x, label: x })),
      onSelect: (vals) => { filterXom = vals; onChange(); },
    });
  });
  wrap.querySelectorAll('[data-pill-clear]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.pillClear;
      if (id === `${idPrefix}-thon`) { filterThon = []; filterXom = []; }
      else if (id === `${idPrefix}-xom`) { filterXom = []; }
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
  slot.querySelector('#btn-add-oa').addEventListener('click', () => openAddCustomerToOAModal(drawList));
  renderPills();
  drawList();

  function renderPills() {
    const wrap = slot.querySelector('#oa-filter-pills');
    wrap.innerHTML = thonXomFilterPillsHtml('oa-pill');
    bindThonXomFilterPills(wrap, 'oa-pill', allowedThon, () => { renderPills(); drawList(); });
  }

  function drawList() {
    const listEl = slot.querySelector('#oa-list');
    let rows = S.listZaloCustomers().map((r) => ({ r, customer: S.getCustomer(r.customerId) })).filter((x) => x.customer);
    if (filterThon.length) rows = rows.filter((x) => filterThon.includes(x.customer.thon));
    if (filterXom.length) rows = rows.filter((x) => filterXom.includes(`${x.customer.thon}||${x.customer.xom}`));

    listEl.innerHTML = `
      <div class="text-sm text-muted mb-8">${rows.length} khách hàng trong danh sách OA</div>
      ${rows.length ? rows.map(({ r, customer }) => `
        <div class="list-row" data-open="${customer.id}" style="cursor:pointer;padding:12px 4px">
          <div class="row-thumb" style="background:${colorFor(customer.id)}">${initials(customer.name)}</div>
          <div class="row-main">
            <div class="row-title">${customer.name}</div>
            <div class="row-sub">${[customer.xom, customer.thon].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</div>
          </div>
          ${customer.phone ? `<a href="tel:${customer.phone.replace(/\s/g, '')}" class="icon-btn" data-stop-row title="Gọi/tìm Zalo nhanh" style="color:var(--color-primary)">${icon('phone', 'icon-sm')}</a>` : ''}
        </div>
      `).join('') : emptyState({ iconName: 'message', title: 'Chưa có khách hàng nào', message: 'Bấm "Thêm khách hàng vào OA" ở trên, hoặc thêm ở chi tiết khách hàng (mục Khách hàng & Hợp đồng).' })}
    `;
    listEl.querySelectorAll('[data-open]').forEach((row) => {
      row.addEventListener('click', () => openCustomerDetail(row.dataset.open, { readOnly: false, context: 'customer' }));
    });
    // Nút gọi điện nằm TRONG dòng bấm-để-xem — chặn nổi bọt để bấm gọi không mở luôn chi tiết khách hàng.
    listEl.querySelectorAll('[data-stop-row]').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  }
}

/** Popup tìm + thêm khách hàng vào Tầng 1 "Danh sách OA". */
function openAddCustomerToOAModal(onDone) {
  const zaloIds = new Set(S.listZaloCustomers().map((r) => r.customerId));
  let query = '';
  const close = openModal({
    title: 'Thêm khách hàng vào OA',
    bodyHtml: `
      ${searchBoxHtml('add-oa-search', 'Tìm theo tên, số CCCD, SĐT...', '')}
      <div id="add-oa-list" class="mt-8"></div>
    `,
    onMount(sheet) {
      function draw() {
        let list = S.listCustomers().filter((c) => !zaloIds.has(c.id));
        if (query) {
          const q = query.toLowerCase();
          list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.cccd || '').includes(query) || (c.phone || '').includes(query));
        }
        list = list.slice(0, 50);
        sheet.querySelector('#add-oa-list').innerHTML = list.length ? list.map((c) => `
          <div class="list-row" data-add="${c.id}" style="cursor:pointer;padding:8px 4px">
            <div class="row-thumb" style="background:${colorFor(c.id)}">${initials(c.name)}</div>
            <div class="row-main"><div class="row-title" style="font-size:13.5px">${c.name}</div><div class="row-sub">${maskCccd(c.cccd)}</div></div>
          </div>
        `).join('') : `<p class="text-sm text-muted">Không có khách hàng phù hợp (đã lọc bớt khách đã có sẵn trong danh sách OA).</p>`;
        sheet.querySelectorAll('[data-add]').forEach((row) => {
          row.addEventListener('click', async () => {
            try {
              await S.addZaloCustomer(row.dataset.add);
              toast('Đã thêm vào danh sách OA', 'success');
              if (onDone) onDone();
              draw(); // vẽ lại danh sách trong popup luôn (bớt đi 1 người vừa thêm), cho thêm tiếp được liền tay
            } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          });
        });
      }
      bindSearchBox(sheet, 'add-oa-search', (v) => { query = v; draw(); });
      draw();
    },
  });
  return close;
}

// ------------------------------------------------------------
// Tab "Gửi tin tự động" (Tầng 2) — CHỈ hiện lựa chọn của CHÍNH người đang
// xem (server/RLS đã tự lọc). 2 mục quản lý riêng, loại trừ nhau.
// ------------------------------------------------------------
function drawAutoTab(slot) {
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
    btn.addEventListener('click', () => openAddAutoSendModal(btn.dataset.addKind, () => AUTO_SEND_SECTIONS.forEach((s) => drawSection(s.kind))));
  });

  function drawSection(kind) {
    const listEl = slot.querySelector(`#auto-list-${kind}`);
    const rows = S.listZaloAutoSendByKind(kind)
      .map((r) => ({ r, customer: S.getCustomer(r.customerId), contract: S.getContract(r.contractId) }))
      .filter((x) => x.customer && x.contract);
    listEl.innerHTML = rows.length ? rows.map(({ r, customer, contract }) => `
      <div class="list-row" style="padding:8px 4px">
        <div class="row-main">
          <div class="row-title" style="font-size:13.5px">${customer.name} · ${contract.code}</div>
          <div class="row-sub">${formatVND(contract.balance)}${r.customDay ? ` · Ngày ${r.customDay} hàng tháng` : ''}</div>
        </div>
        <button class="icon-btn" data-remove="${r.id}" title="Bỏ khỏi danh sách">${icon('trash', 'icon-sm')}</button>
      </div>
    `).join('') : `<p class="text-sm text-muted">Chưa có hợp đồng nào.</p>`;
    listEl.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
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

/** Popup tìm + thêm 1 hợp đồng vào 1 trong 2 mục Tầng 2 — chỉ liệt kê hợp đồng của khách ĐÃ ở Tầng 1 và CHƯA ở mục nào (loại trừ nhau). */
function openAddAutoSendModal(kind, onDone) {
  const zaloCustomerIds = [...new Set(S.listZaloCustomers().map((r) => r.customerId))];
  const usedContractIds = new Set(S.listZaloAutoSend().map((r) => r.contractId));
  let query = '';
  const isCustomDay = kind === 'lai_hang_thang_custom_day';

  const close = openModal({
    title: isCustomDay ? 'Thêm vào "Gửi theo ngày cụ thể"' : 'Thêm vào "Báo lãi tự động hàng tháng"',
    bodyHtml: `
      ${isCustomDay ? `<div class="field"><label>Ngày trong tháng (1-28) — áp dụng cho hợp đồng bạn chọn thêm bên dưới</label><input type="number" id="day-input" min="1" max="28" value="1"/></div>` : ''}
      ${searchBoxHtml('add-auto-search', 'Tìm theo tên khách hoặc mã hợp đồng...', '')}
      <div id="add-auto-list" class="mt-8"></div>
    `,
    onMount(sheet) {
      function getRows() {
        let rows = [];
        for (const custId of zaloCustomerIds) {
          const customer = S.getCustomer(custId);
          if (!customer) continue;
          const contracts = S.listContractsByCustomer(custId).filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan' && !usedContractIds.has(ct.id));
          for (const contract of contracts) rows.push({ customer, contract });
        }
        if (query) {
          const q = query.toLowerCase();
          rows = rows.filter(({ customer, contract }) => customer.name.toLowerCase().includes(q) || contract.code.toLowerCase().includes(q));
        }
        return rows;
      }
      function draw() {
        const rows = getRows();
        sheet.querySelector('#add-auto-list').innerHTML = rows.length ? rows.map(({ customer, contract }) => `
          <div class="list-row" data-add="${contract.id}" style="cursor:pointer;padding:8px 4px">
            <div class="row-main">
              <div class="row-title" style="font-size:13.5px">${customer.name} · ${contract.code}</div>
              <div class="row-sub">${formatVND(contract.balance)}</div>
            </div>
          </div>
        `).join('') : `<p class="text-sm text-muted">Không có hợp đồng nào để thêm — khách phải có trong Danh sách OA, có hợp đồng còn hoạt động, và chưa ở mục nào khác.</p>`;
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
      bindSearchBox(sheet, 'add-auto-search', (v) => { query = v; draw(); });
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
