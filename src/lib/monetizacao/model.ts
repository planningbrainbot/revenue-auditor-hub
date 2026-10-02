import { ehDiaUtil } from "./feriados.ts";
import { linhaDa } from "./funil-cumulativo.ts";
import { aplicarRegiaoFinance } from "./regiao.ts";
import type { FunilCumulativo } from "./funil-cumulativo";
import { NOMES, NOMES_ENVIO, PRODUTOS } from "./types.ts";
import type {
  Conta,
  Metrica,
  Negocio,
  Oferta,
  Plano,
  Produto,
  ProdutoEnvio,
  Revisao,
} from "./types";

export const METRICAS: { key: Metrica; label: string }[] = [
  { key: "loaded", label: "Fila carregada" },
  { key: "started", label: "Leads trabalhados" },
  { key: "scheduled", label: "Reuniões marcadas" },
  { key: "meeting", label: "Reuniões realizadas" },
  { key: "validated", label: "Oportunidades validadas" },
  { key: "signed", label: "Contratos ganhos" },
];
export const FAIXAS: Record<string, [number, number | null]> = {
  "Até R$ 500 mil": [0, 0.5],
  "R$ 500 mil até R$ 1 milhão": [0.5, 1],
  "R$ 1 milhão até R$ 2 milhões": [1, 2],
  "R$ 2 milhões até R$ 4,8 milhões": [2, 4.8],
  "R$ 4,8 milhões até R$ 10 milhões": [4.8, 10],
  "R$ 10 milhões até R$ 25 milhões": [10, 25],
  "R$ 25 milhões até R$ 50 milhões": [25, 50],
  "R$ 50 milhões até R$ 78 milhões": [50, 78],
  "Entre R$ 78 milhões e R$ 300 milhões": [78, 300],
  "Acima de R$ 300 milhões": [300, null],
  "[ANTIGO] Acima de R$ 78 milhões": [78, null],
  "[ANTIGO] Entre R$ 4,8 milhões e R$ 78 milhões": [4.8, 78],
};
export const normal = (v: string | null | undefined) =>
  (v || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
// Carga com mais de 30 minutos é "parada": o sync roda a cada 5. Regra da barra de frescor da
// Monetização, também usada pelo Cockpit do CEO para marcar número parcial.
export const LIMITE_CARGA_PARADA_MS = 30 * 60_000;

// A mensagem crua do banco não é para o sócio ler. "canceling statement due to statement
// timeout" apareceu inteira na tela em 22/09, em inglês e minúscula, colada depois de um ponto.
// Aqui ela vira frase, e o texto técnico continua acessível no title, para quem for investigar.
const ERROS_CONHECIDOS: [RegExp, string][] = [
  [/statement timeout/i, "o passo passou do tempo limite no banco"],
  [/deadlock/i, "duas cargas tentaram escrever ao mesmo tempo"],
  [/permission denied/i, "a carga não tem permissão para ler uma das fontes"],
  [/connection|timeout of/i, "a conexão com a fonte caiu no meio da carga"],
  // "Signal timed out.": o Pipedrive ou o banco não respondeu no prazo (sete vezes em 28/09)
  [/timed out|aborted/i, "o Pipedrive ou o banco demorou demais para responder"],
];
export const motivoLegivel = (erro: string) =>
  ERROS_CONHECIDOS.find(([re]) => re.test(erro))?.[1] ?? "a carga parou com um erro não previsto";

/**
 * Estado da carga do CRM (regra Z1). Parada é medição velha, com ou sem erro. Antes, parada era
 * "tem erro": uma falha isolada com dado de 5 minutos virava "indicadores parados" em vermelho
 * (28/09, 12:20 e 12:25, entre cargas boas), e o cron parado sem erro não avisava nada além do
 * "(parados)" miúdo da barra de frescor.
 */
export function cargaDoCrm(
  measuredAt: string | null,
  syncError: string | null,
  agora = Date.now(),
) {
  const parada = !!measuredAt && agora - Date.parse(measuredAt) > LIMITE_CARGA_PARADA_MS;
  return {
    /** O CRM nunca concluiu uma carga (`measured_at` nulo): KPIs de evento em `indisponivel`. */
    nuncaSincronizou: !measuredAt,
    /** A última carga concluída tem mais de 30 minutos; os números são dela, não de agora. */
    parada,
    /** Motivo em português da falha, quando há erro. */
    motivo: syncError ? motivoLegivel(syncError) : undefined,
    /** A frase do porquê: o erro da última tentativa, ou a carga automática que não rodou. */
    porque: syncError
      ? `A última tentativa falhou porque ${motivoLegivel(syncError)}.`
      : "A atualização automática, de 5 em 5 minutos, não concluiu nenhuma carga desde então.",
    /** Falha isolada com dado ainda fresco: a próxima rodada tenta de novo; não é carga parada. */
    falhouAgora: !!syncError && !!measuredAt && !parada,
  };
}
export const hoje = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function dias(from: string, to: string): string[] {
  const parse = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!parse(from) || !parse(to) || from > to) throw new Error("Informe um período válido.");
  const n = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  if (n > 1095) throw new Error("Selecione um período de até três anos.");
  return Array.from({ length: n + 1 }, (_, i) =>
    new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10),
  );
}
export const distancia = (a: string, b: string) =>
  Math.max(0, Math.floor((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000));
/** Dias úteis do período, nas duas pontas: segunda a sexta, sem os feriados de `feriados.ts`. */
export const uteis = (from: string, to: string) => dias(from, to).filter(ehDiaUtil).length;
export const baseRetroativaConsultoria = (a: Conta) =>
  a.old_base === true &&
  !a.new_commercial &&
  a.consultoria_origin?.status === "retroativa" &&
  (!a.base_origin || a.base_origin.status === "antiga");
export const SITUACOES_RECEITA = {
  ativa: "Ativa na Receita",
  baixada: "Baixada na Receita",
  inapta: "Inapta na Receita",
  suspensa: "Suspensa na Receita",
} as const;
// Rótulo único da situação cadastral, para tela e CSV. Estado novo da Receita cai no texto cru em
// vez de sumir: melhor a tela mostrar um código estranho do que fingir que a empresa está ativa.
export const rotuloSituacaoReceita = (a: Conta): string | null =>
  a.situacao_receita
    ? ((SITUACOES_RECEITA as Record<string, string>)[a.situacao_receita] ??
      `${a.situacao_receita} na Receita`)
    : null;
// Empresa fechada não é oportunidade dos produtos; fica na lista separada para uso futuro
// (decisão do dono em 18/09/2026). A situação vem da consulta em lote da Receita — um congelado.
// Quando a inscrição é regularizada, `review.situacao_receita = "ativa"` no editor de lista é o
// caminho de volta dentro do produto, com o mesmo trilho de auditoria do regime.
export function situacaoForaDeOferta(a: Conta, review: Revisao = {}): string | null {
  const s = review.situacao_receita || a.situacao_receita;
  if (!s || s === "ativa") return null;
  return `Empresa ${s} na Receita Federal${a.situacao_receita_fonte ? ` (${a.situacao_receita_fonte})` : ""}. Fora das ofertas; fica na lista de empresas inativas.`;
}
const dataBr = (iso: string | null | undefined) =>
  iso ? iso.slice(0, 10).split("-").reverse().join("/") : null;
/** Valor curto para selo e motivo: "R$ 92 mil", "R$ 1,2 mi". */
export function reaisCurto(v: number): string {
  const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (v >= 1_000_000) return `R$ ${fmt(v / 1_000_000)} mi`;
  if (v >= 1_000) return `R$ ${fmt(v / 1_000)} mil`;
  return `R$ ${fmt(v)}`;
}

// Distrato pedido na Central de Tratativas do Pipefy (decisão do dono em 28/09/2026). Concluído é
// churn: sai das ofertas dos quatro produtos e da tabela padrão da base. Em tratativa ainda pode
// reverter: fica visível e marcado, fora do envio até a tratativa terminar. Não há revisão manual:
// o caminho de volta é o card ir para "Cliente Recuperado" no Pipefy, que vira "retido".
export const ESTADOS_DISTRATO = {
  tratativa: "Em tratativa de distrato",
  concluido: "Distrato concluído",
  revertido: "Retido na tratativa",
} as const;
export function distratoForaDeOferta(a: Conta): Oferta | null {
  const d = a.base?.distrato;
  if (d?.estado === "concluido")
    return {
      status: "fora_regra",
      reason: `Distrato concluído na Central de Tratativas${d.data_churn ? ` (churn em ${dataBr(d.data_churn)})` : ""}. Fora das ofertas.`,
    };
  if (d?.estado === "tratativa")
    return {
      status: "revisar",
      reason: `Cliente em tratativa de distrato na Central de Tratativas${d.fase ? ` (${d.fase})` : ""}. Fora do envio até a tratativa terminar.`,
    };
  return null;
}
/** Níveis de prova que tiram a conta de todas as ofertas (migration 20261001200000). */
export const PROVA_FORA_DE_OFERTA = ["grupo", "fornecedor", "sem_prova"] as const;
/**
 * Fora das ofertas pela prova de cliente, na mesma posição do servidor (ops.monetizacao_offer_issue), logo depois do
 * distrato concluído:
 * - prova (01/10/2026): empresa do grupo, fornecedor (recebe pagamento da Planning ou só tem tag de fornecedor, sem
 *   prova de cliente) e conta só do Omie sem prova. O motivo vem do banco (`base.prova.motivo`).
 * - tag (29/09/2026): só fornecedor no Omie. Continua valendo para a conta com prova de cliente e só a tag de
 *   fornecedor ("sim deve sair", "deve só ser mencionado").
 * Fornecedor e grupo nem chegam a quem não é admin; o admin vê a conta com o motivo.
 */
export function fornecedorForaDeOferta(a: Conta): Oferta | null {
  const p = a.base?.prova;
  if (p && (PROVA_FORA_DE_OFERTA as readonly string[]).includes(p.nivel))
    return { status: "fora_regra", reason: p.motivo };
  const o = a.base?.omie;
  if (o?.classe !== "fornecedor") return null;
  const onde = o.fornecedor_em.length ? ` (${o.fornecedor_em.join(", ")})` : "";
  return {
    status: "fora_regra",
    reason: `Só fornecedor no Omie${onde}, sem tag de cliente. Fora das ofertas.`,
  };
}
/**
 * Concluído vale antes de tudo (é definitivo, como a baixa na Receita). A tratativa só rebaixa o que
 * o produto aceitaria ou deixaria pendente: conta que já está fora da regra continua fora pelo
 * motivo dela, em vez de virar "a confirmar" por causa da tratativa.
 */
export function comTratativa(a: Conta, resultado: Oferta): Oferta {
  const d = distratoForaDeOferta(a);
  return d && d.status === "revisar" && resultado.status !== "fora_regra" ? d : resultado;
}

// Operação da Consultoria (plataforma do Pedro Siqueira). Casamento por CNPJ completo ou pela raiz
// (mesma pessoa jurídica) vale como fato; proposta sem CNPJ casada pelo nome é selo incerto e não
// entra em regra nenhuma. Ex-cliente (ativo = false, quando a API trouxer) não bloqueia.
type PropostaConsultoria = NonNullable<
  NonNullable<Conta["base"]>["consultoria"]
>["propostas"][number];
export const propostasAbertas = (a: Conta, { incertas = false } = {}): PropostaConsultoria[] =>
  (a.base?.consultoria?.propostas ?? []).filter(
    (p) =>
      (incertas || p.casamento !== "nome") &&
      p.categoria === "Proposta" &&
      (p.status ?? "aberta") === "aberta",
  );
/** Soma do valor total das propostas; proposta sem valor não vira zero, é contada à parte. */
export function valorPropostas(ps: PropostaConsultoria[]) {
  const comValor = ps.filter((p) => p.valor_total != null);
  return {
    total: comValor.reduce((s, p) => s + (p.valor_total ?? 0), 0),
    semValor: ps.length - comValor.length,
  };
}
export function consultoriaForaDeOferta(a: Conta): string | null {
  const c = a.base?.consultoria;
  if (!c) return null;
  if (c.cliente && c.cliente.ativo !== false)
    return c.cliente.casamento === "raiz"
      ? `A mesma empresa (raiz do CNPJ ${c.cliente.cnpj.slice(0, 8)}) já é cliente da Consultoria. Não oferecer Consultoria.`
      : "Já é cliente da Consultoria (plataforma da Consultoria). Não oferecer Consultoria.";
  if (c.propostas.some((p) => p.casamento !== "nome" && p.categoria === "Contrato"))
    return "Contrato da Consultoria registrado na plataforma. Não oferecer Consultoria.";
  const abertas = propostasAbertas(a);
  if (abertas.length) {
    const v = valorPropostas(abertas);
    const enviada = abertas
      .map((p) => p.data_envio)
      .filter(Boolean)
      .sort()[0];
    const partes = [
      v.total ? reaisCurto(v.total) : null,
      enviada ? `enviada em ${dataBr(enviada)}` : null,
    ].filter(Boolean);
    return `Proposta da Consultoria em aberto${partes.length ? ` (${partes.join(", ")})` : ""}. Não duplicar a oferta.`;
  }
  return null;
}

// Teto legal pelo porte quando não há faixa declarada. Um só limite para oferta, filtro e ordenação.
export const limiteFaturamento = (
  a: Conta,
  band = a.band || "",
): [number, number | null] | undefined =>
  FAIXAS[band] ?? (!band && a.faturamento_teto != null ? [0, a.faturamento_teto] : undefined);
export const tetoEmReais = (teto: number) => `R$ ${String(teto).replace(".", ",")} mi`;
// O mesmo texto na linha da tabela e no CSV: sem faixa declarada, o teto do porte é o que se sabe.
export function faturamentoDeclarado(a: Conta): string {
  if (a.band) return a.band;
  if (a.faturamento_teto != null)
    return `Até ${tetoEmReais(a.faturamento_teto)} · teto pelo porte (${a.faturamento_teto_fonte || "Receita"})`;
  return "Declarado não informado";
}
// Faixa declarada acima do teto legal do porte: as duas fontes não podem estar certas. A faixa segue
// mandando (é declaração do sócio), mas o conflito para de ficar escondido.
export function tetoContradizFaixa(a: Conta): string | null {
  const bounds = FAIXAS[a.band || ""];
  if (!bounds || a.faturamento_teto == null || bounds[0] <= a.faturamento_teto) return null;
  return `Faixa declarada acima do teto do porte na Receita (até ${tetoEmReais(a.faturamento_teto)}). Confirmar com o sócio.`;
}
export function oferta(a: Conta, produto: Produto, review: Revisao = {}): Oferta {
  return comTratativa(a, ofertaDoProduto(a, produto, review));
}
function ofertaDoProduto(a: Conta, produto: Produto, review: Revisao): Oferta {
  if (a.base?.identity_conflict)
    return {
      status: "revisar",
      reason: "CNPJ divergente entre fontes; revisar a identidade antes de enviar.",
    };
  const regime = normal(review.regime || a.regime);
  const band = review.band || a.band || "";
  // Sem faixa cadastrada, o porte na Receita (ME até R$ 0,36 mi, EPP até R$ 4,8 mi) é teto legal de
  // faturamento: basta para o corte de Finance e para excluir de Cella, sem virar faixa declarada.
  const teto = !band && a.faturamento_teto != null ? a.faturamento_teto : null;
  const bounds = limiteFaturamento(a, band);
  const pelaReceita = teto != null ? " pelo porte na Receita" : "";
  const result = (status: Oferta["status"], reason: string) => ({ status, reason });
  const parada = situacaoForaDeOferta(a, review);
  if (parada) return result("fora_regra", parada);
  // Mesma posição do servidor (ops.monetizacao_offer_issue): depois da situação cadastral, antes do
  // que pede ação humana no cadastro. A tratativa entra por fora, em comTratativa.
  if (a.base?.distrato?.estado === "concluido") return distratoForaDeOferta(a)!;
  const fornecedor = fornecedorForaDeOferta(a);
  if (fornecedor) return fornecedor;
  if (a.base?.source_status === "absent")
    return result("revisar", "Cadastro ausente no Pipefy; revisar a origem antes de enviar.");
  if (produto === "consultoria") {
    if (a.new_commercial || a.consultoria_origin?.status === "comercial")
      return result(
        "fora_regra",
        "Fechamento pelo comercial identificado. Não pertence ao Aquário retroativo de Consultoria.",
      );
    if (a.base_origin && a.base_origin.status !== "antiga")
      return result(
        a.base_origin.status === "nova" ? "fora_regra" : "revisar",
        a.base_origin.reason,
      );
    if (!baseRetroativaConsultoria(a))
      return result(
        a.old_base ? "revisar" : "fora_regra",
        a.consultoria_origin?.reason || "Origem Base Antiga das unidades não comprovada.",
      );
    // Quem já é cliente da Consultoria não recebe Consultoria (dono, 28/09/2026). Depois da origem,
    // para o motivo das contas fora da base retroativa continuar sendo a origem.
    const jaCliente = consultoriaForaDeOferta(a);
    if (jaCliente) return result("fora_regra", jaCliente);
    if (
      /simples|mei/.test(regime) ||
      (!review.regime && a.consultoria_origin?.non_simples_confirmed === false)
    )
      return result("fora_regra", "Regime Simples Nacional ou MEI.");
    if (!review.regime && a.regime_conflict)
      return result("revisar", "Fontes divergem sobre o regime tributário; confirmar com o sócio.");
    if (
      !["lucro real", "lucro presumido", "lucro arbitrado"].includes(regime) &&
      a.consultoria_origin?.non_simples_confirmed !== true
    )
      return result(
        "revisar",
        "Base retroativa confirmada. Falta comprovar que está fora do Simples.",
      );
    return result(
      "elegivel",
      "Base Antiga das unidades, sem fechamento pelo comercial e fora do Simples. Contato, faturamento e segmento não são vetos.",
    );
  }
  if (produto === "finance" && !a.pipedrive_contract)
    return result("fora_regra", "Sem contrato ganho identificado no Pipedrive.");
  if (/simples|mei/.test(regime) || (!review.regime && a.base?.tax_evidence?.non_simples === false))
    return result("fora_regra", "Regime Simples Nacional ou MEI.");
  if ((!review.regime && a.regime_conflict) || (!review.band && a.band_conflict))
    return result("revisar", "Fontes divergem; confirmar os dados com o sócio.");
  if (
    !["lucro real", "lucro presumido", "lucro arbitrado"].includes(regime) &&
    a.base?.tax_evidence?.non_simples !== true
  )
    return result("revisar", "Regime tributário a confirmar.");
  if (!bounds) return result("revisar", "Faixa de faturamento anual a confirmar.");
  if (produto === "finance") {
    if (bounds[0] >= 25)
      return result(
        "fora_regra",
        "Fora de Finance: faturamento cadastrado a partir de R$ 25 milhões. Finance exige abaixo de R$ 25 milhões; confira Cella.",
      );
    if (bounds[1] === null || bounds[1] > 25)
      return result(
        "revisar",
        "Faixa atravessa R$ 25 milhões; confirmar faturamento abaixo do limite.",
      );
    // Região (frente 02, 02/10): só age com a chave ligada no banco; desligada, a oferta é a mesma.
    return aplicarRegiaoFinance(
      result(
        "elegivel",
        `Contrato ganho no Pipedrive, faturamento abaixo de R$ 25 mi${pelaReceita} e regime fora do Simples.`,
      ),
      a.finance_regiao,
    );
  }
  return bounds[0] >= 25
    ? result("elegivel", "Faturamento a partir de R$ 25 mi, fora do Simples.")
    : result(
        "fora_regra",
        `Cella: faturamento a partir de R$ 25 mi${teto != null ? "; porte ME/EPP na Receita fica abaixo" : ""}.`,
      );
}
export function negociosDaConta(a: Conta, cards: Negocio[]) {
  return cards.filter((c) => c.org_id !== null && a.orgs.includes(c.org_id));
}
export function disponibilidade(
  a: Conta,
  produto: ProdutoEnvio,
  cards: Negocio[],
  month = hoje().slice(0, 7),
  reservations: {
    account_key: string;
    product: ProdutoEnvio;
    status: string;
    deal_id: number | null;
  }[] = [],
) {
  const own = negociosDaConta(a, cards).filter((c) => c.route === produto);
  const open = own.find((c) => c.status === "open");
  if (open)
    return { free: false, reason: "Oportunidade aberta de " + NOMES_ENVIO[produto], deal: open };
  const reserved = reservations.find(
    (r) =>
      r.account_key === a.key &&
      r.product === produto &&
      ["sending", "sent", "uncertain"].includes(r.status),
  );
  if (reserved)
    return {
      free: false,
      reason:
        reserved.status === "uncertain"
          ? "Envio pendente de conferência"
          : "Oferta reservada / enviada ao CRM",
      deal: cards.find((c) => c.id === reserved.deal_id) || null,
    };
  // Um card por empresa no Caixa (dono, 01/10/2026): o card aberto de outro produto do pipe 39 recebe esta
  // oferta também, então a conta não está livre para abrir outro. Recon tem pipe próprio e não entra aqui.
  if (produto !== "recon") {
    const caixa = negociosDaConta(a, cards).find(
      (c) => c.status === "open" && c.route !== produto && PRODUTOS.includes(c.route as Produto),
    );
    if (caixa)
      return {
        free: false,
        reason:
          "Card aberto do Caixa em " +
          NOMES_ENVIO[caixa.route as ProdutoEnvio] +
          " · um card por empresa",
        deal: caixa,
      };
  }
  const loaded = own.find((c) => c.events.loaded.some((e) => e.date.startsWith(month)));
  if (loaded)
    return {
      free: false,
      reason: "Já carregada neste mês para " + NOMES_ENVIO[produto],
      deal: loaded,
    };
  return {
    free: true,
    reason: "Sem card aberto ou carga no mês · " + NOMES_ENVIO[produto],
    deal: null,
  };
}
export interface Filtro {
  from: string;
  to: string;
  owner: number | null;
  product: Produto | "";
}
export function operacao(cards: Negocio[], f: Filtro) {
  const period = dias(f.from, f.to),
    pool = cards.filter((c) => !f.product || c.route === f.product);
  const match = (c: Negocio, k: Metrica, day?: string) =>
    c.events[k].some(
      (e) =>
        (day ? e.date === day : e.date >= f.from && e.date <= f.to) &&
        (!f.owner || e.actor_id === f.owner),
    );
  const rows = Object.fromEntries(
    METRICAS.map((m) => [m.key, pool.filter((c) => match(c, m.key))]),
  ) as Record<Metrica, Negocio[]>;
  const series = period.map((date) => {
    const started = pool.filter((c) => match(c, "started", date)).length,
      scheduled = pool.filter((c) => match(c, "scheduled", date)).length;
    return {
      date,
      label: date.slice(8) + "/" + date.slice(5, 7),
      started,
      scheduled,
      meeting: pool.filter((c) => match(c, "meeting", date)).length,
      conversion: started ? Math.round((scheduled / started) * 1000) / 10 : null,
    };
  });
  const current = pool.filter((c) => c.status === "open" && (!f.owner || c.owner_id === f.owner));
  const products = [...PRODUTOS, "sem_produto" as const].map((p) => ({
    product: p,
    ...Object.fromEntries(
      METRICAS.map((m) => [m.key, rows[m.key].filter((c) => c.route === p).length]),
    ),
  })) as ({ product: Produto | "sem_produto" } & Record<Metrica, number>)[];
  const convertedMeetings = rows.meeting.filter((c) =>
    c.events.validated.some(
      (v) =>
        v.date <= f.to &&
        c.events.meeting.some(
          (m) => m.date >= f.from && m.date <= v.date && (!f.owner || m.actor_id === f.owner),
        ),
    ),
  );
  // Clique num dia do gráfico: os cards das três séries naquele dia, com a mesma régua de data e
  // ator das barras (antes o detalhe olhava só a data e levava movimento de outro usuário).
  const movimentosDoDia = (date: string) => {
    const ids = new Set<number>();
    return (["started", "scheduled", "meeting"] as const)
      .flatMap((k) => pool.filter((c) => match(c, k, date)))
      .filter((c) => !ids.has(c.id) && !!ids.add(c.id));
  };
  return {
    rows,
    series,
    movimentosDoDia,
    current,
    products,
    convertedMeetings,
    conversion: rows.meeting.length ? convertedMeetings.length / rows.meeting.length : null,
  };
}
export function quantil(values: number[], q: number): number | null {
  if (!values.length) return null;
  const a = [...values].sort((a, b) => a - b),
    x = (a.length - 1) * q,
    lower = Math.floor(x);
  return a[lower] + (a[Math.ceil(x)] - a[lower]) * (x - lower);
}
export function temporal(cards: Negocio[], f: Filtro) {
  const selected = cards.filter(
    (c) => (!f.product || c.route === f.product) && (!f.owner || c.owner_id === f.owner),
  );
  const signed = selected.filter(
    (c) => c.status === "won" && c.won_on && c.won_on >= f.from && c.won_on <= f.to && c.started_at,
  );
  const cycles = signed.map((c) => distancia(c.started_at!, c.won_on!));
  const open = selected.filter((c) => c.status === "open" && c.validated_at);
  const weeks = new Map<string, Negocio[]>();
  for (const c of open) {
    let key = "Sem data";
    if (c.expected_close) {
      const d = new Date(c.expected_close + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      key = d.toISOString().slice(0, 10);
    }
    weeks.set(key, [...(weeks.get(key) || []), c]);
  }
  return {
    signed,
    median: quantil(cycles, 0.5),
    p90: quantil(cycles, 0.9),
    open,
    weeks: [...weeks]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, rows]) => ({ week, rows, revenue: receitaSomada(rows) })),
  };
}
export function receitaSomada(cards: Negocio[]) {
  const totals = { total: 0, partners: 0, unit: 0, known: 0, missing: 0, divergent: 0 };
  for (const c of cards) {
    if (
      ["ok", "calculated"].includes(c.revenue.status) &&
      [c.revenue.total, c.revenue.partners, c.revenue.unit]
        .filter((x) => x.amount !== null)
        .every((x) => x.currency === "BRL")
    ) {
      totals.total += Math.round((c.revenue.total.amount ?? c.revenue.sum ?? 0) * 100);
      totals.partners += Math.round((c.revenue.partners.amount ?? 0) * 100);
      totals.unit += Math.round((c.revenue.unit.amount ?? 0) * 100);
      totals.known++;
    } else {
      totals.missing++;
      if (c.revenue.status === "mismatch") totals.divergent++;
    }
  }
  return {
    ...totals,
    total: totals.total / 100,
    partners: totals.partners / 100,
    unit: totals.unit / 100,
  };
}
export function capacidade(
  plan: Plano,
  accounts: Conta[],
  cards: Negocio[],
  f: Filtro,
  reservations: Parameters<typeof disponibilidade>[4] = [],
) {
  const actual = operacao(cards, f);
  return PRODUTOS.map((product) => {
    const eligible = accounts.filter((a) => oferta(a, product).status === "elegivel");
    const available = eligible.filter(
      (a) => disponibilidade(a, product, cards, plan.month, reservations).free,
    );
    const started = actual.rows.started.filter((c) => c.route === product).length;
    const planned = Math.max(0, plan.allocation[product]);
    const remaining = Math.max(0, planned - started);
    const approved = plan.rates[product];
    return {
      product,
      eligible: eligible.length,
      available: available.length,
      started,
      planned,
      remaining,
      executable: Math.min(remaining, available.length),
      gap: Math.max(0, remaining - available.length),
      estimate:
        approved === null
          ? null
          : actual.rows.validated.filter((c) => c.route === product).length * approved,
    };
  });
}
export function csv(rows: unknown[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((x) => {
            let s = String(x ?? "");
            if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(";"),
      )
      .join("\r\n")
  );
}
// Farmer da Monetização. Único da frente desde set/2026 (decisão do dono em 24/09/2026): a Operação
// mede o trabalho dele e não oferece mais o seletor de responsável.
export const FARMER = { id: 28381245, nome: "Matheus Carvalho" } as const;

/**
 * Produto escrito no fim do título ("Hospitel · CELLA", "Camianski· Cella"), como o envio do
 * Aquário e dos contratos nomeia o card. Só o sufixo depois do "·": "NORTH Engenharia e
 * Consultoria · Finance" é Finance.
 */
export function produtoDoTitulo(titulo: string): Produto | null {
  const m = /·\s*(cella|consultoria|finance)\s*$/i.exec(titulo.trim());
  return m ? (m[1].toLowerCase() as Produto) : null;
}

const mesLocal = (at: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(at) ? at : at.replace(" ", "T") + "Z"));

