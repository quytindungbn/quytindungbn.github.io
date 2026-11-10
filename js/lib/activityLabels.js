import { formatVND, formatDate } from '../utils.js';

const ORG_FIELD_LABELS = {
  name: 'tên quỹ', shortName: 'tên rút gọn', hotline: 'hotline', address: 'địa chỉ',
  bannerEnabled: 'banner', bannerTitle: 'banner', bannerText: 'banner',
  zaloTemplateDueId: 'mẫu Zalo', zaloTemplateInterestId: 'mẫu Zalo', zaloNearDueDays: 'số ngày "gần đến hạn"', pushTemplates: 'mẫu thông báo',
};

export function describeOrgPatch(patch) {
  const names = [];
  for (const key of Object.keys(patch || {})) {
    const label = ORG_FIELD_LABELS[key] || key;
    if (!names.includes(label)) names.push(label);
  }
  return names.join(', ');
}

export function trailText(value, max = 60) {
  const t = String(value ?? '').replace(/[*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function clipLabel(label, max = 200) {
  let t = String(label ?? '').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = `${t.slice(0, max - 1).trimEnd()}…`;
  if ((t.match(/\*\*/g) || []).length % 2) t = t.replace(/\*\*(?![\s\S]*\*\*)/, '');
  return t;
}

export function trailList(values, shown = 3) {
  const list = (values || []).map((v) => trailText(v, 30)).filter(Boolean);
  return list.length <= shown ? list.join(', ') : `${list.slice(0, shown).join(', ')} và ${list.length - shown} nơi khác`;
}

export function describeThonXom(thon, xom) {
  const parts = [];
  if (thon && thon.length) parts.push(`Thôn: **${trailList(thon)}**`);
  if (xom && xom.length) parts.push(`Xóm: **${trailList(xom)}**`);
  return parts.length ? `lọc ${parts.join(' · ')}` : 'bỏ lọc Thôn/Xóm';
}

export function describeDateRange(from, to) {
  const fmt = (v) => formatDate(new Date(`${v}T00:00:00`));
  if (from && to) return `lọc từ ngày **${fmt(from)}** đến ngày **${fmt(to)}**`;
  if (from) return `lọc từ ngày **${fmt(from)}**`;
  if (to) return `lọc đến ngày **${fmt(to)}**`;
  return 'bỏ lọc theo ngày';
}

export function describeSearch(where, query) {
  const text = trailText(query);
  return text ? `${where}: tìm **${text}**` : '';
}

const METHOD_LABELS = { equalPrincipal: 'Gốc trả đều mỗi tháng', annuity: 'Gốc + lãi trả đều mỗi tháng', bullet: 'Lãi hàng tháng, gốc cuối kỳ' };
const KIND_LABELS = { gocLai: 'Gồm cả gốc và lãi', goc: 'Chỉ tiền gốc, lãi cộng thêm' };
const rateText = (n) => String(Number(n)).replace('.', ',');

export function describeLoanCalc(inputs) {
  if (!inputs) return 'Bấm "Tính lãi" ở trang Tính lãi vay (chưa đủ số liệu)';
  const head = `vay **${formatVND(inputs.principal)}**, lãi suất **${rateText(inputs.ratePercent)}%/năm**`;
  if (inputs.tab === 'pay') {
    return `Tính lãi vay theo số tiền trả hàng tháng: ${head}, trả **${formatVND(inputs.payment)}** mỗi tháng (${(KIND_LABELS[inputs.kind] || '').toLowerCase()})${inputs.endDate ? `, đáo hạn **${formatDate(inputs.endDate)}**` : ''}`;
  }
  const term = inputs.endDate ? `đến ngày **${formatDate(inputs.endDate)}**` : `**${inputs.months} tháng**`;
  const fixed = inputs.fixedAmount > 0 ? `, ${formatVND(inputs.fixedAmount)}/tháng` : '';
  return `Tính lãi vay theo thời hạn: ${head}, ${term}, ${(METHOD_LABELS[inputs.method] || '').toLowerCase()}${fixed}`;
}
