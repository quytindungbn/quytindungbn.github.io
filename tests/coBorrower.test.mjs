import test from 'node:test';
import assert from 'node:assert/strict';
import { normPersonName, samePerson, samePhone, heirOfContract, heirNamesOf, coPhoneOf, contractOa, customerOaSummary, hasOaPhone, shortPersonName, checkCoPhone, sanitizeCoPhoneInput, logRecipient, phoneHolders } from '../js/lib/coBorrower.js';

test('so sánh tên: bỏ qua hoa/thường và khoảng trắng thừa, giữ dấu', () => {
  assert.equal(normPersonName('  Trần   Văn  Bình '), 'trần văn bình');
  assert.ok(samePerson('TRẦN VĂN BÌNH', 'Trần Văn Bình'));
  assert.ok(!samePerson('Trần Văn Bình', 'Trần Văn Binh'));
  assert.ok(!samePerson('', ''));
  assert.ok(!samePerson(null, 'A'));
});

test('heirNamesOf: bỏ tên trống, tên trùng khách và tên lặp', () => {
  const cts = [{ heirName: 'ĐỖ THỊ HOA' }, { heirName: '' }, { heirName: 'LÊ QUANG NINH' }, { heirName: 'đỗ  thị hoa' }, { heirName: 'VÕ VĂN AN' }, {}];
  assert.deepEqual(heirNamesOf(cts, 'Lê Quang Ninh'), ['ĐỖ THỊ HOA', 'VÕ VĂN AN']);
  assert.deepEqual(heirNamesOf([], 'A'), []);
  assert.deepEqual(heirNamesOf(null, 'A'), []);
});

test('samePhone: so sánh số điện thoại bỏ ký tự lạ, +84/84 coi như 0', () => {
  assert.ok(samePhone('0988 777 666', '+84988777666'));
  assert.ok(samePhone('84988777666', '0988.777.666'));
  assert.ok(!samePhone('0988777666', '0988777667'));
  assert.ok(!samePhone('', ''));
});

test('heirOfContract: tên người cùng vay ghi trên hợp đồng; bỏ tên trống và tên trùng người vay', () => {
  assert.equal(heirOfContract({ heirName: '  Trần  Thị Bích ' }, 'LÊ VĂN A'), 'Trần Thị Bích');
  assert.equal(heirOfContract({ heirName: 'LÊ VĂN A' }, 'lê văn a'), '');
  assert.equal(heirOfContract({ heirName: null }, 'A'), '');
  assert.equal(heirOfContract({}, 'A'), '');
});

test('coPhoneOf: tìm số trong sổ người cùng vay không phân biệt hoa/thường', () => {
  const people = [{ name: 'TRẦN THỊ BÍCH', phone: '0988777666' }, { name: 'Lê Văn Khánh', phone: '' }];
  assert.equal(coPhoneOf(people, 'trần thị bích'), '0988777666');
  assert.equal(coPhoneOf(people, 'LÊ VĂN KHÁNH'), '');
  assert.equal(coPhoneOf(people, 'Người lạ'), '');
  assert.equal(coPhoneOf(null, 'A'), '');
});

const CUST = { name: 'NGUYỄN THỊ ÁI NHI', phone: '0912345678', coPeople: [{ name: 'TRẦN THỊ BÍCH', phone: '0988777666' }, { name: 'LÊ VĂN KHÁNH', phone: '' }] };
const ct = (o = {}) => ({ id: 'x', heirName: 'trần thị bích', oaEnabled: true, oaToMain: true, oaToCo: false, oaCoKey: null, ...o });

test('contractOa: mặc định chỉ gửi người vay', () => {
  const s = contractOa(ct(), CUST);
  assert.deepEqual([s.enabled, s.toMain, s.toCo], [true, true, false]);
  assert.deepEqual(s.recipients, [{ who: 'main', phone: '0912345678' }]);
  assert.equal(s.coName, 'trần thị bích');
});

test('contractOa: tick người cùng vay (đúng tên, có số) → gửi cả 2; chỉ người cùng vay khi bỏ tick người vay', () => {
  const both = contractOa(ct({ oaToCo: true, oaCoKey: 'trần thị bích' }), CUST);
  assert.deepEqual(both.recipients.map((r) => r.who), ['main', 'co']);
  const onlyCo = contractOa(ct({ oaToCo: true, oaCoKey: 'TRẦN THỊ BÍCH', oaToMain: false }), CUST);
  assert.deepEqual(onlyCo.recipients, [{ who: 'co', phone: '0988777666' }]);
  assert.equal(onlyCo.toMain, false);
});