/**
 * Cadastro a corrigir no Pipedrive. O campo Caixa · Produto manda na contagem (regra da tela);
 * estes alertas mostram onde ele contradiz o próprio card, para a operação corrigir na fonte.
 * - `produtoDivergente`: título diz um produto e o campo, outro (ou nenhum). Com filtro de
 *   produto, entram os dois lados: o que infla o produto e o que falta nele.
 * - `duplicados`: mesma organização e mesmo produto, com os dois abertos ou criados no mesmo mês
 *   (a régua de duplicidade do envio). Cada card conta, como no Pipedrive; o alerta diz que são
 *   a mesma oportunidade.
 * - `semProduto`: aberto sem produto no campo nem no título; não entra em linha de produto
 *   nenhuma. Os fechados sem produto (a limpeza da API em 27/08–01/09) não pedem ação.
 */
export function cadastroACorrigir(cards: Negocio[], product: Produto | "sem_produto" | "" = "") {
  const doFiltro = (c: Negocio, titulo: Produto | null) =>
    !product || c.route === product || titulo === product;
  const produtoDivergente = cards.filter((c) => {
    const titulo = produtoDoTitulo(c.title);
    return titulo !== null && titulo !== c.route && doFiltro(c, titulo);
  });
  const grupos = new Map<string, Negocio[]>();
  for (const c of cards)
    if (c.org_id !== null && c.route !== "sem_produto" && (!product || c.route === product))
      grupos.set(`${c.org_id}:${c.route}`, [...(grupos.get(`${c.org_id}:${c.route}`) ?? []), c]);
  const repetidos = [...grupos.values()]
    .map((g) =>
      g.filter((c) =>
        g.some(
          (o) =>
            o.id !== c.id &&
            ((o.status === "open" && c.status === "open") ||
              mesLocal(o.created_at) === mesLocal(c.created_at)),
        ),
      ),
    )
    .filter((g) => g.length > 1);
  const semProduto =
    !product || product === "sem_produto"
      ? cards.filter(
          (c) => c.status === "open" && c.route === "sem_produto" && !produtoDoTitulo(c.title),
        )
      : [];
  return {
    produtoDivergente,
    semProduto,
    duplicados: repetidos.flat(),
    /** Quantas oportunidades (organização × produto) têm mais de um card. */
    oportunidadesDuplicadas: repetidos.length,
  };
}

