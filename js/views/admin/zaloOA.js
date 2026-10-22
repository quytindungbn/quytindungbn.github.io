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
import { formatDateTime, formatDate, formatVND, colorFor, initials, escapeHtml } from '../../utils.js';
import { openCustomerDetail, openContractView } from './customers.js';

const AUTO_SEND_SECTIONS = [
  { kind: 'lai_hang_thang_auto', title: 'Báo lãi tự động hàng tháng' },
  { kind: 'lai_hang_thang_custom_day', title: 'Gửi theo ngày cụ thể' },
];
const PAGE_SIZE = 20; // hiện ít trước, bấm "Xem thêm" mới tải thêm — tránh dồn cả danh sách dài gây chậm/khó kéo
const pendingAdds = new Set(); // hợp đồng vừa bấm thêm, máy chủ chưa trả lời (để mở lại cửa sổ không hiện lại và không thêm trùng)

let activeTab = 'oa';
let filterThon = [];
let filterXom = [];
let oaQuery = ''; // ô tìm kiếm tên/SĐT ở tab "Danh sách OA"
let logStatusFilter = 'all'; // 'all' | 'success' | 'error'
let logFromDate = ''; // yyyy-mm-dd, rỗng = không giới hạn
let logToDate = '';
// "Quản lý gửi tin": mặc định chỉ hiện 1 tháng gần nhất; bấm "Xem thêm" hoặc chọn "Từ ngày" cũ hơn thì tải thêm log cũ từ máy chủ (giữ tạm trong bộ nhớ).
let extraLogs = [];        // log cũ hơn khoảng đã tải sẵn lúc đăng nhập
let logCoveredFrom = null; // mốc thời gian (ms) cũ nhất mà dữ liệu đã tải phủ kín; -Infinity = đã tải hết
let logViewFrom = null;    // sau khi bấm "Xem thêm": hiện từ mốc này trở đi (null = 1 tháng gần nhất)
const LOG_PAGE = 500;

// Hàng tab nổi bật (icon + chữ); "Cấu hình" chỉ hiện với quản trị viên toàn quyền.
const OA_TABS = [
  { k: 'oa', label: 'Danh sách OA', icon: 'users' },
  { k: 'auto', label: 'Gửi tự động', icon: 'refresh' },
  { k: 'log', label: 'Lịch sử gửi', icon: 'clock' },
  { k: 'config', label: 'Cấu hình', icon: 'settings', superOnly: true },
];

/**
 * Dải thông tin đầu trang: cảnh báo nếu chưa cấu hình mẫu tin (kèm nút sang tab Cấu hình cho quản trị toàn quyền) và 3 con số nhanh —
 * khách trong OA, tổng hợp đồng đang gửi tự động của tất cả nhân viên, số lần gửi thành công trong 30 ngày qua.
 */
function summaryHtml(isSuper) {
  const org = S.getOrg();
  const missing = [];
  if (!org.zaloTemplateDueId) missing.push('“Đến hạn/Quá hạn”');
  if (!org.zaloTemplateInterestId) missing.push('“Báo lãi”');
  const since = Date.now() - 30 * 86400000;
  const recent = S.listZaloSendLog().filter((l) => new Date(l.sentAt).getTime() >= since);
  const ok = recent.filter((l) => l.status === 'success').length;
  // Tổng hợp đồng đang gửi tự động của TẤT CẢ nhân viên (ai có quyền quản lý OA cũng thấy cùng một con số); bấm vào ô để xem từng người bao nhiêu.
  const autoCount = S.summarizeZaloAutoByOwner().total;
  const banner = missing.length && activeTab !== 'config' ? `
    <div class="oa-ban"><span class="oa-ban-dot"></span>
      <div class="oa-ban-tx"><b>Chưa cấu hình mẫu tin ${missing.join(' và ')}</b>
        <small>${isSuper ? 'Nhập Template ID ở tab Cấu hình để gửi được tin.' : 'Nhờ quản trị viên toàn quyền cấu hình để gửi được tin.'}</small></div>
      ${isSuper ? `<button type="button" class="oa-ban-go" data-go-config>Cấu hình ${icon('chevronRight', 'icon-sm')}</button>` : ''}
    </div>` : '';
  const tile = (num, label, sub, cls = '') => `<div class="oa-kp ${cls}"><b>${num}</b><span>${label}</span><em>${sub}</em></div>`;
  const autoSub = S.hasZaloAutoOverview() ? 'cả nhóm' : 'của bạn';
  // Chỉ quản trị toàn quyền bấm vào ô để xem từng người bao nhiêu hợp đồng; nhân viên chỉ thấy con số tổng.
  const autoTile = isSuper
    ? `<button type="button" class="oa-kp oa-kp-btn g" data-auto-breakdown aria-label="Xem số hợp đồng gửi tự động theo từng người"><b>${autoCount} <small>HĐTD</small></b><span>Báo lãi tự động</span><em>${autoSub} ›</em></button>`
    : tile(`${autoCount} <small>HĐTD</small>`, 'Báo lãi tự động', autoSub, 'g');
  return `${banner}<div class="oa-kps">
    ${tile(S.listZaloCustomers().length, 'Khách OA', 'đã thêm')}
    ${autoTile}
    ${tile(recent.length ? `${ok}<small>/${recent.length}</small>` : '0', 'Thành công', '30 ngày qua', 'e')}
  </div>`;
}
function bindSummary(root, contentEl) {
  const go = root.querySelector('[data-go-config]');
  if (go) go.addEventListener('click', () => { activeTab = 'config'; render(contentEl); });
  const brk = root.querySelector('[data-auto-breakdown]');
  if (brk) brk.addEventListener('click', openAutoBreakdownModal);
}

