// Seg · Growth: "A matriz está gerando e convertendo demanda para as unidades no ritmo do trimestre?"
//
// Seis números, puros (sem I/O). O que a leitura de 29/09/2026 mostrou e decidiu cada fonte:
// 1. MRR novo vendido × meta do trimestre: `growth.dist_metas` (meta e vendido por unidade e
//    trimestre "AAAA-Tn"). O vendido é a foto diária (08h10) do sync do Growth
//    (`growth.dist_metas_sincronizar`: negócios ganhos no Inside Sales, `mrr_efetivo`). O Growth
//    chama Goiânia de "Matriz" e Construção Civil de "Marox" (apelido do próprio Growth);
//    Consultoria e São Paulo ficam fora da régua de distribuição e não têm meta.
// 2. Contratos novos no trimestre e 3. ticket médio: `ops.contratos` do pipe Inside Sales, a base de
//    contratos do Ops (a mesma do Cockpit do CEO). A RPC `indicadores_trimestre` NÃO é usada: ela
//    só devolve as regionais, conta o lote do pipe Sócios importado em 10/09 (datado de agosto) e,
//    com a sessão do COO, passou de 110 s em 29/09 (o limite do papel é 8 s).
// 4. Mídia investida e ROAS e 5. custo de mídia por contrato: a série mensal do Growth
//    (`growth.serie_mensal`, a mesma régua do Growth: ROAS = MRR novo ÷ mídia; CAC = mídia ÷
//    vendas). É a mídia da matriz inteira: não se separa por unidade. Não existe CAC por unidade
//    atualizado: `ops.roas_por_unidade` parou em jun/2026 e repete o CAC da rede em todas as
//    unidades, e `v_cac_funil_resumo` mede a cobrança do honorário de CAC às unidades, não custo.
// 6. Broker: `ops.broker_oportunidades` (fila, reservas e conversões).
//
// Unidade regional em implantação (sem inauguração) não entra em número de desempenho nem no
// gráfico; o aviso diz quanto elas venderam, para nada sumir calado.
import { MAX_NUMEROS, ordenarAlertas } from "../contrato.ts";
import type {
  AlertaCoo,
  Destino,
  Estado,
  Explicacao,
  GraficoCoo,
  LeituraTema,
  NumeroCoo,
  Procedencia,
} from "../contrato.ts";
import { alerta, destino, grafico, mesAnterior, numeroOk, numeroSem, somaReais, tabela, trimestre } from "../montar.ts";
import type { BaseNumero } from "../montar.ts";
import { chaveUnidade, unidadesDoFiltro, universo } from "../unidades.ts";
import type { FiltroUnidade, UnidadeCoo } from "../unidades.ts";

// ---------------------------------------------------------------------------------------------
// Dados crus (o que growth.server.ts lê)
// ---------------------------------------------------------------------------------------------

export type ParteGrowth<T> =
  | { ok: true; dado: T; atualizadoEm: string | null }
  | { ok: false; estado: Exclude<Estado, "disponivel" | "parcial">; motivo: string };

/** Numéricos do PostgREST podem chegar em texto (numeric). */
type Num = number | string | null;

/** `growth.dist_metas`. */
export interface LinhaDistMeta {
  unidade: string;
  quarter: string;
  meta: Num;
  vendido: Num;
}

/** `ops.contratos` do pipe Inside Sales. */
export interface LinhaContratoGrowth {
  id: number;
  unidade: string | null;
  ganho_em: string;
  mrr_mensal: Num;
}

/** `growth.serie_mensal` (mês "AAAA-MM"). */
export interface LinhaSerieMensal {
  mes: string;
  vendas: Num;
  mrr: Num;
  investimento: Num;
}

/** `growth.metas` papel "funil" (só `investimento_mes` é usado). */
export interface LinhaPlanoGrowth {
  mes: string;
  metrica: string;
  alvo: Num;
}

/** `ops.royalties_apuracao` confirmada: a mídia (CSC de tráfego pago) que a unidade pagou no mês. */
export interface LinhaMidiaUnidade {
  unidade_id: number;
  mes_referencia: string;
  csc_trafego_pago: Num;
}

/** `ops.broker_oportunidades`. */
export interface LinhaBroker {
  id: number;
  status: string;
  reservado_por: number | null;
  updated_at: string | null;
  fechado_em: string | null;
  mrr_precificado: Num;
}

export interface DadosGrowth {
  metas: ParteGrowth<LinhaDistMeta[]>;
  /** Contratos do Inside Sales desde o início do trimestre ANTERIOR (o ticket compara os dois). */
  contratos: ParteGrowth<LinhaContratoGrowth[]>;
  midia: ParteGrowth<{ serie: LinhaSerieMensal[]; planos: LinhaPlanoGrowth[] }>;
  /** Apurações confirmadas do mês anterior (o alerta de mídia sem contrato olha o último mês fechado). */
  midiaUnidades: ParteGrowth<LinhaMidiaUnidade[]>;
  broker: ParteGrowth<LinhaBroker[]>;
}

// ---------------------------------------------------------------------------------------------
// Regras (limiares escritos, determinísticos)
// ---------------------------------------------------------------------------------------------

