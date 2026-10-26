export function normPersonName(name) {
  return String(name || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function samePerson(a, b) {
  const x = normPersonName(a);
  return !!x && x === normPersonName(b);
}

export function samePhone(a, b) {
  const n = (v) => String(v || '').replace(/[^\d]/g, '').replace(/^84/, '0');
  return !!n(a) && n(a) === n(b);
}

export function heirOfContract(contract, customerName) {
  const n = String(contract?.heirName || '').replace(/\s+/g, ' ').trim();
  return !n || samePerson(n, customerName) ? '' : n;
}

export function heirNamesOf(contracts, customerName) {
  const out = [];
  for (const ct of contracts || []) {
    const n = heirOfContract(ct, customerName);
    if (n && !out.some((x) => samePerson(x, n))) out.push(n);
  }
  return out;
}

export function coPhoneOf(people, name) {
  const p = (people || []).find((x) => samePerson(x?.name, name));
  return p ? String(p.phone || '') : '';
}

export function contractOa(contract, customer) {
  const enabled = contract?.oaEnabled !== false;
  const coName = heirOfContract(contract, customer?.name);
  const coPhone = coName ? coPhoneOf(customer?.coPeople, coName) : '';
  const mainPhone = String(customer?.phone || '').trim();
  const coLocked = !!coName && !coPhone;
  const mainLocked = !mainPhone;
  const coUsable = !!coName && !!coPhone && !samePhone(coPhone, mainPhone);
  const ticked = contract?.oaToCo === true && !!coName && samePerson(contract?.oaCoKey, coName);
  const coAuto = coUsable && mainLocked;
  const toCo = enabled && coUsable && (ticked || mainLocked);
  const toMain = enabled && (contract?.oaToMain !== false || !toCo) && !mainLocked;
  const recipients = [];
  if (toMain) recipients.push({ who: 'main', phone: mainPhone });
  if (toCo) recipients.push({ who: 'co', phone: coPhone });
  return { enabled, coName, coPhone, coLocked, mainLocked, coAuto, toCo, toMain, recipients };
}

export function customerOaSummary(contracts, customer) {
  const items = (contracts || []).map((ct) => ({ contract: ct, state: contractOa(ct, customer) }));
  const anyMain = items.some((x) => x.state.toMain);
  const anyCo = items.some((x) => x.state.toCo);
  const offCount = items.filter((x) => !x.state.enabled).length;
  const mode = anyMain && anyCo ? 'both' : anyCo ? 'co' : anyMain ? 'main' : 'none';
  const noRecipient = items.some((x) => x.state.enabled && !x.state.recipients.length);
  const on = items.filter((x) => x.state.enabled);
  const uniform = on.every((x) => x.state.toMain === on[0].state.toMain && x.state.toCo === on[0].state.toCo);
  const custom = anyCo || offCount > 0 || noRecipient || items.some((x) => x.state.enabled && !x.state.toMain && !x.state.mainLocked);
  return { items, anyMain, anyCo, offCount, noRecipient, mode, custom, uniform };
}

export function hasOaPhone(contracts, customer) {
  if (String(customer?.phone || '').trim()) return true;
  return heirNamesOf(contracts, customer?.name).some((n) => !!coPhoneOf(customer?.coPeople, n));
}

export function logRecipient(logPhone, customer, contract, recorded = null) {
  const phone = String(logPhone || '').trim();
  if (recorded && recorded.who === 'main') return { who: 'main', name: recorded.name || (customer && customer.name) || '', phone };
  if (recorded && recorded.who === 'co') return { who: 'co', name: recorded.name || '', phone };
  if (!phone || !customer) return { who: 'other', name: '', phone };
  if (samePhone(phone, customer.phone)) return { who: 'main', name: customer.name || '', phone };
  const st = contract ? contractOa(contract, customer) : null;
  if (st && st.coName && st.coPhone && samePhone(phone, st.coPhone)) return { who: 'co', name: st.coName, phone };
  const p = (customer.coPeople || []).find((x) => x && x.phone && samePhone(phone, x.phone));
  return p ? { who: 'co', name: p.name || '', phone } : { who: 'other', name: '', phone };
}

export function shortPersonName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const w = words[words.length - 1] || '';
  return w ? w.charAt(0).toLocaleUpperCase('vi') + w.slice(1).toLocaleLowerCase('vi') : '';
}

export function checkCoPhone(raw) {
  const digits = String(raw ?? '').replace(/[\s.\-()]/g, '');
  if (!digits) return { ok: true, empty: true, phone: '' };
  if (!/^\d+$/.test(digits)) return { ok: false, reason: 'Số điện thoại chỉ được nhập chữ số.' };
  if (digits[0] !== '0') return { ok: false, reason: 'Số điện thoại phải bắt đầu bằng số 0.' };
  if (digits.length !== 10) return { ok: false, reason: 'Số điện thoại phải đủ 10 số.' };
  return { ok: true, empty: false, phone: digits };
}

export function sanitizeCoPhoneInput(raw) {
  let v = String(raw ?? '');
  if (/^\s*\+84/.test(v)) v = v.replace(/^\s*\+84/, '0');
  v = v.replace(/\D/g, '');
  if (/^84\d{9}$/.test(v)) v = '0' + v.slice(2);
  return v.slice(0, 10);
}
