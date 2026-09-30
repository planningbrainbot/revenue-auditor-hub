// Qua · CS e RH: "Os clientes e as equipes das unidades estão saudáveis, e as vagas andam?"
//
// Pedido do COO em 29/09/2026: "Preciso saber quantas vagas abertas nós temos com a Heloisa,
// quantas preenchidas, etc." Não existe fonte de vagas no Brain nem no Pipefy: o recrutamento roda
// no PandaPé, sem integração. "Vagas abertas" sai como não apurado, com a Heloísa como dona da
// lacuna, e "Admissões no mês" (cadastro de pessoas) entra como o número real que existe.
//
// Arquivo PURO: sem I/O e só imports relativos com extensão (os testes rodam no Node removendo
// tipos). As linhas chegam cruas de `cs-rh.server.ts`, com os nomes de coluna do banco, e o recorte
// de unidade é aplicado aqui.
//
// Régua do churn (a do IDU, entrada "Método IDU" de 28/08 no DECISIONS.md, RPC `idu_apuracao`):
// MRR dos cards com data de churn no período ÷ carteira de MRR da unidade (`ops.v_mrr_por_unidade`).
// Duas diferenças, ambas por defeito de dado conferido em 29/09:
// 1. O MRR perdido vem do CONTRATO do negócio (`contratos.mrr_mensal` pelo `pipedrive_deal_id`), não
//    do card: a sincronização da Central lê "12.000" como 12 e "760,00" como 76000
//    (`numeroOuNulo` em supabase/functions/pipefy-tratativas-sync/domain.mjs). Com o MRR do card, o
//    churn de Fortaleza no 3º trimestre dá 0,02% no IDU; com o do contrato, 16,8%.
// 2. Só conta card com churn confirmado (`status = 'lost'`, o critério da tela de Clientes e das
//    coortes do CEO). O IDU conta todo card com data de churn, inclusive tratativa em aberto.
// "Sem registro" (spec, §5): unidade que nunca lançou card na Central aparece como sem registro,
// nunca como 0%. Unidade que usa a Central e não teve card no trimestre tem churn zero de fato.
import { ordenarAlertas } from "../contrato.ts";
import type {
  AlertaCoo,
  Destino,
  GraficoCoo,
  LeituraTema,
  NumeroCoo,
  Procedencia,
} from "../contrato.ts";
import {
  alerta,
  destino,
  grafico,
  inicioDoMes,
  numeroOk,
  numeroSem,
  tabela,
  trimestre,
} from "../montar.ts";
import type { BaseNumero } from "../montar.ts";
import { acharUnidade, unidadesDoFiltro, universo } from "../unidades.ts";
import type { FiltroUnidade, UnidadeCoo } from "../unidades.ts";

// ---------------------------------------------------------------------------------------------
// Dados crus (o que o servidor entrega): colunas do banco, uma parte por fonte
// ---------------------------------------------------------------------------------------------

export type FalhaParte = {
  ok: false;
  estado: "fonte_indisponivel" | "acesso_insuficiente";
  motivo: string;
};

export type Parte<T> = ({ ok: true } & T) | FalhaParte;

/** `ops.central_tratativas`. `status`: open (em tratativa), lost (churn confirmado), won (revertido). */
export interface LinhaTratativa {
  id: number;
  status: string | null;
  unidade: string | null;
  data_churn: string | null;
  pipedrive_deal_id: number | string | null;
  pipefy_criado_em: string | null;
  created_at: string | null;
}

/** Contratos dos negócios que têm card na Central (`ops.contratos`). */
export interface LinhaContratoDeal {
  pipedrive_deal_id: string | number | null;
  mrr_mensal: number | string | null;
}

/** `ops.v_mrr_por_unidade`: a carteira que o IDU usa como denominador do churn. */
export interface LinhaCarteira {
  unidade: string | null;
  num_contratos: number | string | null;
  mrr_total: number | string | null;
}

/** `ops.nps_pesquisas`. */
export interface LinhaPesquisa {
  id: number;
  unidade: string | null;
  nps_recomendacao: string | null;
  data_envio: string | null;
  created_at: string | null;
  canal_resposta: string | null;
}

/** `ops.auditorias_internas`. */
export interface LinhaAuditoria {
  pipefy_card_id: string;
  unidade: string | null;
  fase_atual: string | null;
  auditoria_finalizada: boolean | null;
  prazo_atual: string | null;
}

/** `ops.gente_pessoas` (só as colunas de lotação e admissão). */
export interface LinhaPessoa {
  id: number;
  unidade_id: number | null;
  data_admissao: string | null;
}

export interface DadosCsRh {
  tratativas: Parte<{ linhas: LinhaTratativa[]; atualizadoEm: string | null }>;
  /** Contratos dos negócios das tratativas, para o MRR perdido. */
  contratos: Parte<{ linhas: LinhaContratoDeal[] }>;
  carteira: Parte<{ linhas: LinhaCarteira[] }>;
  /** Meta de churn da rede no IDU para o trimestre (`idu_metas_padrao`); null = nenhuma gravada. */
  metaChurn: Parte<{ valor: number | null }>;
  nps: Parte<{ linhas: LinhaPesquisa[]; atualizadoEm: string | null }>;
  /** Pesquisas com ao menos uma ligação registrada (`ops.nps_ligacoes.nps_pesquisa_id`). */
  ligacoes: Parte<{ pesquisaIds: number[]; atualizadoEm: string | null }>;
  auditorias: Parte<{ linhas: LinhaAuditoria[]; atualizadoEm: string | null }>;
  pessoas: Parte<{ linhas: LinhaPessoa[]; atualizadoEm: string | null }>;
}

