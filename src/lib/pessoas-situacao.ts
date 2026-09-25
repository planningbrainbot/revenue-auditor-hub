// A SITUAÇÃO de uma pessoa na gestão de acessos, e as pendências que a tela
// aponta. Puro de propósito: a lista de Pessoas e a ficha usam a mesma regra, e
// uma não pode dizer "ok" onde a outra diz "pendência".
//
// Nasceu da auditoria de 24/09/2026. Os estados que a interface deixava criar
// sem avisar (conta sem recorte, Growth sem papel, e-mail digitado errado)
// passam a aparecer na lista, na primeira coluna que o admin lê.

import type { TomStatus } from "@/components/planning";

/** Domínios que o grupo usa. Fora deles, a tela pergunta se não foi erro de digitação. */
export const DOMINIOS_CONHECIDOS = [
  "planning.com.br",
  "grupoplanning.com.br",
  "br.planning.com.br",
  "legaddo.com.br",
];

export function dominioIncomum(email: string): boolean {
  const dominio = (email.split("@")[1] ?? "").trim().toLowerCase();
  return Boolean(dominio) && !DOMINIOS_CONHECIDOS.includes(dominio);
}

export type Situacao = "ativa" | "pendencia" | "convite" | "pedido" | "desativada";

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  ativa: "Ativa",
  pendencia: "Com pendência",
  convite: "Convite pendente",
  pedido: "Pediu acesso",
  desativada: "Desativada",
};

export const TOM_SITUACAO: Record<Situacao, TomStatus> = {
  ativa: "sucesso",
  pendencia: "atencao",
  convite: "info",
  pedido: "info",
  desativada: "neutro",
};

export type EntradaDaSituacao = {
  email: string;
  ativo: boolean;
  ultimoLogin: string | null;
  papeis: string[];
  produtos: string[];
  escopo: { todas: boolean; unidades: string[] | { id: number; nome: string }[] };
  growth: { papel: string } | null;
  administra: { area: string }[];
  pedidoPendente: unknown | null;
  /** Unidade do cadastro de sócio, quando a pessoa é sócio regional. */
  unidadeSocio?: string | null;
  /** Banida no Auth com a conta ativa. */
  banida?: boolean;
};

/**
 * O que está errado com o acesso desta pessoa, em frases que dizem o efeito.
 * Vazio quando nada está.
 */
export function pendenciasDe(p: EntradaDaSituacao): string[] {
  if (!p.ativo) return [];
  const pend: string[] = [];
  if (p.banida) {
    pend.push("Login bloqueado por um banimento antigo (do “tirar da área” de antes de 25/09): ela não consegue entrar.");
  }
  const entraNoOps = p.produtos.includes("ops");
  const temAcessoNoOps = p.papeis.length > 0 || p.administra.length > 0;
  if (entraNoOps && temAcessoNoOps && !p.escopo.todas && p.escopo.unidades.length === 0) {
    pend.push("Sem unidades no recorte: as telas recortadas por unidade abrem vazias.");
  }
  if (p.produtos.includes("growth") && !p.growth) {
    pend.push("Entra no Growth, mas não tem papel lá: o Growth barra.");
  }
  if (!p.produtos.includes("growth") && p.growth) {
    pend.push("Tem papel no Growth, mas a porta do Growth está fechada.");
  }
  if (!entraNoOps && temAcessoNoOps) {
    pend.push("Tem perfil ou área no Ops, mas a porta do Ops está fechada: não abre nada.");
  }
  if (p.papeis.includes("socio_regional") && !p.unidadeSocio) {
    pend.push("Sócio regional sem unidade no cadastro de sócio.");
  }
  if (dominioIncomum(p.email)) {
    pend.push("E-mail com domínio fora do grupo: confira se não foi digitado errado.");
  }
  return pend;
}

export function situacaoDe(p: EntradaDaSituacao): Situacao {
  if (!p.ativo) return "desativada";
  if (p.pedidoPendente) return "pedido";
  if (pendenciasDe(p).length) return "pendencia";
  if (!p.ultimoLogin) return "convite";
  return "ativa";
}

const RELATIVO = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** "hoje", "há 3 dias", "há 2 meses". Para último acesso, onde a ordem de grandeza basta. */
export function haQuanto(iso: string | null): string {
  if (!iso) return "nunca entrou";
  const dias = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (dias === 0) return "hoje";
  if (Math.abs(dias) < 45) return RELATIVO.format(dias, "day");
  return RELATIVO.format(Math.round(dias / 30), "month");
}
