import * as S from '../state.js';
import { icon } from '../icons.js';
import { toast } from '../components/toast.js';
import { openModal } from '../components/modal.js';
import { autoSubscribeIfPossible } from '../lib/push.js';
import { isStandalone } from '../lib/installPwa.js';
import { bindInstallButton } from '../components/installBtn.js';

let mode = 'customer';

export function renderLogin(root, onLoggedIn) {
  const org = S.getOrg();
  root.innerHTML = `
    <div class="login-wrap${!isStandalone() ? ' has-install' : ''}">
      ${!isStandalone() ? `<button type="button" class="login-install" id="btn-install-shortcut">${icon('download', 'icon-sm')}<span>Cài đặt ứng dụng</span></button>` : ''}
      <div class="login-card">
        <div class="logo-mark">${icon('landmark', 'icon-lg')}</div>
        <h1 style="text-align:center;font-size:18px;margin-bottom:4px">${org.name}</h1>
        <p style="text-align:center;font-size:12.5px;color:var(--text-muted);margin-bottom:20px">Cổng tra cứu khoản vay dành cho khách hàng</p>

        <div class="tabs mb-16">
          <button data-mode="customer" class="${mode === 'customer' ? 'active' : ''}">Khách hàng</button>
          <button data-mode="admin" class="${mode === 'admin' ? 'active' : ''}">Quản trị viên</button>
        </div>

        <form id="login-form">
          <div class="field" id="field-primary">
            <label id="label-primary">Số CCCD hoặc SĐT</label>
            <input name="primary" id="input-primary" required inputmode="numeric" autocomplete="username" placeholder="Nhập số CCCD hoặc SĐT của bạn"/>
          </div>
          <div class="field">
            <label>Mật khẩu</label>
            <input name="password" type="password" required autocomplete="current-password" placeholder="Nhập mật khẩu"/>
          </div>
          <div class="field-error" id="login-error" style="display:none;margin-bottom:10px"></div>
          <button class="btn btn-primary btn-block" type="submit">${icon('lock', 'icon-sm')} Đăng nhập</button>
        </form>
        <button id="btn-forgot" style="display:${mode === 'customer' ? 'block' : 'none'};background:none;border:none;color:var(--color-primary);font-size:13px;margin:14px auto 0;cursor:pointer">Quên mật khẩu?</button>
      </div>
    </div>
  `;

  function updateMode() {
    root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    const isAdmin = mode === 'admin';
    root.querySelector('#label-primary').textContent = isAdmin ? 'Tên đăng nhập' : 'Số CCCD hoặc SĐT';
    root.querySelector('#input-primary').placeholder = isAdmin ? 'Nhập tên đăng nhập quản trị' : 'Nhập số CCCD hoặc SĐT của bạn';
    root.querySelector('#input-primary').inputMode = isAdmin ? 'text' : 'numeric';

    root.querySelector('#btn-forgot').style.display = isAdmin ? 'none' : 'block';
  }
  updateMode();

  root.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => { mode = btn.dataset.mode; updateMode(); });
  });

  root.querySelector('#btn-forgot').addEventListener('click', () => openForgotPasswordModal());

  const installBtn = root.querySelector('#btn-install-shortcut');
  if (installBtn) bindInstallButton(installBtn);

  root.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const primary = fd.get('primary').trim();
    const password = fd.get('password');
    root.querySelector('#login-error').style.display = 'none';

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      if (mode === 'admin') {
        const res = await S.loginAdmin(primary, password);
        if (!res.ok) {
          const err = root.querySelector('#login-error');
          if (err) { err.textContent = res.reason; err.style.display = 'block'; }
          return;
        }
        S.setSession({ role: 'admin', id: res.adminId, sbToken: res.sbToken });
        toast('Đăng nhập thành công', 'success');
        autoSubscribeIfPossible(res.sbToken);
        onLoggedIn();
      } else {
        const res = await S.loginCustomer(primary, password);
        if (!res.ok) {
          const err = root.querySelector('#login-error');
          if (err) { err.textContent = res.reason; err.style.display = 'block'; }
          return;
        }
        S.setSession({ role: 'customer', id: res.customerId, mustChangePassword: res.mustChangePassword, sbToken: res.sbToken });
        toast('Đăng nhập thành công', 'success');
        autoSubscribeIfPossible(res.sbToken);
        onLoggedIn();
      }
    } finally {
      const btn = root.querySelector('#login-form button[type="submit"]');
      if (btn) btn.disabled = false;
    }
  });
}

function openForgotPasswordModal() {
  const close = openModal({
    title: 'Quên mật khẩu',
    bodyHtml: `
      <p class="text-sm text-muted mb-8">Nhập đúng số CCCD và số điện thoại đã đăng ký để lấy lại tài khoản. Quỹ tín dụng sẽ gọi điện xác minh và cấp lại mật khẩu qua số điện thoại này.</p>
      <div class="field"><label>Số CCCD</label><input id="forgot-cccd" inputmode="numeric" placeholder="Nhập số CCCD"/></div>
      <div class="field"><label>Số điện thoại</label><input id="forgot-phone" inputmode="numeric" placeholder="Nhập số điện thoại đã đăng ký"/></div>
      <div class="field-error" id="forgot-error" style="display:none;margin-bottom:10px"></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-confirm>Gửi yêu cầu</button>`,
    onMount(sheet, closeFn) {
      sheet.querySelector('[data-confirm]').addEventListener('click', async () => {
        const cccd = sheet.querySelector('#forgot-cccd').value.trim();
        const phone = sheet.querySelector('#forgot-phone').value.trim();
        const errEl = sheet.querySelector('#forgot-error');
        if (!cccd || !phone) {
          errEl.textContent = 'Nhập đủ số CCCD và số điện thoại.';
          errEl.style.display = 'block';
          return;
        }
        errEl.style.display = 'none';
        const btn = sheet.querySelector('[data-confirm]');
        btn.disabled = true;
        try {
          const res = await S.requestPasswordReset(cccd, phone);
          if (!res.ok) {
            errEl.textContent = res.reason || 'Có lỗi xảy ra, thử lại sau.';
            errEl.style.display = 'block';
            return;
          }
          closeFn();
          toast('Đã ghi nhận yêu cầu. Quỹ tín dụng sẽ gọi điện lại để cấp mật khẩu mới trong thời gian sớm nhất.', 'success');
        } finally {
          btn.disabled = false;
        }
      });
    },
  });
  return close;
}
