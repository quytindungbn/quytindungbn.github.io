// Bảng cân đối tài khoản A01/QTDCS: C/D = dư đầu kỳ Nợ/Có, G/H = dư cuối kỳ.
// Chỉ lấy mã tài khoản ở cột B; không cộng các dòng con vào dòng cha lần nữa.
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
      sy !== ey || sm !== em || sd !== 1 || end < start) {
    throw new Error('File phải ghi từ ngày 01 đến một ngày hợp lệ trong cùng tháng.');
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
      name: String(row?.[0] ?? '').trim(),
      startDr: amount(row[2], index + 1, 'C'), startCr: amount(row[3], index + 1, 'D'),
      endDr: amount(row[6], index + 1, 'G'), endCr: amount(row[7], index + 1, 'H'),
    });
  }
  if (![...accounts.keys()].some((code) => /^[123]/.test(code)) ||
      ![...accounts.keys()].some((code) => /^[45678]/.test(code))) {
    throw new Error('File không có đủ tài khoản tài sản và nguồn vốn để kiểm tra cân đối.');
  }
  // Nếu tài khoản cha không xuất hiện, cộng các tài khoản con gần nhất đang có.
  // Tài khoản không phát sinh trong kỳ được coi là 0, không phải lỗi thiếu cột.
  const account = (code) => {
    if (accounts.has(code)) return accounts.get(code);
    const children = [...accounts.keys()].filter((child) => child.startsWith(code) && child.length > code.length);
    const roots = children.filter((child) => !children.some((parent) =>
      parent.length < child.length && child.startsWith(parent)));
    if (!roots.length) return null;
    return roots.reduce((sum, child) => {
      const row = accounts.get(child);
      return {
        startDr: sum.startDr + row.startDr, startCr: sum.startCr + row.startCr,
        endDr: sum.endDr + row.endDr, endCr: sum.endCr + row.endCr,
      };
    }, { startDr: 0, startCr: 0, endDr: 0, endCr: 0 });
  };
  const metrics = (prefix) => {
    const debit = (code) => { const a = account(code); return a ? a[`${prefix}Dr`] - a[`${prefix}Cr`] : 0; };
    const credit = (code) => {
      const value = -debit(code);
      return value === 0 ? 0 : value;
    };
    // Chọn tài khoản chi tiết nhất tới cấp yêu cầu; không cộng lại dòng cha.
    const breakdown = (prefixes, level, balance, total, excluded = []) => {
      const candidates = new Set([...accounts.keys()]
        .map((code) => code.split('.')[0])
        .filter((code) => /^\d+$/.test(code) && prefixes.some((root) => code.startsWith(root)))
        .map((code) => code.slice(0, Math.min(code.length, level))));
      const codes = [...candidates].filter((code) =>
        ![...candidates].some((child) => child.length > code.length && child.startsWith(code)));
      const lines = codes.filter((code) => !excluded.some((root) => code.startsWith(root)))
        .sort().map((code) => ({
          code, name: accounts.get(code)?.name || '', balance: balance(code),
          incomplete: code.length < level,
        })).filter((line) => line.balance !== 0);
      const remainder = total - lines.reduce((sum, line) => sum + line.balance, 0);
      if (remainder) lines.push({
        code: prefixes.join('/'), name: 'Phần chưa có tài khoản chi tiết trong file',
        balance: remainder, residual: true,
      });
      return lines;
    };
    const expandDetail = (lines, parentCode, childCodes) => {
      const index = lines.findIndex((line) => line.code === parentCode);
      if (index < 0) return;
      const existing = childCodes.filter((code) => [...accounts.keys()].some((key) => key === code || key.startsWith(code + '.')));
      if (!existing.length) { lines[index].incomplete = true; return; }
      const parentBalance = lines[index].balance;
      const children = existing.map((code) => ({
        code, name: accounts.get(code)?.name || '', balance: credit(code),
      })).filter((line) => line.balance !== 0);
      const remainder = parentBalance - children.reduce((sum, line) => sum + line.balance, 0);
      if (remainder) children.push({
        code: parentCode, name: `Phần TK ${parentCode} chưa có tài khoản con trong file`,
        balance: remainder, residual: true,
      });
      lines.splice(index, 1, ...children);
    };
    const assets = debit('1') + debit('2') + debit('3');
    const liabilities = credit('4') + credit('5') + credit('6') + credit('7') - debit('8');
    const totalProvision = credit('219');
    const generalProvision = credit('2192');
    const specificProvision = credit('2191');
    const otherProvision = totalProvision - generalProvision - specificProvision;
    const loanPrefixes = [...new Set([...accounts.keys()]
      .filter((code) => /^21[0-8]/.test(code)).map((code) => code.slice(0, 3)))];
    const grossLoans = loanPrefixes.length
      ? loanPrefixes.reduce((sum, code) => sum + debit(code), 0)
      : debit('21') + totalProvision;
    if (assets !== liabilities) throw new Error(`Số dư ${prefix === 'start' ? 'đầu' : 'cuối'} kỳ lệch ${Math.abs(assets - liabilities).toLocaleString('vi-VN')} đồng giữa tài sản và nguồn vốn.`);
    if (otherProvision < 0 || grossLoans < totalProvision) {
      throw new Error('Tài khoản 219 và các tài khoản dự phòng con không khớp; cần kiểm tra số dư dự phòng.');
    }
    const cash = debit('101');
    const tctdDeposits = debit('13');
    const tctdDemand = debit('1311');
    const tctdTerm = debit('1312');
    const nhHtxDemand = debit('1311101');
    const nhHtxTerm = debit('13121');
    const otherTctdDemand = debit('13119');
    const loanNet = grossLoans - totalProvision;
    const fixedAssetsGross = debit('301');
    const accumulatedDepreciation = credit('305');
    const fixedAssetsNet = fixedAssetsGross - accumulatedDepreciation;
    const capitalContribution = debit('344');
    const fixedCapital = fixedAssetsNet + capitalContribution;
    const internalReceivables = debit('36');
    const accruedReceivables = debit('391') + debit('394');
    const otherAssets = assets - cash - tctdDeposits - loanNet - fixedCapital - internalReceivables - accruedReceivables;
    const customerDeposits = credit('423');
    const interestPayable = credit('49');
    const equity = credit('6');
    const equityParts = ['601', '611', '612', '613'].some((code) => account(code)) ? {
      charterCapital: credit('601'),
      supplementaryReserve: credit('611'),
      developmentReserve: credit('612'),
      financialReserve: credit('613'),
    } : null;
    if (equityParts) equityParts.otherEquity = equity - Object.values(equityParts).reduce((sum, value) => sum + value, 0);
    const revenue = credit('7');
    const expenses = debit('8');
    const profit = revenue - expenses;
    const otherLiabilities = liabilities - customerDeposits - interestPayable - equity - profit;
    if (otherAssets < 0 || otherLiabilities < 0) throw new Error('Các khoản mục chi tiết vượt tổng tài sản hoặc nguồn vốn.');
    const accountDetails = {
      internalReceivables: breakdown(['36'], 4, debit, internalReceivables),
      otherLiabilities: breakdown(['4', '5'], 3, credit, otherLiabilities, ['423', '49']),
      equityOther: breakdown(['6'], 3, credit, equity).filter((line) => line.residual ||
        (line.code !== '6' && !['601', '611', '612', '613'].some((code) => line.code.startsWith(code)))),
    };
    expandDetail(accountDetails.otherLiabilities, '484', ['4841', '4842']);
    const accountCodes = [...accounts.keys()];
    // Một số mẫu A01 dùng 469.01 cho lợi tức vốn góp; xử lý như nhánh 461.
    for (const parentCode of ['461', '469']) {
      const children = accountCodes.filter((code) => code.startsWith(parentCode) && code.length > parentCode.length &&
        !accountCodes.some((child) => child.length > code.length && child.startsWith(code))).sort();
      expandDetail(accountDetails.otherLiabilities, parentCode, children);
    }
    return { assets, liabilities, cash, tctdDeposits, tctdDemand, tctdTerm,
      nhHtxDemand, nhHtxTerm, otherTctdDemand, liquidity: cash + tctdDeposits,
      grossLoans, totalProvision, generalProvision, specificProvision, otherProvision, loanNet, fixedCapital,
      fixedAssetsGross, accumulatedDepreciation, fixedAssetsNet, capitalContribution,
      internalReceivables, accruedReceivables, otherAssets, customerDeposits,
      interestPayable, equity, equityParts, revenue, expenses, profit, otherLiabilities, accountDetails };
  };
  return { ...period, start: metrics('start'), end: metrics('end') };
}
