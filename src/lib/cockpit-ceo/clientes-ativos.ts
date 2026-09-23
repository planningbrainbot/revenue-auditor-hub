// Clientes ativos: definições candidatas lado a lado, por CNPJ distinto, com sobreposição.
//
// "Cliente ativo" não está decidido (pergunta C1). Em vez de escolher uma régua, o cockpit mostra as
// quatro que já existem na casa, cada uma com o próprio número, e quanto elas se sobrepõem. Nenhuma
// é somada a outra.
//
// Penetração por produto é "contratado no CRM": conta da Base, casada pelo CNPJ, com negócio ganho
// no pipe de Monetização daquele produto (mesmo vínculo conta → organização do Pipedrive que a
// Monetização usa). Ganho no CRM não é consumo, nem contrato assinado, nem receita.
import type { Estado } from "./contrato.ts";
import { PRODUTOS } from "../monetizacao/types.ts";
import type { Produto } from "../monetizacao/types.ts";

export type IdDefinicao = "contrato_omie" | "recebeu_90d" | "qb_ativos" | "mrr_positivo";

export const DEFINICOES_CLIENTE: Record<
  IdDefinicao,
  { titulo: string; definicao: string; fonte: string }
> = {
  contrato_omie: {
    titulo: "Contrato de serviço ativo no Omie",
    definicao:
      "CNPJ com contrato de serviço em situação ativa e valor mensal maior que zero no Omie das unidades.",
    fonte: "ops.omie_contratos_servico (situação 10)",
  },
  recebeu_90d: {
    titulo: "Pagou nos últimos 90 dias",
    definicao:
      "CNPJ com título recebido pelas unidades nos últimos 90 dias, pela data de pagamento.",
    fonte: "ops.contas_receber (status recebido)",
  },
  qb_ativos: {
    titulo: "Cliente ativo do cadastro",
    definicao:
      "Empresa com contrato registrado ou com título a vencer no último ano (regra da view da casa).",
    fonte: "ops.qb_clientes_ativos",
  },
  mrr_positivo: {
    titulo: "MRR maior que zero",
    definicao: "Empresa com MRR mensal positivo na cascata Omie → Pipefy → Pipedrive.",
    fonte: "ops.v_cliente_mrr",
  },
};

export const ORDEM_DEFINICOES = Object.keys(DEFINICOES_CLIENTE) as IdDefinicao[];

export interface DefinicaoCliente {
  id: IdDefinicao;
  titulo: string;
  definicao: string;
  fonte: string;
  estado: Estado;
  nota: string | null;
  /** CNPJs distintos, só dígitos. Fica no servidor e na memória da tela; nunca em arquivo. */
  cnpjs: string[];
  foraDoFormato: number;
  semDocumento: number;
}

export function montarDefinicao(
  id: IdDefinicao,
  documentos: (string | null | undefined)[],
): DefinicaoCliente {
  const cnpjs = new Set<string>();
  let foraDoFormato = 0;
  let semDocumento = 0;
  for (const d of documentos) {
    const digitos = (d ?? "").replace(/\D/g, "");
    if (!digitos) semDocumento++;
    else if (digitos.length === 14) cnpjs.add(digitos);
    else foraDoFormato++;
  }
  // Registro sem documento é empresa que a contagem por CNPJ não enxerga: a definição fica parcial.
  // CPF é outra coisa — exclusão conhecida da contagem por CNPJ, declarada na linha.
  return {
    id,
    ...DEFINICOES_CLIENTE[id],
    estado: semDocumento ? "parcial" : "disponivel",
    nota: semDocumento
      ? `${semDocumento} ${semDocumento === 1 ? "registro sem documento fica" : "registros sem documento ficam"} fora da contagem por CNPJ`
      : null,
    cnpjs: [...cnpjs].sort(),
    foraDoFormato,
    semDocumento,
  };
}

export function definicaoSemDado(id: IdDefinicao, estado: Estado, nota: string): DefinicaoCliente {
  return { ...montarDefinicao(id, []), estado, nota };
}

/** Projeção mínima da conta da Base: chave, organizações do Pipedrive e CNPJs. */
export interface ContaCnpj {
  key: string;
  orgs: number[];
  cnpjs: string[];
}

export interface NegocioMin {
  org_id: number | null;
  route: string;
  status: string;
}

export interface ResumoDefinicao {
  id: IdDefinicao;
  titulo: string;
  definicao: string;
  fonte: string;
  estado: Estado;
  nota: string | null;
  cnpjs: number | null;
  foraDoFormato: number;
  semDocumento: number;
  /** Contas da Base com ao menos um CNPJ na definição; null sem a carga da Base. */
  contasBase: number | null;
  semContaBase: number | null;
  penetracao: { produto: Produto; contas: number; parcela: number | null }[] | null;
}

export interface ResumoClientes {
  definicoes: ResumoDefinicao[];
  sobreposicao: { a: IdDefinicao; b: IdDefinicao; ambos: number }[];
  uniao: number | null;
  emTodas: number | null;
  penetracaoEstado: Estado;
  avisos: string[];
}

const temNumero = (e: Estado) => e === "disponivel" || e === "parcial";

