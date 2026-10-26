import test from 'node:test';
import assert from 'node:assert/strict';
import { contractSeq, compareContractsNewestFirst } from '../js/lib/contractOrder.js';

test('contractSeq: "461/26" → số thứ tự 461, năm 26; số 0 đứng đầu và dạng không có năm', () => {
  assert.deepEqual(contractSeq('461/26'), { seq: 461, year: 26 });
  assert.deepEqual(contractSeq(' 09/26 '), { seq: 9, year: 26 });
  assert.deepEqual(contractSeq('1204/25'), { seq: 1204, year: 25 });
  assert.deepEqual(contractSeq('77'), { seq: 77, year: -1 });
  assert.deepEqual(contractSeq('KU-1'), { seq: -1, year: -1 });
  assert.deepEqual(contractSeq(null), { seq: -1, year: -1 });
});

const ids = (arr) => arr.slice().sort(compareContractsNewestFirst).map((c) => c.id);

test('mới nhất trước: ngày vay giảm dần', () => {
  assert.deepEqual(ids([
    { id: 'a', code: '470/26', disbursedDate: '2026-01-03' },
    { id: 'b', code: '300/26', disbursedDate: '2026-03-10' },
    { id: 'c', code: '480/26', disbursedDate: '2025-12-30' },
  ]), ['b', 'a', 'c']);
});

test('cùng ngày vay: số thứ tự HĐTD lớn trước (461 trước 99), năm chỉ là phụ', () => {
  assert.deepEqual(ids([
    { id: 'a', code: '99/26', disbursedDate: '2026-05-05' },
    { id: 'b', code: '461/26', disbursedDate: '2026-05-05' },
    { id: 'c', code: '460/26', disbursedDate: '2026-05-05' },
  ]), ['b', 'c', 'a']);

  assert.deepEqual(ids([
    { id: 'x', code: '460/26', disbursedDate: '2026-05-05' },
    { id: 'y', code: '461/25', disbursedDate: '2026-05-05' },
  ]), ['y', 'x']);

  assert.deepEqual(ids([
    { id: 'x', code: '461/25', disbursedDate: '2026-05-05' },
    { id: 'y', code: '461/26', disbursedDate: '2026-05-05' },
  ]), ['y', 'x']);
});

test('ngày vay thiếu/sai xếp cuối; so sánh là ổn định khi hoàn toàn trùng', () => {
  assert.deepEqual(ids([
    { id: 'n', code: '999/26', disbursedDate: null },
    { id: 'a', code: '1/26', disbursedDate: '2020-01-01' },
    { id: 'z', code: '5/26', disbursedDate: 'abc' },
  ]), ['a', 'n', 'z']);
  assert.equal(compareContractsNewestFirst({ code: '1/26', disbursedDate: '2026-01-01' }, { code: '1/26', disbursedDate: '2026-01-01' }), 0);
});
