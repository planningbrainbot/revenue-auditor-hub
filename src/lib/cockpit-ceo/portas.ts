// Porta de leitura de cada fonte do cockpit: espelho das policies de SELECT da RLS (lidas em
// 22/09/2026). Serve para o servidor dizer "acesso insuficiente" ANTES de ler: sem isso, uma tabela
// que a RLS devolve vazia vira "0 clientes" ou "nenhum churn" com cara de dado.
//
// Só entram papéis e chaves que liberam a tabela INTEIRA. Leitura por unidade (sócio) e papel
// customizado ficam de fora de propósito: na dúvida, a porta fecha. Se uma policy mudar, esta tabela
// precisa mudar junto — os testes de perfis (scripts/cockpit-ceo/perfis.mjs) medem a RLS real.
import type { IdDefinicao } from "./clientes-ativos.ts";

export type FonteRls =
  | "omie_contratos_servico"
  | "contas_receber"
  | "empresas"
  | "contratos_documentos"
  | "contratos"
  | "central_tratativas"
  | "royalties_apuracao"
  | "unidades";

export const PORTAS: Record<FonteRls, { papeis: string[]; chaves: string[]; nome: string }> = {
  omie_contratos_servico: { papeis: [], chaves: ["view.clientes"], nome: "contratos do Omie" },
  contas_receber: {
    papeis: ["admin", "diretor", "auditor"],
    chaves: ["view.contas_receber", "view.reconciliacao", "view.painel_cs"],
    nome: "contas a receber",
  },
  empresas: {
    papeis: ["admin", "diretor", "auditor"],
    chaves: ["view.clientes", "view.painel_cs", "view.base_contatos", "view.fila_cella"],
    nome: "cadastro de empresas",
  },
  contratos_documentos: {
    papeis: [],
    chaves: ["view.painel_cs", "view.fila_cella"],
    nome: "contratos do Pipefy",
  },
  contratos: {
    papeis: ["admin", "diretor", "auditor"],
    chaves: [
      "view.clientes",
      "view.painel_cs",
      "view.reconciliacao",
      "view.rede_ltv",
      "view.fila_cella",
    ],
    nome: "contratos ganhos",
  },
  central_tratativas: {
    papeis: ["admin", "diretor", "auditor"],
    chaves: ["view.clientes", "view.painel_cs", "view.fila_cella"],
    nome: "Central de Tratativas",
  },
  royalties_apuracao: { papeis: ["admin", "diretor"], chaves: [], nome: "apuração de royalties" },
  unidades: {
    papeis: ["admin", "diretor", "auditor"],
    chaves: ["view.clientes", "view.base_contatos", "view.disparos_whatsapp"],
    nome: "cadastro de unidades",
  },
};

export interface AcessoMin {
  roles: string[];
  permissions: string[];
}

export function fontesSemAcesso(fontes: FonteRls[], a: AcessoMin): FonteRls[] {
  return fontes.filter(
    (f) =>
      !PORTAS[f].papeis.some((p) => a.roles.includes(p)) &&
      !PORTAS[f].chaves.some((k) => a.permissions.includes(k)),
  );
}

/** Fontes que cada definição de cliente ativo lê. `qb_clientes_ativos` roda como dono da view: a
 * porta dela é a de `empresas`, para a view não abrir o que a RLS fecha. `v_cliente_mrr` é
 * security_invoker e cascateia Omie → Pipefy → Pipedrive: sem uma delas o MRR sai errado, não zero. */
export const FONTES_DEFINICAO: Record<IdDefinicao, FonteRls[]> = {
  contrato_omie: ["omie_contratos_servico"],
  recebeu_90d: ["contas_receber"],
  qb_ativos: ["empresas"],
  mrr_positivo: ["omie_contratos_servico", "contratos_documentos", "contratos", "empresas"],
};

export const FONTES_COORTES: FonteRls[] = ["contratos", "central_tratativas", "unidades"];
export const FONTES_REDE: FonteRls[] = ["royalties_apuracao", "unidades"];

export function faltasDasDefinicoes(a: AcessoMin): Record<IdDefinicao, FonteRls[]> {
  return Object.fromEntries(
    Object.entries(FONTES_DEFINICAO).map(([id, fontes]) => [id, fontesSemAcesso(fontes, a)]),
  ) as Record<IdDefinicao, FonteRls[]>;
}

export const motivoSemAcesso = (faltam: FonteRls[]) =>
  `sua conta não lê ${faltam.map((f) => PORTAS[f].nome).join(", ")} por inteiro`;
