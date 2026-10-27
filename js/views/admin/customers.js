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
import { noteCardShellHtml, mountNoteCard } from './customerNotes.js';
import { interestAsOfForDays, MAX_INTEREST_DAYS } from '../../lib/interestDays.js';
import { describeCallTime, formatPhoneDisplay } from '../../lib/callHistory.js';
import { checkCoPhone, sanitizeCoPhoneInput, normPersonName, shortPersonName, samePhone, heirOfContract, coPhoneOf } from '../../lib/coBorrower.js';
import { parseCoPhoneRows, CO_PHONE_STATUS } from '../../lib/coPhoneFile.js';
import { compareContractsNewestFirst } from '../../lib/contractOrder.js';
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

let query = '';
let filterThon = [];
let filterXom = [];
let urgencyFilter = 'all';
let sortMode = 'default';

let amountRange = { interestMin: null, interestMax: null, principalMin: null, principalMax: null, daysMin: null, daysMax: null };
let filterSheetRefresh = null;
const manualOaSending = new Set();
const manualOaSentAt = new Map();

const URGENCY_FILTER_LABELS = { all: 'Tất cả', qua_han: 'Nợ quá hạn', gan_den_han: 'Gần đến hạn' };

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

function amountRangeDesc() {
  const part = (label, min, max) => (min == null && max == null ? '' : `${label}${min != null ? ` từ ${formatNumber(min)}` : ''}${max != null ? ` đến ${formatNumber(max)}` : ''}`);
  return [part('Lãi', amountRange.interestMin, amountRange.interestMax), part('Gốc', amountRange.principalMin, amountRange.principalMax), part('Ngày lãi', amountRange.daysMin, amountRange.daysMax)].filter(Boolean).join('; ');
}

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
const LEDGER_FIRST_CHUNK = 30;
const LEDGER_NEXT_CHUNK = 30;

export function render(contentEl, filterEl) {
  const admin = currentAdmin();
  const isStaff = admin.role === 'staff';

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
  mountScrollTopButton(filterEl);
  if (!isStaff) {
    filterEl.querySelector('#btn-import').addEventListener('click', openImportModal);
    filterEl.querySelector('#btn-filter-import').addEventListener('click', openImportModal);
  }
  filterEl.querySelectorAll('[data-urgency]').forEach((chip) => {
    chip.addEventListener('click', () => {

      urgencyFilter = chip.dataset.urgency;

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

  let amountTimer = null;
  const runAmountRange = () => { clearTimeout(amountTimer); amountTimer = null; renderFilterPills(); draw(); };
  const applyAmountRange = () => { clearTimeout(amountTimer); amountTimer = setTimeout(runAmountRange, 250); };

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
        e.stopPropagation();
        const id = btn.dataset.pillClear;
        if (id === 'pill-thon') { filterThon = []; filterXom = []; }
        else if (id === 'pill-xom') { filterXom = []; }
        else if (id === 'pill-sort') { sortMode = 'default'; clearAmountRange(); }
        renderFilterPills();
        draw();
      });
    });

    const activeCount = filterActiveCount();
    const badge = filterEl.querySelector('.filter-open-badge');
    if (badge) { badge.hidden = !activeCount; badge.textContent = String(activeCount); }
    const phoneClear = filterEl.querySelector('#btn-filter-clear');
    if (phoneClear) phoneClear.hidden = !activeCount;
    filterSheetRefresh?.();
  }
  function bindPickers() {
    filterEl.querySelector('#pill-thon').addEventListener('click', () => {
      const allowedThon = S.territoryThonList(admin.id);
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

          sheet.querySelectorAll('[data-fkey]').forEach((row) => row.addEventListener('click', () => filterEl.querySelector('#pill-' + row.dataset.fkey).click()));
        };
        filterSheetRefresh = paintSheet;
        paintSheet();
        const syncInputs = bindAmountRange(sheet, closeSheet);
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

      const contractMatchedCustomerIds = new Set(
        S.getState().contracts
          .filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan' && (String(ct.code || '').toLowerCase().includes(q) || String(ct.heirName || '').toLowerCase().includes(q)))
          .map((ct) => ct.customerId)
      );
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.cccd.includes(q) || (c.phone || '').includes(q) || contractMatchedCustomerIds.has(c.id));
    }

    let enriched = list.map((c) => {

      const contracts = S.listContractsByCustomer(c.id).filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan').sort(compareContractsNewestFirst);
      const totalBalance = contracts.reduce((s, ct) => s + (ct.balance || 0), 0);
      const totalInterest = contracts.reduce((s, ct) => s + S.accruedInterest(ct), 0);

      const contractInfos = contracts.map((ct) => ({ ct, info: S.contractAttentionInfo(ct) }));
      const overdueContracts = contractInfos.filter((x) => x.info.level === 'qua_han').map((x) => x.ct);
      const nearDueContracts = contractInfos.filter((x) => x.info.level === 'gan_den_han').map((x) => x.ct);
      const hasOverdue = overdueContracts.length > 0;
      const hasNearDue = !hasOverdue && nearDueContracts.length > 0;

      const mostOverdueDays = hasOverdue ? Math.max(...contractInfos.filter((x) => x.info.level === 'qua_han').map((x) => x.info.days)) : 0;
      const mostNearDueDays = hasNearDue ? Math.min(...contractInfos.filter((x) => x.info.level === 'gan_den_han').map((x) => x.info.days)) : 0;
      return { c, contracts, totalBalance, totalInterest, hasOverdue, hasNearDue, mostOverdueDays, mostNearDueDays };
    });

    enriched = enriched.filter((e) => e.totalBalance > 0);

    if (amountRangeCount()) {
      enriched = enriched.filter((e) => amountInRange(Math.round(e.totalInterest), amountRange.interestMin, amountRange.interestMax)
        && amountInRange(e.totalBalance, amountRange.principalMin, amountRange.principalMax)
        && (!daysRangeOn() || e.contracts.some((ct) => amountInRange(S.interestDaysAccrued(ct), amountRange.daysMin, amountRange.daysMax))));
    }

    const urgencyCounts = { all: enriched.length, qua_han: enriched.filter((e) => e.hasOverdue).length, gan_den_han: enriched.filter((e) => e.hasNearDue).length };
    filterEl.querySelectorAll('[data-urgency]').forEach((btn) => {
      const badge = btn.querySelector('.seg-n');
      if (badge) badge.textContent = urgencyCounts[btn.dataset.urgency] ?? 0;
    });
    if (urgencyFilter === 'qua_han') enriched = enriched.filter((e) => e.hasOverdue);

    else if (urgencyFilter === 'gan_den_han') enriched = enriched.filter((e) => e.hasNearDue);

    if (urgencyFilter === 'qua_han') enriched.sort((a, b) => a.mostOverdueDays - b.mostOverdueDays);
    else if (urgencyFilter === 'gan_den_han') enriched.sort((a, b) => a.mostNearDueDays - b.mostNearDueDays);
    else if (sortMode !== 'default') {
      const [field, dir] = sortMode.split('-');
      const key = field === 'principal' ? 'totalBalance' : 'totalInterest';
      enriched.sort((a, b) => (dir === 'asc' ? a[key] - b[key] : b[key] - a[key]));
    } else {

      enriched.sort((a, b) => compareContractsNewestFirst(a.contracts[0], b.contracts[0]));
    }
    const totalContracts = enriched.reduce((s, e) => s + e.contracts.length, 0);
    const totalAmount = enriched.reduce((s, e) => s + e.totalBalance, 0);

    const groupHtmls = enriched.map((g) => customerLedgerGroupsHtml([g], canManageZalo));
    const sig = `${canManageZalo}|${isStaff}|${totalContracts}|${totalAmount}|${groupHtmls.join('')}`;
    const shownWrap = contentEl.querySelector('.customer-ledger-wrap');
    if (shownWrap && shownWrap.__sig === sig) return;
    const drawToken = ++ledgerDrawToken;
    const progressive = window.scrollY < 40 && enriched.length > LEDGER_FIRST_CHUNK;
    const firstGroups = progressive ? enriched.slice(0, LEDGER_FIRST_CHUNK) : enriched;
    contentEl.innerHTML = `
      <div class="customer-list-summary">${enriched.length} khách hàng · ${totalContracts} hợp đồng · <strong>${formatVND(totalAmount)}</strong></div>
      ${enriched.length ? customerLedgerHtml(firstGroups, canManageZalo, { framed: true, groupsHtml: groupHtmls.slice(0, firstGroups.length).join('') }) : emptyState({ iconName: 'users', title: 'Không có khách hàng phù hợp', message: isStaff ? 'Chưa có khách hàng nào ở địa bàn bạn được xem.' : 'Dùng "Nhập từ Excel" hoặc "Tạo tài khoản khách hàng" để bắt đầu.' })}
      ${enriched.length ? `<nav class="customer-page-jump" aria-label="Di chuyển trong danh sách khách hàng">
        <button type="button" data-jump="top" title="Lên đầu trang" aria-label="Lên đầu trang">↑</button>
        <button type="button" data-jump="bottom" title="Xuống cuối trang" aria-label="Xuống cuối trang">↓</button>
      </nav>` : ''}
    `;

    const drawnWrap = contentEl.querySelector('.customer-ledger-wrap');
    if (drawnWrap) drawnWrap.__sig = sig;
    const filterSumEl = filterEl.querySelector('.filter-sum');
    if (filterSumEl) filterSumEl.innerHTML = `${enriched.length} khách hàng · ${totalContracts} hợp đồng · <strong>${formatVND(totalAmount)}</strong>`;
    bindCustomerLedger(contentEl, { readOnly: isStaff });

    let restGroups = progressive ? groupHtmls.slice(LEDGER_FIRST_CHUNK) : [];
    const ledgerEl = contentEl.querySelector('.customer-ledger');
    const appendNextChunk = (force) => {
      if (!restGroups.length || drawToken !== ledgerDrawToken || !ledgerEl?.isConnected) { restGroups = []; return; }
      if (force !== true && navigator.scheduling && navigator.scheduling.isInputPending && navigator.scheduling.isInputPending()) { setTimeout(() => requestAnimationFrame(appendNextChunk), 80); return; }
      ledgerEl.insertAdjacentHTML('beforeend', restGroups.slice(0, LEDGER_NEXT_CHUNK).join(''));
      restGroups = restGroups.slice(LEDGER_NEXT_CHUNK);
      if (restGroups.length) requestAnimationFrame(appendNextChunk);
    };
    const appendAllNow = () => { while (restGroups.length) appendNextChunk(true); };
    if (restGroups.length) requestAnimationFrame(appendNextChunk);
    contentEl.querySelectorAll('.customer-page-jump [data-jump]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.jump === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }

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
  S.loadOpenNotes().then((ok) => { if (ok && contentEl.isConnected) draw(); });
}