/** Abaixo desta fração do ritmo esperado a unidade vira alerta. */
export const LIMIAR_RITMO = 0.5;
/** Nos primeiros dias o ritmo esperado é quase zero e qualquer atraso vira alerta: espera 14 dias. */
export const DIAS_MINIMOS_RITMO = 14;
/** Oportunidade aberta sem atualização há mais que isto está parada. */
export const DIAS_BROKER_PARADA = 15;

/** Apelidos que só o Growth usa (dist_unidade_apelidos): "Marox" é a Construção Civil. */
const APELIDOS_GROWTH: Record<string, string> = { marox: "construcao civil" };

// ---------------------------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------------------------

const DIA_MS = 86_400_000;
const diaUtc = (iso: string) =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const diasEntre = (de: string, ate: string) => Math.round((diaUtc(ate) - diaUtc(de)) / DIA_MS);
const primeiroDia = (ano: number, mes0: number) =>
  new Date(Date.UTC(ano, mes0, 1)).toISOString().slice(0, 10);

export interface JanelaTrimestre {
  /** "2026-T3": a chave de `dist_metas.quarter` e do `?trimestre=` de /indicadores-trimestre. */
  chave: string;
  /** "T3/2026". */
  rotulo: string;
  inicio: string;
  /** EXCLUSIVO: 1º dia do trimestre seguinte. */
  fim: string;
  meses: string[];
  dias: number;
  /** Dias inteiros já corridos (até ontem): a foto do vendido é das 08h10 de hoje. */
  decorridos: number;
  /** decorridos ÷ dias: a fração da meta que já deveria estar vendida. */
  fracao: number;
}

export function janelaTrimestre(hoje: string): JanelaTrimestre {
  const { ano, t, rotulo } = trimestre(hoje);
  const m0 = (t - 1) * 3;
  const inicio = primeiroDia(ano, m0);
  const fim = primeiroDia(ano, m0 + 3);
  const dias = diasEntre(inicio, fim);
  const decorridos = Math.min(Math.max(diasEntre(inicio, hoje), 0), dias);
  return {
    chave: `${ano}-T${t}`,
    rotulo,
    inicio,
    fim,
    meses: [0, 1, 2].map((i) => primeiroDia(ano, m0 + i).slice(0, 7)),
    dias,
    decorridos,
    fracao: decorridos / dias,
  };
}