/**
 * Situação do negócio no detalhe. O Pipedrive guarda a última etapa de um card perdido ou ganho;
 * mostrar só a etapa fazia o perdido parecer aberto (relato de 28/09/2026: Bigens · Consultoria,
 * perdido às 10:03, aparecia em "3 · Gatilho identificado"). Encerrado diz isso primeiro, com a
 * data, e a etapa vira "estava em".
 */
export function situacaoDoNegocio(c: Negocio): {
  encerrado: "won" | "lost" | "other" | null;
  rotulo: string | null;
  etapa: string;
} {
  if (c.status === "open") return { encerrado: null, rotulo: null, etapa: c.stage };
  const etapa = `estava em ${c.stage}`;
  if (c.status === "lost") {
    const quando = dataBr(c.lost_on);
    return { encerrado: "lost", rotulo: quando ? `Perdido em ${quando}` : "Perdido", etapa };
  }
  if (c.status === "won") {
    const quando = dataBr(c.won_on);
    return { encerrado: "won", rotulo: quando ? `Ganho em ${quando}` : "Ganho", etapa };
  }
  return { encerrado: "other", rotulo: "Encerrado no CRM", etapa };
}

/** Conversão de uma etapa para a seguinte, com uma casa. Etapa de cima vazia não tem taxa. */
export function taxa(valor: number, anterior: number): number | null {
  return anterior > 0 ? valor / anterior : null;
}

