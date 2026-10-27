import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader } from '../components/shell.js';
import { formatVND, formatDate, escapeHtml } from '../utils.js';
import { CW_ORN, cwChip, cwTermPercent, cwTopHtml } from '../components/customerHero.js';

export function renderHeader(headerEl) {
  headerEl.classList.add('cw-off');
  headerEl.innerHTML = pageHeader({ title: 'Trang chủ' });
}

function contractCardHtml(c, info, cls = '') {
  const settled = info.status === 'da_tat_toan';
  return `
      <a href="#/hop-dong/${c.id}" class="cw-card${cls}">
        <div class="cw-ch"><h3>Hợp đồng ${escapeHtml(c.code)}</h3>${cwChip(info)}</div>
        <div class="cw-lbl">Dư nợ hiện tại</div><div class="cw-big">${formatVND(c.balance)}</div>
        <div class="cw-line" style="--p:${cwTermPercent(c, settled)}%"><b></b><i></i></div>
        <div class="cw-g3"><div><small>Số tiền vay</small><b>${formatVND(c.principal)}</b></div><div><small>Ngày vay</small><b>${formatDate(c.disbursedDate)}</b></div><div><small>Ngày đến hạn</small><b>${formatDate(c.dueDate)}</b></div></div>
        <div class="cw-cf"><span>Xem chi tiết →</span></div>
      </a>`;
}

export function render(contentEl) {
  const session = S.getSession();
  const customer = S.getCustomer(session.id);
  const org = S.getOrg();
  const total = S.customerOutstandingTotal(customer.id);
  const active = S.listContractsByCustomer(customer.id).filter((c) => S.effectiveContractStatus(c) !== 'da_tat_toan');

  const RANK = { qua_han: 0, gan_den_han: 1, dang_vay: 2, da_tat_toan: 3 };
  const contracts = S.listContractsByCustomer(customer.id)
    .map((c) => ({ c, info: S.contractStatusInfo(c) }))
    .sort((a, b) => RANK[a.info.status] - RANK[b.info.status] || a.info.days - b.info.days);

  const one = contracts.length === 1;
  const nd = !one && active.length === 1;
  const hotline = String(org.hotline || '').trim();
  const dial = hotline.replace(/[^\d+]/g, '');

  contentEl.classList.add('cw-on');
  contentEl.innerHTML = `
  <div class="cw"><div class="cw-wrap">
    <header class="cw-hero${nd ? ' nd' : ''}">
      ${cwTopHtml(org, customer)}
      <div class="cw-hi"><small>Xin chào,</small><b>${escapeHtml(customer.name)}</b>${CW_ORN}</div>
    </header>
    <div class="cw-main ${one ? 'one' : nd ? 'multi nd' : 'multi'}">
      ${one ? contractCardHtml(contracts[0].c, contracts[0].info, ' cw-feat') : nd ? '' : `<div class="cw-debt"><div class="l">Tổng dư nợ hiện tại (${active.length} hợp đồng)</div><strong>${formatVND(total)}</strong></div>`}
      <div class="cw-quick">
        <a class="cw-qt" href="#/yeu-cau-tu-van"><span class="ico">${icon('plus')}</span><span class="t">Yêu cầu vay mới</span></a>
        ${hotline ? `<a class="cw-qt hl" href="tel:${escapeHtml(dial)}"><span class="ico">${icon('phone')}</span><span class="t"><small>Hotline</small>${escapeHtml(hotline)}</span></a>` : ''}
      </div>
      ${org.bannerEnabled ? `<div class="cw-banner"><b>${escapeHtml(org.bannerTitle)}</b><span>${escapeHtml(org.bannerText)}</span></div>` : ''}
      ${one ? '' : `<div class="cw-sec"><h2>Hợp đồng vay của bạn</h2>${CW_ORN}</div>
      ${contracts.length
    ? `<div class="cw-list">${contracts.map(({ c, info }) => contractCardHtml(c, info)).join('')}</div>`
    : `<div class="cw-empty"><b>Chưa có hợp đồng vay</b>Bạn hiện chưa có hợp đồng vay nào tại quỹ tín dụng.</div>`}`}
      <section class="cw-sup"><h2>Liên hệ hỗ trợ</h2><p class="org">${escapeHtml(org.name)}</p>${CW_ORN}
        ${hotline ? `<div class="cw-sr hl"><span class="ic">${icon('phone')}</span><span class="g"><span class="k">Hotline</span><span class="v">${escapeHtml(hotline)}</span></span><a class="cw-call" href="tel:${escapeHtml(dial)}">${icon('phone')}Gọi</a></div>` : ''}
        <div class="cw-sr ad"><span class="ic">${icon('mapPin')}</span><span class="g"><span class="k">Địa chỉ</span><span class="v">${escapeHtml(org.address)}</span></span></div>
      </section>
    </div>
  </div></div>`;
}