// ---------------------------------------------------------------------------------------------
// Réguas (limiares escritos aqui: vão para a gaveta e para a descrição da tarefa no ClickUp)
// ---------------------------------------------------------------------------------------------

/** Tratativa de cancelamento aberta há mais que isto vira alerta; acima do segundo, crítico. */
export const TRATATIVA_ALERTA_DIAS = 10;
export const TRATATIVA_CRITICA_DIAS = 30;
/** Detrator: pesquisa enviada nesta janela; crítico depois de tantos dias sem ligação. */
export const DETRATOR_JANELA_DIAS = 90;
export const DETRATOR_CRITICO_DIAS = 7;
/** Auditoria em andamento com prazo vencido há mais que isto. */
export const AUDITORIA_ATRASO_DIAS = 30;
/** Abaixo disto o NPS não é calculado (a mesma amostra mínima da satisfação no IDU). */
export const NPS_AMOSTRA_MINIMA = 5;
/** Meta de churn que o IDU aplica quando ninguém gravou meta para o trimestre (5% no trimestre). */
export const META_CHURN_FIXA = 5;

/** Fases finais do pipe da Auditoria Interna: a mesma régua de /auditoria-interna. */
export const FASES_AUDITORIA_CONCLUIDA = new Set([
  "Projeto Concluído",
  "Reforma Tributária Concluida",
  "Solicitações Comerciais",
]);

const TEMA = "cs-rh" as const;
const DONO_CS = "Relacionamento & CS (Ana)";
const DONO_AUDITORIA = "Auditoria & Qualidade";
const DONO_GENTE = "Heloísa (Gente e Gestão)";

// ---------------------------------------------------------------------------------------------
// Datas e números
// ---------------------------------------------------------------------------------------------

