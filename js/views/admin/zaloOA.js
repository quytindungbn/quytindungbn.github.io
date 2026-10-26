import * as S from '../../state.js';
import { icon } from '../../icons.js';
import { pageHeader } from '../../components/shell.js';
import { emptyState, openPicker, pillSelectHtml, searchBoxHtml, bindSearchBox } from '../../components/ui.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { formatDateTime, formatDate, formatVND, colorFor, initials, escapeHtml, stripDiacritics } from '../../utils.js';
import { openCustomerDetail, openContractView } from './customers.js';
import { shortPersonName, logRecipient } from '../../lib/coBorrower.js';
import { formatPhoneDisplay } from '../../lib/callHistory.js';
import { groupSendLogs } from '../../lib/sendLogGroups.js';

const AUTO_SEND_SECTIONS = [
  { kind: 'lai_hang_thang_auto', title: 'Báo lãi tự động hàng tháng' },
  { kind: 'lai_hang_thang_custom_day', title: 'Gửi theo ngày cụ thể' },
];
const PAGE_SIZE = 20;
const pendingAdds = new Set();

let activeTab = 'oa';
let filterThon = [];
let filterXom = [];
let oaQuery = '';
let oaRcv = 'all';
let logStatusFilter = 'all';
let logFromDate = '';
let logToDate = '';
let logQuery = '';

let extraLogs = [];
let logCoveredFrom = null;
let logViewFrom = null;
const LOG_PAGE = 500;

const OA_TABS = [
  { k: 'oa', label: 'Danh sách OA', icon: 'users' },
  { k: 'auto', label: 'Gửi tự động', icon: 'refresh' },
  { k: 'log', label: 'Lịch sử gửi', icon: 'clock' },
  { k: 'config', label: 'Cấu hình', icon: 'settings', superOnly: true },
];

function rcvOf(customerId) {
  const ov = S.customerOaOverview(customerId);

  return { ov, mode: !ov || ov.mode === 'none' ? 'main' : ov.mode };
}
function rcvChipsHtml(customer, { mini = false } = {}) {
  const { ov } = rcvOf(customer.id);
  if (!ov || !ov.custom) return '';
  const cls = `oa-rcv${mini ? ' is-mini' : ''}`;
  const items = ov.items;
  if (!ov.detail) {

    if (ov.anyCo && ov.anyMain) return `<div class="${cls}"><span class="oa-two" title="Gửi Zalo cho cả người vay và người cùng vay">Gửi cả 2 người</span></div>`;
    if (ov.anyCo) {
      const p = ov.people[0] || {};
      const sub = `${escapeHtml(p.name || '')}${p.phone ? ` · <em>${escapeHtml(p.phone)}</em>` : ''}`;
      if (mini) return `<div class="${cls}"><span class="oa-rcv-l">Gửi tới</span><span class="oa-rc is-co"><i>${icon('check', 'icon-sm')}</i><span class="oa-rc-tx"><b>Người cùng vay</b></span></span></div>`;
      return `<div class="${cls}"><span class="oa-rcv-l">Gửi tới</span><span class="oa-line-rc"><i>${icon('check', 'icon-sm')}</i><span><b>Người cùng vay:</b> ${sub}</span></span></div>`;
    }
    if (ov.noRecipient) return `<div class="${cls}"><span class="oa-hc warn">Chưa có số điện thoại để gửi Zalo</span></div>`;
    return '';
  }
  if (items.length <= 1) return `<div class="${cls}"><span class="oa-hc off">Hợp đồng đã tắt gửi OA</span></div>`;

  const chips = items.map(({ contract, state: st }) => {
    const code = `<b>${escapeHtml(contract.code)}</b>`;
    if (!st.enabled) return `<span class="oa-hc off">${code} không gửi</span>`;
    if (!st.recipients.length) return `<span class="oa-hc warn">${code} chưa có số để gửi</span>`;
    const co = st.coName ? escapeHtml(shortPersonName(st.coName)) : '';
    if (st.toCo && st.toMain) return `<span class="oa-hc co">${code} Người vay + ${co}</span>`;
    if (st.toCo) return `<span class="oa-hc co">${code} ${co}</span>`;
    if (st.coLocked) return `<span class="oa-hc warn">${code} Người vay <i style="font-style:normal">(${co} chưa có số)</i></span>`;
    return `<span class="oa-hc">${code} Người vay</span>`;
  }).join('');
  return `<div class="${cls} oa-inline"><span class="oa-rcv-l">Gửi tới</span>${chips}</div>`;
}

function summaryHtml(isSuper) {
  const org = S.getOrg();
  const missing = [];
  if (!org.zaloTemplateDueId) missing.push('“Đến hạn/Quá hạn”');
  if (!org.zaloTemplateInterestId) missing.push('“Báo lãi”');
  const since = Date.now() - 30 * 86400000;
  const recent = S.listZaloSendLog().filter((l) => new Date(l.sentAt).getTime() >= since && S.isZaloLogVisible(l));
  const sends = groupSendLogs(recent);
  const ok = sends.filter((g) => g.logs.every((l) => l.status === 'success')).length;

  const autoCount = S.summarizeZaloAutoByOwner().total;
  const banner = missing.length && activeTab !== 'config' ? `
    <div class="oa-ban"><span class="oa-ban-dot"></span>
      <div class="oa-ban-tx"><b>Chưa cấu hình mẫu tin ${missing.join(' và ')}</b>
        <small>${isSuper ? 'Nhập Template ID ở tab Cấu hình để gửi được tin.' : 'Nhờ quản trị viên toàn quyền cấu hình để gửi được tin.'}</small></div>
      ${isSuper ? `<button type="button" class="oa-ban-go" data-go-config>Cấu hình ${icon('chevronRight', 'icon-sm')}</button>` : ''}
    </div>` : '';
  const tile = (num, label, sub, cls = '') => `<div class="oa-kp ${cls}"><b>${num}</b><span>${label}</span><em>${sub}</em></div>`;
  const autoSub = S.hasZaloAutoOverview() ? 'cả nhóm' : 'của bạn';

  const autoTile = isSuper
    ? `<button type="button" class="oa-kp oa-kp-btn g" data-auto-breakdown aria-label="Xem số hợp đồng gửi tự động theo từng người"><b>${autoCount} <small>HĐTD</small></b><span>Báo lãi tự động</span><em>${autoSub} ›</em></button>`
    : tile(`${autoCount} <small>HĐTD</small>`, 'Báo lãi tự động', autoSub, 'g');
  return `${banner}<div class="oa-kps">
    ${tile(S.listZaloCustomers().length, 'Khách OA', 'đã thêm')}
    ${autoTile}
    ${tile(sends.length ? `${ok}<small>/${sends.length}</small>` : '0', 'Thành công', '30 ngày qua', 'e')}
  </div>`;
}
function bindSummary(root, contentEl) {
  const go = root.querySelector('[data-go-config]');
  if (go) go.addEventListener('click', () => { activeTab = 'config'; render(contentEl); });
  const brk = root.querySelector('[data-auto-breakdown]');
  if (brk) brk.addEventListener('click', openAutoBreakdownModal);
}

