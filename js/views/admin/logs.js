import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { emptyState, searchBoxHtml, bindSearchBox } from '../../components/ui.js';
import { toast } from '../../components/toast.js';
import { formatDate, initials, colorFor, escapeHtml, stripDiacritics } from '../../utils.js';

let allRows = [];
let searchQuery = '';
let loadingMore = false;
let noMore = false;
const PAGE_SIZE = 100;

const POLL_MS = 5000;
let pollTimer = null;

function isThisRouteActive() {
  return (location.hash || '#/').split('?')[0] === '#/admin/nhat-ky';
}

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Nhật ký sử dụng' });
}

export function resetFilters() {
  allRows = [];
  searchQuery = '';
  loadingMore = false;
  noMore = false;
  stopPolling();
}

export async function render(contentEl) {
  if (!allRows.length && !noMore) {
    contentEl.innerHTML = `<div class="card card-pad text-sm text-muted" style="text-align:center">Đang tải...</div>`;
    try {
      const rows = await S.listActivityLog({ limit: PAGE_SIZE });
      if (!isThisRouteActive()) return;
      allRows = rows;
      if (rows.length < PAGE_SIZE) noMore = true;
    } catch (e) {
      if (isThisRouteActive()) contentEl.innerHTML = `<div class="card card-pad">${emptyState({ iconName: 'clock', title: 'Không tải được', message: e.message || 'Có lỗi xảy ra, thử lại sau.' })}</div>`;
      return;
    }
  }
  drawList(contentEl);
  startPolling();
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollTick, POLL_MS);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollTick() {
  if (!isThisRouteActive()) { stopPolling(); return; }

  if (document.activeElement && document.activeElement.id === 'log-search') return;
  const contentEl = document.getElementById('app-content');
  if (!contentEl) { stopPolling(); return; }
  try {
    const latest = await S.listActivityLog({ limit: 20 });
    if (!isThisRouteActive()) { stopPolling(); return; }
    const existingIds = new Set(allRows.map((r) => r.id));
    const freshOnes = latest.filter((r) => !existingIds.has(r.id));
    if (!freshOnes.length) return;
    allRows = [...freshOnes, ...allRows];
    drawList(contentEl);
  } catch (e) {

  }
}

function drawList(contentEl) {
  const q = stripDiacritics(searchQuery.trim().toLowerCase());
  const rows = allRows.filter((r) => {
    if (!q) return true;
    const hay = stripDiacritics(`${r.adminName || ''} ${r.description || ''}`.toLowerCase());
    return hay.includes(q);
  });

  const listHtml = rows.length ? renderDayGroups(rows) : `<div class="card card-pad">${emptyState({
    iconName: 'clock',
    title: q ? 'Không tìm thấy' : 'Chưa có nhật ký nào',
    message: q ? 'Không có dòng nào khớp tìm kiếm.' : 'Nhật ký sẽ tự ghi lại khi có thao tác của quản trị viên/nhân viên.',
  })}</div>`;

  const loadMoreHtml = (!q && !noMore) ? `<div style="text-align:center;margin-top:6px"><button class="btn btn-outline btn-sm" id="btn-load-more-log" ${loadingMore ? 'disabled' : ''}>${loadingMore ? 'Đang tải...' : 'Tải thêm'}</button></div>` : '';

  let input = contentEl.querySelector('#log-search');
  let listEl = contentEl.querySelector('#log-list');
  if (!input || !listEl) {
    contentEl.innerHTML = `<div style="margin-bottom:12px">${searchBoxHtml('log-search', 'Tìm theo tên quản trị viên/nội dung...', searchQuery)}</div><div id="log-list"></div>`;
    bindSearchBox(contentEl, 'log-search', (v) => { searchQuery = v; drawList(contentEl); });
    input = contentEl.querySelector('#log-search');
    listEl = contentEl.querySelector('#log-list');
  } else if (input.value !== searchQuery && document.activeElement !== input) {

    input.value = searchQuery;
    const clearBtn = contentEl.querySelector('#log-search-clear');
    if (clearBtn) clearBtn.style.display = searchQuery ? 'flex' : 'none';
  }
  listEl.innerHTML = listHtml + loadMoreHtml;

  const moreBtn = listEl.querySelector('#btn-load-more-log');
  if (moreBtn) moreBtn.addEventListener('click', async () => {
    if (loadingMore) return;
    loadingMore = true;
    drawList(contentEl);
    try {
      const last = allRows[allRows.length - 1];
      const more = await S.listActivityLog({ before: last?.createdAt, limit: PAGE_SIZE });
      if (!isThisRouteActive()) return;
      allRows = allRows.concat(more);
      if (more.length < PAGE_SIZE) noMore = true;
    } catch (e) { toast(e.message || 'Có lỗi xảy ra', 'error'); }
    loadingMore = false;
    drawList(contentEl);
  });
}

function hhmm(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}
function dayKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
}

function dateDividerLabel(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(dt)) / 86400000);
  if (diffDays === 0) return 'Hôm nay';
  if (diffDays === 1) return 'Hôm qua';
  return formatDate(dt);
}

function renderDayGroups(rows) {
  let html = '';
  let curKey = null;
  let dayRows = [];
  const flushDay = () => {
    if (!dayRows.length) return;
    html += `<div class="log-day-divider">${escapeHtml(dateDividerLabel(dayRows[0].createdAt))}</div>`;
    html += groupConsecutive(dayRows).map(groupHtml).join('');
  };
  for (const r of rows) {
    const k = dayKey(r.createdAt);
    if (curKey !== null && k !== curKey) { flushDay(); dayRows = []; }
    curKey = k;
    dayRows.push(r);
  }
  flushDay();
  return html;
}

function groupConsecutive(rows) {
  const groups = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.adminId === r.adminId && last.adminName === r.adminName) {
      last.items.push(r);
    } else {
      groups.push({ adminId: r.adminId, adminName: r.adminName, items: [r] });
    }
  }
  return groups;
}

function renderLogDescription(description) {
  return escapeHtml(description || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function groupHtml(g) {
  const name = g.adminName || 'Không rõ';
  return `
    <div class="card order-card log-group">
      <div class="flex items-center gap-10 log-group-head">
        <div class="row-thumb" style="width:36px;height:36px;font-size:13px;background:${colorFor(g.adminId || name)};flex:none">${initials(name)}</div>
        <span class="fw-700" style="font-size:13.5px">${escapeHtml(name)}</span>
      </div>
      <div class="log-group-items">
        ${g.items.map((r) => `
          <div class="log-group-item">
            <div class="text-sm text-muted">${hhmm(r.createdAt)}</div>
            <div class="text-sm" style="margin-top:2px">${renderLogDescription(r.description)}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
}
