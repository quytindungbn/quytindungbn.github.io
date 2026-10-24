import * as S from '../../state.js';
import { icon } from '../../icons.js';
import { pageHeader } from '../../components/shell.js';
import { emptyState, statusBadge, openPicker, pillSelectHtml, openResetPasswordModal, searchBoxHtml, bindSearchBox, installmentNextBoxHtml, bindInstallmentNextBox, installmentHintHtml, mountScrollTopButton } from '../../components/ui.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { formatVND, formatDate, formatNumber, daysUntil, daysBetween, startOfDay, parseViDate, maskViDate, toDateInputValue, copyText, colorFor, initials, debounce, stripDiacritics, stripDiacriticsKeepCase, escapeHtml, boldDigits } from '../../utils.js';
import { readExcelFirstSheet, rowsToTsv, remapReportTemplateRows } from '../../lib/excelLite.js';
import { isSupplementReportRows, parseSupplementReportRows } from '../../lib/xlsxLite.js';
import { buildVietQrUrl, qrImageSrc, downloadQrImage, shareQrImage, bindMoneyInput } from '../contractDetail.js';
import { transferContent } from '../../lib/transferContent.js';
import { interestAsOfForDays, MAX_INTEREST_DAYS } from '../../lib/interestDays.js';
import { describeCallTime, formatPhoneDisplay } from '../../lib/callHistory.js';
import { buildLoanSummaryText } from '../../lib/loanSummary.js';
import { printNotice } from '../../lib/printNotices.js';
import { openImportPreview, openImportHistory, importSummaryHtml, importDetailsHtml, bindImportDetails } from './importReview.js';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Khách hàng & Hợp đồng' });
}

const SORT_OPTIONS = [
  { value: 'default', label: 'Mặc định' },
  { value: 'principal-asc', label: 'Gốc: Thấp → Cao' },
  { value: 'principal-desc', label: 'Gốc: Cao → Thấp' },
  { value: 'interest-asc', label: 'Lãi: Thấp → Cao' },
  { value: 'interest-desc', label: 'Lãi: Cao → Thấp' },
];
const SORT_LABEL = Object.fromEntries(SORT_OPTIONS.map((o) => [o.value, o.label]));
const COLLATERAL_NAMES = Object.freeze({
  '01': 'Quyền sử dụng đất chính chủ',
  '02': 'Quyền sử dụng đất bên thứ 3',
  '04': 'Xe ô tô chính chủ',
  '06': 'Sổ tiết kiệm',
});

// "Gần đến hạn" ở đây rộng hơn hẳn NEAR_DUE_DAYS (15 ngày, dùng cho nhắc nợ/
// Zalo OA...) — hiển thị TRƯỚC tới S.WIDE_NEAR_DUE_DAYS (45) ngày, y hệt
// ngưỡng của popup "Gần đến hạn" ở Tổng quan (xem UPCOMING_LIST_CAP_DAYS
// trong overview.js — dùng CHUNG S.contractAttentionInfo() ở state.js với
// trang này), để xem trước lịch sắp tới xa hơn ngay tại trang này.

let query = '';
let filterThon = []; // rỗng = Tất cả — có thể tích chọn nhiều Thôn cùng lúc
let filterXom = [];  // rỗng = Tất cả — có thể tích chọn nhiều Xóm cùng lúc
let urgencyFilter = 'all'; // 'all' | 'qua_han' | 'gan_den_han' — CHỈ chọn được 1 trong 3 (không phải nhiều lựa chọn cùng lúc như trước)
let sortMode = 'default';
// Lọc theo khoảng của từng khách: số tiền (tổng dư nợ gốc / tổng lãi tạm tính) và số ngày lãi (của hợp đồng); null = không giới hạn phía đó.
let amountRange = { interestMin: null, interestMax: null, principalMin: null, principalMax: null, daysMin: null, daysMax: null };
let filterSheetRefresh = null; // vẽ lại bảng "Bộ lọc" (điện thoại) khi đang mở và lựa chọn đổi
const manualOaSending = new Set();
const manualOaSentAt = new Map();
// Nhãn hiển thị dùng chung cho urgencyFilter — dùng lại khi ghi Nhật ký sử
// dụng (S.logAdminAction('filter-customers', ...)), khỏi lặp lại chuỗi.
const URGENCY_FILTER_LABELS = { all: 'Tất cả', qua_han: 'Nợ quá hạn', gan_den_han: 'Gần đến hạn' };

/**
 * Reset MỌI bộ lọc/ô tìm kiếm về mặc định — KHÔNG gọi từ render() (cố tình
 * giữ bộ lọc khi CÙNG 1 người chuyển qua trang khác rồi quay lại, xem ghi
 * chú trong render()), CHỈ gọi từ app.js đúng lúc đổi NGƯỜI đang đăng nhập
 * (đăng xuất/đăng nhập tài khoản khác) — biến ở đây sống theo cả trang web
 * (module-level), không tự mất khi đổi phiên, nếu không reset thì người
 * vào sau sẽ thấy nguyên bộ lọc/kết quả tìm kiếm của người trước để lại.
 */
export function resetFilters() {
  query = ''; filterThon = []; filterXom = []; urgencyFilter = 'all'; sortMode = 'default';
  clearAmountRange();
  manualOaSending.clear(); manualOaSentAt.clear();
}

function clearAmountRange() { amountRange = { interestMin: null, interestMax: null, principalMin: null, principalMax: null, daysMin: null, daysMax: null }; }
const interestRangeOn = () => amountRange.interestMin != null || amountRange.interestMax != null;
const principalRangeOn = () => amountRange.principalMin != null || amountRange.principalMax != null;
const daysRangeOn = () => amountRange.daysMin != null || amountRange.daysMax != null;
const amountRangeCount = () => (interestRangeOn() ? 1 : 0) + (principalRangeOn() ? 1 : 0) + (daysRangeOn() ? 1 : 0);
const amountInRange = (value, min, max) => (min == null || value >= min) && (max == null || value <= max);
/** Mô tả ngắn cho nhật ký: "Lãi từ 100.000 đến 500.000; Gốc từ 50.000.000". */
function amountRangeDesc() {
  const part = (label, min, max) => (min == null && max == null ? '' : `${label}${min != null ? ` từ ${formatNumber(min)}` : ''}${max != null ? ` đến ${formatNumber(max)}` : ''}`);
  return [part('Lãi', amountRange.interestMin, amountRange.interestMax), part('Gốc', amountRange.principalMin, amountRange.principalMax), part('Ngày lãi', amountRange.daysMin, amountRange.daysMax)].filter(Boolean).join('; ');
}
/** Khối 3 dòng "Số ngày lãi / Số tiền lãi / Gốc: từ … đến …" — dùng chung cho hộp Sắp xếp (máy tính) và bảng Bộ lọc (điện thoại). */
function amountRangeHtml() {
  const group = (title, minKey, maxKey, unit = '₫') => `<div class="amt-group">
      <div class="amt-title">${title}</div>
      <div class="amt-pair">
        <label class="amt-box"><small>Từ</small><input type="text" inputmode="numeric" autocomplete="off" placeholder="0" enterkeyhint="done" data-amt="${minKey}" aria-label="${title} từ"/><i>${unit}</i></label>
        <label class="amt-box"><small>Đến</small><input type="text" inputmode="numeric" autocomplete="off" placeholder="Không giới hạn" enterkeyhint="done" data-amt="${maxKey}" aria-label="${title} đến"/><i>${unit}</i></label>
      </div>
    </div>`;
  return `<div class="amt-filter">${group('Số ngày lãi', 'daysMin', 'daysMax', 'ngày')}${group('Số tiền lãi', 'interestMin', 'interestMax')}${group('Gốc', 'principalMin', 'principalMax')}<p class="amt-warn" hidden>Số "Từ" đang lớn hơn số "Đến" nên không có khách nào khớp.</p></div>`;
}

function multiPillLabel(prefix, values) {
  if (!values.length) return `${prefix}: Tất cả `;
  if (values.length === 1) return `${prefix}: ${values[0]} `;
  return `${prefix}: ${values.length} đã chọn `;
}

function currentAdmin() {
  const session = S.getSession();
  return S.getAdmin(session.id);
}

let ledgerDrawToken = 0;
const LEDGER_FIRST_CHUNK = 30; // số khách vẽ ngay khi vào trang
const LEDGER_NEXT_CHUNK = 80; // số khách thêm mỗi đợt sau đó

