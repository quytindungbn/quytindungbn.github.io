/** Mức khấu trừ TSBĐ theo mã trên file số 1; mã khác không phải TSBĐ hợp lệ. */
export const SPECIFIC_PROVISION_RATE = Object.freeze({ 2: 0.05, 3: 0.2, 4: 0.5, 5: 1 });

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
