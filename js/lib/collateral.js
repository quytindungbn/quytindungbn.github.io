/** Mức khấu trừ TSBĐ theo mã trên file số 1; mã khác không phải TSBĐ hợp lệ. */
export function collateralDeductionFactor(contract) {
  if (!contract?.hasCollateral) return 0;
  const type = String(contract.collateralType || '').trim().toUpperCase();
  if (type === '01' || type === '02') return 0.5;
  if (type === '04') return 0.3;
  if (type === '06') return 1;
  return 0;
}

export function specificProvisionForLoan(contract, rate) {
  const balance = Math.max(0, Number(contract.balance) || 0);
  const value = Math.max(0, Number(contract.collateralValue) || 0);
  return Math.max(0, balance - value * collateralDeductionFactor(contract)) * rate;
}