/** Data (AAAA-MM-DD) em São Paulo de um timestamp do banco; data pura volta como está. */
export function dataSaoPaulo(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // PostgREST devolve "2026-07-06T13:36:48+00:00"; a Management API, "2026-07-06 13:36:48+00".
  const t = Date.parse(s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (!Number.isFinite(t)) return null;
  // Brasília não tem horário de verão desde 2019: UTC−3 o ano inteiro.
  return new Date(t - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Dias corridos de `de` até `ate` (datas AAAA-MM-DD). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

export function inicioDoTrimestre(hoje: string): string {
  const { ano, t } = trimestre(hoje);
  return `${ano}-${String((t - 1) * 3 + 1).padStart(2, "0")}-01`;
}

function menosDias(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Nota de recomendação 0–10; qualquer outra coisa (vazio, "Sem Resposta") é "não respondeu". */
export function notaNps(v: string | null | undefined): number | null {
  const s = String(v ?? "").trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n <= 10 ? n : null;
}

const um = (x: number) => Math.round(x * 10) / 10;
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const pct = (x: number) => `${decimal.format(x)}%`;
const nomes = (us: UnidadeCoo[]) => us.map((u) => u.nome).join(", ");
const plural = (n: number, singular: string, varios: string) => (n === 1 ? singular : varios);

// ---------------------------------------------------------------------------------------------
// Destinos (telas donas no Ops)
// ---------------------------------------------------------------------------------------------

const OBS_PAINEL_CS =
  "o painel de CS mostra só as unidades da lista antiga da rede e o MRR do card, que chega na escala errada";

function destinoTratativas(status: "open" | "lost", extra: Record<string, string> = {}): Destino {
  return destino(
    "/painel-cs",
    status === "open" ? "Abrir tratativas abertas no painel de CS" : "Abrir o churn no painel de CS",
    false,
    OBS_PAINEL_CS,
    { aba: "tratativas", status, ...extra },
  );
}

function destinoNps(extra: Record<string, string> = {}): Destino {
  return destino("/nps", "Abrir o NPS", false, "a tela do NPS não recorta por trimestre", extra);
}

const DESTINO_AUDITORIA = destino(
  "/auditoria-interna",
  "Abrir a Auditoria Interna",
  false,
  "a tela mostra todas as unidades e também projetos sem unidade do cadastro",
);

const DESTINO_GENTE = destino(
  "/gente",
  "Abrir o cadastro de pessoas",
  false,
  "o cadastro lista todas as pessoas, sem recorte por mês de admissão",
  { tela: "cadastro" },
);

// ---------------------------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------------------------

interface ChurnUnidade {
  u: UnidadeCoo;
  carteira: number;
  usaCentral: boolean;
  perdidos: number;
  mrrPerdido: number;
  semMrr: number;
  /** % do MRR no trimestre; null = sem registro, ou card sem MRR no contrato. */
  churn: number | null;
}

export function montarCsRh(
  d: DadosCsRh,
  unidades: UnidadeCoo[],
  filtro: FiltroUnidade,
  hoje: string,
): LeituraTema {
  const sel = unidadesDoFiltro(unidades, filtro);
  const idsSel = new Set(sel.map((u) => u.id));
  const emOperacao = sel.filter((u) => u.emOperacao);
  const umaUnidade = /^\d+$/.test(filtro) && sel.length === 1 ? sel[0] : null;
  const tri = trimestre(hoje);
  const iniTri = inicioDoTrimestre(hoje);
  const iniMes = inicioDoMes(hoje);
  const unidadeDe = (texto: string | null | undefined) => acharUnidade(unidades, texto);
  const buscaUnidade: Record<string, string> = umaUnidade ? { unidade: umaUnidade.nome } : {};

  const numeros: NumeroCoo[] = [];
  const alertas: AlertaCoo[] = [];
  const graficos: GraficoCoo[] = [];
  const fontes: Procedencia[] = [];
  const avisos: string[] = [
    "Churn e tratativas só contam o que foi lançado na Central de Tratativas; unidade sem card aparece como sem registro.",
    "O MRR perdido vem do contrato do negócio: o MRR do card chega à base na escala errada.",
    "Headcount e turnover ficam de fora: o lançamento mensal por unidade está vazio.",
  ];

  // Motivo de "fora do desempenho" quando o filtro só tem unidade em implantação.
  const semOperacao = umaUnidade
    ? `${umaUnidade.nome} está em implantação: não entra em número de desempenho`
    : "nenhuma unidade do filtro está em operação";

  // ── Tratativas: quem usa a Central, cards por unidade ───────────────────────────────────────
  const tratativas = d.tratativas.ok
    ? d.tratativas.linhas.map((t) => ({ ...t, u: unidadeDe(t.unidade) }))
    : [];
  const usaCentral = new Set(tratativas.filter((t) => t.u).map((t) => t.u!.id));

  const mrrDoDeal = new Map<string, number>();
  if (d.contratos.ok)
    for (const c of d.contratos.linhas) {
      if (c.pipedrive_deal_id === null || c.pipedrive_deal_id === undefined) continue;
      const v = numero(c.mrr_mensal);
      if (v === null) continue;
      const k = String(c.pipedrive_deal_id);
      mrrDoDeal.set(k, (mrrDoDeal.get(k) ?? 0) + v);
    }

  const carteiraDe = new Map<number, number>();
  if (d.carteira.ok)
    for (const c of d.carteira.linhas) {
      const u = unidadeDe(c.unidade);
      const v = numero(c.mrr_total);
      if (u && v !== null) carteiraDe.set(u.id, (carteiraDe.get(u.id) ?? 0) + v);
    }

  const perdidosNoTri = tratativas.filter(
    (t) =>
      t.u &&
      (t.status ?? "").toLowerCase() === "lost" &&
      t.data_churn &&
      t.data_churn.slice(0, 10) >= iniTri &&
      t.data_churn.slice(0, 10) <= hoje,
  );

  const churnPorUnidade: ChurnUnidade[] = emOperacao.map((u) => {
    const carteira = carteiraDe.get(u.id) ?? 0;
    const dela = perdidosNoTri.filter((t) => t.u!.id === u.id);
    let mrrPerdido = 0;
    let semMrr = 0;
    for (const t of dela) {
      const v = t.pipedrive_deal_id === null ? undefined : mrrDoDeal.get(String(t.pipedrive_deal_id));
      if (v === undefined) semMrr += 1;
      else mrrPerdido += v;
    }
    const usa = usaCentral.has(u.id);
    const churn = !usa || semMrr > 0 || carteira <= 0 ? null : um((mrrPerdido / carteira) * 100);
    return { u, carteira, usaCentral: usa, perdidos: dela.length, mrrPerdido, semMrr, churn };
  });

  const falhaChurn = [d.tratativas, d.carteira, d.contratos].find((p) => !p.ok) as FalhaParte | undefined;
  const semRegistro = churnPorUnidade.filter((c) => !c.usaCentral).map((c) => c.u);
  const comRegistro = churnPorUnidade.filter((c) => c.usaCentral);
  const cardsSemMrr = comRegistro.reduce((s, c) => s + c.semMrr, 0);
  const motivoParcialChurn = [
    "só conta o churn lançado na Central de Tratativas",
    semRegistro.length ? `sem registro: ${nomes(semRegistro)}` : "",
    cardsSemMrr
      ? `${cardsSemMrr} ${plural(cardsSemMrr, "card sem contrato para dar o MRR", "cards sem contrato para dar o MRR")} (${nomes(
          comRegistro.filter((c) => c.semMrr > 0).map((c) => c.u),
        )})`
      : "",
  ]
    .filter(Boolean)
    .join("; ");

  // ── 1. Churn no trimestre ────────────────────────────────────────────────────────────────────
  {
    const b: BaseNumero = {
      id: "churn-trimestre",
      rotulo: "Churn no trimestre",
      unidade: "percentual",
      cobertura: "todas",
      fonte: "Pipefy: Central de Tratativas, com o MRR dos contratos",
      destino: destinoTratativas("lost", { de: iniTri, ate: hoje, ...buscaUnidade }),
      explicacao: {
        oQueDiz: `Quanto do MRR da carteira saiu no ${tri.rotulo}, pelo que foi lançado como churn confirmado na Central de Tratativas.`,
        comoCalcula:
          "MRR mensal dos contratos dos cards com churn confirmado (status perdido) e data de churn no trimestre, dividido pela carteira de MRR das mesmas unidades (ops.v_mrr_por_unidade, a base do IDU). Entram as unidades em operação que já lançaram algum card na Central (ops.central_tratativas); a que nunca lançou fica de fora como sem registro.",
        atencao:
          "O MRR sai do contrato do negócio, não do card: a sincronização da Central lê o MRR do card na escala errada (R$ 12.000 vira 12), e por isso o churn da tela do IDU fica perto de zero. É um piso: churn que não virou card não aparece.",
        dono: DONO_CS,
      },
    };
    if (falhaChurn) numeros.push(numeroSem(b, falhaChurn.estado, falhaChurn.motivo));
    else if (!emOperacao.length) numeros.push(numeroSem(b, "nao_apurado", semOperacao));
    else if (!comRegistro.length)
      numeros.push(
        numeroSem(b, "nao_apurado", "nenhuma unidade do filtro lança churn na Central de Tratativas", {
          nota: "sem registro, não 0%",
        }),
      );
    else {
      const carteira = comRegistro.reduce((s, c) => s + c.carteira, 0);
      if (carteira <= 0)
        numeros.push(numeroSem(b, "nao_apurado", "as unidades que lançam churn na Central não têm carteira de contratos"));
      else {
        const perdidos = comRegistro.reduce((s, c) => s + c.perdidos, 0);
        const mrr = comRegistro.reduce((s, c) => s + c.mrrPerdido, 0);
        const valor = um((mrr / carteira) * 100);
        const meta = d.metaChurn.ok
          ? d.metaChurn.valor !== null
            ? { valor: d.metaChurn.valor, rotulo: "meta da rede no IDU" }
            : { valor: META_CHURN_FIXA, rotulo: "meta padrão do IDU" }
          : undefined;
        numeros.push(
          numeroOk(b, valor, {
            estado: "parcial",
            motivo: motivoParcialChurn,
            nota: `${perdidos} ${plural(perdidos, "cliente perdido", "clientes perdidos")} no ${tri.rotulo}`,
            meta,
            tom: meta && valor > meta.valor ? "perigo" : undefined,
            dataDado: d.tratativas.ok ? dataSaoPaulo(d.tratativas.atualizadoEm) : null,
            dados: tabela(
              ["Unidade", "Carteira (MRR)", "Clientes perdidos", "MRR perdido", "Churn no trimestre (%)"],
              churnPorUnidade.map((c) =>
                c.usaCentral
                  ? [c.u.nome, Math.round(c.carteira), c.perdidos, Math.round(c.mrrPerdido), c.churn ?? "sem MRR"]
                  : [c.u.nome, Math.round(c.carteira), null, null, "sem registro"],
              ),
            ),
          }),
        );
      }
    }
  }

  // ── 2. Tratativas de cancelamento abertas ────────────────────────────────────────────────────
  const abertas = tratativas
    .filter((t) => (t.status ?? "").toLowerCase() === "open")
    .map((t) => {
      const desde = dataSaoPaulo(t.pipefy_criado_em ?? t.created_at);
      return { ...t, dias: desde ? diasEntre(desde, hoje) : null };
    });
  {
    const b: BaseNumero = {
      id: "tratativas-abertas",
      rotulo: "Tratativas de cancelamento abertas",
      unidade: "clientes",
      cobertura: "todas",
      fonte: "Pipefy: Central de Tratativas",
      destino: destinoTratativas("open", buscaUnidade),
      explicacao: {
        oQueDiz: "Quantos clientes pediram para sair e ainda estão em tratativa, sem churn confirmado nem reversão.",
        comoCalcula:
          "Cards da Central de Tratativas (ops.central_tratativas) com status aberto nas unidades do filtro, inclusive as em implantação. A idade conta da criação do card no Pipefy.",
        dono: DONO_CS,
      },
    };
    if (!d.tratativas.ok) numeros.push(numeroSem(b, d.tratativas.estado, d.tratativas.motivo));
    else {
      const doFiltro = abertas.filter((t) => t.u && idsSel.has(t.u.id));
      const foraDoCadastro = filtro === "" ? abertas.filter((t) => !t.u).length : 0;
      const nunca = sel.filter((u) => !usaCentral.has(u.id));
      const atencao = [
        nunca.length
          ? `Sem nenhum card na Central: ${nomes(nunca)}. Cancelamento dessas unidades, se houver, não aparece aqui.`
          : "",
        foraDoCadastro
          ? `${foraDoCadastro} ${plural(foraDoCadastro, "tratativa aberta sem unidade do cadastro ficou", "tratativas abertas sem unidade do cadastro ficaram")} fora.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (atencao) b.explicacao.atencao = atencao;
      const idades = doFiltro.map((t) => t.dias).filter((x): x is number => x !== null);
      const maisAntiga = idades.length ? Math.max(...idades) : null;
      const porUnidade = sel
        .map((u) => {
          const dela = doFiltro.filter((t) => t.u!.id === u.id);
          const ds = dela.map((t) => t.dias).filter((x): x is number => x !== null);
          return { u, n: dela.length, maior: ds.length ? Math.max(...ds) : null };
        })
        .filter((x) => x.n > 0);
      numeros.push(
        numeroOk(b, doFiltro.length, {
          nota: doFiltro.length
            ? maisAntiga !== null
              ? `a mais antiga está aberta há ${maisAntiga} dias`
              : "sem data de abertura no card"
            : "nenhuma tratativa aberta",
          tom:
            maisAntiga !== null && maisAntiga > TRATATIVA_CRITICA_DIAS
              ? "perigo"
              : maisAntiga !== null && maisAntiga > TRATATIVA_ALERTA_DIAS
                ? "atencao"
                : undefined,
          dataDado: dataSaoPaulo(d.tratativas.atualizadoEm),
          dados: tabela(
            ["Unidade", "Tratativas abertas", "Mais antiga (dias)"],
            porUnidade.map((x) => [x.u.nome, x.n, x.maior]),
          ),
        }),
      );

      // Alerta: tratativa aberta há mais de 10 dias, por unidade.
      for (const u of sel) {
        const velhas = doFiltro.filter((t) => t.u!.id === u.id && t.dias !== null && t.dias > TRATATIVA_ALERTA_DIAS);
        if (!velhas.length) continue;
        const maior = Math.max(...velhas.map((t) => t.dias as number));
        alertas.push(
          alerta(
            TEMA,
            "tratativa-aberta",
            maior > TRATATIVA_CRITICA_DIAS ? "critico" : "atencao",
            velhas.length === 1
              ? `${u.nome} · tratativa de cancelamento aberta há ${maior} dias`
              : `${u.nome} · ${velhas.length} tratativas de cancelamento abertas há mais de ${TRATATIVA_ALERTA_DIAS} dias`,
            {
              unidade: u.nome,
              peso: maior,
              destino: destinoTratativas("open", { unidade: u.nome }),
              limiar: `tratativa de cancelamento aberta há mais de ${TRATATIVA_ALERTA_DIAS} dias na Central de Tratativas (crítico acima de ${TRATATIVA_CRITICA_DIAS})`,
              periodo: tri.rotulo,
            },
          ),
        );
      }
    }
  }

  // ── 3. NPS no trimestre e taxa de resposta ───────────────────────────────────────────────────
  const pesquisas = d.nps.ok
    ? d.nps.linhas.map((p) => ({
        ...p,
        u: unidadeDe(p.unidade),
        nota: notaNps(p.nps_recomendacao),
        envio: p.data_envio ? p.data_envio.slice(0, 10) : dataSaoPaulo(p.created_at),
      }))
    : [];
  {
    const b: BaseNumero = {
      id: "nps-trimestre",
      rotulo: "NPS no trimestre",
      unidade: "pontos",
      cobertura: "todas",
      fonte: "Pipefy: pesquisa NPS",
      destino: destinoNps(buscaUnidade),
      explicacao: {
        oQueDiz: `A nota de recomendação dos clientes que responderam à pesquisa enviada no ${tri.rotulo} (de −100 a 100), e quantos responderam.`,
        comoCalcula:
          "% de promotores (nota 9 ou 10) menos % de detratores (0 a 6) entre as pesquisas com nota, enviadas no trimestre (data de envio; sem ela, a de criação do card) às unidades em operação do filtro (ops.nps_pesquisas). A nota ao lado é a taxa de resposta: pesquisas com nota ÷ pesquisas enviadas.",
        atencao: `Com poucas respostas o NPS oscila muito: abaixo de ${NPS_AMOSTRA_MINIMA} respostas ele não é calculado, a mesma amostra mínima da satisfação no IDU.`,
        dono: DONO_CS,
      },
    };
    if (!d.nps.ok) numeros.push(numeroSem(b, d.nps.estado, d.nps.motivo));
    else if (!emOperacao.length) numeros.push(numeroSem(b, "nao_apurado", semOperacao));
    else {
      const ids = new Set(emOperacao.map((u) => u.id));
      const noTri = pesquisas.filter((p) => p.envio && p.envio >= iniTri && p.envio <= hoje);
      const doFiltro = noTri.filter((p) => p.u && ids.has(p.u.id));
      const semUnidade = filtro === "" ? noTri.filter((p) => !p.u).length : 0;
      if (semUnidade)
        b.explicacao.atencao = `${b.explicacao.atencao ?? ""} ${semUnidade} ${plural(semUnidade, "pesquisa sem unidade do cadastro ficou", "pesquisas sem unidade do cadastro ficaram")} fora.`;
      const conta = (ps: typeof doFiltro) => {
        const resp = ps.filter((p) => p.nota !== null);
        const prom = resp.filter((p) => (p.nota as number) >= 9).length;
        const det = resp.filter((p) => (p.nota as number) <= 6).length;
        return {
          enviadas: ps.length,
          respostas: resp.length,
          nps: resp.length ? Math.round(((prom - det) / resp.length) * 100) : null,
        };
      };
      const total = conta(doFiltro);
      const dados = tabela(
        ["Unidade", "Pesquisas enviadas", "Respostas", `NPS (${NPS_AMOSTRA_MINIMA}+ respostas)`],
        emOperacao.map((u) => {
          const c = conta(doFiltro.filter((p) => p.u!.id === u.id));
          return [u.nome, c.enviadas, c.respostas, c.respostas >= NPS_AMOSTRA_MINIMA ? c.nps : null];
        }),
      );
      const dataDado = dataSaoPaulo(d.nps.atualizadoEm);
      const taxa = total.enviadas ? um((total.respostas / total.enviadas) * 100) : null;
      if (!total.enviadas)
        numeros.push(numeroSem(b, "nao_apurado", `nenhuma pesquisa enviada no ${tri.rotulo}`, { dataDado }));
      else if (total.respostas < NPS_AMOSTRA_MINIMA)
        numeros.push(
          numeroSem(
            b,
            "nao_apurado",
            `só ${total.respostas} ${plural(total.respostas, "resposta", "respostas")} no ${tri.rotulo}; abaixo de ${NPS_AMOSTRA_MINIMA} o NPS não é calculado`,
            { nota: `${total.respostas} de ${total.enviadas} pesquisas respondidas (${pct(taxa as number)})`, dataDado },
          ),
        );
      else {
        const nps = total.nps as number;
        numeros.push(
          numeroOk(b, nps, {
            nota: `${total.respostas} respostas de ${total.enviadas} pesquisas (${pct(taxa as number)})`,
            // Mesma classificação da tela do NPS: abaixo de 0 crítico, de 0 a 49 razoável.
            tom: nps < 0 ? "perigo" : nps < 50 ? "atencao" : undefined,
            dataDado,
            dados,
          }),
        );
      }
    }
  }

  // Alerta: detrator sem ligação registrada (todas as unidades do filtro, inclusive implantação).
  if (d.nps.ok && d.ligacoes.ok) {
    const ligadas = new Set(d.ligacoes.pesquisaIds.map(Number));
    const desde = menosDias(hoje, DETRATOR_JANELA_DIAS);
    const semLigacao = pesquisas.filter(
      (p) =>
        p.u &&
        idsSel.has(p.u.id) &&
        p.nota !== null &&
        p.nota <= 6 &&
        p.envio &&
        p.envio >= desde &&
        p.envio <= hoje &&
        // Resposta colhida por ligação já é contato por telefone com o cliente.
        (p.canal_resposta ?? "").toLowerCase() !== "ligacao" &&
        !ligadas.has(Number(p.id)),
    );
    for (const u of sel) {
      const dela = semLigacao.filter((p) => p.u!.id === u.id);
      if (!dela.length) continue;
      const maior = Math.max(...dela.map((p) => diasEntre(p.envio as string, hoje)));
      alertas.push(
        alerta(
          TEMA,
          "detrator-sem-ligacao",
          maior > DETRATOR_CRITICO_DIAS ? "critico" : "atencao",
          dela.length === 1
            ? `${u.nome} · detrator sem ligação há ${maior} dias`
            : `${u.nome} · ${dela.length} detratores sem ligação registrada`,
          {
            unidade: u.nome,
            peso: maior,
            destino: destinoNps({ aba: "respostas", categoria: "detrator", unidade: u.nome }),
            limiar: `detrator (nota 0 a 6) em pesquisa enviada nos últimos ${DETRATOR_JANELA_DIAS} dias, sem ligação registrada nem resposta colhida por ligação (crítico ${DETRATOR_CRITICO_DIAS} dias após o envio)`,
            periodo: tri.rotulo,
          },
        ),
      );
    }
  } else if (d.nps.ok && !d.ligacoes.ok)
    avisos.push("Sem leitura das ligações do NPS: o alerta de detrator sem ligação não foi avaliado.");

  // ── 4. Auditorias internas em andamento ──────────────────────────────────────────────────────
  {
    const b: BaseNumero = {
      id: "auditorias-em-andamento",
      rotulo: "Auditorias internas em andamento",
      unidade: "contas",
      cobertura: "todas",
      fonte: "Pipefy: Auditoria Interna",
      destino: DESTINO_AUDITORIA,
      explicacao: {
        oQueDiz: "Quantos projetos da Auditoria Interna ainda não terminaram, e quantos já passaram do prazo.",
        comoCalcula:
          "Projetos do pipe da Auditoria Interna (ops.auditorias_internas) sem a marca de finalizada e fora das fases finais (Projeto Concluído, Reforma Tributária Concluida, Solicitações Comerciais), a mesma régua da tela. Prazo vencido = prazo do card antes de hoje.",
        dono: DONO_AUDITORIA,
      },
    };
    if (!d.auditorias.ok) numeros.push(numeroSem(b, d.auditorias.estado, d.auditorias.motivo));
    else {
      const andamento = d.auditorias.linhas
        .filter((a) => !a.auditoria_finalizada && !FASES_AUDITORIA_CONCLUIDA.has(a.fase_atual ?? ""))
        .map((a) => {
          const prazo = dataSaoPaulo(a.prazo_atual);
          return { ...a, u: unidadeDe(a.unidade), atraso: prazo && prazo < hoje ? diasEntre(prazo, hoje) : null, prazo };
        });
      const doFiltro = andamento.filter((a) => a.u && idsSel.has(a.u.id));
      const foraDoCadastro = filtro === "" ? andamento.filter((a) => !a.u).length : 0;
      const semPrazo = doFiltro.filter((a) => !a.prazo).length;
      const atencao = [
        semPrazo ? `${semPrazo} ${plural(semPrazo, "projeto está", "projetos estão")} sem prazo no card.` : "",
        foraDoCadastro
          ? `${foraDoCadastro} ${plural(foraDoCadastro, "projeto sem unidade do cadastro ficou", "projetos sem unidade do cadastro ficaram")} fora.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (atencao) b.explicacao.atencao = atencao;
      const vencidos = doFiltro.filter((a) => a.atraso !== null);
      numeros.push(
        numeroOk(b, doFiltro.length, {
          nota: vencidos.length
            ? `${vencidos.length} com prazo vencido`
            : doFiltro.length
              ? "nenhum com prazo vencido"
              : "nenhum projeto em andamento",
          tom: vencidos.some((a) => (a.atraso as number) > AUDITORIA_ATRASO_DIAS)
            ? "perigo"
            : vencidos.length
              ? "atencao"
              : undefined,
          dataDado: dataSaoPaulo(d.auditorias.atualizadoEm),
          dados: tabela(
            ["Unidade", "Em andamento", "Prazo vencido", "Mais atrasado (dias)"],
            sel
              .map((u) => ({ u, dela: doFiltro.filter((a) => a.u!.id === u.id) }))
              .filter((x) => x.dela.length > 0)
              .map(({ u, dela }) => {
                const atrasos = dela.map((a) => a.atraso).filter((x): x is number => x !== null);
                return [u.nome, dela.length, atrasos.length, atrasos.length ? Math.max(...atrasos) : null];
              }),
          ),
        }),
      );

      // Alerta: prazo vencido há mais de 30 dias, por unidade.
      for (const u of sel) {
        const dela = vencidos.filter((a) => a.u!.id === u.id && (a.atraso as number) > AUDITORIA_ATRASO_DIAS);
        if (!dela.length) continue;
        const maior = Math.max(...dela.map((a) => a.atraso as number));
        alertas.push(
          alerta(
            TEMA,
            "auditoria-prazo-vencido",
            "atencao",
            dela.length === 1
              ? `${u.nome} · auditoria interna com prazo vencido há ${maior} dias`
              : `${u.nome} · ${dela.length} auditorias internas com prazo vencido há mais de ${AUDITORIA_ATRASO_DIAS} dias`,
            {
              unidade: u.nome,
              peso: maior,
              destino: DESTINO_AUDITORIA,
              limiar: `projeto da Auditoria Interna em andamento com o prazo do card vencido há mais de ${AUDITORIA_ATRASO_DIAS} dias`,
              periodo: tri.rotulo,
            },
          ),
        );
      }
    }
  }

  // ── 5. Admissões no mês ──────────────────────────────────────────────────────────────────────
  {
    const b: BaseNumero = {
      id: "admissoes-mes",
      rotulo: "Admissões no mês",
      unidade: "eventos",
      cobertura: "todas",
      fonte: "Cadastro de pessoas (Gente)",
      destino: DESTINO_GENTE,
      explicacao: {
        oQueDiz: "Quantas pessoas entraram nas equipes das unidades desde o dia 1º do mês, pelo cadastro de Gente.",
        comoCalcula:
          "Pessoas do cadastro de Gente (ops.gente_pessoas) com data de admissão entre o dia 1º do mês e hoje, pela unidade da pessoa.",
        atencao:
          "Não é vaga preenchida, que ainda não tem fonte: é a admissão registrada no cadastro, que chega pelo Qulture e por planilha, às vezes semanas depois.",
        dono: DONO_GENTE,
      },
    };
    if (!d.pessoas.ok) numeros.push(numeroSem(b, d.pessoas.estado, d.pessoas.motivo));
    else {
      const pessoas = d.pessoas.linhas;
      const comCadastro = new Set(
        pessoas.map((p) => p.unidade_id).filter((x): x is number => x !== null && x !== undefined),
      );
      const cadastradas = sel.filter((u) => comCadastro.has(u.id));
      const semCadastro = sel.filter((u) => !comCadastro.has(u.id));
      const noMes = pessoas.filter((p) => {
        const a = p.data_admissao ? p.data_admissao.slice(0, 10) : null;
        return a !== null && a >= iniMes && a <= hoje;
      });
      const doFiltro = noMes.filter((p) => p.unidade_id !== null && idsSel.has(p.unidade_id));
      const semUnidade = filtro === "" ? noMes.filter((p) => p.unidade_id === null).length : 0;
      if (semUnidade)
        b.explicacao.atencao = `${b.explicacao.atencao ?? ""} ${semUnidade} ${plural(semUnidade, "admissão do mês sem unidade no cadastro ficou", "admissões do mês sem unidade no cadastro ficaram")} fora.`;
      const dataDado = dataSaoPaulo(d.pessoas.atualizadoEm);
      if (!cadastradas.length)
        numeros.push(
          numeroSem(b, "nao_apurado", "nenhuma unidade do filtro tem pessoas no cadastro de Gente", {
            nota: "sem registro, não 0",
            dataDado,
          }),
        );
      else
        numeros.push(
          numeroOk(b, doFiltro.length, {
            estado: semCadastro.length ? "parcial" : "disponivel",
            motivo: semCadastro.length
              ? `${semCadastro.length} de ${sel.length} unidades sem ninguém no cadastro de Gente: ${nomes(semCadastro)}`
              : undefined,
            nota: "admissão registrada, não vaga preenchida",
            dataDado,
            dados: tabela(
              ["Unidade", "Admissões no mês", "Pessoas no cadastro"],
              sel.map((u) =>
                comCadastro.has(u.id)
                  ? [
                      u.nome,
                      doFiltro.filter((p) => p.unidade_id === u.id).length,
                      pessoas.filter((p) => p.unidade_id === u.id).length,
                    ]
                  : [u.nome, null, "sem registro"],
              ),
            ),
          }),
        );
    }
  }

  // ── 6. Vagas abertas: sem fonte ──────────────────────────────────────────────────────────────
  numeros.push(
    numeroSem(
      {
        id: "vagas-abertas",
        rotulo: "Vagas abertas",
        unidade: "eventos",
        cobertura: "todas",
        fonte: "PandaPé (recrutamento, fora do Brain)",
        destino: null,
        explicacao: {
          oQueDiz: "Quantas vagas estão abertas e quantas foram preenchidas, por unidade.",
          comoCalcula:
            "Ainda não é calculado: o Brain não tem registro de vagas. O recrutamento é conduzido no PandaPé, sem integração com o Brain nem com o Pipefy.",
          atencao:
            "Para medir falta uma tabela de vagas no Brain (unidade, cargo, abertura, situação, data de preenchimento), alimentada por uma carga do PandaPé ou, até lá, por uma planilha mantida pela Heloísa.",
          dono: DONO_GENTE,
        },
      },
      "nao_apurado",
      "o recrutamento roda no PandaPé, sem integração com o Brain",
      { nota: "vagas preenchidas também sem fonte" },
    ),
  );

  // ── Gráfico: onde a carteira está perdendo cliente ──────────────────────────────────────────
  {
    const base = {
      id: "churn-por-unidade",
      titulo: "Onde a carteira está perdendo cliente?",
      tipo: "barras-h" as const,
      series: [{ chave: "churn", rotulo: `Churn no ${tri.rotulo} (% do MRR)` }],
      unidade: "percentual" as const,
      fonte: "Pipefy: Central de Tratativas, com o MRR dos contratos",
      destino: destinoTratativas("lost", { de: iniTri, ate: hoje, ...buscaUnidade }),
      explicacao: {
        oQueDiz: `O churn de cada unidade em operação no ${tri.rotulo}: MRR dos clientes perdidos ÷ carteira de MRR da unidade.`,
        comoCalcula:
          "Mesma conta do número Churn no trimestre, unidade a unidade. Unidade que nunca lançou card na Central fica sem barra (sem registro, não 0%); unidade com card sem contrato também fica sem barra (sem MRR).",
        atencao: "O NPS por unidade está no detalhe do número NPS: com 0 a 6 respostas por unidade no trimestre, não sustenta um gráfico.",
        dono: DONO_CS,
      },
    };
    if (falhaChurn) graficos.push(grafico(base, [], { estado: falhaChurn.estado, motivo: falhaChurn.motivo }));
    else if (!emOperacao.length) graficos.push(grafico(base, [], { estado: "nao_apurado", motivo: semOperacao }));
    else {
      const pontos = [...churnPorUnidade]
        .sort(
          (a, b) =>
            (a.churn === null ? 1 : 0) - (b.churn === null ? 1 : 0) ||
            (b.churn ?? 0) - (a.churn ?? 0) ||
            a.u.nome.localeCompare(b.u.nome, "pt-BR"),
        )
        .map((c) => ({ rotulo: c.u.nome, churn: c.churn }));
      const algum = churnPorUnidade.some((c) => c.churn !== null);
      graficos.push(
        grafico(base, pontos, {
          estado: algum ? "parcial" : "nao_apurado",
          motivo: algum
            ? motivoParcialChurn
            : comRegistro.length
              ? motivoParcialChurn
              : "nenhuma unidade do filtro lança churn na Central de Tratativas",
          dataDado: d.tratativas.ok ? dataSaoPaulo(d.tratativas.atualizadoEm) : null,
        }),
      );
    }
  }

  // ── Procedência ──────────────────────────────────────────────────────────────────────────────
  if (d.tratativas.ok) fontes.push({ fonte: "Pipefy: Central de Tratativas", atualizadoEm: d.tratativas.atualizadoEm });
  if (d.contratos.ok && d.carteira.ok) fontes.push({ fonte: "Contratos ganhos (carteira de MRR)", atualizadoEm: null });
  if (d.nps.ok) fontes.push({ fonte: "Pipefy: pesquisa NPS", atualizadoEm: d.nps.atualizadoEm });
  if (d.ligacoes.ok) fontes.push({ fonte: "Ligações do NPS", atualizadoEm: d.ligacoes.atualizadoEm });
  if (d.auditorias.ok) fontes.push({ fonte: "Pipefy: Auditoria Interna", atualizadoEm: d.auditorias.atualizadoEm });
  if (d.pessoas.ok) fontes.push({ fonte: "Cadastro de pessoas (Gente)", atualizadoEm: d.pessoas.atualizadoEm });

  return {
    tema: TEMA,
    universo: universo(unidades, filtro),
    numeros,
    alertas: ordenarAlertas(alertas),
    graficos,
    fontes,
    avisos,
  };
}
