import { formatVND, formatDate } from '../utils.js';

// Câu mô tả ngắn cho Nhật ký sử dụng khi quản trị viên thao tác ở phía trình duyệt (gửi qua state.logUiAction). Hàm thuần, kiểm thử: tests/activityLabels.test.mjs.
// Dấu **...** đánh dấu phần giá trị chính (in đậm trong trang Nhật ký, xem renderLogDescription ở js/views/admin/logs.js).

const ORG_FIELD_LABELS = {
  name: 'tên quỹ', shortName: 'tên rút gọn', hotline: 'hotline', address: 'địa chỉ',
  bannerEnabled: 'banner', bannerTitle: 'banner', bannerText: 'banner',
  zaloTemplateDueId: 'mẫu Zalo', zaloTemplateInterestId: 'mẫu Zalo', zaloNearDueDays: 'số ngày "gần đến hạn"', pushTemplates: 'mẫu thông báo',
};
/** "tên quỹ, hotline, banner" — liệt kê các mục cài đặt vừa sửa (không ghi giá trị), bỏ trùng. */
export function describeOrgPatch(patch) {
  const names = [];
  for (const key of Object.keys(patch || {})) {
    const label = ORG_FIELD_LABELS[key] || key;
    if (!names.includes(label)) names.push(label);
  }
  return names.join(', ');
}

// Nhãn cách trả / loại số tiền — chép từ js/lib/loanCalcExport.js (METHOD_LABELS, KIND_LABELS) để file này nhẹ: state.js nạp nó ngay lúc mở ứng dụng.
const METHOD_LABELS = { equalPrincipal: 'Gốc trả đều mỗi tháng', annuity: 'Gốc + lãi trả đều mỗi tháng', bullet: 'Lãi hàng tháng, gốc cuối kỳ' };
const KIND_LABELS = { gocLai: 'Gồm cả gốc và lãi', goc: 'Chỉ tiền gốc, lãi cộng thêm' };
const rateText = (n) => String(Number(n)).replace('.', ',');
/** Mô tả lần bấm "Tính lãi" ở trang Tính lãi vay: số vay, lãi suất và thời hạn / số tiền trả hàng tháng. */
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
