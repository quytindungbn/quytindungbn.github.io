// Trang "Quản lý OA" — quản lý gửi tin Zalo OA (ZBS Template Message):
//   - Tab "Gửi tin tự động": danh sách hợp đồng ĐÃ được thêm để hệ thống tự
//     gửi (cron send-due-reminders quét đúng danh sách này, KHÔNG còn gửi
//     tràn lan mọi hợp đồng quá hạn nữa) — thêm vào danh sách làm ở màn hình
//     chi tiết hợp đồng (nút "Thêm vào gửi Zalo tự động", xem customers.js),
//     ở đây chỉ xem/bỏ khỏi danh sách + lọc theo Thôn/Xóm.
//   - Tab "Quản lý gửi tin": log mọi lần gửi (tự động lẫn gửi tay) — thành
//     công/lỗi, kèm nội dung lỗi nếu có.
//   - Tab "Cấu hình" (CHỈ quản trị viên toàn quyền): chọn Template ID theo
//     tình huống + thông tin kết nối kỹ thuật — xem ghi chú trong RLS/Secrets
//     ở docs/supabase-migration.md mục 10.
// Nhân viên được cấp cờ canManageZaloOA chỉ thấy dữ liệu trong đúng phạm vi
// Thôn/Xóm được gán (RLS tự lọc từ server, xem loadAdminSessionData() trong
// js/state.js) — quản trị viên toàn quyền thấy hết.
import * as S from '../../state.js';
import { icon } from '../../icons.js';
import { pageHeader } from '../../components/shell.js';
import { emptyState, openPicker, pillSelectHtml } from '../../components/ui.js';
import { confirmDialog } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { formatDateTime, colorFor, initials } from '../../utils.js';

const KIND_LABEL = { den_han: 'Đến hạn/Quá hạn' };

let activeTab = 'auto';
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
  if (activeTab === 'auto') drawAutoTab(slot, admin, isSuper);
  else if (activeTab === 'log') drawLogTab(slot, admin, isSuper);
  else drawConfigTab(slot);
}

// ------------------------------------------------------------
// Tab "Gửi tin tự động"
// ------------------------------------------------------------
function drawAutoTab(slot, admin, isSuper) {
  const isStaff = admin.role === 'staff';
  const allowedThon = isStaff ? (admin.allowedThon || []) : S.distinctThon();

  slot.innerHTML = `
    <div class="filter-row mb-8" id="auto-filter-pills"></div>
    <div id="auto-list"></div>
  `;
  renderPills();
  drawList();

  function renderPills() {
    const wrap = slot.querySelector('#auto-filter-pills');
    wrap.innerHTML = `
      ${pillSelectHtml('auto-pill-thon', multiPillLabel('Thôn', filterThon), filterThon.length > 0)}
      ${pillSelectHtml('auto-pill-xom', multiPillLabel('Xóm', filterXom), filterXom.length > 0)}
    `;
    wrap.querySelector('#auto-pill-thon').addEventListener('click', () => {
      openPicker({
        title: 'Chọn Thôn (chọn được nhiều)', selected: filterThon, multiSelect: true,
        options: allowedThon.map((t) => ({ value: t, label: t })),
        onSelect: (vals) => { filterThon = vals; filterXom = []; renderPills(); drawList(); },
      });
    });
    wrap.querySelector('#auto-pill-xom').addEventListener('click', () => {
      const xomList = S.distinctXom(filterThon.length ? filterThon : undefined);
      openPicker({
        title: 'Chọn Xóm (chọn được nhiều)', selected: filterXom, multiSelect: true,
        options: xomList.map((x) => ({ value: x, label: x })),
        onSelect: (vals) => { filterXom = vals; renderPills(); drawList(); },
      });
    });
    wrap.querySelectorAll('[data-pill-clear]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.pillClear;
        if (id === 'auto-pill-thon') { filterThon = []; filterXom = []; }
        else if (id === 'auto-pill-xom') { filterXom = []; }
        renderPills(); drawList();
      });
    });
  }

  function drawList() {
    const listEl = slot.querySelector('#auto-list');
    let rows = S.listZaloAutoSend()
      .map((r) => ({ r, customer: S.getCustomer(r.customerId), contract: S.getContract(r.contractId) }))
      .filter((x) => x.customer && x.contract);
    if (filterThon.length) rows = rows.filter((x) => filterThon.includes(x.customer.thon));
    if (filterXom.length) rows = rows.filter((x) => filterXom.includes(`${x.customer.thon}||${x.customer.xom}`));

    listEl.innerHTML = `
      <div class="text-sm text-muted mb-8">${rows.length} hợp đồng đang gửi tự động</div>
      ${rows.length ? rows.map(({ r, customer, contract }) => `
        <div class="list-row" style="padding:12px 4px">
          <div class="row-thumb" style="background:${colorFor(customer.id)}">${initials(customer.name)}</div>
          <div class="row-main">
            <div class="row-title">${customer.name} · ${contract.code}</div>
            <div class="row-sub">${KIND_LABEL[r.kind] || r.kind} · ${[customer.xom, customer.thon].filter(Boolean).join(', ') || 'Chưa có địa bàn'}</div>
          </div>
          <button class="icon-btn" data-remove="${r.id}" title="Bỏ khỏi danh sách">${icon('trash', 'icon-sm')}</button>
        </div>
      `).join('') : emptyState({ iconName: 'message', title: 'Chưa có hợp đồng nào', message: 'Vào chi tiết 1 hợp đồng (mục Khách hàng & Hợp đồng) để thêm vào danh sách gửi Zalo tự động.' })}
    `;
    listEl.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        confirmDialog({
          title: 'Bỏ khỏi danh sách gửi tự động?',
          message: 'Hợp đồng này sẽ không còn được tự động gửi tin Zalo nữa (vẫn gửi tay được bình thường).',
          danger: true, confirmLabel: 'Bỏ khỏi danh sách',
          onConfirm: async () => {
            try {
              await S.removeZaloAutoSend(btn.dataset.remove);
              toast('Đã bỏ khỏi danh sách', 'success');
              drawList();
            } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    });
  }
}
function multiPillLabel(label, arr) {
  if (!arr.length) return label;
  return `${label}: ${arr.length} đã chọn `;
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
          ? `Đã cấu hình mẫu tin cho tình huống <b>"Đến hạn/Quá hạn"</b> — hệ thống sẽ tự động gửi tin Zalo cho khách hàng có trong danh sách "Gửi tin tự động" mỗi khi hợp đồng đến/quá hạn (song song với thông báo đẩy).`
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
          Mẫu cho "Gần đến hạn" và "Lãi hàng tháng" sẽ thêm vào sau khi bạn tạo xong 2 mẫu đó bên Zalo —
          báo lại để bổ sung thêm ô nhập cho 2 tình huống này.
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
