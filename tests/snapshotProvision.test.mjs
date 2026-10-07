import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionFromSnapshot } from '../js/lib/collateral.js';

test('bản chốt có số dự phòng dùng đúng số đã lưu', () => {
  assert.deepEqual(provisionFromSnapshot({ generalProvision: 125, specificProvision: 50 }),
    { generalProvision: 125, specificProvision: 50 });
});

test('bản chốt cũ có đủ chi tiết tính lại theo nhóm nợ và TSBĐ', () => {
  const snapshot = {
    totalBalance: 1_200_000_000,
    groupBalances: { 1: 500_000_000, 2: 700_000_000 },
    contractsDetail: [
      { group: 1, balance: 500_000_000 },
      { group: 2, balance: 700_000_000, hasCollateral: true, collateralType: '02', collateralValue: 1_000_000_000 },
    ],
  };
  assert.deepEqual(provisionFromSnapshot(snapshot), { generalProvision: 9_000_000, specificProvision: 10_000_000 });
});

test('chi tiết thiếu không được nhận là số phải trích của cả quỹ', () => {
  assert.equal(provisionFromSnapshot({
    totalBalance: 1_200_000_000, groupBalances: { 1: 500_000_000 },
    contractsDetail: [{ group: 1, balance: 500_000_000 }],
  }), null);
});