test('contractOa: tick người cùng vay nhưng hợp đồng nay ghi người khác → tick mất hiệu lực, KHÔNG gửi cho người cũ', () => {
  const s = contractOa(ct({ heirName: 'LÊ VĂN KHÁNH', oaToCo: true, oaCoKey: 'trần thị bích', oaToMain: false }), CUST);
  assert.equal(s.toCo, false);
  assert.deepEqual(s.recipients.map((r) => r.who), ['main']);
});

test('contractOa: người cùng vay chưa có số → bị khóa, không nhận tin dù có tick', () => {
  const s = contractOa(ct({ heirName: 'Lê Văn Khánh', oaToCo: true, oaCoKey: 'lê văn khánh' }), CUST);
  assert.deepEqual([s.coLocked, s.toCo, s.coPhone], [true, false, '']);
  assert.deepEqual(s.recipients.map((r) => r.who), ['main']);
});

test('contractOa: hợp đồng tắt → không gửi cho ai', () => {
  const s = contractOa(ct({ oaEnabled: false, oaToCo: true, oaCoKey: 'trần thị bích' }), CUST);
  assert.deepEqual([s.enabled, s.toMain, s.toCo, s.recipients.length], [false, false, false, 0]);
});

test('contractOa: hợp đồng không ghi người cùng vay thì không có người cùng vay nào để gửi', () => {
  const s = contractOa(ct({ heirName: null, oaToCo: true, oaCoKey: 'trần thị bích' }), CUST);
  assert.deepEqual([s.coName, s.toCo], ['', false]);
});

test('contractOa: người vay chưa có số bị khóa; số người cùng vay trùng số người vay thì không gửi 2 lần', () => {

  const noPhone = contractOa(ct(), { ...CUST, phone: '' });
  assert.deepEqual([noPhone.mainLocked, noPhone.toMain, noPhone.toCo, noPhone.coAuto, noPhone.recipients.map((r) => r.who)], [true, false, true, true, ['co']]);

  assert.deepEqual(contractOa(ct({ heirName: 'LÊ VĂN KHÁNH' }), { ...CUST, phone: '' }).recipients, []);
  assert.deepEqual(contractOa(ct({ heirName: null }), { ...CUST, phone: '' }).recipients, []);
  assert.deepEqual(contractOa(ct(), { name: 'A', phone: '', coPeople: [{ name: 'TRẦN THỊ BÍCH', phone: '' }] }).recipients, []);

  assert.deepEqual(contractOa(ct({ oaEnabled: false }), { ...CUST, phone: '' }).recipients, []);

  const hasPhone = contractOa(ct(), CUST);
  assert.deepEqual([hasPhone.coAuto, hasPhone.toCo, hasPhone.recipients.map((r) => r.who)], [false, false, ['main']]);
  const dup = contractOa(ct({ oaToCo: true, oaCoKey: 'trần thị bích' }), { ...CUST, phone: '0988777666' });
  assert.deepEqual(dup.recipients.map((r) => r.who), ['main']);
});

test('customerOaSummary: mặc định không cần dòng "Gửi tới"; có người cùng vay nhận hoặc hợp đồng tắt thì có', () => {
  const plain = customerOaSummary([ct(), ct({ id: 'y', heirName: 'LÊ VĂN KHÁNH' })], CUST);
  assert.deepEqual([plain.mode, plain.custom, plain.offCount], ['main', false, 0]);
  const withCo = customerOaSummary([ct({ oaToCo: true, oaCoKey: 'trần thị bích' }), ct({ id: 'y', heirName: 'LÊ VĂN KHÁNH' })], CUST);
  assert.deepEqual([withCo.mode, withCo.custom, withCo.anyCo], ['both', true, true]);
  const off = customerOaSummary([ct(), ct({ id: 'y', oaEnabled: false })], CUST);
  assert.deepEqual([off.mode, off.custom, off.offCount], ['main', true, 1]);
  const allOff = customerOaSummary([ct({ oaEnabled: false })], CUST);
  assert.deepEqual([allOff.mode, allOff.custom], ['none', true]);
  const coOnly = customerOaSummary([ct({ oaToCo: true, oaCoKey: 'trần thị bích', oaToMain: false })], CUST);
  assert.equal(coOnly.mode, 'co');
  const noPhone = customerOaSummary([ct({ heirName: null })], { ...CUST, phone: '' });
  assert.deepEqual([noPhone.mode, noPhone.noRecipient, noPhone.custom], ['none', true, true]);
  const autoCo = customerOaSummary([ct(), ct({ id: 'y' })], { ...CUST, phone: '' });
  assert.deepEqual([autoCo.mode, autoCo.noRecipient, autoCo.custom, autoCo.uniform], ['co', false, true, true]);
});