function openAutoBreakdownModal() {
  if (S.getAdmin(S.getSession()?.id)?.role !== 'super') return;
  const { total, owners } = S.summarizeZaloAutoByOwner();
  const full = S.hasZaloAutoOverview();
  openModal({
    title: 'Gửi tự động theo từng người',
    bodyHtml: `
      <div class="oa-brk-total"><b>${total}</b><span>hợp đồng đang gửi tự động${full ? ' (tất cả nhân viên)' : ''}</span></div>
      <div class="oa-brk">
        ${owners.length ? owners.map((o) => `
          <div class="oa-brk-row${o.isMe ? ' me' : ''}">
            <span class="oa-brk-nm">${escapeHtml(o.name)}${o.isMe ? ' <em>(bạn)</em>' : ''}</span>
            <b>${o.count}<small> hợp đồng</small></b>
          </div>`).join('') : '<p class="text-sm text-muted">Chưa có hợp đồng nào trong gửi tự động.</p>'}
      </div>
      <p class="text-sm text-muted mt-8">${full ? 'Mỗi người chỉ thấy danh sách chi tiết của chính mình ở tab "Gửi tự động"; con số tổng ai cũng thấy như nhau.' : 'Hiện mới xem được phần của bạn — cần cập nhật máy chủ (Edge Function) mới thấy được của người khác.'}</p>`,
  });
}

export function resetFilters() {
  activeTab = 'oa'; filterThon = []; filterXom = []; oaQuery = ''; oaRcv = 'all'; logStatusFilter = 'all'; logFromDate = ''; logToDate = ''; logQuery = '';
  extraLogs = []; logCoveredFrom = null; logViewFrom = null;
}

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Quản lý OA' });
}

function currentAdmin() {
  const session = S.getSession();
  return S.getAdmin(session.id);
}

let overviewAskedAt = 0;
function loadAutoOverview(contentEl) {
  if (Date.now() - overviewAskedAt < 15000) return;
  overviewAskedAt = Date.now();
  S.refreshZaloAutoOverview().then((changed) => {
    if (changed && contentEl.isConnected && (location.hash || '').split('?')[0] === '#/admin/zalo-oa') refresh(contentEl);
  });
}

