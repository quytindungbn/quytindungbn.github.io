import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { emptyState, searchBoxHtml, bindSearchBox } from '../../components/ui.js';
import { toast } from '../../components/toast.js';
import { formatDateTime, initials, colorFor, escapeHtml, stripDiacritics } from '../../utils.js';

// ------------------------------------------------------------
// Trang "Nhật ký" — ghi lại các thao tác quan trọng của quản trị viên/nhân
// viên (đăng nhập, tạo/xóa/sửa tài khoản, xóa hợp đồng, nhập Excel...) —
// CHỈ quản trị viên toàn quyền (role='super') mở được trang này: chặn ở CẢ
// route (superOnly: true trong app.js, ẩn mục menu trong shell.js) LẪN RLS
// thật ở tầng database (xem docs/supabase-migration.md mục 10.33) — 2 lớp
// chặn ở giao diện chỉ là TIỆN, không phải lớp bảo mật thật sự (lớp thật
// nằm ở RLS, chặn cả khi có ai đó cố tình gọi thẳng API).
//
// KHÔNG gồm việc gửi Zalo OA (đã có trang riêng "Quản lý gửi tin" trong
// Quản lý OA, xem js/views/admin/zaloOA.js) — tránh trùng thông tin 2 nơi.
//
// Tải theo trang (mới nhất trước), "Tải thêm" để xem cũ hơn — KHÔNG tải sẵn
// toàn bộ 1 lần vì nhật ký dài dần theo thời gian.
// ------------------------------------------------------------

let allRows = [];
let searchQuery = '';
let loadingMore = false;
let noMore = false;
const PAGE_SIZE = 100;

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
}

export async function render(contentEl) {
  if (!allRows.length && !noMore) {
    contentEl.innerHTML = `<div class="card card-pad text-sm text-muted" style="text-align:center">Đang tải...</div>`;
    try {
      const rows = await S.listActivityLog({ limit: PAGE_SIZE });
      if (!isThisRouteActive()) return; // đã chuyển trang khác trong lúc chờ — bỏ qua kết quả muộn
      allRows = rows;
      if (rows.length < PAGE_SIZE) noMore = true;
    } catch (e) {
      if (isThisRouteActive()) contentEl.innerHTML = `<div class="card card-pad">${emptyState({ iconName: 'clock', title: 'Không tải được', message: e.message || 'Có lỗi xảy ra, thử lại sau.' })}</div>`;
      return;
    }
  }
  drawList(contentEl);
}

function drawList(contentEl) {
  const q = stripDiacritics(searchQuery.trim().toLowerCase());
  const rows = allRows.filter((r) => {
    if (!q) return true;
    const hay = stripDiacritics(`${r.adminName || ''} ${r.description || ''}`.toLowerCase());
    return hay.includes(q);
  });

  const searchHtml = `<div style="margin-bottom:12px">${searchBoxHtml('log-search', 'Tìm theo tên quản trị viên/nội dung...', searchQuery)}</div>`;
  const listHtml = rows.length ? rows.map(rowHtml).join('') : `<div class="card card-pad">${emptyState({
    iconName: 'clock',
    title: q ? 'Không tìm thấy' : 'Chưa có nhật ký nào',
    message: q ? 'Không có dòng nào khớp tìm kiếm.' : 'Nhật ký sẽ tự ghi lại khi có thao tác của quản trị viên/nhân viên.',
  })}</div>`;
  // Chỉ hiện "Tải thêm" khi KHÔNG đang tìm kiếm — tìm kiếm chỉ lọc cục bộ
  // trên dữ liệu đã tải, tải thêm trang mới không liên quan gì đến ô tìm.
  const loadMoreHtml = (!q && !noMore) ? `<div style="text-align:center;margin-top:6px"><button class="btn btn-outline btn-sm" id="btn-load-more-log" ${loadingMore ? 'disabled' : ''}>${loadingMore ? 'Đang tải...' : 'Tải thêm'}</button></div>` : '';

  contentEl.innerHTML = searchHtml + listHtml + loadMoreHtml;

  bindSearchBox(contentEl, 'log-search', (v) => { searchQuery = v; drawList(contentEl); });

  const moreBtn = contentEl.querySelector('#btn-load-more-log');
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

function rowHtml(r) {
  const name = r.adminName || 'Không rõ';
  return `
    <div class="card order-card">
      <div class="flex items-center gap-10">
        <div class="row-thumb" style="width:36px;height:36px;font-size:13px;background:${colorFor(r.adminId || name)};flex:none">${initials(name)}</div>
        <div style="min-width:0;flex:1">
          <div class="flex items-center gap-8" style="justify-content:space-between">
            <span class="fw-700" style="font-size:13.5px">${escapeHtml(name)}</span>
            <span class="text-sm text-muted" style="white-space:nowrap;flex:none">${formatDateTime(r.createdAt)}</span>
          </div>
          <div class="text-sm text-muted" style="margin-top:2px">${escapeHtml(r.description)}</div>
        </div>
      </div>
    </div>`;
}
