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
