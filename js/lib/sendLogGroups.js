// Lịch sử gửi tin Zalo OA: 1 lần gửi cho 2 người (người vay + người cùng vay) máy chủ ghi thành 2 dòng log (mỗi người 1 dòng, cách nhau vài mili-giây).
// Màn hình gộp lại thành 1 DÒNG cho mỗi lần gửi. Hàm thuần — có bài kiểm thử riêng (tests/sendLogGroups.test.mjs).
import { samePhone } from './coBorrower.js';

/** Hai dòng log gần nhau trong khoảng này (mili-giây), cùng hợp đồng + loại tin + cách gửi, khác số điện thoại → cùng 1 lần gửi. */
export const SEND_GROUP_WINDOW_MS = 120000;

const timeOf = (l) => new Date(l.sentAt).getTime() || 0;

/**
 * Gộp các dòng log thành từng "lần gửi". Cùng 1 lần gửi khi: cùng hợp đồng (và khách), cùng loại tin (đến hạn/báo lãi), cùng cách gửi (tự động/gửi tay + người bấm),
 * gửi cách nhau không quá `windowMs` so với dòng MỚI NHẤT của lần gửi đó, và gửi tới SỐ KHÁC NHAU (gửi lại cùng 1 số là lần gửi khác).
 * Trả về các lần gửi mới → cũ: { key, time (mili-giây của dòng mới nhất), logs: [các dòng log của lần gửi đó] }.
 */
export function groupSendLogs(logs, windowMs = SEND_GROUP_WINDOW_MS) {
  const sorted = [...(logs || [])].sort((a, b) => timeOf(b) - timeOf(a));
  const open = new Map(); // key → lần gửi đang mở (mới nhất của key đó)
  const out = [];
  for (const l of sorted) {
    const key = [l.customerId || '', l.contractId || '', l.kind || '', l.triggeredBy || '', l.triggeredByAdminId || ''].join('|');
    const g = open.get(key);
    if (g && g.time - timeOf(l) <= windowMs && !g.logs.some((x) => samePhone(x.phone, l.phone) || (!x.phone && !l.phone))) g.logs.push(l);
    else {
      const ng = { key, time: timeOf(l), logs: [l] };
      open.set(key, ng);
      out.push(ng);
    }
  }
  return out;
}