export function render(contentEl) {
  const admin = currentAdmin();
  const isSuper = admin.role === 'super';
  if (activeTab === 'config' && !isSuper) activeTab = 'oa';

  contentEl.innerHTML = `
    <div class="oa-page">
      <div id="oa-summary">${summaryHtml(isSuper)}</div>
      <div class="oa-tabs" role="tablist">
        ${OA_TABS.filter((t) => !t.superOnly || isSuper).map((t) => `<button type="button" role="tab" aria-selected="${activeTab === t.k}" class="oa-tab${activeTab === t.k ? ' on' : ''}" data-tab="${t.k}">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
      </div>
      <div id="zalo-tab-content"></div>
    </div>
  `;
  bindSummary(contentEl.querySelector('#oa-summary'), contentEl);
  contentEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { activeTab = btn.dataset.tab; render(contentEl); });
  });

  const slot = contentEl.querySelector('#zalo-tab-content');
  if (activeTab === 'oa') drawOATab(slot, admin);
  else if (activeTab === 'auto') drawAutoTab(slot, admin);
  else if (activeTab === 'log') drawLogTab(slot);
  else drawConfigTab(slot);
  loadAutoOverview(contentEl);
}

export function refresh(contentEl) {
  const slot = contentEl.querySelector('#zalo-tab-content');
  if (!slot) { render(contentEl); return; }
  const admin = currentAdmin();
  const sum = contentEl.querySelector('#oa-summary');
  if (sum) { sum.innerHTML = summaryHtml(admin.role === 'super'); bindSummary(sum, contentEl); }
  if (activeTab === 'oa') drawOATab(slot, admin);
  else if (activeTab === 'auto') drawAutoTab(slot, admin);
  else if (activeTab === 'log') drawLogTab(slot);
  else drawConfigTab(slot);
  loadAutoOverview(contentEl);
}

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
    const xomList = S.territoryXomList(S.getSession()?.id, getState().thon.length ? getState().thon : undefined);
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

function matchThonXom(customer, thonSel, xomSel) {
  if (thonSel.length && !thonSel.includes(customer.thon)) return false;
  if (!xomSel.length) return true;
  if (!xomSel.includes(customer.xom)) return false;
  return thonSel.length > 0 || S.isCustomerInTerritory(customer, S.getSession()?.id);
}
function multiPillLabel(label, arr) {
  if (!arr.length) return label;
  return `${label}: ${arr.length} đã chọn `;
}

function drawOATab(slot, admin) {

  const allowedThon = S.territoryThonList(admin.id);

  slot.innerHTML = `
    <div class="oa-tool">
      <div class="oa-search">${searchBoxHtml('oa-search', 'Tìm theo tên, SĐT...', oaQuery)}</div>
      <button type="button" class="oa-flt" id="btn-oa-filter" title="Lọc theo Thôn / Xóm" aria-label="Lọc theo Thôn / Xóm">${icon('filter')}<span class="oa-flt-tx">Lọc</span><i class="oa-flt-n" hidden></i></button>
      <button type="button" class="oa-add" id="btn-add-oa" title="Thêm khách hàng vào OA" aria-label="Thêm khách hàng vào OA">${icon('userPlus')}</button>
    </div>
    <div class="oa-rseg" id="oa-rseg" role="group" aria-label="Lọc theo người nhận Zalo"></div>
    <div id="oa-list"></div>
  `;
  slot.querySelector('#btn-add-oa').addEventListener('click', () => openAddCustomerToOAModal(admin, drawList));
  slot.querySelector('#btn-oa-filter').addEventListener('click', () => openThonXomFilterModal({
    title: 'Lọc danh sách OA', hint: 'Chọn Thôn / Xóm để chỉ xem khách ở nơi đó (chọn được nhiều).', allowedThon,
    getState: () => ({ thon: filterThon, xom: filterXom }),
    setState: (t, x) => { filterThon = t; filterXom = x; },
    onChange: () => { updateFilterBtn(); drawList(); },
  }));
  bindSearchBox(slot, 'oa-search', (v) => { oaQuery = v; drawList(); });
  updateFilterBtn();
  drawList();

  function updateFilterBtn() {
    const btn = slot.querySelector('#btn-oa-filter');
    const n = filterThon.length + filterXom.length;
    const badge = btn.querySelector('.oa-flt-n');
    badge.textContent = n; badge.hidden = n === 0;
    btn.classList.toggle('on', n > 0);
  }

  function drawList() {
    const listEl = slot.querySelector('#oa-list');
    let rows = S.listZaloCustomers().map((r) => ({ r, customer: S.getCustomer(r.customerId) })).filter((x) => x.customer);
    if (filterThon.length || filterXom.length) rows = rows.filter((x) => matchThonXom(x.customer, filterThon, filterXom));
    if (oaQuery.trim()) {
      const q = oaQuery.trim().toLowerCase();
      rows = rows.filter((x) => x.customer.name.toLowerCase().includes(q) || (x.customer.phone || '').includes(q));
    }

    const rcvCount = { all: rows.length, main: 0, co: 0, both: 0, none: 0 };
    for (const x of rows) rcvCount[rcvOf(x.customer.id).mode]++;
    const rseg = slot.querySelector('#oa-rseg');

    const hasCoRows = rcvCount.co + rcvCount.both > 0;
    rseg.style.display = hasCoRows ? '' : 'none';
    if (!hasCoRows) { oaRcv = 'all'; rseg.innerHTML = ''; }
    else {
      rseg.innerHTML = [['all', 'Tất cả'], ['main', 'Người vay'], ['co', 'Người cùng vay'], ['both', 'Cả 2 người']]
        .map(([k, label]) => `<button type="button" class="${oaRcv === k ? 'on' : ''}" data-rcv="${k}">${label}<em>${rcvCount[k]}</em></button>`).join('');
      rseg.querySelectorAll('[data-rcv]').forEach((b) => b.addEventListener('click', () => { oaRcv = b.dataset.rcv; drawList(); }));
    }
    if (oaRcv !== 'all') rows = rows.filter((x) => rcvOf(x.customer.id).mode === oaRcv);

    const autoKinds = new Map();
    for (const a of S.listZaloAutoOverview()) {
      const set = autoKinds.get(a.customerId) || new Set();
      set.add(a.kind);
      autoKinds.set(a.customerId, set);
    }
    const chipsFor = (id) => {
      const k = autoKinds.get(id);
      if (!k) return '';
      return `${k.has('lai_hang_thang_auto') ? '<span class="oa-chip g">Báo lãi tự động</span>' : ''}${k.has('lai_hang_thang_custom_day') ? '<span class="oa-chip b">Ngày cụ thể</span>' : ''}`;
    };
    listEl.innerHTML = `
      <div class="card card-pad mb-16">
      <div class="oa-sec-h"><h2>Khách hàng trong danh sách OA <span class="oa-cnt">(${rows.length})</span></h2></div>
      ${rows.length ? rows.map(({ r, customer }) => `
        <div class="list-row" data-open="${customer.id}" style="cursor:pointer">
          <div class="row-thumb" style="background:${colorFor(customer.id)}">${initials(customer.name)}</div>
          <div class="row-main">
            <div class="row-title oa-ttl"><span class="oa-nm">${customer.name}</span>${chipsFor(customer.id)}</div>
            <div class="row-sub oa-addr"><span class="oa-ad">${[customer.xom, customer.thon].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</span>${customer.phone ? `<a class="oa-ph" href="tel:${customer.phone.replace(/\s/g, '')}" data-stop-row title="Gọi/tìm Zalo nhanh">${customer.phone}</a>` : ''}</div>
            ${rcvChipsHtml(customer)}
          </div>
        </div>
      `).join('') : emptyState({ iconName: 'message', title: 'Chưa có khách hàng nào', message: 'Bấm "Thêm khách hàng vào OA" ở trên, hoặc thêm ở chi tiết khách hàng (mục Khách hàng & Hợp đồng).' })}
      </div>
    `;
    listEl.querySelectorAll('[data-open]').forEach((row) => {
      row.addEventListener('click', () => openCustomerDetail(row.dataset.open, { readOnly: false, context: 'customer' }));
    });

    listEl.querySelectorAll('[data-stop-row]').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  }
}

function openThonXomFilterModal({ title, hint, allowedThon, getState, setState, onChange }) {
  openModal({
    title,
    bodyHtml: `
      <p class="text-sm text-muted mb-8">${hint}</p>
      <div class="filter-row" id="oa-flt-pills"></div>
    `,
    footHtml: `<button class="btn btn-outline" id="oa-flt-clear">Xóa lọc</button><button class="btn btn-primary" id="oa-flt-done" style="flex:1">Xong</button>`,
    onMount(sheet, close) {
      const wrap = sheet.querySelector('#oa-flt-pills');
      const clearBtn = sheet.querySelector('#oa-flt-clear');
      function renderPills() {
        const { thon, xom } = getState();
        wrap.innerHTML = thonXomFilterPillsHtml('flt-pill', thon, xom);
        bindThonXomFilterPills(wrap, 'flt-pill', allowedThon, getState, setState, () => { renderPills(); onChange(); });
        clearBtn.disabled = !thon.length && !xom.length;
      }
      renderPills();
      clearBtn.addEventListener('click', () => { setState([], []); renderPills(); onChange(); });
      sheet.querySelector('#oa-flt-done').addEventListener('click', () => close());
    },
  });
}

function openAddCustomerToOAModal(admin, onDone) {
  const zaloIds = new Set(S.listZaloCustomers().map((r) => r.customerId));
  const isStaff = admin.role === 'staff';
  const allowedThon = S.territoryThonList(admin.id);
  let query = '';
  let pThon = [];
  let pXom = [];
  const selected = new Set();

  const close = openModal({
    title: 'Thêm khách hàng vào OA',
    sheetClass: 'sheet-search',
    bodyHtml: `
      ${searchBoxHtml('add-oa-search', 'Tìm theo tên, số CCCD, SĐT...', '')}
      <div class="filter-row mb-8" id="add-oa-pills"></div>
      <div id="add-oa-list" class="mt-8"></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" id="add-oa-confirm" disabled>Thêm đã chọn (0)</button>`,
    onMount(sheet, closeFn) {
      function getFiltered() {

        let list = S.listCustomers({ adminId: isStaff ? admin.id : undefined }).filter((c) => !zaloIds.has(c.id) && !S.oaAddBlockReason(c.id));
        if (pThon.length || pXom.length) list = list.filter((c) => matchThonXom(c, pThon, pXom));
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

        const list = getFiltered();

        sheet.querySelector('#add-oa-list').innerHTML = list.length ? list.map((c) => `
          <div class="list-row" data-row="${c.id}" style="cursor:pointer;padding:8px 4px">
            <input type="checkbox" data-check="${c.id}" ${selected.has(c.id) ? 'checked' : ''} style="width:16px;height:16px;flex-shrink:0"/>
            <div class="row-thumb" style="background:${colorFor(c.id)};width:28px;height:28px;font-size:11px;border-radius:8px;flex-shrink:0">${initials(c.name)}</div>
            <div class="row-main">
              <div class="row-title" style="font-size:13.5px">${c.name}</div>
              <div class="row-sub">${c.address || [c.xom, c.thon, c.tinh].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</div>
              ${c.coPrevName ? '<div class="oa-warn-tag">Người cùng vay đã đổi — cần xem lại</div>' : ''}
            </div>
            <b style="font-size:13px;white-space:nowrap;flex-shrink:0">${c.phone || `<span style="font-size:11.5px;font-weight:600;color:var(--text-muted)">Người cùng vay · ${escapeHtml((S.listCoPeople(c.id).find((p) => p.phone) || {}).phone || '')}</span>`}</b>
          </div>
        `).join('') : `<p class="text-sm text-muted">Không có khách hàng phù hợp (đã lọc bớt khách chưa có SĐT nào — cả người vay lẫn người cùng vay — hoặc đã có sẵn trong danh sách OA).</p>`;
        sheet.querySelectorAll('[data-row]').forEach((row) => {
          row.addEventListener('click', (e) => {
            if (e.target.matches('[data-check]')) return;
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
        const doAdd = async () => {
          btn.disabled = true;
          let okCount = 0;
          for (const id of ids) {
            try { await S.addZaloCustomer(id); S.dismissCoBorrowerChange(id); okCount++; } catch (err) { toast(`${err.message || 'Lỗi'} (bỏ qua, tiếp tục thêm phần còn lại)`, 'error'); }
          }
          if (okCount) toast(`Đã thêm ${okCount} khách hàng vào danh sách OA`, 'success');
          closeFn();
          if (onDone) onDone();
        };

        const changed = ids.map((id) => ({ c: S.getCustomer(id), chg: S.coChangeInfo(id) })).filter((x) => x.c && x.chg);
        if (changed.length) {
          confirmDialog({
            title: 'Người cùng vay đã thay đổi',
            message: `${changed.map((x) => `<b>${escapeHtml(x.c.name)}</b>: ${escapeHtml(x.chg.prevName)} → <b>${x.chg.names.length ? x.chg.names.map(escapeHtml).join(', ') : 'không còn người cùng vay'}</b>`).join('<br>')}<br><br>Khi thêm, Zalo OA chỉ gửi cho người vay cho đến khi nhập số và tick gửi cho người mới. Vẫn thêm?`,
            confirmLabel: 'Vẫn thêm vào OA', onConfirm: doAdd,
          });
          return;
        }
        await doAdd();
      });
      bindSearchBox(sheet, 'add-oa-search', (v) => { query = v; draw(); });
      renderPills();
      draw();
    },
  });
  return close;
}

const AUTO_PREVIEW_COUNT = 4;

function drawAutoTab(slot, admin) {
  slot.innerHTML = `
    ${AUTO_SEND_SECTIONS.map((s) => `
      <div class="card card-pad mb-16">
        <div class="oa-sec-h">
          <h2>${s.title} <span class="oa-cnt" data-count="${s.kind}"></span></h2>
          <button type="button" class="oa-sadd" data-add-kind="${s.kind}" aria-label="Thêm hợp đồng vào &quot;${s.title}&quot;">${icon('plus')}<span>Thêm</span></button>
        </div>
        <div id="auto-list-${s.kind}"></div>
        <button type="button" class="oa-more" data-view-all="${s.kind}" hidden><span class="oa-more-tx"></span>${icon('chevronRight', 'icon-sm')}</button>
      </div>
    `).join('')}
  `;
  AUTO_SEND_SECTIONS.forEach((s) => drawSection(s.kind));
  slot.querySelectorAll('[data-add-kind]').forEach((btn) => {
    btn.addEventListener('click', () => openAddAutoSendModal(btn.dataset.addKind, admin, () => AUTO_SEND_SECTIONS.forEach((s) => drawSection(s.kind))));
  });

  slot.querySelectorAll('[data-view-all]').forEach((btn) => {
    const kind = btn.dataset.viewAll;
    btn.addEventListener('click', () => openAutoSendListModal(kind, admin, () => drawSection(kind)));
  });

  function drawSection(kind) {
    const listEl = slot.querySelector(`#auto-list-${kind}`);
    const viewAllBtn = slot.querySelector(`[data-view-all="${kind}"]`);
    const countEl = slot.querySelector(`[data-count="${kind}"]`);
    const allRows = S.listZaloAutoSendByKind(kind)
      .map((r) => ({ r, customer: S.getCustomer(r.customerId), contract: S.getContract(r.contractId) }))
      .filter((x) => x.customer && x.contract);
    const preview = allRows.slice(0, AUTO_PREVIEW_COUNT);
    if (countEl) countEl.textContent = `(${allRows.length})`;
    listEl.innerHTML = preview.length ? preview.map(({ r, customer, contract }) => autoSendRowHtml(kind, r, customer, contract)).join('') : `<p class="text-sm text-muted">Chưa có hợp đồng nào — bấm "Thêm" ở góc trên để thêm.</p>`;
    bindAutoRowHandlers(listEl, kind, () => drawSection(kind));
    if (viewAllBtn) {
      viewAllBtn.hidden = allRows.length <= AUTO_PREVIEW_COUNT;
      viewAllBtn.querySelector('.oa-more-tx').textContent = `Xem thêm ${allRows.length - AUTO_PREVIEW_COUNT} hợp đồng`;
    }
  }
}

function intervalSelectHtml(rowId, intervalMonths) {
  return `<select data-interval="${rowId}" style="flex-shrink:0;font-size:11.5px;padding:1px 3px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface);color:inherit;cursor:pointer;vertical-align:middle" title="Ngưỡng lãi chưa trả: đủ số tháng đã chọn thì báo mỗi tháng cho đến khi khách trả lãi">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${(intervalMonths || 1) === n ? 'selected' : ''}>${n} tháng</option>`).join('')}</select>`;
}

function autoSendRowHtml(kind, r, customer, contract) {
  const addr = [customer.xom, customer.thon].filter(Boolean).join(', ') || 'Chưa có địa bàn';
  const dayLabel = kind === 'lai_hang_thang_custom_day' ? ` · <span style="font-weight:400;font-size:12px">Ngày ${r.customDay || '?'}</span>` : '';
  return `
    <div class="list-row" data-row="${r.id}" data-contract="${contract.id}" data-customer="${customer.id}" style="cursor:pointer;padding:8px 4px">
      <div class="row-main">
        <div class="row-title" style="display:flex;align-items:center;gap:6px;white-space:normal;overflow:visible;text-overflow:clip">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px">${customer.name} · ${contract.code}${dayLabel}</span>
          ${intervalSelectHtml(r.id, r.intervalMonths)}
        </div>
        <div class="row-sub" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${addr}</span>
          <span style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <b data-view-contract title="Xem chi tiết hợp đồng" style="color:var(--color-primary);font-size:13px;white-space:nowrap">${formatVND(contract.balance)}</b>
            <button class="icon-btn oa-del" data-remove="${r.id}" title="Bỏ khỏi danh sách" aria-label="Bỏ khỏi danh sách gửi tự động" style="width:30px;height:30px;flex-shrink:0">${icon('trash', 'icon-sm')}</button>
          </span>
        </div>
        ${rcvChipsHtml(customer, { mini: true })}${contract.oaEnabled === false ? '<div class="oa-rcv is-mini"><span class="oa-hc off">Hợp đồng đã tắt gửi OA — không gửi</span></div>' : ''}
      </div>
    </div>
  `;
}

function bindAutoRowHandlers(listEl, kind, refresh) {
  listEl.querySelectorAll('[data-row]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove]') || e.target.closest('[data-interval]') || e.target.closest('[data-view-contract]')) return;
      if (kind === 'lai_hang_thang_custom_day') {
        openEditCustomDayModal(row.dataset.row, refresh);
      } else {
        openContractView(row.dataset.customer, S.getContract(row.dataset.contract), { readOnly: true });
      }
    });
  });

  listEl.querySelectorAll('[data-view-contract]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = el.closest('[data-row]');
      openContractView(row.dataset.customer, S.getContract(row.dataset.contract), { readOnly: true });
    });
  });

  listEl.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('[data-row]');
      const customer = row ? S.getCustomer(row.dataset.customer) : null;
      const contract = row ? S.getContract(row.dataset.contract) : null;
      confirmDialog({
        title: 'Bỏ khỏi gửi tự động?',
        message: `Bỏ hợp đồng <b>${escapeHtml(contract?.code || '')}</b> của <b>${escapeHtml(customer?.name || '')}</b> khỏi danh sách gửi tự động?<br>Hợp đồng và khách hàng không bị xóa, thêm lại được bất cứ lúc nào.`,
        confirmLabel: 'Bỏ khỏi danh sách',
        danger: true,
        onConfirm: async () => {
          btn.disabled = true;
          try { await S.removeZaloAutoSend(btn.dataset.remove); toast('Đã bỏ khỏi danh sách', 'success'); refresh(); }
          catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); btn.disabled = false; }
        },
      });
    });
  });

  listEl.querySelectorAll('[data-interval]').forEach((sel) => {
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', async () => {
      const intervalMonths = Number(sel.value) || 1;
      sel.disabled = true;
      try { await S.updateZaloAutoSendSettings(sel.dataset.interval, { intervalMonths }); toast('Đã đổi định kỳ báo', 'success'); refresh(); }
      catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); sel.disabled = false; }
    });
  });
}

function openAutoSendListModal(kind, admin, onDone) {
  const allowedThon = S.territoryThonList(admin.id);
  let query = '';
  let pThon = [];
  let pXom = [];
  const section = AUTO_SEND_SECTIONS.find((s) => s.kind === kind);

  const close = openModal({
    title: section ? section.title : 'Danh sách',
    sheetClass: 'sheet-search',
    bodyHtml: `
      <div class="oa-tool">
        <div class="oa-search">${searchBoxHtml('auto-list-search', 'Tìm tên khách, mã hợp đồng...', '')}</div>
        <button type="button" class="oa-flt" id="auto-list-filter" title="Lọc theo Thôn / Xóm" aria-label="Lọc theo Thôn / Xóm">${icon('filter')}<span class="oa-flt-tx">Lọc</span><i class="oa-flt-n" hidden></i></button>
      </div>
      <div id="auto-list-full" class="mt-8"></div>
    `,
    onMount(sheet) {
      function getRows() {
        let rows = S.listZaloAutoSendByKind(kind)
          .map((r) => ({ r, customer: S.getCustomer(r.customerId), contract: S.getContract(r.contractId) }))
          .filter((x) => x.customer && x.contract);
        if (pThon.length || pXom.length) rows = rows.filter((x) => matchThonXom(x.customer, pThon, pXom));
        if (query) {
          const q = query.toLowerCase();
          rows = rows.filter((x) => x.customer.name.toLowerCase().includes(q) || x.contract.code.toLowerCase().includes(q));
        }
        return rows;
      }

      function updateFilterBtn() {
        const btn = sheet.querySelector('#auto-list-filter');
        const n = pThon.length + pXom.length;
        const badge = btn.querySelector('.oa-flt-n');
        badge.textContent = n; badge.hidden = n === 0;
        btn.classList.toggle('on', n > 0);
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
      sheet.querySelector('#auto-list-filter').addEventListener('click', () => openThonXomFilterModal({
        title: 'Lọc theo Thôn / Xóm', hint: 'Chọn Thôn / Xóm để chỉ xem hợp đồng của khách ở nơi đó (chọn được nhiều).', allowedThon,
        getState: () => ({ thon: pThon, xom: pXom }),
        setState: (t, x) => { pThon = t; pXom = x; },
        onChange: () => { updateFilterBtn(); draw(); },
      }));
      updateFilterBtn();
      draw();
    },
  });
  return close;
}

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
          await S.updateZaloAutoSendSettings(id, { customDay: day });
          toast('Đã sửa ngày gửi', 'success');
          closeFn();
          if (onDone) onDone();
        } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
      });
    },
  });
  return close;
}

function openAddAutoSendModal(kind, admin, onDone) {
  const zaloCustomerIds = [...new Set(S.listZaloCustomers().map((r) => r.customerId))];
  const usedContractIds = new Set([...S.listZaloAutoOverview().map((r) => r.contractId), ...pendingAdds]);
  const allowedThon = S.territoryThonList(admin.id);
  let query = '';
  let pThon = [];
  let pXom = [];
  let visibleCount = PAGE_SIZE;
  const isCustomDay = kind === 'lai_hang_thang_custom_day';

  const close = openModal({
    title: 'Click chọn hợp đồng để thêm vào danh sách',
    sheetClass: 'sheet-search sheet-oa-add',
    bodyHtml: `
      <div class="oa-cfg">
        ${isCustomDay
          ? `<label class="oa-cfg-row oa-cfg-inline"><span>Gửi vào ngày:</span><input type="text" id="day-input" value="01" maxlength="2" inputmode="numeric" autocomplete="off" aria-label="Ngày gửi trong tháng (1-30)"/><span>của</span><select id="interval-input">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === 1 ? 'selected' : ''}>${n} tháng sau</option>`).join('')}</select></label>`
          : `<label class="oa-cfg-row"><span>Gửi báo khi đủ:</span><select id="interval-input">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === 1 ? 'selected' : ''}>${n} tháng</option>`).join('')}</select></label>`}
      </div>
      <div class="oa-tool">
        <div class="oa-search">${searchBoxHtml('add-auto-search', 'Tìm tên khách, mã hợp đồng...', '')}</div>
        <button type="button" class="oa-flt" id="add-auto-filter" title="Lọc theo Thôn / Xóm" aria-label="Lọc theo Thôn / Xóm">${icon('filter')}<span class="oa-flt-tx">Lọc</span><i class="oa-flt-n" hidden></i></button>
      </div>
      <div id="add-auto-list" class="mt-8"></div>
      <button class="btn btn-outline btn-sm btn-block mt-8" id="add-auto-more" style="display:none">Xem thêm</button>
    `,
    onMount(sheet) {

      function getRows() {
        let rows = [];
        const blocked = [];
        for (const custId of zaloCustomerIds) {
          const customer = S.getCustomer(custId);
          if (!customer) continue;

          if (!S.isCustomerInTerritory(customer, admin.id)) continue;
          if (!matchThonXom(customer, pThon, pXom)) continue;
          const active = S.listContractsByCustomer(custId).filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan');
          if (!active.length) continue;
          const other = S.zaloAutoSendOwnerOtherThanMe(custId);
          if (other) { blocked.push({ customer, owner: other.createdByName }); continue; }
          for (const contract of active.filter((ct) => !usedContractIds.has(ct.id))) rows.push({ customer, contract });
        }
        let blockedRows = blocked;
        if (query) {
          const q = query.toLowerCase();
          rows = rows.filter(({ customer, contract }) => customer.name.toLowerCase().includes(q) || contract.code.toLowerCase().includes(q));
          blockedRows = blocked.filter(({ customer }) => customer.name.toLowerCase().includes(q) || S.listContractsByCustomer(customer.id).some((ct) => ct.code.toLowerCase().includes(q)));
        } else blockedRows = [];
        return { rows, blockedRows };
      }

      function updateFilterBtn() {
        const btn = sheet.querySelector('#add-auto-filter');
        const n = pThon.length + pXom.length;
        const badge = btn.querySelector('.oa-flt-n');
        badge.textContent = n; badge.hidden = n === 0;
        btn.classList.toggle('on', n > 0);
      }
      function draw() {
        const { rows: all, blockedRows } = getRows();
        const rows = all.slice(0, visibleCount);
        const blockedHtml = blockedRows.map(({ customer, owner }) => `
          <div class="list-row" style="padding:8px 4px;opacity:.55">
            <div class="row-main">
              <div class="row-title" style="font-size:13.5px">${customer.name}</div>
              <div class="row-sub">${[customer.xom, customer.thon].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</div>
            </div>
            <span class="text-sm" style="white-space:nowrap">Đã do ${owner ? `"${owner}"` : 'người khác'} thêm</span>
          </div>`).join('');
        sheet.querySelector('#add-auto-list').innerHTML = (rows.length ? rows.map(({ customer, contract }) => `
          <div class="list-row" data-add="${contract.id}" style="cursor:pointer;padding:8px 4px">
            <div class="row-main">
              <div class="row-title" style="font-size:13.5px">${customer.name} · ${contract.code}</div>
              <div class="row-sub">${[customer.xom, customer.thon].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</div>
            </div>
            <b style="color:var(--color-primary);font-size:13px;white-space:nowrap">${formatVND(contract.balance)}</b>
          </div>
        `).join('') : (blockedRows.length ? '' : `<p class="text-sm text-muted">Không có hợp đồng nào để thêm — khách phải có trong Danh sách OA, có hợp đồng còn hoạt động, chưa ở mục nào khác và chưa được người khác thêm vào gửi tự động.</p>`)) + blockedHtml;
        sheet.querySelector('#add-auto-more').style.display = all.length > visibleCount ? '' : 'none';
        sheet.querySelectorAll('[data-add]').forEach((row) => {
          row.addEventListener('click', () => {
            const contractId = row.dataset.add;
            if (row.classList.contains('is-busy')) return;
            const customDay = isCustomDay ? clampDay(sheet.querySelector('#day-input').value) : null;
            const intervalMonths = Number(sheet.querySelector('#interval-input').value) || 1;

            row.classList.add('is-busy', 'is-added');
            const amountEl = row.querySelector('b');
            if (amountEl) amountEl.textContent = '✓ Đã thêm';
            pendingAdds.add(contractId);
            usedContractIds.add(contractId);
            setTimeout(() => { if (pendingAdds.has(contractId) || usedContractIds.has(contractId)) draw(); }, 450);
            S.addZaloAutoSend(contractId, kind, customDay, intervalMonths).then(() => {
              pendingAdds.delete(contractId);
              toast('Đã thêm vào danh sách gửi tự động', 'success');
              if (onDone) onDone();
            }).catch((err) => {
              pendingAdds.delete(contractId);
              usedContractIds.delete(contractId);
              draw();
              toast(err.message || 'Có lỗi xảy ra', 'error');
            });
          });
        });
      }
      sheet.querySelector('#add-auto-more').addEventListener('click', () => { visibleCount += PAGE_SIZE; draw(); });
      bindSearchBox(sheet, 'add-auto-search', (v) => { query = v; visibleCount = PAGE_SIZE; draw(); });
      if (isCustomDay) {

        const dayInput = sheet.querySelector('#day-input');
        dayInput.addEventListener('input', () => {
          let v = dayInput.value.replace(/\D/g, '').slice(0, 2);
          if (v && Number(v) > 30) v = '30';
          if (v !== dayInput.value) dayInput.value = v;
        });
        dayInput.addEventListener('focus', () => dayInput.select());
        dayInput.addEventListener('blur', () => { dayInput.value = String(clampDay(dayInput.value)).padStart(2, '0'); });
      }
      sheet.querySelector('#add-auto-filter').addEventListener('click', () => openThonXomFilterModal({
        title: 'Lọc theo Thôn / Xóm', hint: 'Chọn Thôn / Xóm để chỉ xem hợp đồng của khách ở nơi đó (chọn được nhiều).', allowedThon,
        getState: () => ({ thon: pThon, xom: pXom }),
        setState: (t, x) => { pThon = t; pXom = x; },
        onChange: () => { visibleCount = PAGE_SIZE; updateFilterBtn(); draw(); },
      }));
      updateFilterBtn();
      draw();
    },
  });
  return close;
}

function clampDay(value) {
  const n = Number(value) || 1;
  return Math.min(30, Math.max(1, n));
}

function bindDayInputClamp(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener('input', () => {
    if (inputEl.value === '') return;
    const clamped = clampDay(inputEl.value);
    if (String(clamped) !== inputEl.value) inputEl.value = clamped;
  });
}

const logTime = (l) => new Date(l.sentAt).getTime();
function allLoadedLogs() {
  const seen = new Set();
  const out = [];
  for (const l of [...S.listZaloSendLog(), ...extraLogs]) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push(l);
  }
  return out.sort((a, b) => logTime(b) - logTime(a));
}

function logCoverage() {
  if (logCoveredFrom !== null) return logCoveredFrom;
  const recent = S.listZaloSendLog();
  return recent.length >= 1000 ? Math.min(...recent.map(logTime)) : Date.now() - 31 * 86400000;
}

async function loadOlderLogs(untilMs) {
  for (let guard = 0; guard < 40 && logCoveredFrom !== -Infinity; guard++) {
    const from = logCoverage();
    if (untilMs !== null && from <= untilMs) break;
    const { rows, hasMore } = await S.fetchOlderZaloSendLog({ before: new Date(from).toISOString(), limit: LOG_PAGE });
    extraLogs.push(...rows);
    if (!hasMore) { logCoveredFrom = -Infinity; break; }
    const oldest = Math.min(...rows.map(logTime));
    logCoveredFrom = oldest < from ? oldest : from - 1;
    if (untilMs === null) break;
  }
}

function logToHtml(rc, mark = '') {
  const ph = rc.phone ? `<em>${escapeHtml(formatPhoneDisplay(rc.phone))}</em>` : '';
  const mk = mark ? `<s class="lg-mk is-${mark}" title="${mark === 'ok' ? 'Gửi thành công' : 'Gửi lỗi'}">${icon(mark === 'ok' ? 'check' : 'x', 'icon-sm')}</s>` : '';
  if (rc.who === 'main') return `<span class="lg-rc is-main"><i>${icon('user', 'icon-sm')}</i><b>Người vay</b>${ph}${mk}</span>`;
  if (rc.who === 'co') return `<span class="lg-rc is-co"><i>${icon('users', 'icon-sm')}</i><b>Người cùng vay${rc.name ? ` · ${escapeHtml(shortPersonName(rc.name))}` : ''}</b>${ph}${mk}</span>`;
  return `<span class="lg-rc is-other" title="Số này không còn trong hồ sơ khách hàng (đã đổi số)"><i>${icon('phone', 'icon-sm')}</i><b>${rc.phone ? 'Số khác' : 'Không rõ số'}</b>${ph}${mk}</span>`;
}
const logWhoLabel = (rc) => (rc.who === 'main' ? 'Người vay' : rc.who === 'co' ? `Người cùng vay${rc.name ? ` · ${shortPersonName(rc.name)}` : ''}` : (rc.phone ? formatPhoneDisplay(rc.phone) : 'Số khác'));
const LOG_WHO_ORDER = { main: 0, co: 1, other: 2 };

function buildLogItems(logs) {
  return groupSendLogs(logs).map((g) => {
    const first = g.logs[0];
    const customer = S.getCustomer(first.customerId);
    const contract = first.contractId ? S.getContract(first.contractId) : null;
    const recips = g.logs.map((l) => ({ l, rc: logRecipient(l.phone, customer, contract, { who: l.recipientWho, name: l.recipientName }) })).sort((a, b) => LOG_WHO_ORDER[a.rc.who] - LOG_WHO_ORDER[b.rc.who]);
    const okN = recips.filter((r) => r.l.status === 'success').length;
    return { id: first.id, time: g.time, first, customer, contract, recips, allOk: okN === recips.length, partial: okN > 0 && okN < recips.length };
  });
}

function logMatchesQuery(raw) {
  const words = stripDiacritics(raw).split(' ').filter(Boolean);
  const digits = String(raw).replace(/[\s.\-()]/g, '');
  const phoneQ = digits.length >= 3 && /^\+?\d+$/.test(digits) ? digits.replace(/^\+?84/, '0') : '';
  return (it) => {
    const phones = [it.customer && it.customer.phone, ...it.recips.map((r) => r.rc.phone)].filter(Boolean).map((p) => String(p).replace(/[^\d+]/g, '').replace(/^\+?84/, '0'));
    if (phoneQ && phones.some((p) => p.includes(phoneQ))) return true;
    const hay = stripDiacritics([it.customer && it.customer.name, it.contract && it.contract.code, it.contract && it.contract.heirName, ...it.recips.map((r) => r.rc.name), ...phones].filter(Boolean).join(' '));
    return words.every((w) => hay.includes(w));
  };
}

function logRowHtml(it) {
  const { first, customer, contract, recips } = it;
  const d = new Date(it.time);
  const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const stIcon = it.allOk ? 'check' : it.partial ? 'alert' : 'x';
  const stTitle = it.allOk ? 'Gửi thành công' : it.partial ? `Gửi được ${recips.filter((r) => r.l.status === 'success').length}/${recips.length} người` : 'Gửi lỗi';
  const fails = recips.filter((r) => r.l.status !== 'success' && r.l.errorMessage);
  const sameMsg = fails.length > 0 && fails.length === recips.length && fails.every((r) => r.l.errorMessage === fails[0].l.errorMessage);
  const errHtml = !fails.length ? '' : (recips.length === 1 || sameMsg
    ? `<div class="lg-err">${icon('info', 'icon-sm')}<span>${escapeHtml(fails[0].l.errorMessage)}</span></div>`
    : fails.map((r) => `<div class="lg-err">${icon('info', 'icon-sm')}<span><b>${escapeHtml(logWhoLabel(r.rc))}:</b> ${escapeHtml(r.l.errorMessage)}</span></div>`).join(''));
  return `
    <div class="lg-row ${it.allOk ? 'is-ok' : it.partial ? 'is-part' : 'is-err'}">
      <span class="lg-st" title="${stTitle}">${icon(stIcon, 'icon-sm')}</span>
      <div class="lg-main">
        <div class="lg-who"><b class="lg-name">${customer ? escapeHtml(customer.name) : '—'}</b>${contract ? `<span class="lg-code">${escapeHtml(contract.code)}</span>` : ''}</div>
        <div class="lg-to"><span class="lg-to-l">Gửi tới</span>${recips.map((r) => logToHtml(r.rc, it.partial ? (r.l.status === 'success' ? 'ok' : 'err') : '')).join('')}</div>
        <div class="lg-meta"><span class="oa-chip ${first.triggeredBy === 'manual' ? 'b' : 'g'}">${first.triggeredBy === 'manual' ? 'Gửi tay' : 'Tự động'}</span><span class="oa-chip ${first.kind === 'den_han' ? 'b' : 'g'}">${first.kind === 'den_han' ? 'Đến hạn' : 'Báo lãi'}</span></div>
        ${errHtml}
      </div>
      <time class="lg-time">${hh}</time>
    </div>`;
}

function drawLogTab(slot) {
  const failedFrom = new Set();
  slot.innerHTML = `
    <div class="lg-bar">
      <div class="oa-search lg-search">${searchBoxHtml('log-search', 'Tìm tên khách, số HĐTD, số điện thoại...', escapeHtml(logQuery))}</div>
      <label class="lg-date"><span>Từ ngày</span><input type="date" id="log-from" value="${logFromDate}"/></label>
      <label class="lg-date"><span>Đến ngày</span><input type="date" id="log-to" value="${logToDate}"/></label>
    </div>
    <div id="log-list"></div>
  `;
  bindSearchBox(slot, 'log-search', (v) => { logQuery = v; drawList(); });
  slot.querySelector('#log-from').addEventListener('change', (e) => { logFromDate = e.target.value; drawList(); });
  slot.querySelector('#log-to').addEventListener('change', (e) => { logToDate = e.target.value; drawList(); });
  drawList();

  function drawList() {

    const fromMs = logFromDate ? new Date(`${logFromDate}T00:00:00`).getTime() : null;
    if (fromMs !== null && !failedFrom.has(fromMs) && logCoveredFrom !== -Infinity && fromMs < logCoverage()) {
      slot.querySelector('#log-list').innerHTML = '<div class="text-sm text-muted" style="padding:16px 4px">Đang tải lịch sử gửi tin cũ hơn...</div>';
      loadOlderLogs(fromMs).then(drawList, (err) => {
        failedFrom.add(fromMs);
        toast(err.message || 'Không tải được lịch sử cũ hơn', 'error');
        drawList();
      });
      return;
    }
    const viewFromMs = fromMs !== null ? fromMs : (logViewFrom !== null ? logViewFrom : Date.now() - 30 * 86400000);
    let base = allLoadedLogs().filter((l) => logTime(l) >= viewFromMs && S.isZaloLogVisible(l));
    if (logToDate) base = base.filter((l) => new Date(l.sentAt) <= new Date(`${logToDate}T23:59:59`));
    let items = buildLogItems(base);
    if (logQuery.trim()) items = items.filter(logMatchesQuery(logQuery));

    const statusCnt = { all: items.length, success: items.filter((x) => x.allOk).length };
    statusCnt.error = items.length - statusCnt.success;
    const rows = items.filter((x) => logStatusFilter === 'all' || (logStatusFilter === 'success' ? x.allOk : !x.allOk));
    const hasFilter = logStatusFilter !== 'all' || logFromDate || logToDate || logQuery.trim();

    const canLoadMore = fromMs === null && logCoveredFrom !== -Infinity;
    const moreHtml = fromMs !== null ? '' : (canLoadMore
      ? '<button type="button" class="btn btn-outline btn-block mt-8" id="log-more">Xem thêm lịch sử cũ hơn</button>'
      : '<div class="text-sm text-muted" style="text-align:center;padding:12px 4px">Đã hiển thị toàn bộ lịch sử gửi tin.</div>');
    const statusSeg = [['all', 'Tất cả', statusCnt.all], ['success', 'Thành công', statusCnt.success], ['error', 'Lỗi', statusCnt.error]]
      .map(([k, label, n]) => `<button type="button" class="${logStatusFilter === k ? 'on' : ''}" data-lg-status="${k}">${label}<em>${n}</em></button>`).join('');
    const successCount = rows.filter((x) => x.allOk).length;
    const errorCount = rows.length - successCount;

    const todayKey = new Date().toDateString(), yesterdayKey = new Date(Date.now() - 86400000).toDateString();
    const days = [];
    for (const x of rows) {
      const k = new Date(x.time).toDateString();
      if (!days.length || days[days.length - 1].k !== k) days.push({ k, d: new Date(x.time), items: [] });
      days[days.length - 1].items.push(x);
    }
    const dayLabel = ({ k, d }) => `${k === todayKey ? 'Hôm nay · ' : k === yesterdayKey ? 'Hôm qua · ' : ''}${formatDate(d)}`;
    slot.querySelector('#log-list').innerHTML = `
      <div class="lg-filters" role="group" aria-label="Lọc theo trạng thái">${statusSeg}</div>
      <div class="card card-pad mb-16 lg-card">
      <div class="oa-sec-h"><h2>Lịch sử gửi tin</h2></div>
      <div class="text-sm text-muted mb-8">${rows.length} lần gửi${hasFilter ? ' (đã lọc)' : ''}${fromMs === null ? (logViewFrom === null ? ' trong 1 tháng gần nhất' : (logCoveredFrom === -Infinity && viewFromMs <= 0 ? ' (toàn bộ lịch sử)' : ` từ ${formatDate(new Date(viewFromMs))} đến nay`)) : ''} · <b style="color:var(--success)">${successCount} thành công</b> · <b style="color:var(--danger)">${errorCount} lỗi</b></div>
      ${rows.length ? days.map((g) => `<div class="oa-day lg-day"><span>${dayLabel(g)}</span><em>${g.items.length} lần</em></div>${g.items.map(logRowHtml).join('')}`).join('')
        : emptyState({ iconName: 'message', title: 'Không có lần gửi nào phù hợp', message: hasFilter ? 'Thử bỏ bớt từ khóa, bộ lọc trạng thái hoặc thời gian.' : 'Log sẽ hiện ở đây sau khi hệ thống gửi tin Zalo (tự động hoặc gửi tay).' })}
      ${moreHtml}
      </div>
    `;
    slot.querySelectorAll('[data-lg-status]').forEach((b) => b.addEventListener('click', () => { logStatusFilter = b.dataset.lgStatus; drawList(); }));
    const moreBtn = slot.querySelector('#log-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', async () => {
        moreBtn.disabled = true;
        moreBtn.textContent = 'Đang tải...';
        try {
          await loadOlderLogs(null);
          logViewFrom = logCoveredFrom === -Infinity ? 0 : logCoveredFrom;
        } catch (err) { toast(err.message || 'Không tải được thêm lịch sử', 'error'); }
        drawList();
      });
    }
  }
}

function drawConfigTab(slot) {
  const org = S.getOrg();
  const bothSet = !!(org.zaloTemplateDueId && org.zaloTemplateInterestId);
  slot.innerHTML = `
    <form id="zalo-form" class="oa-steps">
      <section class="oa-step">
        <div class="oa-sn">1</div>
        <div class="oa-sb">
          <h2>Mẫu tin Zalo OA <span class="oa-st ${bothSet ? 'ok' : 'warn'}">${bothSet ? 'Đã nhập đủ' : 'Chưa nhập đủ'}</span></h2>
          <p class="oa-hint">
            Template ID lấy từ trang quản lý mẫu ZBS Template Message (mục "Quản lý Template" trên Zalo) —
            mẫu phải ở trạng thái <b>"Đã duyệt"</b> mới dùng được.
          </p>
          <div class="field">
            <label>Mẫu "Đến hạn/Quá hạn" (Template ID)</label>
            <input name="zaloTemplateDueId" value="${esc(org.zaloTemplateDueId)}" placeholder="VD: 519351"/>
            <p class="oa-hint">${org.zaloTemplateDueId ? 'Tự động gửi cho MỌI hợp đồng của khách trong "Danh sách OA" khi đến/quá hạn.' : 'Chưa cấu hình mẫu này.'}</p>
          </div>
          <div class="field">
            <label>Mẫu "Báo lãi" (Template ID)</label>
            <input name="zaloTemplateInterestId" value="${esc(org.zaloTemplateInterestId)}" placeholder="Dán Template ID khi đã tạo xong mẫu này bên Zalo"/>
            <p class="oa-hint">${org.zaloTemplateInterestId ? 'Dùng cho 2 mục ở "Gửi tự động" và gửi tay khi hợp đồng chưa đến hạn.' : 'Chưa cấu hình mẫu này.'}</p>
          </div>
        </div>
      </section>

      <section class="oa-step">
        <div class="oa-sn">2</div>
        <div class="oa-sb">
          <h2>Ngưỡng "Gần đến hạn"</h2>
          <p class="oa-hint">
            Còn đúng số ngày này (hoặc đã quá hạn) — GỬI TAY hay GỬI TỰ ĐỘNG đều tự chuyển sang mẫu "Đến
            hạn/Quá hạn" ở trên thay vì mẫu "Báo lãi" — xét cả ngày đáo hạn hợp đồng gốc lẫn kỳ hạn trả nợ
            (nếu có), 1 số dùng chung cho tất cả.
          </p>
          <div class="field">
            <label>Số ngày</label>
            <input type="number" name="zaloNearDueDays" min="1" max="90" value="${org.zaloNearDueDays}"/>
          </div>
          <p class="oa-hint">
            Nội dung soạn sẵn cho thông báo qua ứng dụng (App) chuyển sang sửa ở mục "Cài đặt" &gt; "Nội
            dung thông báo qua ứng dụng".
          </p>
        </div>
      </section>

      <button class="btn btn-primary btn-block" type="submit">Lưu cấu hình</button>
    </form>
  `;

  slot.querySelector('#zalo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const days = Math.max(1, Math.min(90, Number(fd.get('zaloNearDueDays')) || 15));
    try {
      await S.updateOrg({
        zaloTemplateDueId: fd.get('zaloTemplateDueId').trim(),
        zaloTemplateInterestId: fd.get('zaloTemplateInterestId').trim(),
        zaloNearDueDays: days,
      });
      toast('Đã lưu cấu hình Zalo OA', 'success');
      drawConfigTab(slot);
    } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
  });
}
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
