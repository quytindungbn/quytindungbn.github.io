// Phân kỳ trả nợ theo năm — phần thuần (không đụng DOM/mạng) để kiểm thử bằng node, xem tests/installmentPlan.test.mjs.
// computeInstallmentPlan() trong js/state.js (và 2 bản sao trong supabase/functions) gọi các hàm này.

/**
 * File nhập ghi số tiền = 0 cho kỳ ĐÃ TRẢ ĐỦ, và lúc lưu năm có số 0 bị bỏ — nên một hợp đồng phân kỳ 2027/2028/2029 đã
 * trả xong kỳ 2027 chỉ còn lưu 2028 và 2029. Nếu để vậy, tiền đã trả của kỳ 2027 bị tính nhầm vào kỳ 2028 và "Kỳ tới"
 * nhảy qua luôn kỳ 2028 (kỳ vẫn còn phải trả).
 *
 * Khôi phục kỳ đã trả đó khi nhận ra được CHẮC CHẮN: kỳ đầu còn lưu rơi đúng vào năm giải ngân + 2 (thiếu đúng 1 năm
 * ở đầu), và tổng các kỳ còn lưu nhỏ hơn số tiền vay (phần thiếu = số tiền của kỳ đã trả), đồng thời phần thiếu đó
 * không vượt quá số gốc đã trả. Không đủ điều kiện (thiếu từ 2 năm trở lên không biết chia ra sao, hoặc tổng kỳ khớp
 * số vay) thì giữ nguyên, không đoán.
 *
 * @param {{year:number, amount:number}[]} entries các kỳ còn lưu, đã sắp xếp theo năm
 * @param {{principal:number, balance:number, disbursedYear:number}} info
 * @returns {{year:number, amount:number, restored?:boolean}[]} danh sách kỳ (có thể thêm 1 kỳ đầu đã khôi phục)
 */
export function restoreLeadingInstallment(entries, { principal, balance, disbursedYear }) {
  if (!entries.length || !Number.isFinite(disbursedYear)) return entries;
  const amountPaid = (Number(principal) || 0) - (Number(balance) || 0);
  const missing = (Number(principal) || 0) - entries.reduce((sum, e) => sum + e.amount, 0);
  if (entries[0].year === disbursedYear + 2 && missing > 0 && missing <= amountPaid) {
    return [{ year: disbursedYear + 1, amount: missing, restored: true }, ...entries];
  }
  return entries;
}

/**
 * Gộp phân kỳ lấy từ file mới vào phân kỳ đã lưu: GIỮ NGUYÊN các kỳ cũ đứng trước kỳ có số tiền đầu tiên của file mới
 * (kỳ đã trả đủ nên file ghi 0), còn từ kỳ đó trở đi lấy đúng theo file mới. `incoming` chỉ chứa năm có số tiền > 0.
 * Dùng ở máy chủ khi nhập file (supabase/functions/create-account) — để ở đây cho kiểm thử được.
 */
export function mergeInstallmentSchedule(existing, incoming) {
  const years = Object.keys(incoming || {}).map(Number).filter(Number.isFinite);
  if (!years.length) return existing || null;
  const firstYear = Math.min(...years);
  const merged = {};
  for (const [year, amount] of Object.entries(existing || {})) {
    if (Number(year) < firstYear && Number(amount) > 0) merged[year] = Number(amount);
  }
  for (const [year, amount] of Object.entries(incoming)) merged[year] = amount;
  return merged;
}