/** O trimestre anterior, inteiro (fração 1). */
export function trimestreAnterior(j: JanelaTrimestre): JanelaTrimestre {
  const vespera = new Date(diaUtc(j.inicio) - DIA_MS).toISOString().slice(0, 10);
  const a = janelaTrimestre(vespera);
  return { ...a, decorridos: a.dias, fracao: 1 };
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (mes: string) => `${MESES_CURTOS[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;

// ---------------------------------------------------------------------------------------------
// Formatos (texto de nota e de alerta; o valor do cartão é formatado pela tela)
// ---------------------------------------------------------------------------------------------

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const umaCasa = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function reaisCurto(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `R$ ${umaCasa.format(v / 1_000_000)} mi`;
  if (a >= 1_000) return `R$ ${inteiro.format(Math.round(v / 1_000))} mil`;
  return `R$ ${inteiro.format(Math.round(v))}`;
}
const pct = (x: number) => `${inteiro.format(Math.round(x * 100))}%`;
const vezes = (x: number) => `${x.toFixed(2).replace(".", ",")}×`;
const plural = (n: number, um: string, varios: string) => `${inteiro.format(n)} ${n === 1 ? um : varios}`;

const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------------------------
// Casamento de unidade
// ---------------------------------------------------------------------------------------------

/** Unidade do cadastro para um texto de qualquer fonte, com os apelidos do Growth. */
export function unidadeDoGrowth(unidades: UnidadeCoo[], texto: string | null | undefined): UnidadeCoo | null {
  const c = chaveUnidade(texto);
  if (!c) return null;
  const k = APELIDOS_GROWTH[c] ?? c;
  return unidades.find((u) => u.chave === k) ?? null;
}

const nomes = (us: { nome: string }[]) => us.map((u) => u.nome).join(", ");

// ---------------------------------------------------------------------------------------------
// Destinos
// ---------------------------------------------------------------------------------------------

function destinoGrowthUnidades(tri: JanelaTrimestre): Destino {
  return {
    ...destino(
      "/growth/comercial/unidades",
      "Abrir Resultado por unidade no Growth",
      false,
      "Abre o mesmo trimestre com as unidades de distribuição do Growth (Matriz e Marox no lugar de Goiânia e Construção Civil), sem o filtro de unidade do cockpit; o vendido de lá é recalculado na hora, o daqui é a foto diária das 08h10.",
      { quarter: tri.chave },
    ),
    externo: true,
  };
}

function destinoIndicadores(tri: JanelaTrimestre, sel: UnidadeCoo[], filtro: FiltroUnidade): Destino {
  const umaRegional = sel.length === 1 && filtro !== "" && sel[0].grupo === "rede" ? sel[0] : null;
  return destino(
    "/indicadores-trimestre",
    "Abrir Indicadores do Trimestre",
    false,
    "A tela mostra só as unidades regionais e conta também os contratos do pipe Sócios; o cockpit conta só o Inside Sales.",
    umaRegional ? { trimestre: tri.chave, unidade: umaRegional.nome } : { trimestre: tri.chave },
  );
}

const DESTINO_TRAFEGO: Destino = {
  ...destino(
    "/growth/trafego",
    "Abrir Tráfego no Growth",
    false,
    "Abre no mês corrente; o cockpit soma os meses do trimestre.",
  ),
  externo: true,
};

const destinoBroker = (filtro: FiltroUnidade): Destino =>
  destino(
    "/broker/admin",
    "Abrir a Matriz do Broker",
    filtro === "",
    "A Matriz mostra a fila inteira e as reservas de todas as unidades.",
  );

const destinoApuracao = (mes: string): Destino =>
  destino(
    "/unidades/royalties",
    "Abrir Apuração de Royalties",
    false,
    "A apuração do mês mostra todas as unidades; a mídia é o CSC de tráfego pago.",
    { mes },
  );

// ---------------------------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------------------------

interface Recorte {
  unidades: UnidadeCoo[];
  filtro: FiltroUnidade;
  hoje: string;
  tri: JanelaTrimestre;
  ant: JanelaTrimestre;
  sel: UnidadeCoo[];
  /** Unidades do filtro que entram em número de desempenho. */
  desempenho: UnidadeCoo[];
  /** Regionais do filtro ainda sem inauguração. */
  implantacao: UnidadeCoo[];
}

const semDado = (p: { ok: false; estado: Exclude<Estado, "disponivel" | "parcial">; motivo: string }) =>
  [p.estado, p.motivo] as const;

/** O filtro só tem unidade em implantação: número de desempenho não se aplica. */
function soImplantacao(r: Recorte): string | null {
  if (r.desempenho.length || !r.implantacao.length) return null;
  return `${nomes(r.implantacao)} ${r.implantacao.length === 1 ? "está" : "estão"} em implantação: não entra em número de desempenho`;
}

// ── 1. MRR novo vendido × meta ────────────────────────────────────────────────────────────────

interface MetaUnidade {
  unidade: UnidadeCoo;
  meta: number;
  vendido: number;
}

function metasDoTrimestre(
  linhas: LinhaDistMeta[],
  r: Recorte,
): { porUnidade: Map<number, MetaUnidade>; semCadastro: string[]; temTrimestre: boolean } {
  const porUnidade = new Map<number, MetaUnidade>();
  const semCadastro: string[] = [];
  const doTri = linhas.filter((l) => String(l.quarter) === r.tri.chave);
  for (const l of doTri) {
    const u = unidadeDoGrowth(r.unidades, l.unidade);
    if (!u) {
      semCadastro.push(String(l.unidade));
      continue;
    }
    const x = porUnidade.get(u.id) ?? { unidade: u, meta: 0, vendido: 0 };
    x.meta = somaReais([x.meta, num(l.meta)]);
    x.vendido = somaReais([x.vendido, num(l.vendido)]);
    porUnidade.set(u.id, x);
  }
  return { porUnidade, semCadastro, temTrimestre: doTri.length > 0 };
}

function numeroMrrMeta(d: DadosGrowth, r: Recorte): NumeroCoo {
  const base: BaseNumero = {
    id: "mrr-vendido-meta",
    rotulo: "MRR novo vendido × meta",
    unidade: "reais",
    cobertura: "todas",
    fonte: "Distribuição de metas do Growth",
    destino: destinoGrowthUnidades(r.tri),
    explicacao: {
      oQueDiz:
        "Quanto de MRR novo o Inside Sales já vendeu para as unidades no trimestre, contra a meta que o Growth distribuiu para cada uma.",
      comoCalcula: `Soma de vendido e de meta de growth.dist_metas no trimestre ${r.tri.chave}, só das unidades do filtro em operação que têm meta. O vendido é a foto diária (08h10) dos negócios ganhos no Inside Sales. O ritmo esperado é a meta × dias corridos ÷ dias do trimestre.`,
      dono: "Comercial (distribuição de metas no Growth)",
    },
  };
  if (!d.metas.ok) return numeroSem(base, ...semDado(d.metas));
  const impl = soImplantacao(r);
  if (impl) return numeroSem(base, "nao_apurado", impl);
  const { porUnidade, temTrimestre } = metasDoTrimestre(d.metas.dado, r);
  if (!temTrimestre)
    return numeroSem(base, "nao_apurado", `o Growth não tem meta por unidade para ${r.tri.rotulo}`);
  const com = r.desempenho.map((u) => porUnidade.get(u.id)).filter((x): x is MetaUnidade => !!x);
  const semMeta = r.desempenho.filter((u) => !porUnidade.has(u.id));
  const implVendido = somaReais(r.implantacao.map((u) => porUnidade.get(u.id)?.vendido ?? 0));
  const atencao = [
    semMeta.length ? `Sem meta no Growth, fora da soma: ${nomes(semMeta)}.` : "",
    r.implantacao.length
      ? `Em implantação, fora da soma: ${nomes(r.implantacao)}${implVendido > 0 ? ` (venderam ${reaisCurto(implVendido)} no trimestre)` : ""}.`
      : "",
    "O Growth conta também os negócios duplicados \"(cópia)\" do Pipedrive; os contratos do Ops não.",
  ]
    .filter(Boolean)
    .join(" ");
  base.explicacao = { ...base.explicacao, atencao };
  if (!com.length)
    return numeroSem(
      base,
      "nao_apurado",
      `nenhuma unidade em operação do filtro tem meta no Growth para ${r.tri.rotulo}`,
    );
  const vendido = somaReais(com.map((x) => x.vendido));
  const meta = somaReais(com.map((x) => x.meta));
  const esperado = meta * r.tri.fracao;
  const linhas = [...porUnidade.values()]
    .filter((x) => r.sel.some((u) => u.id === x.unidade.id))
    .sort((a, b) => a.unidade.nome.localeCompare(b.unidade.nome, "pt-BR"))
    .map((x) => [
      x.unidade.nome,
      x.meta,
      x.vendido,
      x.meta > 0 ? Math.round((x.vendido / x.meta) * 1000) / 10 : null,
      x.unidade.emOperacao ? "entra na soma" : "em implantação: fora da soma",
    ]);
  for (const u of semMeta) linhas.push([u.nome, null, null, null, "sem meta no Growth"]);
  return numeroOk(base, vendido, {
    meta: { valor: meta, rotulo: `meta ${r.tri.rotulo}` },
    nota:
      meta > 0
        ? `${pct(vendido / meta)} da meta com ${pct(r.tri.fracao)} do trimestre corrido`
        : "as unidades do filtro têm meta zero",
    tom:
      meta <= 0
        ? undefined
        : vendido >= esperado
          ? "sucesso"
          : vendido >= LIMIAR_RITMO * esperado
            ? "atencao"
            : "perigo",
    dataDado: d.metas.atualizadoEm,
    dados: tabela(["Unidade", "Meta (R$)", "Vendido (R$)", "% da meta", "Situação"], linhas),
  });
}

// ── 2 e 3. Contratos novos e ticket médio ────────────────────────────────────────────────────

interface Vendas {
  n: number;
  mrr: number;
  nComMrr: number;
  porUnidade: Map<number, { unidade: UnidadeCoo; n: number; mrr: number }>;
  porMes: Map<string, number>;
}

function vendasNaJanela(linhas: LinhaContratoGrowth[], r: Recorte, de: string, ateExclusivo: string, us: UnidadeCoo[]): Vendas & { semUnidade: number; implantacao: number } {
  const ids = new Set(us.map((u) => u.id));
  const implIds = new Set(r.implantacao.map((u) => u.id));
  const v: Vendas & { semUnidade: number; implantacao: number } = {
    n: 0,
    mrr: 0,
    nComMrr: 0,
    porUnidade: new Map(),
    porMes: new Map(),
    semUnidade: 0,
    implantacao: 0,
  };
  let centavos = 0;
  for (const c of linhas) {
    const dia = String(c.ganho_em ?? "").slice(0, 10);
    if (!dia || dia < de || dia >= ateExclusivo) continue;
    const u = unidadeDoGrowth(r.unidades, c.unidade);
    if (!u) {
      v.semUnidade += 1;
      continue;
    }
    if (implIds.has(u.id)) v.implantacao += 1;
    if (!ids.has(u.id)) continue;
    const m = num(c.mrr_mensal);
    v.n += 1;
    if (m !== null) {
      v.nComMrr += 1;
      centavos += Math.round(m * 100);
    }
    const x = v.porUnidade.get(u.id) ?? { unidade: u, n: 0, mrr: 0 };
    x.n += 1;
    x.mrr = somaReais([x.mrr, m]);
    v.porUnidade.set(u.id, x);
    v.porMes.set(dia.slice(0, 7), (v.porMes.get(dia.slice(0, 7)) ?? 0) + 1);
  }
  v.mrr = centavos / 100;
  return v;
}

const amanha = (hoje: string) => new Date(diaUtc(hoje) + DIA_MS).toISOString().slice(0, 10);

function numerosContratos(d: DadosGrowth, r: Recorte): [NumeroCoo, NumeroCoo] {
  const dest = destinoIndicadores(r.tri, r.sel, r.filtro);
  const comoContratos =
    "Contratos de ops.contratos com origem no pipe Inside Sales e data de ganho no trimestre, até hoje, das unidades do filtro em operação.";
  const baseN: BaseNumero = {
    id: "contratos-novos",
    rotulo: "Contratos novos no trimestre",
    unidade: "negócios",
    cobertura: "todas",
    fonte: "Contratos do Ops (pipe Inside Sales)",
    destino: dest,
    explicacao: {
      oQueDiz: "Quantos contratos novos a demanda da matriz (pipe Inside Sales) já fechou para as unidades no trimestre.",
      comoCalcula: comoContratos,
      dono: "Comercial",
    },
  };
  const baseT: BaseNumero = {
    id: "ticket-medio",
    rotulo: "Ticket médio",
    unidade: "reais",
    cobertura: "todas",
    fonte: "Contratos do Ops (pipe Inside Sales)",
    destino: dest,
    explicacao: {
      oQueDiz: "Quanto vale por mês, em média, cada contrato novo do trimestre.",
      comoCalcula: `MRR mensal somado ÷ contratos com MRR. ${comoContratos} A comparação é com o trimestre anterior inteiro, na mesma régua.`,
      dono: "Comercial",
    },
  };
  if (!d.contratos.ok) return [numeroSem(baseN, ...semDado(d.contratos)), numeroSem(baseT, ...semDado(d.contratos))];
  const impl = soImplantacao(r);
  if (impl) return [numeroSem(baseN, "nao_apurado", impl), numeroSem(baseT, "nao_apurado", impl)];
  const v = vendasNaJanela(d.contratos.dado, r, r.tri.inicio, amanha(r.hoje), r.desempenho);
  const ant = vendasNaJanela(d.contratos.dado, r, r.ant.inicio, r.ant.fim, r.desempenho);
  const atencao = [
    "O lote do pipe Sócios (importado em 10/09 com data de agosto) fica fora: a data de ganho dele não marca a venda.",
    r.implantacao.length && v.implantacao
      ? `Em implantação, fora do total: ${nomes(r.implantacao)} (${plural(v.implantacao, "contrato", "contratos")}).`
      : "",
    r.filtro === "" && v.semUnidade
      ? `${plural(v.semUnidade, "contrato não casa", "contratos não casam")} com o cadastro de unidades e ${v.semUnidade === 1 ? "fica" : "ficam"} fora.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  baseN.explicacao = { ...baseN.explicacao, atencao };
  baseT.explicacao = { ...baseT.explicacao, atencao };
  const dataDado = d.contratos.atualizadoEm;
  const linhas = [...v.porUnidade.values()]
    .sort((a, b) => b.n - a.n || a.unidade.nome.localeCompare(b.unidade.nome, "pt-BR"))
    .map((x) => [x.unidade.nome, x.n, x.mrr, x.n ? Math.round((x.mrr / x.n) * 100) / 100 : null]);
  const dados = tabela(["Unidade", "Contratos", "MRR (R$)", "Ticket (R$)"], linhas);
  const mesesAteHoje = r.tri.meses.filter((m) => m <= r.hoje.slice(0, 7));
  const contratos = numeroOk(baseN, v.n, {
    nota: "só o pipe Inside Sales; o lote do Sócios fica fora",
    tendencia: { valores: mesesAteHoje.map((m) => v.porMes.get(m) ?? 0), rotulo: "contratos por mês do trimestre" },
    dataDado,
    dados,
  });
  const ticket =
    v.nComMrr === 0
      ? numeroSem(baseT, "nao_apurado", "nenhum contrato novo com MRR no trimestre", { dataDado })
      : (() => {
          const t = Math.round((v.mrr / v.nComMrr) * 100) / 100;
          const tAnt = ant.nComMrr ? Math.round((ant.mrr / ant.nComMrr) * 100) / 100 : null;
          return numeroOk(baseT, t, {
            nota: `${reaisCurto(v.mrr)} de MRR em ${plural(v.nComMrr, "contrato", "contratos")}`,
            delta:
              tAnt !== null
                ? { valor: Math.round((t - tAnt) * 100) / 100, rotulo: `vs ${r.ant.rotulo}`, sentido: "maior-melhor" }
                : undefined,
            dataDado,
            dados,
          });
        })();
  return [contratos, ticket];
}