export function render(contentEl, filterEl) {
  const admin = currentAdmin();
  const isStaff = admin.role === 'staff';
  // KHÔNG reset filterThon/filterXom/sortMode ở đây nữa — giữ nguyên bộ lọc
  // đang chọn khi chuyển qua trang khác rồi quay lại, giống hệt cách
  // urgencyFilter (Quá hạn/Gần đến hạn) và query (ô tìm kiếm) đã làm từ
  // trước (2 biến đó cũng không hề bị reset ở render()).

  filterEl.innerHTML = `
    <div class="filter-align-content"><div class="filter-card${isStaff ? ' no-actions' : ''}">
      ${searchBoxHtml('search-input', window.matchMedia('(max-width: 899px)').matches ? 'Tìm tên, SĐT, HĐ' : 'Tìm tên, CCCD, SĐT, số hợp đồng...', query)}
      <button type="button" class="filter-open-btn" id="btn-filter-open">${icon('filter', 'icon-sm')}<span>Lọc</span><i class="filter-open-badge" hidden></i></button>
      <button type="button" class="filter-open-clear" id="btn-filter-clear" aria-label="Xóa tất cả bộ lọc" title="Xóa lọc" hidden>✕</button>
      ${!isStaff ? `<button type="button" class="filter-import-btn" id="btn-filter-import" aria-label="Nhập từ Excel" title="Nhập từ Excel">${icon('paperclip')}</button>` : ''}
      <div class="filter-row filter-pills" id="filter-pills-row"></div>
      <div class="segmented-row filter-seg mb-8">
        <button class="${urgencyFilter === 'all' ? 'active' : ''}" data-urgency="all"><b class="seg-n"></b><span>Tất cả</span></button>
        <button class="${urgencyFilter === 'qua_han' ? 'active' : ''}" data-urgency="qua_han"><b class="seg-n"></b><span>Nợ quá hạn</span></button>
        <button class="${urgencyFilter === 'gan_den_han' ? 'active' : ''}" data-urgency="gan_den_han"><b class="seg-n"></b><span>Gần đến hạn</span></button>
      </div>
      ${!isStaff ? `
      <div class="flex gap-8 mb-8 filter-actions">
        <button class="btn btn-outline btn-sm" id="btn-import">${icon('paperclip', 'icon-sm')} Nhập từ Excel</button>
      </div>` : ''}
      <div class="filter-sum"></div>
    </div></div>
  `;
  bindSearchBox(filterEl, 'search-input', (v) => { query = v; draw(); });
  mountScrollTopButton(filterEl); // nút nhỏ về đầu trang khi kéo xuống danh sách dài
  if (!isStaff) {
    filterEl.querySelector('#btn-import').addEventListener('click', openImportModal);
    filterEl.querySelector('#btn-filter-import').addEventListener('click', openImportModal); // nút nhập Excel dạng biểu tượng trên điện thoại
  }
  filterEl.querySelectorAll('[data-urgency]').forEach((chip) => {
    chip.addEventListener('click', () => {
      // CHỈ chọn được 1 trong 3 tại 1 thời điểm (giống nút radio) — bấm 1 nút
      // là tự bỏ chọn nút kia, khác kiểu tích nhiều trước đây.
      urgencyFilter = chip.dataset.urgency;
      // Chỉ vẽ lại phần danh sách (draw()), KHÔNG gọi lại render() — render()
      // reset cả filterThon/filterXom/sortMode (chỉ nên xảy ra lúc mới vào
      // trang), gọi lại nó ở đây sẽ xóa mất bộ lọc Thôn/Xóm đang chọn mỗi
      // lần bấm "Quá hạn"/"Gần đến hạn".
      filterEl.querySelectorAll('[data-urgency]').forEach((c) => {
        c.classList.toggle('active', c.dataset.urgency === urgencyFilter);
      });
      S.logAdminAction('filter-customers', { filterDesc: `Nhóm: **${URGENCY_FILTER_LABELS[urgencyFilter] || urgencyFilter}**` });
      draw();
    });
  });

  const sortPillLabel = () => {
    const on = [interestRangeOn() ? 'lãi' : '', principalRangeOn() ? 'gốc' : '', daysRangeOn() ? 'ngày' : ''].filter(Boolean);
    return `Sắp xếp: ${SORT_LABEL[sortMode]}${on.length ? ` · Lọc ${on.join(' + ')}` : ''} `;
  };
  // Gõ số tiền: lọc ngay sau khi ngừng gõ một chút (không vẽ lại danh sách ở mỗi phím).
  let amountTimer = null;
  const runAmountRange = () => { clearTimeout(amountTimer); amountTimer = null; renderFilterPills(); draw(); };
  const applyAmountRange = () => { clearTimeout(amountTimer); amountTimer = setTimeout(runAmountRange, 250); };
  /**
   * Gắn các ô "Từ/Đến" trong `root`; trả về hàm đưa lại giá trị hiện có vào ô (sau khi bấm Xóa lọc). Bấm Enter trong 1 ô = xong:
   * áp dụng ngay (không chờ 0,25 giây), ẩn bàn phím rồi gọi `onDone()` (đóng hộp/bảng lọc như bấm nút Xong/Áp dụng).
   */
  function bindAmountRange(root, onDone) {
    const warn = root.querySelector('.amt-warn');
    const check = () => {
      const bad = (a, b) => a != null && b != null && a > b;
      if (warn) warn.hidden = !(bad(amountRange.interestMin, amountRange.interestMax) || bad(amountRange.principalMin, amountRange.principalMax) || bad(amountRange.daysMin, amountRange.daysMax));
    };
    root.querySelectorAll('[data-amt]').forEach((input) => {
      const key = input.dataset.amt;
      bindMoneyInput(input, amountRange[key] || 0, (v) => { amountRange[key] = v > 0 ? v : null; check(); applyAmountRange(); });
      input.addEventListener('change', () => { if (amountRangeDesc()) S.logAdminAction('filter-customers', { filterDesc: `Lọc số tiền: **${amountRangeDesc()}**` }); });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        input.blur();
        runAmountRange();
        if (amountRangeDesc()) S.logAdminAction('filter-customers', { filterDesc: `Lọc số tiền: **${amountRangeDesc()}**` });
        onDone?.();
      });
    });
    check();
    return () => { root.querySelectorAll('[data-amt]').forEach((input) => { const v = amountRange[input.dataset.amt]; input.value = v ? formatNumber(v) : ''; }); check(); };
  }
  /** Máy tính: hộp "Sắp xếp & lọc số tiền" — chọn kiểu sắp xếp + nhập khoảng Lãi/Gốc; đổi gì là áp dụng ngay, bấm Xong để đóng. */
  function openSortDialog() {
    const optionsHtml = () => SORT_OPTIONS.map((o) => `<button type="button" class="sortdlg-opt${o.value === sortMode ? ' is-on' : ''}" data-sort="${o.value}"><span>${o.label}</span>${o.value === sortMode ? icon('check', 'icon-sm') : ''}</button>`).join('');
    openModal({
      title: 'Sắp xếp & lọc',
      sheetClass: 'sheet-sortdlg',
      bodyHtml: `<div class="sortdlg-h">Sắp xếp theo</div><div class="sortdlg-opts" id="sortdlg-opts">${optionsHtml()}</div>
        <div class="sortdlg-h sortdlg-h2"><span>Lọc theo khoảng</span><button type="button" id="sortdlg-clear">Xóa lọc số tiền &amp; ngày</button></div>${amountRangeHtml()}`,
      footHtml: `<button class="btn btn-primary btn-block" data-done>Xong</button>`,
      onMount(sheet, closeSheet) {
        const optsEl = sheet.querySelector('#sortdlg-opts');
        optsEl.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-sort]');
          if (!btn) return;
          sortMode = btn.dataset.sort;
          optsEl.innerHTML = optionsHtml();
          renderFilterPills();
          S.logAdminAction('filter-customers', { filterDesc: `Sắp xếp: **${SORT_LABEL[sortMode]}**` });
          draw();
        });
        const syncInputs = bindAmountRange(sheet, closeSheet);
        sheet.querySelector('#sortdlg-clear').addEventListener('click', () => {
          clearAmountRange(); syncInputs(); renderFilterPills(); draw();
          S.logAdminAction('filter-customers', { filterDesc: 'Xóa lọc số tiền & ngày lãi' });
        });
        sheet.querySelector('[data-done]').addEventListener('click', closeSheet);
      },
    });
  }

  /**
   * Vẽ lại cả 3 pill (Thôn/Xóm/Sắp xếp) theo đúng trạng thái lọc hiện tại rồi
   * gắn lại sự kiện — gọi mỗi khi có gì thay đổi (chọn lọc mới HOẶC bấm "x" bỏ
   * lọc) để dấu "x" hiện/ẩn đúng, KHÔNG động gì đến draw()/danh sách bên dưới
   * nếu không cần (tách riêng cho rõ: đổi lọc luôn kéo theo draw() lại, còn
   * đây chỉ là vẽ lại chính cái pill).
   */
  /** Xóa nhanh MỌI bộ lọc Thôn/Xóm/Sắp xếp/khoảng (không đụng ô tìm kiếm và 3 nút Tất cả/Quá hạn/Gần đến hạn) — dấu ✕ trên nút Lọc (điện thoại; máy tính đã có ✕ trên từng nút Thôn/Xóm/Sắp xếp). */
  function clearAllFilters() {
    filterThon = []; filterXom = []; sortMode = 'default'; clearAmountRange();
    renderFilterPills();
    S.logAdminAction('filter-customers', { filterDesc: 'Xóa bộ lọc Thôn/Xóm/Sắp xếp/số tiền' });
    draw();
  }
  const filterActiveCount = () => (filterThon.length ? 1 : 0) + (filterXom.length ? 1 : 0) + (sortMode !== 'default' ? 1 : 0) + amountRangeCount();
  filterEl.querySelector('#btn-filter-clear').addEventListener('click', clearAllFilters);
  function renderFilterPills() {
    const wrap = filterEl.querySelector('#filter-pills-row');
    wrap.innerHTML = `
      ${pillSelectHtml('pill-thon', multiPillLabel('Thôn', filterThon), filterThon.length > 0)}
      ${pillSelectHtml('pill-xom', multiPillLabel('Xóm', filterXom), filterXom.length > 0)}
      ${pillSelectHtml('pill-sort', sortPillLabel(), sortMode !== 'default' || amountRangeCount() > 0)}
    `;
    bindPickers();
    wrap.querySelectorAll('[data-pill-clear]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // không cho nổi bọt lên nút pill (sẽ mở nhầm picker)
        const id = btn.dataset.pillClear;
        if (id === 'pill-thon') { filterThon = []; filterXom = []; }
        else if (id === 'pill-xom') { filterXom = []; }
        else if (id === 'pill-sort') { sortMode = 'default'; clearAmountRange(); }
        renderFilterPills();
        draw();
      });
    });
    // Chấm số trên nút "Lọc" = số mục Thôn/Xóm/Sắp xếp đang được chọn.
    const activeCount = filterActiveCount();
    const badge = filterEl.querySelector('.filter-open-badge');
    if (badge) { badge.hidden = !activeCount; badge.textContent = String(activeCount); }
    const phoneClear = filterEl.querySelector('#btn-filter-clear');
    if (phoneClear) phoneClear.hidden = !activeCount;
    filterSheetRefresh?.();
  }
  function bindPickers() {
    filterEl.querySelector('#pill-thon').addEventListener('click', () => {
      const allowedThon = S.territoryThonList(admin.id); // nhân viên: chỉ Thôn trong địa bàn được cấp (kể cả Thôn chỉ được cấp vài Xóm)
      openPicker({
        title: 'Chọn Thôn (chọn được nhiều)', selected: filterThon, multiSelect: true,
        options: allowedThon.map((t) => ({ value: t, label: t })),
        onSelect: (vals) => {
          filterThon = vals; filterXom = [];
          renderFilterPills();
          S.logAdminAction('filter-customers', { filterDesc: `Thôn: **${vals.length ? vals.join(', ') : 'Tất cả'}**` });
          draw();
        },
      });
    });
    filterEl.querySelector('#pill-xom').addEventListener('click', () => {
      const xomList = S.territoryXomList(admin.id, filterThon.length ? filterThon : undefined);
      openPicker({
        title: 'Chọn Xóm (chọn được nhiều)', selected: filterXom, multiSelect: true,
        options: xomList.map((x) => ({ value: x, label: x })),
        onSelect: (vals) => {
          filterXom = vals;
          renderFilterPills();
          S.logAdminAction('filter-customers', { filterDesc: `Xóm: **${vals.length ? vals.join(', ') : 'Tất cả'}**` });
          draw();
        },
      });
    });
    filterEl.querySelector('#pill-sort').addEventListener('click', () => {
      // Máy tính: hộp "Sắp xếp" có thêm phần lọc theo số tiền. Điện thoại: giữ bảng chọn sắp xếp cũ (lọc số tiền nằm thẳng trong bảng "Bộ lọc").
      if (!window.matchMedia('(max-width: 899px)').matches) { openSortDialog(); return; }
      openPicker({
        title: 'Sắp xếp theo', selected: sortMode,
        options: SORT_OPTIONS,
        onSelect: (val) => {
          sortMode = val;
          renderFilterPills();
          S.logAdminAction('filter-customers', { filterDesc: `Sắp xếp: **${SORT_LABEL[val]}**` });
          draw();
        },
      });
    });
  }
  renderFilterPills();

  // ---- Điện thoại: nút "Lọc" mở bảng Thôn/Xóm/Sắp xếp; nút kẹp giấy = Nhập từ Excel (máy tính vẫn hiện thẳng các ô lọc, 2 nút này bị ẩn bằng CSS) ----
  filterEl.querySelector('#btn-filter-open').addEventListener('click', openFilterSheet);
  function openFilterSheet() {
    const valueOf = {
      thon: () => (filterThon.length ? filterThon.join(', ') : 'Tất cả'),
      xom: () => (filterXom.length ? filterXom.join(', ') : 'Tất cả'),
      sort: () => SORT_LABEL[sortMode],
    };
    const rowHtml = (key, label) => `<button type="button" class="fsheet-row" data-fkey="${key}"><span><small>${label}</small><b>${escapeHtml(valueOf[key]())}</b></span>${icon('chevronDown', 'icon-sm')}</button>`;
    openModal({
      title: 'Bộ lọc',
      bodyHtml: `<div class="fsheet-clear"><button type="button" id="fsheet-clear">Xóa lọc</button></div><div id="fsheet-fields"></div><div class="sortdlg-h sortdlg-h2 fsheet-amt-h"><span>Lọc theo khoảng</span><button type="button" id="fsheet-amt-clear">Xóa lọc số tiền &amp; ngày</button></div>${amountRangeHtml()}`,
      footHtml: `<button class="btn btn-primary btn-block" data-apply>Áp dụng</button>`,
      onClose() { filterSheetRefresh = null; },
      onMount(sheet, closeSheet) {
        const paintSheet = () => {
          sheet.querySelector('#fsheet-fields').innerHTML = rowHtml('thon', 'Thôn') + rowHtml('xom', 'Xóm') + rowHtml('sort', 'Sắp xếp');
          // Chọn từng mục dùng đúng bảng chọn (picker) của 3 ô lọc gốc — ô gốc bị ẩn trên điện thoại nhưng vẫn bấm được bằng mã.
          sheet.querySelectorAll('[data-fkey]').forEach((row) => row.addEventListener('click', () => filterEl.querySelector('#pill-' + row.dataset.fkey).click()));
        };
        filterSheetRefresh = paintSheet;
        paintSheet();
        const syncInputs = bindAmountRange(sheet, closeSheet); // ô số tiền nằm ngoài #fsheet-fields nên không bị vẽ lại khi đổi Thôn/Xóm/Sắp xếp
        sheet.querySelector('#fsheet-amt-clear').addEventListener('click', () => {
          clearAmountRange(); syncInputs(); renderFilterPills(); draw();
          S.logAdminAction('filter-customers', { filterDesc: 'Xóa lọc số tiền & ngày lãi' });
        });
        sheet.querySelector('#fsheet-clear').addEventListener('click', () => {
          filterThon = []; filterXom = []; sortMode = 'default'; clearAmountRange(); syncInputs();
          renderFilterPills();
          S.logAdminAction('filter-customers', { filterDesc: 'Xóa bộ lọc Thôn/Xóm/Sắp xếp/số tiền' });
          draw();
        });
        sheet.querySelector('[data-apply]').addEventListener('click', closeSheet);
      },
    });
  }

  function draw() {
    const canManageZalo = S.canManageZaloOA(S.getSession().id);
    let list = S.listCustomers({
      adminId: isStaff ? admin.id : undefined,
      thon: filterThon,
      xom: filterXom,
    });
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      // Tìm được cả theo SỐ HỢP ĐỒNG (Số HĐTD, VD "455/26"): giữ các khách có hợp
      // đồng ĐANG CÒN DƯ NỢ khớp số đó — cùng tập hợp đồng đang hiển thị bên dưới
      // (hợp đồng đã tất toán không hiện nên không dùng để tìm). Tìm được cả theo tên
      // NGƯỜI CÙNG ĐỨNG VAY (heirName, VD hợp đồng "PHẠM THỊ TÀI và NGUYỄN DUY HUY" thì
      // gõ NGUYỄN DUY HUY vẫn ra hợp đồng đó).
      const contractMatchedCustomerIds = new Set(
        S.getState().contracts
          .filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan' && (String(ct.code || '').toLowerCase().includes(q) || String(ct.heirName || '').toLowerCase().includes(q)))
          .map((ct) => ct.customerId)
      );
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.cccd.includes(q) || (c.phone || '').includes(q) || contractMatchedCustomerIds.has(c.id));
    }
    // Gộp sẵn hợp đồng + tổng gốc (= dư nợ hiện tại)/lãi + mức "đáng chú ý
    // nhất" (quá hạn/gần đến hạn bao nhiêu ngày) từng khách hàng — dùng để
    // hiển thị & sắp xếp. Hợp đồng đã tất toán (dư nợ = 0) KHÔNG đưa vào
    // danh sách hiển thị nữa — bỏ hẳn ngay từ đây.
    let enriched = list.map((c) => {
      const contracts = S.listContractsByCustomer(c.id).filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan');
      const totalBalance = contracts.reduce((s, ct) => s + (ct.balance || 0), 0);
      const totalInterest = contracts.reduce((s, ct) => s + S.accruedInterest(ct), 0);
      // Xét CẢ ngày đáo hạn hợp đồng gốc LẪN "Kỳ tới" của phân kỳ trả nợ (nếu
      // có) — xem S.contractAttentionInfo(). Ngưỡng "gần đến hạn" RỘNG 45
      // ngày (khớp popup "Gần đến hạn" ở Tổng quan) — không phải đúng 15
      // ngày "chính thức" của contractUrgency()/NEAR_DUE_DAYS nữa.
      const contractInfos = contracts.map((ct) => ({ ct, info: S.contractAttentionInfo(ct) }));
      const overdueContracts = contractInfos.filter((x) => x.info.level === 'qua_han').map((x) => x.ct);
      const nearDueContracts = contractInfos.filter((x) => x.info.level === 'gan_den_han').map((x) => x.ct);
      const hasOverdue = overdueContracts.length > 0;
      const hasNearDue = !hasOverdue && nearDueContracts.length > 0;
      // Mốc đáng chú ý nhất chỉ dùng để lọc/sắp xếp; mỗi hợp đồng tự hiện trạng thái riêng cạnh mã HĐTD.
      const mostOverdueDays = hasOverdue ? Math.max(...contractInfos.filter((x) => x.info.level === 'qua_han').map((x) => x.info.days)) : 0;
      const mostNearDueDays = hasNearDue ? Math.min(...contractInfos.filter((x) => x.info.level === 'gan_den_han').map((x) => x.info.days)) : 0;
      return { c, contracts, totalBalance, totalInterest, hasOverdue, hasNearDue, mostOverdueDays, mostNearDueDays };
    });
    // Khách không còn dư nợ nào (hết hợp đồng, hoặc file mới nhất không còn
    // họ nữa nên hợp đồng đã bị full-sync xóa) thì KHÔNG hiển thị ở đây nữa
    // — dù hồ sơ/tài khoản Use của họ vẫn được giữ (xem Quản lý User), chỉ
    // là không còn hiện trong danh sách khách hàng đang vay này.
    enriched = enriched.filter((e) => e.totalBalance > 0);
    // Lọc theo khoảng Lãi/Gốc (tổng của khách) và Số ngày lãi (khách có ÍT NHẤT 1 hợp đồng trong khoảng) — trước khi đếm số khách từng nhóm để 3 con số ở nút lọc khớp với danh sách.
    if (amountRangeCount()) {
      enriched = enriched.filter((e) => amountInRange(Math.round(e.totalInterest), amountRange.interestMin, amountRange.interestMax)
        && amountInRange(e.totalBalance, amountRange.principalMin, amountRange.principalMax)
        && (!daysRangeOn() || e.contracts.some((ct) => amountInRange(S.interestDaysAccrued(ct), amountRange.daysMin, amountRange.daysMax))));
    }
    // Số khách của từng nhóm (theo đúng tìm kiếm/Thôn/Xóm đang chọn) hiện cạnh 3 nút lọc.
    const urgencyCounts = { all: enriched.length, qua_han: enriched.filter((e) => e.hasOverdue).length, gan_den_han: enriched.filter((e) => e.hasNearDue).length };
    filterEl.querySelectorAll('[data-urgency]').forEach((btn) => {
      const badge = btn.querySelector('.seg-n');
      if (badge) badge.textContent = urgencyCounts[btn.dataset.urgency] ?? 0;
    });
    if (urgencyFilter === 'qua_han') enriched = enriched.filter((e) => e.hasOverdue);
    // "Gần đến hạn" dùng ngưỡng RỘNG 45 ngày (isWideNearDue), không phải
    // đúng 15 ngày của contractUrgency() — xem giải thích ở WIDE_NEAR_DUE_DAYS.
    else if (urgencyFilter === 'gan_den_han') enriched = enriched.filter((e) => e.hasNearDue);
    // Đang lọc theo "Nợ quá hạn"/"Gần đến hạn" thì tự sắp theo SỐ NGÀY tăng
    // dần (0, 1, 2, 3...) — đúng số ngày đáng chú ý nhất của từng khách hàng
    // — thay hẳn cho lựa chọn ở nút "Sắp xếp" (Gốc/Lãi không còn ý nghĩa ưu
    // tiên bằng số ngày khi đang xem đúng 1 nhóm cần chú ý này).
    if (urgencyFilter === 'qua_han') enriched.sort((a, b) => a.mostOverdueDays - b.mostOverdueDays);
    else if (urgencyFilter === 'gan_den_han') enriched.sort((a, b) => a.mostNearDueDays - b.mostNearDueDays);
    else if (sortMode !== 'default') {
      const [field, dir] = sortMode.split('-');
      const key = field === 'principal' ? 'totalBalance' : 'totalInterest';
      enriched.sort((a, b) => (dir === 'asc' ? a[key] - b[key] : b[key] - a[key]));
    }
    const totalContracts = enriched.reduce((s, e) => s + e.contracts.length, 0);
    const totalAmount = enriched.reduce((s, e) => s + e.totalBalance, 0);

    // Danh sách dài hàng trăm/nghìn khách: vào trang chỉ vẽ ngay LỚP ĐẦU để hiện tức thì, phần còn lại thêm dần từng đợt phía dưới (người dùng chưa cuộn
    // tới nên không thấy khác biệt). Đang cuộn giữa danh sách (vẽ lại do dữ liệu mới/đổi lọc) thì vẽ đủ ngay như trước để vị trí cuộn không nhảy.
    const drawToken = ++ledgerDrawToken;
    const progressive = window.scrollY < 40 && enriched.length > LEDGER_FIRST_CHUNK;
    const firstGroups = progressive ? enriched.slice(0, LEDGER_FIRST_CHUNK) : enriched;
    contentEl.innerHTML = `
      <div class="customer-list-summary">${enriched.length} khách hàng · ${totalContracts} hợp đồng · <strong>${formatVND(totalAmount)}</strong></div>
      ${enriched.length ? customerLedgerHtml(firstGroups, canManageZalo, { framed: true }) : emptyState({ iconName: 'users', title: 'Không có khách hàng phù hợp', message: isStaff ? 'Chưa có khách hàng nào ở địa bàn bạn được xem.' : 'Dùng "Nhập từ Excel" hoặc "Tạo tài khoản khách hàng" để bắt đầu.' })}
      ${enriched.length ? `<nav class="customer-page-jump" aria-label="Di chuyển trong danh sách khách hàng">
        <button type="button" data-jump="top" title="Lên đầu trang" aria-label="Lên đầu trang">↑</button>
        <button type="button" data-jump="bottom" title="Xuống cuối trang" aria-label="Xuống cuối trang">↓</button>
      </nav>` : ''}
    `;
    // Điện thoại: dòng tóm tắt nằm ngay trong khung lọc (máy tính vẫn hiện phía trên danh sách — xem CSS .filter-sum).
    const filterSumEl = filterEl.querySelector('.filter-sum');
    if (filterSumEl) filterSumEl.innerHTML = `${enriched.length} khách hàng · ${totalContracts} hợp đồng · <strong>${formatVND(totalAmount)}</strong>`;
    bindCustomerLedger(contentEl, { readOnly: isStaff });
    // Thêm dần phần còn lại của danh sách (mỗi đợt một khung hình); trang khác/vẽ lại thì tự dừng.
    let restGroups = progressive ? enriched.slice(LEDGER_FIRST_CHUNK) : [];
    const ledgerEl = contentEl.querySelector('.customer-ledger');
    const appendNextChunk = () => {
      if (!restGroups.length || drawToken !== ledgerDrawToken || !ledgerEl?.isConnected) { restGroups = []; return; }
      ledgerEl.insertAdjacentHTML('beforeend', customerLedgerGroupsHtml(restGroups.slice(0, LEDGER_NEXT_CHUNK), canManageZalo));
      restGroups = restGroups.slice(LEDGER_NEXT_CHUNK);
      if (restGroups.length) requestAnimationFrame(appendNextChunk);
    };
    const appendAllNow = () => { while (restGroups.length) appendNextChunk(); };
    if (restGroups.length) requestAnimationFrame(appendNextChunk);
    contentEl.querySelectorAll('.customer-page-jump [data-jump]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.jump === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        // Xuống cuối: vẽ nốt phần còn lại rồi cuộn; các khối ở xa được vẽ lười (content-visibility) nên chiều cao còn dịch chuyển khi tới nơi — cuộn lại vài lần cho tới đúng đáy.
        appendAllNow();
        let tries = 0;
        const goBottom = () => {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: tries ? 'auto' : 'smooth' });
          if (++tries < 4) setTimeout(() => { if (window.innerHeight + window.scrollY < document.documentElement.scrollHeight - 4) goBottom(); }, 450);
        };
        goBottom();
      });
    });
  }
  draw();
  window.__qtdRedrawCustomers = draw;
}

