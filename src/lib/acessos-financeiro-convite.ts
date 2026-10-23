// Regras puras do "Convidar pessoa nova" da tela Acessos do Financeiro.
//
// PEDIDO (23/10/2026): a Ana precisava liberar o Financeiro para e-mails que
// ainda não tinham conta no Planning Brain, e a tela só listava quem já tinha.
// O Pedro: "A Ana precisa conseguir convidar novos usuários ao invés de apenas
// passar acessos ao financeiro de quem já existe".
//
// Ficam aqui, sem Supabase, para o teste de node alcançar: validação do
// formulário e a decisão sobre a conta que já existe.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Domínios das contas do grupo hoje (profiles, 23/10/2026). */
export const DOMINIOS_DO_GRUPO = ["planning.com.br", "grupoplanning.com.br", "br.planning.com.br"];

export interface ConviteFinanceiro {
  nome: string;
  email: string;
  unidades: string[];
}

export function validarConvite(input: Partial<ConviteFinanceiro> | null | undefined): ConviteFinanceiro {
  const nome = (input?.nome ?? "").trim().replace(/\s+/g, " ");
  const email = (input?.email ?? "").trim().toLowerCase();
  const unidades = Array.from(new Set((input?.unidades ?? []).map((u) => String(u).trim()))).filter(Boolean);
  if (!nome) throw new Error("Escreva o nome da pessoa.");
  if (!EMAIL_RE.test(email)) throw new Error("E-mail inválido.");
  // Conta nova sem unidade entra no Financeiro e não vê número nenhum: é
  // convite para nada. Quem já tem conta pode ficar sem unidade pela edição.
  if (!unidades.length) throw new Error("Marque pelo menos uma unidade.");
  return { nome, email, unidades };
}

/** E-mail de fora do grupo: a tela pede confirmação antes de convidar. */
export function emailDeFora(email: string): boolean {
  const dominio = email.trim().toLowerCase().split("@")[1] ?? "";
  return !DOMINIOS_DO_GRUPO.includes(dominio);
}

export type DecisaoConvite =
  | { tipo: "criar" }
  | { tipo: "conceder"; userId: string }
  | { tipo: "recusar"; motivo: string };

/**
 * O que fazer com o e-mail convidado, dada a conta que já existe (ou não).
 *
 * Conta desativada não é reativada por aqui: reativar devolve TODOS os acessos
 * dela, inclusive os do Ops, e isso é decisão da administração do Ops.
 */
export function decidirConvite(
  conta: { user_id: string; ativo: boolean } | null,
  jaEntraNoFinanceiro: boolean,
): DecisaoConvite {
  if (!conta) return { tipo: "criar" };
  if (!conta.ativo) {
    return {
      tipo: "recusar",
      motivo:
        "Este e-mail tem uma conta desativada no Planning Brain. Só a administração do Ops reativa; peça a ela.",
    };
  }
  if (jaEntraNoFinanceiro) {
    return {
      tipo: "recusar",
      motivo: "Esta pessoa já entra no Financeiro. Use “Editar unidades” na lista.",
    };
  }
  return { tipo: "conceder", userId: conta.user_id };
}
