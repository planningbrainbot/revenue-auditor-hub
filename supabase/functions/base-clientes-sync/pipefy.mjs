import { fieldValues, normalizeCnpj, resolveUnit } from './domain.mjs';

export const TABLES = { companies: 'nIlE2il6', contacts: 'Y2LGWdN-', units: 'PSSl1LNi' };
export const COMPANY_FIELDS = {
  raz_o_social: 'razao_social', cnpj: 'cnpj', segmento: 'segmento', unidade: 'unidade',
  regime_tribut_rio: 'regime_tributario', e_mail_fiscal: 'email_fiscal', telefone_corporativo: 'telefone',
  erp: 'erp', origem_da_base: 'origem_da_base', id_pipedrive_deal: 'pipedrive_id', origem: 'origem_venda',
  situa_o_do_cadastro: 'situacao_cadastro',
};
export const CONTACT_FIELDS = { nome_completo: 'nome_completo', cpf: 'cpf', e_mail_direto: 'email', whatsapp: 'whatsapp', cargo: 'cargo' };

export function webhookRecord(body, allowedTables = Object.values(TABLES)) {
  const data = body?.data ?? {}, action = data.action ?? body?.action;
  const record = data.card ?? data.table_record;
  const table = String(record?.pipe_id ?? record?.table_id ?? record?.table?.id ?? data.table?.id ?? '');
  if (!allowedTables.includes(table) || !record?.id || !['card.create', 'card.field_update', 'card.delete', 'table_record.create', 'table_record.update', 'table_record.delete'].includes(action)) return null;
  return { action, id: String(record.id), table, deleted: action.endsWith('.delete') };
}
function values(record) { return new Map((record.record_fields ?? []).map((f) => [f.field?.id ?? f.id, f])); }
function plain(f) { return f?.value === null || f?.value === undefined || String(f.value).trim() === '' ? null : String(f.value).trim(); }
function connect(f) { return fieldValues(f?.array_value?.length ? f.array_value : f?.value); }

export function mapCompany(record, schemaIds, units) {
  const by = values(record), schema = new Set(schemaIds), fields = { titulo: String(record.title ?? '').trim() };
  for (const [id, column] of Object.entries(COMPANY_FIELDS)) {
    if (!schema.has(id)) continue;
    fields[column] = plain(by.get(id));
  }
  let unit = null;
  if (schema.has('unidade')) {
    const raw = connect(by.get('unidade'));
    unit = resolveUnit(raw, units);
    // Valor desconhecido não é substituído por cidade, Omie ou primeiro rótulo arbitrário. Fica o rótulo que o Pipefy
    // mostra (o `value` do conector), nunca o id do registro: id cru em `unidade` quebra a regra empresas_unidade_nao_e_id
    // e, num lote, travava a reconciliação inteira (Móveis DAGA, unidade Itaúna, de 21/09 a 28/10/2026).
    const rotulos = fieldValues(by.get('unidade')?.value).filter((v) => !/^\d{3,}$/.test(v));
    fields.unidade = unit.status === 'resolved' ? unit.name : rotulos.length ? rotulos.join(' / ') : null;
  }
  const cnpj = normalizeCnpj(fields.cnpj);
  // CNPJ inválido é evidência a corrigir na origem, não um documento fabricado pelo espelho.
  if (cnpj) fields.cnpj = cnpj;
  return { id: String(record.id), updatedAt: record.updated_at ?? record.created_at ?? null, fields, unit, cnpjValid: !!cnpj };
}

export function mapContact(record, schemaIds) {
  const by = values(record), schema = new Set(schemaIds), fields = {};
  for (const [id, column] of Object.entries(CONTACT_FIELDS)) if (schema.has(id)) fields[column] = plain(by.get(id));
  if (!fields.nome_completo) fields.nome_completo = String(record.title ?? '').trim() || null;
  // Campos de 28/10 (atualização da base pela unidade): viram as marcas booleanas do espelho.
  if (schema.has('contato_do_nps')) fields.contato_nps = plain(by.get('contato_do_nps')) === 'Sim';
  if (schema.has('situa_o_do_contato')) fields.ativo = plain(by.get('situa_o_do_contato')) !== 'Inativo';
  return { id: String(record.id), updatedAt: record.updated_at ?? record.created_at ?? null, fields, companyRefs: connect(by.get('empresa')) };
}
