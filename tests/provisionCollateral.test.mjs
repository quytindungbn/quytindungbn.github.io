import test from 'node:test';
import assert from 'node:assert/strict';
import { specificProvisionForLoan, specificProvisionCalculation, SPECIFIC_PROVISION_RATE } from '../js/lib/collateral.js';

const contract = (type, balance, value) => ({
  balance, collateralType: type, collateralValue: value, hasCollateral: ['01', '02', '04', '06'].includes(type),
});

test('mã 01/02 khấu trừ 50%; phần dư nợ vượt giá trị khấu trừ mới trích theo nhóm 2', () => {
  assert.equal(specificProvisionForLoan(contract('02', 500_000_000, 1_000_000_000), 0.05), 0);
  assert.equal(specificProvisionForLoan(contract('02', 700_000_000, 1_000_000_000), 0.05), 10_000_000);
  assert.equal(specificProvisionForLoan(contract('01', 700_000_000, 1_000_000_000), 0.05), 10_000_000);
});

test('chi tiết từng món đối chiếu đúng số dự phòng cụ thể phải trích', () => {
  const calculation = specificProvisionCalculation(contract('02', 700_000_000, 1_000_000_000), SPECIFIC_PROVISION_RATE[2]);
  assert.equal(calculation.factor, 0.5);
  assert.equal(calculation.deduction, 500_000_000);
  assert.equal(calculation.base, 200_000_000);
  assert.equal(calculation.amount, 10_000_000);
  assert.equal(calculation.amount, specificProvisionForLoan(contract('02', 700_000_000, 1_000_000_000), SPECIFIC_PROVISION_RATE[2]));
});

test('ô tô khấu trừ 30%, sổ tiết kiệm 100%; mã khác và thiếu mã không khấu trừ', () => {
  assert.equal(specificProvisionForLoan(contract('04', 700_000_000, 1_000_000_000), 0.2), 80_000_000);
  assert.equal(specificProvisionForLoan(contract('06', 700_000_000, 1_000_000_000), 0.5), 0);
  assert.equal(specificProvisionForLoan(contract('08', 700_000_000, 1_000_000_000), 1), 700_000_000);
  assert.equal(specificProvisionForLoan({ ...contract(null, 700_000_000, 1_000_000_000), hasCollateral: true }, 0.05), 35_000_000);
});
