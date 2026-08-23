// Trang "Quản lý OA" — quản lý gửi tin Zalo OA (ZBS Template Message), 2 tầng:
//   Tầng 1 "Danh sách OA": khách hàng nào được xem là "đủ điều kiện gửi
//     Zalo" — theo KHÁCH HÀNG (không theo hợp đồng), CHUNG cho mọi người có
//     quyền (không riêng ai), giống "Use" không tự xóa khi hết hợp đồng/dư
//     nợ. Thêm ở đây hoặc ở chi tiết khách hàng (customers.js).
//   Tầng 2 "Gửi tin tự động": chọn CỤ THỂ hợp đồng + tình huống nào thật sự
//     được gửi tự động — RÚT RA từ Tầng 1 — RIÊNG TƯ theo từng người tự chọn
//     (chỉ người đó thấy/xóa được lựa chọn của mình), nhưng 1 (hợp đồng,
//     tình huống) chỉ 1 người chọn được — người khác cố chọn trùng bị chặn,
//     báo rõ tên người đã chọn.
//   "Quản lý gửi tin": log mọi lần gửi (tự động lẫn gửi tay) — thành công/lỗi.
//   "Cấu hình" (CHỈ quản trị viên toàn quyền): chọn Template ID theo tình huống.
import * as S from '../../state.js';
import { icon } from '../../icons.js';
import { pageHeader } from '../../components/shell.js';
import { emptyState, openPicker, pillSelectHtml } from '../../components/ui.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { formatDateTime, colorFor, initials } from '../../utils.js';

