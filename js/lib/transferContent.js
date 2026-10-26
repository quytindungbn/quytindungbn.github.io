import { stripDiacritics } from '../utils.js';

const KINDS = {
  goc: ['TRA GOC', 'Trả gốc'],
  lai: ['TRA LAI', 'Trả lãi'],
  goc_lai: ['TRA GOC LAI', 'Trả gốc và lãi'],
  tat_toan: ['TAT TOAN', 'Tất toán'],
};

export function transferContent(kind, contract, customer) {
  if (!customer) return { text: '', shown: '' };
  const [ascii, vi] = KINDS[kind] || KINDS.lai;
  return {
    text: stripDiacritics(`${ascii} HDTD ${contract.code} ${customer.name}`),
    shown: `${vi} HĐTD ${contract.code} ${customer.name}`.replace(/\s+/g, ' ').trim(),
  };
}
