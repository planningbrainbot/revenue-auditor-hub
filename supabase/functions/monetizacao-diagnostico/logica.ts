/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive e do banco chega sem tipo. */
// Base nova da Monetização: pipe 40 (Onboarding | Diagnóstico de Oportunidades), pedido do Pedro em 16/10/2026.
// Três trabalhos por rodada, nesta ordem:
//   1. carga: lê o pipe 40 inteiro (cards, histórico de etapas, produtos e atividades) e grava o retrato no banco;
//   2. entrada: cliente que concluiu o onboarding do CS (Pipefy) há pelo menos 30 dias, de Lucro Real ou Presumido de
//      R$ 10 mi para cima pela venda, vira card no pipe 40, um por conta, no nome do Matheus (22/10/2026; de 19 a 21/10
//      era a venda ganha no Inside Sales e de 21 a 22/10 o kickoff). Quem tem perfil de Consultoria é cadastrado na
//      plataforma da Consultoria no mesmo dia, se o CNPJ ainda não tiver projeto lá;
//   3. tarefas: cada etapa cria as tarefas dela (regua.ts) e, quando o card sai, apaga as que não foram feitas. Card com
//      nota fixada "Pausado em" não recebe tarefa; a que a pausa tirou do Pipedrive volta quando a nota sair.
// A carga só lê o Pipedrive. A entrada e as tarefas escrevem, e cada uma tem a própria chave: desligada, a rodada
// calcula o que faria e grava como prévia (a tela mostra), sem escrever no Pipedrive nem nas tabelas de estado.
//
// Sem API do Deno: roda na Edge Function (index.ts) e nos testes do Node. Pipedrive e banco entram injetados.
// A carga do pipe 39 (monetizacao-crm) é outra e não muda: IDU, ranking e Cockpits leem só a dela.
import {
  dataSP,
  ehDiaUtil,
  escolherTipos,
  instante,
  notaHtml,
  vencimentoUtc,
} from "../monetizacao-cadencia/logica.ts";
import {
  ETAPA,
  HORA_TAREFA,
  NUMERO_ETAPA,
  PRAZO_CLIENTE,
  PRAZO_INTERNO,
  REGUA,
  VERSAO_REGUA,
  type ItemDiagnostico,
  type Regime,
} from "./regua.ts";

export const PIPE = 40;
/** Gestor de todo card do pipe 40 (decisão do Pedro, 16/10/2026). */
export const MATHEUS = 28381245;
/** Sócia que apresenta o diagnóstico: as tarefas dela vão para ela. */
export const JORDANA = 24067177;
export const URL_CARD = "https://grupoplanning.pipedrive.com/deal/";

/** Chaves dos campos do Pipedrive (dealFields). Os seis primeiros vêm da venda; os outros são do pipe 40 (E0, 16/10). */
export const CAMPO = {
  regime: "093e25bbb3aff5d379b996da8fcec39667c6ae4e",
  faixa: "b92a608454a6648327f24c5cc3bf87a95bb7fbcd",
  origem: "58073314c4a94280b97ee6849824a5025c31b45d",
  subOrigem: "a1524e83615fc3d866165b599956bf6941855304",
  unidade: "5684f15458abf85ed384837a8eb515294350f5cc",
  segmento: "adee29ce10d83d576d5456dbb26a138fa95cb9fe",
  cnpj: "f37f5a5c865fe4f49f16233ed97a989cab34dc7d",
  fatConferido: "3e3c660400e70b7b9f432259f0b3943f55b48bc4",
  link: "8ae8e0052d877f18ec8c629192454abda64b9f54",
  d0: "e8ced60e9eff1b5a9c37da9d1202e28eb81a20a8",
  prazo: "91c8b0e389ec832ac72925c18716d386e19b2645",
  statusConsultoria: "fde49d779e13e1971360899aa0ac59bd42a21a8a",
  statusFinance: "f41df67212461e22608766ef09dd1c05087bcbd4",
  statusTeses: "c834549eebcf24dd48cbbd8d80e70eec7c32d403",
  naoVendido: "8e2ce106695db5e49e07e6f8c6d8bf2e18c2be30",
  vendaOrigem: "a37dc769197575b0bde4d3cad8293160eed47a5d",
} as const;

/** Opções do campo de regime da venda ("Qual é o regime tributário da sua empresa?"). */
export const REGIME_OPCAO: Readonly<Record<string, Regime | "simples">> = {
  "352": "real",
  "351": "presumido",
  "350": "simples",
};
/** Faixas de faturamento que entram no Presumido: de R$ 10 mi para cima (decisão do Pedro, 16/10/2026). */
export const FAIXA_ENTRA: ReadonlySet<string> = new Set(["777", "778", "779", "440", "441", "780"]);
export const STATUS_AREA: Readonly<Record<string, "pendente" | "entregue" | "sem_oportunidade">> = {
  "1160": "pendente",
  "1161": "entregue",
  "1162": "sem_oportunidade",
  "1163": "pendente",
  "1164": "entregue",
  "1165": "sem_oportunidade",
  "1166": "pendente",
  "1167": "entregue",
  "1168": "sem_oportunidade",
};
/** Produtos do catálogo, um por área (E0, 16/10/2026). */
export const PRODUTO: Readonly<Record<string, "consultoria" | "finance" | "teses">> = {
  "61": "consultoria",
  "62": "finance",
  "63": "teses",
};
export const NOME_PRODUTO: Readonly<Record<string, string>> = {
  consultoria: "Consultoria",
  finance: "Finance",
  teses: "Teses Jurídicas",
};
/** Teto de cobranças da pasta por entrada na etapa 03 (uma a cada 7 dias). */
export const MAX_COBRANCAS = 8;

// ---------------------------------------------------------------------------- utilidades

const id = (v: any): number | null => {
  const n = Number(v && typeof v === "object" ? (v.value ?? v.id) : v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const texto = (v: any): string | null => {
  if (v == null) return null;
  if (typeof v === "object")
    return v.name != null ? String(v.name) : v.value != null ? String(v.value) : null;
  const s = String(v).trim();
  return s ? s : null;
};
/** Valor de um campo personalizado no formato v1 (chave no topo) ou v2 (`custom_fields`). */
export function campo(deal: any, chave: string): any {
  if (!deal) return null;
  if (deal.custom_fields && chave in deal.custom_fields) return deal.custom_fields[chave];
  return deal[chave] ?? null;
}
const opcao = (v: any): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "object")
    return v.id != null ? String(v.id) : v.value != null ? String(v.value) : null;
  return String(v).split(",")[0].trim() || null;
};

function somarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
/** O próprio dia, se for útil; senão o próximo dia útil (sem sábado, domingo e feriado). */
export function proximoDiaUtil(dia: string): string {
  let d = dia;
  while (!ehDiaUtil(d)) d = somarDias(d, 1);
  return d;
}
/** Vencimento de uma tarefa `dias` corridos depois de `base` (data de São Paulo), jogado para o dia útil seguinte. */
export function vencimentoDiagnostico(base: string, dias: number): string {
  return proximoDiaUtil(somarDias(base, dias));
}
export const diasCorridos = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
const dataBR = (dia: string | null) =>
  dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : null;

// ---------------------------------------------------------------------------- entrada (venda → card)

export type Elegibilidade = { entra: boolean; regime: Regime | "simples" | null; motivo: string };

/**
 * Quem entra no pipe 40: Lucro Real, ou Lucro Presumido de R$ 10 mi para cima, pelo que a venda declarou. Venda sem
 * organização entra: o cliente vem do onboarding, e o card fica um por venda.
 */
export function elegibilidade(venda: any): Elegibilidade {
  const regime = REGIME_OPCAO[opcao(campo(venda, CAMPO.regime)) ?? ""] ?? null;
  if (regime === "real") return { entra: true, regime, motivo: "Lucro Real" };
  if (regime === "presumido") {
    const faixa = opcao(campo(venda, CAMPO.faixa));
    return FAIXA_ENTRA.has(faixa ?? "")
      ? { entra: true, regime, motivo: "Lucro Presumido de R$ 10 mi para cima" }
      : { entra: false, regime, motivo: "Lucro Presumido abaixo de R$ 10 mi" };
  }
  if (regime === "simples") return { entra: false, regime, motivo: "Simples Nacional" };
  return { entra: false, regime, motivo: "sem regime na venda" };
}

/** Data de ganho da venda, em São Paulo. */
export const ganhoEm = (venda: any): string | null => {
  const t = instante(venda?.won_time);
  return t ? dataSP(t) : null;
};

