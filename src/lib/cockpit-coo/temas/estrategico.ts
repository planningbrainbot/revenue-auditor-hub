// Sex · Estratégico: "A rede está no pacto e o que eu levo para a próxima semana?"
//
// Seis números, puros (sem I/O):
// 1. Unidades no Pacto Trimestral: IDU ≥ 75 no trimestre em andamento (RPCs idu_ranking e
//    idu_apuracao). Só conta a unidade cujo pacto está cadastrado; sem metas, o número sai
//    "não apurado" e vira decisão (spec, §5 Sexta).
// 2. Faturamento da rede em 12 meses e crescimento: a leitura "rede" do Cockpit do CEO
//    (montarLeituraRede + resumirLeitura), sem recalcular régua.
// 3. Peso da maior unidade na rede: resumirRedeUnidades, a mesma janela do número 2.
// 4. OKRs da Expansão: média das KRs medidas na última foto, de TODOS os departamentos, contra o
//    esperado linear do ciclo (fracaoEsperada), como okrs.ts.
// 5. Compromissos da semana cumpridos no prazo: taxaNoPrazo(revisaoDaSemana(...)).
// 6. Unidades em implantação: regionais sem inauguração no cadastro.
//
// A foto de OKR e os compromissos chegam prontos da carga comum (base.functions.ts); este tema só
// lê o IDU e a apuração de royalties (estrategico.server.ts).
import { MAX_NUMEROS, ORDEM_TEMAS, TEMAS, departamentoBase } from "../contrato.ts";
import type {
  AlertaCoo,
  Destino,
  Estado,
  Explicacao,
  GraficoCoo,
  LeituraTema,
  NumeroCoo,
  Procedencia,
  UnidadeContagem,
} from "../contrato.ts";
import { alerta, destino, grafico, numeroOk, numeroSem, tabela, trimestre } from "../montar.ts";
import type { BaseNumero } from "../montar.ts";
import { acharUnidade, chaveUnidade, unidadesDoFiltro, universo } from "../unidades.ts";
import type { FiltroUnidade, UnidadeCoo } from "../unidades.ts";
import { DIAS_FOTO_PARADA } from "../okrs.ts";
import type { LinhaSnapshot } from "../okrs.ts";
import { revisaoDaSemana, taxaNoPrazo } from "../compromissos.ts";
import type { Compromisso } from "../compromissos.ts";
import {
  CICLO,
  corProgresso,
  fracaoEsperada,
} from "../../../../supabase/functions/_shared/clickup/dashboard.ts";
import { montarLeituraRede } from "../../cockpit-ceo/receita-fontes.ts";
import type { ApuracaoRede, UnidadeRede } from "../../cockpit-ceo/receita-fontes.ts";
import { resumirLeitura } from "../../cockpit-ceo/receita.ts";
import type { LeituraReceita, ResumoLeitura } from "../../cockpit-ceo/receita.ts";
import { resumirRedeUnidades } from "../../cockpit-ceo/rede.ts";
import type { RedeUnidades } from "../../cockpit-ceo/rede.ts";

// ---------------------------------------------------------------------------------------------
// Dados crus (o que estrategico.server.ts lê)
// ---------------------------------------------------------------------------------------------

export type ParteEstrategico<T> =
  | { ok: true; dado: T }
  | { ok: false; estado: Exclude<Estado, "disponivel" | "parcial">; motivo: string };

/** Trimestre civil do IDU. `fim` é EXCLUSIVO (1º dia do trimestre seguinte): é o que a RPC espera. */
export interface TrimestreIdu {
  /** "2026-T3", a chave do `?trimestre=` de /idu. */
  chave: string;
  /** "T3/2026". */
  rotulo: string;
  inicio: string;
  fim: string;
}

/** Linha de `idu_ranking(p_inicio, p_fim)`. Numéricos podem chegar em texto. */
export interface LinhaRankingIdu {
  unidade_id: number;
  unidade: string;
  curva: string | null;
  idu: number | string | null;
  faixa: string | null;
  base_efetiva: number | string | null;
  pilar_fraco: string | null;
}

/** Linha de `idu_apuracao(p_inicio, p_fim)`: uma por unidade e indicador. */
export interface LinhaApuracaoIdu {
  unidade_id: number;
  indicador: string;
  peso: number | string | null;
  meta: number | string | null;
  /** 'unidade' | 'tier' | 'rede' | 'fixa' (churn 5%); null = sem meta. */
  meta_origem: string | null;
}

export interface DadosIdu {
  trimestre: TrimestreIdu;
  ranking: LinhaRankingIdu[];
  apuracao: LinhaApuracaoIdu[];
  /** Metas gravadas (da unidade + padrão) no trimestre apurado; null quando a leitura falhou. */
  metasNoTrimestre: number | null;
  /** O trimestre seguinte e quantas metas já tem (as metas se pactuam antes de o trimestre abrir). */
  proximo: { trimestre: TrimestreIdu; metas: number | null };
}

export interface DadosEstrategico {
  idu: ParteEstrategico<DadosIdu>;
  /** Cadastro com a inauguração (a leitura do CEO precisa dela) e as apurações de royalties. */
  rede: ParteEstrategico<{ unidades: UnidadeRede[]; apuracoes: ApuracaoRede[] }>;
}

/** O que a carga comum entrega pronto. Os motivos são opcionais: sem eles, lista vazia é lista vazia. */
export interface ExtraEstrategico {
  okrs: LinhaSnapshot[];
  compromissos: Compromisso[];
  clickupConectado: boolean;
  okrsMotivo?: string;
  compromissosMotivo?: string;
}

// ---------------------------------------------------------------------------------------------
// Réguas
// ---------------------------------------------------------------------------------------------

/** Linha de corte do Pacto Trimestral: 75 libera 100% do forecast (Método IDU, 28/08). */
export const CORTE_PACTO = 75;
/**
 * O pacto de uma unidade só está cadastrado quando ao menos metade da régua (50 dos 100 pontos)
 * tem meta: da unidade, do tier, da rede ou a fixa de 5% de churn. Abaixo disso a nota mede um
 * pedaço pequeno da régua (em 29/09/2026, só o churn, e 100 para todas) e não diz se a unidade
 * está no pacto.
 */
export const PESO_MINIMO_PACTO = 50;
/** Compromisso vencido há duas semanas ou mais: passou por duas sextas sem ser resolvido. */
export const DIAS_VENCIDO_ALERTA = 14;
/** A partir de quantos dias antes de o trimestre abrir as metas dele passam a ser cobradas. */
export const DIAS_ANTES_DO_PROXIMO = 30;

