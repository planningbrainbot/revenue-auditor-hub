// Pedidos das unidades aprovados pelo CS (PRD da atualização da base, 28/10/2026): o que vai ao Pipefy.
// Só funções puras; a ordem das chamadas e a releitura moram no index.ts.
import { digits } from './domain.mjs';

export const CONTACT = {
  nome: 'nome_completo', whatsapp: 'whatsapp', email: 'e_mail_direto', cargo: 'cargo', empresa: 'empresa',
  nps: 'contato_do_nps', situacao: 'situa_o_do_contato',
};
export const COMPANY = {
  razao: 'raz_o_social', cnpj: 'cnpj', unidade: 'unidade', situacao: 'situa_o_do_cadastro', fonte: 'fonte_do_cadastro',
};
export const CARGOS = ['Sócio Operador', 'Sócio Investidor', 'Diretor', 'Gerente', 'Financeiro', 'Administrativo', 'Contador', 'Outro'];
// Pipe Tratativas (307196408): card em Perdido conclui o pedido de churn; Cliente Recuperado recusa (R-13, fases conferidas em 28/10).
export const FASE_PERDIDO = '343394578';
export const FASE_RECUPERADO = '343394575';

/** WhatsApp no formato do campo telefone do Pipefy: +55 e os dígitos. */
export function phone(w) { const d = digits(w); return d ? `+${d.startsWith('55') ? d : `55${d}`}` : null; }

export function cnpjMask(c) {
  const d = digits(c);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
}

/** Campos do registro do Stakeholder para criar (com empresa) ou atualizar (sem). */
export function contactFields(p, empresaPipefy) {
  const f = [
    { field_id: CONTACT.nome, field_value: p.nome },
    { field_id: CONTACT.whatsapp, field_value: phone(p.whatsapp) },
    { field_id: CONTACT.situacao, field_value: 'Ativo' },
  ];
  if (p.email) f.push({ field_id: CONTACT.email, field_value: p.email });
  if (p.cargo && CARGOS.includes(p.cargo)) f.push({ field_id: CONTACT.cargo, field_value: p.cargo });
  if (empresaPipefy) f.push({ field_id: CONTACT.empresa, field_value: [String(empresaPipefy)] });
  return f;
}

/**
 * R-09: o registro do mesmo cliente com o mesmo WhatsApp; e-mail só conta junto com o mesmo nome
 * (e-mail como financeiro@ é dividido por pessoas diferentes, lição da dedup de 27/08).
 */
export function matchContato(contatos, p) {
  const w = digits(p.whatsapp);
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  return contatos.find((c) => c.pipefy_id && w && digits(c.whatsapp) === w)
    ?? contatos.find((c) => c.pipefy_id && p.email && norm(c.email) === norm(p.email) && norm(c.nome) === norm(p.nome))
    ?? null;
}

/** R-10: quem perde o "Sim" de contato do NPS antes do novo ganhar. */
export function npsParaDesmarcar(contatos, alvoPipefy) {
  return contatos.filter((c) => c.contato_nps && c.pipefy_id && String(c.pipefy_id) !== String(alvoPipefy)).map((c) => String(c.pipefy_id));
}

/** Pedido de churn pela fase do card (R-13). null = segue aberto. */
export function churnPelaFase(card) {
  if (!card) return { concluido: false, motivo: 'O card da tratativa foi apagado no Pipefy.' };
  const fase = String(card.current_phase?.id ?? '');
  if (fase === FASE_PERDIDO) return { concluido: true, motivo: null };
  if (fase === FASE_RECUPERADO) return { concluido: false, motivo: 'Cliente recuperado na tratativa do CS.' };
  return null;
}
