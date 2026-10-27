// Regra de cliente na Base (Pedro, 15/10/2026, proposta "Base à Prova de Criança", versão 14): a leitura pura de
// `base.situacao`, que o banco grava (`ops.base_conta_situacao`, migration 20261015170000). Imports relativos com
// extensão: os testes (tests/base-regra-cliente.test.mjs) importam este arquivo no Node.
import { normal } from "../monetizacao/model.ts";
import type { Conta } from "../monetizacao/types";
import type { EstadoCliente, SituacaoCliente } from "../clientes-base";
import type { TomStatus } from "@/components/planning";

/** As faixas da barra de confiança, da mais certa para a menos: os 4 graus de cliente e o que fica fora da regra. */
export const FAIXAS = [
  "g4",
  "g3",
  "g2",
  "g1",
  "a_confirmar",
  "nao_cliente",
  "ex_cliente",
  "fornecedor",
  "grupo",
] as const;
export type Faixa = (typeof FAIXAS)[number] | "sem_situacao";

/** Rótulo, cor (só tokens) e o que dizer em reunião, por faixa. */
export const FAIXA_META: Record<
  Faixa,
  { rotulo: string; barra: string; tom: TomStatus; cita: string; grau?: number }
> = {
  g4: {
    rotulo: "Pagamento visto",
    barra: "bg-success",
    tom: "sucesso",
    cita: "pode citar",
    grau: 4,
  },
  g3: {
    rotulo: "Prova de cliente",
    barra: "bg-success/70",
    tom: "sucesso",
    cita: "pode citar",
    grau: 3,
  },
  g2: {
    rotulo: "Base Antiga sem prova",
    barra: "bg-success/45",
    tom: "sucesso",
    cita: "pode citar",
    grau: 2,
  },
  g1: {
    rotulo: "Base Nova sem prova",
    barra: "bg-success/25",
    tom: "sucesso",
    cita: "pode citar",
    grau: 1,
  },
  a_confirmar: {
    rotulo: "A confirmar",
    barra: "bg-warning/60",
    tom: "atencao",
    cita: "confirme antes de citar",
  },
  nao_cliente: {
    rotulo: "Não é cliente",
    barra: "bg-muted-foreground/25",
    tom: "neutro",
    cita: "não cite",
  },
  ex_cliente: { rotulo: "Ex-cliente", barra: "bg-info/70", tom: "info", cita: "não cite" },
  fornecedor: { rotulo: "Fornecedor", barra: "bg-danger/40", tom: "perigo", cita: "não cite" },
  grupo: {
    rotulo: "Empresa do grupo",
    barra: "bg-muted-foreground/50",
    tom: "neutro",
    cita: "não cite",
  },
  sem_situacao: {
    rotulo: "A calcular",
    barra: "bg-muted",
    tom: "neutro",
    cita: "aguarde a próxima atualização",
  },
};

/** A faixa da conta pela situação gravada na ficha. Sem situação (conta nova), "a calcular". */
export function faixaDe(s: SituacaoCliente | null | undefined): Faixa {
  if (!s) return "sem_situacao";
  if (s.estado === "cliente") return `g${s.grau ?? 1}` as Faixa;
  return s.estado as Exclude<EstadoCliente, "cliente">;
}
export const faixaDaConta = (a: Conta) => faixaDe(a.base?.situacao);
export const ehCliente = (a: Conta) => a.base?.situacao?.estado === "cliente";
export const ehExCliente = (a: Conta) => a.base?.situacao?.estado === "ex_cliente";
/**
 * Quem a regra diz que não é cliente sai das telas da Base (Pedro, 27/10/2026: "se tá nessa regra de cliente que não é
 * cliente, é melhor tirar"). Eram cadastros do Omie sem contrato, título, tag nem Pipefy: 1.423 só em Curitiba.
 */
export const foraDaBase = (a: Conta) => a.base?.situacao?.estado === "nao_cliente";