// ── 4 e 5. Mídia, ROAS e custo de mídia por contrato ─────────────────────────────────────────

function somaSerie(serie: LinhaSerieMensal[], meses: string[]) {
  const doPeriodo = serie.filter((s) => meses.includes(String(s.mes).slice(0, 7)));
  return {
    meses: doPeriodo.length,
    investimento: somaReais(doPeriodo.map((s) => num(s.investimento))),
    mrr: somaReais(doPeriodo.map((s) => num(s.mrr))),
    vendas: doPeriodo.reduce((t, s) => t + (num(s.vendas) ?? 0), 0),
    linhas: doPeriodo,
  };
}

function numerosMidia(d: DadosGrowth, r: Recorte): [NumeroCoo, NumeroCoo] {
  const ignoraFiltro =
    "A mídia do Growth é da matriz inteira e não se separa por unidade: o número é o mesmo com qualquer filtro.";
  const baseM: BaseNumero = {
    id: "midia-roas",
    rotulo: "Mídia investida no trimestre",
    unidade: "reais",
    cobertura: "grupo",
    fonte: "Série mensal de mídia e vendas do Growth",
    destino: DESTINO_TRAFEGO,
    explicacao: {
      oQueDiz: "Quanto a matriz investiu em mídia paga no trimestre e quanto MRR novo cada real trouxe (ROAS).",
      comoCalcula:
        "Soma de investimento de growth.serie_mensal nos meses do trimestre até hoje (mês corrente parcial). ROAS = MRR novo ÷ mídia dos mesmos meses, a régua do Growth. O plano é a soma de investimento_mes do plano do funil (growth.metas).",
      atencao: ignoraFiltro,
      dono: "Marketing (mídia paga do Growth)",
    },
  };
  const baseC: BaseNumero = {
    id: "cac-midia",
    rotulo: "Custo de mídia por contrato",
    unidade: "reais",
    cobertura: "grupo",
    fonte: "Série mensal de mídia e vendas do Growth",
    destino: DESTINO_TRAFEGO,
    explicacao: {
      oQueDiz: "Quanto de mídia a matriz gastou para cada contrato novo do trimestre (o CAC de mídia do Growth).",
      comoCalcula:
        "Mídia ÷ vendas de growth.serie_mensal nos meses do trimestre até hoje, a mesma régua da coluna CAC do Growth (sem salário, ferramenta nem comissão). Comparado com o trimestre anterior inteiro.",
      atencao: `Não há CAC por unidade medido: a tabela de CAC por unidade (ops.roas_por_unidade) parou em jun/2026 e repete o CAC da rede em todas as unidades, e o Funil de CAC mede a cobrança do honorário às unidades, não custo. As vendas do Growth incluem as unidades em implantação e os negócios "(cópia)". ${ignoraFiltro}`,
      dono: "Marketing (mídia paga do Growth)",
    },
  };
  if (!d.midia.ok) return [numeroSem(baseM, ...semDado(d.midia)), numeroSem(baseC, ...semDado(d.midia))];
  const mesesAteHoje = r.tri.meses.filter((m) => m <= r.hoje.slice(0, 7));
  const s = somaSerie(d.midia.dado.serie, mesesAteHoje);
  const sAnt = somaSerie(d.midia.dado.serie, r.ant.meses);
  const dataDado = d.midia.atualizadoEm;
  if (!s.meses) {
    const motivo = `a série do Growth não tem ${r.tri.rotulo}`;
    return [numeroSem(baseM, "nao_apurado", motivo, { dataDado }), numeroSem(baseC, "nao_apurado", motivo, { dataDado })];
  }
  const planosLidos = d.midia.dado.planos;
  const planos = r.tri.meses.map((m) =>
    num(planosLidos.find((p) => String(p.mes).slice(0, 7) === m && p.metrica === "investimento_mes")?.alvo),
  );
  const plano = planos.every((p) => p !== null) ? somaReais(planos) : null;
  const dados = tabela(
    ["Mês", "Mídia (R$)", "MRR novo (R$)", "Vendas", "ROAS", "Custo por venda (R$)"],
    [...s.linhas]
      .sort((a, b) => String(a.mes).localeCompare(String(b.mes)))
      .map((l) => {
        const inv = num(l.investimento);
        const mrr = num(l.mrr);
        const vendas = num(l.vendas);
        return [
          rotuloMes(String(l.mes).slice(0, 7)),
          inv,
          mrr,
          vendas,
          inv && mrr !== null ? Math.round((mrr / inv) * 100) / 100 : null,
          inv !== null && vendas ? Math.round((inv / vendas) * 100) / 100 : null,
        ];
      }),
  );
  const tendencia = {
    valores: mesesAteHoje.map((m) => num(s.linhas.find((l) => String(l.mes).slice(0, 7) === m)?.investimento)),
    rotulo: "mídia por mês do trimestre",
  };
  const midia = numeroOk(baseM, s.investimento, {
    meta: plano !== null ? { valor: plano, rotulo: `plano ${r.tri.rotulo}` } : undefined,
    nota:
      s.investimento > 0
        ? `ROAS ${vezes(s.mrr / s.investimento)}: MRR novo ÷ mídia`
        : "sem mídia registrada no trimestre",
    tendencia,
    dataDado,
    dados,
  });
  const cacAnt = sAnt.meses && sAnt.vendas > 0 ? Math.round((sAnt.investimento / sAnt.vendas) * 100) / 100 : null;
  const cac =
    s.vendas > 0
      ? numeroOk(baseC, Math.round((s.investimento / s.vendas) * 100) / 100, {
          nota: "da rede inteira: CAC por unidade não é medido",
          delta:
            cacAnt !== null
              ? {
                  valor: Math.round((s.investimento / s.vendas - cacAnt) * 100) / 100,
                  rotulo: `vs ${r.ant.rotulo}`,
                  sentido: "menor-melhor",
                }
              : undefined,
          dataDado,
          dados,
        })
      : numeroSem(baseC, "nao_apurado", "nenhuma venda do Growth no trimestre", { dataDado });
  return [midia, cac];
}

