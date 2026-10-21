// Số ngày tính lãi + quy đổi ngược "số ngày" <-> "tính đến ngày" — dùng cho
// state.interestDaysAccrued() và cho 2 ô sửa được (Tính đến ngày / Số ngày lãi)
// ở cửa sổ chi tiết hợp đồng của quản trị. Chỉ gồm hàm thuần (không đụng mạng)
// nên kiểm thử được bằng node (xem tests/interestDays.test.mjs).
import { addDays, daysBetween, startOfDay } from '../utils.js';

/** Số ngày tối đa cho ô "Số ngày lãi" (10 năm) — chặn gõ nhầm số quá lớn. */
export const MAX_INTEREST_DAYS = 3650;

/**
 * Quy ước đặc biệt: "Thu lãi đến ngày" = ngày giải ngân + 1 ngày (thu lãi
 * ngày đầu ngay lúc giải ngân) thì cộng thêm 1 ngày nữa. Trả về 1 hoặc 0.
 */
export function interestBonusDays(contract) {
  const paidUntil = contract.interestPaidUntil || contract.disbursedDate;
  return contract.disbursedDate && daysBetween(new Date(contract.disbursedDate), new Date(paidUntil)) === 1 ? 1 : 0;
}

/**
 * Số ngày tính lãi — tính bình thường (số ngày từ "Thu lãi đến ngày" tới
 * `asOf`), cộng thêm ngày đặc biệt ở trên nếu có.
 * VD: giải ngân 17/08, thu lãi đến ngày 18/08 (= giải ngân + 1), hôm nay
 * 19/08 -> bình thường ra 1 ngày, cộng thêm 1 ngày đặc biệt = 2 ngày.
 */
export function interestDaysBetween(contract, asOf = new Date()) {
  const paidUntil = contract.interestPaidUntil || contract.disbursedDate;
  // LƯU Ý: phải cộng thêm 1 ngày đặc biệt (nếu có) TRƯỚC khi chặn số âm về 0
  // — chặn về 0 trước rồi mới cộng sẽ sai lệch 1 ngày so với thực tế. VD:
  // "Thu lãi đến ngày" 21/08, hôm nay 20/08 (chưa tới ngày đó) -> ra -1 ngày,
  // rơi đúng vào trường hợp đặc biệt (= giải ngân + 1) nên cộng thêm 1 ngày
  // -> -1 + 1 = 0 ngày mới đúng, KHÔNG PHẢI chặn -1 về 0 trước rồi mới +1 = 1.
  return Math.max(0, daysBetween(new Date(paidUntil), asOf) + interestBonusDays(contract));
}

/**
 * Ngược lại với interestDaysBetween(): muốn tính lãi ĐÚNG `days` ngày thì
 * "tính đến ngày" nào (Date, 00:00 giờ địa phương).
 */
export function interestAsOfForDays(contract, days) {
  const paidUntil = contract.interestPaidUntil || contract.disbursedDate;
  const n = Math.max(0, Math.round(Number(days) || 0));
  return addDays(startOfDay(new Date(paidUntil)), n - interestBonusDays(contract));
}