/** Các khối khách hàng (mỗi khách một khối kèm hợp đồng) — tách riêng để trang Khách hàng vẽ dần từng đợt, xem draw(). */
export function customerLedgerGroupsHtml(groups, canManageZalo) {
  return groups.map(({ c, contracts, totalBalance }) => {
        const location = [c.xom, c.thon, c.tinh].filter(Boolean).join(', ') || c.address || 'Chưa có địa bàn';
        const dialPhone = String(c.phone || '').replace(/[^\d+]/g, '');
        return `<section class="customer-ledger-group" style="--g-n:${contracts.length}">
          <div class="customer-ledger-person">
            <button type="button" class="customer-ledger-person-main" data-id="${c.id}" aria-label="Xem khách hàng ${escapeHtml(c.name)}">
              <span class="customer-ledger-avatar" style="background:${colorFor(c.id)}">${initials(c.name)}</span>
              <span class="customer-ledger-identity">
                <span class="customer-ledger-name">${escapeHtml(c.name)}</span>
                <span class="customer-ledger-address">${escapeHtml(location)}</span>
              </span>
              ${contracts.length > 1 ? `<span class="customer-ledger-total">Tổng dư nợ: <strong>${formatVND(totalBalance)}</strong></span>` : ''}
            </button>
            ${dialPhone ? `<a class="customer-ledger-call" href="tel:${escapeHtml(dialPhone)}" aria-label="Gọi ${escapeHtml(c.name)}" title="Gọi ${escapeHtml(c.phone)}">${icon('phone', 'icon-sm')} Gọi</a>` : `<span class="customer-ledger-call is-off" role="img" aria-label="Chưa có số điện thoại" title="Chưa có số điện thoại">${icon('phone', 'icon-sm')} Gọi</span>`}
          </div>
          ${contracts.map((ct) => contractLedgerRow(ct, canManageZalo)).join('')}
        </section>`;
      }).join('');
}

/** Cùng một bảng hợp đồng cho trang Khách hàng và hai danh sách cảnh báo ở Tổng quan. */
export function customerLedgerHtml(groups, canManageZalo, { framed = false } = {}) {
  return `<div class="customer-ledger-wrap ${framed ? 'is-framed' : ''} ${canManageZalo ? 'has-oa-actions' : ''}">
    <div class="customer-ledger-heading">
      <div class="customer-ledger-columns" aria-hidden="true">
        <div class="customer-ledger-column-main">
          <span>HỢP ĐỒNG · TÌNH TRẠNG</span><span>NGÀY VAY</span><span>ĐẾN HẠN</span><span>DƯ NỢ</span>
          <span>ĐÃ TRẢ LÃI ĐẾN</span><span>SỐ NGÀY LÃI</span><span>LÃI CỘNG DỒN</span>
        </div>
        ${canManageZalo ? '<span class="customer-ledger-oa-heading">GỬI OA</span>' : ''}
      </div>
    </div>
    <div class="customer-ledger">
      ${customerLedgerGroupsHtml(groups, canManageZalo)}
    </div>
  </div>`;
}

export function bindCustomerLedger(root, { readOnly = false } = {}) {
  const wrap = root.querySelector('.customer-ledger-wrap');
  if (!wrap) return;
  const ledger = wrap.querySelector('.customer-ledger');
  const ledgerColumns = wrap.querySelector('.customer-ledger-columns');
  if (ledger && ledgerColumns) {
    ledger.addEventListener('scroll', () => {
      ledgerColumns.style.transform = `translateX(${-ledger.scrollLeft}px)`;
    }, { passive: true });
  }
  // MỘT bộ lắng nghe cho cả danh sách (thay vì gắn riêng từng nút) — danh sách dài hàng nghìn nút, và các khối thêm sau (vẽ dần) tự dùng được.
  wrap.addEventListener('click', (e) => {
    const callLink = e.target.closest('a.customer-ledger-call[href^="tel:"]');
    if (callLink && wrap.contains(callLink)) { // ghi lại lần gọi, vẫn để trình duyệt mở ứng dụng gọi điện như thường
      const person = callLink.closest('.customer-ledger-person')?.querySelector('[data-id]');
      if (person) S.logCall(person.dataset.id, callLink.getAttribute('href').replace(/^tel:/, ''));
      return;
    }
    const sendButton = e.target.closest('[data-send-oa]');
    if (sendButton && wrap.contains(sendButton)) { sendManualOa(sendButton.dataset.sendOa, sendButton); return; }
    const contractRow = e.target.closest('[data-view-contract]');
    if (contractRow && wrap.contains(contractRow)) {
      e.stopPropagation();
      openContractView(contractRow.dataset.customerId, S.getContract(contractRow.dataset.viewContract), { readOnly });
      return;
    }
    const personRow = e.target.closest('[data-id]');
    if (personRow && wrap.contains(personRow)) openCustomerDetail(personRow.dataset.id, { readOnly });
  });
  // Menu chuột phải gắn vào đúng dòng hợp đồng, không gắn vào tên khách hàng:
  // một khách có thể có nhiều món và mỗi giấy báo phải lấy đúng món được chọn.
  wrap.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('[data-view-contract]');
    if (!row || !wrap.contains(row) || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    event.preventDefault();
    showContractNoticeMenu(row.dataset.viewContract, event.clientX, event.clientY);
  });
}

let closeContractNoticeMenu = null;