/**
 * De onde vem a certeza de cada cliente (27/10/2026, para a unidade conferir na tela o número de clientes): o sinal mais
 * forte, um só por conta, nesta ordem. "Pagamento recente" é o grau 4 sem contrato ativo (recebimento em 90 dias ou
 * faturamento recente do grupo); "antigo" é contrato ou título no Omie sem pagamento recente.
 */
export const SINAIS = [
  "contrato_ativo",
  "pagamento_recente",
  "omie_antigo",
  "ganho",
  "pipefy",
  "tag",
] as const;
export type Sinal = (typeof SINAIS)[number];
export const SINAL_META: Record<Sinal, { rotulo: string; dica: string }> = {
  contrato_ativo: {
    rotulo: "Contrato ativo no Omie",
    dica: "Contrato de serviço ativo em algum aplicativo do Omie.",
  },
  pagamento_recente: {
    rotulo: "Pagamento nos últimos 90 dias",
    dica: "Sem contrato ativo, mas com recebimento ou faturamento do grupo nos últimos 90 dias.",
  },
  omie_antigo: {
    rotulo: "Contrato ou título antigo no Omie",
    dica: "Tem contrato ou título no Omie, sem pagamento nos últimos 90 dias.",
  },
  ganho: {
    rotulo: "Negócio ganho no Pipedrive",
    dica: "Ganho no Inside Sales ou em Sócios, ainda sem contrato nem título no Omie.",
  },
  pipefy: {
    rotulo: "Só na base do Pipefy",
    dica: "Card na base de clientes do Pipefy, sem contrato, título nem negócio ganho.",
  },
  tag: {
    rotulo: "Só a tag Cliente do Omie",
    dica: "Só a tag Cliente no Omie da unidade ou da Matriz.",
  },
};
export function sinalDoCliente(a: Conta): Sinal | null {
  const s = a.base?.situacao;
  if (s?.estado !== "cliente") return null;
  const criterios = s.criterios ?? [];
  if (a.base?.prova?.contrato_ativo) return "contrato_ativo";
  if (s.grau === 4) return "pagamento_recente";
  if (criterios.includes("contrato ou recebimento no Omie")) return "omie_antigo";
  if (criterios.includes("negócio ganho no Pipedrive")) return "ganho";
  if (criterios.includes("base de clientes do Pipefy")) return "pipefy";
  return "tag";
}
/** Clientes por sinal, na ordem de `SINAIS`. */
export function contarSinais(contas: readonly Conta[]) {
  const c = Object.fromEntries(SINAIS.map((s) => [s, 0])) as Record<Sinal, number>;
  for (const a of contas) {
    const s = sinalDoCliente(a);
    if (s) c[s] += 1;
  }
  return c;
}

/** Contagem por faixa, na ordem da barra. */
export function contarFaixas(contas: readonly Conta[]) {
  const c = Object.fromEntries([...FAIXAS, "sem_situacao"].map((f) => [f, 0])) as Record<
    Faixa,
    number
  >;
  for (const a of contas) c[faixaDaConta(a)] += 1;
  return c;
}
export const totalClientes = (c: Record<Faixa, number>) => c.g4 + c.g3 + c.g2 + c.g1;

/** A ordem da lista: mais certeza primeiro (grau 4 a 1), depois o resto, e o nome. */
const ORDEM_FAIXA = Object.fromEntries(
  ([...FAIXAS, "sem_situacao"] as Faixa[]).map((f, i) => [f, i]),
) as Record<Faixa, number>;
export const porCerteza = (a: Conta, b: Conta) =>
  ORDEM_FAIXA[faixaDaConta(a)] - ORDEM_FAIXA[faixaDaConta(b)] ||
  a.name.localeCompare(b.name, "pt-BR");

/** Busca por nome, CNPJ, unidade ou segmento (a mesma régua do topo da Base). */
export function casaBusca(a: Conta, q: string) {
  if (!q.trim()) return true;
  const digitos = q.replace(/\D/g, "");
  if (digitos.length >= 3 && a.base?.cnpjs.some((c) => c.includes(digitos))) return true;
  return normal([a.name, a.segment, a.unit_label, ...(a.base?.cnpjs || [])].join(" ")).includes(
    normal(q),
  );
}