const KIND_LABEL = {
  den_han: 'Đến hạn/Quá hạn',
  lai_hang_thang_auto: 'Báo lãi tự động hàng tháng',
  lai_hang_thang_custom_day: 'Gửi theo ngày cụ thể hàng tháng',
};
const KIND_OPTIONS = [
  { value: 'den_han', label: 'Đến hạn/Quá hạn — hoạt động' },
  { value: 'lai_hang_thang_auto', label: 'Báo lãi tự động hàng tháng — chờ có mẫu tin' },
  { value: 'lai_hang_thang_custom_day', label: 'Gửi theo ngày cụ thể hàng tháng — chờ có mẫu tin' },
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
// Tab "Danh sách OA" (Tầng 1) — CHUNG cho mọi người có quyền.
// ------------------------------------------------------------
function drawOATab(slot, admin) {
  const isStaff = admin.role === 'staff';
  const allowedThon = isStaff ? (admin.allowedThon || []) : S.distinctThon();

  slot.innerHTML = `
    <div class="flex gap-8 mb-8" style="flex-wrap:wrap">
      <div class="filter-row" id="oa-filter-pills" style="flex:1"></div>
    </div>
    <div id="oa-list"></div>
  `;
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
        <div class="list-row" style="padding:12px 4px">
          <div class="row-thumb" style="background:${colorFor(customer.id)}">${initials(customer.name)}</div>
          <div class="row-main">
            <div class="row-title">${customer.name}</div>
            <div class="row-sub">${[customer.xom, customer.thon].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</div>
          </div>
          <div class="flex gap-6">
            <button class="icon-btn" data-quick-select="${customer.id}" title="Chọn gửi tự động">${icon('plus', 'icon-sm')}</button>
            <button class="icon-btn" data-remove-oa="${customer.id}" title="Bỏ khỏi danh sách OA">${icon('trash', 'icon-sm')}</button>
          </div>
        </div>
      `).join('') : emptyState({ iconName: 'message', title: 'Chưa có khách hàng nào', message: 'Thêm khách hàng vào danh sách OA ở đây hoặc trong chi tiết khách hàng (mục Khách hàng & Hợp đồng).' })}
    `;
    listEl.querySelectorAll('[data-quick-select]').forEach((btn) => {
      btn.addEventListener('click', () => openAutoSendKindPicker(btn.dataset.quickSelect, drawList));
    });
    listEl.querySelectorAll('[data-remove-oa]').forEach((btn) => {
      btn.addEventListener('click', () => {
        confirmDialog({
          title: 'Bỏ khỏi danh sách OA?',
          message: 'Mọi lựa chọn gửi Zalo tự động (của mọi nhân viên) cho khách này sẽ bị bỏ theo luôn.',
          danger: true, confirmLabel: 'Bỏ khỏi OA',
          onConfirm: async () => {
            try { await S.removeZaloCustomer(btn.dataset.removeOa); toast('Đã bỏ khỏi danh sách OA', 'success'); drawList(); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    });
  }
}

/** Popup chọn tình huống (+ hợp đồng nếu cần, + ngày nếu chọn "gửi theo ngày") để thêm vào Tầng 2. */
function openAutoSendKindPicker(customerId, onDone) {
  const customer = S.getCustomer(customerId);
  const contracts = S.listContractsByCustomer(customerId).filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan');
  const close = openModal({
    title: `Chọn gửi tự động — ${customer ? customer.name : ''}`,
    bodyHtml: `
      <div class="field">
        <label>Tình huống</label>
        <select id="kind-select">
          ${KIND_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
        </select>
      </div>
      ${contracts.length > 1 ? `
      <div class="field">
        <label>Hợp đồng</label>
        <select id="contract-select">
          ${contracts.map((ct) => `<option value="${ct.id}">${ct.code}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="field" id="day-field" style="display:none">
        <label>Ngày trong tháng (1-28)</label>
        <input type="number" id="day-input" min="1" max="28" value="1"/>
      </div>
      ${!contracts.length ? `<p class="field-hint" style="color:var(--danger)">Khách này chưa có hợp đồng nào còn hoạt động — chỉ tình huống "Đến hạn/Quá hạn" cần hợp đồng, 2 tình huống báo lãi hàng tháng vẫn chọn được (áp dụng khi khách có hợp đồng trở lại).</p>` : ''}
    `,
    footHtml: `<button class="btn btn-primary btn-block" id="btn-confirm-kind">Xác nhận</button>`,
    onMount(sheet, closeFn) {
      const kindSelect = sheet.querySelector('#kind-select');
      const dayField = sheet.querySelector('#day-field');
      kindSelect.addEventListener('change', () => {
        dayField.style.display = kindSelect.value === 'lai_hang_thang_custom_day' ? '' : 'none';
      });
      sheet.querySelector('#btn-confirm-kind').addEventListener('click', async () => {
        const kind = kindSelect.value;
        if (kind === 'den_han' && !contracts.length) { toast('Cần có hợp đồng còn hoạt động để chọn tình huống này.', 'error'); return; }
        const contractSelect = sheet.querySelector('#contract-select');
        const contractId = contracts.length === 1 ? contracts[0].id : contractSelect ? contractSelect.value : null;
        if (kind === 'den_han' && !contractId) { toast('Chưa chọn hợp đồng.', 'error'); return; }
        const customDay = kind === 'lai_hang_thang_custom_day' ? Number(sheet.querySelector('#day-input').value) || null : null;
        // 2 tình huống báo lãi hàng tháng chưa có mẫu tin (chờ bổ sung) —
        // vẫn cho chọn trước (dormant), gắn tạm vào hợp đồng đầu tiên nếu có,
        // để không chặn thao tác của người dùng.
        const finalContractId = contractId || (contracts[0] && contracts[0].id) || null;
        if (!finalContractId) { toast('Khách này chưa có hợp đồng nào để gắn lựa chọn vào.', 'error'); return; }
        try {
          await S.addZaloAutoSend(finalContractId, kind, customDay);
          toast('Đã thêm vào danh sách gửi tự động', 'success');
          closeFn();
          if (onDone) onDone();
        } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
      });
    },
  });
  return close;
}

// ------------------------------------------------------------
// Tab "Gửi tin tự động" (Tầng 2) — CHỈ hiện lựa chọn của CHÍNH người đang xem
// (server/RLS đã tự lọc, xem loadAdminSessionData() trong state.js).
// ------------------------------------------------------------
function drawAutoTab(slot, admin) {
  const isStaff = admin.role === 'staff';
  const allowedThon = isStaff ? (admin.allowedThon || []) : S.distinctThon();

  slot.innerHTML = `
    <p class="text-sm text-muted mb-8">Danh sách này chỉ hiện đúng những lựa chọn CHÍNH BẠN đã chọn — đồng nghiệp khác (kể cả cùng địa bàn) không thấy được lựa chọn của bạn và ngược lại.</p>
    <div class="filter-row mb-8" id="auto-filter-pills"></div>
    <div id="auto-list"></div>
  `;
  renderPills();
  drawList();

  function renderPills() {
    const wrap = slot.querySelector('#auto-filter-pills');
    wrap.innerHTML = thonXomFilterPillsHtml('auto-pill');
    bindThonXomFilterPills(wrap, 'auto-pill', allowedThon, () => { renderPills(); drawList(); });
  }

  function drawList() {
    const listEl = slot.querySelector('#auto-list');
    let rows = S.listZaloAutoSend()
      .map((r) => ({ r, customer: S.getCustomer(r.customerId), contract: S.getContract(r.contractId) }))
      .filter((x) => x.customer && x.contract);
    if (filterThon.length) rows = rows.filter((x) => filterThon.includes(x.customer.thon));
    if (filterXom.length) rows = rows.filter((x) => filterXom.includes(`${x.customer.thon}||${x.customer.xom}`));

    listEl.innerHTML = `
      <div class="text-sm text-muted mb-8">${rows.length} hợp đồng bạn đang chọn gửi tự động</div>
      ${rows.length ? rows.map(({ r, customer, contract }) => `
        <div class="list-row" style="padding:12px 4px">
          <div class="row-thumb" style="background:${colorFor(customer.id)}">${initials(customer.name)}</div>
          <div class="row-main">
            <div class="row-title">${customer.name} · ${contract.code}</div>
            <div class="row-sub">${KIND_LABEL[r.kind] || r.kind}${r.customDay ? ` (ngày ${r.customDay})` : ''} · ${[customer.xom, customer.thon].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</div>
          </div>
          <button class="icon-btn" data-remove="${r.id}" title="Bỏ khỏi danh sách">${icon('trash', 'icon-sm')}</button>
        </div>
      `).join('') : emptyState({ iconName: 'message', title: 'Bạn chưa chọn hợp đồng nào', message: 'Sang tab "Danh sách OA", bấm nút + cạnh khách hàng để chọn gửi tự động.' })}
    `;
    listEl.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        confirmDialog({
          title: 'Bỏ khỏi danh sách gửi tự động?',
          message: 'Hợp đồng này sẽ không còn được tự động gửi tin Zalo nữa (vẫn gửi tay được bình thường).',
          danger: true, confirmLabel: 'Bỏ khỏi danh sách',
          onConfirm: async () => {
            try { await S.removeZaloAutoSend(btn.dataset.remove); toast('Đã bỏ khỏi danh sách', 'success'); drawList(); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    });
  }
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
// Tab "Cấu hình" (chỉ super — giữ nguyên nội dung cũ của trang này)
// ------------------------------------------------------------
function drawConfigTab(slot) {
  const org = S.getOrg();
  const configured = !!org.zaloTemplateDueId;
  slot.innerHTML = `
    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Trạng thái</h2></div>
      <p class="text-sm text-muted">
        ${configured
          ? `Đã cấu hình mẫu tin cho tình huống <b>"Đến hạn/Quá hạn"</b> — hệ thống sẽ tự động gửi tin Zalo cho khách hàng có trong danh sách "Gửi tin tự động" (của từng người) mỗi khi hợp đồng đến/quá hạn (song song với thông báo đẩy).`
          : `Chưa cấu hình mẫu tin nào — hệ thống hiện CHƯA tự gửi tin Zalo cho khách hàng. Điền Template ID bên dưới để bật.`}
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
          <label>Mẫu tin khi ĐẾN HẠN/QUÁ HẠN (Template ID)</label>
          <input name="zaloTemplateDueId" value="${esc(org.zaloTemplateDueId)}" placeholder="VD: 519351"/>
        </div>
        <p class="text-sm text-muted mb-8">
          Mẫu cho "Báo lãi tự động hàng tháng" và "Gửi theo ngày cụ thể" sẽ thêm vào sau khi bạn tạo
          xong mẫu đó bên Zalo — báo lại để bổ sung thêm ô nhập cho 2 tình huống này.
        </p>
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
      await S.updateOrg({ zaloTemplateDueId: fd.get('zaloTemplateDueId').trim() });
      toast('Đã lưu cấu hình Zalo OA', 'success');
      drawConfigTab(slot);
    } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
  });
}
function esc(s) { return String(s || '').replace(/"/g, '&quot;'); }
