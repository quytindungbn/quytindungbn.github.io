import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { emptyState, searchBoxHtml, bindSearchBox } from '../../components/ui.js';
import { toast } from '../../components/toast.js';
import { formatDate, initials, colorFor, escapeHtml, stripDiacritics } from '../../utils.js';

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
// Tự cập nhật dòng mới mỗi 5 giây, CHỈ khi đang thật sự đứng ở trang này —
// tự dừng ngay khi rời trang (kiểm tra isThisRouteActive() ở mỗi lượt, xem
// pollTick()) — CÙNG kiểu polling có phạm vi hẹp, tự dừng đúng lúc, đã dùng
// cho khung chat (POLL_MS trong chatPanel.js), KHÁC HẲN kiểu setInterval
// chạy khắp toàn app đã bị bỏ trước đây (xem docs mục 10.22) — ở đây chỉ
// ảnh hưởng đúng trang Nhật ký, không đụng gì tới trang khác.
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
      if (!isThisRouteActive()) return; // đã chuyển trang khác trong lúc chờ — bỏ qua kết quả muộn
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
  if (pollTimer) return; // đã có sẵn 1 vòng đang chạy (VD: render() gọi lại nhiều lần do dữ liệu khác trong app đổi) — khỏi tạo thêm vòng nữa
  pollTimer = setInterval(pollTick, POLL_MS);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollTick() {
  if (!isThisRouteActive()) { stopPolling(); return; }
  // KHÔNG tự vẽ lại nếu người dùng đang gõ dở trong ô tìm kiếm — vẽ lại là
  // thay nguyên khối HTML (kể cả input) nên sẽ làm MẤT FOCUS đang gõ giữa
  // chừng, đúng kiểu lỗi từng gặp (xem docs mục 10.22) — dữ liệu mới vẫn lấy
  // được ở lượt kế tiếp sau khi người dùng gõ xong/rời khỏi ô tìm.
  if (document.activeElement && document.activeElement.id === 'log-search') return;
  const contentEl = document.getElementById('app-content');
  if (!contentEl) { stopPolling(); return; } // trang đã rời hẳn/DOM không còn — dọn luôn, khỏi tiếp tục chạy vô ích
  try {
    const latest = await S.listActivityLog({ limit: 20 }); // chỉ cần ít dòng gần nhất là đủ để phát hiện có gì mới
    if (!isThisRouteActive()) { stopPolling(); return; }
    const existingIds = new Set(allRows.map((r) => r.id));
    const freshOnes = latest.filter((r) => !existingIds.has(r.id));
    if (!freshOnes.length) return; // không có gì mới, khỏi vẽ lại vô ích
    allRows = [...freshOnes, ...allRows];
    drawList(contentEl);
  } catch (e) {
    // im lặng, thử lại ở lượt sau — đây là tự cập nhật ngầm, không phải thao
    // tác người dùng chủ động bấm nên không cần báo lỗi làm phiền.
  }
}

function drawList(contentEl) {
  const q = stripDiacritics(searchQuery.trim().toLowerCase());
  const rows = allRows.filter((r) => {
    if (!q) return true;
    const hay = stripDiacritics(`${r.adminName || ''} ${r.description || ''}`.toLowerCase());
    return hay.includes(q);
  });

  const searchHtml = `<div style="margin-bottom:12px">${searchBoxHtml('log-search', 'Tìm theo tên quản trị viên/nội dung...', searchQuery)}</div>`;
  const listHtml = rows.length ? renderDayGroups(rows) : `<div class="card card-pad">${emptyState({
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

function hhmm(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}
function dayKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
}
/** "Hôm nay" / "Hôm qua" / dd/mm/yyyy — y hệt cách chia ngày trong khung chat (xem chatPanel.js). */
function dateDividerLabel(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(dt)) / 86400000);
  if (diffDays === 0) return 'Hôm nay';
  if (diffDays === 1) return 'Hôm qua';
  return formatDate(dt);
}

/**
 * Vẽ danh sách theo TỪNG NGÀY — ngày đưa lên làm tiêu đề in đậm riêng
 * (giống vạch chia ngày trong khung chat), các dòng bên dưới chỉ còn ghi
 * GIỜ (không lặp lại ngày ở từng dòng nữa, đỡ rối mắt). rows đã sắp mới nhất
 * trước (created_at desc) nên chỉ cần gom theo dayKey liên tiếp.
 */
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

/**
 * Gộp các dòng LIÊN TIẾP NHAU (kề nhau trong danh sách đang hiện, sau khi đã
 * lọc/tìm kiếm, CÙNG 1 ngày — xem renderDayGroups() ở trên) của CÙNG 1 quản
 * trị viên thành 1 nhóm — chỉ hiện avatar/tên MỘT LẦN ở đầu nhóm, các thao
 * tác bên dưới chỉ còn giờ + nội dung, gọn hơn hẳn khi 1 người thao tác
 * nhiều lần dồn dập (VD: bấm qua lại nhiều menu). "Liên tiếp" tính trên rows
 * đã lọc/trang đã tải — 2 dòng của cùng 1 người nhưng bị CHEN NGANG bởi
 * thao tác của người khác thì KHÔNG gộp (đúng thứ tự thời gian thật, không
 * gộp nhầm 2 lượt thao tác rời rạc lại với nhau).
 */
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
            <div class="text-sm${r.action === 'nav-page' ? '' : ' fw-700'}" style="margin-top:2px">${escapeHtml(r.description)}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
}