// O contrato ainda não tem "unidades" nem "compromissos" como unidade de contagem; "contas" e
// "eventos" formatam igual (inteiro) e a tela não escreve a palavra ao lado do valor.
const UN_UNIDADES: UnidadeContagem = "contas";
const UN_COMPROMISSOS: UnidadeContagem = "eventos";

const CHAVES_URL = "Administração › Chaves de Integração";
const MOTIVO_SEM_CLICKUP = `o ClickUp ainda não está conectado (token em ${CHAVES_URL})`;
const MOTIVO_SO_REDE = "só existe na rede regional";

// ---------------------------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------------------------

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-09-02" → "02/09/2026". */
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
/** "2026-08" → "ago/2026". */
const mesCurto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
/** Janela de meses em uma linha: "jun–ago/2026" ou "dez/2025–ago/2026". */
function janelaCurta(de: string, ate: string): string {
  if (de === ate) return mesCurto(de);
  if (de.slice(0, 4) === ate.slice(0, 4))
    return `${MESES[Number(de.slice(5, 7)) - 1]}–${mesCurto(ate)}`;
  return `${mesCurto(de)}–${mesCurto(ate)}`;
}
const somarMeses = (m: string, n: number) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1))
    .toISOString()
    .slice(0, 7);
function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let m = de; m <= ate; m = somarMeses(m, 1)) out.push(m);
  return out;
}
/** Último dia do mês "AAAA-MM". */
const fimDoMes = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const diasEntre = (de: string, ate: string) =>
  Math.round(
    (Date.parse(`${ate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${de.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );

/** O trimestre civil de uma data, com o fim exclusivo que `idu_apuracao` espera. */
export function trimestreIdu(iso: string): TrimestreIdu {
  const { ano, t, rotulo } = trimestre(iso);
  const mesIni = (t - 1) * 3;
  return {
    chave: `${ano}-T${t}`,
    rotulo,
    inicio: new Date(Date.UTC(ano, mesIni, 1)).toISOString().slice(0, 10),
    fim: new Date(Date.UTC(ano, mesIni + 3, 1)).toISOString().slice(0, 10),
  };
}

export const trimestreSeguinte = (t: TrimestreIdu): TrimestreIdu => trimestreIdu(t.fim);

// ---------------------------------------------------------------------------------------------
// Pequenos auxiliares
// ---------------------------------------------------------------------------------------------

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const um = (v: number) => Math.round(v * 10) / 10;
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
const listaNomes = (nomes: string[]) =>
  nomes.length <= 1
    ? (nomes[0] ?? "")
    : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;

const TEMA = "estrategico" as const;

// ---------------------------------------------------------------------------------------------
// Destinos (telas donas no Ops)
// ---------------------------------------------------------------------------------------------

function destinoIdu(tri: TrimestreIdu, unidadeId?: number): Destino {
  return destino(
    "/idu",
    "Abrir o IDU",
    true,
    "O IDU abre no mesmo trimestre, com a nota, a faixa e o pilar mais fraco de cada unidade; as metas do trimestre se pactuam lá.",
    unidadeId ? { trimestre: tri.chave, unidade: String(unidadeId) } : { trimestre: tri.chave },
  );
}

const destinoRoyalties = (mes: string | null): Destino =>
  destino(
    "/unidades/royalties",
    "Abrir Apuração de Royalties",
    false,
    "A apuração abre um mês por vez; o cockpit soma os meses fechados e completos da janela.",
    mes ? { mes } : {},
  );

const destinoOverview = (unidade: string | null): Destino =>
  destino(
    "/rede-overview",
    "Abrir o Overview da Rede",
    false,
    "O Overview mede o faturamento pelo Funil (competência), não pela apuração de royalties: os totais podem diferir.",
    unidade ? { unidade } : {},
  );

const DESTINO_COMPROMISSOS: Destino = destino(
  "/cockpit-coo/compromissos",
  "Abrir Compromissos",
  false,
  "A fila mostra todos os compromissos da Rotina Semanal; aqui entram só os com prazo nesta semana.",
);

const DESTINO_UNIDADES: Destino = destino(
  "/unidades",
  "Abrir Regras da Rede",
  true,
  "O cadastro mostra a data de inauguração de cada unidade; sem ela, a unidade fica em implantação.",
);

const DESTINO_CHAVES: Destino = destino(
  "/admin/credenciais",
  "Abrir Chaves de Integração",
  false,
  "O token do ClickUp liga o espelho dos compromissos e a foto diária de OKR, sem deploy.",
);

// ---------------------------------------------------------------------------------------------
// 1. Pacto Trimestral (IDU)
// ---------------------------------------------------------------------------------------------

interface PactoUnidade {
  unidade: UnidadeCoo;
  /** Pontos da régua (de 100) com meta, de qualquer origem. */
  pesoComMeta: number;
  cadastrado: boolean;
  idu: number | null;
  faixa: string | null;
  curva: string | null;
  pilarFraco: string | null;
}

function pactoPorUnidade(d: DadosIdu, unidades: UnidadeCoo[]): PactoUnidade[] {
  return unidades.map((u) => {
    const linhas = d.apuracao.filter((a) => Number(a.unidade_id) === u.id);
    const pesoComMeta = linhas
      .filter((a) => num(a.meta) !== null)
      .reduce((s, a) => s + (num(a.peso) ?? 0), 0);
    const r = d.ranking.find((x) => Number(x.unidade_id) === u.id);
    return {
      unidade: u,
      pesoComMeta,
      cadastrado: linhas.length > 0 && pesoComMeta >= PESO_MINIMO_PACTO,
      idu: r ? num(r.idu) : null,
      faixa: r?.faixa ?? null,
      curva: r?.curva ?? null,
      pilarFraco: r?.pilar_fraco ?? null,
    };
  });
}

const EXPLICACAO_PACTO: Explicacao = {
  oQueDiz:
    "Quantas unidades da rede em operação estão com o IDU do trimestre em 75 ou mais, a linha de corte do Pacto Trimestral que libera 100% do forecast.",
  comoCalcula: `Nota do IDU por unidade no trimestre em andamento, do primeiro dia até hoje (RPC idu_ranking). Só conta a unidade com o pacto cadastrado: ao menos ${PESO_MINIMO_PACTO} dos 100 pontos da régua com meta, seja da unidade, do tier, da rede ou a fixa de 5% de churn (RPC idu_apuracao). Pelo Método IDU (28/08), indicador sem meta ou sem dado sai do denominador.`,
  atencao:
    "Trimestre em andamento: o realizado até hoje é comparado com a meta do trimestre inteiro. O churn só conta o que foi lançado na Central de Tratativas, e unidade sem card tem churn zero e pontuação cheia.",
  dono: "Rede (Eliezek); as metas são pactuadas pela diretoria no IDU",
};

function numeroPacto(
  dados: DadosEstrategico,
  redeSel: UnidadeCoo[],
  redeOp: UnidadeCoo[],
  unica: UnidadeCoo | null,
  hoje: string,
): { numero: NumeroCoo; pacto: PactoUnidade[] | null } {
  const tri = dados.idu.ok ? dados.idu.dado.trimestre : null;
  const base: BaseNumero = {
    id: "unidades-no-pacto",
    rotulo: "Unidades no Pacto Trimestral",
    unidade: UN_UNIDADES,
    cobertura: "rede",
    fonte: "IDU · Pacto Trimestral",
    explicacao: EXPLICACAO_PACTO,
    destino: tri ? destinoIdu(tri, unica?.grupo === "rede" ? unica.id : undefined) : null,
  };
  if (!redeSel.length)
    return { numero: numeroSem(base, "nao_apurado", MOTIVO_SO_REDE), pacto: null };
  if (!redeOp.length)
    return {
      numero: numeroSem(
        base,
        "nao_apurado",
        `${listaNomes(redeSel.map((u) => u.nome))} ${redeSel.length === 1 ? "está" : "estão"} em implantação: o IDU começa na inauguração`,
      ),
      pacto: null,
    };
  if (!dados.idu.ok)
    return { numero: numeroSem(base, dados.idu.estado, dados.idu.motivo), pacto: null };

  const d = dados.idu.dado;
  const pacto = pactoPorUnidade(d, redeOp);
  const cadastrados = pacto.filter((p) => p.cadastrado);
  const dados_ = tabela(
    ["Unidade", "Curva", "IDU", "Faixa", "Pontos com meta", "Pilar mais fraco", "Pacto cadastrado"],
    pacto.map((p) => [
      p.unidade.nome,
      p.curva,
      p.idu,
      p.faixa,
      p.pesoComMeta,
      p.pilarFraco,
      p.cadastrado ? "sim" : "não",
    ]),
  );
  if (!cadastrados.length) {
    const metas =
      d.metasNoTrimestre === null
        ? ""
        : `${plural(d.metasNoTrimestre, "meta gravada", "metas gravadas")} para `;
    return {
      numero: {
        ...numeroSem(
          base,
          "nao_apurado",
          `o Pacto do ${d.trimestre.rotulo} não tem metas cadastradas: ${metas}${plural(redeOp.length, "unidade", "unidades")} em operação, e nenhuma com meta em ao menos ${PESO_MINIMO_PACTO} dos 100 pontos da régua`,
          { nota: "metas do trimestre por pactuar", dataDado: null },
        ),
        dados: dados_,
      },
      pacto,
    };
  }
  const noPacto = cadastrados.filter((p) => p.idu !== null && p.idu >= CORTE_PACTO);
  const parcial = cadastrados.length < redeOp.length;
  const nota = unica
    ? pacto[0].idu === null
      ? "sem base efetiva no trimestre"
      : `IDU ${String(um(pacto[0].idu)).replace(".", ",")} · ${pacto[0].faixa ?? "sem faixa"}`
    : parcial
      ? `${cadastrados.length} de ${redeOp.length} unidades com metas cadastradas`
      : `de ${plural(redeOp.length, "unidade", "unidades")} em operação`;
  return {
    numero: numeroOk(base, noPacto.length, {
      estado: parcial ? "parcial" : "disponivel",
      motivo: parcial
        ? `${plural(redeOp.length - cadastrados.length, "unidade está", "unidades estão")} sem metas cadastradas no ${d.trimestre.rotulo} e fica${redeOp.length - cadastrados.length === 1 ? "" : "m"} fora da contagem`
        : undefined,
      nota,
      tom: noPacto.length === cadastrados.length ? "sucesso" : "atencao",
      dataDado: hoje,
      dados: dados_,
    }),
    pacto,
  };
}

// ---------------------------------------------------------------------------------------------
// 2 e 3. Faturamento da rede e concentração (a leitura "rede" do Cockpit do CEO)
// ---------------------------------------------------------------------------------------------

interface LeituraFaturamento {
  leitura: LeituraReceita;
  resumo: ResumoLeitura;
  rede: RedeUnidades;
}

function lerFaturamento(
  cru: { unidades: UnidadeRede[]; apuracoes: ApuracaoRede[] },
  ids: Set<number>,
  hoje: string,
): LeituraFaturamento {
  const leitura = montarLeituraRede({
    acesso: true,
    unidades: cru.unidades.filter((u) => ids.has(u.id)),
    apuracoes: cru.apuracoes.filter((a) => ids.has(a.unidade_id)),
  });
  const resumo = resumirLeitura(leitura, hoje);
  return { leitura, resumo, rede: resumirRedeUnidades(leitura, resumo) };
}

/** Centavos por mês da leitura (a mesma soma de resumirLeitura). */
function centavosPorMes(l: LeituraReceita): Map<string, number> {
  const c = new Map<string, number>();
  for (const x of l.linhas) c.set(x.mes, (c.get(x.mes) ?? 0) + Math.round(x.valor * 100));
  return c;
}

/**
 * Crescimento da janela sobre os mesmos meses um ano antes. Só existe quando todos esses meses
 * também estão completos na fonte: mês parcial ou sem apuração não entra em comparação.
 */
function crescimentoAnual(
  l: LeituraReceita,
  janela: { de: string; ate: string },
): { valor: number; de: string; ate: string } | null {
  const c = centavosPorMes(l);
  const parciais = new Set(l.parciaisFonte ?? []);
  const meses = mesesEntre(janela.de, janela.ate);
  const antes = meses.map((m) => somarMeses(m, -12));
  if (antes.some((m) => !c.has(m) || parciais.has(m))) return null;
  const agora = meses.reduce((s, m) => s + (c.get(m) ?? 0), 0);
  const antCent = antes.reduce((s, m) => s + (c.get(m) ?? 0), 0);
  if (antCent <= 0) return null;
  return { valor: (agora / antCent - 1) * 100, de: antes[0], ate: antes[antes.length - 1] };
}

/** Por que a janela tem menos de 12 meses: o mês que a interrompe, com o que a fonte diz dele. */
function motivoJanelaCurta(
  l: LeituraReceita,
  resumo: ResumoLeitura,
  j: { de: string; ate: string; meses: number },
): string {
  const antes = somarMeses(j.de, -1);
  const inicio = `${j.meses} de 12 meses fechados completos`;
  if ((l.parciaisFonte ?? []).includes(antes)) {
    const nota = (l.notasPorMes?.[antes] ?? "tem unidade sem apuração confirmada").replace(
      /\.$/,
      "",
    );
    return `${inicio}; em ${mesCurto(antes)}, ${nota.charAt(0).toLowerCase()}${nota.slice(1)}`;
  }
  if (!resumo.historicoDesde || antes < resumo.historicoDesde)
    return `${inicio}: a apuração confirmada começa em ${resumo.historicoDesde ? mesCurto(resumo.historicoDesde) : mesCurto(j.de)}`;
  return `${inicio}: ${mesCurto(antes)} está sem apuração confirmada`;
}

const EXPLICACAO_FATURAMENTO: Explicacao = {
  oQueDiz:
    "Quanto as unidades da rede em operação faturaram com os clientes delas nos últimos 12 meses fechados, e quanto isso cresceu sobre os mesmos meses do ano anterior.",
  comoCalcula:
    "Apuração de royalties confirmada (ops.royalties_apuracao): receita da base nova + base antiga, a régua que a unidade assina (DECISIONS 26/08). Conta só meses fechados, completos e seguidos, até 12, pela mesma regra do Cockpit do CEO: mês em que uma unidade já inaugurada não tem apuração confirmada é parcial e interrompe a janela. Crescimento = soma da janela ÷ soma dos mesmos meses um ano antes − 1, só com esses meses também completos.",
  dono: "Receita e Repasses (Eliezek); apuração pela controladoria",
};

function numeroFaturamento(
  dados: DadosEstrategico,
  f: LeituraFaturamento | null,
  redeSel: UnidadeCoo[],
  redeOp: UnidadeCoo[],
  hoje: string,
): NumeroCoo {
  const base: BaseNumero = {
    id: "faturamento-rede-12m",
    rotulo: "Faturamento da rede · 12 meses",
    unidade: "reais",
    cobertura: "rede",
    fonte: "Apuração de royalties confirmada",
    explicacao: EXPLICACAO_FATURAMENTO,
    destino: destinoRoyalties(null),
  };
  if (!redeSel.length) return numeroSem(base, "nao_apurado", MOTIVO_SO_REDE);
  if (!redeOp.length)
    return numeroSem(
      base,
      "nao_apurado",
      "unidade em implantação fica fora dos números de desempenho até a inauguração",
    );
  if (!dados.rede.ok) return numeroSem(base, dados.rede.estado, dados.rede.motivo);
  if (!f) return numeroSem(base, "nao_apurado", "sem leitura da apuração");
  const { resumo, leitura } = f;
  const j = resumo.fechados;
  if (!j || (resumo.estado !== "disponivel" && resumo.estado !== "parcial"))
    return numeroSem(
      base,
      "nao_apurado",
      resumo.estado === "nao_apurado"
        ? "nenhuma apuração de royalties confirmada no recorte"
        : "nenhum mês fechado com todas as unidades apuradas",
    );

  const doze = resumo.doze !== null;
  const cresc = crescimentoAnual(leitura, j);
  const c = centavosPorMes(leitura);
  const parciais = new Set(leitura.parciaisFonte ?? []);
  const ultimos12 = mesesEntre(somarMeses(j.ate, -11), j.ate);
  const atencao = [
    cresc
      ? null
      : `Sem crescimento: a comparação pede os mesmos meses de um ano antes completos, e a apuração confirmada começa em ${resumo.historicoDesde ? mesCurto(resumo.historicoDesde) : "—"}.`,
    "Unidade em implantação (sem inauguração no cadastro) fica fora, mesmo com apuração.",
  ]
    .filter(Boolean)
    .join(" ");
  return numeroOk(
    {
      ...base,
      rotulo: doze ? base.rotulo : `Faturamento da rede · ${plural(j.meses, "mês", "meses")}`,
      explicacao: { ...EXPLICACAO_FATURAMENTO, atencao },
      destino: destinoRoyalties(j.ate),
    },
    doze ? (resumo.doze as number) : j.soma,
    {
      estado: doze ? resumo.estado : "parcial",
      motivo: doze ? undefined : motivoJanelaCurta(leitura, resumo, j),
      nota: doze ? janelaCurta(j.de, j.ate) : `só ${janelaCurta(j.de, j.ate)} completos`,
      delta: cresc
        ? {
            valor: um(cresc.valor),
            rotulo: `sobre ${janelaCurta(cresc.de, cresc.ate)}`,
            sentido: "maior-melhor",
          }
        : undefined,
      tendencia: {
        valores: ultimos12.map((m) =>
          c.has(m) && !parciais.has(m) ? (c.get(m) as number) / 100 : null,
        ),
        rotulo: `faturamento mensal, ${janelaCurta(ultimos12[0], j.ate)} (mês incompleto fica em branco)`,
      },
      dataDado: fimDoMes(j.ate),
      dados: tabela(
        ["Mês", "Faturamento", "Situação"],
        mesesEntre(resumo.historicoDesde ?? j.de, somarMeses(hoje.slice(0, 7), -1)).map((m) => [
          mesCurto(m),
          c.has(m) ? (c.get(m) as number) / 100 : null,
          !c.has(m)
            ? "sem apuração confirmada"
            : parciais.has(m)
              ? "incompleto"
              : m >= j.de && m <= j.ate
                ? "na conta"
                : "completo, fora da janela",
        ]),
      ),
    },
  );
}

const EXPLICACAO_CONCENTRACAO: Explicacao = {
  oQueDiz: "Quanto do faturamento da rede depende de uma unidade só.",
  comoCalcula:
    "Participação da maior unidade na soma do faturamento da rede em operação, na mesma janela de meses fechados e completos do faturamento (resumirRedeUnidades, a régua do Cockpit do CEO). Com uma unidade no filtro, mostra o peso dela na rede inteira.",
  dono: "Rede (Eliezek)",
};

function numeroConcentracao(
  dados: DadosEstrategico,
  full: LeituraFaturamento | null,
  redeSel: UnidadeCoo[],
  redeOp: UnidadeCoo[],
  unica: UnidadeCoo | null,
): NumeroCoo {
  const base: BaseNumero = {
    id: "concentracao-rede",
    rotulo:
      unica && unica.grupo === "rede"
        ? `Peso de ${unica.nome} na rede`
        : "Peso da maior unidade na rede",
    unidade: "percentual",
    cobertura: "rede",
    fonte: "Apuração de royalties confirmada",
    explicacao: EXPLICACAO_CONCENTRACAO,
    destino: destinoOverview(unica && unica.grupo === "rede" ? unica.nome : null),
  };
  if (!redeSel.length) return numeroSem(base, "nao_apurado", MOTIVO_SO_REDE);
  if (!redeOp.length)
    return numeroSem(
      base,
      "nao_apurado",
      "unidade em implantação fica fora dos números de desempenho até a inauguração",
    );
  if (!dados.rede.ok) return numeroSem(base, dados.rede.estado, dados.rede.motivo);
  const r = full?.rede;
  if (!r || !r.janela || !r.linhas.length || r.top1 === null)
    return numeroSem(base, "nao_apurado", "nenhum mês fechado com todas as unidades apuradas");
  const janela = janelaCurta(r.janela.de, r.janela.ate);
  const pct = (x: number) => `${String(um(x * 100)).replace(".", ",")}%`;
  const extra = {
    estado: r.estado === "disponivel" ? ("disponivel" as const) : ("parcial" as const),
    motivo:
      r.estado === "disponivel"
        ? undefined
        : `janela de ${plural(r.janela.meses, "mês", "meses")} completos (${janela}), não 12`,
    dataDado: fimDoMes(r.janela.ate),
    dados: tabela(
      ["Unidade", "Faturamento na janela", "Participação"],
      r.linhas.map((l) => [l.unidade, l.faturamento, um(l.participacao * 100)]),
    ),
  };
  const explicacao: Explicacao = {
    ...EXPLICACAO_CONCENTRACAO,
    atencao: `Três maiores: ${pct(r.top3 ?? 0)} · HHI ${(r.hhi ?? 0).toFixed(2).replace(".", ",")} (acima de 0,25 é concentrado).`,
  };
  if (unica) {
    const linha = r.linhas.find((l) => chaveUnidade(l.unidade) === unica.chave);
    if (!linha)
      return numeroSem(
        { ...base, explicacao },
        "nao_apurado",
        `${unica.nome} não tem apuração confirmada em ${janela}`,
      );
    return numeroOk({ ...base, explicacao }, um(linha.participacao * 100), {
      ...extra,
      nota: janela,
    });
  }
  return numeroOk({ ...base, explicacao }, um(r.top1 * 100), {
    ...extra,
    nota: `${r.linhas[0].unidade}, ${janela}`,
  });
}

// ---------------------------------------------------------------------------------------------
// 4. OKRs da Expansão (todos os departamentos)
// ---------------------------------------------------------------------------------------------

interface DeptoOkr {
  nome: string;
  base: string;
  total: number;
  medidas: number;
  progresso: number | null;
}

interface FotoOkr {
  ultimoDia: string;
  diasSemFoto: number;
  parada: boolean;
  total: number;
  medidas: number;
  progresso: number | null;
  esperado: number;
  departamentos: DeptoOkr[];
}

const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function lerFoto(linhas: LinhaSnapshot[], hoje: string): FotoOkr | null {
  if (!linhas.length) return null;
  const ultimoDia = linhas.reduce((m, l) => (l.dia > m ? l.dia : m), linhas[0].dia);
  const doUltimo = linhas.filter((l) => l.dia === ultimoDia);
  const porDepto = new Map<string, LinhaSnapshot[]>();
  for (const l of doUltimo)
    porDepto.set(l.departamento, [...(porDepto.get(l.departamento) ?? []), l]);
  const departamentos = [...porDepto.entries()]
    .map(([nome, ls]) => {
      const ps = ls.map((l) => num(l.progresso)).filter((p): p is number => p !== null);
      return {
        nome,
        base: departamentoBase(nome),
        total: ls.length,
        medidas: ps.length,
        progresso: media(ps),
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const todas = doUltimo.map((l) => num(l.progresso)).filter((p): p is number => p !== null);
  const diasSemFoto = diasEntre(ultimoDia, hoje);
  return {
    ultimoDia,
    diasSemFoto,
    parada: diasSemFoto > DIAS_FOTO_PARADA,
    total: doUltimo.length,
    medidas: todas.length,
    progresso: media(todas),
    esperado: fracaoEsperada(ultimoDia),
    departamentos,
  };
}

const TOM_FAIXA = { green: "sucesso", cyan: undefined, yellow: "atencao", red: "perigo" } as const;

const EXPLICACAO_OKRS: Explicacao = {
  oQueDiz:
    "Em que ponto estão os OKRs de todos os departamentos da Expansão, contra o que o calendário do ciclo pede no mesmo dia.",
  comoCalcula: `Média simples do progresso das KRs medidas na última foto diária (growth.okr_snapshot), de todos os departamentos; KR sem medição fica fora. O esperado é a fração do ciclo decorrida (${dataBr(CICLO.inicio)} a ${dataBr(CICLO.fim)}), linear, no dia da foto: a régua da tela de OKRs do Growth.`,
  atencao:
    "Os OKRs são dos departamentos da matriz: o filtro de unidade não se aplica. A média de hoje depende de quais KRs foram medidas.",
  dono: "Donos das pastas de OKR no ClickUp; a foto diária é da integração do ClickUp",
};

function numeroOkrs(extra: ExtraEstrategico, foto: FotoOkr | null): NumeroCoo {
  const base: BaseNumero = {
    id: "okrs-expansao",
    rotulo: "OKRs da Expansão · ritmo",
    unidade: "percentual",
    cobertura: "grupo",
    fonte: "Foto diária de OKRs (ClickUp)",
    explicacao: EXPLICACAO_OKRS,
    destino: null,
  };
  if (!foto)
    return numeroSem(
      base,
      "fonte_indisponivel",
      extra.okrsMotivo ?? "a foto diária de OKRs não trouxe nenhuma linha",
    );
  if (foto.progresso === null)
    return numeroSem(
      base,
      "nao_apurado",
      `nenhuma KR medida na foto de ${dataBr(foto.ultimoDia)}`,
      {
        dataDado: foto.ultimoDia,
        nota: `${plural(foto.total, "KR", "KRs")} sem medição`,
      },
    );
  const razao = foto.esperado > 0 ? foto.progresso / foto.esperado : null;
  return numeroOk(base, um(foto.progresso * 100), {
    estado: foto.parada ? "parcial" : "disponivel",
    motivo: foto.parada ? `a foto diária de OKRs parou em ${dataBr(foto.ultimoDia)}` : undefined,
    meta: {
      valor: um(foto.esperado * 100),
      rotulo: `esperado em ${dataBr(foto.ultimoDia).slice(0, 5)}`,
    },
    nota: `${foto.medidas} de ${plural(foto.total, "KR medida", "KRs medidas")}`,
    tom: razao === null ? undefined : TOM_FAIXA[corProgresso(razao)],
    dataDado: foto.ultimoDia,
    dados: tabela(
      ["Departamento", "KRs", "Medidas", "Progresso médio (%)", "Esperado (%)"],
      foto.departamentos.map((d) => [
        d.nome,
        d.total,
        d.medidas,
        d.progresso === null ? null : um(d.progresso * 100),
        um(foto.esperado * 100),
      ]),
    ),
  });
}

// ---------------------------------------------------------------------------------------------
// 5. Compromissos da semana
// ---------------------------------------------------------------------------------------------

/** Compromissos do recorte: pela unidade do compromisso; "Rede" entra em todas e na rede regional. */
export function compromissosDoFiltro(
  cs: Compromisso[],
  unidades: UnidadeCoo[],
  filtro: FiltroUnidade,
): Compromisso[] {
  if (!filtro) return cs;
  const ids = new Set(unidadesDoFiltro(unidades, filtro).map((u) => u.id));
  return cs.filter((c) => {
    if (filtro === "rede" && chaveUnidade(c.unidade) === "rede") return true;
    const u = acharUnidade(unidades, c.unidade);
    return u !== null && ids.has(u.id);
  });
}

const EXPLICACAO_COMPROMISSOS: Explicacao = {
  oQueDiz:
    "De tudo o que tinha prazo nesta semana e já venceu ou foi entregue, quanto foi entregue no prazo.",
  comoCalcula:
    "Compromissos da pasta Rotina Semanal (espelho do ClickUp) com prazo de segunda a domingo desta semana. No prazo = concluído até o dia do prazo; com atraso = concluído depois; vencido = aberto com o prazo passado. Taxa = no prazo ÷ (no prazo + com atraso + vencidos); o que ainda está no prazo fica fora.",
  atencao:
    "Com filtro de unidade, conta só o compromisso com aquela unidade no campo Unidade; o compromisso sem unidade entra só em todas as unidades.",
  dono: "COO (Paulo Carvalho), dono da Rotina Semanal",
};

function numeroCompromissos(extra: ExtraEstrategico, cs: Compromisso[], hoje: string): NumeroCoo {
  const base: BaseNumero = {
    id: "compromissos-no-prazo",
    rotulo: "Compromissos da semana no prazo",
    unidade: "percentual",
    cobertura: "todas",
    fonte: "Rotina Semanal (ClickUp)",
    explicacao: EXPLICACAO_COMPROMISSOS,
    destino: DESTINO_COMPROMISSOS,
  };
  if (!extra.clickupConectado) return numeroSem(base, "nao_apurado", MOTIVO_SEM_CLICKUP);
  if (extra.compromissosMotivo)
    return numeroSem(base, "fonte_indisponivel", extra.compromissosMotivo);
  const rev = revisaoDaSemana(cs, hoje);
  const taxa = taxaNoPrazo(rev);
  const noPrazo = rev.reduce((s, r) => s + r.noPrazo, 0);
  const devidos = rev.reduce((s, r) => s + r.noPrazo + r.comAtraso + r.vencidos, 0);
  const abertos = rev.reduce((s, r) => s + r.abertos, 0);
  const dados_ = tabela(
    ["Tema", "No prazo", "Com atraso", "Vencidos", "Abertos no prazo"],
    rev.map((r) => [TEMAS[r.tema].menu, r.noPrazo, r.comAtraso, r.vencidos, r.abertos]),
  );
  if (taxa === null)
    return {
      ...numeroSem(
        base,
        "nao_apurado",
        abertos
          ? `nenhum compromisso da semana venceu ou foi concluído ainda (${abertos} no prazo)`
          : "nenhum compromisso com prazo nesta semana",
        { dataDado: hoje },
      ),
      dados: dados_,
    };
  return numeroOk(base, um(taxa), {
    nota: `${noPrazo} de ${devidos} no prazo`,
    tom: noPrazo === devidos ? "sucesso" : undefined,
    dataDado: hoje,
    dados: dados_,
  });
}

// ---------------------------------------------------------------------------------------------
// 6. Unidades em implantação
// ---------------------------------------------------------------------------------------------

const EXPLICACAO_IMPLANTACAO: Explicacao = {
  oQueDiz: "Quantas unidades da rede ainda não inauguraram e estão na esteira de Novos Sócios.",
  comoCalcula:
    "Unidades regionais do cadastro (ops.unidades) sem data de inauguração. Elas entram na sexta e nos compromissos, e ficam fora dos números de desempenho (IDU, faturamento, concentração) até a inauguração.",
  atencao:
    "A data de inauguração é do cadastro: unidade que já fatura e continua sem data fica aqui até alguém preencher.",
  dono: "Novos Sócios (Paulo Carvalho)",
};

function numeroImplantacao(
  dados: DadosEstrategico,
  extra: ExtraEstrategico,
  redeSel: UnidadeCoo[],
  unidades: UnidadeCoo[],
  hoje: string,
): NumeroCoo {
  const base: BaseNumero = {
    id: "unidades-implantacao",
    rotulo: "Unidades em implantação",
    unidade: UN_UNIDADES,
    cobertura: "rede",
    fonte: "Cadastro de unidades",
    explicacao: EXPLICACAO_IMPLANTACAO,
    destino: DESTINO_UNIDADES,
  };
  if (!redeSel.length) return numeroSem(base, "nao_apurado", MOTIVO_SO_REDE);
  const impl = redeSel.filter((u) => !u.emOperacao);
  const apuracaoDe = (id: number) => {
    if (!dados.rede.ok) return null;
    const conf = dados.rede.dado.apuracoes
      .filter((a) => a.unidade_id === id && a.status === "confirmado")
      .map((a) => a.mes.slice(0, 7))
      .sort();
    return conf.length ? mesCurto(conf[conf.length - 1]) : "nenhuma";
  };
  const cs = extra.clickupConectado ? extra.compromissos : null;
  const doUnidade = (u: UnidadeCoo) =>
    (cs ?? []).filter((c) => acharUnidade(unidades, c.unidade)?.id === u.id);
  return numeroOk(base, impl.length, {
    nota: impl.length ? listaNomes(impl.map((u) => u.nome)) : "nenhuma no recorte",
    dataDado: hoje,
    dados: tabela(
      ["Unidade", "Última apuração confirmada", "Compromissos abertos", "Vencidos"],
      impl.map((u) => [
        u.nome,
        apuracaoDe(u.id),
        cs ? doUnidade(u).filter((c) => !c.concluida).length : null,
        cs ? doUnidade(u).filter((c) => c.vencido).length : null,
      ]),
    ),
  });
}

// ---------------------------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------------------------

function alertasPacto(
  dados: DadosEstrategico,
  pacto: PactoUnidade[] | null,
  unica: UnidadeCoo | null,
  hoje: string,
): AlertaCoo[] {
  if (!dados.idu.ok || !pacto) return [];
  const d = dados.idu.dado;
  const out: AlertaCoo[] = [];
  const sem = pacto.filter((p) => !p.cadastrado);
  if (sem.length) {
    const umaSo = unica && sem.length === 1 ? sem[0].unidade : null;
    out.push(
      alerta(
        TEMA,
        "pacto-sem-metas",
        "critico",
        umaSo
          ? `${umaSo.nome} · sem metas no Pacto ${d.trimestre.rotulo}`
          : sem.length === pacto.length
            ? `Rede · Pacto ${d.trimestre.rotulo} sem metas cadastradas`
            : `Rede · ${sem.length} unidades sem metas no Pacto ${d.trimestre.rotulo}`,
        {
          unidade: umaSo?.nome ?? null,
          peso: 100 * sem.length,
          destino: destinoIdu(d.trimestre, umaSo?.id),
          limiar: `unidade em operação com meta em menos de ${PESO_MINIMO_PACTO} dos 100 pontos da régua do IDU (meta da unidade, do tier, da rede ou a fixa de churn); decisão: pactuar as metas do trimestre`,
          periodo: d.trimestre.chave,
        },
      ),
    );
  }
  const prox = d.proximo;
  const faltam = diasEntre(hoje, prox.trimestre.inicio);
  if (prox.metas === 0 && faltam >= 0 && faltam <= DIAS_ANTES_DO_PROXIMO)
    out.push(
      alerta(
        TEMA,
        "pacto-proximo-sem-metas",
        "critico",
        `Rede · metas do Pacto ${prox.trimestre.rotulo} não cadastradas`,
        {
          peso: 100 * pacto.length + (DIAS_ANTES_DO_PROXIMO - faltam),
          destino: destinoIdu(prox.trimestre),
          limiar: `o ${prox.trimestre.rotulo} abre em ${dataBr(prox.trimestre.inicio)} (${plural(faltam, "dia", "dias")}) sem nenhuma meta gravada, nem da unidade nem padrão; as metas se pactuam antes de o trimestre abrir`,
          periodo: prox.trimestre.chave,
        },
      ),
    );
  return out;
}

function alertasCompromissos(
  extra: ExtraEstrategico,
  cs: Compromisso[],
  unidades: UnidadeCoo[],
): AlertaCoo[] {
  if (!extra.clickupConectado) return [];
  return cs
    .filter((c) => c.vencido && c.diasVencido !== null && c.diasVencido >= DIAS_VENCIDO_ALERTA)
    .map((c) => {
      const u = acharUnidade(unidades, c.unidade);
      const onde =
        u?.nome ?? (chaveUnidade(c.unidade) === "rede" || !c.unidade ? "Rede" : c.unidade);
      const nome = c.nome.length > 60 ? `${c.nome.slice(0, 59)}…` : c.nome;
      return alerta(
        TEMA,
        "compromisso-vencido",
        "critico",
        `${onde} · vencido há ${c.diasVencido} dias: ${nome}`,
        {
          unidade: u?.nome ?? null,
          peso: c.diasVencido as number,
          destino: DESTINO_COMPROMISSOS,
          limiar: `compromisso aberto com o prazo vencido há ${DIAS_VENCIDO_ALERTA} dias ou mais (duas reuniões sem solução)`,
          periodo: c.id,
        },
      );
    });
}

function alertasOkrs(foto: FotoOkr | null): AlertaCoo[] {
  if (!foto) return [];
  const out: AlertaCoo[] = [];
  const ciclo = CICLO.inicio.slice(0, 7);
  for (const d of foto.departamentos)
    if (d.medidas === 0)
      out.push(
        alerta(
          TEMA,
          "okr-sem-medicao",
          "atencao",
          `${d.base} · nenhuma das ${plural(d.total, "KR", "KRs")} medida`,
          {
            peso: d.total,
            limiar: `departamento sem nenhuma KR medida na última foto de OKRs (${dataBr(foto.ultimoDia)})`,
            periodo: `${d.base} ${ciclo}`,
          },
        ),
      );
  if (foto.parada)
    out.push(
      alerta(
        TEMA,
        "okr-foto-parada",
        "atencao",
        `OKRs · foto diária parada desde ${dataBr(foto.ultimoDia)}`,
        {
          peso: foto.diasSemFoto,
          destino: DESTINO_CHAVES,
          limiar: `foto de OKR com mais de ${DIAS_FOTO_PARADA} dias (a coleta é diária); dono: quem cuida da integração do ClickUp (token em ${CHAVES_URL})`,
          periodo: foto.ultimoDia,
        },
      ),
    );
  return out;
}

// ---------------------------------------------------------------------------------------------
// Gráficos
// ---------------------------------------------------------------------------------------------

function graficoSemana(extra: ExtraEstrategico, cs: Compromisso[], hoje: string): GraficoCoo {
  const base = {
    id: "revisao-semana",
    titulo: "Como terminou a semana em cada tema?",
    tipo: "barras-h" as const,
    series: [
      { chave: "noPrazo", rotulo: "No prazo" },
      { chave: "comAtraso", rotulo: "Com atraso" },
      { chave: "vencidos", rotulo: "Vencidos" },
      { chave: "abertos", rotulo: "Abertos no prazo" },
    ],
    unidade: UN_COMPROMISSOS,
    fonte: "Rotina Semanal (ClickUp)",
    explicacao: {
      oQueDiz:
        "Os compromissos com prazo nesta semana, por tema da rotina: o que foi entregue no prazo, com atraso, o que venceu e o que ainda está no prazo.",
      comoCalcula: EXPLICACAO_COMPROMISSOS.comoCalcula,
      dono: EXPLICACAO_COMPROMISSOS.dono,
    },
    destino: DESTINO_COMPROMISSOS,
  };
  if (!extra.clickupConectado)
    return grafico(base, [], { estado: "nao_apurado", motivo: MOTIVO_SEM_CLICKUP });
  if (extra.compromissosMotivo)
    return grafico(base, [], { estado: "fonte_indisponivel", motivo: extra.compromissosMotivo });
  const rev = revisaoDaSemana(cs, hoje);
  const total = rev.reduce((s, r) => s + r.noPrazo + r.comAtraso + r.vencidos + r.abertos, 0);
  if (!total)
    return grafico(base, [], {
      estado: "nao_apurado",
      motivo: "nenhum compromisso com prazo nesta semana",
      dataDado: hoje,
    });
  return grafico(
    base,
    ORDEM_TEMAS.map((t) => {
      const r = rev.find((x) => x.tema === t)!;
      return {
        rotulo: TEMAS[t].menu,
        noPrazo: r.noPrazo,
        comAtraso: r.comAtraso,
        vencidos: r.vencidos,
        abertos: r.abertos,
      };
    }),
    { dataDado: hoje },
  );
}

function graficoPacto(
  dados: DadosEstrategico,
  pacto: PactoUnidade[] | null,
  numeroPacto_: NumeroCoo,
): GraficoCoo {
  const base = {
    id: "idu-por-unidade",
    titulo: "Como cada unidade está no Pacto?",
    tipo: "barras-h" as const,
    series: [{ chave: "idu", rotulo: "IDU (0 a 100)" }],
    // Nota de 0 a 100, sem "%": "contas" formata o número com uma casa, como a tela do IDU.
    unidade: UN_UNIDADES,
    fonte: "IDU · Pacto Trimestral",
    explicacao: {
      oQueDiz: `A nota do IDU de cada unidade com o pacto cadastrado; ${CORTE_PACTO} é a linha de corte que libera 100% do forecast.`,
      comoCalcula: EXPLICACAO_PACTO.comoCalcula,
      atencao: EXPLICACAO_PACTO.atencao,
      dono: EXPLICACAO_PACTO.dono,
    },
    destino: numeroPacto_.destino,
  };
  if (!pacto)
    return grafico(base, [], {
      estado:
        numeroPacto_.estado === "disponivel" || numeroPacto_.estado === "parcial"
          ? "nao_apurado"
          : numeroPacto_.estado,
      motivo: numeroPacto_.motivo ?? "sem apuração do IDU no recorte",
    });
  const com = pacto.filter((p) => p.cadastrado);
  if (!com.length)
    return grafico(base, [], {
      estado: "nao_apurado",
      motivo: numeroPacto_.motivo ?? "o pacto não tem metas cadastradas",
    });
  const pontos = com
    .map((p) => ({ rotulo: p.unidade.nome, idu: p.idu === null ? null : um(p.idu) }))
    .sort((a, b) => (b.idu ?? -1) - (a.idu ?? -1));
  const fora = pacto.length - com.length;
  return grafico(base, pontos, {
    estado: fora ? "parcial" : "disponivel",
    motivo: fora
      ? `${plural(fora, "unidade sem metas cadastradas fica", "unidades sem metas cadastradas ficam")} fora`
      : undefined,
  });
}

// ---------------------------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------------------------

export function montarEstrategico(
  dados: DadosEstrategico,
  extra: ExtraEstrategico,
  unidades: UnidadeCoo[],
  filtro: FiltroUnidade,
  hoje: string,
): LeituraTema {
  const sel = unidadesDoFiltro(unidades, filtro);
  const unica =
    filtro && filtro !== "rede" && filtro !== "propria" && sel.length === 1 ? sel[0] : null;
  const redeSel = sel.filter((u) => u.grupo === "rede");
  const redeOp = redeSel.filter((u) => u.emOperacao);
  const redeOpToda = unidades.filter((u) => u.grupo === "rede" && u.emOperacao);

  // Faturamento: a leitura do recorte (número 2) e a da rede inteira em operação (número 3, que
  // mede o peso da unidade filtrada contra a rede toda). Sem filtro, as duas são a mesma.
  const fatFiltro =
    dados.rede.ok && redeOp.length
      ? lerFaturamento(dados.rede.dado, new Set(redeOp.map((u) => u.id)), hoje)
      : null;
  const fatRede =
    dados.rede.ok && redeOpToda.length
      ? unica
        ? lerFaturamento(dados.rede.dado, new Set(redeOpToda.map((u) => u.id)), hoje)
        : fatFiltro
      : null;

  const foto = lerFoto(extra.okrs, hoje);
  const cs = compromissosDoFiltro(extra.compromissos, unidades, filtro);

  const { numero: nPacto, pacto } = numeroPacto(dados, redeSel, redeOp, unica, hoje);
  const numeros = [
    nPacto,
    numeroFaturamento(dados, fatFiltro, redeSel, redeOp, hoje),
    numeroConcentracao(dados, fatRede, redeSel, redeOp, unica),
    numeroOkrs(extra, foto),
    numeroCompromissos(extra, cs, hoje),
    numeroImplantacao(dados, extra, redeSel, unidades, hoje),
  ];
  if (numeros.length > MAX_NUMEROS)
    throw new Error(`estratégico: ${numeros.length} números, o máximo é ${MAX_NUMEROS}`);

  const alertas = [
    ...alertasPacto(dados, pacto, unica, hoje),
    ...alertasCompromissos(extra, cs, unidades),
    ...alertasOkrs(foto),
  ];

  const graficos = [graficoSemana(extra, cs, hoje), graficoPacto(dados, pacto, nPacto)];

  const fontes: Procedencia[] = [
    { fonte: "IDU · Pacto Trimestral", atualizadoEm: dados.idu.ok ? hoje : null },
    {
      fonte: "Apuração de royalties confirmada",
      atualizadoEm: fatRede?.resumo.fechados ? fimDoMes(fatRede.resumo.fechados.ate) : null,
    },
    { fonte: "Foto diária de OKRs (ClickUp)", atualizadoEm: foto?.ultimoDia ?? null },
    { fonte: "Rotina Semanal (ClickUp)", atualizadoEm: extra.clickupConectado ? hoje : null },
    { fonte: "Cadastro de unidades", atualizadoEm: hoje },
  ];

  const avisos: string[] = [];
  if (dados.rede.ok) {
    const faturandoSemData = redeSel
      .filter((u) => !u.emOperacao)
      .filter(
        (u) =>
          dados.rede.ok &&
          // Apuração confirmada com receita: a de R$ 0 é só o registro do mês, não faturamento.
          dados.rede.dado.apuracoes.some(
            (a) =>
              a.unidade_id === u.id &&
              a.status === "confirmado" &&
              (num(a.receita_base) ?? 0) + (num(a.receita_base_antiga) ?? 0) > 0,
          ),
      );
    if (faturandoSemData.length)
      avisos.push(
        `${listaNomes(faturandoSemData.map((u) => u.nome))} ${faturandoSemData.length === 1 ? "tem" : "têm"} apuração de royalties confirmada com receita, mas o cadastro não tem data de inauguração: ${faturandoSemData.length === 1 ? "fica" : "ficam"} em implantação e fora dos números de desempenho.`,
      );
  }
  if (!extra.clickupConectado)
    avisos.push(
      `Sem ClickUp conectado, compromissos e revisão da semana ficam sem dado (token em ${CHAVES_URL}).`,
    );

  return {
    tema: TEMA,
    universo: universo(unidades, filtro),
    numeros,
    alertas,
    graficos,
    fontes,
    avisos,
  };
}