/** Corpo do POST /v1/deals do card novo do pipe 40, herdando da venda o que o processo pede. */
export function cardDaVenda(venda: any, nomeDaConta: string | null): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    title:
      nomeDaConta ||
      String(venda?.title ?? "").replace(/\s*\(.*\)\s*$/, "") ||
      `Venda ${venda?.id}`,
    org_id: id(venda?.org_id),
    user_id: MATHEUS,
    pipeline_id: PIPE,
    stage_id: ETAPA.novo,
    [CAMPO.vendaOrigem]: `${URL_CARD}${venda?.id}`,
  };
  const pessoa = id(venda?.person_id);
  if (pessoa) corpo.person_id = pessoa;
  for (const k of [
    CAMPO.regime,
    CAMPO.faixa,
    CAMPO.origem,
    CAMPO.subOrigem,
    CAMPO.unidade,
    CAMPO.segmento,
  ]) {
    const v = opcao(campo(venda, k));
    if (v) corpo[k] = v;
  }
  const cnpj = campo(venda, CAMPO.cnpj);
  if (cnpj != null && cnpj !== "" && Number(cnpj) > 1) corpo[CAMPO.cnpj] = cnpj;
  return corpo;
}

/** Nota fixada no card novo: o que veio da venda e do onboarding, para o Matheus não abrir o card do Inside Sales. */
export function notaDaVenda(
  venda: any,
  rotulo: (chave: string, valor: any) => string | null,
  cliente?: ClienteOnboarding,
  extras: (string | undefined)[] = [],
): string {
  const linha = (nome: string, chave: string) =>
    `${nome}: ${rotulo(chave, campo(venda, chave)) ?? "—"}`;
  const valor = Number(venda?.value);
  return notaHtml(
    [
      "Diagnóstico de Oportunidades e Riscos · dados da venda",
      `Venda: ${URL_CARD}${venda?.id} (ganha em ${dataBR(ganhoEm(venda)) ?? "—"})`,
      linha("Regime declarado", CAMPO.regime),
      linha("Faturamento declarado", CAMPO.faixa),
      linha("Origem", CAMPO.origem),
      linha("Sub-origem", CAMPO.subOrigem),
      linha("Unidade de negócio", CAMPO.unidade),
      linha("Segmento", CAMPO.segmento),
      Number.isFinite(valor) && valor > 0
        ? `Valor da venda do BPO: R$ ${valor.toLocaleString("pt-BR")}`
        : null,
      cliente
        ? `Onboarding do CS: ${cliente.fase_atual ?? "—"} (card ${cliente.pipefy_card_id} no Pipefy)`
        : null,
      ...extras.filter((x): x is string => !!x),
      "",
      'Etapa 01: confira regime e faturamento antes de mover. Fora do perfil, Perdido com o motivo "Fora do escopo".',
    ]
      .filter((x) => x != null)
      .join("\n"),
  );
}

// ---------------------------------------------------------------------------- onboarding (porta de entrada, 21/10/2026)

/**
 * Cliente do onboarding do CS (Pipefy), pelo espelho do Handoff da Consultoria: o card do onboarding só nasce quando o
 * contrato vai para "Enviar para Onboarding", então estar aqui já é ter assinado.
 */
export type ClienteOnboarding = {
  pipefy_card_id: string;
  titulo: string;
  unidade: string | null;
  fase_atual: string | null;
  /** Fases por que o card passou (fases_history), com o instante de entrada em cada uma. */
  fases: { fase: string; entrou_em: string | null }[];
  /** Negócio do Pipedrive ligado ao card (a venda). */
  pipedrive_deal_id: number | null;
  /** CNPJ do espelho do Handoff (reserva para quando a venda não tem). */
  cnpj?: string | null;
  /** Como a venda foi achada quando o handoff não a liga (23/10/2026). Ausente = veio do handoff. */
  vinculo?: "cnpj" | "nome";
};

/** Fases que contam como "concluiu o onboarding" (decisão do Pedro, 22/10/2026). */
const SAIDA_DO_ONBOARDING = /conclu[ií]do|check-?out|pesquisa de esfor/i;
const CHURN = /churn/i;
/** O pipe 40 trabalha o cliente 30 dias depois de ele concluir o onboarding: antes disso a documentação não chega. */
export const DIAS_DEPOIS_DO_ONBOARDING = 30;
/** Motivo de perda de quem saiu do pipe 40 esperando os 30 dias (22/10/2026): o card volta à etapa 01 no 30º dia. */
export const MOTIVO_ESPERA_ONBOARDING = "Aguardando 30 dias do onboarding";
/** Os dois motivos de espera: o de 21/10 ("Ainda não passou pelo onboarding") volta pela mesma regra. */
export const MOTIVOS_DE_ESPERA = [
  MOTIVO_ESPERA_ONBOARDING,
  "Ainda não passou pelo onboarding",
] as const;

/** O dia (São Paulo) em que o cliente concluiu o onboarding: a primeira entrada numa fase de saída. Churn: nunca. */
export function saidaDoOnboarding(c: ClienteOnboarding): string | null {
  if (c.fase_atual && CHURN.test(c.fase_atual)) return null;
  const dias = c.fases
    .filter((f) => SAIDA_DO_ONBOARDING.test(f.fase) && f.entrou_em)
    .map((f) => dataSP(instante(f.entrou_em) as Date))
    .sort();
  return dias[0] ?? null;
}

/**
 * Perfil de Consultoria (call de 05/10/2026 e regra de 06/10): Lucro Real, ou Lucro Presumido de R$ 50 mi para cima.
 * Mais estreito que o do pipe 40 (Presumido de R$ 10 mi).
 */