// ── 6. Broker ────────────────────────────────────────────────────────────────────────────────

const ABERTAS = new Set(["disponivel", "reservado"]);

function brokerDoRecorte(linhas: LinhaBroker[], r: Recorte) {
  // A fila (disponível) é da rede inteira e não tem unidade: entra quando o filtro é a rede toda.
  const incluiFila = r.filtro === "" || r.filtro === "rede";
  const ids = new Set(r.sel.map((u) => u.id));
  const daUnidade = (l: LinhaBroker) => r.filtro === "" || (l.reservado_por !== null && ids.has(Number(l.reservado_por)));
  const fila = incluiFila ? linhas.filter((l) => l.status === "disponivel") : [];
  const reservadas = linhas.filter((l) => l.status === "reservado" && daUnidade(l));
  const convertidas = linhas.filter((l) => {
    const f = String(l.fechado_em ?? "").slice(0, 10);
    return l.status === "comprado" && f >= r.tri.inicio && f < r.tri.fim && daUnidade(l);
  });
  const parada = (l: LinhaBroker) =>
    ABERTAS.has(l.status) && !!l.updated_at && diasEntre(String(l.updated_at).slice(0, 10), r.hoje) > DIAS_BROKER_PARADA;
  return { incluiFila, fila, reservadas, convertidas, parada };
}