test('shortPersonName: tên gọi ngắn là từ cuối, viết hoa chữ đầu', () => {
  assert.equal(shortPersonName('TRẦN THỊ BÍCH'), 'Bích');
  assert.equal(shortPersonName('lê văn khánh'), 'Khánh');
  assert.equal(shortPersonName(''), '');
});

test('checkCoPhone: đúng 10 số và có số 0 đứng đầu', () => {
  assert.deepEqual(checkCoPhone('0988777666'), { ok: true, empty: false, phone: '0988777666' });
  assert.deepEqual(checkCoPhone('0988 777 666'), { ok: true, empty: false, phone: '0988777666' });
  assert.deepEqual(checkCoPhone('0988.777.666'), { ok: true, empty: false, phone: '0988777666' });
  assert.equal(checkCoPhone('098877766').ok, false);
  assert.equal(checkCoPhone('09887776666').ok, false);
  assert.equal(checkCoPhone('988777666').ok, false);
  assert.equal(checkCoPhone('9887776660').reason, 'Số điện thoại phải bắt đầu bằng số 0.');
  assert.equal(checkCoPhone('+84988777666').ok, false);
  assert.equal(checkCoPhone('0988abc666').ok, false);
});

test('checkCoPhone: để trống là hợp lệ (xóa số)', () => {
  for (const v of ['', '   ', null, undefined]) assert.deepEqual(checkCoPhone(v), { ok: true, empty: true, phone: '' });
});