const FAIXA_CONSULTORIA: ReadonlySet<string> = new Set(["779", "440", "441", "780"]);
export function fitConsultoria(venda: any): boolean {
  const regime = REGIME_OPCAO[opcao(campo(venda, CAMPO.regime)) ?? ""] ?? null;
  if (regime === "real") return true;
  return regime === "presumido" && FAIXA_CONSULTORIA.has(opcao(campo(venda, CAMPO.faixa)) ?? "");
}
/** CNPJ com 14 dígitos, ou null (o formulário de venda aceita 0 e texto livre). */
export function cnpjDe(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 14 && !/^(\d)\1+$/.test(d) ? d : null;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
/** A unidade do cliente está entre as pausadas (MONET_DIAG_UNIDADES_PAUSADAS, ex.: Belém até o sócio liberar a lista). */
export function unidadePausada(
  pausadas: readonly string[] | undefined,
  unidades: (string | null)[],
) {
  const alvo = new Set((pausadas ?? []).map(semAcento).filter(Boolean));
  return unidades.find((u) => !!u && alvo.has(semAcento(u))) ?? null;
}

// ---------------------------------------------------------------------------- venda sem vínculo no handoff (23/10/2026)

/** Pipes onde mora a venda do cliente do onboarding: Inside Sales (2) e os dois que o handoff também já ligou. */
export const PIPES_DE_VENDA: ReadonlySet<number> = new Set([2, 4, 28]);
/** A venda vem antes do onboarding: ganha até 240 dias antes de o cliente concluir, e nunca depois. */
const JANELA_DA_VENDA_DIAS = 240;
/** Buscas de venda por rodada; cada uma faz de 2 a 6 chamadas ao Pipedrive. */
export const BUSCAS_POR_RODADA = 8;
/** Busca que não achou a venda (ou achou de mais de uma conta) tenta de novo depois de um dia. */
export const NOVA_BUSCA_MS = 86_400_000;

/** O que a busca achou para um card do onboarding (ops.monetizacao_diagnostico_vinculos). */
export type VinculoVenda = {
  pipefy_card_id: string;
  venda_id: number | null;
  como: "cnpj" | "nome" | "nenhum" | "ambiguo";
  candidatos: { id: number; org_id: number | null; won_time: string | null; titulo: string }[];
  tentado_em: string;
};

/** As duas palavras que distinguem o nome do cliente ("SQI OUTSOURCING - YURI CARVALHO" → "SQI OUTSOURCING"). */
export function termoDoNome(titulo: string): string {
  const parte = String(titulo ?? "").split(/ - |,|\(/)[0];
  const limpo = parte.replace(
    /\b(ltda|epp|me|s\.?a\.?|eireli|comercio|com|ind|e|de|da|do|dos|grupo)\b/gi,
    " ",
  );
  return limpo
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .join(" ");
}

/** Toda palavra do termo aparece inteira no título ("Nacional" não casa com "Internacional"). */
export function mesmoNome(termo: string, titulo: string): boolean {
  const palavras = new Set(semAcento(titulo).split(/[^a-z0-9]+/));
  const busca = semAcento(termo)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return busca.length > 0 && busca.every((w) => palavras.has(w));
}

/**
 * Entre as vendas achadas, a do cliente: ganha num pipe de venda, até 240 dias antes de ele concluir o onboarding.
 * Tudo da mesma conta: a venda mais recente. De mais de uma conta: ambíguo, e nada entra.
 */
export function escolherVenda(
  candidatas: readonly any[],
  saida: string,
): { venda_id: number | null; candidatos: VinculoVenda["candidatos"]; unica: boolean } {
  const limite = Date.parse(`${saida}T23:59:59Z`);
  const lista = (candidatas || [])
    .filter((d) => d?.status === "won" && PIPES_DE_VENDA.has(Number(id(d.pipeline_id))))
    .map((d) => ({
      id: Number(d.id),
      org_id: id(d.org_id),
      won_time: d.won_time ?? null,
      titulo: String(d.title ?? "").slice(0, 80),
    }))
    .filter((d) => {
      const t = instante(d.won_time)?.getTime();
      return t !== undefined && t <= limite && limite - t <= JANELA_DA_VENDA_DIAS * 86_400_000;
    });
  const unicos = [...new Map(lista.map((d) => [d.id, d])).values()];
  const contas = new Set(unicos.map((d) => d.org_id ?? `venda ${d.id}`));
  if (contas.size !== 1) return { venda_id: null, candidatos: unicos, unica: false };
  const venda = [...unicos].sort(
    (a, b) => String(b.won_time).localeCompare(String(a.won_time)) || b.id - a.id,
  )[0];
  return { venda_id: venda.id, candidatos: unicos, unica: true };
}

/**
 * Procura a venda do cliente que concluiu o onboarding sem a venda ligada no handoff: pelo CNPJ (na venda ou na
 * organização) e, sem resultado, pelo nome no título da venda.
 */
export async function acharVenda(
  pd: PipedriveDiagnostico,
  cliente: ClienteOnboarding,
  saida: string,
): Promise<Pick<VinculoVenda, "venda_id" | "como" | "candidatos">> {
  const detalhes = async (ids: number[]) =>
    ids.length ? ((await pd.v2("deals", { ids: ids.join(","), limit: 100 }))?.data ?? []) : [];
  const cnpj = cnpjDe(cliente.cnpj);
  if (cnpj) {
    const vendas = new Set<number>();
    const contas = new Set<number>();
    const formatado = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
    for (const term of [cnpj, formatado]) {
      const corpo = await pd.v2("itemSearch", {
        term,
        item_types: "deal,organization",
        fields: "custom_fields",
        exact_match: "true",
        limit: 20,
      });
      for (const it of corpo?.data?.items || []) {
        if (it?.item?.type === "deal") vendas.add(Number(it.item.id));
        if (it?.item?.type === "organization") contas.add(Number(it.item.id));
      }
    }
    const achadas = await detalhes([...vendas]);
    for (const org of contas)
      achadas.push(
        ...((await pd.v2("deals", { org_id: org, status: "won", limit: 100 }))?.data ?? []),
      );
    const r = escolherVenda(achadas, saida);
    if (r.candidatos.length)
      return { venda_id: r.venda_id, como: r.unica ? "cnpj" : "ambiguo", candidatos: r.candidatos };
  }
  const termo = termoDoNome(cliente.titulo);
  if (!termo) return { venda_id: null, como: "nenhum", candidatos: [] };
  const busca = await pd.get("deals/search", {
    term: termo,
    fields: "title",
    status: "won",
    limit: 20,
  });
  const ids = (busca?.data?.items || [])
    .map((it: any) => it?.item)
    .filter(
      (d: any) => d && PIPES_DE_VENDA.has(Number(d.pipeline?.id)) && mesmoNome(termo, d.title),
    )
    .map((d: any) => Number(d.id));
  const r = escolherVenda(await detalhes(ids), saida);
  if (!r.candidatos.length) return { venda_id: null, como: "nenhum", candidatos: [] };
  return { venda_id: r.venda_id, como: r.unica ? "nome" : "ambiguo", candidatos: r.candidatos };
}
/** Nota fixada que pausa o card (lida como `pausa` pela carga, porque começa com "Pausado em"). */
export function notaDePausa(unidade: string, hoje: string): string {
  return notaHtml(
    `Pausado em ${dataBR(hoje)}. A unidade ${unidade} está com a abordagem pausada até o sócio liberar a lista: não ` +
      "fazer contato com a empresa. Para retomar, desafixe ou apague esta nota; as tarefas da etapa voltam sozinhas ao " +
      "Pipedrive em até 30 minutos.",
  );
}

// ---------------------------------------------------------------------------- carga (retrato do pipe 40)

export type Movimento = { stage_id: number; at: string; actor_id: number | null };
export type CardDiagnostico = {
  id: number;
  title: string;
  org: string | null;
  org_id: number | null;
  person: string | null;
  owner_id: number | null;
  owner: string | null;
  status: "open" | "won" | "lost" | string;
  stage_id: number;
  stage_since: string | null;
  add_time: string | null;
  update_time: string | null;
  won_time: string | null;
  lost_time: string | null;
  lost_reason: string | null;
  value: number;
  regime: Regime | "simples" | null;
  regime_rotulo: string | null;
  faixa: string | null;
  origem: string | null;
  sub_origem: string | null;
  unidade: string | null;
  segmento: string | null;
  fat_conferido: number | null;
  link_pasta: string | null;
  d0: string | null;
  prazo: string | null;
  areas: { consultoria: string | null; finance: string | null; teses: string | null };
  nao_vendido: string | null;
  venda_origem: string | null;
  produtos: {
    product_id: number;
    produto: string | null;
    nome: string;
    preco: number;
    quantidade: number;
    total: number;
  }[];
  moves: Movimento[];
  atividades: {
    id: number;
    subject: string;
    type: string | null;
    user_id: number | null;
    due_date: string | null;
    done: boolean;
    done_at: string | null;
    add_time: string | null;
  }[];
  next_activity_date: string | null;
  /**
   * Nota fixada que começa com "Pausado em" (pausa de Belém, 19/10/2026): enquanto ela estiver fixada, o card não
   * recebe tarefa e a tarefa que a pausa tirou do Pipedrive fica guardada para voltar quando a nota sair.
   */
  pausa: NotaDoCard | null;
  /** Última nota de quem trabalha o card (o dono, o Matheus ou a Jordana): a fila do Forecast mostra. */
  ultima_nota: NotaDoCard | null;
  url: string;
  refreshed_at: string;
};
export type NotaDoCard = { em: string; autor_id: number | null; texto: string };

/** Texto corrido de uma nota do Pipedrive (HTML), cortado para caber numa linha da tela. */
export function textoDaNota(html: unknown, limite = 280): string {
  const t = String(html ?? "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > limite ? `${t.slice(0, limite - 1)}…` : t;
}

/** A pausa e a última nota de quem trabalha o card, lidas das notas do card (a mais nova primeiro). */
export function notasDoCard(
  notas: any[] | null,
  dono: number | null,
): { pausa: NotaDoCard | null; ultima_nota: NotaDoCard | null } {
  const lista = [...(notas || [])]
    .filter((n) => n && n.active_flag !== false)
    .sort((a, b) => String(b.add_time).localeCompare(String(a.add_time)));
  const nota = (n: any, limite?: number): NotaDoCard => ({
    em: String(n.add_time ?? ""),
    autor_id: id(n.user_id),
    texto: textoDaNota(n.content, limite),
  });
  const pausa = lista.find(
    (n) => n.pinned_to_deal_flag === true && /^pausado em/i.test(textoDaNota(n.content, 40)),
  );
  const quem = new Set([dono, MATHEUS, JORDANA].filter(Boolean) as number[]);
  const ultima = lista.find((n) => quem.has(id(n.user_id) as number) && textoDaNota(n.content));
  return { pausa: pausa ? nota(pausa, 600) : null, ultima_nota: ultima ? nota(ultima) : null };
}

/** Um card do pipe 40 no formato que a tela lê (sem token, sem campo que a tela não usa). */
export function montarCard(
  deal: any,
  flow: any[] | null,
  produtos: any[] | null,
  atividades: any[] | null,
  rotulo: (chave: string, valor: any) => string | null,
  agora: Date,
  notas: any[] | null = null,
): CardDiagnostico {
  const mudancas = (flow || [])
    .filter((e) => e?.object === "dealChange" && e.data)
    .map((e) => e.data)
    .sort((a, b) => String(a.log_time).localeCompare(String(b.log_time)));
  const etapas = mudancas.filter((e) => e.field_key === "stage_id");
  const moves: Movimento[] = [];
  const inicial = etapas.length ? id(etapas[0].old_value) : id(deal.stage_id);
  if (inicial)
    moves.push({
      stage_id: inicial,
      at: String(deal.add_time ?? ""),
      actor_id: id(deal.creator_user_id),
    });
  for (const e of etapas) {
    const destino = id(e.new_value);
    if (destino) moves.push({ stage_id: destino, at: String(e.log_time), actor_id: id(e.user_id) });
  }
  const area = (chave: string) => STATUS_AREA[opcao(campo(deal, chave)) ?? ""] ?? null;
  const num = (v: any) => {
    const n = Number(v && typeof v === "object" ? v.value : v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: Number(deal.id),
    title: String(deal.title ?? ""),
    org: texto(deal.org_id) ?? texto(deal.org_name),
    org_id: id(deal.org_id),
    person: texto(deal.person_id) ?? texto(deal.person_name),
    owner_id: id(deal.user_id),
    owner: texto(deal.user_id) ?? texto(deal.owner_name),
    status: String(deal.status ?? "open"),
    stage_id: Number(deal.stage_id),
    stage_since: deal.stage_change_time || deal.add_time || null,
    add_time: deal.add_time ?? null,
    update_time: deal.update_time ?? null,
    won_time: deal.won_time ?? null,
    lost_time: deal.lost_time ?? null,
    lost_reason: deal.lost_reason ?? null,
    value: Number(deal.value) || 0,
    regime: REGIME_OPCAO[opcao(campo(deal, CAMPO.regime)) ?? ""] ?? null,
    regime_rotulo: rotulo(CAMPO.regime, campo(deal, CAMPO.regime)),
    faixa: rotulo(CAMPO.faixa, campo(deal, CAMPO.faixa)),
    origem: rotulo(CAMPO.origem, campo(deal, CAMPO.origem)),
    sub_origem: rotulo(CAMPO.subOrigem, campo(deal, CAMPO.subOrigem)),
    unidade: rotulo(CAMPO.unidade, campo(deal, CAMPO.unidade)),
    segmento: rotulo(CAMPO.segmento, campo(deal, CAMPO.segmento)),
    fat_conferido: num(campo(deal, CAMPO.fatConferido)),
    link_pasta: texto(campo(deal, CAMPO.link)),
    d0: texto(campo(deal, CAMPO.d0)),
    prazo: texto(campo(deal, CAMPO.prazo)),
    areas: {
      consultoria: area(CAMPO.statusConsultoria),
      finance: area(CAMPO.statusFinance),
      teses: area(CAMPO.statusTeses),
    },
    nao_vendido: texto(campo(deal, CAMPO.naoVendido)),
    venda_origem: texto(campo(deal, CAMPO.vendaOrigem)),
    produtos: (produtos || []).map((p) => ({
      product_id: Number(p.product_id),
      produto: PRODUTO[String(p.product_id)] ?? null,
      nome: String(p.name ?? ""),
      preco: Number(p.item_price) || 0,
      quantidade: Number(p.quantity) || 1,
      total: Number(p.sum ?? (Number(p.item_price) || 0) * (Number(p.quantity) || 1)) || 0,
    })),
    moves,
    atividades: (atividades || []).map((a) => ({
      id: Number(a.id),
      subject: String(a.subject ?? ""),
      type: a.type ?? null,
      user_id: id(a.user_id),
      due_date: a.due_date ?? null,
      done: a.done === true || a.done === 1,
      done_at: a.marked_as_done_time || null,
      add_time: a.add_time ?? null,
    })),
    next_activity_date: deal.next_activity_date ?? null,
    ...notasDoCard(notas, id(deal.user_id)),
    url: `${URL_CARD}${deal.id}`,
    refreshed_at: agora.toISOString(),
  };
}

// ---------------------------------------------------------------------------- tarefas (régua por etapa)

export type LinhaTarefa = {
  deal_id: number;
  etapa: string;
  entrou_em: string;
  chave: string;
  user_id: number;
  assunto: string;
  due_date: string;
  activity_id: number | null;
  /** "pausada": a pausa do card tirou a atividade do Pipedrive; volta quando a nota de pausa sair. */
  status: "aberta" | "feita" | "apagada" | "pausada";
  versao: string;
  criado_em?: string;
  encerrado_em?: string | null;
  motivo?: string | null;
};
export type TarefaPlanejada = Omit<LinhaTarefa, "activity_id" | "status"> & {
  tipo: ItemDiagnostico["tipo"];
  nota: string;
};

const regimeDoCard = (c: Pick<CardDiagnostico, "regime">): Regime =>
  c.regime === "presumido" ? "presumido" : "real";
const diaDoItem = (item: ItemDiagnostico, regime: Regime) =>
  typeof item.dia === "number" ? item.dia : item.dia[regime];

/** O que o Brain sabe preencher na nota e no assunto; o resto dos colchetes fica para quem executa. */
export function preencher(
  textoBase: string,
  ctx: Record<string, string | null | undefined>,
): string {
  return textoBase.replace(/\[([A-ZÇÃÉÍÓÚÂÊÔ ]+)\]/g, (todo, nome) => {
    const v = ctx[nome];
    return v ? v : todo;
  });
}

function contexto(
  card: CardDiagnostico,
  d0: string | null,
  prazo: string | null,
  produto?: string | null,
) {
  const regime = regimeDoCard(card);
  const interno = d0 ? somarDias(d0, PRAZO_INTERNO[regime]) : null;
  return {
    EMPRESA: card.org || card.title,
    DIAS: String(PRAZO_CLIENTE[regime]),
    "PRAZO PROMETIDO": dataBR(prazo),
    "PRAZO INTERNO": interno ? `${dataBR(interno)} (D+${PRAZO_INTERNO[regime]})` : null,
    REGIME: card.regime_rotulo,
    FAIXA: card.faixa,
    LINK: card.link_pasta,
    PRODUTO: produto ?? null,
  };
}

/** D0 e prazo prometido de uma entrada na etapa 04: os do card quando preenchidos, senão o dia da entrada e +30/+60. */
export function d0ePrazo(card: CardDiagnostico, entrada: string): { d0: string; prazo: string } {
  const d0 = card.d0 || entrada;
  return { d0, prazo: card.prazo || somarDias(d0, PRAZO_CLIENTE[regimeDoCard(card)]) };
}

/** As tarefas que a entrada atual do card cria (sem as cobranças seguintes da etapa 03, que vêm de `proximaCobranca`). */
export function planejarEntrada(
  card: CardDiagnostico,
  regua: readonly ItemDiagnostico[] = REGUA,
  versao = VERSAO_REGUA,
): TarefaPlanejada[] {
  const desde = instante(card.stage_since);
  if (!desde) return [];
  const entrada = dataSP(desde);
  const regime = regimeDoCard(card);
  const { d0, prazo } =
    card.stage_id === ETAPA.execucao ? d0ePrazo(card, entrada) : { d0: card.d0, prazo: card.prazo };
  const ctx = contexto(card, d0, prazo);
  const base = card.stage_id === ETAPA.execucao ? (d0 as string) : entrada;
  return regua
    .filter((i) => i.etapa === card.stage_id && (!i.so || i.so === regime))
    .map((i) => {
      const chave = i.cada ? `${i.chave}-1` : i.chave;
      return {
        deal_id: card.id,
        etapa: String(card.stage_id),
        entrou_em: String(card.stage_since),
        chave,
        user_id: i.quem === "jordana" ? JORDANA : card.owner_id || MATHEUS,
        assunto: `Diagnóstico · ${NUMERO_ETAPA[card.stage_id]} · ${preencher(i.titulo, ctx)}`,
        due_date: vencimentoDiagnostico(base, diaDoItem(i, regime)),
        versao,
        tipo: i.tipo,
        nota: preencher(i.nota, ctx),
      };
    });
}

/** A próxima cobrança da pasta (etapa 03): 7 dias depois da anterior, quando a anterior já venceu. */
export function proximaCobranca(
  card: CardDiagnostico,
  linhas: readonly LinhaTarefa[],
  hoje: string,
  regua: readonly ItemDiagnostico[] = REGUA,
  versao = VERSAO_REGUA,
): TarefaPlanejada | null {
  const item = regua.find((i) => i.etapa === ETAPA.coleta && i.cada);
  if (!item || card.stage_id !== ETAPA.coleta || card.status !== "open") return null;
  const minhas = linhas
    .filter(
      (l) =>
        l.deal_id === card.id &&
        l.entrou_em === String(card.stage_since) &&
        l.chave.startsWith(`${item.chave}-`),
    )
    .sort((a, b) => Number(a.chave.split("-").pop()) - Number(b.chave.split("-").pop()));
  const ultima = minhas[minhas.length - 1];
  if (!ultima || minhas.length >= MAX_COBRANCAS || ultima.due_date > hoje) return null;
  const n = Number(ultima.chave.split("-").pop()) + 1;
  const ctx = contexto(card, card.d0, card.prazo);
  return {
    deal_id: card.id,
    etapa: String(card.stage_id),
    entrou_em: String(card.stage_since),
    chave: `${item.chave}-${n}`,
    user_id: card.owner_id || MATHEUS,
    assunto: `Diagnóstico · ${NUMERO_ETAPA[ETAPA.coleta]} · ${item.titulo} (${n}ª)`,
    due_date: vencimentoDiagnostico(ultima.due_date, item.cada as number),
    versao,
    tipo: item.tipo,
    nota: preencher(item.nota, ctx),
  };
}

/** Card ganho: uma tarefa por produto vendido, para passar o cliente à área que executa. */
export function planejarGanho(
  card: CardDiagnostico,
  regua: readonly ItemDiagnostico[] = REGUA,
  versao = VERSAO_REGUA,
): TarefaPlanejada[] {
  const item = regua.find((i) => i.etapa === "ganho");
  const ganho = instante(card.won_time);
  if (!item || card.status !== "won" || !ganho) return [];
  const produtos = card.produtos.length
    ? card.produtos.map((p) => ({
        chave: `ganho-${p.product_id}`,
        nome: p.produto ? NOME_PRODUTO[p.produto] : p.nome,
      }))
    : [{ chave: "ganho-sem-produto", nome: "o diagnóstico" }];
  const dia = dataSP(ganho);
  return produtos.map((p) => {
    const ctx = contexto(card, card.d0, card.prazo, p.nome);
    return {
      deal_id: card.id,
      etapa: "ganho",
      entrou_em: String(card.won_time),
      chave: p.chave,
      user_id: card.owner_id || MATHEUS,
      assunto: `Diagnóstico · Ganho · ${preencher(item.titulo, ctx)}`,
      due_date: vencimentoDiagnostico(dia, 0),
      versao,
      tipo: item.tipo,
      nota: preencher(item.nota, ctx),
    };
  });
}

/** O tipo e a nota de uma tarefa guardada (a linha do banco não guarda os dois), pela régua da etapa. */
function tipoENota(
  l: LinhaTarefa,
  card: CardDiagnostico,
): { tipo: ItemDiagnostico["tipo"]; nota: string } {
  const plano = [...planejarEntrada(card), ...planejarGanho(card)].find((t) => t.chave === l.chave);
  if (plano) return { tipo: plano.tipo, nota: plano.nota };
  const item = REGUA.find((i) => String(i.etapa) === l.etapa && l.chave.startsWith(`${i.chave}-`));
  return item
    ? { tipo: item.tipo, nota: preencher(item.nota, contexto(card, card.d0, card.prazo)) }
    : { tipo: "task", nota: "" };
}

/** Linha aberta que já não vale: o card saiu da etapa, foi perdido, ganho (fora as de ganho) ou sumiu do pipe. */
export function motivoDeEncerrar(
  linha: LinhaTarefa,
  card: CardDiagnostico | undefined,
): string | null {
  if (!card) return "card fora do pipe 40";
  if (linha.etapa === "ganho") return card.status === "won" ? null : "card deixou de estar ganho";
  if (card.status === "lost") return "card perdido";
  if (card.status === "won") return "card ganho";
  if (String(card.stage_id) !== linha.etapa || String(card.stage_since) !== linha.entrou_em)
    return `saiu da etapa ${NUMERO_ETAPA[Number(linha.etapa)] ?? linha.etapa}`;
  return null;
}

// ---------------------------------------------------------------------------- rodada

export type PipedriveDiagnostico = {
  get(path: string, params?: Record<string, unknown>): Promise<any>;
  pages(path: string, params?: Record<string, unknown>): Promise<any[]>;
  /** GET da API v2 (vendas por id, cards do pipe 39): devolve o corpo inteiro, com o cursor. */
  v2(path: string, params?: Record<string, unknown>): Promise<any>;
  post(path: string, payload: unknown): Promise<any>;
  put(path: string, payload: unknown): Promise<any>;
  del(path: string): Promise<void>;
};
export type StoreDiagnostico = {
  cardsAtuais(): Promise<CardDiagnostico[]>;
  gravarRetrato(retrato: {
    cards: CardDiagnostico[];
    stages: any[];
    previa: unknown;
    resumo: unknown;
  }): Promise<void>;
  entradas(): Promise<EntradaDiagnostico[]>;
  inserirEntrada(linha: Record<string, unknown>): Promise<void>;
  /** Grava o resultado do cadastro na Consultoria numa entrada que já existe (card reaberto, ou nova tentativa). */
  atualizarEntrada?(vendaId: number, patch: Record<string, unknown>): Promise<void>;
  /** Clientes do onboarding do CS. Sem este método, nenhum card novo nasce. */
  onboarding?(): Promise<ClienteOnboarding[]>;
  /** Apaga as linhas feitas ou apagadas de uma etapa do card, para a tarefa dela nascer de novo (card reaberto). */
  liberarEtapa?(dealId: number, etapa: number): Promise<void>;
  /** Vendas achadas para o onboarding sem venda no handoff. Sem os dois métodos, esse cliente fica de fora. */
  vinculos?(): Promise<VinculoVenda[]>;
  gravarVinculo?(v: VinculoVenda): Promise<void>;
  tarefas(): Promise<LinhaTarefa[]>;
  inserirTarefa(linha: LinhaTarefa): Promise<boolean>;
  atualizarTarefa(
    chave: Pick<LinhaTarefa, "deal_id" | "entrou_em" | "chave">,
    patch: Partial<LinhaTarefa>,
  ): Promise<void>;
};
/** Uma venda lida pela entrada (ops.monetizacao_diagnostico_entradas). */
export type EntradaDiagnostico = {
  venda_id: number;
  org_id: number | null;
  deal_id: number | null;
  status: string;
  /** Cadastro na plataforma da Consultoria (22/10/2026): criado, ja_existia, sem_fit, sem_cnpj, pendente ou erro. */
  consultoria?: string | null;
  consultoria_cnpj?: string | null;
  consultoria_em?: string | null;
};

/** O cadastro de projeto da plataforma da Consultoria (planningtax-system.com.br/parceiro, o mesmo do formulário). */
export type ConsultoriaDiagnostico = {
  /** O CNPJ já tem projeto de Diagnóstico Tributário na plataforma (aberto ou baixado). */
  temProjeto(cnpj: string): Promise<boolean>;
  registrar(dados: {
    cnpj: string;
    razao_social: string;
    observacoes: string;
  }): Promise<{ projeto_id: string }>;
};

export type OpcoesDiagnostico = {
  pd: PipedriveDiagnostico;
  store: StoreDiagnostico;
  agora: Date;
  /** Chave da entrada automática (MONET_DIAG_ENTRADA_ATIVA=sim). */
  entradaAtiva: boolean;
  /** Chave das tarefas (MONET_DIAG_TAREFAS_ATIVA=sim). */
  tarefasAtiva: boolean;
  /** Só entrada em etapa depois deste instante recebe tarefa (MONET_DIAG_INICIO). Sem ele, nenhuma tarefa nasce. */
  inicio: string | null;
  /** Unidades com a abordagem pausada (MONET_DIAG_UNIDADES_PAUSADAS): o card delas nasce com a nota "Pausado em". */
  unidadesPausadas?: readonly string[];
  /** A plataforma da Consultoria. Sem ela, o cadastro fica "pendente". */
  consultoria?: ConsultoriaDiagnostico;
  /** Chave do cadastro na Consultoria (MONET_DIAG_CADASTRO_CONSULTORIA=sim). Desligada: só confere e marca pendente. */
  cadastroConsultoria?: boolean;
  orcamentoMs?: number;
};

/**
 * Cadastro na Consultoria que não pede a tarefa "03 · Cadastrar o cliente na plataforma" (decisão de 22/10/2026). O
 * pendente pede: enquanto o cadastro automático estiver desligado, o Matheus cadastra, e a automação depois acha o
 * projeto e não duplica.
 */
const SEM_TAREFA_PLATAFORMA: ReadonlySet<string> = new Set(["criado", "ja_existia", "sem_fit"]);
const NOTA_CONSULTORIA: Readonly<Record<string, string>> = {
  criado:
    "Consultoria: cadastrado na plataforma hoje, como Carteira BPO (Diagnóstico — Curva B e C).",
  ja_existia: "Consultoria: o CNPJ já tem projeto na plataforma; nada foi cadastrado.",
  sem_fit:
    "Consultoria: fora do perfil (Lucro Real, ou Presumido de R$ 50 mi para cima); nada foi cadastrado.",
  sem_cnpj:
    "Consultoria: a venda não tem CNPJ; cadastre o cliente na plataforma pela tarefa da etapa 03.",
  pendente:
    "Consultoria: o cadastro automático na plataforma ainda não está ligado; cadastre o cliente pela tarefa da etapa 03.",
  erro: "Consultoria: o cadastro automático falhou; cadastre o cliente na plataforma pela tarefa da etapa 03.",
};

/** Organizações com card aberto ou ganho no pipe 39: o cliente termina lá (decisão de 16/10/2026). */
async function contasAtivasNo39(pd: PipedriveDiagnostico): Promise<Set<number>> {
  const contas = new Set<number>();
  for (const status of ["open", "won"]) {
    let cursor: string | null = null;
    for (let pagina = 0; pagina < 20; pagina++) {
      const corpo = await pd.v2("deals", {
        pipeline_id: 39,
        status,
        limit: 500,
        ...(cursor ? { cursor } : {}),
      });
      for (const d of corpo?.data || []) {
        const org = id(d.org_id);
        if (org) contas.add(org);
      }
      cursor = corpo?.additional_data?.next_cursor || null;
      if (!cursor) break;
    }
  }
  return contas;
}

type Rotulos = Map<string, Map<string, string>>;
export function rotuladorDe(campos: any[]): (chave: string, valor: any) => string | null {
  const mapa: Rotulos = new Map();
  for (const f of campos || [])
    if (Array.isArray(f?.options) && f.key)
      mapa.set(f.key, new Map(f.options.map((o: any) => [String(o.id), String(o.label)])));
  return (chave, valor) => {
    if (valor == null || valor === "") return null;
    const opcoes = mapa.get(chave);
    const v = opcao(valor);
    if (opcoes && v != null) return opcoes.get(v) ?? v;
    return texto(valor);
  };
}

/** A atividade como está agora no Pipedrive; null quando foi apagada à mão (404 ou 410). */
async function atividadeAtual(pd: PipedriveDiagnostico, atividade: number): Promise<any | null> {
  try {
    return (await pd.get(`activities/${atividade}`))?.data ?? null;
  } catch (e) {
    if (/HTTP (404|410)/.test((e as Error).message)) return null;
    throw e;
  }
}

async function emLotes<T, R>(itens: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < itens.length; i += n)
    out.push(...(await Promise.all(itens.slice(i, i + n).map(fn))));
  return out;
}

export async function rodarDiagnostico(op: OpcoesDiagnostico) {
  const { pd, store, agora } = op;
  const comeco = Date.now();
  const orcamento = op.orcamentoMs ?? 110_000;
  const hoje = dataSP(agora);
  const erros: string[] = [];

  // 1. carga
  const [stagesBody, camposBody] = await Promise.all([
    pd.get("stages", { pipeline_id: PIPE }),
    pd.pages("dealFields"),
  ]);
  const stages = (stagesBody?.data || [])
    .filter((s: any) => Number(s.pipeline_id) === PIPE && s.active_flag !== false)
    .sort((a: any, b: any) => a.order_nr - b.order_nr)
    .map((s: any) => ({
      id: Number(s.id),
      name: String(s.name),
      order: Number(s.order_nr),
      probabilidade: Number(s.deal_probability ?? 100),
      estagnacao: s.rotten_flag ? Number(s.rotten_days) || null : null,
    }));
  const rotulo = rotuladorDe(camposBody);
  const brutos = new Map<number, any>();
  for (const s of stages)
    for (const d of await pd.pages("deals", { stage_id: s.id, status: "all_not_deleted" }))
      if (Number(d.pipeline_id) === PIPE) brutos.set(Number(d.id), d);
  const anteriores = new Map((await store.cardsAtuais()).map((c) => [c.id, c]));
  const cards = await emLotes([...brutos.values()], 4, async (d) => {
    const velho = anteriores.get(Number(d.id));
    const fresco =
      velho &&
      velho.update_time === d.update_time &&
      Date.now() - Date.parse(velho.refreshed_at) < 30 * 60_000;
    if (fresco)
      return {
        ...velho,
        ...montarCard(d, null, null, null, rotulo, agora),
        moves: velho.moves,
        produtos: velho.produtos,
        atividades: velho.atividades,
        pausa: velho.pausa ?? null,
        ultima_nota: velho.ultima_nota ?? null,
        refreshed_at: velho.refreshed_at,
      };
    const [flow, produtos, atividades, notas] = await Promise.all([
      pd.pages(`deals/${d.id}/flow`, { items: "dealChange" }),
      Number(d.products_count) > 0 ? pd.pages(`deals/${d.id}/products`) : Promise.resolve([]),
      pd.pages(`deals/${d.id}/activities`),
      Number(d.notes_count) > 0
        ? pd
            .get("notes", { deal_id: d.id, limit: 50, sort: "add_time DESC" })
            .then((b) => b?.data || [])
        : Promise.resolve([]),
    ]);
    return montarCard(d, flow, produtos, atividades, rotulo, agora, notas);
  });
  const porId = new Map(cards.map((c) => [c.id, c]));

  // 2. entrada: cliente que concluiu o onboarding do CS há pelo menos 30 dias, com fit pela venda (decisão do Pedro,
  // 22/10/2026). A venda já vista não é relida, fora a do card que saiu do pipe 40 esperando o onboarding
  // (MOTIVOS_DE_ESPERA): esse volta à etapa 01 no 30º dia.
  const entradas = await store.entradas();
  const porVenda = new Map(entradas.map((e) => [Number(e.venda_id), e]));
  const porOrg = new Map<number, CardDiagnostico>();
  for (const c of cards)
    if (c.org_id && (!porOrg.has(c.org_id) || c.status === "open")) porOrg.set(c.org_id, c);
  const cardDaEntrada = (e: { deal_id: number | null; org_id: number | null } | undefined) =>
    !e
      ? undefined
      : e.deal_id
        ? porId.get(Number(e.deal_id))
        : e.org_id
          ? porOrg.get(Number(e.org_id))
          : undefined;
  const esperandoOnboarding = (c: CardDiagnostico | undefined) =>
    !!c &&
    c.status === "lost" &&
    MOTIVOS_DE_ESPERA.some((m) => String(c.lost_reason ?? "").startsWith(m));
  const foraDaRegra: Record<string, number> = {};
  const fora = (motivo: string) => (foraDaRegra[motivo] = (foraDaRegra[motivo] || 0) + 1);
  const clientes = store.onboarding ? await store.onboarding() : [];
  const concluidos = clientes
    // Cópia: a busca da venda (2a) completa o cliente sem mexer no que o banco devolveu.
    .map((cliente) => ({ cliente: { ...cliente }, saida: saidaDoOnboarding(cliente) }))
    .filter((x): x is { cliente: ClienteOnboarding; saida: string } => !!x.saida);
  const prontos = concluidos.filter(
    (x) => diasCorridos(x.saida, hoje) >= DIAS_DEPOIS_DO_ONBOARDING,
  );
  // 2a. pronto sem a venda ligada no handoff (23/10/2026): vale a venda já achada; senão, procura pelo CNPJ e pelo nome,
  // até BUSCAS_POR_RODADA por rodada, e não procura de novo por um dia quando não acha.
  const vinculos = new Map(
    (store.vinculos ? await store.vinculos() : []).map((v) => [v.pipefy_card_id, v]),
  );
  const busca = { buscas: 0, cnpj: 0, nome: 0, nenhum: 0, ambiguo: 0, ja_achadas: 0 };
  for (const x of prontos) {
    if (x.cliente.pipedrive_deal_id) continue;
    const v = vinculos.get(x.cliente.pipefy_card_id);
    if (v?.venda_id && (v.como === "cnpj" || v.como === "nome")) {
      x.cliente.pipedrive_deal_id = Number(v.venda_id);
      x.cliente.vinculo = v.como;
      busca.ja_achadas++;
      continue;
    }
    const recente = !!v && agora.getTime() - Date.parse(v.tentado_em) < NOVA_BUSCA_MS;
    if (recente || !op.entradaAtiva || !store.gravarVinculo || busca.buscas >= BUSCAS_POR_RODADA)
      continue;
    busca.buscas++;
    try {
      const achado = await acharVenda(pd, x.cliente, x.saida);
      busca[achado.como]++;
      await store.gravarVinculo({
        ...achado,
        pipefy_card_id: x.cliente.pipefy_card_id,
        tentado_em: agora.toISOString(),
      });
      if (achado.venda_id && (achado.como === "cnpj" || achado.como === "nome")) {
        x.cliente.pipedrive_deal_id = achado.venda_id;
        x.cliente.vinculo = achado.como;
      }
    } catch (err) {
      erros.push(`venda do onboarding "${x.cliente.titulo}": ${(err as Error).message}`);
    }
  }
  const aLer: { cliente: ClienteOnboarding; saida: string }[] = [];
  const vistas = new Set<number>();
  for (const x of prontos) {
    const vendaId = x.cliente.pipedrive_deal_id;
    if (!vendaId) {
      fora("onboarding sem venda ligada");
      continue;
    }
    if (vistas.has(vendaId)) continue;
    vistas.add(vendaId);
    const e = porVenda.get(vendaId);
    if (e && !esperandoOnboarding(cardDaEntrada(e))) continue;
    aLer.push(x);
  }
  const vendas = new Map<number, any>();
  for (let k = 0; k < aLer.length; k += 100) {
    const lote = aLer.slice(k, k + 100).map((x) => x.cliente.pipedrive_deal_id);
    const corpo = await pd.v2("deals", { ids: lote.join(","), limit: 100 });
    for (const d of corpo?.data || []) vendas.set(Number(d.id), d);
  }
  const contas39 = aLer.length ? await contasAtivasNo39(pd) : new Set<number>();
  const previaEntradas: any[] = [];
  const criadas: number[] = [];
  const reabertas: number[] = [];
  const cadastros: Record<string, number> = {};
  /** Conta que ganhou card nesta rodada → o card (null na prévia): a segunda venda dela não vira outro card. */
  const contasNovas = new Map<number, number | null>();

  /** Cadastro na plataforma da Consultoria no dia em que o cliente entra no pipe 40 (decisão do Pedro, 22/10/2026). */
  // Card de unidade pausada não é cadastrado: fica pendente e sai quando a pausa for liberada.
  const consultoriaDe = async (
    cnpj: string | null,
    fit: boolean,
    razao: string,
    saida: string | null,
    pausado = false,
  ) => {
    const r: Record<string, unknown> = {
      consultoria_em: agora.toISOString(),
      consultoria_cnpj: cnpj,
    };
    if (!fit) r.consultoria = "sem_fit";
    else if (!cnpj) r.consultoria = "sem_cnpj";
    else if (!op.consultoria || pausado) r.consultoria = "pendente";
    else
      try {
        if (await op.consultoria.temProjeto(cnpj)) r.consultoria = "ja_existia";
        else if (!op.cadastroConsultoria) r.consultoria = "pendente";
        else {
          const { projeto_id } = await op.consultoria.registrar({
            cnpj,
            razao_social: razao,
            observacoes:
              `Cadastro automático do Brain (pipe 40, Diagnóstico de Oportunidades): ` +
              (saida
                ? `o cliente concluiu o onboarding em ${dataBR(saida)} e entrou no diagnóstico 30 dias depois.`
                : "o cliente concluiu o onboarding há pelo menos 30 dias."),
          });
          r.consultoria = "criado";
          r.consultoria_projeto_id = projeto_id;
        }
      } catch (err) {
        r.consultoria = "erro";
        r.consultoria_erro = (err as Error).message.slice(0, 300);
        erros.push(`cadastro na Consultoria (${cnpj}): ${r.consultoria_erro}`);
      }
    const estado = String(r.consultoria);
    cadastros[estado] = (cadastros[estado] || 0) + 1;
    return r;
  };

  for (const { cliente, saida } of aLer) {
    if (Date.now() - comeco > orcamento) break;
    const venda = vendas.get(Number(cliente.pipedrive_deal_id));
    if (!venda) {
      fora("venda não achada no Pipedrive");
      continue;
    }
    const el = elegibilidade(venda);
    if (!el.entra) {
      fora(el.motivo);
      continue;
    }
    const org = id(venda.org_id);
    if (org && contas39.has(org)) {
      fora("card aberto ou ganho no pipe 39");
      continue;
    }
    const e = porVenda.get(Number(venda.id));
    if (org && contasNovas.has(org)) {
      if (op.entradaAtiva && !e)
        await store.inserirEntrada({
          venda_id: Number(venda.id),
          org_id: org,
          deal_id: contasNovas.get(org),
          status: "conta_ja_no_pipe",
          motivo: "um card por conta",
          ganho_em: ganhoEm(venda),
        });
      continue;
    }
    const existente = cardDaEntrada(e) ?? (org ? porOrg.get(org) : undefined);
    const unidadeDaVenda = rotulo(CAMPO.unidade, campo(venda, CAMPO.unidade));
    const pausada = unidadePausada(op.unidadesPausadas, [cliente.unidade, unidadeDaVenda]);
    const fit = fitConsultoria(venda);
    const cnpj = cnpjDe(campo(venda, CAMPO.cnpj)) ?? cnpjDe(cliente.cnpj);
    const item = {
      venda_id: Number(venda.id),
      org_id: org,
      empresa: cliente.titulo,
      onboarding: cliente.fase_atual,
      saiu_onboarding_em: saida,
      ganho_em: ganhoEm(venda),
      regime: rotulo(CAMPO.regime, campo(venda, CAMPO.regime)),
      faixa: rotulo(CAMPO.faixa, campo(venda, CAMPO.faixa)),
      unidade: cliente.unidade || unidadeDaVenda,
      motivo: el.motivo,
      pausada: !!pausada,
      consultoria: !fit ? "sem_fit" : !cnpj ? "sem_cnpj" : "a cadastrar se não tiver projeto",
    };
    if (existente && !esperandoOnboarding(existente)) {
      // Um card por conta: a venda fica registrada para não ser relida.
      if (op.entradaAtiva && !e)
        await store.inserirEntrada({
          venda_id: item.venda_id,
          org_id: org,
          deal_id: existente.id,
          status: "conta_ja_no_pipe",
          motivo: "um card por conta",
          ganho_em: item.ganho_em,
        });
      continue;
    }
    if (org) contasNovas.set(org, existente?.id ?? null);
    previaEntradas.push(existente ? { ...item, reabrir: existente.id } : item);
    if (!op.entradaAtiva) continue;
    try {
      const dealId = existente
        ? existente.id
        : Number((await pd.post("deals", cardDaVenda(venda, cliente.titulo)))?.data?.id) || 0;
      if (!dealId) throw new Error("Pipedrive não devolveu o card");
      if (existente)
        // Esperava o onboarding e chegou o 30º dia: volta à etapa 01, e a tarefa dela nasce de novo.
        await pd.put(`deals/${dealId}`, { status: "open", stage_id: ETAPA.novo });
      else if (org) contasNovas.set(org, dealId);
      if (existente) await store.liberarEtapa?.(dealId, ETAPA.novo);
      if (pausada && !existente?.pausa)
        await pd.post("notes", {
          deal_id: dealId,
          content: notaDePausa(pausada, hoje),
          pinned_to_deal_flag: 1,
        });
      const cadastro = await consultoriaDe(
        cnpj,
        fit,
        cliente.titulo,
        saida,
        !!pausada || !!existente?.pausa,
      );
      const aviso =
        (NOTA_CONSULTORIA[String(cadastro.consultoria)] ?? "") +
        (cliente.vinculo
          ? `\nO handoff não liga a venda a este cliente: ela foi achada pelo ${cliente.vinculo === "cnpj" ? "CNPJ" : "nome"}. Confira se é a venda certa.`
          : "");
      if (existente)
        await pd.post("notes", {
          deal_id: dealId,
          content: notaHtml(
            `Voltou ao pipe 40 em ${dataBR(hoje)}: o cliente concluiu o onboarding em ${dataBR(saida)}, há ` +
              `${diasCorridos(saida, hoje)} dias.\n${aviso}`,
          ),
        });
      else
        await pd.post("notes", {
          deal_id: dealId,
          content: notaDaVenda(venda, rotulo, cliente, [
            `Concluiu o onboarding em ${dataBR(saida)}; entrou no pipe 40 no 30º dia.`,
            aviso,
          ]),
          pinned_to_deal_flag: 1,
        });
      const linha = {
        ...cadastro,
        saiu_onboarding_em: saida,
        onboarding_card_id: cliente.pipefy_card_id,
      };
      if (e) await store.atualizarEntrada?.(item.venda_id, { ...linha, deal_id: dealId });
      else
        await store.inserirEntrada({
          venda_id: item.venda_id,
          org_id: org,
          deal_id: dealId,
          status: "criado",
          motivo: existente ? `reaberto: ${el.motivo}` : el.motivo,
          ganho_em: item.ganho_em,
          ...linha,
        });
      (existente ? reabertas : criadas).push(dealId);
    } catch (err) {
      erros.push(`entrada da venda ${venda.id}: ${(err as Error).message}`);
    }
  }

  // 2b. cadastro pendente: entrou com o cadastro desligado (ou deu erro há mais de 6 h) e a chave está ligada.
  if (op.entradaAtiva && op.cadastroConsultoria && op.consultoria)
    for (const e of entradas) {
      if (Date.now() - comeco > orcamento) break;
      const card = e.deal_id ? porId.get(Number(e.deal_id)) : undefined;
      const tentouHa = Date.now() - Date.parse(e.consultoria_em ?? "1970-01-01");
      const tentar =
        e.consultoria === "pendente" || (e.consultoria === "erro" && tentouHa > 6 * 3_600_000);
      if (!tentar || !card || card.status !== "open" || card.pausa || !e.consultoria_cnpj) continue;
      const cadastro = await consultoriaDe(e.consultoria_cnpj, true, card.org || card.title, null);
      await store.atualizarEntrada?.(Number(e.venda_id), cadastro);
      e.consultoria = String(cadastro.consultoria);
      if (cadastro.consultoria !== "erro")
        await pd.post("notes", {
          deal_id: card.id,
          content: notaHtml(NOTA_CONSULTORIA[String(cadastro.consultoria)]),
        });
    }
  /** Cards cujo cadastro na Consultoria dispensa a tarefa da etapa 03 (feito, já existia ou sem fit). */
  const semTarefaPlataforma = new Set(
    entradas
      .filter((e) => e.deal_id && SEM_TAREFA_PLATAFORMA.has(String(e.consultoria)))
      .map((e) => Number(e.deal_id)),
  );

  // 3. tarefas
  const linhas = await store.tarefas();
  const previaTarefas: any[] = [];
  let criadasTarefas = 0,
    encerradas = 0,
    feitas = 0,
    pausadas = 0,
    retomadas = 0,
    camposGravados = 0;
  const tiposBody = op.tarefasAtiva ? await pd.get("activityTypes") : null;
  const { usar: tipos } = escolherTipos(tiposBody?.data || [], REGUA as any);
  const existentes = new Set(linhas.map((l) => `${l.deal_id}|${l.entrou_em}|${l.chave}`));
  // Desligada e sem MONET_DIAG_INICIO, a prévia simula a régua para todo card, para a tela mostrar o que nasceria.
  const temInicio = instante(op.inicio) ?? (op.tarefasAtiva ? null : new Date(0));
  const conta = (t: TarefaPlanejada) => `${t.deal_id}|${t.entrou_em}|${t.chave}`;

  // 3a. feitas e encerradas
  for (const l of linhas.filter((x) => x.status === "aberta")) {
    const card = porId.get(l.deal_id);
    const atividade = card?.atividades.find((a) => a.id === l.activity_id);
    if (atividade?.done) {
      feitas++;
      if (op.tarefasAtiva)
        await store.atualizarTarefa(l, {
          status: "feita",
          encerrado_em: atividade.done_at || agora.toISOString(),
        });
      continue;
    }
    const motivo = motivoDeEncerrar(l, card);
    // Card pausado e a atividade fora do retrato: confere no Pipedrive e, se a pausa a tirou, guarda para a liberação.
    if (!motivo && card?.pausa && !atividade) {
      if (!op.tarefasAtiva) continue;
      try {
        const viva = l.activity_id ? await atividadeAtual(pd, l.activity_id) : null;
        if (viva?.done) {
          feitas++;
          await store.atualizarTarefa(l, {
            status: "feita",
            encerrado_em: viva.marked_as_done_time || agora.toISOString(),
          });
        } else if (!viva || viva.active_flag === false) {
          pausadas++;
          await store.atualizarTarefa(l, { status: "pausada", motivo: "card pausado" });
        }
      } catch (e) {
        erros.push(`pausar ${l.deal_id}/${l.chave}: ${(e as Error).message}`);
      }
      continue;
    }
    if (!motivo) continue;
    encerradas++;
    if (!op.tarefasAtiva) continue;
    try {
      // O retrato das atividades pode ter até 30 minutos: antes de apagar, confere no Pipedrive que não foi feita.
      const viva = l.activity_id ? await atividadeAtual(pd, l.activity_id) : null;
      if (viva?.done) {
        await store.atualizarTarefa(l, {
          status: "feita",
          encerrado_em: viva.marked_as_done_time || agora.toISOString(),
        });
        continue;
      }
      if (viva) await pd.del(`activities/${l.activity_id}`);
      await store.atualizarTarefa(l, {
        status: "apagada",
        encerrado_em: agora.toISOString(),
        motivo,
      });
    } catch (e) {
      erros.push(`encerrar ${l.deal_id}/${l.chave}: ${(e as Error).message}`);
    }
  }

  // 3b. pausa liberada: a nota "Pausado em" saiu (ou foi desafixada) e o card segue na mesma entrada da etapa. A tarefa
  // guardada volta ao Pipedrive com o mesmo assunto; vencida, ela vence no dia útil de hoje.
  for (const l of linhas.filter((x) => x.status === "pausada")) {
    const card = porId.get(l.deal_id);
    if (card?.pausa) continue;
    const motivo = motivoDeEncerrar(l, card);
    const vence = l.due_date >= hoje ? l.due_date : vencimentoDiagnostico(hoje, 0);
    if (!op.tarefasAtiva) {
      if (!motivo)
        previaTarefas.push({
          deal_id: l.deal_id,
          empresa: card ? card.org || card.title : null,
          assunto: l.assunto,
          user_id: l.user_id,
          due_date: vence,
          retomada: true,
        });
      continue;
    }
    if (motivo) {
      await store.atualizarTarefa(l, {
        status: "apagada",
        encerrado_em: agora.toISOString(),
        motivo,
      });
      continue;
    }
    try {
      const { tipo, nota } = tipoENota(l, card as CardDiagnostico);
      const criada = (
        await pd.post("activities", {
          subject: l.assunto,
          type: tipos.get(tipo) || "task",
          ...vencimentoUtc(vence, HORA_TAREFA),
          duration: "00:15",
          deal_id: l.deal_id,
          user_id: l.user_id,
          note: notaHtml(nota),
        })
      )?.data;
      if (!criada?.id) throw new Error("Pipedrive não devolveu a atividade");
      await store.atualizarTarefa(l, {
        status: "aberta",
        activity_id: Number(criada.id),
        due_date: vence,
        motivo: null,
      });
      retomadas++;
    } catch (e) {
      erros.push(`retomar ${l.deal_id}/${l.chave}: ${(e as Error).message}`);
    }
  }

  // 3c. novas
  for (const card of cards) {
    if (Date.now() - comeco > orcamento) break;
    const planos: TarefaPlanejada[] = [];
    const entrada = instante(card.stage_since);
    if (card.status === "open" && !card.pausa && entrada && temInicio && entrada >= temInicio) {
      // A tarefa "03 · Cadastrar o cliente na plataforma" não nasce quando o cadastro automático resolveu (22/10/2026).
      const daEntrada = planejarEntrada(card).filter(
        (t) => !(t.chave === "03-plataforma" && semTarefaPlataforma.has(card.id)),
      );
      if (!daEntrada.some((t) => existentes.has(conta(t)))) planos.push(...daEntrada);
      const cobranca = proximaCobranca(card, linhas, hoje);
      if (cobranca && !existentes.has(conta(cobranca))) planos.push(cobranca);
      // Etapa 04: grava D0 e prazo prometido no card, se estiverem vazios.
      if (card.stage_id === ETAPA.execucao && (!card.d0 || !card.prazo)) {
        const { d0, prazo } = d0ePrazo(card, dataSP(entrada));
        if (op.tarefasAtiva) {
          try {
            await pd.put(`deals/${card.id}`, { [CAMPO.d0]: d0, [CAMPO.prazo]: prazo });
            card.d0 = d0;
            card.prazo = prazo;
            camposGravados++;
          } catch (e) {
            erros.push(`D0 e prazo do card ${card.id}: ${(e as Error).message}`);
          }
        } else
          previaTarefas.push({
            deal_id: card.id,
            empresa: card.org || card.title,
            gravar: { d0, prazo },
          });
      }
    }
    const ganho = instante(card.won_time);
    if (card.status === "won" && ganho && temInicio && ganho >= temInicio)
      for (const t of planejarGanho(card)) if (!existentes.has(conta(t))) planos.push(t);
    // Card reaberto na mesma etapa (MOTIVO_SEM_ONBOARDING) ou entrada lida tarde: a tarefa não nasce vencida.
    for (const t of planos) if (t.due_date < hoje) t.due_date = vencimentoDiagnostico(hoje, 0);
    for (const t of planos) {
      if (!op.tarefasAtiva) {
        previaTarefas.push({
          deal_id: t.deal_id,
          empresa: card.org || card.title,
          assunto: t.assunto,
          user_id: t.user_id,
          due_date: t.due_date,
        });
        continue;
      }
      const linha: LinhaTarefa = { ...t, activity_id: null, status: "aberta" };
      delete (linha as any).tipo;
      delete (linha as any).nota;
      if (!(await store.inserirTarefa(linha))) continue; // outra rodada já pegou esta tarefa
      existentes.add(conta(t));
      try {
        const criada = (
          await pd.post("activities", {
            subject: t.assunto,
            type: tipos.get(t.tipo) || "task",
            ...vencimentoUtc(t.due_date, HORA_TAREFA),
            duration: "00:15",
            deal_id: t.deal_id,
            user_id: t.user_id,
            note: notaHtml(t.nota),
          })
        )?.data;
        if (!criada?.id) throw new Error("Pipedrive não devolveu a atividade");
        await store.atualizarTarefa(t, { activity_id: Number(criada.id) });
        criadasTarefas++;
      } catch (e) {
        await store.atualizarTarefa(t, {
          status: "apagada",
          encerrado_em: agora.toISOString(),
          motivo: `erro ao criar: ${(e as Error).message}`,
        });
        erros.push(`tarefa ${t.deal_id}/${t.chave}: ${(e as Error).message}`);
      }
    }
  }

  const resumo = {
    status: erros.length ? "com_erros" : "ok",
    cards: cards.length,
    entrada: {
      ligada: op.entradaAtiva,
      porta: "onboarding",
      onboarding_lidos: clientes.length,
      concluiram_onboarding: concluidos.length,
      aguardando_30_dias: concluidos.length - prontos.length,
      prontos: prontos.length,
      vendas_lidas: vendas.size,
      venda_sem_vinculo: busca,
      a_criar_ou_criadas: previaEntradas.length,
      criadas: criadas.length,
      reabertas: reabertas.length,
      fora_da_regra: foraDaRegra,
      consultoria: { ligada: !!op.cadastroConsultoria, ...cadastros },
    },
    tarefas: {
      ligada: op.tarefasAtiva,
      inicio: op.inicio,
      criadas: criadasTarefas,
      feitas,
      encerradas,
      pausadas,
      retomadas,
      campos_gravados: camposGravados,
      previstas: previaTarefas.length,
    },
    erros,
    duracao_ms: Date.now() - comeco,
  };
  await store.gravarRetrato({
    cards,
    stages,
    previa: {
      gerada_em: agora.toISOString(),
      entradas: op.entradaAtiva ? [] : previaEntradas,
      tarefas: op.tarefasAtiva ? [] : previaTarefas,
    },
    resumo,
  });
  return resumo;
}
