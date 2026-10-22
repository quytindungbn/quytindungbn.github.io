import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreLeadingInstallment, mergeInstallmentSchedule } from '../js/lib/installmentPlan.js';

const e = (...pairs) => pairs.map(([year, amount]) => ({ year, amount }));

test('hợp đồng 318/26: file chỉ còn 2028/2029, kỳ 2027 đã trả đủ được dựng lại với số tiền 10tr', () => {
  const out = restoreLeadingInstallment(e([2028, 10e6], [2029, 180e6]), { principal: 200e6, balance: 190e6, disbursedYear: 2026 });
  assert.deepEqual(out, [{ year: 2027, amount: 10e6, restored: true }, ...e([2028, 10e6], [2029, 180e6])]);
});

test('không dựng lại khi tổng các kỳ còn lưu bằng số tiền vay (không có kỳ nào đã bị bỏ)', () => {
  const kept = e([2028, 20e6], [2029, 180e6]);
  assert.equal(restoreLeadingInstallment(kept, { principal: 200e6, balance: 190e6, disbursedYear: 2026 }), kept);
});

test('không dựng lại khi kỳ đầu đã là năm giải ngân + 1, hoặc thiếu từ 2 năm (không biết chia ra sao)', () => {
  const first = e([2027, 10e6], [2028, 10e6], [2029, 180e6]);
  assert.equal(restoreLeadingInstallment(first, { principal: 200e6, balance: 190e6, disbursedYear: 2026 }), first);
  const gap2 = e([2029, 180e6], [2030, 10e6]);
  assert.equal(restoreLeadingInstallment(gap2, { principal: 200e6, balance: 190e6, disbursedYear: 2026 }), gap2);
});

test('không dựng lại khi phần thiếu lớn hơn số gốc đã trả (chưa thể là kỳ đã trả đủ)', () => {
  const kept = e([2028, 10e6], [2029, 100e6]);
  assert.equal(restoreLeadingInstallment(kept, { principal: 200e6, balance: 190e6, disbursedYear: 2026 }), kept);
});

test('thiếu năm giải ngân hoặc danh sách rỗng thì giữ nguyên', () => {
  const kept = e([2028, 10e6], [2029, 180e6]);
  assert.equal(restoreLeadingInstallment(kept, { principal: 200e6, balance: 190e6, disbursedYear: NaN }), kept);
  assert.deepEqual(restoreLeadingInstallment([], { principal: 1, balance: 1, disbursedYear: 2026 }), []);
});

test('gộp file mới: giữ kỳ 2027 đã lưu dù file mới ghi 0 (không còn năm đó), các kỳ từ 2028 lấy theo file mới', () => {
  const merged = mergeInstallmentSchedule({ 2027: 10e6, 2028: 10e6, 2029: 180e6 }, { 2028: 10e6, 2029: 180e6 });
  assert.deepEqual(merged, { 2027: 10e6, 2028: 10e6, 2029: 180e6 });
});

test('gộp file mới: giữ nhiều kỳ đầu đã trả đủ; kỳ từ năm đầu tiên của file mới được cập nhật theo file', () => {
  const merged = mergeInstallmentSchedule({ 2027: 20e6, 2028: 20e6, 2029: 160e6 }, { 2029: 150e6 });
  assert.deepEqual(merged, { 2027: 20e6, 2028: 20e6, 2029: 150e6 });
});

test('gộp file mới: lần nhập đầu (chưa có lịch cũ) hoặc file mới đầy đủ thì lấy đúng theo file', () => {
  assert.deepEqual(mergeInstallmentSchedule(null, { 2027: 10e6, 2028: 190e6 }), { 2027: 10e6, 2028: 190e6 });
  assert.deepEqual(mergeInstallmentSchedule({ 2027: 5e6, 2028: 195e6 }, { 2027: 10e6, 2028: 190e6 }), { 2027: 10e6, 2028: 190e6 });
});

test('gộp file mới: không có kỳ nào trong file mới thì giữ nguyên lịch đã lưu', () => {
  assert.deepEqual(mergeInstallmentSchedule({ 2027: 10e6, 2028: 190e6 }, {}), { 2027: 10e6, 2028: 190e6 });
  assert.equal(mergeInstallmentSchedule(null, {}), null);
});

test('gộp file mới: bỏ kỳ cũ có số 0, không gộp kỳ cũ đứng SAU kỳ đầu của file mới', () => {
  assert.deepEqual(mergeInstallmentSchedule({ 2027: 0, 2028: 10e6, 2030: 50e6 }, { 2029: 40e6 }), { 2028: 10e6, 2029: 40e6 });
});