test('sanitizeCoPhoneInput: chỉ giữ chữ số, tối đa 10 số, đổi +84 thành 0', () => {
  assert.equal(sanitizeCoPhoneInput('0988 777 666'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('09ab88-777.666 123'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('+84 988 777 666'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('84988777666'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('098'), '098');
  assert.equal(sanitizeCoPhoneInput(''), '');
});

test('hasOaPhone: chỉ cần người vay hoặc 1 người cùng vay (ghi trên hợp đồng) có số là thêm được vào OA', () => {
  const cts = [{ heirName: 'TRẦN THỊ BÍCH' }, { heirName: 'LÊ VĂN KHÁNH' }];

  assert.ok(hasOaPhone(cts, { name: 'A', phone: '0912345678', coPeople: [] }));

  assert.ok(!hasOaPhone([{}], { name: 'A', phone: '', coPeople: [] }));
  assert.ok(!hasOaPhone([], { name: 'A', phone: '  ', coPeople: [] }));

  assert.ok(!hasOaPhone(cts, { name: 'A', phone: '', coPeople: [{ name: 'TRẦN THỊ BÍCH', phone: '' }] }));

  assert.ok(hasOaPhone(cts, { name: 'A', phone: '', coPeople: [{ name: 'Trần Thị Bích', phone: '0988777666' }] }));

  assert.ok(!hasOaPhone(cts, { name: 'A', phone: '', coPeople: [{ name: 'NGUYỄN VĂN CŨ', phone: '0988777666' }] }));
});

test('customerOaSummary.uniform: các hợp đồng đang bật gửi cho cùng những người thì uniform; khác nhau thì không', () => {
  const cust = { name: 'A', phone: '0912345678', coPeople: [{ name: 'TRẦN THỊ BÍCH', phone: '0988777666' }] };
  const key = 'trần thị bích';
  const both = (extra = {}) => ({ heirName: 'TRẦN THỊ BÍCH', oaToMain: true, oaToCo: true, oaCoKey: key, ...extra });
  assert.equal(customerOaSummary([both(), both()], cust).uniform, true);
  assert.equal(customerOaSummary([{}, {}], cust).uniform, true);
  assert.equal(customerOaSummary([both(), { heirName: 'TRẦN THỊ BÍCH' }], cust).uniform, false, '1 hợp đồng gửi cả 2, 1 hợp đồng chỉ người vay');
  assert.equal(customerOaSummary([both(), both({ oaEnabled: false, oaToCo: false })], cust).uniform, true, 'hợp đồng tắt không tính');
});

test('logRecipient: lần gửi đã gửi cho ai — người vay / người cùng vay (theo hợp đồng, rồi theo sổ) / số khác', () => {
  const customer = { name: 'LÂM VĂN THU', phone: '0910000000', coPeople: [{ name: 'TRẦN THỊ BÍCH', phone: '0988777666' }, { name: 'Lê Văn Khánh', phone: '0905222333' }] };
  const contract = { heirName: 'trần thị bích' };
  assert.deepEqual(logRecipient('0910 000 000', customer, contract), { who: 'main', name: 'LÂM VĂN THU', phone: '0910 000 000' });
  assert.deepEqual(logRecipient('+84910000000', customer, contract).who, 'main');
  assert.deepEqual(logRecipient('0988777666', customer, contract), { who: 'co', name: 'trần thị bích', phone: '0988777666' });

  assert.deepEqual(logRecipient('0905222333', customer, contract), { who: 'co', name: 'Lê Văn Khánh', phone: '0905222333' });

  assert.deepEqual(logRecipient('0933444555', customer, contract), { who: 'other', name: '', phone: '0933444555' });
  assert.equal(logRecipient('', customer, contract).who, 'other');
  assert.equal(logRecipient(null, customer, contract).phone, '');
  assert.deepEqual(logRecipient('0910000000', null, null), { who: 'other', name: '', phone: '0910000000' });

  assert.equal(logRecipient('0910000000', customer, null).who, 'main');
  assert.equal(logRecipient('0988777666', customer, null).who, 'co');
});

test('logRecipient: log đã ghi sẵn người nhận thì dùng đúng như đã ghi, dù số điện thoại sau đó bị sửa', () => {
  const customer = { name: 'LÂM VĂN THU', phone: '0910000000', coPeople: [{ name: 'LÊ VĂN KHÁNH', phone: '0905999888' }] };

  assert.deepEqual(logRecipient('0905222333', customer, null, { who: 'co', name: 'LÊ VĂN KHÁNH' }), { who: 'co', name: 'LÊ VĂN KHÁNH', phone: '0905222333' });

  assert.equal(logRecipient('0905222333', customer, null).who, 'other');
  assert.equal(logRecipient('0905222333', customer, null, { who: null, name: '' }).who, 'other');

  assert.deepEqual(logRecipient('0911111111', customer, null, { who: 'main', name: '' }), { who: 'main', name: 'LÂM VĂN THU', phone: '0911111111' });

  assert.equal(logRecipient('0905222333', null, null, { who: 'co', name: 'Khánh' }).who, 'co');
});

test('phoneHolders: tìm ai đang dùng số này (người vay hoặc người cùng vay của khách khác), bỏ qua chính người đang sửa', () => {
  const customers = [
    { id: 'a', name: 'ÔNG A', phone: '0911111111', coPeople: [{ name: 'BÀ B', phone: '0988777666' }, { name: 'CÔ D', phone: '' }] },
    { id: 'c', name: 'ÔNG C', phone: '0922222222', coPeople: [{ name: 'Bà B', phone: '0988 777 666' }] },
    { id: 'e', name: 'ÔNG E', phone: '+84 988 777 666', coPeople: [] },
  ];
  const h = phoneHolders(customers, '0988777666', { exceptCustomerId: 'c', exceptCoName: 'BÀ B' });
  assert.deepEqual(h.map((x) => `${x.kind}:${x.customerName}:${x.name}:${x.same}`), ['co:ÔNG A:BÀ B:false', 'main:ÔNG E:ÔNG E:false']);
  const own = phoneHolders(customers, '0911111111', { exceptCustomerId: 'a', exceptCoName: 'CÔ D' });
  assert.deepEqual(own.map((x) => `${x.kind}:${x.same}`), ['main:true']);
  assert.deepEqual(phoneHolders(customers, '0900000000', { exceptCustomerId: 'a' }), []);
  assert.deepEqual(phoneHolders(customers, '', {}), []);
  assert.deepEqual(phoneHolders(null, '0911111111'), []);
});
