import { strictDate as validContractDate } from '../_shared/strict-date.mjs';
export const ORIGIN_RULE_VERSION = '2026-09-17';

export function digits(value) { return String(value ?? '').replace(/\D/g, ''); }
export function normalizeCnpj(value) {
  const n = digits(value);
  if (n.length !== 14 || /^(\d)\1+$/.test(n)) return null;
  const check = (length) => {
    let weight = length === 12 ? 5 : 6, sum = 0;
    for (let i = 0; i < length; i++) { sum += Number(n[i]) * weight; weight = weight === 2 ? 9 : weight - 1; }
    const mod = sum % 11;
    return (mod < 2 ? 0 : 11 - mod) === Number(n[length]);
  };
  return check(12) && check(13) ? n : null;
}

export function normalizedText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}
export function unitName(value) {
  const n = normalizedText(value);
  if (['sudeste (rj)', 'sudeste rj', 'rio de janeiro'].includes(n)) return 'rio de janeiro';
  if (['goiania', 'goiania / matriz', 'matriz'].includes(n)) return 'matriz';
  return n;
}
export function fieldValues(value) {
  if (Array.isArray(value)) return value.flatMap(fieldValues);
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') return fieldValues(value.id ?? value.value ?? value.name);
  const text = String(value).trim();
  if (text.startsWith('[')) { try { return fieldValues(JSON.parse(text)); } catch { return [text]; } }
  return text ? [text] : [];
}
export function resolveUnit(value, units, options = []) {
  const raw = fieldValues(value), found = new Map(), unknown = [];
  for (const original of raw) {
    const label = options.find((o) => String(o.id) === original)?.label ?? original;
    const matches = units.filter((u) => String(u.pipefy_id) === original || unitName(u.nome_da_praca) === unitName(label));
    if (matches.length !== 1) unknown.push(original);
    else found.set(matches[0].id, matches[0]);
  }
  if (unknown.length || !found.size) return { status: 'unknown', id: null, raw, unknown, candidates: [...found.values()] };
  if (found.size > 1) return { status: 'multiple', id: null, raw, candidates: [...found.values()] };
  const unit = [...found.values()][0];
  return { status: 'resolved', id: unit.id, name: unit.nome_da_praca, pipefyId: unit.pipefy_id, raw };
}

export function classifyOrigin(input) {
  const omie = [...new Set((input.omieUnits ?? []).map(unitName).filter(Boolean))];
  const units = [...new Set((input.units?.length ? input.units : omie).map(unitName).filter(Boolean))];
  const declared = input.declared ?? null;
  const result = (status, reason, requiresUnitValidation = false) => {
    const expectedPipefy = status === 'nova' ? 'Base Nova' : status === 'antiga' ? 'Base Antiga' : null;
    return { version: ORIGIN_RULE_VERSION, declared, omieUnits: omie, status, reason, expectedPipefy, requiresUnitValidation, needsSourceCorrection: expectedPipefy !== null && expectedPipefy !== declared };
  };
  if (input.identityConflict) return result('confirmar', 'Identidade ambígua; revisar o vínculo antes de classificar.', true);
  if (units.includes('curitiba')) {
    if (units.length > 1) return result('confirmar', 'Curitiba e outra unidade vinculadas; confirmar a carteira responsável.', true);
    const dates = input.firstContractDates ?? [];
    if (!input.contractCoverage || !dates.length || dates.some(d => validContractDate(d) !== d || !d)) return result('confirmar', 'Curitiba: falta vigência inicial para todos os CNPJs.', true);
    if (dates.some(d => d >= '2025-04-01' && d < '2025-05-01')) return result('confirmar', 'Vigência inicial em abril de 2025; corte aguardando definição.', true);
    if (dates.every(d => d < '2025-04-01')) return result('antiga', 'Curitiba: primeira vigência anterior a abril de 2025.');
    if (dates.every(d => d >= '2025-05-01')) return result('nova', 'Curitiba: primeira vigência posterior a abril de 2025.');
    return result('confirmar', 'CNPJs com vigências em coortes diferentes; revisar agrupamento.', true);
  }
  if (omie.length) return result('nova', 'Cadastro Omie fora de Curitiba; pagamento não altera a origem.');
  if (input.pipedrivePresent || input.commercialWon) return units.length
    ? result('nova', 'Registro no Pipedrive fora de Curitiba; não exige negócio ganho.')
    : result('confirmar', 'Registro no Pipedrive sem unidade confirmada.', true);
  const v = input.validation;
  if (v?.actor && v?.at && ['antiga', 'nova'].includes(v.origin)) return result(v.origin, 'Origem confirmada pela unidade com responsável e data.');
  return result('confirmar', 'Sem vínculo que comprove a origem; validar com a unidade responsável.', true);
}

export function canonicalContacts(rows) {
  const result = new Map();
  for (const c of rows) {
    const sourceId = c.pipefy_record_id ?? c.id;
    // Contatos sem ID não são unidos por nome ou e-mail compartilhado.
    const key = sourceId == null ? `unresolved:${result.size}` : `${c.source ?? 'contact'}:${sourceId}`;
    const email = String(c.email ?? '').trim(), phone = digits(c.whatsapp ?? c.phone ?? c.telefone);
    result.set(key, { ...c, key, reachable: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length >= 8 });
  }
  return [...result.values()];
}

export function refinement(rows) {
  const members = { raw: [], cnpj: [], contact: [], ecd: [] };
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key); members.raw.push(row.key);
    const cnpjs = new Set((row.cnpjs ?? []).map(normalizeCnpj).filter(Boolean));
    if (!cnpjs.size) continue;
    members.cnpj.push(row.key);
    const reachable = (row.contacts ?? []).some((c) => {
      if (c.type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c.value ?? '').trim());
      if (['phone', 'whatsapp', 'telefone'].includes(c.type)) return digits(c.value).length >= 8;
      return canonicalContacts([c])[0]?.reachable === true;
    });
    if (!reachable) continue;
    members.contact.push(row.key);
    if ((row.ecd ?? []).some((e) => cnpjs.has(normalizeCnpj(e.cnpj)) && Number.isInteger(Number(e.year)) && Number(e.year) >= 1900 && Number(e.year) <= new Date().getUTCFullYear())) members.ecd.push(row.key);
  }
  return { counts: Object.fromEntries(Object.entries(members).map(([k, v]) => [k, v.length])), members };
}

export { strictDate } from '../_shared/strict-date.mjs';
