/** Mức khấu trừ TSBĐ theo mã trên file số 1; mã khác không phải TSBĐ hợp lệ. */
export const SPECIFIC_PROVISION_RATE = Object.freeze({ 2: 0.05, 3: 0.2, 4: 0.5, 5: 1 });
export const GENERAL_PROVISION_RATE = 0.0075;

/** TSBĐ hợp lệ mới nhất của cùng số HĐTD áp dụng cho kỳ cũ. Không suy diễn
 * từ khách hàng và không xóa thông tin kỳ cũ khi hợp đồng hiện tại thiếu TSBĐ. */
export function inheritCurrentCollateral(historical, current) {
  if (!current?.hasCollateral || !['01', '02', '04', '06'].includes(current.collateralType)) return historical;
  return {
    ...historical,
    hasCollateral: true,
    collateralType: current.collateralType,
    collateralValue: Math.max(0, Number(current.collateralValue) || 0),
  };
}

export function collateralDeductionFactor(contract) {
  if (!contract?.hasCollateral) return 0;
  const type = String(contract.collateralType || '').trim().toUpperCase();
  if (type === '01' || type === '02') return 0.5;
  if (type === '04') return 0.3;
  if (type === '06') return 1;
  return 0;
}

export function specificProvisionCalculation(contract, rate) {
  const balance = Math.max(0, Number(contract.balance) || 0);
  const value = Math.max(0, Number(contract.collateralValue) || 0);
  const factor = collateralDeductionFactor(contract);
  const deduction = value * factor;
  const base = Math.max(0, balance - deduction);
  return { balance, value, factor, deduction, base, rate, amount: base * rate };
}

export function specificProvisionForLoan(contract, rate) {
  return specificProvisionCalculation(contract, rate).amount;
}

/** Khôi phục số phải trích từ chi tiết đã chốt khi bản ghi cũ thiếu hai cột tổng. */
export function provisionFromSnapshot(snapshot) {
  if (!snapshot) return null;
  if (Number.isFinite(snapshot.generalProvision) && Number.isFinite(snapshot.specificProvision)) {
    return { generalProvision: snapshot.generalProvision, specificProvision: snapshot.specificProvision };
  }
  const rows = snapshot.contractsDetail;
  if (!Array.isArray(rows) || !rows.length || !snapshot.groupBalances) return null;
  const detailBalance = rows.reduce((sum, row) => sum + (Number(row.balance) || 0), 0);
  if (Math.abs(detailBalance - (Number(snapshot.totalBalance) || 0)) > 1) return null;
  const generalBase = [1, 2, 3, 4].reduce((sum, group) => sum + (Number(snapshot.groupBalances[group]) || 0), 0);
  const specificProvision = rows.reduce((sum, row) => sum + specificProvisionForLoan(row, SPECIFIC_PROVISION_RATE[Number(row.group)] || 0), 0);
  return { generalProvision: generalBase * GENERAL_PROVISION_RATE, specificProvision };
}
