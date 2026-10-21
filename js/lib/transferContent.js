import { stripDiacritics } from '../utils.js';

// Loại khoản thanh toán -> [nhãn KHÔNG DẤU (đưa vào mã QR), nhãn CÓ DẤU (hiện cho người xem)].
const KINDS = {
  goc: ['TRA GOC', 'Trả gốc'],
  lai: ['TRA LAI', 'Trả lãi'],
  goc_lai: ['TRA GOC LAI', 'Trả gốc và lãi'],
  tat_toan: ['TAT TOAN', 'Tất toán'],
};

/**
 * Nội dung chuyển khoản của một hợp đồng.
 * - `text`: KHÔNG DẤU, in hoa, không ký tự lạ (dấu "/" trong số hợp đồng thành dấu cách) — đúng yêu cầu ngân hàng.
 *   Đây là nội dung nằm trong mã QR, quét vào app ngân hàng là ra đúng chuỗi này.
 * - `shown`: tiếng Việt CÓ DẤU, chỉ để người xem đọc/nhận diện cho dễ (trên ảnh QR, popup, tin chia sẻ); không đi vào mã QR.
 * @param {'goc'|'lai'|'goc_lai'|'tat_toan'} kind
 * @param {{ code?: string }} contract
 * @param {{ name?: string } | null | undefined} customer
 */
export function transferContent(kind, contract, customer) {
  if (!customer) return { text: '', shown: '' };
  const [ascii, vi] = KINDS[kind] || KINDS.lai;
  return {
    text: stripDiacritics(`${ascii} HDTD ${contract.code} ${customer.name}`),
    shown: `${vi} HĐTD ${contract.code} ${customer.name}`.replace(/\s+/g, ' ').trim(),
  };
}