function numeroBroker(d: DadosGrowth, r: Recorte): NumeroCoo {
  const base: BaseNumero = {
    id: "broker",
    rotulo: "Oportunidades abertas no Broker",
    unidade: "negócios",
    cobertura: "todas",
    fonte: "Broker da Expansão",
    destino: destinoBroker(r.filtro),
    explicacao: {
      oQueDiz: "Quantas oportunidades do Broker estão abertas (na fila ou reservadas) e quantas já viraram contrato no trimestre.",
      comoCalcula:
        "ops.broker_oportunidades: abertas = disponíveis na fila + reservadas; convertidas = compradas com fechamento no trimestre. A fila não tem unidade: entra só com o filtro de todas as unidades ou da rede regional; com outro filtro, contam as reservas e compras das unidades do filtro.",
      dono: "Broker da Expansão (Eliezek)",
    },
  };
  if (!d.broker.ok) return numeroSem(base, ...semDado(d.broker));
  const b = brokerDoRecorte(d.broker.dado, r);
  const abertas = [...b.fila, ...b.reservadas];
  const paradas = abertas.filter(b.parada).length;
  return numeroOk(base, abertas.length, {
    nota: `${plural(b.convertidas.length, "convertida", "convertidas")} em contrato no ${r.tri.rotulo}`,
    dataDado: d.broker.atualizadoEm,
    dados: tabela(
      ["Situação", "Oportunidades"],
      [
        ["Na fila (disponíveis)", b.incluiFila ? b.fila.length : null],
        ["Reservadas", b.reservadas.length],
        [`Convertidas em contrato no ${r.tri.rotulo}`, b.convertidas.length],
        [`Abertas sem atualização há mais de ${DIAS_BROKER_PARADA} dias`, paradas],
      ],
    ),
  });
}

