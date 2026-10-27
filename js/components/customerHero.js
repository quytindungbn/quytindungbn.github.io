import { icon } from '../icons.js';
import { escapeHtml, initials, daysBetween } from '../utils.js';

export const CW_ORN = '<div class="orn"><i></i></div>';

export function cwStatusClass(info) {
  return { qua_han: 'bad', gan_den_han: '', dang_vay: 'ok', da_tat_toan: 'done' }[info.status] ?? 'ok';
}

export function cwTermPercent(contract, settled = false) {
  if (settled) return 100;
  const total = daysBetween(new Date(contract.disbursedDate), new Date(contract.dueDate));
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((daysBetween(new Date(contract.disbursedDate), new Date()) / total) * 100)));
}

export function cwTopHtml(org, customer) {
  return `<div class="cw-top"><span class="cw-brand"><span class="lg"><img src="icons/logo-pcf.png" alt=""></span>${escapeHtml(org.shortName || org.name || '')}</span><span class="cw-av" aria-hidden="true">${escapeHtml(initials(customer.name))}</span></div>`;
}

export const cwChip = (info) => `<span class="cw-st ${cwStatusClass(info)}"><i></i>${escapeHtml(info.label)}</span>`;

export const cwIc = (name) => icon(name, 'icon-sm');