/** Cửa sổ "Gửi tự động theo từng người": tổng cả nhóm + số hợp đồng của mỗi người (mọi người có quyền quản lý OA đều thấy cùng số; danh sách chi tiết thì mỗi người chỉ thấy của mình). */
function openAutoBreakdownModal() {
  if (S.getAdmin(S.getSession()?.id)?.role !== 'super') return; // chỉ quản trị toàn quyền xem chi tiết từng người
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

/** Reset mọi bộ lọc/tab về mặc định — chỉ gọi từ app.js lúc đổi người đang đăng nhập, xem ghi chú y hệt trong customers.js. */
export function resetFilters() {
  activeTab = 'oa'; filterThon = []; filterXom = []; oaQuery = ''; logStatusFilter = 'all'; logFromDate = ''; logToDate = '';
  extraLogs = []; logCoveredFrom = null; logViewFrom = null;
}

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Quản lý OA' });
}

function currentAdmin() {
  const session = S.getSession();
  return S.getAdmin(session.id);
}

// Tổng quan gửi tự động của mọi người (nhãn + số tổng) tải riêng từ máy chủ; hỏi lại tối đa 15 giây một lần, và chỉ vẽ lại khi có đổi.
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

/**
 * Có dữ liệu mới nhưng vẫn đang đứng ở trang này (xem renderApp() trong
 * app.js) — chỉ vẽ lại ĐÚNG tab đang mở, KHÔNG dựng lại cả khung (thanh tab
 * + bộ lọc) như render() — đỡ giật/"như bị tải lại khung" mỗi khi thêm/bỏ
 * OA, nhất là thêm hàng loạt nhiều khách liền (mỗi khách xong 1 lượt notify()).
 */