export function customerLedgerGroupsHtml(groups, canManageZalo) {
  const dueCounts = S.dueNoteCounts();
  return groups.map(({ c, contracts, totalBalance }) => {
        const location = [c.xom, c.thon, c.tinh].filter(Boolean).join(', ') || c.address || 'Chưa có địa bàn';
        const dialPhone = String(c.phone || '').replace(/[^\d+]/g, '');
        const dueCount = dueCounts.get(c.id) || 0;
        return `<section class="customer-ledger-group" style="--g-n:${contracts.length}">
          <div class="customer-ledger-person">
            <button type="button" class="customer-ledger-person-main" data-id="${c.id}" aria-label="Xem khách hàng ${escapeHtml(c.name)}${dueCount ? `, có ${dueCount} việc đến hạn` : ''}">
              <span class="customer-ledger-avatar" style="background:${colorFor(c.id)}">${initials(c.name)}${dueCount ? `<b class="cl-due">${dueCount > 9 ? '9+' : dueCount}</b>` : ''}</span>
              <span class="customer-ledger-identity">
                <span class="customer-ledger-name">${escapeHtml(c.name)}${dueCount ? `<b class="cl-due cl-due-n">${dueCount > 9 ? '9+' : dueCount}</b>` : ''}</span>
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

export function customerLedgerHtml(groups, canManageZalo, { framed = false, groupsHtml = null } = {}) {
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
      ${groupsHtml ?? customerLedgerGroupsHtml(groups, canManageZalo)}
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

  wrap.addEventListener('click', (e) => {
    const callLink = e.target.closest('a.customer-ledger-call[href^="tel:"]');
    if (callLink && wrap.contains(callLink)) {
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

  wrap.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('[data-view-contract]');
    if (!row || !wrap.contains(row) || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    event.preventDefault();
    showContractNoticeMenu(row.dataset.viewContract, event.clientX, event.clientY);
  });
}

let closeContractNoticeMenu = null;

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
      else S.logUiAction('print-notice', `In ${type === 'due' ? 'Giấy báo hợp đồng đến hạn' : 'Thông báo nộp lãi'} cho hợp đồng **${contract.code}**${customer ? ` (khách hàng "**${customer.name}**")` : ''}`);
    });
  });
  menu.querySelector('button')?.focus();
}

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

function contractNotificationContext(contract) {
  const accrued = S.accruedInterest(contract);
  const info = S.contractStatusInfo(contract);
  const org = S.getOrg();
  const tpl = org.pushTemplates || S.DEFAULT_PUSH_TEMPLATES;

  const dueDate = info.source === 'installment' ? S.nextInstallmentInfo(contract).next.dueDate : contract.dueDate;
  return { accrued, info, org, tpl, dueDate };
}

function pickNotificationBodyTemplate(tpl, info) {
  if (info.status === 'qua_han') return tpl.overdue;
  if (info.status === 'gan_den_han') return tpl.nearDue;
  return tpl.interest;
}

function buildContractNotificationPreset(contract, customer) {
  const { accrued, info, org, tpl, dueDate } = contractNotificationContext(contract);

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

function zaloActionButtonHtml(inZaloList, blockedReason = '') {

  return inZaloList
    ? `<button class="cd-oa-btn is-remove" id="btn-remove-zalo-cust">${icon('minus', 'icon-sm')} Bỏ khỏi OA</button>`
    : `<button class="cd-oa-btn is-add${blockedReason ? ' is-blocked' : ''}" id="btn-add-zalo-cust"${blockedReason ? ` aria-disabled="true" title="${escapeHtml(blockedReason)}"` : ''}>${icon('plus', 'icon-sm')} Thêm vào OA</button>`;
}

const statusDotInline = (on) => `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${on ? 'var(--success)' : 'var(--danger)'};flex:none"></span>`;

const CALL_PREVIEW = 4;

function callBarHtml(calls, dialPhone, c) {
  const last = calls[0];
  const t = last ? describeCallTime(last.createdAt) : null;
  const lastHtml = last
    ? `<div class="cd-last"><small>Gọi gần nhất</small><b>${escapeHtml(t.ago || t.rel)}</b><span>${t.days === 0 ? 'Hôm nay' : `${escapeHtml(t.weekday)}, ${t.date}`} lúc <strong>${t.time}</strong> · ${escapeHtml(last.adminName)}</span></div>`
    : `<div class="cd-last is-none"><small>Gọi gần nhất</small><b>Chưa gọi lần nào</b></div>`;
  const number = c.phone
    ? `<div class="cd-num"><span class="cd-num-ico">${icon('phone')}</span><span class="cd-num-tx"><small>Số điện thoại</small><span class="cd-num-line"><b>${escapeHtml(formatPhoneDisplay(c.phone))}</b><button type="button" class="cd-copy" data-copy-phone aria-label="Sao chép số điện thoại" title="Sao chép số điện thoại">${icon('copy', 'icon-sm')}</button></span></span></div>`
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
      ${call.callee === 'co' ? `<em class="cd-callee">${icon('users', 'icon-sm')}Người cùng vay</em>` : ''}
    </div>
  </li>`;
}

function callListHtml(calls, myId, { showAll = false, mineOnly = false } = {}) {
  const list = mineOnly ? calls.filter((x) => x.adminId === myId) : calls;
  if (!list.length) {
    return `<div class="cd-empty">${icon('phone')}<b>Chưa có cuộc gọi nào</b><span>Bấm “Gọi ngay” để bắt đầu — mỗi lần gọi được ghi lại tại đây kèm ngày giờ.</span></div>`;
  }
  const shown = showAll ? list : list.slice(0, CALL_PREVIEW);
  return `<ol class="cd-calls">${shown.map((x) => callEntryHtml(x, myId)).join('')}</ol>
    ${list.length > shown.length ? `<button type="button" class="cd-more" data-calls-more>Xem thêm ${list.length - shown.length} cuộc gọi cũ hơn ${icon('chevronDown', 'icon-sm')}</button>` : ''}`;
}

function callCardHtml(calls, { myId }) {
  const callers = new Set(calls.map((x) => x.adminId)).size;
  const sub = calls.length ? `${callers} người gọi` : 'Mọi người gọi';
  return `<h3 class="cd-h"><span>Lịch sử cuộc gọi</span><em>${calls.length}</em><small>${sub}</small>
      ${calls.length ? `<span class="cd-seg" role="group" aria-label="Lọc cuộc gọi"><button type="button" class="on" data-calls-filter="all">Tất cả</button><button type="button" data-calls-filter="mine">Của tôi</button></span>` : ''}
    </h3>
    <div id="cd-call-list">${callListHtml(calls, myId)}</div>`;
}

const OA_MIN_RECIPIENT_MSG = 'Cần giữ ít nhất 1 người nhận Zalo OA — hoặc tắt hợp đồng này bằng công tắc bên trái';
const OA_MIN_RECIPIENT_SIMPLE_MSG = 'Cần giữ ít nhất 1 người nhận Zalo OA';

function oaTickPatch(st, kind, on) {
  if (kind === 'enabled') return { enabled: on };
  if (kind === 'main') return !on && !st.toCo ? null : { toMain: on };
  return !on && !st.toMain ? null : { toCo: on };
}

const shortMoney = (n) => {
  const v = Math.round(Number(n) || 0);
  const f = (x) => x.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
  return v >= 1e9 ? `${f(v / 1e9)} tỷ` : v >= 1e6 ? `${f(v / 1e6)} tr` : formatNumber(v);
};

function coCardMode(customerId, contracts) {
  const people = S.listCoPeople(customerId);

  if (contracts.length >= 2 || people.length >= 2 || contracts.some((ct) => ct.oaEnabled === false)) return 'detail';
  return people.length === 1 ? 'simple' : 'none';
}
function coCardShown(customerId, contracts, { canOa, canEdit }) {
  const mode = coCardMode(customerId, contracts);
  if (mode === 'none') return false;
  if (mode === 'detail' && !S.listCoPeople(customerId).length) return canOa;
  return canOa || canEdit;
}

function phoneDupHtml(hs) {
  const who = (h) => (h.kind === 'main'
    ? (h.same ? 'chính <b>người vay</b> của khách này' : `<b>${escapeHtml(h.name)}</b> — người vay`)
    : (h.same ? `<b>${escapeHtml(h.name)}</b> — người cùng vay khác của khách này` : `<b>${escapeHtml(h.name)}</b> — người cùng vay của ${escapeHtml(h.customerName)}`));
  const sameMain = hs.some((h) => h.same && h.kind === 'main');
  return `<div class="cd-pp-dup-h">${icon('info', 'icon-sm')}<b>Số này trùng với ${hs.length} người</b><span>vẫn lưu được</span></div>
    <ul>${hs.slice(0, 4).map((h) => `<li>${who(h)}</li>`).join('')}${hs.length > 4 ? `<li>… và ${hs.length - 4} người khác</li>` : ''}</ul>
    ${sameMain ? '<div class="cd-pp-dup-n">Trùng số người vay nên gửi OA chỉ gửi 1 tin cho số này.</div>' : ''}`;
}
function coPersonHtml(p, { canEdit, editing, pending }) {
  const key = escapeHtml(normPersonName(p.name));
  const dial = String(p.phone || '').replace(/[^\d+]/g, '');
  const callBtn = dial
    ? `<a class="cd-pp-call" href="tel:${escapeHtml(dial)}" data-pp-call="${key}" aria-label="Gọi ${escapeHtml(p.name)}" title="Gọi người cùng vay">${icon('phone')}</a>`
    : `<span class="cd-pp-call is-off" aria-hidden="true">${icon('phone')}</span>`;
  const phoneLine = editing ? ''
    : p.phone
      ? `<span class="cd-pp-ph">${escapeHtml(formatPhoneDisplay(p.phone))}<button type="button" class="cd-pp-copy" data-pp-copy="${key}" aria-label="Sao chép số điện thoại" title="Sao chép số điện thoại">${icon('copy', 'icon-sm')}</button>${canEdit ? `<button type="button" class="cd-pp-pen" data-pp-edit="${key}" aria-label="Sửa số điện thoại" title="Sửa số điện thoại">${icon('edit', 'icon-sm')}</button>` : ''}</span>`
      : canEdit
        ? `<button type="button" class="cd-pp-addph" data-pp-edit="${key}">${icon('plus', 'icon-sm')} Nhập số điện thoại</button>`
        : '<span class="cd-pp-ph"><i class="is-none">Chưa có số điện thoại</i></span>';
  const editVal = String(p.phone || '').replace(/[^\d+]/g, '').replace(/^\+?84/, '0').slice(0, 10);
  const form = editing ? `<div class="cd-pp-form" data-person="${key}">
        <label for="pp-phone">${pending ? `Nhập số điện thoại để bật gửi Zalo OA cho ${escapeHtml(shortPersonName(p.name))}` : `Số điện thoại của ${escapeHtml(shortPersonName(p.name))}`}</label>
        <div class="cd-pp-formrow"><input class="cd-pp-in" id="pp-phone" type="tel" inputmode="numeric" maxlength="16" autocomplete="off" value="${escapeHtml(editVal)}">
          <button type="button" class="btn btn-primary btn-sm" data-pp-save>Lưu</button><button type="button" class="btn btn-outline btn-sm" data-pp-cancel>Hủy</button></div>
        <div class="cd-pp-dup" id="pp-dup" hidden></div>
      </div>` : '';
  return `<div class="cd-pp${p.phone ? '' : ' is-need'}${editing ? ' is-editing' : ''}" data-person="${key}">
      <div class="cd-pp-top">
        <span class="cd-pp-av is-co" style="background:${colorFor(p.name)}">${escapeHtml(initials(p.name))}</span>
        <div class="cd-pp-tx"><small>Người cùng vay</small><b>${escapeHtml(p.name)}</b>${phoneLine}</div>
        ${callBtn}
      </div>
      ${form}
    </div>`;
}

function coContractRowHtml(ct, oa) {
  const pill = (kind, label, on, extraCls = '') => `<label class="cdo-ck${extraCls}${on ? '' : ' off'}"><input type="checkbox" data-oa="${kind}" ${on ? 'checked' : ''} ${oa.enabled ? '' : 'disabled'}><i>${icon('check')}</i>${escapeHtml(label)}</label>`;

  const need = (label, key, extraCls = '') => `<button type="button" class="cdo-ck off need${extraCls}" data-oa-need="${key}" title="Chưa có số điện thoại — tick để nhập số" ${oa.enabled ? '' : 'disabled'}><i>${icon('check')}</i>${escapeHtml(label)}</button>`;
  const main = oa.mainLocked ? need('Người vay', '@main') : pill('main', 'Người vay', oa.toMain);
  const co = oa.coName ? (oa.coLocked ? need(shortPersonName(oa.coName), escapeHtml(normPersonName(oa.coName)), ' co') : pill('co', shortPersonName(oa.coName), oa.toCo, ' co')) : '';
  return `<div class="cdo-r${oa.enabled ? '' : ' is-off'}" data-ct="${ct.id}">
      <label class="cdo-sw" title="${oa.enabled ? 'Tắt gửi OA cho hợp đồng này' : 'Bật gửi OA cho hợp đồng này'}"><input type="checkbox" data-oa="enabled" ${oa.enabled ? 'checked' : ''} aria-label="Gửi Zalo OA cho hợp đồng ${escapeHtml(ct.code)}"><i></i></label>
      <div class="cdo-code"><b>${escapeHtml(ct.code)}</b><span>Gốc ${shortMoney(ct.balance)}</span></div>
      <div class="cdo-pills">${oa.enabled ? '' : '<span class="cdo-off">Không gửi OA</span>'}${main}${co}</div>
    </div>`;
}

function coPickHtml(c, contracts) {
  const p = S.listCoPeople(c.id)[0];
  if (!p) return '';
  const sts = contracts.map((ct) => S.getContractOa(ct.id)).filter(Boolean);
  const mainOn = sts.length > 0 && sts.every((st) => st.toMain);
  const coOn = !!p.phone && p.contracts.length > 0 && p.contracts.every((ct) => (S.getContractOa(ct.id) || {}).toCo);
  const tile = (key, on, title) => `<label class="cd-pp-tile${on ? ' on' : ''}" data-pp-tick="${key}"><input type="checkbox" ${on ? 'checked' : ''}><i class="cd-pp-box">${icon('check', 'icon-sm')}</i><span><b>${title}</b></span></label>`;
  const need = (key, title) => `<button type="button" class="cd-pp-tile is-need" data-pp-tick="${key}" aria-label="${title} — cần nhập số điện thoại trước"><i class="cd-pp-box">${icon('check', 'icon-sm')}</i><span><b>${title}</b></span></button>`;
  return `<div class="cd-pp-picks">
      <div class="cd-pp-pick-h">Gửi Zalo OA tới</div>
      <div class="cd-pp-pick-row">
        ${sts.some((st) => st.mainLocked) ? need('main', 'Người vay') : tile('main', mainOn, 'Người vay')}
        ${p.phone ? tile('co', coOn, 'Người cùng vay') : need('co', 'Người cùng vay')}
      </div></div>`;
}

function contractOaPickHtml(contract, { editing = false } = {}) {
  const st = S.getContractOa(contract.id);
  if (!st || !st.coName) return '';
  const tile = (key, on, title) => `<label class="cd-pp-tile${on ? ' on' : ''}" data-cv-tick="${key}"><input type="checkbox" ${on ? 'checked' : ''}><i class="cd-pp-box">${icon('check', 'icon-sm')}</i><span><b>${title}</b></span></label>`;
  const need = (key, title) => `<button type="button" class="cd-pp-tile is-need" data-cv-need="${key}" aria-label="${title} — chưa có số điện thoại"><i class="cd-pp-box">${icon('check', 'icon-sm')}</i><span><b>${title}</b></span></button>`;
  const form = editing && st.coLocked ? `<div class="cd-pp-form">
      <label for="cv-pp-phone">Nhập số điện thoại để bật gửi Zalo OA cho ${escapeHtml(shortPersonName(st.coName))}</label>
      <div class="cd-pp-formrow"><input class="cd-pp-in" id="cv-pp-phone" type="tel" inputmode="numeric" maxlength="16" autocomplete="off" value="">
        <button type="button" class="btn btn-primary btn-sm" data-cv-save>Lưu</button><button type="button" class="btn btn-outline btn-sm" data-cv-cancel>Hủy</button></div>
      <div class="cd-pp-dup" id="cv-pp-dup" hidden></div>
    </div>` : '';
  return `<div class="cd-pp-picks">
      <div class="cd-pp-pick-h">Gửi Zalo OA tới</div>
      <div class="cd-pp-pick-row">
        ${st.mainLocked ? need('main', 'Người vay') : tile('main', st.toMain, 'Người vay')}
        ${st.coLocked ? need('co', 'Người cùng vay') : tile('co', st.toCo, 'Người cùng vay')}
      </div></div>${form}`;
}

function mainPhoneFormHtml(c) {
  return `<div class="cd-pp is-editing" data-person="@main">
      <div class="cd-pp-top">
        <span class="cd-pp-av" style="background:${colorFor(c.name)}">${escapeHtml(initials(c.name))}</span>
        <div class="cd-pp-tx"><small>Người vay</small><b>${escapeHtml(c.name)}</b><span class="cd-pp-ph"><i class="is-none">Chưa có số điện thoại</i></span></div>
      </div>
      <div class="cd-pp-form" data-person="@main">
        <label for="pp-phone">Nhập số điện thoại của Người vay để bật gửi Zalo OA</label>
        <div class="cd-pp-formrow"><input class="cd-pp-in" id="pp-phone" type="tel" inputmode="numeric" maxlength="16" autocomplete="off" value="">
          <button type="button" class="btn btn-primary btn-sm" data-pp-save>Lưu</button><button type="button" class="btn btn-outline btn-sm" data-pp-cancel>Hủy</button></div>
      </div>
    </div>`;
}

function coCardHtml(c, contracts, { canOa, canEdit, editKey = null, pending = false }) {
  const people = S.listCoPeople(c.id);
  const peopleHtml = people.map((p) => coPersonHtml(p, { canEdit, editing: !!editKey && normPersonName(p.name) === editKey, pending })).join('');
  const warn = c.coPrevName
    ? `<div class="cd-pp-warn">${icon('info')}<div><b>Người cùng vay đã đổi</b><span>Hợp đồng nay ghi người cùng vay khác với <b>${escapeHtml(c.coPrevName)}</b>. Khách đã được bỏ khỏi danh sách OA; nhập số của người mới nếu muốn gửi cho họ.</span></div></div>`
    : '';
  const mode = coCardMode(c.id, contracts);
  const mainForm = canOa && editKey === '@main' ? mainPhoneFormHtml(c) : '';
  const oaRows = canOa && mode === 'detail' ? contracts.map((ct) => coContractRowHtml(ct, S.getContractOa(ct.id))).join('') : '';
  const pickSection = canOa && mode === 'simple' ? coPickHtml(c, contracts) : '';
  const oaSection = canOa && oaRows ? `
    <div class="cdo-sec">${icon('send', 'icon-sm')} Gửi Zalo OA theo từng hợp đồng</div>
    <div class="cdo-rows">${oaRows}</div>` : '';
  const title = people.length ? (canOa ? 'Người cùng vay &amp; Zalo OA' : 'Người cùng vay') : 'Zalo OA theo hợp đồng';
  return `<h3 class="cd-h"><span>${title}</span>${people.length ? `<em>${people.length}</em>` : ''}</h3>
    ${warn}${peopleHtml}${mainForm}${pickSection}${oaSection}`;
}

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

export function openCustomerDetail(customerId, { readOnly = false, context = 'customer', showActions = context === 'use', reopen = false } = {}) {
  const c = S.getCustomer(customerId);
  if (!reopen) S.logAdminAction('view-customer', { customerId });

  const contracts = S.listContractsByCustomer(customerId).filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan');
  const session = S.getSession();
  const canManageZalo = S.canManageZaloOA(session.id);
  const inZaloList = S.isZaloCustomer(customerId);
  const myId = session.id;
  const calls = S.listCallsByCustomer(customerId);
  const dialPhone = String(c.phone || '').replace(/[^\d+]/g, '');
  const logged = S.hasCustomerLoggedIn(c), pushOn = S.hasPushEnabled(c.id);

  const canManageUse = S.canManageUsers(myId);
  const canEditProfile = S.isSuperAdmin(myId);
  const canDeleteUse = canEditProfile && context === 'use';
  const hasActions = canManageUse && showActions;

  const tile = (id, ico, label, hint, cls = '') => `<button type="button" class="cd-tile${cls ? ' ' + cls : ''}" id="${id}" title="${hint}" aria-label="${hint}">${icon(ico)}<span>${label}</span></button>`;
  const actionTiles = hasActions ? [
    tile('btn-reset-pw', 'key', 'Mật khẩu', 'Cấp lại mật khẩu'),
    ...(logged ? [tile('btn-force-logout', 'logout', 'Đăng xuất', 'Đăng xuất tài khoản khách đang đăng nhập')] : []),
    tile('btn-send-noti', 'bell', 'Thông báo', 'Gửi thông báo cho khách'),
    ...(canEditProfile ? [tile('btn-edit-cust', 'edit', 'Sửa', 'Sửa hồ sơ khách hàng')] : []),
    ...(canDeleteUse ? [tile('btn-del-cust', 'trash', 'Xóa Use', 'Xóa tài khoản Use của khách', 'is-danger')] : []),
  ] : [];
  const addressText = c.address || [c.xom, c.thon, c.tinh].filter(Boolean).join(', ');
  const coShown = coCardShown(customerId, contracts, { canOa: canManageZalo, canEdit: canManageZalo || canManageUse });

  const chip = (on, text, extra = '') => `<span class="cd-chip ${on ? 'on' : 'off'}" ${extra}><i></i>${text}</span>`;
  const wideLayout = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 760px)').matches;
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
          ${canManageZalo ? `<span class="cd-oa-grp">${chip(inZaloList, inZaloList ? 'Đã thêm OA' : 'Chưa thêm OA', 'id="cd-oa-chip"')}<span id="oa-action-btn-wrap" style="display:contents">${zaloActionButtonHtml(inZaloList, inZaloList ? '' : S.oaAddBlockReason(customerId))}</span></span>` : ''}
        </div>
      </header>
      <div class="cd-callbar" id="cd-callbar">${callBarHtml(calls, dialPhone, c)}</div>
      <div class="cd-cols">
        <div class="cd-col-main">
          ${wideLayout ? '' : noteCardShellHtml()}
          ${coShown ? `<section class="cd-card cd-pp-card" id="cd-pp-card">${coCardHtml(c, contracts, { canOa: canManageZalo, canEdit: canManageZalo || canManageUse })}</section>` : ''}
          <section class="cd-card" id="cd-calls-card">${callCardHtml(calls, { myId })}</section>
        </div>
        <aside class="cd-col-side">
          <section class="cd-card cd-contracts-card">
            <h3 class="cd-h"><span>Hợp đồng</span><em>${contracts.length}</em></h3>
            <div id="contract-list" class="cd-contracts">${contracts.map((ct) => contractCardHtml(ct)).join('') || '<p class="cd-empty-note">Chưa có hợp đồng — nhập từ Excel để thêm.</p>'}</div>
          </section>
          ${wideLayout ? noteCardShellHtml() : ''}
          ${hasActions ? `<section class="cd-card cd-actions">
            <h3 class="cd-h"><span>Thao tác</span></h3>
            <div class="cd-btns" style="--n:${actionTiles.length}">${actionTiles.join('')}</div>
          </section>` : ''}
        </aside>
      </div>
    `,
    onMount(sheet, closeFn) {
      sheet.querySelector('[data-cd-close]').addEventListener('click', closeFn);
      mountNoteCard(sheet, customerId);

      const copyPhone = async (btn) => {
        if (!dialPhone) return;
        if (await copyText(dialPhone)) {
          S.logUiAction('copy-phone', `Sao chép số điện thoại khách hàng "**${c.name}**"`);
          toast('Đã sao chép số điện thoại', 'success');
          btn.classList.add('is-done'); btn.innerHTML = icon('check', 'icon-sm');
          setTimeout(() => { if (btn.isConnected) { btn.classList.remove('is-done'); btn.innerHTML = icon('copy', 'icon-sm'); } }, 1800);
        } else openCopyFallback(dialPhone);
      };
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
      S.loadCallsForCustomer(customerId).then((ok) => { if (ok && sheet.isConnected) redrawCalls(); });
      sheet.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('[data-copy-phone]');
        if (copyBtn) { copyPhone(copyBtn); return; }
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

      sheet.querySelectorAll('[data-view-contract]').forEach((btn) => {
        btn.addEventListener('click', () => { openContractView(customerId, S.getContract(btn.dataset.viewContract), { readOnly }); });
      });

      function updateZaloUi(newInZaloList) {
        const oaChip = sheet.querySelector('#cd-oa-chip');
        if (oaChip) { oaChip.classList.toggle('on', newInZaloList); oaChip.classList.toggle('off', !newInZaloList); oaChip.innerHTML = `<i></i>${newInZaloList ? 'Đã thêm OA' : 'Chưa thêm OA'}`; }
        const btnWrap = sheet.querySelector('#oa-action-btn-wrap');
        if (btnWrap) { btnWrap.innerHTML = zaloActionButtonHtml(newInZaloList, newInZaloList ? '' : S.oaAddBlockReason(customerId)); bindZaloButtons(); }
      }

      function syncOaAddBtn() {
        const btnWrap = sheet.querySelector('#oa-action-btn-wrap');
        if (btnWrap && !S.isZaloCustomer(customerId)) { btnWrap.innerHTML = zaloActionButtonHtml(false, S.oaAddBlockReason(customerId)); bindZaloButtons(); }
      }
      function bindZaloButtons() {
        const addZaloBtn = sheet.querySelector('#btn-add-zalo-cust');
        const doAddZalo = async () => {
          addZaloBtn.disabled = true;
          try { await S.addZaloCustomer(customerId); S.dismissCoBorrowerChange(customerId); toast('Đã thêm vào danh sách OA', 'success'); updateZaloUi(true); sheet.querySelector('#cd-pp-card')?.querySelector('.cd-pp-warn')?.remove(); }
          catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); addZaloBtn.disabled = false; }
        };
        if (addZaloBtn) addZaloBtn.addEventListener('click', () => {
          const blocked = S.oaAddBlockReason(customerId);
          if (blocked) { toast(blocked, 'error'); return; }
          const chg = S.coChangeInfo(customerId);
          if (chg) {
            confirmDialog({
              title: 'Người cùng vay đã thay đổi',
              message: `Hợp đồng nay ghi người cùng vay ${chg.names.length ? `là <b>${chg.names.map(escapeHtml).join(', ')}</b>` : 'khác'}, khác với <b>${escapeHtml(chg.prevName)}</b> đã chọn trước đó. Chỉ gửi Zalo OA cho người vay, hoặc nhập số và tick gửi cho người mới trước khi gửi cho họ. Vẫn thêm khách vào danh sách OA?`,
              confirmLabel: 'Vẫn thêm vào OA', onConfirm: doAddZalo,
            });
            return;
          }
          doAddZalo();
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

      const ppCard = sheet.querySelector('#cd-pp-card');
      if (ppCard) {
        const canEditCo = canManageZalo || canManageUse;
        let ppEditKey = null, ppPending = null, ppSaving = false;
        const drawPp = () => {
          ppCard.innerHTML = coCardHtml(S.getCustomer(customerId) || c, contracts, { canOa: canManageZalo, canEdit: canEditCo, editKey: ppEditKey, pending: !!ppPending });
          if (ppEditKey) { ppCard.querySelector('#pp-phone')?.focus(); updateDup(); }
          syncOaAddBtn();
        };
        const updateDup = () => {
          const box = ppCard.querySelector('#pp-dup'), inp = ppCard.querySelector('#pp-phone');
          if (!box || !inp) return;
          const person = ppEditKey && ppEditKey !== '@main' ? personOf(ppEditKey) : null;
          const chk = checkCoPhone(inp.value);
          const hs = person && chk.ok && !chk.empty ? S.findPhoneHolders(chk.phone, customerId, person.name) : [];
          box.hidden = !hs.length;
          box.innerHTML = hs.length ? phoneDupHtml(hs) : '';
        };
        const personOf = (key) => S.listCoPeople(customerId).find((p) => normPersonName(p.name) === key);
        const onCoSaved = (e) => {
          if (!ppCard.isConnected) { document.removeEventListener('qtd-co-saved', onCoSaved); return; }
          if (e.detail && e.detail.customerId === customerId && !ppEditKey) drawPp();
        };
        document.addEventListener('qtd-co-saved', onCoSaved);

        const simpleTargets = (kind, on) => {
          const p = S.listCoPeople(customerId)[0];
          if (!p) return [];
          const inP = new Set(p.contracts.map((x) => x.id));
          const st = (ct) => S.getContractOa(ct.id);
          if (kind === 'main') {
            if (!on && contracts.some((ct) => !inP.has(ct.id) || !st(ct).toCo)) return null;
            return contracts.filter((ct) => st(ct).toMain !== on).map((ct) => ({ id: ct.id, patch: { toMain: on } }));
          }
          if (!on && p.contracts.some((ct) => !st(ct).toMain)) return null;
          return p.contracts.filter((ct) => st(ct).toCo !== on).map((ct) => ({ id: ct.id, patch: { toCo: on } }));
        };
        const runTargets = (targets) => Promise.all(targets.map((t) => S.setContractOa(t.id, t.patch)));

        ppCard.addEventListener('input', (e) => {
          const inp = e.target.closest('#pp-phone');
          if (!inp) return;
          const v = sanitizeCoPhoneInput(inp.value);
          if (v !== inp.value) inp.value = v;
          updateDup();
        });

        ppCard.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.isComposing || !e.target.closest('#pp-phone')) return;
          e.preventDefault();
          ppCard.querySelector('[data-pp-save]')?.click();
        });
        ppCard.addEventListener('click', async (e) => {

          const cp = e.target.closest('[data-pp-copy]');
          if (cp) {
            const p = personOf(cp.dataset.ppCopy);
            const digits = String((p && p.phone) || '').replace(/[^\d+]/g, '');
            if (!digits) return;
            if (await copyText(digits)) {
              S.logUiAction('copy-phone', `Sao chép số điện thoại người cùng vay "**${p.name}**" của khách hàng "**${c.name}**"`);
              toast('Đã sao chép số điện thoại', 'success');
              cp.classList.add('is-done'); cp.innerHTML = icon('check', 'icon-sm');
              setTimeout(() => { if (cp.isConnected) { cp.classList.remove('is-done'); cp.innerHTML = icon('copy', 'icon-sm'); } }, 1800);
            } else openCopyFallback(digits);
            return;
          }
          const call = e.target.closest('[data-pp-call]');
          if (call) {
            const p = personOf(call.dataset.ppCall);
            if (p) { S.logCall(customerId, p.phone, 'co', p.name); redrawCalls(); }
            return;
          }
          const need = e.target.closest('[data-oa-need]');
          if (need) { ppEditKey = need.dataset.oaNeed; ppPending = { ctId: need.closest('[data-ct]')?.dataset.ct || null }; drawPp(); return; }
          const needTile = e.target.closest('button.cd-pp-tile.is-need[data-pp-tick]');
          if (needTile) {
            if (needTile.dataset.ppTick === 'main') { ppEditKey = '@main'; ppPending = { all: true }; drawPp(); return; }
            const p0 = S.listCoPeople(customerId)[0]; if (p0) { ppEditKey = normPersonName(p0.name); ppPending = { all: true }; drawPp(); } return;
          }
          const edit = e.target.closest('[data-pp-edit]');
          if (edit) { ppEditKey = edit.dataset.ppEdit; ppPending = null; drawPp(); return; }
          if (e.target.closest('[data-pp-cancel]')) { ppEditKey = null; ppPending = null; drawPp(); return; }
          const saveBtn = e.target.closest('[data-pp-save]');
          if (saveBtn) {
            if (ppSaving) return;
            const isMain = ppEditKey === '@main';
            const person = isMain ? null : personOf(ppEditKey);
            if (!isMain && !person) { ppEditKey = null; ppPending = null; drawPp(); return; }
            const chk = checkCoPhone(ppCard.querySelector('#pp-phone').value);
            if (!chk.ok) { toast(chk.reason, 'error'); return; }
            if (chk.empty && (isMain || ppPending)) { toast(`Nhập số điện thoại để bật gửi Zalo OA cho ${isMain ? 'người vay' : 'người cùng vay'}`, 'error'); return; }
            if (isMain && S.listCoPeople(customerId).some((p) => p.phone && samePhone(p.phone, chk.phone))) { toast('Trùng số của người cùng vay', 'error'); return; }
            ppSaving = true; saveBtn.disabled = true; saveBtn.textContent = 'Đang lưu…';
            try {
              if (isMain) {
                await S.saveMainPhone(customerId, chk.phone);
                if (canManageZalo && ppPending) {
                  if (ppPending.ctId) { if (!(S.getContractOa(ppPending.ctId) || {}).toMain) await S.setContractOa(ppPending.ctId, { toMain: true }, { optimistic: false }); }
                  else await runTargets(simpleTargets('main', true) || []);
                }
                toast('Đã lưu số điện thoại và bật gửi Zalo OA cho người vay', 'success');
                ppEditKey = null; ppPending = null;
                closeFn(); openCustomerDetail(customerId, { readOnly, context, showActions, reopen: true });
                return;
              }
              const holders = chk.empty ? [] : S.findPhoneHolders(chk.phone, customerId, person.name);
              await S.saveCoPhone(customerId, person.name, chk.phone);
              const wantTick = !chk.empty && canManageZalo && ppPending && (ppPending.ctId || ppPending.all) && !holders.some((h) => h.same && h.kind === 'main');
              if (wantTick && ppPending.ctId) await S.setContractOa(ppPending.ctId, { toCo: true }, { optimistic: false });
              else if (wantTick) await runTargets(simpleTargets('co', true) || []);
              const dupNote = holders.length ? ` Lưu ý: trùng số với ${holders.slice(0, 2).map((h) => h.name).join(', ')}${holders.length > 2 ? ` và ${holders.length - 2} người khác` : ''}.` : '';
              toast((chk.empty ? 'Đã xóa số điện thoại người cùng vay' : wantTick ? 'Đã lưu số và bật gửi Zalo OA cho người cùng vay' : 'Đã lưu số điện thoại người cùng vay') + dupNote, 'success', dupNote ? 5000 : 2200);
              ppEditKey = null; ppPending = null; drawPp();
            } catch (err) {
              toast(err.message || 'Có lỗi xảy ra', 'error');
              if (saveBtn.isConnected) { saveBtn.disabled = false; saveBtn.textContent = 'Lưu'; }
            } finally { ppSaving = false; }
          }
        });

        ppCard.addEventListener('change', (e) => {
          const tickWrap = e.target.closest('label[data-pp-tick]');
          if (tickWrap) {
            const on = e.target.checked;
            const targets = simpleTargets(tickWrap.dataset.ppTick, on);
            if (!targets) { e.target.checked = !on; toast(OA_MIN_RECIPIENT_SIMPLE_MSG, 'error'); return; }
            ppEditKey = null; ppPending = null;
            const saving = runTargets(targets);
            drawPp();
            saving.catch((err) => { toast(err.message || 'Có lỗi xảy ra', 'error'); if (ppCard.isConnected) drawPp(); });
            return;
          }
          const inp = e.target.closest('input[data-oa]');
          const row = inp && inp.closest('[data-ct]');
          if (!row) return;
          const ctId = row.dataset.ct, st = S.getContractOa(ctId);
          if (!st) return;
          const kind = inp.dataset.oa, on = inp.checked;
          const patch = oaTickPatch(st, kind, on);
          if (!patch) { inp.checked = !on; toast(OA_MIN_RECIPIENT_MSG, 'error'); return; }
          ppEditKey = null; ppPending = null;
          const saving = S.setContractOa(ctId, patch);
          drawPp();
          saving.catch((err) => { toast(err.message || 'Có lỗi xảy ra', 'error'); if (ppCard.isConnected) drawPp(); });
        });
      }
      if (!hasActions) return;
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
      ${oa && ct.oaEnabled === false ? '<span class="customer-ledger-oa customer-ledger-oa-gap" aria-hidden="true"></span>' : oa ? `<button type="button" class="btn btn-outline btn-sm customer-ledger-oa" data-send-oa="${ct.id}" title="${escapeHtml(oaReason)}" aria-label="Gửi OA cho hợp đồng ${escapeHtml(ct.code)}" ${!oa.inZaloList || oa.cooldownDaysLeft > 0 || manualOaSending.has(ct.id) ? 'disabled' : ''}>${icon('send', 'icon-sm')}<span>Gửi OA</span></button>` : ''}
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

function zaloHintHtml(inZaloList, zaloCooldownDaysLeft, lastZaloSend) {
  if (!inZaloList) {
    return `<div class="field-hint text-danger">${icon('alert', 'icon-sm')} Khách chưa có trong Danh sách OA — vào chi tiết khách hàng (nút "Thêm vào OA") để thêm trước khi gửi được.</div>`;
  }
  if (!lastZaloSend) return '';

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
  if (!status.enabled) return '<div class="field-hint">Muốn gửi tự động hàng tháng thì vào mục Quản lý OA.</div>';
  const interval = [1, 2, 3, 4].includes(status.intervalMonths) ? status.intervalMonths : 1;
  const every = status.intervalMonths === null ? '' : interval === 1 ? ' hàng tháng' : ` ${interval} tháng`;
  return `<div class="field-hint customer-contract-oa-auto-added">Đã thêm vào gửi tự động${every}</div>`;
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

async function sendManualOa(contractId, button, onSuccess, asOf = null) {
  if (manualOaSending.has(contractId)) return;
  const originalLabel = button.innerHTML;
  const compact = button.classList.contains('customer-ledger-oa');
  manualOaSending.add(contractId);
  button.disabled = true;
  button.innerHTML = compact ? 'Đang gửi' : `${icon('refresh', 'icon-sm')} Đang gửi...`;
  try {
    const res = await S.sendZaloManual(contractId, { asOf });

    const okText = (res.sent >= 2 ? 'Đã gửi tin Zalo OA cho người vay và người cùng vay' : res.sentTo === 'co' ? 'Đã gửi tin Zalo OA cho người cùng vay' : 'Đã gửi tin Zalo OA cho người vay') + (asOf ? ` (lãi tính đến ${formatDate(asOf)})` : '');
    toast(res.ok ? (res.note ? `${okText}. ${res.note}` : okText) : (res.reason || 'Gửi thất bại — xem chi tiết lỗi trong "Quản lý gửi tin".'), res.ok ? 'success' : 'error', res.note || /chưa đăng ký Zalo/.test(res.reason || '') ? 7000 : undefined);
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

function fitCoNames(cust) {
  const nm = cust && cust.querySelector('.nm');
  if (!nm) return;
  const bs = [...nm.querySelectorAll('b')];
  if (bs.length < 2) return;
  cust.classList.remove('is-wrap');
  bs.forEach((b) => { b.style.fontSize = ''; });
  const base = parseFloat(getComputedStyle(bs[0]).fontSize) || 13;
  let size = base;
  while (nm.scrollWidth > nm.clientWidth + 0.5 && size > 10.5) { size -= 0.5; bs.forEach((b) => { b.style.fontSize = `${size}px`; }); }
  if (nm.scrollWidth > nm.clientWidth + 0.5) { bs.forEach((b) => { b.style.fontSize = ''; }); cust.classList.add('is-wrap'); }
}

function fitOneLine(el, minPx = 9) {
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize) || 16;
  while (el.scrollWidth > el.clientWidth + 0.5 && size > minPx) { size -= 0.5; el.style.fontSize = `${size}px`; }
}

function fitMoneyRow(els) {
  const list = [...els];
  const nat = list.map((el) => { el.style.fontSize = ''; return parseFloat(getComputedStyle(el).fontSize) || 16; });
  list.forEach((el) => fitOneLine(el));
  const ratio = list.map((el, i) => (parseFloat(getComputedStyle(el).fontSize) || nat[i]) / nat[i]);
  const rows = new Map();
  list.forEach((el, i) => { const k = Math.round(el.getBoundingClientRect().top); rows.set(k, [...(rows.get(k) || []), i]); });
  rows.forEach((idx) => {
    const main = idx.filter((i) => !list[i].classList.contains('sm'));
    const fMain = main.length ? Math.min(...main.map((i) => ratio[i])) : 1;
    idx.forEach((i) => {
      const f = list[i].classList.contains('sm') ? Math.min(fMain, ratio[i]) : fMain;
      if (f < 1) list[i].style.fontSize = `${Math.max(9, Math.round(nat[i] * f * 2) / 2)}px`;
    });
  });
}

function openCopyFallback(text) {
  openModal({
    title: 'Sao chép thông tin khoản vay',
    bodyHtml: `<p class="text-sm text-muted mb-8">Máy chưa cho sao chép tự động. Chạm giữ vào khung bên dưới, chọn "Chọn tất cả" rồi "Sao chép".</p><textarea id="loan-copy-ta" readonly rows="14" style="width:100%;border:1px solid var(--border-strong);border-radius:8px;padding:10px;font:13px/1.5 inherit">${escapeHtml(text)}</textarea>`,
    onMount(sheet) { const ta = sheet.querySelector('#loan-copy-ta'); if (ta) { ta.focus(); ta.select(); } },
  });
}

function contractFormulaHtml(contract, days, accrued) {
  return `${formatVND(contract.balance)} × ${days} ngày × ${contract.interestRate}% ÷ 365 ngày = <strong>${formatVND(accrued)}</strong>`;
}

export function openContractView(customerId, contract, { readOnly = false, reopen = false } = {}) {
  const customer = S.getCustomer(customerId);
  if (!reopen) S.logAdminAction('view-contract', { contractId: contract.id });

  const info = S.contractStatusInfo(contract);
  const interestPaidUntil = contract.interestPaidUntil || contract.disbursedDate;
  const interestDays = S.interestDaysAccrued(contract);
  let accrued = S.accruedInterest(contract);
  const collateralName = contract.hasCollateral ? COLLATERAL_NAMES[contract.collateralType] : null;
  const canPay = S.effectiveContractStatus(contract) !== 'da_tat_toan';
  const session = S.getSession();
  const canManageZalo = S.canManageZaloOA(session.id);

  const { inZaloList, lastZaloSend, cooldownDaysLeft: zaloCooldownDaysLeft } = manualOaState(contract);

  const org = S.getOrg();
  const hasBank = canPay && org.bankBin && org.bankAccountNo;

  function qrContent(goc, lai, settle = false) {
    const kind = settle ? 'tat_toan' : goc > 0 && lai > 0 ? 'goc_lai' : goc > 0 ? 'goc' : 'lai';
    return transferContent(kind, contract, customer);
  }
  const qrParamsFor = (amount, goc, lai, settle = false) => {
    const qc = qrContent(goc, lai, settle);
    return { bin: org.bankBin, accountNo: org.bankAccountNo, amount, content: qc.text, accountName: org.bankAccountName, displayContent: qc.shown, displayAccountName: org.bankAccountDisplayName };
  };
  const qrUrl = hasBank ? buildVietQrUrl(qrParamsFor(accrued, 0, accrued)) : '';

  const coName = customer ? heirOfContract(contract, customer.name) : '';
  const dialOf = (v) => String(v || '').replace(/[^\d+]/g, '');
  const mainDial = customer ? dialOf(customer.phone) : '';
  const coPhoneRaw = coName ? coPhoneOf(customer.coPeople, coName) : '';
  const coDial = dialOf(coPhoneRaw);
  const callBtn = (who, dial, label) => (dial ? `<a class="cv-call" href="tel:${escapeHtml(dial)}" data-cv-call="${who}" aria-label="${label}" title="${label}">${icon('phone', 'icon-sm')}<span class="t">Gọi</span></a>` : '');
  const custHtml = !customer ? '' : coName
    ? `<p class="cv-cust"><span class="nm"><span class="g"><b>${escapeHtml(customer.name)}</b>${callBtn('main', mainDial, 'Gọi người vay')}</span><span class="g"><i>và</i><b>${escapeHtml(coName)}</b>${callBtn('co', coDial, 'Gọi người cùng vay')}</span></span></p>`
    : `<p class="cv-cust"><span class="nm"><b>${escapeHtml(customer.name)}</b></span>${callBtn('main', mainDial, 'Gọi người vay')}</p>`;

  const principalNum = Number(contract.principal) || 0;
  const paidText = principalNum > 0 ? formatVND(Math.max(0, principalNum - (Number(contract.balance) || 0))) : '—';
  const showAlert = canPay && info.source !== 'installment' && info.status !== 'dang_vay';
  const overdue = info.status === 'qua_han';
  const chipHtml = showAlert ? `<span class="cv-state ${overdue ? 'is-over' : 'is-soon'}"><i></i><span class="d">${overdue ? `Quá hạn ${info.days} ngày` : `Gần đến hạn · còn ${info.days} ngày`}</span><span class="p">${overdue ? `Quá hạn ${info.days} ngày` : `Còn ${info.days} ngày`}</span></span>` : '';
  const alertHtml = showAlert ? `<span class="cv-alert ${overdue ? 'is-over' : ''}">${icon('alert', 'icon-sm')}${overdue ? `Đã quá hạn ${info.days} ngày` : `Còn ${info.days} ngày đến hạn thanh toán`}</span>` : '';
  const termTotal = daysBetween(new Date(contract.disbursedDate), new Date(contract.dueDate));
  const termPct = !canPay || termTotal <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((daysBetween(new Date(contract.disbursedDate), new Date()) / termTotal) * 100)));

  const zaloShown = !!(customer && customer.phone && canPay && canManageZalo && contract.oaEnabled !== false);
  const actBtns = [
    customer && customer.phone && canPay ? `<a href="${buildSmsLink(customer, contract)}" id="btn-sms-ct" class="cv-act">${icon('message')}<span>Nhắn SMS cho khách</span></a>` : '',
    customer && canPay ? `<button type="button" class="cv-act" id="btn-noti-app-ct">${icon('bell')}<span>Thông báo qua ứng dụng</span></button>` : '',
    zaloShown ? `<button type="button" class="cv-act" id="btn-zalo-manual-ct" ${!inZaloList || zaloCooldownDaysLeft > 0 ? 'disabled' : ''}>${icon('send')}<span>Gửi tin Zalo OA ngay</span></button>` : '',
  ].filter(Boolean);
  const oaPickHtml = canManageZalo && canPay && contract.oaEnabled !== false ? contractOaPickHtml(contract) : '';
  const autoQuick = canPay ? S.peekZaloAutoSendStatus(contract.id) : null;
  const contactHtml = canPay ? `
            <section class="cv-card cv-c-contact">
              <h4 class="cv-h">${icon('send')}Liên hệ và gửi thông báo</h4>
              ${actBtns.length ? `<div class="cv-acts" style="--n:${actBtns.length}">${actBtns.join('')}</div>` : ''}
              ${zaloShown ? `<div id="zalo-hint-wrap-ct">${zaloHintHtml(inZaloList, zaloCooldownDaysLeft, lastZaloSend)}</div><div id="zalo-asof-hint-ct"></div>` : ''}
              ${oaPickHtml ? `<div class="cv-oa" id="cv-oa-pick">${oaPickHtml}</div>` : ''}
              <div id="zalo-auto-status-ct">${zaloAutoStatusHtml(autoQuick)}</div>
            </section>` : '';
  const payHtml = `
            <section class="cv-card cv-c-pay">
              <h4 class="cv-h">${icon('wallet')}Gửi mã QR để thanh toán</h4>
              ${hasBank ? `
                <label class="cv-settle"><span>Tất toán khoản vay</span><input type="checkbox" id="settle-full-cb-ct"/><i class="cv-sw"></i></label>
                <div class="cv-two">
                  <div class="cv-fld"><label for="qr-goc-input">Gốc</label><input type="text" inputmode="numeric" id="qr-goc-input" placeholder="0"/></div>
                  <div class="cv-fld"><label for="qr-lai-input">Lãi</label><input type="text" inputmode="numeric" id="qr-lai-input"/></div>
                </div>
                <div class="cv-lock" id="qr-lai-hint" style="display:none">Đã nhập số tiền trả gốc — Lãi tự khóa theo đúng "Lãi đến nay", không sửa tay được. Xóa ô Gốc nếu cần tự chỉnh lại Lãi.</div>
                <div class="cv-pay">
                  <div class="cv-total">
                    <small>Tổng chuyển khoản</small>
                    <strong id="qr-total-ct">${formatVND(accrued)}</strong>
                    <div class="cv-btns">
                      <button type="button" class="cv-btn" id="btn-download-qr-ct">${icon('download', 'icon-sm')} Tải ảnh mã QR</button>
                      <button type="button" class="cv-btn" id="btn-share-qr-ct">${icon('share', 'icon-sm')} Chia sẻ ảnh QR</button>
                    </div>
                  </div>
                  <div class="cv-qr"><img id="qr-img-ct" src="${qrUrl ? qrImageSrc(qrUrl, { compact: true }) : ''}" alt="Mã QR chuyển khoản"/></div>
                </div>` : `<p class="text-sm text-muted">${canPay ? 'Chưa cấu hình thông tin nhận thanh toán.' : 'Hợp đồng đã tất toán.'}</p>`}
            </section>`;

  const close = openModal({
    title: `Hợp đồng ${escapeHtml(contract.code)}`,
    sheetClass: 'customer-contract-sheet cv-sheet',
    bodyHtml: `
      <div class="customer-contract-view cv">
        <header class="cv-hero ${overdue ? 'is-over' : ''}">
          <div class="cv-head">
            <div class="cv-block">
              <span class="cv-eyebrow">Hợp đồng tín dụng</span>
              <div class="cv-main ${coName ? 'has-co' : ''}">
                <h2 class="cv-code"><small>Số</small>${escapeHtml(contract.code)}</h2>
                ${chipHtml}
                ${custHtml}
              </div>
            </div>
            <div class="cv-tools">
              <button type="button" class="cv-tbtn" id="btn-copy-loan" title="Sao chép thông tin khoản vay để gửi khách" aria-label="Sao chép thông tin khoản vay để gửi khách">${icon('copy')}</button>
              <button type="button" class="cv-tbtn cv-close" aria-label="Đóng">${icon('x')}</button>
            </div>
          </div>
          <div class="cv-term">
            <div class="t"><span class="e">Ngày vay</span><span class="d">${formatDate(contract.disbursedDate)}</span></div>
            <div class="cv-prog" style="--p:${termPct}%"><b></b><i></i></div>
            <div class="t"><span class="e">Đến hạn</span><span class="d">${formatDate(contract.dueDate)}</span></div>
          </div>
        </header>
        <section class="cv-strip">
          <div class="cv-cells">
            <div class="cv-cell">
              <div class="cv-lbl">DƯ NỢ HIỆN TẠI</div>
              <strong class="cv-val">${formatVND(contract.balance)}</strong>
              <div class="cv-note">Số gốc còn phải trả</div>
            </div>
            <div class="cv-cell" title="Gốc đã trả = số tiền vay ban đầu trừ dư nợ hiện tại">
              <div class="cv-lbl">GỐC ĐÃ TRẢ</div>
              <strong class="cv-val sm">${paidText}</strong>
            </div>
            <div class="cv-cell">
              <div class="cv-lbl">LÃI CỘNG DỒN</div>
              <strong class="cv-val gold" id="ct-accrued">${formatVND(accrued)}</strong>
              <div class="cv-row"><span class="d">Tính đến</span><span class="p">Đến</span>
                <span class="cv-inp">
                  <input type="text" id="ct-asof" inputmode="numeric" autocomplete="off" maxlength="10" value="${formatDate(new Date())}" aria-label="Tính lãi đến ngày"/>
                  <button type="button" class="cv-ico" id="ct-cal" aria-label="Chọn ngày trên lịch">${icon('calendar')}</button>
                  <input type="date" class="cv-native" id="ct-asof-native" tabindex="-1" aria-hidden="true"/>
                </span>
              </div>
            </div>
            <div class="cv-cell">
              <div class="cv-lbl">SỐ NGÀY LÃI</div>
              <div class="cv-row days"><label class="cv-inp is-days"><input type="text" id="ct-days" inputmode="numeric" autocomplete="off" maxlength="4" value="${interestDays}" aria-label="Số ngày tính lãi"/>${icon('edit')}</label><span class="unit">ngày</span></div>
              <div class="cv-note"><span class="d">Từ kỳ đã trả lãi (${formatDate(interestPaidUntil)})</span><span class="p">Từ ${formatDate(interestPaidUntil)}</span></div>
            </div>
          </div>
          <div class="cv-reset" id="ct-resetrow" hidden>Đang tính lãi đến <b id="ct-resetdate"></b> · <button type="button" class="cv-reset-btn" id="ct-reset2">${icon('undo')} Về hôm nay</button></div>
          <div class="cv-formula"><span class="lbl">Cách tính lãi</span><span class="cv-fx">${contractFormulaHtml(contract, interestDays, accrued)}</span>${alertHtml}</div>
        </section>
        <div class="cv-body">
          ${installmentNextBoxHtml(contract, 'installment-next-box-ct')}
          <div class="cv-grid">
            <div class="cv-col">
              <section class="cv-card cv-c-info">
                <h4 class="cv-h">${icon('landmark')}Thông tin hợp đồng</h4>
                <div class="oc-line"><span>Số tiền vay ban đầu</span><b>${formatVND(contract.principal)}</b></div>
                <div class="oc-line"><span>Ngày vay</span><b>${formatDate(contract.disbursedDate)}</b></div>
                <div class="oc-line"><span>Ngày đến hạn</span><b>${formatDate(contract.dueDate)}</b></div>
                <div class="oc-line"><span>Đã trả lãi đến ngày</span><b>${formatDate(interestPaidUntil)}</b></div>
                <div class="oc-line"><span>Lãi suất</span><b>${contract.interestRate}%/năm</b></div>
                <div class="oc-line"><span>SĐT</span><b class="cv-ph">${mainDial ? `<button type="button" class="cv-cp" data-cv-copy="main" title="Sao chép số điện thoại" aria-label="Sao chép số điện thoại">${icon('copy', 'icon-sm')}</button><a class="cv-tel" href="tel:${escapeHtml(mainDial)}" data-cv-call="main">${icon('phone', 'icon-sm')} ${escapeHtml(customer.phone)}</a>` : '—'}</b></div>
                ${coDial ? `<div class="oc-line"><span>SĐT người cùng vay</span><b class="cv-ph"><button type="button" class="cv-cp" data-cv-copy="co" title="Sao chép số điện thoại người cùng vay" aria-label="Sao chép số điện thoại người cùng vay">${icon('copy', 'icon-sm')}</button><a class="cv-tel" href="tel:${escapeHtml(coDial)}" data-cv-call="co">${icon('phone', 'icon-sm')} ${escapeHtml(coPhoneRaw)}</a></b></div>` : ''}
              </section>
              <section class="cv-card cv-c-asset">
                <h4 class="cv-h">${icon('shieldCheck')}Tài sản bảo đảm</h4>
                ${collateralName ? `<div class="cv-asset"><span class="ic">${icon('landmark')}</span><span class="t">${collateralName}</span><span class="v"><small>Giá trị</small>${formatVND(Math.max(0, Number(contract.collateralValue) || 0))}</span></div>` : '<p class="cv-none">Không có tài sản bảo đảm</p>'}
              </section>
            </div>
            <div class="cv-col">${contactHtml}${payHtml}
            </div>
          </div>
          ${readOnly ? '' : `<div class="cv-foot"><button type="button" class="cv-del" id="del-contract">${icon('trash', 'icon-sm')} Xóa hợp đồng</button></div>`}
        </div>
      </div>
    `,
    onMount(sheet, closeFn) {
      const closeBtn = sheet.querySelector('.cv-close');
      closeBtn.addEventListener('click', closeFn);
      sheet.addEventListener('click', (e) => {
        const call = e.target.closest('[data-cv-call]');
        if (!call || !customer) return;
        if (call.dataset.cvCall === 'co') S.logCall(customer.id, coPhoneOf(customer.coPeople, coName), 'co', coName);
        else S.logCall(customer.id, customer.phone);
      });
      sheet.querySelectorAll('[data-cv-copy]').forEach((copyPhoneBtn) => copyPhoneBtn.addEventListener('click', async () => {
        const isCo = copyPhoneBtn.dataset.cvCopy === 'co';
        const dial = isCo ? coDial : mainDial;
        if (await copyText(dial)) {
          S.logUiAction('copy-phone', isCo ? `Sao chép số điện thoại người cùng vay "**${coName}**" của khách hàng "**${customer.name}**"` : `Sao chép số điện thoại khách hàng "**${customer.name}**"`);
          toast('Đã sao chép số điện thoại', 'success');
          copyPhoneBtn.classList.add('is-done'); copyPhoneBtn.innerHTML = icon('check', 'icon-sm');
          setTimeout(() => { if (copyPhoneBtn.isConnected) { copyPhoneBtn.classList.remove('is-done'); copyPhoneBtn.innerHTML = icon('copy', 'icon-sm'); } }, 1800);
        } else openCopyFallback(dial);
      }));
      const oaPick = sheet.querySelector('#cv-oa-pick');
      if (oaPick) {
        let oaEditing = false, oaSaving = false;
        const updateOaDup = () => {
          const box = oaPick.querySelector('#cv-pp-dup'), inp = oaPick.querySelector('#cv-pp-phone');
          if (!box || !inp) return;
          const chk = checkCoPhone(inp.value);
          const hs = chk.ok && !chk.empty ? S.findPhoneHolders(chk.phone, customerId, coName) : [];
          box.hidden = !hs.length;
          box.innerHTML = hs.length ? phoneDupHtml(hs) : '';
        };
        const drawOaPick = () => {
          oaPick.innerHTML = contractOaPickHtml(contract, { editing: oaEditing });
          if (oaEditing) { oaPick.querySelector('#cv-pp-phone')?.focus(); updateOaDup(); }
        };
        oaPick.addEventListener('input', (e) => {
          const inp = e.target.closest('#cv-pp-phone');
          if (!inp) return;
          const v = sanitizeCoPhoneInput(inp.value);
          if (v !== inp.value) inp.value = v;
          updateOaDup();
        });
        oaPick.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.isComposing || !e.target.closest('#cv-pp-phone')) return;
          e.preventDefault();
          oaPick.querySelector('[data-cv-save]')?.click();
        });
        oaPick.addEventListener('click', async (e) => {
          const need = e.target.closest('[data-cv-need]');
          if (need) {
            if (need.dataset.cvNeed === 'co') { oaEditing = true; drawOaPick(); }
            else toast('Người vay chưa có số điện thoại — nhập số ở Chi tiết khách hàng để bật gửi Zalo OA', 'error');
            return;
          }
          if (e.target.closest('[data-cv-cancel]')) { oaEditing = false; drawOaPick(); return; }
          const saveBtn = e.target.closest('[data-cv-save]');
          if (!saveBtn || oaSaving) return;
          const chk = checkCoPhone(oaPick.querySelector('#cv-pp-phone').value);
          if (!chk.ok) { toast(chk.reason, 'error'); return; }
          if (chk.empty) { toast('Nhập số điện thoại để bật gửi Zalo OA cho người cùng vay', 'error'); return; }
          oaSaving = true; saveBtn.disabled = true; saveBtn.textContent = 'Đang lưu…';
          try {
            const holders = S.findPhoneHolders(chk.phone, customerId, coName);
            await S.saveCoPhone(customerId, coName, chk.phone);
            const wantTick = !holders.some((h) => h.same && h.kind === 'main');
            if (wantTick) await S.setContractOa(contract.id, { toCo: true }, { optimistic: false });
            const dupNote = holders.length ? ` Lưu ý: trùng số với ${holders.slice(0, 2).map((h) => h.name).join(', ')}${holders.length > 2 ? ` và ${holders.length - 2} người khác` : ''}.` : '';
            toast((wantTick ? 'Đã lưu số và bật gửi Zalo OA cho người cùng vay' : 'Đã lưu số điện thoại người cùng vay') + dupNote, 'success', dupNote ? 5000 : 2200);
            document.dispatchEvent(new CustomEvent('qtd-co-saved', { detail: { customerId } }));
            closeFn(); openContractView(customerId, S.getContract(contract.id), { readOnly, reopen: true });
          } catch (err) {
            toast(err.message || 'Có lỗi xảy ra', 'error');
            if (saveBtn.isConnected) { saveBtn.disabled = false; saveBtn.textContent = 'Lưu'; }
          } finally { oaSaving = false; }
        });
        oaPick.addEventListener('change', (e) => {
          const tick = e.target.closest('label[data-cv-tick]');
          const st = tick && S.getContractOa(contract.id);
          if (!st) return;
          const on = e.target.checked;
          const patch = oaTickPatch(st, tick.dataset.cvTick, on);
          if (!patch) { e.target.checked = !on; toast(OA_MIN_RECIPIENT_SIMPLE_MSG, 'error'); return; }
          oaEditing = false;
          const saving = S.setContractOa(contract.id, patch);
          drawOaPick();
          saving.catch((err) => { toast(err.message || 'Có lỗi xảy ra', 'error'); if (oaPick.isConnected) drawOaPick(); });
        });
      }
      if (customer && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        closeBtn.insertAdjacentHTML('beforebegin', `<button type="button" class="cv-tbtn txt cv-print" id="btn-print-notice" aria-haspopup="menu" aria-expanded="false" title="In giấy báo">${icon('printer')}<span>In giấy báo</span>${icon('chevronDown')}</button>`);
        const printBtn = sheet.querySelector('#btn-print-notice');
        printBtn.addEventListener('click', () => {
          if (printBtn.classList.contains('is-open')) { closeContractNoticeMenu?.(); return; }
          const r = printBtn.getBoundingClientRect();
          showContractNoticeMenu(contract.id, r.right, r.bottom + 6, { anchor: printBtn });
        });
      }
      const zaloAutoStatus = sheet.querySelector('#zalo-auto-status-ct');
      if (zaloAutoStatus && !autoQuick?.final) {
        const showAutoStatus = (status) => { if (zaloAutoStatus.isConnected) zaloAutoStatus.innerHTML = zaloAutoStatusHtml(status); };
        S.getZaloAutoSendStatus(contract.id).then(showAutoStatus).catch(() => { if (!autoQuick) showAutoStatus(undefined); });
      }
      bindInstallmentNextBox(sheet, contract, 'installment-next-box-ct');
      const qrImgEl = sheet.querySelector('#qr-img-ct');
      let gocAmount = 0;
      let laiAmount = accrued;
      let settleFull = false;

      function updateQrTotal() {
        const totalEl = sheet.querySelector('#qr-total-ct');
        if (totalEl) totalEl.textContent = formatVND(gocAmount + laiAmount);
      }
      function refreshQr() {
        if (!qrImgEl) return;
        qrImgEl.src = qrImageSrc(buildVietQrUrl(qrParamsFor(gocAmount + laiAmount, gocAmount, laiAmount, settleFull)), { compact: true });
      }

      const refreshQrDebounced = debounce(refreshQr, 400);
      const settleCb = sheet.querySelector('#settle-full-cb-ct');
      const gocInput = sheet.querySelector('#qr-goc-input');
      const laiInput = sheet.querySelector('#qr-lai-input');
      const laiHint = sheet.querySelector('#qr-lai-hint');

      function syncLaiLock() {
        if (!laiInput) return;
        const locked = settleFull || gocAmount > 0;
        laiInput.disabled = locked;

        if (laiHint) laiHint.style.display = (locked && !settleFull) ? 'block' : 'none';
        if (locked) {
          laiAmount = accrued;
          laiInput.value = formatNumber(accrued);
        }
      }

      function syncSettleFull() {
        if (gocInput) gocInput.disabled = settleFull;
        gocAmount = settleFull ? contract.balance : 0;
        if (gocInput) gocInput.value = settleFull ? formatNumber(contract.balance) : '';
        syncLaiLock();
      }
      if (settleCb) settleCb.addEventListener('change', (e) => { settleFull = e.target.checked; syncSettleFull(); updateQrTotal(); refreshQr(); });
      if (gocInput) bindMoneyInput(gocInput, 0, (v) => { gocAmount = v; syncLaiLock(); updateQrTotal(); refreshQrDebounced(); }, contract.balance);
      if (laiInput) bindMoneyInput(laiInput, accrued, (v) => { laiAmount = v; updateQrTotal(); refreshQrDebounced(); });
      const smsBtn = sheet.querySelector('#btn-sms-ct');
      if (smsBtn) smsBtn.addEventListener('click', () => S.logUiAction('sms', `Soạn tin nhắn SMS cho khách hàng "**${customer.name}**" (hợp đồng **${contract.code}**)`));
      const downloadQrBtn = sheet.querySelector('#btn-download-qr-ct');
      if (downloadQrBtn) downloadQrBtn.addEventListener('click', () => { S.logUiAction('qr', `Tải mã QR thanh toán hợp đồng **${contract.code}**`); downloadQrImage(qrImgEl.src, `qr-thanh-toan-${contract.code}.png`); });
      const shareQrBtn = sheet.querySelector('#btn-share-qr-ct');
      if (shareQrBtn) shareQrBtn.addEventListener('click', () => { S.logUiAction('qr', `Chia sẻ mã QR thanh toán hợp đồng **${contract.code}**`); shareQrImage(qrImgEl.src, qrContent(gocAmount, laiAmount, settleFull).shown); });

      const accruedEl = sheet.querySelector('#ct-accrued');
      const asOfInput = sheet.querySelector('#ct-asof');
      const nativeDate = sheet.querySelector('#ct-asof-native');
      const daysInput = sheet.querySelector('#ct-days');
      const calBtn = sheet.querySelector('#ct-cal');
      const formulaEl = sheet.querySelector('.cv-fx');
      const resetRow = sheet.querySelector('#ct-resetrow');
      const resetRowDate = sheet.querySelector('#ct-resetdate');
      let oaAsOf = null;
      const oaAsOfHint = sheet.querySelector('#zalo-asof-hint-ct');
      if (accruedEl && asOfInput && daysInput) {
        const today = startOfDay(new Date());
        const minAsOf = interestAsOfForDays(contract, 0);
        const maxAsOf = interestAsOfForDays(contract, MAX_INTEREST_DAYS);
        let asOf = today;
        const clamp = (dt) => (dt < minAsOf ? minAsOf : dt > maxAsOf ? maxAsOf : dt);
        const sizeDays = () => { daysInput.style.width = `${Math.max(2, daysInput.value.length) + 0.9}ch`; };

        const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        asOfInput.readOnly = coarse;
        nativeDate.min = toDateInputValue(minAsOf);
        nativeDate.max = toDateInputValue(maxAsOf);

        function render(from) {
          const days = S.interestDaysAccrued(contract, asOf);
          accrued = S.accruedInterest(contract, asOf);
          if (from !== 'date') asOfInput.value = formatDate(asOf);
          if (from !== 'days') { daysInput.value = String(days); sizeDays(); }
          accruedEl.textContent = formatVND(accrued);
          fitMoneyRow(sheet.querySelectorAll('.cv-cells .cv-val'));
          if (formulaEl) { formulaEl.innerHTML = contractFormulaHtml(contract, days, accrued); fitOneLine(formulaEl); }
          const edited = daysBetween(today, asOf) !== 0;
          if (resetRow) resetRow.hidden = !edited;
          if (resetRowDate) resetRowDate.textContent = formatDate(asOf);
          oaAsOf = edited ? toDateInputValue(asOf) : null;
          if (oaAsOfHint) oaAsOfHint.innerHTML = edited ? `<div class="field-hint">Tin Zalo OA sẽ ghi lãi tính đến <strong>${formatDate(asOf)}</strong>: <strong>${formatVND(accrued)}</strong>, hạn thanh toán <strong>${formatDate(asOf)}</strong>.</div>` : '';

          laiAmount = accrued;
          if (laiInput) laiInput.value = accrued ? formatNumber(accrued) : '';
          updateQrTotal();
          refreshQrDebounced();
        }
        asOfInput.addEventListener('input', () => {
          const masked = maskViDate(asOfInput.value);
          if (masked !== asOfInput.value) asOfInput.value = masked;
          const parsed = parseViDate(masked);
          asOfInput.closest('.cv-inp').classList.toggle('is-invalid', masked.length === 10 && !parsed);
          if (!parsed) return;
          const fixed = clamp(parsed);
          asOf = fixed;
          render(fixed.getTime() === parsed.getTime() ? 'date' : undefined);
        });
        asOfInput.addEventListener('focus', () => { if (!coarse) asOfInput.select(); });
        asOfInput.addEventListener('blur', () => { asOfInput.closest('.cv-inp').classList.remove('is-invalid'); asOfInput.value = formatDate(asOf); });
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
            S.logUiAction('copy-loan', `Sao chép thông tin khoản vay hợp đồng **${contract.code}**`);
            toast('Đã sao chép thông tin khoản vay', 'success');
            copyBtn.classList.add('is-done'); copyBtn.innerHTML = icon('check');
            setTimeout(() => { copyBtn.classList.remove('is-done'); copyBtn.innerHTML = icon('copy'); }, 1800);
          } else openCopyFallback(text);
        });
        sizeDays();
      }

      const valEls = sheet.querySelectorAll('.cv-cells .cv-val');
      const fxEls = sheet.querySelectorAll('.cv-fx');
      const custEl = sheet.querySelector('.cv-main.has-co .cv-cust');
      const fitMoney = () => { fitMoneyRow(valEls); fxEls.forEach((el) => fitOneLine(el)); fitCoNames(custEl); };
      fitMoney();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitMoney);
      if (typeof ResizeObserver === 'function') new ResizeObserver(fitMoney).observe(sheet.querySelector('.cv-cells'));
      const notiBtn = sheet.querySelector('#btn-noti-app-ct');
      if (notiBtn) notiBtn.addEventListener('click', () => {
        if (!customer) return;
        openSendNotificationModal(customer, buildContractNotificationPreset(contract, customer));
      });
      const zaloManualBtn = sheet.querySelector('#btn-zalo-manual-ct');
      const zaloHintWrap = sheet.querySelector('#zalo-hint-wrap-ct');

      if (zaloHintWrap) S.fetchLastSuccessfulZaloSend(contract.id).then((row) => {
        if (!row || !zaloHintWrap.isConnected) return;
        const st = manualOaState(contract);
        zaloHintWrap.innerHTML = zaloHintHtml(st.inZaloList, st.cooldownDaysLeft, st.lastZaloSend);
        const btn = sheet.querySelector('#btn-zalo-manual-ct');
        if (btn && !manualOaSending.has(contract.id)) btn.disabled = !st.inZaloList || st.cooldownDaysLeft > 0;
      });

      if (zaloManualBtn) zaloManualBtn.addEventListener('click', () => sendManualOa(contract.id, zaloManualBtn, (sentAt) => {
        if (zaloHintWrap) zaloHintWrap.innerHTML = zaloHintHtml(true, 5, { sentAt, triggeredBy: 'manual' });
      }, oaAsOf));
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