// ── Gráfico ──────────────────────────────────────────────────────────────────────────────────

function graficoMetas(d: DadosGrowth, r: Recorte): GraficoCoo {
  const base = {
    id: "meta-vendido-unidade",
    titulo: "Quanto cada unidade já vendeu da meta do trimestre?",
    tipo: "barras-h" as const,
    series: [
      { chave: "meta", rotulo: `Meta ${r.tri.rotulo}` },
      { chave: "vendido", rotulo: "MRR novo vendido" },
    ],
    unidade: "reais" as const,
    fonte: "Distribuição de metas do Growth",
    destino: destinoGrowthUnidades(r.tri),
    explicacao: {
      oQueDiz: "Meta e MRR novo vendido de cada unidade em operação, da mais atrasada (menor % da meta) para a mais adiantada.",
      comoCalcula: `growth.dist_metas no trimestre ${r.tri.chave}; só unidades do filtro em operação com meta maior que zero. Ritmo esperado hoje: ${pct(r.tri.fracao)} da meta.`,
      dono: "Comercial (distribuição de metas no Growth)",
    } as Explicacao,
  };
  if (!d.metas.ok) return grafico(base, [], { estado: d.metas.estado, motivo: d.metas.motivo });
  const { porUnidade } = metasDoTrimestre(d.metas.dado, r);
  const pontos = r.desempenho
    .map((u) => porUnidade.get(u.id))
    .filter((x): x is MetaUnidade => !!x && x.meta > 0)
    .sort((a, b) => a.vendido / a.meta - b.vendido / b.meta || a.unidade.nome.localeCompare(b.unidade.nome, "pt-BR"))
    .map((x) => ({ rotulo: x.unidade.nome, meta: x.meta, vendido: x.vendido }));
  return grafico(base, pontos, {
    dataDado: d.metas.atualizadoEm,
    ...(pontos.length ? {} : { motivo: `nenhuma unidade do filtro em operação tem meta no Growth para ${r.tri.rotulo}` }),
  });
}

// ── Alertas ──────────────────────────────────────────────────────────────────────────────────

function alertasRitmo(d: DadosGrowth, r: Recorte): AlertaCoo[] {
  if (!d.metas.ok || r.tri.decorridos < DIAS_MINIMOS_RITMO) return [];
  const { porUnidade } = metasDoTrimestre(d.metas.dado, r);
  const limiar = `Vendido abaixo de ${pct(LIMIAR_RITMO)} do ritmo esperado para a data (meta × dias corridos ÷ dias do trimestre: ${pct(r.tri.fracao)} em ${r.hoje.slice(8, 10)}/${r.hoje.slice(5, 7)}), só unidade em operação com meta, a partir do ${DIAS_MINIMOS_RITMO + 1}º dia do trimestre.`;
  const out: AlertaCoo[] = [];
  for (const u of r.desempenho) {
    const x = porUnidade.get(u.id);
    if (!x || x.meta <= 0) continue;
    const esperado = x.meta * r.tri.fracao;
    if (x.vendido >= LIMIAR_RITMO * esperado) continue;
    out.push(
      alerta("growth", "abaixo-do-ritmo", "critico", `${u.nome} · ${pct(x.vendido / esperado)} do ritmo da meta do trimestre`, {
        unidade: u.nome,
        peso: Math.round(esperado - x.vendido),
        destino: destinoGrowthUnidades(r.tri),
        limiar,
        periodo: r.tri.chave,
      }),
    );
  }
  return out;
}

