export function contractSeq(code) {
  const m = String(code ?? '').trim().match(/^(\d+)\s*(?:\/\s*(\d+))?/);
  return m ? { seq: Number(m[1]), year: m[2] === undefined ? -1 : Number(m[2]) } : { seq: -1, year: -1 };
}

function dateKey(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

export function compareContractsNewestFirst(a, b) {
  const da = dateKey(a?.disbursedDate), db = dateKey(b?.disbursedDate);
  if (da !== db) return da < db ? 1 : -1;
  const x = contractSeq(a?.code), y = contractSeq(b?.code);
  if (x.seq !== y.seq) return y.seq - x.seq;
  return y.year - x.year;
}