export function refresh(contentEl) {
  const slot = contentEl.querySelector('#zalo-tab-content');
  if (!slot) { render(contentEl); return; } // chưa từng render() lần nào ở trang này -> vẽ đầy đủ
  const admin = currentAdmin();
  const sum = contentEl.querySelector('#oa-summary');
  if (sum) { sum.innerHTML = summaryHtml(admin.role === 'super'); bindSummary(sum, contentEl); } // số liệu đầu trang cập nhật theo dữ liệu mới
  if (activeTab === 'oa') drawOATab(slot, admin);
  else if (activeTab === 'auto') drawAutoTab(slot, admin);
  else if (activeTab === 'log') drawLogTab(slot);
  else drawConfigTab(slot);
  loadAutoOverview(contentEl);
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
/**
 * Khách có khớp bộ lọc Thôn/Xóm không. Tên Xóm có thể trùng giữa các Thôn: nhân viên chỉ chọn Xóm (chưa chọn Thôn) thì chỉ tính các Xóm thuộc
 * địa bàn được cấp, không lẫn Xóm cùng tên ở Thôn ngoài phạm vi.
 */
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

// ------------------------------------------------------------
// Tab "Danh sách OA" (Tầng 1) — CHUNG cho mọi người có quyền. KHÔNG hiện
// thông tin hợp đồng ở đây (chỉ khi thêm vào Tầng 2 mới cần chọn hợp đồng).
// ------------------------------------------------------------
function drawOATab(slot, admin) {
  // "Danh sách OA" giờ hiện TOÀN BỘ cho bất kỳ ai có quyền canManageZaloOA
  // (không giới hạn theo Thôn/Xóm nữa, xem docs mục 10.11) — bộ lọc Thôn ở
  // đây vì vậy cũng cho chọn TOÀN BỘ Thôn (không chỉ đúng địa bàn của
  // staff), khớp với dữ liệu thật sự đang hiển thị.
  const allowedThon = S.territoryThonList(admin.id); // bộ lọc chỉ liệt kê Thôn/Xóm trong địa bàn được cấp

  slot.innerHTML = `
    <div class="oa-tool">
      <div class="oa-search">${searchBoxHtml('oa-search', 'Tìm theo tên, SĐT...', oaQuery)}</div>
      <button type="button" class="oa-flt" id="btn-oa-filter" title="Lọc theo Thôn / Xóm" aria-label="Lọc theo Thôn / Xóm">${icon('filter')}<span class="oa-flt-tx">Lọc</span><i class="oa-flt-n" hidden></i></button>
      <button type="button" class="oa-add" id="btn-add-oa" title="Thêm khách hàng vào OA" aria-label="Thêm khách hàng vào OA">${icon('userPlus')}</button>
    </div>
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

  /** Số Thôn/Xóm đang chọn hiện thành chấm số trên nút Lọc; nút đổi màu khi đang lọc. */
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

    // Nhãn "đang ở mục gửi tự động nào" — hiện cho mọi khách đã có BẤT KỲ AI thêm vào gửi tự động (không riêng lựa chọn của người đang xem).
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
          </div>
        </div>
      `).join('') : emptyState({ iconName: 'message', title: 'Chưa có khách hàng nào', message: 'Bấm "Thêm khách hàng vào OA" ở trên, hoặc thêm ở chi tiết khách hàng (mục Khách hàng & Hợp đồng).' })}
      </div>
    `;
    listEl.querySelectorAll('[data-open]').forEach((row) => {
      row.addEventListener('click', () => openCustomerDetail(row.dataset.open, { readOnly: false, context: 'customer' }));
    });
    // SĐT nằm TRONG dòng bấm-để-xem — chặn nổi bọt để bấm gọi không mở luôn chi tiết khách hàng.
    listEl.querySelectorAll('[data-stop-row]').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  }
}

/**
 * Cửa sổ "Lọc" Thôn / Xóm (nhiều lựa chọn) — dùng chung cho Danh sách OA và cửa sổ "Xem thêm" của Gửi tự động. Bộ lọc nằm ở nơi gọi
 * (getState() -> { thon, xom }; setState(thon, xom)); đổi là danh sách phía sau cập nhật ngay qua onChange().
 */
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

/** Popup tìm + thêm (chọn nhiều) khách hàng vào Tầng 1 "Danh sách OA". */
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
        // Chỉ gửi được Zalo cho khách CÓ SĐT — khách chưa có SĐT ẩn khỏi
        // danh sách này luôn, khỏi thêm nhầm rồi không gửi được.
        let list = S.listCustomers({ adminId: isStaff ? admin.id : undefined }).filter((c) => !zaloIds.has(c.id) && c.phone);
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
  // Gắn 1 LẦN duy nhất ở đây (thanh "Xem thêm" nằm ngoài vùng danh sách nên KHÔNG bị vẽ lại mỗi lần drawSection()) — tránh gắn trùng listener.
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
    if (countEl) countEl.textContent = `(${allRows.length})`; // số hợp đồng đã thêm ở mục này
    listEl.innerHTML = preview.length ? preview.map(({ r, customer, contract }) => autoSendRowHtml(kind, r, customer, contract)).join('') : `<p class="text-sm text-muted">Chưa có hợp đồng nào — bấm "Thêm" ở góc trên để thêm.</p>`;
    bindAutoRowHandlers(listEl, kind, () => drawSection(kind));
    if (viewAllBtn) {
      viewAllBtn.hidden = allRows.length <= AUTO_PREVIEW_COUNT;
      viewAllBtn.querySelector('.oa-more-tx').textContent = `Xem thêm ${allRows.length - AUTO_PREVIEW_COUNT} hợp đồng`;
    }
  }
}

/**
 * Ô chọn định kỳ báo (1-4 tháng) — hiện NGAY sau số hợp đồng trong danh sách 2
 * mục Tầng 2, tự đổi ngay khi chọn (xem bindAutoRowHandlers). flex-shrink:0 để
 * KHÔNG BAO GIỜ bị bóp/cắt chữ dù dòng chật (tên/mã HĐ dài) — trước đây ô này
 * cùng nằm chung 1 khối text bị .row-title "..." nuốt mất khi hết chỗ, chữ
 * "1 tháng" hiện thiếu dù phần margin bên phải nhìn còn rộng (rộng đó là của
 * hàng DƯỚI, không phải hàng này) và bấm cũng không trúng được đúng lựa chọn.
 * Nay ô này đứng RIÊNG 1 khối flex-shrink:0 (xem autoSendRowHtml) nên luôn
 * hiện đủ chữ + bấm chọn được, phần tên/mã HĐ dài quá thì tự "..." bớt lại.
 */
function intervalSelectHtml(rowId, intervalMonths) {
  return `<select data-interval="${rowId}" style="flex-shrink:0;font-size:11.5px;padding:1px 3px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface);color:inherit;cursor:pointer;vertical-align:middle" title="Ngưỡng lãi chưa trả: đủ số tháng đã chọn thì báo mỗi tháng cho đến khi khách trả lãi">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${(intervalMonths || 1) === n ? 'selected' : ''}>${n} tháng</option>`).join('')}</select>`;
}