export type StatusMeta = "na-meta" | "fora" | "dia-em-curso" | "sem-meta";
export interface QuadroMeta {
  chave: "started" | "scheduled" | "meeting" | "validated" | "signed";
  rotulo: string;
  /** Número do quadro: ritmo por dia útil (abordados) ou contagem da coorte. */
  valor: number;
  unidade?: string;
  total: number;
  meta: number | null;
  status: StatusMeta;
  nota: string;
  formula: string;
  /** Os cards que o número conta (drill-down). */
  cards: Negocio[];
}

const PCT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

/**
 * Os cinco quadros de meta do farmer, na mesma coorte do funil (régua cumulativa, 01/10/2026): trabalhados,
 * agendados, realizados, validadas e ganhos saem dos mesmos cards, então validadas nunca passam de realizadas. Só os
 * trabalhados são ritmo: abordados ÷ dias úteis do período (segunda a sexta, sem feriado). Contrato é a contagem
 * contra a meta mensal proporcional aos dias úteis do período, arredondada para cima (contagem é sempre inteira).
 * Abaixo da meta num período que é só hoje é "dia em curso", não "fora".
 */
export function metasOperacao(
  fc: FunilCumulativo,
  plan: Plano | undefined,
  f: Filtro,
  hojeIso = hoje(),
): { quadros: QuadroMeta[]; uteis: number } {
  const n = uteis(f.from, f.to);
  const soHoje = f.from === hojeIso && f.to === hojeIso;
  const ritmo = (total: number) => (n ? Math.round((total / n) * 10) / 10 : 0);
  const status = (valor: number, meta: number | null): StatusMeta =>
    meta === null ? "sem-meta" : valor >= meta ? "na-meta" : soHoje ? "dia-em-curso" : "fora";
  const emDias = (total: number) => `${total} em ${n} ${n === 1 ? "dia útil" : "dias úteis"}`;
  const mes = f.to.slice(0, 7);
  const uteisMes = uteis(mes + "-01", fimDoMes(mes));
  const metaContratos =
    plan?.target_contracts && uteisMes
      ? Math.ceil((plan.target_contracts * Math.min(n, uteisMes)) / uteisMes)
      : null;
  const cards = (chave: Parameters<typeof linhaDa>[1]) => linhaDa(fc, chave)?.cards ?? [];
  const abordados = cards("abordagem");
  const agendados = cards("agendada");
  const realizados = cards("realizada");
  const validadas = cards("negociacao");
  const ganhos = cards("ganho");
  const sobre = (a: number, b: number, de: string) =>
    b ? `${PCT.format(a / b)} ${de}` : `Nenhum ${de.replace(/^d[oa]s /, "")} no período`;
  const metaLeads = plan?.daily_target || null;
  const fora = fc.ganhosForaDaCoorte.length;
  const quadros: QuadroMeta[] = [
    {
      chave: "started",
      rotulo: "Leads trabalhados por dia útil",
      valor: ritmo(abordados.length),
      total: abordados.length,
      meta: metaLeads,
      status: status(ritmo(abordados.length), metaLeads),
      nota: emDias(abordados.length),
      formula:
        "Cards que o farmer tirou da Base elegível no período (a coorte do funil), divididos pelos dias úteis, sem os feriados nacionais.",
      cards: abordados,
    },
    {
      chave: "scheduled",
      rotulo: "Levantamentos agendados",
      valor: agendados.length,
      total: agendados.length,
      meta: null,
      status: "sem-meta",
      nota: sobre(agendados.length, abordados.length, "dos abordados"),
      formula:
        "Abordados do período que chegaram a Reunião de levantamento agendada, ou a uma etapa depois dela, no período.",
      cards: agendados,
    },
    {
      chave: "meeting",
      rotulo: "Levantamentos realizados",
      valor: realizados.length,
      total: realizados.length,
      meta: null,
      status: "sem-meta",
      nota: sobre(realizados.length, agendados.length, "dos agendados"),
      formula:
        "Abordados do período que chegaram a Reunião de levantamento realizada (Stand by conta como realizada), ou além.",
      cards: realizados,
    },
    {
      chave: "validated",
      rotulo: "Oportunidades validadas",
      valor: validadas.length,
      total: validadas.length,
      meta: null,
      status: "sem-meta",
      nota: realizados.length
        ? `${validadas.length} de ${realizados.length} realizados viraram oportunidade`
        : "Nenhum levantamento realizado no período",
      formula:
        "Abordados do período que chegaram a Em negociação ou além. Saem da mesma coorte dos realizados, então nunca passam deles.",
      cards: validadas,
    },
    {
      chave: "signed",
      rotulo: "Contratos ganhos",
      valor: ganhos.length,
      total: ganhos.length,
      meta: metaContratos,
      status: status(ganhos.length, metaContratos),
      nota: fora
        ? `Fora da coorte: ${fora} ${fora === 1 ? "ganho" : "ganhos"} de abordagem anterior`
        : plan?.target_contracts
          ? `Meta de ${plan.target_contracts} no mês, proporcional a ${n} de ${uteisMes} dias úteis`
          : "Meta do mês a definir",
      formula:
        "Abordados do período marcados como ganhos no Pipedrive no período. Ganho de card abordado em outro período fica fora da coorte, e a nota diz quantos foram.",
      cards: ganhos,
    },
  ];
  return { quadros, uteis: n };
}
function fimDoMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}