/** anchor: nút bấm mở menu (nút "In giấy báo" trên tiêu đề chi tiết hợp đồng) — menu canh mép phải theo nút và bấm lại nút thì đóng; không có anchor là menu chuột phải. */
function showContractNoticeMenu(contractId, clientX, clientY, { anchor = null } = {}) {
  closeContractNoticeMenu?.();
  const contract = S.getContract(contractId);
  const customer = contract && S.getCustomer(contract.customerId);
  if (!contract || !customer) return;
  const menu = document.createElement('div');
  menu.className = anchor ? 'customer-notice-menu from-button' : 'customer-notice-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', `In giấy báo hợp đồng ${contract.code}`);
  const itemIcon = anchor ? icon('printer') : '';
  menu.innerHTML = `
    <div class="customer-notice-menu-heading">${anchor ? 'Giấy báo – ' : ''}HĐTD ${escapeHtml(contract.code)}</div>
    <button type="button" role="menuitem" data-notice="interest">${itemIcon}<span>In thông báo nộp lãi</span></button>
    <button type="button" role="menuitem" data-notice="due">${itemIcon}<span>In giấy báo hợp đồng đến hạn</span></button>`;
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  const left = anchor ? clientX - bounds.width : clientX;
  menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - bounds.height - 8))}px`;
  function close() {
    menu.remove();
    if (anchor) { anchor.classList.remove('is-open'); anchor.setAttribute('aria-expanded', 'false'); }
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', escape);
    window.removeEventListener('scroll', close, true);
    if (closeContractNoticeMenu === close) closeContractNoticeMenu = null;
  }
  function outside(event) { if (!menu.contains(event.target) && !(anchor && anchor.contains(event.target))) close(); }
  // Dừng Escape tại đây để chỉ đóng menu, không đóng luôn cả khung chi tiết hợp đồng đang mở phía sau.
  function escape(event) { if (event.key === 'Escape') { event.stopPropagation(); close(); } }
  closeContractNoticeMenu = close;
  if (anchor) { anchor.classList.add('is-open'); anchor.setAttribute('aria-expanded', 'true'); }
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  window.addEventListener('scroll', close, true);
  menu.querySelectorAll('[data-notice]').forEach((button) => {
    button.addEventListener('click', () => {
      const type = button.dataset.notice;
      close();
      const opened = printNotice({ type, contract, customer, org: S.getOrg(), interest: S.accruedInterest(contract) });
      if (!opened) toast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép cửa sổ bật lên rồi thử lại.', 'error');
    });
  });
  menu.querySelector('button')?.focus();
}

/**
 * Gọi khi có dữ liệu mới nhưng admin vẫn đang đứng ở trang này (xem
 * renderApp() trong app.js) — CHỈ vẽ lại danh sách bằng draw() hiện có, KHÔNG
 * gọi render() nên bộ lọc Thôn/Xóm/Sắp xếp/Quá hạn đang chọn (và ô tìm kiếm
 * đang gõ) được giữ nguyên, không tự nhảy về "Tất cả" nữa.
 */
export function refresh() {
  if (window.__qtdRedrawCustomers) window.__qtdRedrawCustomers();
}

function openCustomerForm(customer) {
  const isEdit = !!customer;
  const close = openModal({
    title: isEdit ? 'Sửa khách hàng' : 'Tạo tài khoản khách hàng',
    bodyHtml: isEdit ? `
      <form id="cf">
        <div class="field"><label>Số CCCD</label><input name="cccd" required pattern="\\d{9,12}" value="${customer.cccd}" readonly/></div>
        <div class="field"><label>Họ tên</label><input name="name" required value="${esc(customer.name)}"/></div>
        <div class="field">
          <label>Số điện thoại</label>
          <input name="phone" value="${esc(customer.phone)}"/>
          <div class="field-hint">Khách hàng đăng nhập được bằng CCCD hoặc số điện thoại này — nên nhập cả 2 để khách dùng số nào cũng tra được đúng hợp đồng.</div>
        </div>
        <div class="field">
          <label>Địa chỉ</label>
          <input name="address" value="${esc(customer.address)}" placeholder="VD: Xóm 01, thôn Bình Nguyên, xã Bình Sơn, tỉnh Quảng Ngãi"/>
          <div class="field-hint">Hệ thống tự tách Xóm/Thôn/Tỉnh theo dấu phẩy để lọc & phân quyền, không cần nhập riêng từng ô.</div>
        </div>
      </form>
    ` : `
      <form id="cf">
        <div class="field"><label>Số CCCD</label><input name="cccd" required pattern="\\d{9,12}"/></div>
        <div class="field">
          <label>Mật khẩu đăng nhập</label>
          <input name="password" placeholder="Để trống sẽ tự sinh mật khẩu"/>
          <div class="field-hint">Để trống thì hệ thống tự sinh mật khẩu ngẫu nhiên, hiện ra sau khi lưu để gửi cho khách. Không cần nhập họ tên/SĐT/địa chỉ — nhập file Excel có CCCD này thì tài khoản sẽ tự động đồng bộ lấy đúng thông tin, tự thấy ngay các hợp đồng khớp CCCD.</div>
        </div>
      </form>
    `,
    footHtml: `<button class="btn btn-primary btn-block" id="save">${isEdit ? 'Lưu' : 'Tạo tài khoản'}</button>`,
    onMount(sheet, closeFn) {
      sheet.querySelector('#save').addEventListener('click', async () => {
        const form = sheet.querySelector('#cf');
        if (!form.reportValidity()) return;
        const fd = new FormData(form);
        if (isEdit) {
          try {
            await S.upsertCustomerProfile({
              cccd: fd.get('cccd'), name: fd.get('name'), phone: fd.get('phone'), address: fd.get('address'),
            });
            closeFn();
            toast('Đã cập nhật khách hàng', 'success');
            window.__qtdRedrawCustomers && window.__qtdRedrawCustomers();
          } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          return;
        }
        try {
          const res = await S.activateCustomerAccount({ cccd: fd.get('cccd'), password: fd.get('password') });
          closeFn();
          toast('Đã tạo tài khoản khách hàng', 'success');
          showCredential(res.customer, res.tempPassword);
          window.__qtdRedrawCustomers && window.__qtdRedrawCustomers();
        } catch (err) {
          toast(err.message || 'Có lỗi xảy ra', 'error');
        }
      });
    },
  });
  return close;
}

function showCredential(customer, tempPassword) {
  openModal({
    title: 'Tài khoản đã tạo',
    bodyHtml: `
      <p class="text-sm text-muted mb-16">Gửi thông tin sau cho khách hàng để họ đăng nhập lần đầu (bắt buộc đổi mật khẩu ngay sau khi đăng nhập):</p>
      <div class="card card-pad" style="background:var(--surface-alt)">
        <div class="oc-line"><span>Tên đăng nhập (CCCD)</span><b>${customer.cccd}</b></div>
        <div class="oc-line"><span>Mật khẩu tạm</span><b>${tempPassword}</b></div>
      </div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-close>Đã hiểu</button>`,
    onMount(sheet, closeFn) { sheet.querySelector('[data-close]').addEventListener('click', closeFn); },
  });
}

/**
 * Soạn sẵn tiêu đề + nội dung thông báo theo đúng tình trạng hiện tại của 1
 * hợp đồng — admin vẫn sửa lại thoải mái trước khi gửi (openSendNotificationModal).
 * 3 mẫu theo đúng yêu cầu:
 *   - Chưa đến hạn (còn xa, chưa vào diện "gần đến hạn"): chỉ nhắc lãi.
 *   - Gần đến hạn (S.contractStatusInfo().status === 'gan_den_han'): nhắc gốc + lãi + hạn chót.
 *   - Trễ hạn (S.contractStatusInfo().status === 'qua_han'): nhắc gốc + lãi, giọng mạnh hơn.
 * Tiêu đề mặc định LUÔN là "<tên quỹ> thông báo:" cho cả 3 mẫu (giống hệt
 * thông báo tự động ở send-due-reminders) — không còn tiêu đề riêng theo
 * từng loại nữa, cho đồng nhất.
 *
 * S.contractStatusInfo() xét CẢ ngày đáo hạn hợp đồng gốc LẪN "Kỳ tới" của
 * phân kỳ trả nợ (nếu có) — hợp đồng có 1 kỳ giữa chừng gần/quá hạn cũng tự
 * chuyển sang đúng mẫu này, "Số tiền gốc" lấy ĐÚNG số tiền của KỲ đó (không
 * phải toàn bộ dư nợ), "hạn chót" cũng lấy đúng ngày đến hạn của KỲ đó.
 */
/**
 * Tính sẵn phần DÙNG CHUNG cho cả thông báo App (buildContractNotificationPreset)
 * LẪN SMS (buildSmsLink) — accrued/info/org/mẫu (org.pushTemplates)/dueDate
 * đúng của KỲ đang cảnh báo (nếu có phân kỳ) — mỗi nơi gọi tự ghép token +
 * định dạng riêng (App in đậm số/ngày, SMS bỏ dấu cả chuỗi), tránh lặp code.
 */
function contractNotificationContext(contract) {
  const accrued = S.accruedInterest(contract);
  const info = S.contractStatusInfo(contract);
  const org = S.getOrg();
  const tpl = org.pushTemplates || S.DEFAULT_PUSH_TEMPLATES;
  // Ngày "hạn chót" hiện trong mẫu Gần đến hạn — lấy đúng ngày của KỲ đang
  // cảnh báo (nếu có), không phải luôn luôn Ngày đến hạn hợp đồng gốc.
  const dueDate = info.source === 'installment' ? S.nextInstallmentInfo(contract).next.dueDate : contract.dueDate;
  return { accrued, info, org, tpl, dueDate };
}

/** Chọn đúng mẫu BODY (chưa thay token) theo tình trạng hợp đồng — dùng chung cho cả App lẫn SMS. */
function pickNotificationBodyTemplate(tpl, info) {
  if (info.status === 'qua_han') return tpl.overdue;
  if (info.status === 'gan_den_han') return tpl.nearDue;
  return tpl.interest;
}

function buildContractNotificationPreset(contract, customer) {
  const { accrued, info, org, tpl, dueDate } = contractNotificationContext(contract);
  // Số tiền/ngày tháng in đậm (Unicode, xem ghi chú boldDigits() trong utils.js) để nổi bật hơn phần chữ xung quanh — chỉ áp cho GIÁ TRỊ, không áp cho nhãn chữ xung quanh.
  const tokens = {
    Ten_KH: customer ? customer.name : '',
    Ma_HD: contract.code,
    So_tien_goc: boldDigits(formatVND(info.dueAmount)),
    So_tien_lai: boldDigits(formatVND(accrued)),
    So_du: boldDigits(formatVND(contract.balance)),
    Ngay_dao_han: boldDigits(formatDate(dueDate)),
    Ten_quy: org.shortName,
  };
  const title = S.renderNotificationTemplate(tpl.title, tokens);
  const body = S.renderNotificationTemplate(pickNotificationBodyTemplate(tpl, info), tokens);
  return { title, body };
}

/**
 * Admin tự soạn + gửi ngay 1 thông báo đẩy cho 1 khách hàng — tiện dùng khi
 * cần nhắc riêng ngoài lịch tự động. `preset` (tùy chọn) điền sẵn tiêu
 * đề/nội dung (VD: soạn sẵn theo đúng tình trạng hợp đồng, xem
 * buildContractNotificationPreset) — admin vẫn sửa lại thoải mái trước khi
 * gửi. Khách phải đã bật thông báo trên ít nhất 1 thiết bị thì mới gửi được
 * — báo lỗi rõ nếu chưa bật. Popup KHÔNG tự đóng sau khi gửi để admin thấy
 * rõ trạng thái thành công/thất bại ngay tại chỗ.
 */
function openSendNotificationModal(customer, preset = {}) {
  openModal({
    title: `Gửi thông báo cho ${customer.name}`,
    bodyHtml: `
      <div class="field">
        <label>Tiêu đề</label>
        <input id="noti-title" maxlength="60" placeholder="VD: Nhắc thanh toán" value="${escapeHtml(preset.title || '')}"/>
      </div>
      <div class="field">
        <label>Nội dung</label>
        <textarea id="noti-body" rows="4" maxlength="300" placeholder="Nội dung thông báo..." style="width:100%;border:1px solid var(--border-strong);border-radius:8px;padding:10px;font-size:13px">${escapeHtml(preset.body || '')}</textarea>
      </div>
      <div id="noti-status" class="text-sm mt-8"></div>
      <button class="btn btn-primary btn-block mt-8" id="btn-do-send-noti">${icon('bell', 'icon-sm')} Gửi ngay</button>
    `,
    onMount(sheet) {
      const statusEl = sheet.querySelector('#noti-status');
      sheet.querySelector('#btn-do-send-noti').addEventListener('click', async (e) => {
        const title = sheet.querySelector('#noti-title').value.trim();
        const body = sheet.querySelector('#noti-body').value.trim();
        if (!title || !body) { toast('Cần nhập đủ tiêu đề và nội dung', 'error'); return; }
        const btn = e.target.closest('button');
        btn.disabled = true;
        statusEl.innerHTML = `<span class="text-muted">Đang gửi...</span>`;
        try {
          const res = await S.sendManualNotification(customer.id, title, body);
          if (!res.ok) {
            statusEl.innerHTML = `<span class="text-danger">${icon('x', 'icon-sm')} Gửi thất bại — ${escapeHtml(res.reason || 'có lỗi xảy ra')}</span>`;
            toast(res.reason || 'Gửi không thành công', 'error');
            return;
          }
          statusEl.innerHTML = `<span class="text-success">${icon('check', 'icon-sm')} Đã gửi thông báo thành công${res.sentCount ? ` tới ${res.sentCount} thiết bị` : ''}</span>`;
          toast('Đã gửi thông báo tới khách hàng', 'success');
        } catch (err) {
          statusEl.innerHTML = `<span class="text-danger">${icon('x', 'icon-sm')} Gửi thất bại — ${escapeHtml(err.message || 'có lỗi xảy ra')}</span>`;
          toast(err.message || 'Có lỗi xảy ra', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    },
  });
}

/**
 * context 'customer' (mặc định, mở từ trang Khách hàng & Hợp đồng): KHÔNG có
 * nút xóa — hồ sơ/hợp đồng đến từ file Excel, tất toán/không còn trong file
 * nữa thì tự dọn theo (xem full-sync), không xóa tay từ màn chi tiết này.
 * context 'use' (mở từ trang Quản lý User): nút xóa là "Xóa Use" — chỉ gỡ
 * tài khoản đăng nhập, KHÔNG đụng đến hồ sơ/hợp đồng vì 2 thứ này độc lập
 * với nhau (hợp đồng vẫn còn nguyên trong Khách hàng & Hợp đồng sau khi xóa).
 */
/** Nút thêm/bỏ OA đúng theo trạng thái hiện tại — tách riêng để cập nhật TẠI CHỖ sau khi thêm/bỏ (xem updateZaloUi trong openCustomerDetail), khỏi phải đóng/mở lại cả modal (trước đây làm vậy gây "chớp khung như tải lại"). */
function zaloActionButtonHtml(inZaloList) {
  return inZaloList
    ? `<button class="btn btn-outline btn-sm" id="btn-remove-zalo-cust">${icon('message', 'icon-sm')} Bỏ khỏi OA</button>`
    : `<button class="btn btn-outline btn-sm" id="btn-add-zalo-cust">${icon('message', 'icon-sm')} Thêm vào OA</button>`;
}

/** Chấm tròn xanh (đã có) / đỏ (chưa) nhỏ cạnh tên trạng thái trong chi tiết khách hàng. */
const statusDotInline = (on) => `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${on ? 'var(--success)' : 'var(--danger)'};flex:none"></span>`;

// ------------------------------------------------------------
// Chi tiết khách hàng — thanh Gọi, Lịch sử cuộc gọi, thẻ hợp đồng. Mỗi lần bấm "Gọi" (ở danh sách hoặc ở đây) được ghi lại: giờ phút to rõ bên trái,
// ngày/thứ ngay dưới, người gọi bên phải. Toàn quyền thấy cuộc gọi của mọi người; nhân viên chỉ thấy của mình (xem S.listCallsByCustomer).
// ------------------------------------------------------------
const CALL_PREVIEW = 4; // số cuộc gọi hiện sẵn, còn lại bấm "Xem thêm"

function callBarHtml(calls, dialPhone, c) {
  const last = calls[0];
  const t = last ? describeCallTime(last.createdAt) : null;
  const lastHtml = last
    ? `<div class="cd-last"><small>Gọi gần nhất</small><b>${escapeHtml(t.ago || t.rel)}</b><span>${t.days === 0 ? 'Hôm nay' : `${escapeHtml(t.weekday)}, ${t.date}`} lúc <strong>${t.time}</strong> · ${escapeHtml(last.adminName)}</span></div>`
    : `<div class="cd-last is-none"><small>Gọi gần nhất</small><b>Chưa gọi lần nào</b></div>`;
  const number = c.phone
    ? `<div class="cd-num"><span class="cd-num-ico">${icon('phone')}</span><span class="cd-num-tx"><small>Số điện thoại</small><b>${escapeHtml(formatPhoneDisplay(c.phone))}</b></span></div>`
    : `<div class="cd-num is-off"><span class="cd-num-ico">${icon('phone')}</span><span class="cd-num-tx"><small>Số điện thoại</small><b>Chưa có số</b></span></div>`;
  const btn = dialPhone
    ? `<a class="cd-callbtn" href="tel:${escapeHtml(dialPhone)}" data-call-customer="${c.id}">${icon('phone')}<span>Gọi ngay</span></a>`
    : `<span class="cd-callbtn is-off">${icon('phone')}<span>Gọi ngay</span></span>`;
  return `${number}${lastHtml}${btn}`;
}

function callEntryHtml(call, myId) {
  const t = describeCallTime(call.createdAt);
  const mine = call.adminId === myId;
  return `<li class="cd-call${mine ? ' is-mine' : ''}">
    <div class="cd-when"><span class="cd-rel">${escapeHtml(t.rel)}</span><b class="cd-time">${t.time}</b><span class="cd-date"><em>${escapeHtml(t.weekday)}</em> ${t.date}</span></div>
    <span class="cd-node" aria-hidden="true"></span>
    <div class="cd-who">
      <span class="cd-av" style="background:${colorFor(call.adminId)}">${escapeHtml(initials(call.adminName))}</span>
      <b><span class="cd-nm">${escapeHtml(call.adminName)}</span>${mine ? '<em class="cd-me">Bạn</em>' : ''}</b>
    </div>
  </li>`;
}

/** Danh sách cuộc gọi (đã lọc "Của tôi" nếu chọn) kèm nút "Xem thêm". */
function callListHtml(calls, myId, { showAll = false, mineOnly = false } = {}) {
  const list = mineOnly ? calls.filter((x) => x.adminId === myId) : calls;
  if (!list.length) {
    return `<div class="cd-empty">${icon('phone')}<b>Chưa có cuộc gọi nào</b><span>Bấm “Gọi ngay” để bắt đầu — mỗi lần gọi được ghi lại tại đây kèm ngày giờ.</span></div>`;
  }
  const shown = showAll ? list : list.slice(0, CALL_PREVIEW);
  return `<ol class="cd-calls">${shown.map((x) => callEntryHtml(x, myId)).join('')}</ol>
    ${list.length > shown.length ? `<button type="button" class="cd-more" data-calls-more>Xem thêm ${list.length - shown.length} cuộc gọi cũ hơn ${icon('chevronDown', 'icon-sm')}</button>` : ''}`;
}

function callCardHtml(calls, { isSuper, myId }) {
  const callers = new Set(calls.map((x) => x.adminId)).size;
  const sub = isSuper ? (calls.length ? `${callers} người gọi` : 'Mọi người gọi') : 'Của riêng bạn';
  return `<h3 class="cd-h"><span>Lịch sử cuộc gọi</span><em>${calls.length}</em><small>${sub}</small>
      ${isSuper && calls.length ? `<span class="cd-seg" role="group" aria-label="Lọc cuộc gọi"><button type="button" class="on" data-calls-filter="all">Tất cả</button><button type="button" data-calls-filter="mine">Của tôi</button></span>` : ''}
    </h3>
    <div id="cd-call-list">${callListHtml(calls, myId)}</div>`;
}

/** Thẻ hợp đồng gọn trong chi tiết khách hàng: vạch màu theo tình trạng, mã + nhãn tình trạng, gốc/lãi bên phải; bấm vào mở chi tiết hợp đồng. */
function contractCardHtml(ct) {
  const info = S.contractAttentionInfo(ct);
  let tone = 'ok', statusHtml;
  if (info.level === 'qua_han') { tone = 'bad'; statusHtml = statusBadge({ badge: 'badge-red', label: `Quá hạn ${info.days} ngày` }); }
  else if (info.level === 'gan_den_han' && info.days <= S.NEAR_DUE_DAYS) { tone = 'warn'; statusHtml = statusBadge({ badge: 'badge-yellow', label: `Gần đến hạn ${info.days} ngày` }); }
  else if (info.level === 'gan_den_han') statusHtml = `<span class="text-sm text-muted">Gần đến hạn ${info.days} ngày</span>`;
  else statusHtml = statusBadge(S.CONTRACT_STATUS_MAP[S.effectiveContractStatus(ct)]);
  return `<div class="cd-ct is-${tone}" role="button" tabindex="0" data-view-contract="${ct.id}" data-customer-id="${ct.customerId}">
    <div class="cd-ct-main"><b>Hợp đồng ${escapeHtml(ct.code)}</b><div>${statusHtml}</div>${installmentHintHtml(ct)}</div>
    <div class="cd-ct-amt"><span>Gốc</span><b>${formatVND(ct.balance)}</b><em>Lãi ${formatVND(S.accruedInterest(ct))}</em></div>
    <span class="cd-ct-go">${icon('chevronRight', 'icon-sm')}</span>
  </div>`;
}


