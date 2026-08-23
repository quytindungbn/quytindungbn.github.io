// Trang "Quản lý OA" — quản lý MẪU TIN Zalo (ZBS Template Message) dùng để
// tự động nhắc nợ/nhắc lãi qua Zalo cho khách hàng. Chỉ quản lý Template ID
// ở đây (không nhạy cảm) — App ID/Secret Key/Access Token/Refresh Token thật
// KHÔNG cấu hình qua giao diện này, mà đặt riêng ở Supabase Edge Functions →
// Secrets + bảng zalo_oa_tokens (chỉ Edge Function server đọc được, không
// hiện ra trình duyệt dù là admin) — xem docs/supabase-migration.md mục 10.
import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { toast } from '../../components/toast.js';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Quản lý OA' });
}

export function render(contentEl) {
  const org = S.getOrg();
  const configured = !!org.zaloTemplateDueId;
  contentEl.innerHTML = `
    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Trạng thái</h2></div>
      <p class="text-sm text-muted">
        ${configured
          ? `Đã cấu hình mẫu tin cho tình huống <b>"Đến hạn/Quá hạn"</b> — hệ thống sẽ tự động gửi tin Zalo cho khách hàng qua số điện thoại mỗi khi hợp đồng đến/quá hạn (song song với thông báo đẩy).`
          : `Chưa cấu hình mẫu tin nào — hệ thống hiện CHƯA tự gửi tin Zalo cho khách hàng. Điền Template ID bên dưới để bật.`}
      </p>
    </div>

    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Mẫu tin theo tình huống</h2></div>
      <p class="text-sm text-muted mb-8">
        Template ID lấy từ trang quản lý mẫu ZBS Template Message (mục "Quản lý Template" trên Zalo) —
        mẫu phải ở trạng thái <b>"Đã duyệt"</b> mới dùng được. Mỗi tình huống dùng 1 mẫu riêng (nội
        dung/tham số khác nhau); tình huống nào chưa có Template ID thì hệ thống bỏ qua, không gửi
        Zalo cho tình huống đó (thông báo đẩy vẫn gửi bình thường như cũ, không bị ảnh hưởng).
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

  contentEl.querySelector('#zalo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await S.updateOrg({ zaloTemplateDueId: fd.get('zaloTemplateDueId').trim() });
      toast('Đã lưu cấu hình Zalo OA', 'success');
      render(contentEl);
    } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
  });
}
function esc(s) { return String(s || '').replace(/"/g, '&quot;'); }