export function resumirClientes(
  definicoes: DefinicaoCliente[],
  contas: ContaCnpj[] | null,
  negocios: NegocioMin[],
  acesso: { acessoNegocios: boolean },
): ResumoClientes {
  const avisos: string[] = [];
  const validas = definicoes.filter((d) => temNumero(d.estado));
  const fora = definicoes.filter((d) => !temNumero(d.estado));
  if (fora.length)
    avisos.push(
      `${fora.map((d) => d.titulo).join(", ")}: sem número (${fora.map((d) => d.nota ?? d.estado).join("; ")}); fora da união e da sobreposição.`,
    );

  // CNPJ → contas da Base. Uma conta com dois CNPJs na mesma definição conta uma vez.
  const contasDoCnpj = new Map<string, string[]>();
  for (const conta of contas ?? [])
    for (const cnpj of conta.cnpjs) {
      const k = cnpj.replace(/\D/g, "");
      if (k.length !== 14) continue;
      contasDoCnpj.set(k, [...(contasDoCnpj.get(k) ?? []), conta.key]);
    }
  // Conta → produtos com negócio ganho, pelo mesmo vínculo por organização da Monetização.
  const ganhosDaOrg = new Map<number, Set<string>>();
  for (const n of negocios)
    if (n.status === "won" && n.org_id !== null) {
      if (!ganhosDaOrg.has(n.org_id)) ganhosDaOrg.set(n.org_id, new Set());
      ganhosDaOrg.get(n.org_id)!.add(n.route);
    }
  const emVarias = [...contasDoCnpj.values()].filter((ks) => new Set(ks).size > 1).length;
  if (emVarias)
    avisos.push(
      `${emVarias} ${emVarias === 1 ? "CNPJ está em mais de uma conta" : "CNPJs estão em mais de uma conta"} da Base: por isso "contas na Base" pode passar do número de CNPJs.`,
    );
  const produtosDaConta = new Map<string, Set<string>>();
  for (const conta of contas ?? [])
    produtosDaConta.set(
      conta.key,
      new Set(conta.orgs.flatMap((o) => [...(ganhosDaOrg.get(o) ?? [])])),
    );

  // Com acesso, a penetração é parcial por construção: o pipe de Monetização é recente e não guarda
  // o consumo anterior a ele.
  const penetracaoEstado: Estado =
    !contas || !acesso.acessoNegocios ? "acesso_insuficiente" : "parcial";
  if (!contas) avisos.push("Sem a carga da Base de clientes, os CNPJs não são casados com contas.");
  else if (!acesso.acessoNegocios)
    avisos.push(
      "Sem acesso aos negócios de Monetização, a penetração por produto não é calculada.",
    );
  else {
    const ganhos = negocios.filter((n) => n.status === "won").length;
    avisos.push(
      `Penetração é ganho no CRM (negócio ganho no pipe de Monetização do produto); não é consumo, contrato assinado nem receita. O pipe tem ${ganhos} ${ganhos === 1 ? "negócio ganho" : "negócios ganhos"} visíveis para você: quem já consumia o produto antes dele não aparece aqui.`,
    );
  }

  const resumo = definicoes.map((d): ResumoDefinicao => {
    const base = {
      id: d.id,
      titulo: d.titulo,
      definicao: d.definicao,
      fonte: d.fonte,
      estado: d.estado,
      nota: d.nota,
      foraDoFormato: d.foraDoFormato,
      semDocumento: d.semDocumento,
    };
    if (!temNumero(d.estado))
      return { ...base, cnpjs: null, contasBase: null, semContaBase: null, penetracao: null };
    if (!contas)
      return {
        ...base,
        cnpjs: d.cnpjs.length,
        contasBase: null,
        semContaBase: null,
        penetracao: null,
      };
    const casadas = new Set<string>();
    let semConta = 0;
    for (const cnpj of d.cnpjs) {
      const ks = contasDoCnpj.get(cnpj);
      if (!ks) semConta++;
      else ks.forEach((k) => casadas.add(k));
    }
    const penetracao = acesso.acessoNegocios
      ? PRODUTOS.map((produto) => {
          const n = [...casadas].filter((k) => produtosDaConta.get(k)?.has(produto)).length;
          return { produto, contas: n, parcela: casadas.size ? n / casadas.size : null };
        })
      : null;
    return {
      ...base,
      cnpjs: d.cnpjs.length,
      contasBase: casadas.size,
      semContaBase: semConta,
      penetracao,
    };
  });

  const conjuntos = validas.map((d) => [d.id, new Set(d.cnpjs)] as const);
  const sobreposicao: ResumoClientes["sobreposicao"] = [];
  for (let i = 0; i < conjuntos.length; i++)
    for (let j = i + 1; j < conjuntos.length; j++) {
      const [a, sa] = conjuntos[i];
      const [b, sb] = conjuntos[j];
      let ambos = 0;
      for (const x of sa) if (sb.has(x)) ambos++;
      sobreposicao.push({ a, b, ambos });
    }
  const uniao = conjuntos.length ? new Set(conjuntos.flatMap(([, s]) => [...s])).size : null;
  const emTodas = conjuntos.length
    ? [...conjuntos[0][1]].filter((x) => conjuntos.every(([, s]) => s.has(x))).length
    : null;
  return { definicoes: resumo, sobreposicao, uniao, emTodas, penetracaoEstado, avisos };
}
