// Bảng cân đối tài khoản A01/QTDCS: C/D = dư đầu kỳ Nợ/Có, G/H = dư cuối kỳ.
// Chỉ lấy mã tài khoản ở cột B; không cộng các dòng con vào dòng cha lần nữa.
const REQUIRED = ['1', '2', '3', '4', '6', '7', '8', '101', '13', '211', '212', '219', '2191', '2192', '423'];

function amount(value, row, column) {
  if (value == null || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[,.\s]/g, ''));
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Giá trị không hợp lệ tại dòng ${row}, cột ${column}.`);
  return n;
}

function periodFromRows(rows) {
  const heading = rows.slice(0, 12).map((row) => String(row?.[0] || '')).join(' ');
  const match = heading.match(/Từ ngày\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*đến ngày\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!match) throw new Error('Không tìm thấy khoảng ngày báo cáo trong tiêu đề file.');
  const [, sd, sm, sy, ed, em, ey] = match.map((x, i) => i ? Number(x) : x);
  const start = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  if (start.getUTCFullYear() !== sy || start.getUTCMonth() !== sm - 1 || start.getUTCDate() !== sd ||
      end.getUTCFullYear() !== ey || end.getUTCMonth() !== em - 1 || end.getUTCDate() !== ed ||
      sy !== ey || sm !== em || sd !== 1 || ed !== new Date(Date.UTC(ey, em, 0)).getUTCDate()) {
    throw new Error('File phải ghi đúng trọn một tháng, từ ngày 01 đến ngày cuối tháng.');
  }
  return { yearMonth: `${ey}-${String(em).padStart(2, '0')}`, periodEnd: end.toISOString().slice(0, 10) };
}

/** Chuyển sheet đầu tiên của file A01/QTDCS thành số liệu đã kiểm tra cân đối. */
export function parseBalanceSheetRows(rows) {
  if (!Array.isArray(rows) || rows.length < 20) throw new Error('File bảng cân đối không có đủ dữ liệu.');
  const period = periodFromRows(rows);
  const accounts = new Map();
  for (const [index, row] of rows.entries()) {
    const code = String(row?.[1] ?? '').trim();
    if (!/^\d+(?:\.\d+)?$/.test(code)) continue;
    if (accounts.has(code)) throw new Error(`Mã tài khoản ${code} xuất hiện nhiều lần.`);
    accounts.set(code, {
      startDr: amount(row[2], index + 1, 'C'), startCr: amount(row[3], index + 1, 'D'),
      endDr: amount(row[6], index + 1, 'G'), endCr: amount(row[7], index + 1, 'H'),
    });
  }
  for (const code of REQUIRED) if (!accounts.has(code)) throw new Error(`Thiếu tài khoản ${code} trong file.`);
  const metrics = (prefix) => {
    const debit = (code) => { const a = accounts.get(code); return a ? a[`${prefix}Dr`] - a[`${prefix}Cr`] : 0; };
    const credit = (code) => -debit(code);
    const assets = debit('1') + debit('2') + debit('3');
    const liabilities = credit('4') + credit('5') + credit('6') + credit('7') - debit('8');
    const generalProvision = credit('2192');
    const specificProvision = credit('2191');
    const grossLoans = debit('211') + debit('212');
    if (assets !== liabilities) throw new Error(`Số dư ${prefix === 'start' ? 'đầu' : 'cuối'} kỳ lệch ${Math.abs(assets - liabilities).toLocaleString('vi-VN')} đồng giữa tài sản và nguồn vốn.`);
    if (credit('219') !== generalProvision + specificProvision || debit('2') !== grossLoans - credit('219')) {
      throw new Error('Tài khoản 2/219/2191/2192 không khớp; cần kiểm tra số dư dự phòng.');
    }
    const cash = debit('101');
    const tctdDeposits = debit('13');
    const tctdDemand = debit('1311');
    const tctdTerm = debit('1312');
    const nhHtxDemand = debit('1311101');
    const nhHtxTerm = debit('13121');
    const otherTctdDemand = debit('13119');
    const loanNet = grossLoans - generalProvision - specificProvision;
    const fixedCapital = debit('301') - credit('305') + debit('344');
    const internalReceivables = debit('361');
    const accruedReceivables = debit('391') + debit('394');
    const otherAssets = assets - cash - tctdDeposits - loanNet - fixedCapital - internalReceivables - accruedReceivables;
    const customerDeposits = credit('423');
    const interestPayable = credit('49');
    const equity = credit('6');
    const equityParts = ['601', '611', '612', '613'].every((code) => accounts.has(code)) ? {
      charterCapital: credit('601'),
      supplementaryReserve: credit('611'),
      developmentReserve: credit('612'),
      financialReserve: credit('613'),
    } : null;
    if (equityParts) equityParts.otherEquity = equity - Object.values(equityParts).reduce((sum, value) => sum + value, 0);
    const profit = credit('7') - debit('8');
    const otherLiabilities = liabilities - customerDeposits - interestPayable - equity - profit;
    if (otherAssets < 0 || otherLiabilities < 0) throw new Error('Các khoản mục chi tiết vượt tổng tài sản hoặc nguồn vốn.');
    return { assets, liabilities, cash, tctdDeposits, tctdDemand, tctdTerm,
      nhHtxDemand, nhHtxTerm, otherTctdDemand, liquidity: cash + tctdDeposits,
      grossLoans, generalProvision, specificProvision, loanNet, fixedCapital,
      internalReceivables, accruedReceivables, otherAssets, customerDeposits,
      interestPayable, equity, equityParts, profit, otherLiabilities };
  };
  return { ...period, start: metrics('start'), end: metrics('end') };
}