function bindCoPhoneImport(sheet) {
  const input = sheet.querySelector('#file-input-3');
  const btn = sheet.querySelector('#btn-upload-file-3');
  const out = sheet.querySelector('#cophone-result');
  let items = [];
  let overwrite = false;
  const idleHtml = btn.innerHTML;
  const lineHtml = (r) => {
    const st = CO_PHONE_STATUS[r.status] || { label: r.status, tone: 'warn' };
    const who = [r.customer, r.person].filter(Boolean).map(escapeHtml).join(' · ');
    const cur = r.current ? ` (đang lưu ${escapeHtml(r.current)})` : '';
    return `<div class="text-sm cph-row is-${st.tone}"><b>Dòng ${r.row} · ${escapeHtml(r.code)}</b>${who ? ` · ${who}` : ''}${r.phone ? ` · ${escapeHtml(r.phone)}` : ''}<br/><span class="text-muted">${escapeHtml(st.label)}${cur}</span></div>`;
  };
  const draw = (res) => {
    const c = res.counts || {};
    const willSave = (c.added || 0) + (c.replaced || 0);
    const skipped = [
      ['same', 'dòng đã có số y hệt'], ['conflict', 'dòng đã lưu số khác — giữ nguyên'], ['nophone', 'dòng không có SĐT trong file'], ['nocontract', 'Số HĐTD không có trên web'],
      ['settled', 'hợp đồng đã tất toán'], ['noheir', 'hợp đồng chưa ghi tên người cùng vay'], ['badphone', 'SĐT sai định dạng'], ['samemain', 'trùng số của người vay'], ['noscope', 'ngoài địa bàn được phép'],
    ].filter(([k]) => c[k]).map(([k, label]) => `<div class="text-sm text-muted">• ${c[k]} ${label}</div>`).join('');
    const problems = (res.rows || []).filter((r) => (CO_PHONE_STATUS[r.status] || {}).tone === 'warn');
    out.innerHTML = `
      <div class="card card-pad mt-16" style="background:var(--surface-alt)" id="cophone-card">
        <div class="fw-700 mb-8" id="cophone-sum">${willSave ? `Sẽ lưu <b>${willSave}</b> số điện thoại cho <b>${res.customers || 0}</b> khách hàng` : 'Không có số nào cần lưu'}${c.replaced ? ` <span class="text-muted">(trong đó ${c.replaced} số ghi đè)</span>` : ''}</div>
        ${skipped}
        ${c.conflict || overwrite ? `<label class="text-sm mt-8" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cophone-overwrite" ${overwrite ? 'checked' : ''}/> Ghi đè cả số đã lưu khác số trong file</label>` : ''}
        ${problems.length ? `<details class="mt-8"><summary class="text-sm fw-700" style="cursor:pointer">Xem ${problems.length} dòng cần chú ý</summary><div class="cph-list">${problems.slice(0, 60).map(lineHtml).join('')}${problems.length > 60 ? `<div class="text-sm text-muted">… và ${problems.length - 60} dòng khác</div>` : ''}</div></details>` : ''}
        ${willSave ? `<details class="mt-8"><summary class="text-sm fw-700" style="cursor:pointer">Xem ${willSave} số sẽ lưu</summary><div class="cph-list">${(res.rows || []).filter((r) => r.status === 'added' || r.status === 'replaced').slice(0, 400).map(lineHtml).join('')}</div></details>` : ''}
        <button class="btn btn-primary btn-block mt-8" id="cophone-save" ${willSave ? '' : 'disabled'}>Lưu ${willSave} số điện thoại</button>
      </div>`;
    out.querySelector('#cophone-overwrite')?.addEventListener('change', async (e) => { overwrite = e.target.checked; await preview(); });
    out.querySelector('#cophone-save').addEventListener('click', async (e) => {
      const saveBtn = e.currentTarget;
      saveBtn.disabled = true; saveBtn.textContent = 'Đang lưu…';
      try {
        const done = await S.importCoPhones(items, { overwrite });
        const n = (done.counts?.added || 0) + (done.counts?.replaced || 0);
        out.innerHTML = `<div class="card card-pad mt-16" style="background:var(--surface-alt)"><div class="fw-700" id="cophone-done">✅ Đã lưu ${n} số điện thoại người cùng vay cho ${done.customers || 0} khách hàng</div><div class="text-sm text-muted mt-8">Số điện thoại đã vào sổ người cùng vay của từng khách — vào chi tiết khách hàng để tick gửi Zalo OA cho người cùng vay.</div></div>`;
        toast(`Đã lưu ${n} số điện thoại người cùng vay`, 'success');
        window.__qtdRedrawCustomers?.();
      } catch (err) {
        toast(err.message || 'Có lỗi xảy ra', 'error');
        saveBtn.disabled = false; saveBtn.textContent = `Lưu ${willSave} số điện thoại`;
      }
    });
  };
  const preview = async () => {
    try { draw(await S.previewImportCoPhones(items, { overwrite })); } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
  };
  input.addEventListener('change', () => { btn.disabled = !input.files[0]; out.innerHTML = ''; });
  btn.addEventListener('click', async () => {
    const file = input.files[0];
    if (!file) return;
    btn.disabled = true; btn.textContent = 'Đang đọc file…';
    try {
      const parsed = parseCoPhoneRows(await readExcelFirstSheet(file));
      if (!parsed.ok) { toast(parsed.reason, 'error'); return; }
      if (!parsed.items.length) { toast('File không có dòng nào có Số HĐTD', 'error'); return; }
      items = parsed.items; overwrite = false;
      await preview();
    } catch (err) {
      toast(err.message || 'Không đọc được file', 'error');
    } finally { btn.disabled = !input.files[0]; btn.innerHTML = idleHtml; }
  });
}

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
      <div class="field mt-16">
        <label for="file-input-3" class="fw-700 text-sm">File số điện thoại người cùng vay</label>
        <input type="file" id="file-input-3" accept=".xls,.xlsx"/>
        <div class="field-hint">File có cột <b>Số HĐTD</b> và <b>SĐT người cùng vay</b>. Khớp theo hợp đồng + tên người cùng vay ghi trên hợp đồng đó; chỉ thêm số vào sổ người cùng vay, không đụng hợp đồng, không tick gửi OA. Có bước xem trước.</div>
      </div>
      <button class="btn btn-outline btn-block mt-8" id="btn-upload-file-3" disabled>${icon('upload', 'icon-sm')} Đọc file &amp; xem trước số điện thoại</button>
      <div id="cophone-result"></div>
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
      bindCoPhoneImport(sheet);

      const showImportResult = (res) => {
        resultEl.innerHTML = `
          <div class="card card-pad mt-16" style="background:var(--surface-alt)">
            <div class="text-sm mb-8">✅ Đã nhập xong — ${res.newProfiles} khách hàng mới · ${res.existingCustomers} khách đã có sẵn được cập nhật · ${res.contracts} hợp đồng</div>
            ${res.deletedContracts ? `<div class="text-sm mb-8" style="color:var(--warning)">${icon('alert', 'icon-sm')} Đã xóa ${res.deletedContracts} hợp đồng hết dư nợ hoặc không còn trong file này</div>` : ''}
            ${res.zaloAutoSendMigrated ? `<div class="text-sm mb-8" style="color:var(--success)">${icon('message', 'icon-sm')} Đã tự chuyển ${res.zaloAutoSendMigrated} lựa chọn "Gửi tin tự động" sang hợp đồng mới của cùng khách (khách vẫn còn vay, chỉ đổi số hợp đồng)</div>` : ''}
            ${res.deletedCustomers ? `<div class="text-sm mb-8" style="color:var(--warning)">${icon('alert', 'icon-sm')} Đã dọn ${res.deletedCustomers} hồ sơ không còn hợp đồng nào (chưa có tài khoản Use)</div>` : ''}
            ${(res.coBorrowerChanges || []).length ? `<div class="text-sm mb-8" style="color:var(--warning)">${icon('alert', 'icon-sm')} ${res.coBorrowerChanges.length} khách đổi người cùng vay, đã bỏ khỏi danh sách OA: ${res.coBorrowerChanges.slice(0, 5).map((x) => `${escapeHtml(x.name)} (${escapeHtml(x.prev)} → ${escapeHtml(x.now)})`).join('; ')}${res.coBorrowerChanges.length > 5 ? '…' : ''}</div>` : ''}
            ${res.newAccounts.length ? `
              <div class="fw-700 text-sm mb-6">Tài khoản Use mới tự tạo (gửi cho khách hàng):</div>
              ${res.newAccounts.map((a) => `<div class="oc-line"><span>${a.name} (${a.cccd})</span><b>${a.tempPassword}</b></div>`).join('')}
            ` : ''}
            ${res.errors.length ? `<div class="text-sm text-danger mt-8">${res.errors.slice(0, 5).map(escapeHtml).join('<br/>')}</div>` : ''}
          </div>
        `;

        resultEl.insertAdjacentHTML('beforeend', `<div class="mt-8">${importSummaryHtml(res.summary)}${importDetailsHtml(res.details)}${res.historyId ? '<div class="text-sm text-muted mt-8">Đã lưu vào “Lịch sử nhập” — nhập nhầm thì mở mục đó để quay lại bản trước.</div>' : ''}</div>`);
        bindImportDetails(resultEl);
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        toast('Đã nhập dữ liệu xong', 'success');
        window.__qtdRedrawCustomers?.();
      };

      const runImport = async (tsvText, fullSync, fileName) => {
        if (!tsvText.trim()) { toast('Không có dữ liệu để nhập', 'error'); return; }
        const prev = await S.previewImportFromPastedTable(tsvText, { fullSync });
        openImportPreview({
          title: fullSync ? 'Xem trước — tải file số 1' : 'Xem trước — dán tay',
          summary: prev.summary, details: prev.details, fullSync,
          notes: [fileName ? `File: ${fileName}` : '', prev.localSkipped ? `${prev.localSkipped} dòng không phải dòng hợp đồng đã bị bỏ qua khi đọc file.` : '', ...(prev.parseErrors || []).slice(0, 3)].filter(Boolean),
          async onConfirm() {
            const res = await S.importFromPastedTable(tsvText, { fullSync, fileName });

            try { showImportResult(res); } catch (renderErr) { console.error(renderErr); }
          },
        });
      };

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
