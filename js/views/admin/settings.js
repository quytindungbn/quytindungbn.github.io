import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { toast } from '../../components/toast.js';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Cài đặt' });
}

export function render(contentEl) {
  const org = S.getOrg();
  const pt = org.pushTemplates || S.DEFAULT_PUSH_TEMPLATES;
  contentEl.innerHTML = `
    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Thông tin quỹ tín dụng</h2></div>
      <form id="org-form">
        <div class="field"><label>Tên đầy đủ</label><input name="name" value="${esc(org.name)}" required/></div>
        <div class="field"><label>Tên viết tắt (hiển thị ở sidebar)</label><input name="shortName" value="${esc(org.shortName)}"/></div>
        <div class="field-row">
          <div class="field"><label>Hotline</label><input name="hotline" value="${esc(org.hotline)}"/></div>
          <div class="field"><label>Địa chỉ</label><input name="address" value="${esc(org.address)}"/></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Lưu thông tin</button>
      </form>
    </div>

    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Banner trang chủ khách hàng</h2></div>
      <form id="banner-form">
        <div class="field">
          <label>Hiển thị banner</label>
          <div class="radio-row">
            <div class="radio-opt ${org.bannerEnabled ? 'active' : ''}" data-enabled="true">Bật</div>
            <div class="radio-opt ${!org.bannerEnabled ? 'active' : ''}" data-enabled="false">Tắt</div>
          </div>
        </div>
        <div class="field"><label>Tiêu đề</label><input name="bannerTitle" value="${esc(org.bannerTitle)}"/></div>
        <div class="field"><label>Nội dung</label><textarea name="bannerText" rows="3">${esc(org.bannerText)}</textarea></div>
        <button class="btn btn-primary btn-block" type="submit">Lưu banner</button>
      </form>
    </div>

    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Nội dung thông báo qua ứng dụng (App)</h2></div>
      <p class="text-sm text-muted mb-8">
        Tự soạn tiêu đề/nội dung thông báo đẩy gửi cho khách hàng — gõ đúng các TOKEN dưới đây (giữ
        nguyên dấu &lt; &gt;), hệ thống tự thay bằng thông tin thật của từng khách/hợp đồng khi gửi. Áp
        dụng cho CẢ gửi tay (nút "Thông báo cho khách hàng qua ứng dụng") LẪN gửi tự động hàng tháng —
        đổi chữ ở đây là có hiệu lực ngay, không cần sửa code/deploy lại gì.
      </p>
      <div class="field-hint mb-8">
        ${S.PUSH_TEMPLATE_TOKENS.map((t) => `<div><b>${esc(t.token)}</b> — ${esc(t.desc)}</div>`).join('')}
      </div>
      <form id="push-tpl-form">
        <div class="field">
          <label>Tiêu đề (dùng chung cho cả 3 mẫu bên dưới)</label>
          <input name="pushTitle" value="${esc(pt.title)}"/>
        </div>
        <div class="field">
          <label>Nội dung — Báo lãi (hợp đồng còn xa hạn)</label>
          <textarea name="pushInterest" rows="3">${esc(pt.interest)}</textarea>
        </div>
        <div class="field">
          <label>Nội dung — Gần đến hạn</label>
          <textarea name="pushNearDue" rows="3">${esc(pt.nearDue)}</textarea>
        </div>
        <div class="field">
          <label>Nội dung — Đã trễ hạn</label>
          <textarea name="pushOverdue" rows="4">${esc(pt.overdue)}</textarea>
        </div>
        <button type="button" class="btn btn-outline btn-sm btn-block mb-8" id="btn-reset-push-templates">Khôi phục 4 ô trên về mẫu mặc định</button>
        <button class="btn btn-primary btn-block" type="submit">Lưu nội dung thông báo</button>
      </form>
    </div>
  `;

  let bannerEnabled = org.bannerEnabled;
  contentEl.querySelectorAll('[data-enabled]').forEach((opt) => {
    opt.addEventListener('click', () => {
      bannerEnabled = opt.dataset.enabled === 'true';
      contentEl.querySelectorAll('[data-enabled]').forEach((o) => o.classList.toggle('active', o === opt));
    });
  });

  contentEl.querySelector('#org-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await S.updateOrg({ name: fd.get('name'), shortName: fd.get('shortName'), hotline: fd.get('hotline'), address: fd.get('address') });
      toast('Đã lưu thông tin quỹ tín dụng', 'success');
    } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
  });

  contentEl.querySelector('#banner-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await S.updateOrg({ bannerEnabled, bannerTitle: fd.get('bannerTitle'), bannerText: fd.get('bannerText') });
      toast('Đã lưu banner', 'success');
    } catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
  });

  contentEl.querySelector('#btn-reset-push-templates').addEventListener('click', () => {
    const f = contentEl.querySelector('#push-tpl-form');
    f.querySelector('[name="pushTitle"]').value = S.DEFAULT_PUSH_TEMPLATES.title;
    f.querySelector('[name="pushInterest"]').value = S.DEFAULT_PUSH_TEMPLATES.interest;
    f.querySelector('[name="pushNearDue"]').value = S.DEFAULT_PUSH_TEMPLATES.nearDue;
    f.querySelector('[name="pushOverdue"]').value = S.DEFAULT_PUSH_TEMPLATES.overdue;
  });

  contentEl.querySelector('#push-tpl-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await S.updateOrg({
        pushTemplates: {
          title: fd.get('pushTitle').trim() || S.DEFAULT_PUSH_TEMPLATES.title,
          interest: fd.get('pushInterest').trim() || S.DEFAULT_PUSH_TEMPLATES.interest,
          nearDue: fd.get('pushNearDue').trim() || S.DEFAULT_PUSH_TEMPLATES.nearDue,
          overdue: fd.get('pushOverdue').trim() || S.DEFAULT_PUSH_TEMPLATES.overdue,
        },
      });
      toast('Đã lưu nội dung thông báo', 'success');
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