export function openCustomerDetail(customerId, { readOnly = false, context = 'customer' } = {}) {
  const c = S.getCustomer(customerId);
  S.logAdminAction('view-customer', { customerId });
  // Hợp đồng đã tất toán (dư nợ = 0) KHÔNG đưa vào danh sách hiển thị nữa.
  const contracts = S.listContractsByCustomer(customerId).filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan');
  const session = S.getSession();
  const canManageZalo = S.canManageZaloOA(session.id);
  const inZaloList = S.isZaloCustomer(customerId);
  const myId = session.id;
  const isSuper = S.isSuperAdmin(myId);
  const calls = S.listCallsByCustomer(customerId);
  const dialPhone = String(c.phone || '').replace(/[^\d+]/g, '');
  const logged = S.hasCustomerLoggedIn(c), pushOn = S.hasPushEnabled(c.id);
  const hasActions = !readOnly || canManageZalo;
  const addressText = c.address || [c.xom, c.thon, c.tinh].filter(Boolean).join(', ');

  const chip = (on, text, extra = '') => `<span class="cd-chip ${on ? 'on' : 'off'}" ${extra}><i></i>${text}</span>`;
  const close = openModal({
    title: '',
    sheetClass: 'customer-detail-sheet cd-sheet',
    bodyHtml: `
      <header class="cd-hero">
        <button type="button" class="cd-close" data-cd-close aria-label="Đóng">${icon('x')}</button>
        <div class="cd-id">
          <span class="cd-avatar" style="background:${colorFor(c.id)}">${initials(c.name)}</span>
          <div class="cd-id-tx"><span class="cd-eyebrow">Hồ sơ khách hàng</span><h2 class="cd-name">${escapeHtml(c.name)}</h2><p class="cd-sub">CCCD ${escapeHtml(c.cccd)}</p>${addressText ? `<p class="cd-addr">${icon('mapPin', 'icon-sm')}<span>${escapeHtml(addressText)}</span></p>` : ''}</div>
        </div>
        <div class="cd-chips">
          ${chip(logged, logged ? 'Đã đăng nhập' : 'Chưa đăng nhập')}
          ${chip(pushOn, pushOn ? 'Đã bật thông báo' : 'Chưa bật thông báo')}
          ${canManageZalo ? chip(inZaloList, inZaloList ? 'Đã thêm OA' : 'Chưa thêm OA', 'id="cd-oa-chip"') : ''}
        </div>
      </header>
      <div class="cd-callbar" id="cd-callbar">${callBarHtml(calls, dialPhone, c)}</div>
      <div class="cd-cols">
        <div class="cd-col-main">
          <section class="cd-card" id="cd-calls-card">${callCardHtml(calls, { isSuper, myId })}</section>
        </div>
        <aside class="cd-col-side">
          <section class="cd-card cd-contracts-card">
            <h3 class="cd-h"><span>Hợp đồng</span><em>${contracts.length}</em></h3>
            <div id="contract-list" class="cd-contracts">${contracts.map((ct) => contractCardHtml(ct)).join('') || '<p class="cd-empty-note">Chưa có hợp đồng — nhập từ Excel để thêm.</p>'}</div>
          </section>
          ${hasActions ? `<section class="cd-card cd-actions">
            <h3 class="cd-h"><span>Thao tác</span></h3>
            <div class="cd-btns">
              ${!readOnly ? `<button class="btn btn-outline btn-sm" id="btn-reset-pw">${icon('key', 'icon-sm')} Cấp lại mật khẩu</button>` : ''}
              ${!readOnly && context === 'use' && logged ? `<button class="btn btn-outline btn-sm" id="btn-force-logout">${icon('logout', 'icon-sm')} Đăng xuất</button>` : ''}
              ${!readOnly ? `<button class="btn btn-outline btn-sm" id="btn-send-noti">${icon('bell', 'icon-sm')} Gửi thông báo</button>` : ''}
              ${!readOnly && context === 'customer' ? `<button class="btn btn-outline btn-sm" id="btn-edit-cust">${icon('edit', 'icon-sm')} Sửa</button>` : ''}
              ${canManageZalo ? `<span id="oa-action-btn-wrap" style="display:contents">${zaloActionButtonHtml(inZaloList)}</span>` : ''}
              ${!readOnly && context === 'use' ? `<button class="btn btn-danger-outline btn-sm" id="btn-del-cust">${icon('trash', 'icon-sm')} Xóa Use</button>` : ''}
            </div>
          </section>` : ''}
        </aside>
      </div>
    `,
    onMount(sheet, closeFn) {
      sheet.querySelector('[data-cd-close]').addEventListener('click', closeFn);
      // Bấm Gọi (thanh Gọi hoặc số điện thoại ở mục Thông tin): ghi lại cuộc gọi rồi vẽ lại lịch sử + thanh Gọi ngay; vẫn mở ứng dụng gọi điện như thường.
      let callsAll = false, callsMine = false;
      const redrawCalls = () => {
        const list = S.listCallsByCustomer(customerId);
        const listEl = sheet.querySelector('#cd-call-list');
        if (listEl) listEl.innerHTML = callListHtml(list, myId, { showAll: callsAll, mineOnly: callsMine });
        const countEl = sheet.querySelector('#cd-calls-card .cd-h em');
        if (countEl) countEl.textContent = String(list.length);
        const bar = sheet.querySelector('#cd-callbar');
        if (bar) bar.innerHTML = callBarHtml(list, dialPhone, c);
      };
      S.loadCallsForCustomer(customerId).then((ok) => { if (ok && sheet.isConnected) redrawCalls(); }); // lịch sử đầy đủ từ máy chủ (hiện ngay những gì đang có trước)
      sheet.addEventListener('click', (e) => {
        const callLink = e.target.closest('[data-call-customer]');
        if (callLink) { S.logCall(customerId, c.phone); redrawCalls(); return; }
        const more = e.target.closest('[data-calls-more]');
        if (more) { callsAll = true; redrawCalls(); return; }
        const filterBtn = e.target.closest('[data-calls-filter]');
        if (filterBtn) {
          callsMine = filterBtn.dataset.callsFilter === 'mine'; callsAll = false;
          sheet.querySelectorAll('[data-calls-filter]').forEach((b) => b.classList.toggle('on', b === filterBtn));
          redrawCalls();
        }
      });
      // Mở chi tiết hợp đồng CHỒNG lên trên (không đóng màn khách hàng này
      // trước) — đóng chi tiết hợp đồng lại là quay ngay về đúng màn khách
      // hàng đang xem, không phải mở lại từ danh sách ngoài cùng.
      sheet.querySelectorAll('[data-view-contract]').forEach((btn) => {
        btn.addEventListener('click', () => { openContractView(customerId, S.getContract(btn.dataset.viewContract), { readOnly }); });
      });
      // Thêm/bỏ OA KHÔNG phụ thuộc readOnly — nhân viên chỉ xem nhưng có
      // riêng quyền canManageZaloOA vẫn thêm/bỏ được nhanh ngay từ đây (xem
      // khai báo canManageZalo/inZaloList ở đầu hàm), dù không sửa được các
      // thứ khác của khách hàng. Các nút còn lại (đổi mật khẩu/thông báo/
      // sửa/xóa Use) vẫn giữ nguyên chặn readOnly như cũ.
      //
      // Cập nhật TẠI CHỖ (chỉ 2 mẩu DOM nhỏ: dòng trạng thái + nút) sau khi
      // thêm/bỏ OA thành công — KHÔNG đóng rồi mở lại cả modal như trước
      // (closeFn(); openCustomerDetail(...)) vì cách đó tạo cảm giác "chớp
      // khung như tải lại" và chậm hơn hẳn (dựng lại toàn bộ modal + toàn bộ
      // danh sách hợp đồng bên dưới trong khi chẳng có gì trong đó đổi cả).
      function updateZaloUi(newInZaloList) {
        const oaChip = sheet.querySelector('#cd-oa-chip');
        if (oaChip) { oaChip.classList.toggle('on', newInZaloList); oaChip.classList.toggle('off', !newInZaloList); oaChip.innerHTML = `<i></i>${newInZaloList ? 'Đã thêm OA' : 'Chưa thêm OA'}`; }
        const btnWrap = sheet.querySelector('#oa-action-btn-wrap');
        if (btnWrap) { btnWrap.innerHTML = zaloActionButtonHtml(newInZaloList); bindZaloButtons(); }
      }
      function bindZaloButtons() {
        const addZaloBtn = sheet.querySelector('#btn-add-zalo-cust');
        if (addZaloBtn) addZaloBtn.addEventListener('click', async () => {
          addZaloBtn.disabled = true;
          try { await S.addZaloCustomer(customerId); toast('Đã thêm vào danh sách OA', 'success'); updateZaloUi(true); }
          catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); addZaloBtn.disabled = false; }
        });
        const removeZaloBtn = sheet.querySelector('#btn-remove-zalo-cust');
        if (removeZaloBtn) removeZaloBtn.addEventListener('click', () => {
          confirmDialog({
            title: 'Bỏ khỏi danh sách OA?',
            message: 'Mọi lựa chọn gửi Zalo tự động (của mọi nhân viên) cho khách này sẽ bị bỏ theo luôn.',
            danger: true, confirmLabel: 'Bỏ khỏi OA',
            onConfirm: async () => {
              try { await S.removeZaloCustomer(customerId); toast('Đã bỏ khỏi danh sách OA', 'success'); updateZaloUi(false); }
              catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
            },
          });
        });
      }
      bindZaloButtons();
      if (readOnly) return;
      sheet.querySelector('#btn-reset-pw').addEventListener('click', () => {
        openResetPasswordModal({
          title: 'Cấp lại mật khẩu cho khách',
          onConfirm: async (val) => {
            const temp = await S.adminResetCustomerPassword(customerId, val);
            showCredential(c, temp);
          },
        });
      });
      const forceLogoutBtn = sheet.querySelector('#btn-force-logout');
      if (forceLogoutBtn) forceLogoutBtn.addEventListener('click', () => {
        confirmDialog({
          title: 'Đăng xuất tài khoản này?',
          message: `"${c.name}" sẽ bị đăng xuất khỏi mọi nơi đang đăng nhập, không cần đổi mật khẩu.`,
          confirmLabel: 'Đăng xuất',
          onConfirm: async () => {
            try { await S.forceLogoutCustomer(customerId); toast('Đã đăng xuất tài khoản này', 'success'); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
      sheet.querySelector('#btn-send-noti').addEventListener('click', () => openSendNotificationModal(c));
      const editBtn = sheet.querySelector('#btn-edit-cust');
      if (editBtn) editBtn.addEventListener('click', () => { closeFn(); openCustomerForm(c); });
      // Chỉ context 'use' (Quản lý User) mới có nút xóa — gỡ tài khoản đăng
      // nhập thôi, KHÔNG đụng hồ sơ/hợp đồng. Đã bỏ hẳn "Xóa khách hàng và
      // toàn bộ hợp đồng liên quan" ở context 'customer' — vô lý, khách hàng
      // & hợp đồng đến từ file Excel, không nên xóa tay từ đây.
      const delBtn = sheet.querySelector('#btn-del-cust');
      if (delBtn) delBtn.addEventListener('click', () => {
        confirmDialog({
          title: 'Xóa Use?', message: `Gỡ tài khoản đăng nhập của "${c.name}"? Hồ sơ và hợp đồng vẫn được giữ nguyên bên Khách hàng & Hợp đồng — có thể "Tạo User" lại bất cứ lúc nào.`,
          confirmLabel: 'Xóa Use', danger: true,
          onConfirm: async () => {
            try { await S.deactivateCustomerAccount(customerId); closeFn(); toast('Đã xóa Use (hồ sơ/hợp đồng vẫn còn)', 'success'); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    },
  });
}

/**
 * Cột phải "Gốc / Lãi" — dùng cho hàng khách hàng chỉ có 1 hợp đồng lẫn từng
 * dòng hợp đồng gọn. "Gốc" ở đây là DƯ NỢ HIỆN TẠI (số còn phải trả), không
 * phải số tiền vay ban đầu — số tiền vay ban đầu chỉ hiện trong màn chi tiết
 * hợp đồng (mục "Số tiền vay ban đầu").
 */
function contractLedgerRow(ct, canManageZalo) {
  const info = S.contractAttentionInfo(ct);
  const interest = S.accruedInterest(ct);
  const interestDays = S.interestDaysAccrued(ct);
  const status = info.level === 'qua_han'
    ? statusBadge({ badge: 'badge-red', label: `Quá hạn ${info.days} ngày` })
    : info.level === 'gan_den_han'
      ? statusBadge({ badge: 'badge-yellow', label: `Gần đến hạn ${info.days} ngày` })
      : statusBadge({ badge: 'badge-green', label: 'Trong hạn' });
  const oa = canManageZalo ? manualOaState(ct) : null;
  const oaReason = oa && (!oa.inZaloList ? 'Khách chưa có trong Danh sách OA' : oa.cooldownDaysLeft > 0 ? `Còn ${oa.cooldownDaysLeft} ngày nữa mới gửi lại được` : manualOaSending.has(ct.id) ? 'Đang gửi OA' : 'Gửi OA cho hợp đồng này');
  return `
    <div class="customer-ledger-contract ${info.level === 'qua_han' ? 'is-overdue' : info.level === 'gan_den_han' ? 'is-near' : ''}">
      <button type="button" class="customer-ledger-contract-main" data-view-contract="${ct.id}" data-customer-id="${ct.customerId}" aria-label="Xem hợp đồng ${escapeHtml(ct.code)}">
        <div class="customer-ledger-code"><span class="customer-ledger-code-line"><span>HĐTD ${escapeHtml(ct.code)}</span>${status}</span>${installmentHintHtml(ct)}</div>
        <span class="customer-ledger-disbursed">${formatDate(ct.disbursedDate)}</span>
        <span class="customer-ledger-due">${formatDate(ct.dueDate)}</span>
        <span class="customer-ledger-balance">${formatVND(ct.balance)}</span>
        <span class="customer-ledger-paid">${formatDate(ct.interestPaidUntil || ct.disbursedDate)}</span>
        <span class="customer-ledger-days"><strong>${interestDays}</strong> ngày</span>
        <span class="customer-ledger-interest">${formatVND(interest)}</span>
      </button>
      ${oa ? `<button type="button" class="btn btn-outline btn-sm customer-ledger-oa" data-send-oa="${ct.id}" title="${escapeHtml(oaReason)}" aria-label="Gửi OA cho hợp đồng ${escapeHtml(ct.code)}" ${!oa.inZaloList || oa.cooldownDaysLeft > 0 || manualOaSending.has(ct.id) ? 'disabled' : ''}>${icon('send', 'icon-sm')}<span>Gửi OA</span></button>` : ''}
    </div>`;
}

function contractAmountsHtml(ct) {
  const interest = S.accruedInterest(ct);
  return `
    <div class="row-end">
      <div class="amount">Gốc: ${formatVND(ct.balance)}</div>
      <div class="amount-sub" style="color:var(--warning)">Lãi: ${formatVND(interest)}</div>
    </div>`;
}

/**
 * Soạn sẵn tin nhắn SMS cho khách hàng — mở app nhắn tin sẵn có trên điện
 * thoại quản trị viên, không cần dịch vụ SMS ngoài. DÙNG CHUNG ĐÚNG 1 NỘI
 * DUNG với thông báo App (org.pushTemplates, tự chuyển đúng mẫu Báo
 * lãi/Gần đến hạn/Đã trễ hạn theo S.contractStatusInfo() — xem
 * buildContractNotificationPreset() ở trên) — đổi mẫu trong "Cài đặt" thì
 * SMS cũng tự đổi theo, không cần sửa gì riêng ở đây. CHỈ khác 2 điểm:
 *   1. Không in đậm (boldDigits chỉ có ý nghĩa trên thông báo đẩy — ký tự
 *      Unicode "Mathematical Bold" không phải chữ số thường, SMS/điện thoại
 *      cũ không hiểu, dễ vỡ chữ/tốn thêm tin nhắn).
 *   2. Bỏ dấu tiếng Việt CẢ CHUỖI (title + body, stripDiacriticsKeepCase) —
 *      máy điện thoại đời cũ/mạng SMS truyền thống không hiển thị đúng được
 *      tiếng Việt có dấu (dễ vỡ chữ, mất chữ, tốn nhiều tin nhắn hơn do phải
 *      mã hoá UCS-2).
 */
function buildSmsLink(customer, contract) {
  const { accrued, info, org, tpl, dueDate } = contractNotificationContext(contract);
  const tokens = {
    Ten_KH: customer ? customer.name : '',
    Ma_HD: contract.code,
    So_tien_goc: formatVND(info.dueAmount),
    So_tien_lai: formatVND(accrued),
    So_du: formatVND(contract.balance),
    Ngay_dao_han: formatDate(dueDate),
    Ten_quy: org.shortName,
  };
  const title = S.renderNotificationTemplate(tpl.title, tokens);
  const body = S.renderNotificationTemplate(pickNotificationBodyTemplate(tpl, info), tokens);
  const msg = stripDiacriticsKeepCase(`${title} ${body}`);
  return `sms:${customer.phone.replace(/\s/g, '')}?body=${encodeURIComponent(msg)}`;
}

/**
 * Dòng chú thích dưới nút "Gửi tin Zalo OA ngay" — tách riêng thành hàm để
 * gọi lại được ngay sau khi gửi THÀNH CÔNG (xem onMount trong
 * openContractView), khỏi phải đóng/mở lại popup mới thấy nút tự chìm
 * xuống + đúng ngày/số ngày chờ mới.
 */
function zaloHintHtml(inZaloList, zaloCooldownDaysLeft, lastZaloSend) {
  if (!inZaloList) {
    return `<div class="field-hint text-danger">${icon('alert', 'icon-sm')} Khách chưa có trong Danh sách OA — vào chi tiết khách hàng (nút "Thêm vào OA") để thêm trước khi gửi được.</div>`;
  }
  if (!lastZaloSend) return '';
  // Nói rõ lần gần nhất là gửi tự động hay gửi tay (lấy từ nhật ký gửi: triggeredBy = 'auto' | 'manual'; lượt vừa bấm gửi trong phiên này là gửi tay).
  const how = lastZaloSend.triggeredBy === 'auto' ? 'tự động' : 'bằng tay';
  const lastText = `Đã gửi Zalo ${how} gần nhất ngày <strong>${formatDate(lastZaloSend.sentAt)}</strong>`;
  if (zaloCooldownDaysLeft > 0) {
    return `<div class="field-hint text-danger">${icon('alert', 'icon-sm')} ${lastText} — còn <strong style="white-space:nowrap">${zaloCooldownDaysLeft} ngày</strong> nữa mới gửi lại được (giới hạn 5 ngày/lần).</div>`;
  }
  return `<div class="field-hint">${lastText}.</div>`;
}

function zaloAutoStatusHtml(status) {
  if (status === null) return '<div class="field-hint">Đang kiểm tra trạng thái gửi tự động...</div>';
  if (status === undefined) return '<div class="field-hint">Chưa kiểm tra được trạng thái gửi tự động.</div>';
  const interval = [1, 2, 3, 4].includes(status.intervalMonths) ? status.intervalMonths : 1;
  return status.enabled
    ? `<div class="field-hint customer-contract-oa-auto-added">Đã thêm vào gửi tự động ${interval === 1 ? 'hàng tháng' : `${interval} tháng`}</div>`
    : '<div class="field-hint">Muốn gửi tự động hàng tháng thì vào mục Quản lý OA.</div>';
}

function manualOaState(contract) {
  const inZaloList = S.isZaloCustomer(contract.customerId);
  const lastServerSend = S.lastSuccessfulZaloSend(contract.id);
  const recentSentAt = manualOaSentAt.get(contract.id);
  const lastZaloSend = recentSentAt && (!lastServerSend || new Date(recentSentAt) > new Date(lastServerSend.sentAt))
    ? { sentAt: recentSentAt, triggeredBy: 'manual' } : lastServerSend;
  const daysSince = lastZaloSend ? daysBetween(new Date(lastZaloSend.sentAt), new Date()) : null;
  return { inZaloList, lastZaloSend, cooldownDaysLeft: daysSince === null ? 0 : Math.max(0, 5 - daysSince) };
}

async function sendManualOa(contractId, button, onSuccess) {
  if (manualOaSending.has(contractId)) return;
  const originalLabel = button.innerHTML;
  const compact = button.classList.contains('customer-ledger-oa');
  manualOaSending.add(contractId);
  button.disabled = true;
  button.innerHTML = compact ? 'Đang gửi' : `${icon('refresh', 'icon-sm')} Đang gửi...`;
  try {
    const res = await S.sendZaloManual(contractId);
    toast(res.ok ? 'Đã gửi tin Zalo OA cho khách' : (res.reason || 'Gửi thất bại — xem chi tiết lỗi trong "Quản lý gửi tin".'), res.ok ? 'success' : 'error', /chưa đăng ký Zalo/.test(res.reason || '') ? 7000 : undefined);
    if (res.ok) {
      const sentAt = new Date().toISOString();
      manualOaSentAt.set(contractId, sentAt);
      button.innerHTML = compact ? 'Đã gửi' : `${icon('check', 'icon-sm')} Đã gửi`;
      button.title = 'Đã gửi OA; chờ 5 ngày trước khi gửi lại';
      onSuccess?.(sentAt);
      window.__qtdRedrawCustomers?.();
      return;
    }
  } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
  finally { manualOaSending.delete(contractId); }
  button.disabled = false;
  button.innerHTML = originalLabel;
}

/**
 * Số tiền luôn nằm gọn trên MỘT dòng: chữ to sẵn theo giao diện, nếu số tiền dài (VD hàng chục tỷ) vượt chỗ chứa thì thu nhỏ dần cho vừa
 * — không bao giờ tụt xuống dòng dưới hay tràn ra ngoài khung. Gọi lại mỗi khi số đổi hoặc khung đổi kích thước.
 */
function fitOneLine(el, minPx = 9) {
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize) || 16;
  while (el.scrollWidth > el.clientWidth + 0.5 && size > minPx) { size -= 0.5; el.style.fontSize = `${size}px`; }
}

/** Máy không cho sao chép tự động thì hiện khung chữ đã chọn sẵn để người dùng tự chạm giữ → Sao chép. */
function openCopyFallback(text) {
  openModal({
    title: 'Sao chép thông tin khoản vay',
    bodyHtml: `<p class="text-sm text-muted mb-8">Máy chưa cho sao chép tự động. Chạm giữ vào khung bên dưới, chọn "Chọn tất cả" rồi "Sao chép".</p><textarea id="loan-copy-ta" readonly rows="14" style="width:100%;border:1px solid var(--border-strong);border-radius:8px;padding:10px;font:13px/1.5 inherit">${escapeHtml(text)}</textarea>`,
    onMount(sheet) { const ta = sheet.querySelector('#loan-copy-ta'); if (ta) { ta.focus(); ta.select(); } },
  });
}

/** Dòng "Cách tính lãi": số dư × số ngày × lãi suất ÷ 365 = tiền lãi — dùng cả lúc mở popup lẫn lúc sửa ngày/số ngày. */
function contractFormulaHtml(contract, days, accrued) {
  return `${formatVND(contract.balance)} × ${days} ngày × ${contract.interestRate}%<br class="cf-br"> ÷ 365 ngày = <strong>${formatVND(accrued)}</strong>`;
}

/**
 * Xem chi tiết hợp đồng — hiển thị đầy đủ giống hệt trang khách hàng thấy khi
 * họ bấm vào. Dữ liệu lấy từ Excel, quản trị viên KHÔNG chỉnh sửa trực tiếp
 * tại đây (không có ô nhập/nút "Sửa") — muốn cập nhật thì nhập lại file Excel
 * mới nhất, hệ thống tự khớp đúng hợp đồng theo Số HĐTD.
 */
export function openContractView(customerId, contract, { readOnly = false } = {}) {
  const customer = S.getCustomer(customerId);
  S.logAdminAction('view-contract', { contractId: contract.id });
  // Trạng thái + dòng cảnh báo xét CẢ ngày đáo hạn hợp đồng gốc LẪN "Kỳ tới"
  // của phân kỳ trả nợ (nếu có) — xem S.contractStatusInfo(). Hợp đồng
  // không có phân kỳ thì kết quả y hệt như trước giờ.
  const info = S.contractStatusInfo(contract);
  const interestPaidUntil = contract.interestPaidUntil || contract.disbursedDate;
  const interestDays = S.interestDaysAccrued(contract);
  let accrued = S.accruedInterest(contract); // đổi được khi quản trị sửa "Tính đến ngày"/"Số ngày lãi" (chỉ để xem, không lưu)
  const collateralName = contract.hasCollateral ? COLLATERAL_NAMES[contract.collateralType] : null;
  const canPay = S.effectiveContractStatus(contract) !== 'da_tat_toan';
  const session = S.getSession();
  const canManageZalo = S.canManageZaloOA(session.id);
  // Gửi tay Zalo: BẮT BUỘC khách đã có trong Tầng 1 "Danh sách OA", và cách
  // lần gửi thành công gần nhất phải >= 5 ngày — server luôn là nơi quyết
  // định thật sự (chặn cả 2 điều kiện này), ở đây chỉ tính trước để BÁO
  // TRƯỚC cho admin biết lý do trước khi bấm, đỡ bấm xong mới biết bị chặn.
  const { inZaloList, lastZaloSend, cooldownDaysLeft: zaloCooldownDaysLeft } = manualOaState(contract);

  // Mã QR VietQR cho quản trị viên/nhân viên — 2 ô Gốc/Lãi riêng, cộng lại ra
  // số tiền trên QR. Mặc định chỉ có sẵn Lãi (= "Lãi đến nay"), ô Gốc để
  // trống, cần thì tự gõ vào (VD: khách trả gộp cả gốc lẫn lãi, hoặc trả 1
  // phần gốc).
  const org = S.getOrg();
  const hasBank = canPay && org.bankBin && org.bankAccountNo;
  // Nội dung chuyển khoản: `text` KHÔNG DẤU nằm trong mã QR (đúng yêu cầu ngân hàng), `shown` có dấu để người xem đọc cho dễ
  // — xem transferContent(). Dấu "/" trong số hợp đồng ở bản không dấu tự thành dấu cách.
  function qrContent(goc, lai, settle = false) {
    const kind = settle ? 'tat_toan' : goc > 0 && lai > 0 ? 'goc_lai' : goc > 0 ? 'goc' : 'lai';
    return transferContent(kind, contract, customer);
  }
  const qrParamsFor = (amount, goc, lai, settle = false) => {
    const qc = qrContent(goc, lai, settle);
    return { bin: org.bankBin, accountNo: org.bankAccountNo, amount, content: qc.text, accountName: org.bankAccountName, displayContent: qc.shown, displayAccountName: org.bankAccountDisplayName };
  };
  const qrUrl = hasBank ? buildVietQrUrl(qrParamsFor(accrued, 0, accrued)) : '';

  // Người thừa kế/đồng vay (cột D file số 1): có thì nối thêm " và <tên>" vào tiêu đề, không có (hoặc trùng tên khách) thì để nguyên như cũ.
  const heirName = String(contract.heirName || '').trim();
  const heirTitle = heirName && customer && heirName.toLowerCase() !== String(customer.name || '').trim().toLowerCase() ? ` và ${escapeHtml(heirName)}` : '';
  // Số tiền đã trả = số tiền vay ban đầu trừ dư nợ hiện tại (gốc đã trả); hợp đồng không có số tiền vay thì hiện "—".
  const principalNum = Number(contract.principal) || 0;
  const paidText = principalNum > 0 ? formatVND(Math.max(0, principalNum - (Number(contract.balance) || 0))) : '—';

  const close = openModal({
    // Kèm thêm tên khách hàng vào tiêu đề để đỡ nhầm giữa nhiều hợp đồng đang
    // mở/xem liên tiếp (VD: khách có nhiều hợp đồng, hoặc mở hợp đồng từ danh
    // sách quá hạn/gần đến hạn ở Tổng quan) — trước đây chỉ có mã hợp đồng.
    title: `Hợp đồng ${escapeHtml(contract.code)}${customer ? ` - ${escapeHtml(customer.name)}${heirTitle}` : ''}<button type="button" class="copy-info-btn" id="btn-copy-loan" title="Sao chép thông tin khoản vay để gửi khách" aria-label="Sao chép thông tin khoản vay để gửi khách">${icon('copy')}</button>`,
    sheetClass: 'customer-contract-sheet',
    bodyHtml: `
      <div class="customer-contract-view">
        <div class="customer-contract-metrics">
          <div class="customer-contract-metric is-primary ct-balance">
            <div class="ct-bal-main">
              <div class="ct-row"><span>DƯ NỢ HIỆN TẠI</span><strong>${formatVND(contract.balance)}</strong></div>
              <small>Số gốc còn phải trả</small>
            </div>
            <div class="ct-paid" title="Gốc đã trả = số tiền vay ban đầu trừ dư nợ hiện tại"><span>GỐC ĐÃ TRẢ</span><strong>${paidText}</strong></div>
          </div>
          <div class="customer-contract-metric ct-calc">
            <div class="ct-row"><span>LÃI CỘNG DỒN</span><strong id="ct-accrued">${formatVND(accrued)}</strong></div>
            <div class="ct-sub">
              <span class="ct-sub-lbl"><i class="d">Tính đến</i><i class="p">Đến</i></span>
              <span class="ct-inp ct-date">
                <input type="text" id="ct-asof" inputmode="numeric" autocomplete="off" maxlength="10" value="${formatDate(new Date())}" aria-label="Tính lãi đến ngày"/>
                <button type="button" class="ct-ico-btn" id="ct-cal" aria-label="Chọn ngày trên lịch">${icon('calendar')}</button>
                <input type="date" class="ct-native" id="ct-asof-native" tabindex="-1" aria-hidden="true"/>
              </span>
            </div>
          </div>
          <div class="customer-contract-metric ct-calc">
            <div class="ct-row"><span>SỐ NGÀY LÃI</span><span class="ct-valgrp"><label class="ct-inp ct-days"><input type="text" id="ct-days" inputmode="numeric" autocomplete="off" maxlength="4" value="${interestDays}" aria-label="Số ngày tính lãi"/>${icon('edit')}</label><span class="ct-unit">ngày</span></span></div>
            <small class="ct-from"><span class="d">Từ kỳ đã trả lãi (${formatDate(interestPaidUntil)})</span><span class="p">Từ ${formatDate(interestPaidUntil)}</span></small>
          </div>
          <div class="ct-resetrow" id="ct-resetrow" hidden>Đang tính lãi đến <b id="ct-resetdate"></b> · <button type="button" class="ct-reset" id="ct-reset2">${icon('undo')} Về hôm nay</button></div>
        </div>
        <div class="customer-contract-info-grid">
          <section class="customer-contract-panel customer-contract-details">
            <h4>Thông tin hợp đồng</h4>
            <div class="oc-line"><span>Số tiền vay ban đầu</span><b>${formatVND(contract.principal)}</b></div>
            <div class="oc-line"><span>Ngày vay</span><b>${formatDate(contract.disbursedDate)}</b></div>
            <div class="oc-line"><span>Ngày đến hạn</span><b>${formatDate(contract.dueDate)}</b></div>
            <div class="oc-line"><span>Đã trả lãi đến ngày</span><b>${formatDate(interestPaidUntil)}</b></div>
            <div class="oc-line"><span>Lãi suất</span><b>${contract.interestRate}%/năm</b></div>
            <div class="oc-line"><span>SĐT</span><b>${customer && customer.phone ? `<a href="tel:${customer.phone.replace(/\s/g, '')}" style="color:var(--color-primary)">${icon('phone', 'icon-sm')} ${escapeHtml(customer.phone)}</a>` : '—'}</b></div>
          </section>
          <div class="customer-contract-side">
            <section class="customer-contract-panel customer-contract-collateral">
              <h4>Tài sản bảo đảm</h4>
              ${collateralName ? `<div class="customer-contract-collateral-value"><span>${collateralName}</span><strong>Giá trị: ${formatVND(Math.max(0, Number(contract.collateralValue) || 0))}</strong></div>` : '<p>Không có tài sản bảo đảm</p>'}
            </section>
            <section class="customer-contract-panel customer-contract-calculation">
              <h4>Cách tính lãi</h4>
              <div class="customer-contract-formula">${contractFormulaHtml(contract, interestDays, accrued)}</div>
              ${canPay && info.source !== 'installment' && info.status !== 'dang_vay' ? `<div class="customer-contract-alert ${info.status === 'qua_han' ? 'is-overdue' : ''}">${info.status === 'qua_han' ? `Đã quá hạn ${info.days} ngày` : `Còn ${info.days} ngày đến hạn thanh toán`}</div>` : ''}
            </section>
          </div>
        </div>
        ${installmentNextBoxHtml(contract, 'installment-next-box-ct')}
        <div class="customer-contract-actions">
          <section class="customer-contract-panel">
            <h4>Liên hệ và gửi thông báo</h4>
            ${customer && customer.phone && canPay ? `<a href="${buildSmsLink(customer, contract)}" class="btn btn-outline btn-sm btn-block mt-8">${icon('message', 'icon-sm')} Nhắn SMS cho khách</a>` : ''}
            ${customer && canPay ? `<button type="button" class="btn btn-outline btn-sm btn-block mt-8" id="btn-noti-app-ct">${icon('bell', 'icon-sm')} Thông báo qua ứng dụng</button>` : ''}
            ${customer && customer.phone && canPay && canManageZalo ? `
              <button type="button" class="btn btn-outline btn-sm btn-block mt-8" id="btn-zalo-manual-ct" ${!inZaloList || zaloCooldownDaysLeft > 0 ? 'disabled' : ''}>${icon('message', 'icon-sm')} Gửi tin Zalo OA ngay</button>
              <div id="zalo-hint-wrap-ct">${zaloHintHtml(inZaloList, zaloCooldownDaysLeft, lastZaloSend)}</div>` : ''}
            ${canPay ? `<div id="zalo-auto-status-ct">${zaloAutoStatusHtml(null)}</div>` : ''}
          </section>
          <section class="customer-contract-panel customer-contract-payment">
            <h4>Gửi mã QR để thanh toán</h4>
            ${hasBank ? `
              <label class="customer-contract-settle"><input type="checkbox" id="settle-full-cb-ct"/> Tất toán khoản vay</label>
              <div class="grid-2">
                <div class="field"><label>Gốc</label><input type="text" inputmode="numeric" id="qr-goc-input" placeholder="0"/></div>
                <div class="field"><label>Lãi</label><input type="text" inputmode="numeric" id="qr-lai-input"/></div>
              </div>
              <div class="field-hint mb-8" id="qr-lai-hint" style="display:none">Đã nhập số tiền trả gốc — Lãi tự khóa theo đúng "Lãi đến nay", không sửa tay được. Xóa ô Gốc nếu cần tự chỉnh lại Lãi.</div>
              <div class="customer-contract-qr-layout">
                <div>
                  <span class="text-sm text-muted">Tổng chuyển khoản</span>
                  <strong id="qr-total-ct">${formatVND(accrued)}</strong>
                  <button type="button" class="btn btn-outline btn-sm btn-block mt-8" id="btn-download-qr-ct">${icon('download', 'icon-sm')} Tải ảnh mã QR</button>
                  <button type="button" class="btn btn-outline btn-sm btn-block mt-8" id="btn-share-qr-ct">${icon('wallet', 'icon-sm')} Chia sẻ ảnh QR</button>
                </div>
                <img id="qr-img-ct" src="${qrUrl ? qrImageSrc(qrUrl, { compact: true }) : ''}" alt="Mã QR chuyển khoản"/>
              </div>` : `<p class="text-sm text-muted">${canPay ? 'Chưa cấu hình thông tin nhận thanh toán.' : 'Hợp đồng đã tất toán.'}</p>`}
          </section>
        </div>
      </div>
    `,
    footHtml: readOnly ? '' : `<button class="btn btn-danger-outline btn-block" id="del-contract">${icon('trash', 'icon-sm')} Xóa hợp đồng</button>`,
    onMount(sheet, closeFn) {
      // Máy tính (có chuột): nút "In giấy báo" ở góc phải tiêu đề, cạnh nút đóng — bấm ra 2 loại giấy báo giống menu chuột phải. Điện thoại không hiện.
      const closeBtn = sheet.querySelector('.modal-head [data-close]');
      if (customer && closeBtn && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        closeBtn.insertAdjacentHTML('beforebegin', `<button type="button" class="notice-print-btn" id="btn-print-notice" aria-haspopup="menu" aria-expanded="false" title="In giấy báo">${icon('printer')}<span>In giấy báo</span>${icon('chevronDown')}</button>`);
        const printBtn = sheet.querySelector('#btn-print-notice');
        printBtn.addEventListener('click', () => {
          if (printBtn.classList.contains('is-open')) { closeContractNoticeMenu?.(); return; }
          const r = printBtn.getBoundingClientRect();
          showContractNoticeMenu(contract.id, r.right, r.bottom + 6, { anchor: printBtn });
        });
      }
      const zaloAutoStatus = sheet.querySelector('#zalo-auto-status-ct');
      if (zaloAutoStatus) {
        S.getZaloAutoSendStatus(contract.id)
          .then((status) => { if (zaloAutoStatus.isConnected) zaloAutoStatus.innerHTML = zaloAutoStatusHtml(status); })
          .catch(() => { if (zaloAutoStatus.isConnected) zaloAutoStatus.innerHTML = zaloAutoStatusHtml(undefined); });
      }
      bindInstallmentNextBox(sheet, contract, 'installment-next-box-ct');
      const qrImgEl = sheet.querySelector('#qr-img-ct');
      let gocAmount = 0;
      let laiAmount = accrued;
      let settleFull = false; // Tất toán khoản vay — trả hết gốc (= dư nợ còn lại) + lãi, khóa cả 2 ô
      /** Sửa ô Gốc hoặc Lãi là vẽ lại ảnh QR theo tổng 2 ô cộng lại. */
      function updateQrTotal() {
        const totalEl = sheet.querySelector('#qr-total-ct');
        if (totalEl) totalEl.textContent = formatVND(gocAmount + laiAmount);
      }
      function refreshQr() {
        if (!qrImgEl) return;
        qrImgEl.src = qrImageSrc(buildVietQrUrl(qrParamsFor(gocAmount + laiAmount, gocAmount, laiAmount, settleFull)), { compact: true });
      }
      // Ảnh QR tải từ dịch vụ ngoài — mỗi lần đổi src là 1 request mạng render
      // ảnh mới, gọi thẳng theo từng phím gõ làm popup nặng/giật. Debounce lại,
      // chỉ tải ảnh mới khi ngưng gõ 400ms.
      const refreshQrDebounced = debounce(refreshQr, 400);
      const settleCb = sheet.querySelector('#settle-full-cb-ct');
      const gocInput = sheet.querySelector('#qr-goc-input');
      const laiInput = sheet.querySelector('#qr-lai-input');
      const laiHint = sheet.querySelector('#qr-lai-hint');
      /**
       * Có nhập số tiền trả Gốc (hoặc đang tất toán) thì khóa cứng Lãi = đúng
       * "Lãi đến nay" (không cho tự sửa tay) — chỉ khi Gốc để trống mới được
       * tự chỉnh Lãi.
       */
      function syncLaiLock() {
        if (!laiInput) return;
        const locked = settleFull || gocAmount > 0;
        laiInput.disabled = locked;
        // Đang tất toán thì tự hiểu là khóa cả 2 ô rồi (đã có checkbox riêng
        // giải thích) — chỉ cần hiện dòng chú thích này cho đúng trường hợp
        // "chỉ nhập Gốc" (chưa tất toán) để khỏi lặp ý.
        if (laiHint) laiHint.style.display = (locked && !settleFull) ? 'block' : 'none';
        if (locked) {
          laiAmount = accrued;
          laiInput.value = formatNumber(accrued);
        }
      }
      /** Tích "Tất toán" thì Gốc tự điền = toàn bộ dư nợ còn lại, khóa luôn cả 2 ô; bỏ tích thì Gốc về lại 0, chỉ còn Lãi. */
      function syncSettleFull() {
        if (gocInput) gocInput.disabled = settleFull;
        gocAmount = settleFull ? contract.balance : 0;
        if (gocInput) gocInput.value = settleFull ? formatNumber(contract.balance) : '';
        syncLaiLock();
      }
      if (settleCb) settleCb.addEventListener('change', (e) => { settleFull = e.target.checked; syncSettleFull(); updateQrTotal(); refreshQr(); });
      if (gocInput) bindMoneyInput(gocInput, 0, (v) => { gocAmount = v; syncLaiLock(); updateQrTotal(); refreshQrDebounced(); }, contract.balance);
      if (laiInput) bindMoneyInput(laiInput, accrued, (v) => { laiAmount = v; updateQrTotal(); refreshQrDebounced(); });
      const downloadQrBtn = sheet.querySelector('#btn-download-qr-ct');
      if (downloadQrBtn) downloadQrBtn.addEventListener('click', () => downloadQrImage(qrImgEl.src, `qr-thanh-toan-${contract.code}.png`));
      const shareQrBtn = sheet.querySelector('#btn-share-qr-ct');
      if (shareQrBtn) shareQrBtn.addEventListener('click', () => shareQrImage(qrImgEl.src, qrContent(gocAmount, laiAmount, settleFull).shown));
      // ---- Sửa "Tính đến ngày" / "Số ngày lãi": CHỈ ĐỂ TÍNH XEM (không lưu vào hợp đồng, mở lại là về hôm nay). Sửa ngày -> số ngày tự tính lại và ngược lại; lãi, "Cách tính lãi", ô Lãi và mã QR đổi theo. ----
      const accruedEl = sheet.querySelector('#ct-accrued');
      const asOfInput = sheet.querySelector('#ct-asof');
      const nativeDate = sheet.querySelector('#ct-asof-native');
      const daysInput = sheet.querySelector('#ct-days');
      const calBtn = sheet.querySelector('#ct-cal');
      const formulaEl = sheet.querySelector('.customer-contract-formula');
      const resetRow = sheet.querySelector('#ct-resetrow');
      const resetRowDate = sheet.querySelector('#ct-resetdate');
      if (accruedEl && asOfInput && daysInput) {
        const today = startOfDay(new Date());
        const minAsOf = interestAsOfForDays(contract, 0);
        const maxAsOf = interestAsOfForDays(contract, MAX_INTEREST_DAYS);
        let asOf = today;
        const clamp = (dt) => (dt < minAsOf ? minAsOf : dt > maxAsOf ? maxAsOf : dt);
        const sizeDays = () => { daysInput.style.width = `${Math.max(2, daysInput.value.length) + 0.9}ch`; };
        // Điện thoại (cảm ứng): chạm vào ô ngày là mở lịch chọn luôn, không bật bàn phím. Máy tính: gõ trực tiếp hoặc bấm biểu tượng lịch.
        const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        asOfInput.readOnly = coarse;
        nativeDate.min = toDateInputValue(minAsOf);
        nativeDate.max = toDateInputValue(maxAsOf);
        /** `from`: ô đang được gõ ('date' | 'days') — không ghi đè lại chính ô đó khi vẽ lại. */
        function render(from) {
          const days = S.interestDaysAccrued(contract, asOf);
          accrued = S.accruedInterest(contract, asOf);
          if (from !== 'date') asOfInput.value = formatDate(asOf);
          if (from !== 'days') { daysInput.value = String(days); sizeDays(); }
          accruedEl.textContent = formatVND(accrued);
          fitOneLine(accruedEl);
          if (formulaEl) formulaEl.innerHTML = contractFormulaHtml(contract, days, accrued);
          const edited = daysBetween(today, asOf) !== 0;
          if (resetRow) resetRow.hidden = !edited;
          if (resetRowDate) resetRowDate.textContent = formatDate(asOf);
          // Ô Lãi (và tổng chuyển khoản/mã QR) theo ngày đã chọn
          laiAmount = accrued;
          if (laiInput) laiInput.value = accrued ? formatNumber(accrued) : '';
          updateQrTotal();
          refreshQrDebounced();
        }
        asOfInput.addEventListener('input', () => {
          const masked = maskViDate(asOfInput.value);
          if (masked !== asOfInput.value) asOfInput.value = masked;
          const parsed = parseViDate(masked);
          asOfInput.closest('.ct-inp').classList.toggle('is-invalid', masked.length === 10 && !parsed);
          if (!parsed) return;
          const fixed = clamp(parsed);
          asOf = fixed;
          render(fixed.getTime() === parsed.getTime() ? 'date' : undefined);
        });
        asOfInput.addEventListener('focus', () => { if (!coarse) asOfInput.select(); });
        asOfInput.addEventListener('blur', () => { asOfInput.closest('.ct-inp').classList.remove('is-invalid'); asOfInput.value = formatDate(asOf); });
        daysInput.addEventListener('input', () => {
          const digits = daysInput.value.replace(/\D/g, '').slice(0, 4);
          let n = digits === '' ? null : Math.min(MAX_INTEREST_DAYS, Number(digits));
          daysInput.value = n === null ? '' : String(n);
          sizeDays();
          if (n === null) return;
          asOf = interestAsOfForDays(contract, n);
          render('days');
        });
        daysInput.addEventListener('focus', () => daysInput.select());
        daysInput.addEventListener('blur', () => { daysInput.value = String(S.interestDaysAccrued(contract, asOf)); sizeDays(); });
        [asOfInput, daysInput].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); }));
        function openCalendar() {
          nativeDate.value = toDateInputValue(asOf);
          try { if (nativeDate.showPicker) nativeDate.showPicker(); else { nativeDate.focus(); nativeDate.click(); } }
          catch { nativeDate.focus(); }
        }
        if (calBtn) calBtn.addEventListener('click', openCalendar);
        if (coarse) asOfInput.addEventListener('click', openCalendar);
        nativeDate.addEventListener('change', () => {
          const [y, m, dd] = nativeDate.value.split('-').map(Number);
          if (!y) return;
          asOf = clamp(new Date(y, m - 1, dd));
          render();
        });
        const resetBtn = sheet.querySelector('#ct-reset2');
        if (resetBtn) resetBtn.addEventListener('click', () => { asOf = today; render(); });
        // Nút "Sao chép" ở tiêu đề: tạo tin "Thông tin khoản vay" đúng số liệu đang hiện (kể cả khi đã chỉnh "Tính đến ngày") để dán gửi khách.
        const copyBtn = sheet.querySelector('#btn-copy-loan');
        if (copyBtn) copyBtn.addEventListener('click', async () => {
          const inst = S.nextInstallmentInfo(contract, asOf);
          const text = buildLoanSummaryText({
            orgName: org.name || 'Quỹ Tín Dụng Nhân Dân Bình Nguyên', hotline: org.hotline,
            customerName: customer ? customer.name : '', contract,
            info: S.contractStatusInfo(contract, asOf), asOf, days: S.interestDaysAccrued(contract, asOf), accrued: S.accruedInterest(contract, asOf),
            nextInstallment: inst && inst.next ? { date: inst.next.dueDate, amount: inst.next.dueAmount } : null,
          });
          if (await copyText(text)) {
            toast('Đã sao chép thông tin khoản vay', 'success');
            copyBtn.classList.add('is-done'); copyBtn.innerHTML = icon('check');
            setTimeout(() => { copyBtn.classList.remove('is-done'); copyBtn.innerHTML = icon('copy'); }, 1800);
          } else openCopyFallback(text);
        });
        sizeDays();
      }
      // Số tiền (Dư nợ / Số tiền đã trả / Lãi cộng dồn) luôn gọn trên 1 dòng dù số lớn: thu nhỏ chữ cho vừa, tính lại khi đổi kích thước hoặc font tải xong.
      const moneyEls = [...sheet.querySelectorAll('.customer-contract-metrics strong')];
      const fitMoney = () => moneyEls.forEach((el) => fitOneLine(el));
      fitMoney();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitMoney);
      if (typeof ResizeObserver === 'function') new ResizeObserver(fitMoney).observe(sheet.querySelector('.customer-contract-metrics'));
      const notiBtn = sheet.querySelector('#btn-noti-app-ct');
      if (notiBtn) notiBtn.addEventListener('click', () => {
        if (!customer) return;
        openSendNotificationModal(customer, buildContractNotificationPreset(contract, customer));
      });
      const zaloManualBtn = sheet.querySelector('#btn-zalo-manual-ct');
      const zaloHintWrap = sheet.querySelector('#zalo-hint-wrap-ct');
      if (zaloManualBtn) zaloManualBtn.addEventListener('click', () => sendManualOa(contract.id, zaloManualBtn, (sentAt) => {
        if (zaloHintWrap) zaloHintWrap.innerHTML = zaloHintHtml(true, 5, { sentAt, triggeredBy: 'manual' });
      }));
      const delBtn = sheet.querySelector('#del-contract');
      if (delBtn) delBtn.addEventListener('click', () => {
        confirmDialog({
          title: 'Xóa hợp đồng?', message: `Xóa hợp đồng ${contract.code}? Nếu hợp đồng vẫn còn trong file Excel, lần nhập sau sẽ tạo lại.`,
          confirmLabel: 'Xóa', danger: true,
          onConfirm: async () => {
            try { await S.deleteContract(contract.id); closeFn(); toast('Đã xóa hợp đồng', 'success'); window.__qtdRedrawCustomers?.(); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    },
  });
  return close;
}

const REQUIRED_COLUMNS = 'Số HĐTD, Người nhận nợ, Địa chỉ, Số CMND/CCCD, Số di động, Ngày nhận nợ, Ngày đáo hạn, Thu lãi đến ngày, Số tiền giải ngân, Số dư, Lãi suất';
const REPORT_TEMPLATE_COLUMNS = 'Tên khách hàng, Địa chỉ, Số CMND, Điện thoại, Số HĐ, Ngày vay, Ngày đáo hạn, Lãi suất, Số tiền vay, Số dư, Thu lãi đến ngày';

function openImportModal() {
  const close = openModal({
    title: 'Nhập dữ liệu từ Excel',
    bodyHtml: `
      <button type="button" class="btn btn-outline btn-sm mb-8" id="btn-import-history">${icon('clock', 'icon-sm')} Lịch sử nhập &amp; quay lại bản trước</button>
      <p class="text-sm text-muted mb-8">
        Chọn file Excel sổ theo dõi vay bạn đang dùng (<b>.xls</b> hoặc <b>.xlsx</b>) — hỗ trợ <b>2 loại mẫu</b>, tự nhận diện đúng loại, không cần chọn:<br/>
        <b>1. File số 1 (dữ liệu chính)</b>: lấy đầy đủ thông tin hợp đồng, giá trị TSBĐ ở cột T, loại vay ở W, mục đích vay ở AA và loại TSBĐ ở AB. Nếu chưa có số khế ước thì dùng Số HĐTD. Hỗ trợ cả mẫu sao kê hợp đồng tín dụng có dòng "STT" (các cột: <b>${REPORT_TEMPLATE_COLUMNS}</b>).<br/>
        <b>2. Mẫu phẳng cũ</b> (đúng thứ tự cột, không có dòng "STT"): <b>${REQUIRED_COLUMNS}</b>.
      </p>
      <p class="text-sm text-muted mb-8">Cột nào thiếu dữ liệu ở 1 dòng vẫn nhập được — hệ thống tự tính/tự sinh (mã hợp đồng, ngày đến hạn...). <b class="text-danger">Tải file số 1 = danh sách hợp đồng đầy đủ hiện tại</b>: hợp đồng không còn trong file hoặc có dư nợ bằng 0 sẽ tự động bị xóa để luôn khớp đúng file mới nhất (khách hết hợp đồng và chưa có tài khoản Use sẽ dọn hồ sơ luôn). Khách hàng <b>hoàn toàn mới</b> (CCCD chưa từng có) sẽ được <b>tự động cấp tài khoản Use</b> (mật khẩu tự sinh, hiện ra sau khi nhập). Khách <b>đã có sẵn</b> hồ sơ/tài khoản sẽ được cập nhật tên, số điện thoại và địa chỉ nếu file số 1 có dữ liệu; tài khoản và mật khẩu được giữ nguyên.</p>
      <div class="field">
        <input type="file" id="file-input" accept=".xls,.xlsx"/>
        <div class="field-hint">Chọn file số 1 trước. Đọc trực tiếp trong trình duyệt; hỗ trợ .xls và .xlsx.</div>
      </div>
      <button class="btn btn-primary btn-block mt-8" id="btn-upload-file" disabled>${icon('upload', 'icon-sm')} Tải file số 1</button>
      <div id="import-result"></div>
      <div class="field mt-16">
        <label for="file-input-2" class="fw-700 text-sm">File số 2 — bổ sung số khế ước và phân kỳ trả nợ</label>
        <input type="file" id="file-input-2" accept=".xls,.xlsx"/>
        <div class="field-hint">Có thể tải sau file số 1 hoặc ở tháng sau. Chỉ cập nhật hợp đồng khớp Số HĐTD; không xóa hợp đồng và không thay dữ liệu chính.</div>
      </div>
      <button class="btn btn-outline btn-block mt-8" id="btn-upload-file-2" disabled>${icon('upload', 'icon-sm')} Bổ sung file số 2</button>
      <div id="supplement-result"></div>
      <details class="mt-16">
        <summary class="text-sm fw-700" style="cursor:pointer">Hoặc dán dữ liệu thủ công (copy từ Excel)</summary>
        <div class="field-hint mb-8">Dán tay chỉ thêm/cập nhật — KHÔNG xóa hợp đồng nào khác, khác với tải file.</div>
        <div class="field mt-8"><textarea id="paste-area" rows="6" placeholder="Dán dữ liệu vào đây..." style="width:100%;border:1px solid var(--border-strong);border-radius:8px;padding:10px;font-size:13px;font-family:monospace"></textarea></div>
        <button class="btn btn-outline btn-block" id="do-paste-import">${icon('paperclip', 'icon-sm')} Nhập từ dữ liệu đã dán</button>
      </details>
    `,
    onMount(sheet, closeFn) {
      const resultEl = sheet.querySelector('#import-result');
      const fileInput = sheet.querySelector('#file-input');
      const uploadBtn = sheet.querySelector('#btn-upload-file');
      const supplementInput = sheet.querySelector('#file-input-2');
      const supplementBtn = sheet.querySelector('#btn-upload-file-2');
      const supplementResultEl = sheet.querySelector('#supplement-result');
      sheet.querySelector('#btn-import-history').addEventListener('click', () => openImportHistory({ onChanged: () => window.__qtdRedrawCustomers?.() }));

      // Chỉ lo việc nhập + hiện kết quả + thông báo — KHÔNG đụng vào trạng
      // thái nút bấm (nút "Tải lên" và nút "Nhập từ dữ liệu đã dán" tự quản
      // lý trạng thái bận/xong của riêng mình bên dưới, vì mỗi nút có 1 giai
      // đoạn chờ trước đó khác nhau — trộn chung dễ bị kẹt ở chữ "Đang..." mãi).
      const showImportResult = (res) => {
        resultEl.innerHTML = `
          <div class="card card-pad mt-16" style="background:var(--surface-alt)">
            <div class="text-sm mb-8">✅ Đã nhập xong — ${res.newProfiles} khách hàng mới · ${res.existingCustomers} khách đã có sẵn được cập nhật · ${res.contracts} hợp đồng</div>
            ${res.deletedContracts ? `<div class="text-sm mb-8" style="color:var(--warning)">${icon('alert', 'icon-sm')} Đã xóa ${res.deletedContracts} hợp đồng hết dư nợ hoặc không còn trong file này</div>` : ''}
            ${res.zaloAutoSendMigrated ? `<div class="text-sm mb-8" style="color:var(--success)">${icon('message', 'icon-sm')} Đã tự chuyển ${res.zaloAutoSendMigrated} lựa chọn "Gửi tin tự động" sang hợp đồng mới của cùng khách (khách vẫn còn vay, chỉ đổi số hợp đồng)</div>` : ''}
            ${res.deletedCustomers ? `<div class="text-sm mb-8" style="color:var(--warning)">${icon('alert', 'icon-sm')} Đã dọn ${res.deletedCustomers} hồ sơ không còn hợp đồng nào (chưa có tài khoản Use)</div>` : ''}
            ${res.newAccounts.length ? `
              <div class="fw-700 text-sm mb-6">Tài khoản Use mới tự tạo (gửi cho khách hàng):</div>
              ${res.newAccounts.map((a) => `<div class="oc-line"><span>${a.name} (${a.cccd})</span><b>${a.tempPassword}</b></div>`).join('')}
            ` : ''}
            ${res.errors.length ? `<div class="text-sm text-danger mt-8">${res.errors.slice(0, 5).map(escapeHtml).join('<br/>')}</div>` : ''}
          </div>
        `;
        // Kết quả CỤ THỂ: hợp đồng nào mới/đổi/xóa, của ai (lưu cả vào "Lịch sử nhập" để xem lại hoặc quay lại).
        resultEl.insertAdjacentHTML('beforeend', `<div class="mt-8">${importSummaryHtml(res.summary)}${importDetailsHtml(res.details)}${res.historyId ? '<div class="text-sm text-muted mt-8">Đã lưu vào “Lịch sử nhập” — nhập nhầm thì mở mục đó để quay lại bản trước.</div>' : ''}</div>`);
        bindImportDetails(resultEl);
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        toast('Đã nhập dữ liệu xong', 'success');
        window.__qtdRedrawCustomers?.();
      };
      // Luôn XEM TRƯỚC (máy chủ chỉ so sánh, chưa ghi gì) rồi mới nhập thật khi bấm "Xác nhận nhập".
      const runImport = async (tsvText, fullSync, fileName) => {
        if (!tsvText.trim()) { toast('Không có dữ liệu để nhập', 'error'); return; }
        const prev = await S.previewImportFromPastedTable(tsvText, { fullSync });
        openImportPreview({
          title: fullSync ? 'Xem trước — tải file số 1' : 'Xem trước — dán tay',
          summary: prev.summary, details: prev.details, fullSync,
          notes: [fileName ? `File: ${fileName}` : '', prev.localSkipped ? `${prev.localSkipped} dòng không phải dòng hợp đồng đã bị bỏ qua khi đọc file.` : '', ...(prev.parseErrors || []).slice(0, 3)].filter(Boolean),
          async onConfirm() {
            const res = await S.importFromPastedTable(tsvText, { fullSync, fileName });
            // Lỗi khi VẼ kết quả (nếu có) không được làm cửa sổ xem trước kẹt lại như thể nhập chưa xong — dữ liệu đã nhập rồi.
            try { showImportResult(res); } catch (renderErr) { console.error(renderErr); }
          },
        });
      };

      // Chọn file xong chỉ hiện tên file + bật nút "Tải lên" — bấm nút mới
      // thật sự đọc/xử lý file, tránh xử lý nhầm ngay khi vừa chọn nhầm file.
      fileInput.addEventListener('change', () => {
        uploadBtn.disabled = !fileInput.files[0];
      });
      const uploadBtnIdleHtml = uploadBtn.innerHTML;
      uploadBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        uploadBtn.disabled = true;
        supplementBtn.disabled = true;
        uploadBtn.textContent = 'Đang đọc file...';
        let rows;
        try {
          const rawRows = await readExcelFirstSheet(file);
          if (isSupplementReportRows(rawRows)) {
            throw new Error('Đây là file số 2. Hãy chọn ở mục “Bổ sung file số 2” để không thay thế dữ liệu chính.');
          }
          rows = remapReportTemplateRows(rawRows);
        } catch (err) {
          toast('Không đọc được file: ' + (err.message || ''), 'error');
          uploadBtn.innerHTML = uploadBtnIdleHtml;
          uploadBtn.disabled = !fileInput.files[0];
          supplementBtn.disabled = !supplementInput.files[0];
          return;
        }
        uploadBtn.textContent = 'Đang xử lý...';
        try {
          await runImport(rowsToTsv(rows), true, file.name);
        } catch (err) {
          toast(err.message || 'Có lỗi khi nhập dữ liệu', 'error');
        } finally {
          uploadBtn.innerHTML = uploadBtnIdleHtml;
          uploadBtn.disabled = !fileInput.files[0];
          supplementBtn.disabled = !supplementInput.files[0];
        }
      });

      supplementInput.addEventListener('change', () => {
        supplementBtn.disabled = !supplementInput.files[0];
      });
      const supplementBtnIdleHtml = supplementBtn.innerHTML;
      supplementBtn.addEventListener('click', async () => {
        const file = supplementInput.files[0];
        if (!file) return;
        supplementBtn.disabled = true;
        uploadBtn.disabled = true;
        supplementBtn.textContent = 'Đang đọc file số 2...';
        try {
          const rows = parseSupplementReportRows(await readExcelFirstSheet(file));
          supplementBtn.textContent = 'Đang so sánh...';
          const prev = await S.previewSupplementRows(rows);
          openImportPreview({
            title: 'Xem trước — file số 2', kind: 'supplement', summary: prev.summary, details: prev.details, confirmLabel: 'Xác nhận bổ sung',
            notes: [`File: ${file.name}`],
            async onConfirm() {
              const res = await S.importSupplementRows(rows, { fileName: file.name });
              try {
              supplementResultEl.innerHTML = `<div class="card card-pad mt-16" style="background:var(--surface-alt)">
                <div class="text-sm">✅ Đã bổ sung ${res.updated} hợp đồng.</div>
                ${res.unmatched ? `<div class="text-sm mt-8">${res.unmatched} Số HĐ không khớp hoặc đã tất toán nên không cập nhật.</div>` : ''}
                ${res.emptySchedules ? `<div class="text-sm mt-8" style="color:var(--warning)">${res.emptySchedules} dòng trong file số 2 không có số tiền phân kỳ; lịch cũ của những hợp đồng khớp mã đã được xóa.</div>` : ''}
                ${res.errors.length ? `<div class="text-sm text-danger mt-8">${res.errors.slice(0, 5).map(escapeHtml).join('<br/>')}</div>` : ''}
              </div>`;
              supplementResultEl.insertAdjacentHTML('beforeend', `<div class="mt-8">${importSummaryHtml(res.summary, 'supplement')}${importDetailsHtml(res.details, 'supplement')}</div>`);
              bindImportDetails(supplementResultEl);
              toast('Đã bổ sung file số 2', 'success');
              window.__qtdRedrawCustomers?.();
              } catch (renderErr) { console.error(renderErr); }
            },
          });
        } catch (err) {
          toast(err.message || 'Có lỗi khi bổ sung file số 2', 'error');
        } finally {
          supplementBtn.innerHTML = supplementBtnIdleHtml;
          supplementBtn.disabled = !supplementInput.files[0];
          uploadBtn.disabled = !fileInput.files[0];
        }
      });

      const pasteBtn = sheet.querySelector('#do-paste-import');
      const pasteBtnIdleHtml = pasteBtn.innerHTML;
      pasteBtn.addEventListener('click', async () => {
        pasteBtn.disabled = true;
        pasteBtn.textContent = 'Đang xử lý...';
        try {
          await runImport(sheet.querySelector('#paste-area').value, false);
        } catch (err) {
          toast(err.message || 'Có lỗi khi nhập dữ liệu', 'error');
        } finally {
          pasteBtn.disabled = false;
          pasteBtn.innerHTML = pasteBtnIdleHtml;
        }
      });
    },
  });
}

function esc(s) { return String(s || '').replace(/"/g, '&quot;'); }
