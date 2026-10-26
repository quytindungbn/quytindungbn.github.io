export function normHeader(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const isCodeHeader = (h) => /(^| )hdtd( |$)/.test(h) || /^so (hd|hop dong|khe uoc)( |$)/.test(h) || h === 'ma hop dong';
const isPhoneHeader = (h) => /(sdt|so dien thoai|dien thoai|so di dong)/.test(h) && /(cung vay|thua ke)/.test(h);

export function parseCoPhoneRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < Math.min(list.length, 15); i++) {
    const cells = (list[i] || []).map(normHeader);
    const codeCol = cells.findIndex(isCodeHeader);
    const phoneCol = cells.findIndex(isPhoneHeader);
    if (codeCol < 0 || phoneCol < 0) continue;
    const items = [];
    for (let r = i + 1; r < list.length; r++) {
      const code = String((list[r] || [])[codeCol] ?? '').trim();
      if (!code) continue;
      items.push({ row: r + 1, code, phone: String((list[r] || [])[phoneCol] ?? '').trim() });
    }
    return { ok: true, items, total: items.length };
  }
  return { ok: false, reason: 'Không thấy cột "Số HĐTD" và cột "SĐT người cùng vay" ở đầu file. Dùng đúng file danh sách đã gửi (dòng đầu là tiêu đề cột).' };
}

export const CO_PHONE_STATUS = {
  added: { label: 'Sẽ thêm số mới', tone: 'ok' },
  replaced: { label: 'Sẽ ghi đè số cũ', tone: 'ok' },
  same: { label: 'Đã có số y hệt', tone: 'muted' },
  conflict: { label: 'Đã lưu số khác — giữ nguyên (không ghi đè)', tone: 'warn' },
  nophone: { label: 'Không có SĐT trong file', tone: 'muted' },
  nocontract: { label: 'Không tìm thấy Số HĐTD trên web', tone: 'warn' },
  settled: { label: 'Hợp đồng đã tất toán', tone: 'muted' },
  noheir: { label: 'Hợp đồng chưa ghi tên người cùng vay', tone: 'warn' },
  badphone: { label: 'SĐT sai định dạng (phải đủ 10 số, bắt đầu bằng 0)', tone: 'warn' },
  samemain: { label: 'Trùng số của người vay — bỏ qua', tone: 'warn' },
  noscope: { label: 'Ngoài địa bàn được phép', tone: 'warn' },
};