/**
 * Dòng hiển thị 1 hợp đồng trong 1 trong 2 mục Tầng 2 — dùng chung cho preview
 * lẫn popup "Xem chi tiết". Hàng trên là 1 khối flex: bên trái tên khách + mã
 * hợp đồng (+ "· Ngày X" với mục "Gửi theo ngày cụ thể", chữ nhỏ không đậm) —
 * PHẦN NÀY tự "..." khi hết chỗ; bên phải ô chọn định kỳ báo (1-4 tháng) —
 * flex-shrink:0, LUÔN hiện đủ chữ + bấm chọn được, không bao giờ bị phần tên
 * dài che/cắt mất nữa (xem intervalSelectHtml). Hàng dưới: địa chỉ bên trái,
 * số tiền + nút xóa đứng chung 1 nhóm cố định bên phải (không co lại) — GIỐNG
 * NHAU cho cả 2 mục. Bấm SỐ TIỀN luôn mở xem chi tiết hợp đồng (kể cả mục
 * "Gửi theo ngày cụ thể", nơi bấm chỗ khác trong dòng mở SỬA NGÀY thay vì xem
 * chi tiết — xem bindAutoRowHandlers).
 */
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
      </div>
    </div>
  `;
}

/** Gắn sự kiện click-mở-chi-tiết/sửa-ngày + bấm-xóa cho danh sách dòng Tầng 2 — dùng chung cho preview lẫn popup. */
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
  // Bấm riêng vào SỐ TIỀN luôn mở xem chi tiết hợp đồng, kể cả ở mục "Gửi
  // theo ngày cụ thể" (bấm chỗ khác trong dòng mở SỬA NGÀY thay vì xem chi
  // tiết ở mục này — cần 1 chỗ bấm riêng để vẫn xem được chi tiết hợp đồng).
  listEl.querySelectorAll('[data-view-contract]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = el.closest('[data-row]');
      openContractView(row.dataset.customer, S.getContract(row.dataset.contract), { readOnly: true });
    });
  });
  // Bấm thùng rác thì HỎI LẠI trước khi bỏ — tránh lỡ tay chạm nhầm trên điện thoại. Chỉ là bỏ khỏi DANH SÁCH GỬI TỰ ĐỘNG
  // (không xóa hợp đồng/khách hàng, thêm lại được ngay), nên nội dung hỏi nói rõ điều đó.
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
  // Đổi định kỳ báo — chặn nổi bọt để không mở nhầm chi tiết hợp đồng/sửa
  // ngày (row phía dưới), đổi xong áp dụng ngay, không cần bấm lưu riêng.
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

/** Popup "Xem thêm" — toàn bộ danh sách của 1 mục Tầng 2, có thanh tìm + nút Lọc (phễu) Thôn/Xóm cùng hàng. */
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
      /** Số Thôn/Xóm đang chọn hiện thành chấm số trên nút Lọc; nút đổi màu khi đang lọc. */
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

/** Popup tìm + thêm 1 hợp đồng vào 1 trong 2 mục Tầng 2 — chỉ liệt kê hợp đồng của khách ĐÃ ở Tầng 1 và CHƯA ở mục nào (loại trừ nhau). */
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
      // Mỗi khách chỉ MỘT người được thêm vào gửi tự động: khách đã có người KHÁC thêm không thêm được nữa (máy chủ cũng chặn).
      // Khi đang gõ tìm kiếm thì vẫn liệt kê các khách đó (mờ, kèm tên người đã thêm) để biết vì sao không thêm được.
      function getRows() {
        let rows = [];
        const blocked = [];
        for (const custId of zaloCustomerIds) {
          const customer = S.getCustomer(custId);
          if (!customer) continue;
          // Chỉ chọn được khách trong địa bàn được cấp (Danh sách OA có thể có cả khách ngoài địa bàn, nhưng nhân viên không thêm gửi tự động cho họ được; máy chủ cũng chặn)
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
      /** Số Thôn/Xóm đang chọn hiện thành chấm số trên nút Lọc; nút đổi màu khi đang lọc. */
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
            if (row.classList.contains('is-busy')) return; // đã bấm rồi, bấm thêm lần nữa không có tác dụng
            const customDay = isCustomDay ? clampDay(sheet.querySelector('#day-input').value) : null;
            const intervalMonths = Number(sheet.querySelector('#interval-input').value) || 1;
            // Phản hồi NGAY khi bấm (không chờ máy chủ): dòng chuyển thành "✓ Đã thêm", chừng nửa giây sau gọn khỏi danh sách để bấm tiếp
            // hợp đồng khác. Việc gửi lên máy chủ chạy ngầm; bị từ chối (VD khách đã có người khác thêm) thì trả dòng lại + báo lỗi.
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
        // Ô ngày: chỉ nhận chữ số, tối đa 30; rời ô thì tự thêm số 0 đầu cho đủ 2 chữ số (1 -> 01, bỏ trống -> 01).
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
/** Mốc cũ nhất mà dữ liệu đã tải phủ kín. Lúc đăng nhập chỉ tải 31 ngày gần nhất (tối đa 1.000 dòng) — đủ 1.000 dòng thì mốc là dòng cũ nhất. */
function logCoverage() {
  if (logCoveredFrom !== null) return logCoveredFrom;
  const recent = S.listZaloSendLog();
  return recent.length >= 1000 ? Math.min(...recent.map(logTime)) : Date.now() - 31 * 86400000;
}
/** Tải thêm log cũ: tới tận `untilMs` (chọn "Từ ngày"), hoặc đúng 1 trang tiếp theo khi `untilMs` = null ("Xem thêm"). */
async function loadOlderLogs(untilMs) {
  for (let guard = 0; guard < 40 && logCoveredFrom !== -Infinity; guard++) {
    const from = logCoverage();
    if (untilMs !== null && from <= untilMs) break;
    const { rows, hasMore } = await S.fetchOlderZaloSendLog({ before: new Date(from).toISOString(), limit: LOG_PAGE });
    extraLogs.push(...rows);
    if (!hasMore) { logCoveredFrom = -Infinity; break; }
    const oldest = Math.min(...rows.map(logTime));
    logCoveredFrom = oldest < from ? oldest : from - 1; // luôn tiến lùi được, không kẹt khi nhiều dòng cùng 1 mốc giờ
    if (untilMs === null) break;
  }
}

function drawLogTab(slot) {
  const failedFrom = new Set(); // các mốc "Từ ngày" đã thử tải log cũ mà lỗi — không tự thử lại vô hạn
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
    // Mặc định chỉ hiện 1 tháng gần nhất. Chọn "Từ ngày" cũ hơn → tự tải log cũ về rồi hiện bình thường;
    // bấm "Xem thêm" → tải thêm 1 trang log cũ hơn nữa.
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
    let logs = allLoadedLogs().filter((l) => logTime(l) >= viewFromMs);
    if (logStatusFilter !== 'all') logs = logs.filter((l) => l.status === logStatusFilter);
    if (logToDate) logs = logs.filter((l) => new Date(l.sentAt) <= new Date(`${logToDate}T23:59:59`));
    const successCount = logs.filter((l) => l.status === 'success').length;
    const errorCount = logs.filter((l) => l.status === 'error').length;
    const hasFilter = logStatusFilter !== 'all' || logFromDate || logToDate;
    // Nút "Xem thêm" (khi không chọn "Từ ngày"): còn log cũ hơn để tải thì hiện nút, hết thì báo đã hiện toàn bộ.
    const canLoadMore = fromMs === null && logCoveredFrom !== -Infinity;
    const moreHtml = fromMs !== null ? '' : (canLoadMore
      ? '<button type="button" class="btn btn-outline btn-block mt-8" id="log-more">Xem thêm lịch sử cũ hơn</button>'
      : '<div class="text-sm text-muted" style="text-align:center;padding:12px 4px">Đã hiển thị toàn bộ lịch sử gửi tin.</div>');
    slot.querySelector('#log-list').innerHTML = `
      <div class="card card-pad mb-16">
      <div class="oa-sec-h"><h2>Lịch sử gửi tin</h2></div>
      <div class="text-sm text-muted mb-8">${logs.length} lần gửi${hasFilter ? ' (đã lọc)' : ''}${fromMs === null ? (logViewFrom === null ? ' trong 1 tháng gần nhất' : (logCoveredFrom === -Infinity && viewFromMs <= 0 ? ' (toàn bộ lịch sử)' : ` từ ${formatDate(new Date(viewFromMs))} đến nay`)) : ''} · <b style="color:var(--success)">${successCount} thành công</b> · <b style="color:var(--danger)">${errorCount} lỗi</b></div>
      ${logs.length ? (() => {
        const kindLabel = (k) => (k === 'den_han' ? 'Đến hạn' : 'Báo lãi');
        const todayKey = new Date().toDateString(), yesterdayKey = new Date(Date.now() - 86400000).toDateString();
        let lastDay = '';
        return logs.map((l) => {
          const customer = S.getCustomer(l.customerId);
          const contract = l.contractId ? S.getContract(l.contractId) : null;
          const d = new Date(l.sentAt);
          const dayKey = d.toDateString();
          let head = '';
          if (dayKey !== lastDay) {
            lastDay = dayKey;
            head = `<div class="oa-day">${dayKey === todayKey ? 'Hôm nay' : dayKey === yesterdayKey ? 'Hôm qua' : ''}${dayKey === todayKey || dayKey === yesterdayKey ? ' · ' : ''}${formatDate(d)}</div>`;
          }
          const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
          return `${head}
        <div class="list-row" style="padding:12px 4px">
          <div class="row-thumb" style="background:${l.status === 'success' ? 'var(--success)' : 'var(--danger)'}">${icon(l.status === 'success' ? 'check' : 'x', 'icon-sm')}</div>
          <div class="row-main">
            <div class="row-title">${customer ? customer.name : '—'}${contract ? ' · ' + contract.code : ''}</div>
            <div class="row-sub oa-sub"><span>${hh}</span><span class="oa-chip ${l.triggeredBy === 'manual' ? 'b' : 'g'}">${l.triggeredBy === 'manual' ? 'Gửi tay' : 'Tự động'}</span><span class="oa-chip ${l.kind === 'den_han' ? 'b' : 'g'}">${kindLabel(l.kind)}</span></div>
            ${l.status === 'error' && l.errorMessage ? `<div class="oa-err">${l.errorMessage}</div>` : ''}
          </div>
        </div>`;
        }).join('');
      })() : emptyState({ iconName: 'message', title: 'Không có lần gửi nào phù hợp', message: hasFilter ? 'Thử bỏ bớt bộ lọc trạng thái/thời gian.' : 'Log sẽ hiện ở đây sau khi hệ thống gửi tin Zalo (tự động hoặc gửi tay).' })}
      ${moreHtml}
      </div>
    `;
    const moreBtn = slot.querySelector('#log-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', async () => {
        moreBtn.disabled = true;
        moreBtn.textContent = 'Đang tải...';
        try {
          await loadOlderLogs(null); // tải thêm 1 trang log cũ hơn, rồi hiện từ mốc đó trở đi
          logViewFrom = logCoveredFrom === -Infinity ? 0 : logCoveredFrom;
        } catch (err) { toast(err.message || 'Không tải được thêm lịch sử', 'error'); }
        drawList();
      });
    }
  }
}

// ------------------------------------------------------------
// Tab "Cấu hình" (chỉ super) — 2 mẫu: Đến hạn + Báo lãi.
// ------------------------------------------------------------
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