function alertasMidiaSemContrato(d: DadosGrowth, r: Recorte): AlertaCoo[] {
  if (!d.midiaUnidades.ok || !d.contratos.ok) return [];
  const mes = mesAnterior(r.hoje.slice(0, 7));
  const inicio = `${mes}-01`;
  const fim = `${r.hoje.slice(0, 7)}-01`;
  const v = vendasNaJanela(d.contratos.dado, r, inicio, fim, r.desempenho);
  const limiar = `Mídia paga pela unidade (CSC de tráfego pago da apuração confirmada) maior que zero no último mês fechado (${rotuloMes(mes)}) e nenhum contrato novo do pipe Inside Sales no mesmo mês. Só rede regional em operação: a operação própria não tem apuração de mídia.`;
  const out: AlertaCoo[] = [];
  for (const u of r.desempenho) {
    if (u.grupo !== "rede") continue;
    const midia = somaReais(
      d.midiaUnidades.dado
        .filter((l) => Number(l.unidade_id) === u.id && String(l.mes_referencia).slice(0, 7) === mes)
        .map((l) => num(l.csc_trafego_pago)),
    );
    if (midia <= 0 || (v.porUnidade.get(u.id)?.n ?? 0) > 0) continue;
    out.push(
      alerta("growth", "midia-sem-contrato", "atencao", `${u.nome} · ${reaisCurto(midia)} de mídia em ${rotuloMes(mes)} e nenhum contrato novo`, {
        unidade: u.nome,
        peso: midia,
        destino: destinoApuracao(mes),
        limiar,
        periodo: mes,
      }),
    );
  }
  return out;
}

function alertasBroker(d: DadosGrowth, r: Recorte): AlertaCoo[] {
  if (!d.broker.ok) return [];
  const b = brokerDoRecorte(d.broker.dado, r);
  const dest = destinoBroker(r.filtro);
  const limiar = `Oportunidade aberta (na fila ou reservada) sem nenhuma atualização (updated_at) há mais de ${DIAS_BROKER_PARADA} dias.`;
  const out: AlertaCoo[] = [];
  for (const l of b.reservadas.filter(b.parada)) {
    const u = r.unidades.find((x) => x.id === Number(l.reservado_por)) ?? null;
    const dias = diasEntre(String(l.updated_at).slice(0, 10), r.hoje);
    out.push(
      alerta("growth", "broker-reserva-parada", "atencao", `${u ? u.nome : "Broker"} · reserva no Broker parada há ${dias} dias`, {
        unidade: u?.nome ?? null,
        peso: num(l.mrr_precificado) ?? 0,
        destino: dest,
        limiar,
        periodo: `oportunidade-${l.id}`,
      }),
    );
  }
  const filaParada = b.fila.filter(b.parada);
  if (filaParada.length)
    out.push(
      alerta(
        "growth",
        "broker-fila-parada",
        "atencao",
        `Broker · ${plural(filaParada.length, "oportunidade parada", "oportunidades paradas")} na fila há mais de ${DIAS_BROKER_PARADA} dias`,
        {
          unidade: null,
          peso: somaReais(filaParada.map((l) => num(l.mrr_precificado))),
          destino: dest,
          limiar,
          periodo: r.tri.chave,
        },
      ),
    );
  return out;
}

// ── Tema ─────────────────────────────────────────────────────────────────────────────────────

const NOMES_FONTES: Record<keyof DadosGrowth, string> = {
  metas: "Distribuição de metas do Growth",
  contratos: "Contratos do Ops (pipe Inside Sales)",
  midia: "Série mensal de mídia e vendas do Growth",
  midiaUnidades: "Apuração de royalties (mídia paga pela unidade)",
  broker: "Broker da Expansão",
};

export function montarGrowth(
  dados: DadosGrowth,
  unidades: UnidadeCoo[],
  filtro: FiltroUnidade,
  hoje: string,
): LeituraTema {
  const tri = janelaTrimestre(hoje);
  const sel = unidadesDoFiltro(unidades, filtro);
  const r: Recorte = {
    unidades,
    filtro,
    hoje,
    tri,
    ant: trimestreAnterior(tri),
    sel,
    desempenho: sel.filter((u) => u.emOperacao),
    implantacao: sel.filter((u) => !u.emOperacao),
  };

  const numeros = [
    numeroMrrMeta(dados, r),
    ...numerosContratos(dados, r),
    ...numerosMidia(dados, r),
    numeroBroker(dados, r),
  ];
  if (numeros.length > MAX_NUMEROS) throw new Error(`o tema Growth montou ${numeros.length} números`);

  const alertas = ordenarAlertas([
    ...alertasRitmo(dados, r),
    ...alertasMidiaSemContrato(dados, r),
    ...alertasBroker(dados, r),
  ]);

  const fontes: Procedencia[] = (Object.keys(NOMES_FONTES) as (keyof DadosGrowth)[]).map((k) => {
    const p = dados[k];
    return { fonte: NOMES_FONTES[k], atualizadoEm: p.ok ? p.atualizadoEm : null };
  });

  const avisos: string[] = [];
  if (r.implantacao.length)
    avisos.push(
      `${nomes(r.implantacao)} ${r.implantacao.length === 1 ? "está" : "estão"} em implantação (sem inauguração no cadastro) e ${r.implantacao.length === 1 ? "fica" : "ficam"} fora dos números de desempenho e do gráfico, mesmo vendendo pelo Inside Sales.`,
    );
  if (dados.metas.ok) {
    const { semCadastro } = metasDoTrimestre(dados.metas.dado, r);
    if (semCadastro.length)
      avisos.push(`Metas do Growth sem unidade no cadastro, fora da leitura: ${semCadastro.join(", ")}.`);
  }
  if (tri.decorridos < DIAS_MINIMOS_RITMO)
    avisos.push(`Início de trimestre: o alerta de ritmo da meta só dispara a partir do ${DIAS_MINIMOS_RITMO + 1}º dia.`);

  return {
    tema: "growth",
    universo: universo(unidades, filtro),
    numeros,
    alertas,
    graficos: [graficoMetas(dados, r)],
    fontes,
    avisos,
  };
}
