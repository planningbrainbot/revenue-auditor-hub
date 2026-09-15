/**
 * Unidades regionais da rede (as praças gerenciadas pelo Ops).
 * Usado para filtrar telas operacionais quando a tabela de origem não tem
 * a coluna `tipo_unidade` (ex.: central_tratativas, nps_pesquisas.unidade).
 *
 * Mantenha em sincronia com `empresas.tipo_unidade = 'franquia'` — esse valor
 * é dado legado no banco e nos syncs, não vocabulário de tela.
 */
export const UNIDADES_REDE = [
  "Rio de Janeiro",
  "Belém",
  "Curitiba",
  "Patos de Minas",
  "Campo Novo",
  "São Luis",
  "Fortaleza",
  "Maceió",
  // legada/inativa
  "Itaúna",
] as const;

const NORM = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

const SET = new Set(UNIDADES_REDE.map((u) => NORM(u)));

export function isUnidadeDaRede(unidade: string | null | undefined): boolean {
  if (!unidade) return false;
  return SET.has(NORM(unidade));
}
