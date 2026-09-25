// Camada de métricas da conversa: um catálogo FECHADO de consultas sobre a carga do cockpit.
//
// Nenhuma regra nova. Cada consulta recebe a FonteCockpit que o servidor montou com a sessão da
// pessoa e chama as funções que a tela já usa (`montarCockpit`, `resumirLeitura`,
// `resumirRedeUnidades`, a ponte, aquisição, onboarding, cadeia, caixa, coortes, clientes). O que
// sai é agregado em uma forma conhecida (resultado.ts), com fonte, data, estado, filtros aplicados e
// avisos. Não existe consulta livre: o modelo escolhe uma destas e preenche argumentos validados.
//
// Honestidade, as mesmas regras do cockpit:
// - ausência é `null`, nunca 0; mês parcial ou em andamento não entra como realizado;
// - número de uma régua não é somado ao de outra (grupo × rede, MRR × faturamento);
// - unidade fora do escopo da pessoa não é lida, e a resposta não diz se ela existe.
import { z } from "zod";
import { montarCockpit } from "../indicadores.ts";
import type { Cockpit, FonteCockpit } from "../indicadores.ts";
import { IDS_INDICADORES } from "../contrato.ts";
import type { Destino, Estado, Indicador, UnidadeContagem } from "../contrato.ts";
import { resumirLeitura } from "../receita.ts";
import type { LeituraReceita } from "../receita.ts";
import { resolverPeriodo } from "../periodo.ts";
import { donoDaAmeaca } from "../donos.ts";
import { NOMES, PRODUTOS } from "../../monetizacao/types.ts";
import {
  FiltrosSchema,
  ROTULO_BASE,
  ROTULO_LEITURA,
  ROTULO_PRODUTO,
  buscaDoPeriodo,
  mesBr,
  mesesDoPeriodo,
  resolverUnidades,
  rotuloPeriodo,
  somaMeses,
} from "./filtros.ts";
import type { Filtros } from "./filtros.ts";
import type { DadosResultado, Destaque, Resultado } from "./resultado.ts";

export const VERSAO_CATALOGO = "conversa-2026-09-24";

type SemId = Omit<Resultado, "id" | "consulta" | "args" | "versaoRegra">;
const temNumero = (e: Estado) => e === "disponivel" || e === "parcial";
const cent = (v: number) => Math.round(v * 100);
const soma = (vs: number[]) => vs.reduce((a, v) => a + cent(v), 0) / 100;
const variacaoPct = (atual: number | null, anterior: number | null) =>
  atual === null || anterior === null || anterior === 0
    ? null
    : Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10;

/** Resultado sem número: estado e motivo, para o modelo dizer que não há dado. */
function semDado(
  titulo: string,
  unidade: UnidadeContagem,
  estado: Estado,
  motivo: string,
  fonte: string,
  forma: DadosResultado["forma"] = "kpi",
): SemId {
  const vazio: Record<DadosResultado["forma"], DadosResultado> = {
    kpi: { forma: "kpi", valor: null, comparacoes: [], composicao: [] },
    serie: { forma: "serie", pontos: [], series: [] },
    categorias: { forma: "categorias", itens: [], total: null, somaFecha: false },
    funil: { forma: "funil", etapas: [] },
    ponte: {
      forma: "ponte",
      inicio: { rotulo: "", valor: 0 },
      passos: [],
      fim: { rotulo: "", valor: 0 },
    },
    tabela: { forma: "tabela", colunas: [], linhas: [] },
    coorte: { forma: "coorte", colunas: [], linhas: [] },
    acoes: { forma: "acoes", itens: [] },
  };
  return {
    titulo,
    unidade,
    estado,
    fonte,
    atualizadoEm: null,
    filtrosAplicados: [],
    avisos: [motivo],
    destino: null,
    destaques: [],
    dados: vazio[forma],
  };
}

/** Entrada de toda consulta: a carga da pessoa e um cockpit por recorte, montado uma vez. */
export interface EntradaConsulta {
  fonte: FonteCockpit;
  hoje: string;
  cockpit(filtros?: Filtros): Cockpit;
}

export function criarEntrada(fonte: FonteCockpit): EntradaConsulta {
  const memo = new Map<string, Cockpit>();
  const base = () => cockpitDe(undefined);
  function cockpitDe(filtros: Filtros | undefined): Cockpit {
    const busca = buscaDoPeriodo(filtros?.periodo, fonte.hoje);
    let perimetro = "";
    if (filtros?.unidades?.length === 1) {
      const c = memo.get("|") ?? base();
      const { unidades } = resolverUnidades(
        filtros.unidades,
        c.perimetros.map((p) => p.rotulo),
      );
      perimetro = c.perimetros.find((p) => p.rotulo === unidades[0])?.chave ?? "";
    }
    const chave = `${JSON.stringify(busca)}|${perimetro}`;
    const guardado = memo.get(chave);
    if (guardado) return guardado;
    const c = montarCockpit(fonte, { periodo: resolverPeriodo(busca, fonte.hoje), perimetro });
    memo.set(chave, c);
    return c;
  }
  return { fonte, hoje: fonte.hoje, cockpit: cockpitDe };
}

const leituraDe = (e: EntradaConsulta, id: "grupo" | "rede"): LeituraReceita | null =>
  e.fonte.receita?.leituras.find((l) => l.id === id) ?? null;

const estadoDaReceita = (e: EntradaConsulta): { estado: Estado; motivo: string } | null => {
  const r = e.fonte.receita;
  if (!r)
    return {
      estado: "fonte_indisponivel",
      motivo: "As leituras de faturamento não foram carregadas.",
    };
  if (r.estado === "sem_acesso")
    return { estado: "acesso_insuficiente", motivo: "Seu acesso não lê o faturamento." };
  if (r.estado !== "ok")
    return { estado: "fonte_indisponivel", motivo: r.erro ?? "A leitura de faturamento falhou." };
  return null;
};

// ── Consultas ────────────────────────────────────────────────────────────────

const ArgsIndicador = z
  .object({
    id: z.enum(IDS_INDICADORES),
    filtros: FiltrosSchema.pick({ periodo: true, unidades: true }).strict().optional(),
  })
  .strict();

function consultaIndicador(e: EntradaConsulta, a: z.infer<typeof ArgsIndicador>): SemId {
  const f = a.filtros;
  const avisos: string[] = [];
  if ((f?.unidades?.length ?? 0) > 1)
    avisos.push("Um número do cockpit aceita uma unidade por vez; foi lida a rede inteira.");
  const c = e.cockpit(f?.unidades?.length === 1 ? f : { ...f, unidades: undefined });
  if (f?.unidades?.length === 1 && c.perimetroRotulo !== f.unidades[0])
    if (!c.perimetros.some((p) => p.rotulo === c.perimetroRotulo))
      avisos.push(`Unidade "${f.unidades[0]}" fora do seu escopo; mostrando a rede inteira.`);
  const i = c.indicadores.find((x) => x.id === a.id);
  if (!i) return semDado(a.id, "reais", "nao_apurado", "Número fora do catálogo.", "—");
  return deIndicador(i, avisos);
}

export function deIndicador(i: Indicador, avisosExtra: string[] = []): SemId {
  const comValor = temNumero(i.estado);
  const comparacoes = i.comparacoes.map((c) => ({
    rotulo: c.rotulo,
    valor: temNumero(c.estado) ? c.referencia : null,
  }));
  const anterior = comparacoes[0]?.valor ?? null;
  const destaques: Destaque[] = [];
  if (comValor && anterior !== null) {
    destaques.push({
      rotulo: `Diferença para "${comparacoes[0].rotulo}"`,
      valor: Math.round(((i.valor ?? 0) - anterior) * 100) / 100,
      unidade: i.unidade,
    });
    destaques.push({
      rotulo: `Variação sobre "${comparacoes[0].rotulo}" (%)`,
      valor: variacaoPct(i.valor, anterior),
      unidade: "percentual",
    });
  }
  return {
    titulo: i.titulo,
    unidade: i.unidade,
    estado: i.estado,
    fonte: i.fonte,
    atualizadoEm: i.dataDado,
    filtrosAplicados: [
      i.periodo ? `${i.periodo.de} a ${i.periodo.ate}` : "fotografia de agora",
      i.perimetro,
      ...i.filtros,
    ],
    avisos: [
      ...avisosExtra,
      ...(i.lacuna ? [`Falta: ${i.lacuna.oQueFalta} (${i.lacuna.responsavel}).`] : []),
      ...(!comValor ? [`Sem número: ${i.estado.replace("_", " ")}.`] : []),
    ],
    destino: i.destino,
    destaques,
    dados: {
      forma: "kpi",
      valor: comValor ? i.valor : null,
      comparacoes,
      composicao: comValor
        ? i.composicao.map((l) => ({ rotulo: l.rotulo, valor: l.valor, observacao: l.observacao }))
        : [],
    },
  };
}

const ArgsSerie = z
  .object({
    filtros: FiltrosSchema.pick({ periodo: true, leitura: true, unidades: true, base: true })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Faturamento mensal. Grupo = Financeiro (fn_faturamento_mensal, a mesma série da tela de
 * Faturamento). Rede = apuração de royalties confirmada, por unidade e base. Nunca as duas somadas.
 */
function consultaSerieFaturamento(e: EntradaConsulta, a: z.infer<typeof ArgsSerie>): SemId {
  const f = a.filtros ?? {};
  const leitura =
    f.leitura ?? (f.unidades?.length || (f.base && f.base !== "todas") ? "rede" : "grupo");
  const titulo = `Faturamento mensal · ${ROTULO_LEITURA[leitura]}`;
  const falha = estadoDaReceita(e);
  if (falha) return semDado(titulo, "reais", falha.estado, falha.motivo, "Faturamento", "serie");
  const l = leituraDe(e, leitura);
  if (!l || !temNumero(l.estado))
    return semDado(
      titulo,
      "reais",
      l?.estado ?? "fonte_indisponivel",
      l?.nota ?? "Leitura não carregada.",
      l?.fonte ?? "—",
      "serie",
    );
  const meses = mesesDoPeriodo(f.periodo, e.hoje, 6);
  const avisos: string[] = [];
  const aplicados = [
    rotuloPeriodo(f.periodo ?? { tipo: "ultimos_meses", meses: 6 }, e.hoje),
    ROTULO_LEITURA[leitura],
  ];
  const parciais = new Set(l.parciaisFonte ?? []);
  let pontos: { x: string; valores: Record<string, number | null> }[];
  let series: { chave: string; rotulo: string }[];

  if (leitura === "grupo") {
    if (f.unidades?.length || (f.base && f.base !== "todas"))
      avisos.push(
        "Unidade e base só existem na leitura da rede (apuração das unidades); o grupo foi lido inteiro.",
      );
    const resumo = resumirLeitura(l, e.hoje);
    const porMes = new Map(resumo.serie.map((s) => [s.mes, s]));
    pontos = meses.map((m) => {
      const s = porMes.get(m);
      return { x: m, valores: { total: s && !s.parcial ? s.valor : null } };
    });
    series = [{ chave: "total", rotulo: "Faturamento do grupo" }];
    const faltam = meses.filter((m) => !porMes.has(m) || porMes.get(m)!.parcial);
    if (faltam.length)
      avisos.push(`${faltam.map(mesBr).join(", ")}: sem mês fechado na fonte; fica sem número.`);
  } else {
    const base = f.base ?? "todas";
    const disponiveis = [...new Set(l.linhas.map((x) => x.chave))].sort();
    const { unidades, fora } = resolverUnidades(f.unidades, disponiveis);
    if (fora.length)
      avisos.push(`Fora do seu escopo ou sem apuração: ${fora.join(", ")}. Não entrou na série.`);
    if (f.unidades?.length && !unidades.length)
      return {
        ...semDado(titulo, "reais", "nao_apurado", avisos[0], l.fonte, "serie"),
        filtrosAplicados: aplicados,
      };
    const valorDe = (m: string, chave: string | null): number | null => {
      const partes = (l.porBase ?? []).filter(
        (p) => p.mes === m && (chave === null || p.chave === chave),
      );
      if (!partes.length) return null;
      return soma(
        partes.map((p) =>
          base === "nova" ? p.nova : base === "antiga" ? p.antiga : p.nova + p.antiga,
        ),
      );
    };
    aplicados.push(ROTULO_BASE[base]);
    if (unidades.length) {
      aplicados.push(unidades.join(", "));
      series = unidades.map((u) => ({ chave: u, rotulo: u }));
      pontos = meses.map((m) => ({
        x: m,
        valores: Object.fromEntries(unidades.map((u) => [u, valorDe(m, u)])),
      }));
    } else {
      series = [{ chave: "total", rotulo: "Rede inteira" }];
      pontos = meses.map((m) => ({
        x: m,
        valores: { total: parciais.has(m) ? null : valorDe(m, null) },
      }));
      const p = meses.filter((m) => parciais.has(m));
      if (p.length)
        avisos.push(
          `${p.map(mesBr).join(", ")}: há unidade sem apuração confirmada; o total da rede fica sem número nesses meses.`,
        );
    }
  }
  const destaques: Destaque[] = [];
  for (const s of series) {
    const vals = pontos.map((p) => p.valores[s.chave]).filter((v): v is number => v !== null);
    const ultimo = pontos.at(-1)?.valores[s.chave] ?? null;
    const penultimo = pontos.at(-2)?.valores[s.chave] ?? null;
    const primeiro = pontos[0]?.valores[s.chave] ?? null;
    if (vals.length === pontos.length && vals.length)
      destaques.push({
        rotulo: `${s.rotulo}: soma do período`,
        valor: soma(vals),
        unidade: "reais",
      });
    if (vals.length === pontos.length && vals.length)
      destaques.push({
        rotulo: `${s.rotulo}: média mensal`,
        valor: Math.round((soma(vals) / vals.length) * 100) / 100,
        unidade: "reais",
      });
    destaques.push({
      rotulo: `${s.rotulo}: variação do último mês (%)`,
      valor: variacaoPct(ultimo, penultimo),
      unidade: "percentual",
    });
    if (ultimo !== null && penultimo !== null)
      destaques.push({
        rotulo: `${s.rotulo}: diferença do último mês`,
        valor: Math.round((ultimo - penultimo) * 100) / 100,
        unidade: "reais",
      });
    destaques.push({
      rotulo: `${s.rotulo}: variação no período (%)`,
      valor: variacaoPct(ultimo, primeiro),
      unidade: "percentual",
    });
  }
  const todosNulos = pontos.every((p) => Object.values(p.valores).every((v) => v === null));
  return {
    titulo,
    unidade: "reais",
    estado: todosNulos ? "nao_apurado" : avisos.length ? "parcial" : l.estado,
    fonte: l.fonte,
    atualizadoEm:
      leitura === "grupo" ? (e.fonte.receita?.frescorFinanceiro?.carregadoEm ?? null) : null,
    filtrosAplicados: aplicados,
    avisos: [...avisos, ...l.cobertura.slice(0, 2)],
    destino: l.destino,
    destaques,
    dados: { forma: "serie", pontos, series },
  };
}

const ArgsPonte = z
  .object({
    mes: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  })
  .strict();

function consultaPonte(e: EntradaConsulta, a: z.infer<typeof ArgsPonte>): SemId {
  const titulo = "De onde veio a variação do faturamento do grupo";
  const falha = estadoDaReceita(e);
  if (falha) return semDado(titulo, "reais", falha.estado, falha.motivo, "Financeiro", "ponte");
  const p = e.fonte.receita?.ponte;
  const fonte = "Financeiro · faturamento por cliente (emissão), ponte mês a mês";
  if (!p || !p.meses.length)
    return semDado(
      titulo,
      "reais",
      "nao_apurado",
      "A ponte não tem mês fechado na fonte.",
      fonte,
      "ponte",
    );
  const m = a.mes ? p.meses.find((x) => x.mes === a.mes) : p.meses.at(-1);
  if (!m)
    return semDado(
      titulo,
      "reais",
      "nao_apurado",
      `Sem ponte para ${mesBr(a.mes!)}: o mês não está fechado na fonte.`,
      fonte,
      "ponte",
    );
  if (!m.fecha)
    return semDado(
      titulo,
      "reais",
      "parcial",
      `A ponte de ${mesBr(m.mes)} não fecha com a série da fonte (diferença de R$ ${m.diferencaFonte.toFixed(2)}); o número não é mostrado.`,
      fonte,
      "ponte",
    );
  const entrou = soma([m.novos.valor, m.retornos.valor, m.expansao.valor]);
  const saiu = soma([m.contracao.valor, m.semFaturamento.valor]);
  return {
    titulo: `${titulo} em ${mesBr(m.mes)}`,
    unidade: "reais",
    estado: "disponivel",
    fonte,
    atualizadoEm: e.fonte.receita?.frescorFinanceiro?.carregadoEm ?? null,
    filtrosAplicados: [mesBr(m.mes), "grupo inteiro"],
    avisos: [
      "Unidade nova, monetização e aquisições ainda não têm vínculo de receita por cliente: não aparecem separadas.",
    ],
    destino: {
      rota: "/cockpit-ceo",
      search: { frente: "receita" },
      rotulo: "Abrir Receita e trajetória",
      mesmoRecorte: true,
      observacao: "Mês a mês na frente.",
    },
    destaques: [
      { rotulo: "Entrou (novos + retornos + expansão)", valor: entrou, unidade: "reais" },
      { rotulo: "Saiu (contração + sem faturamento)", valor: saiu, unidade: "reais" },
      {
        rotulo: "Variação do mês",
        valor: Math.round((m.atual - m.anterior) * 100) / 100,
        unidade: "reais",
      },
      {
        rotulo: "Variação do mês (%)",
        valor: variacaoPct(m.atual, m.anterior),
        unidade: "percentual",
      },
    ],
    dados: {
      forma: "ponte",
      inicio: { rotulo: `Faturamento de ${mesBr(somaMeses(m.mes, -1))}`, valor: m.anterior },
      passos: [
        { rotulo: "Clientes novos", valor: m.novos.valor, clientes: m.novos.clientes },
        { rotulo: "Voltaram a faturar", valor: m.retornos.valor, clientes: m.retornos.clientes },
        { rotulo: "Faturaram mais", valor: m.expansao.valor, clientes: m.expansao.clientes },
        { rotulo: "Faturaram menos", valor: m.contracao.valor, clientes: m.contracao.clientes },
        {
          rotulo: "Sem faturamento no mês",
          valor: m.semFaturamento.valor,
          clientes: m.semFaturamento.clientes,
        },
        { rotulo: "Sem cliente identificado", valor: m.semCliente, clientes: null },
      ],
      fim: { rotulo: `Faturamento de ${mesBr(m.mes)}`, valor: m.atual },
    },
  };
}

const ArgsVariacao = z
  .object({
    filtros: FiltrosSchema.pick({ leitura: true, base: true }).strict().optional(),
    mes: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    limite: z.number().int().min(3).max(12).optional(),
  })
  .strict();

/** Quem mais explica a variação de um mês fechado: por empresa (grupo) ou por unidade (rede). */
function consultaVariacao(e: EntradaConsulta, a: z.infer<typeof ArgsVariacao>): SemId {
  const leitura = a.filtros?.leitura ?? "rede";
  const base = a.filtros?.base ?? "todas";
  const titulo = `Quem mais explica a variação · ${ROTULO_LEITURA[leitura]}`;
  const falha = estadoDaReceita(e);
  if (falha)
    return semDado(titulo, "reais", falha.estado, falha.motivo, "Faturamento", "categorias");
  const l = leituraDe(e, leitura);
  if (!l || !temNumero(l.estado))
    return semDado(
      titulo,
      "reais",
      l?.estado ?? "fonte_indisponivel",
      l?.nota ?? "Leitura não carregada.",
      l?.fonte ?? "—",
      "categorias",
    );
  const resumo = resumirLeitura(l, e.hoje);
  const mes = a.mes ?? resumo.fechados?.ate ?? null;
  if (!mes || (resumo.fechados && (mes > resumo.fechados.ate || mes < resumo.fechados.de)))
    return semDado(
      titulo,
      "reais",
      "nao_apurado",
      "O mês pedido não está fechado nesta leitura.",
      l.fonte,
      "categorias",
    );
  const anterior = somaMeses(mes, -1);
  const valor = (m: string, chave: string): number => {
    if (leitura === "rede") {
      const partes = (l.porBase ?? []).filter((p) => p.mes === m && p.chave === chave);
      return soma(
        partes.map((p) =>
          base === "nova" ? p.nova : base === "antiga" ? p.antiga : p.nova + p.antiga,
        ),
      );
    }
    return soma(l.linhas.filter((x) => x.mes === m && x.chave === chave).map((x) => x.valor));
  };
  const chaves = [
    ...new Set(l.linhas.filter((x) => x.mes === mes || x.mes === anterior).map((x) => x.chave)),
  ];
  const deltas = chaves
    .map((k) => ({ rotulo: k, antes: valor(anterior, k), depois: valor(mes, k) }))
    .map((d) => ({ ...d, delta: Math.round((d.depois - d.antes) * 100) / 100 }))
    .filter((d) => d.delta !== 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const limite = a.limite ?? 6;
  const topo = deltas.slice(0, limite);
  const resto = deltas.slice(limite);
  const itens = topo.map((d) => ({
    rotulo: d.rotulo,
    valor: d.delta,
    detalhe: `${mesBr(anterior)}: ${d.antes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} → ${mesBr(mes)}: ${d.depois.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
  }));
  if (resto.length)
    itens.push({
      rotulo: `Demais (${resto.length})`,
      valor: soma(resto.map((d) => d.delta)),
      detalhe: "",
    });
  const total = soma(deltas.map((d) => d.delta));
  return {
    titulo: `${titulo} em ${mesBr(mes)}`,
    unidade: "reais",
    estado: l.estado,
    fonte: l.fonte,
    atualizadoEm: null,
    filtrosAplicados: [
      `${mesBr(mes)} contra ${mesBr(anterior)}`,
      ROTULO_LEITURA[leitura],
      ...(leitura === "rede" ? [ROTULO_BASE[base]] : []),
    ],
    avisos:
      leitura === "grupo" ? ["No grupo, a chave é a empresa emissora, não a unidade da rede."] : [],
    destino: l.destino,
    destaques: [{ rotulo: "Variação total", valor: total, unidade: "reais" }],
    dados: { forma: "categorias", itens, total, somaFecha: true },
  };
}

const ArgsRanking = z
  .object({
    filtros: FiltrosSchema.pick({ periodo: true, base: true, unidades: true }).strict().optional(),
    metrica: z.enum(["faturamento", "royalties_csc"]).optional(),
  })
  .strict();

/** Unidades da rede no período (meses fechados), pela apuração confirmada. */
function consultaRanking(e: EntradaConsulta, a: z.infer<typeof ArgsRanking>): SemId {
  const metrica = a.metrica ?? "faturamento";
  const base = a.filtros?.base ?? "todas";
  const titulo =
    metrica === "faturamento" ? "Faturamento por unidade" : "Royalties + CSC por unidade";
  const falha = estadoDaReceita(e);
  if (falha)
    return semDado(
      titulo,
      "reais",
      falha.estado,
      falha.motivo,
      "Apuração de royalties",
      "categorias",
    );
  const l = leituraDe(e, "rede");
  if (!l || !temNumero(l.estado))
    return semDado(
      titulo,
      "reais",
      l?.estado ?? "fonte_indisponivel",
      l?.nota ?? "Leitura da rede não carregada.",
      l?.fonte ?? "—",
      "categorias",
    );
  const meses = mesesDoPeriodo(a.filtros?.periodo, e.hoje, 3);
  const avisos: string[] = [];
  if (metrica === "royalties_csc" && base !== "todas")
    avisos.push("Royalties + CSC não se separam por base; a base pedida não se aplica.");
  const disponiveis = [...new Set(l.linhas.map((x) => x.chave))];
  const { unidades, fora } = resolverUnidades(a.filtros?.unidades, disponiveis);
  if (fora.length) avisos.push(`Fora do seu escopo ou sem apuração: ${fora.join(", ")}.`);
  const alvo = a.filtros?.unidades?.length ? unidades : disponiveis;
  const parciais = meses.filter((m) => (l.parciaisFonte ?? []).includes(m));
  if (parciais.length)
    avisos.push(`${parciais.map(mesBr).join(", ")}: há unidade sem apuração confirmada nesse mês.`);
  const itens = alvo
    .map((u) => {
      let valor: number | null;
      if (metrica === "faturamento") {
        const partes = (l.porBase ?? []).filter((p) => p.chave === u && meses.includes(p.mes));
        valor = partes.length
          ? soma(
              partes.map((p) =>
                base === "nova" ? p.nova : base === "antiga" ? p.antiga : p.nova + p.antiga,
              ),
            )
          : null;
      } else {
        const partes = (l.complementos ?? []).filter((p) => p.chave === u && meses.includes(p.mes));
        valor =
          partes.length && partes.every((p) => p.royaltiesCsc !== null)
            ? soma(partes.map((p) => p.royaltiesCsc!))
            : null;
      }
      const mesesComDado = new Set(
        (l.porBase ?? []).filter((p) => p.chave === u && meses.includes(p.mes)).map((p) => p.mes),
      ).size;
      return {
        rotulo: u,
        valor,
        detalhe:
          mesesComDado < meses.length
            ? `${mesesComDado} de ${meses.length} meses apurados`
            : undefined,
      };
    })
    .sort((x, y) => (y.valor ?? -Infinity) - (x.valor ?? -Infinity));
  const conhecidos = itens.filter((i) => i.valor !== null).map((i) => i.valor!);
  const total = conhecidos.length === itens.length && itens.length ? soma(conhecidos) : null;
  const destaques: Destaque[] = [
    { rotulo: "Total das unidades listadas", valor: total, unidade: "reais" },
  ];
  if (total && itens[0]?.valor != null)
    destaques.push({
      rotulo: `Participação de ${itens[0].rotulo} (%)`,
      valor: Math.round((itens[0].valor / total) * 1000) / 10,
      unidade: "percentual",
    });
  return {
    titulo,
    unidade: "reais",
    estado: avisos.length ? "parcial" : l.estado,
    fonte: l.fonte,
    atualizadoEm: null,
    filtrosAplicados: [
      meses.length === 1 ? mesBr(meses[0]) : `${mesBr(meses[0])} a ${mesBr(meses.at(-1)!)}`,
      ...(metrica === "faturamento" ? [ROTULO_BASE[base]] : []),
      ...(a.filtros?.unidades?.length ? [unidades.join(", ")] : ["todas as unidades"]),
    ],
    avisos,
    destino: l.destino,
    destaques,
    dados: { forma: "categorias", itens, total, somaFecha: total !== null },
  };
}

const ArgsAquisicao = z
  .object({
    filtros: FiltrosSchema.pick({ periodo: true }).strict().optional(),
    metrica: z
      .enum(["mrr_novo", "vendas", "mql", "leads", "investimento", "custo_midia_por_venda"])
      .optional(),
  })
  .strict();

const METRICAS_AQ = {
  mrr_novo: { rotulo: "MRR novo vendido", unidade: "reais", campo: "mrrNovo", plano: "mrrNovo" },
  vendas: { rotulo: "Vendas", unidade: "negócios", campo: "vendas", plano: "vendas" },
  mql: { rotulo: "MQL", unidade: "negócios", campo: "mql", plano: "mql" },
  leads: { rotulo: "Leads", unidade: "negócios", campo: "leads", plano: null },
  investimento: {
    rotulo: "Investimento em mídia",
    unidade: "reais",
    campo: "investimento",
    plano: "investimento",
  },
  custo_midia_por_venda: {
    rotulo: "Custo de mídia por venda",
    unidade: "reais",
    campo: "custoMidiaPorVenda",
    plano: null,
  },
} as const;

/** Aquisição do Inside Sales (Growth): realizado × plano por mês. MRR vendido não é faturamento. */
function consultaAquisicao(e: EntradaConsulta, a: z.infer<typeof ArgsAquisicao>): SemId {
  const m = METRICAS_AQ[a.metrica ?? "mrr_novo"];
  const titulo = `${m.rotulo} · Inside Sales`;
  const c = e.cockpit();
  const aq = c.empresa.aquisicao;
  const fonte = "Growth · growth.serie_mensal (realizado) e growth.metas (plano)";
  if (!aq)
    return semDado(
      titulo,
      m.unidade,
      "fonte_indisponivel",
      c.empresa.aquisicaoAviso ?? "Aquisição não carregada.",
      fonte,
      "serie",
    );
  const meses = mesesDoPeriodo(a.filtros?.periodo, e.hoje, 6);
  const porMes = new Map(aq.meses.map((x) => [x.mes, x]));
  const pontos = meses.map((mes) => {
    const x = porMes.get(mes);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const real = x ? ((x as any)[m.campo] as number | null) : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plano = x?.plano && m.plano ? ((x.plano as any)[m.plano] as number | null) : null;
    return { x: mes, valores: { realizado: real, plano } };
  });
  const semPlano = m.plano ? meses.filter((mes) => !porMes.get(mes)?.plano) : [];
  const avisos = [
    ...(semPlano.length
      ? [
          `${semPlano.map(mesBr).join(", ")} sem plano cadastrado no Growth (não é 0% de atingimento).`,
        ]
      : []),
    ...(a.metrica === "custo_midia_por_venda"
      ? [
          "É investimento em mídia sobre vendas, sem salário, ferramenta nem comissão: não é o CAC completo.",
        ]
      : []),
    "MRR vendido é valor mensal contratado no CRM, não faturamento.",
  ];
  const ult = pontos.at(-1)?.valores;
  const destaques: Destaque[] = [];
  if (ult?.realizado != null && ult.plano != null) {
    destaques.push({
      rotulo: `Atingimento do plano em ${mesBr(meses.at(-1)!)} (%)`,
      valor: Math.round((ult.realizado / ult.plano) * 1000) / 10,
      unidade: "percentual",
    });
    destaques.push({
      rotulo: `Diferença para o plano em ${mesBr(meses.at(-1)!)}`,
      valor: Math.round((ult.realizado - ult.plano) * 100) / 100,
      unidade: m.unidade,
    });
  }
  const reais = pontos.map((p) => p.valores.realizado).filter((v): v is number => v !== null);
  if (reais.length === pontos.length && reais.length)
    destaques.push({ rotulo: "Soma do período", valor: soma(reais), unidade: m.unidade });
  if (aq.forecast && a.metrica !== "leads") {
    destaques.push({
      rotulo: `Mês corrente (${mesBr(aq.forecast.mes)}): MRR realizado até hoje`,
      valor: aq.forecast.realizado,
      unidade: "reais",
    });
    destaques.push({
      rotulo: `Mês corrente: projeção pelo ritmo (modelo do Growth)`,
      valor: aq.forecast.porRitmo,
      unidade: "reais",
    });
    destaques.push({
      rotulo: `Mês corrente: meta de MRR novo`,
      valor: aq.forecast.meta,
      unidade: "reais",
    });
  }
  return {
    titulo,
    unidade: m.unidade,
    estado: pontos.every((p) => p.valores.realizado === null) ? "nao_apurado" : "disponivel",
    fonte,
    atualizadoEm: null,
    filtrosAplicados: [
      meses.length === 1 ? mesBr(meses[0]) : `${mesBr(meses[0])} a ${mesBr(meses.at(-1)!)}`,
      "pipe Inside Sales",
      "meses fechados",
    ],
    avisos,
    destino: {
      rota: "/cockpit-ceo",
      search: { frente: "comercial" },
      rotulo: "Abrir Aquisição e conversão",
      mesmoRecorte: true,
      observacao: "",
    },
    destaques,
    dados: {
      forma: "serie",
      pontos,
      series: [
        { chave: "realizado", rotulo: "Realizado", tipo: "realizado" },
        ...(m.plano ? [{ chave: "plano", rotulo: "Plano", tipo: "meta" as const }] : []),
      ],
    },
  };
}

const ArgsFunil = z
  .object({
    mes: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  })
  .strict();

function consultaFunilAquisicao(e: EntradaConsulta, a: z.infer<typeof ArgsFunil>): SemId {
  const titulo = "Funil de aquisição do Inside Sales";
  const c = e.cockpit();
  const aq = c.empresa.aquisicao;
  const fonte = "Growth · growth.serie_mensal";
  if (!aq)
    return semDado(
      titulo,
      "negócios",
      "fonte_indisponivel",
      c.empresa.aquisicaoAviso ?? "Aquisição não carregada.",
      fonte,
      "funil",
    );
  const mes = a.mes ?? somaMeses(e.hoje.slice(0, 7), -1);
  const x = aq.meses.find((m) => m.mes === mes);
  if (!x)
    return semDado(
      titulo,
      "negócios",
      "nao_apurado",
      `Sem série do Growth para ${mesBr(mes)}.`,
      fonte,
      "funil",
    );
  const taxa = (a: number | null, b: number | null) =>
    a === null || b === null || b === 0 ? null : Math.round((a / b) * 1000) / 10;
  return {
    titulo: `${titulo} em ${mesBr(mes)}`,
    unidade: "negócios",
    estado: x.emAndamento ? "parcial" : "disponivel",
    fonte,
    atualizadoEm: null,
    filtrosAplicados: [mesBr(mes), "pipe Inside Sales"],
    avisos: x.emAndamento
      ? ["Mês em andamento: realizado até hoje, não comparável a mês inteiro."]
      : [],
    destino: {
      rota: "/cockpit-ceo",
      search: { frente: "comercial" },
      rotulo: "Abrir Aquisição e conversão",
      mesmoRecorte: true,
      observacao: "",
    },
    destaques: [
      { rotulo: "Leads → MQL (%)", valor: taxa(x.mql, x.leads), unidade: "percentual" },
      { rotulo: "MQL → venda (%)", valor: taxa(x.vendas, x.mql), unidade: "percentual" },
      { rotulo: "MRR novo vendido", valor: x.mrrNovo, unidade: "reais" },
    ],
    dados: {
      forma: "funil",
      etapas: [
        { rotulo: "Leads", valor: x.leads },
        { rotulo: "MQL", valor: x.mql },
        { rotulo: "Vendas", valor: x.vendas },
      ],
    },
  };
}

const ArgsVazio = z.object({}).strict();

function consultaOnboarding(e: EntradaConsulta): SemId {
  const titulo = "Onboarding por fase";
  const c = e.cockpit();
  const o = c.empresa.onboarding;
  const fonte = "Ops · pipe de Onboarding (Pipefy espelhado a cada 15 min)";
  if (!o)
    return semDado(
      titulo,
      "clientes",
      "fonte_indisponivel",
      c.empresa.onboardingAviso ?? "Onboarding não carregado.",
      fonte,
      "categorias",
    );
  return {
    titulo,
    unidade: "clientes",
    estado: "disponivel",
    fonte,
    atualizadoEm: null,
    filtrosAplicados: ["fotografia de agora", "rede inteira"],
    avisos: [
      "30 e 60 dias são faixas de leitura, não prazo: nenhum SLA de onboarding foi decidido.",
    ],
    destino: {
      rota: "/painel-cs",
      search: {},
      rotulo: "Abrir Painel de CS (Onboarding)",
      mesmoRecorte: false,
      observacao: "",
    },
    destaques: [
      { rotulo: "Em onboarding", valor: o.emCurso, unidade: "clientes" },
      { rotulo: "Há mais de 30 dias na mesma fase", valor: o.parados30, unidade: "clientes" },
      { rotulo: "Há mais de 60 dias na mesma fase", valor: o.parados60, unidade: "clientes" },
      { rotulo: "Concluídos", valor: o.concluidos, unidade: "clientes" },
      {
        rotulo: "Mediana do card à conclusão (dias)",
        valor: o.criacaoAteConclusao.mediana,
        unidade: "dias",
      },
    ],
    dados: {
      forma: "categorias",
      itens: o.fases
        .filter((f) => f.cards > 0)
        .map((f) => ({
          rotulo: f.fase,
          valor: f.cards,
          detalhe: `${f.acima30} há mais de 30 dias`,
        })),
      total: o.fases.reduce((n, f) => n + f.cards, 0),
      somaFecha: true,
    },
  };
}

function consultaCadeia(e: EntradaConsulta): SemId {
  const titulo = "Da venda ao recebimento (mesma safra)";
  const c = e.cockpit();
  const k = c.empresa.cadeia;
  const fonte = "CRM (contratos) · Ops (onboarding) · contas a receber das unidades · Financeiro";
  if (!k)
    return semDado(
      titulo,
      "negócios",
      "fonte_indisponivel",
      c.empresa.cadeiaAviso ?? "Cadeia não carregada.",
      fonte,
      "funil",
    );
  const avisos = [
    ...(k.semCnpj
      ? [`${k.semCnpj} contratos sem CNPJ não podem ser seguidos até o faturamento.`]
      : []),
    ...(k.faturadas === null
      ? ["Uma das fontes de faturamento não foi lida: o total faturado fica sem número."]
      : []),
    ...(c.empresa.cadeiaFaturamentoAviso ? [c.empresa.cadeiaFaturamentoAviso] : []),
  ];
  return {
    titulo,
    unidade: "negócios",
    estado: avisos.length ? "parcial" : "disponivel",
    fonte,
    atualizadoEm: null,
    filtrosAplicados: [
      k.safra.de && k.safra.ate ? `ganhos de ${k.safra.de} a ${k.safra.ate}` : "safra disponível",
    ],
    avisos,
    destino: {
      rota: "/cockpit-ceo",
      search: { frente: "operacao" },
      rotulo: "Abrir Operação e capacidade",
      mesmoRecorte: true,
      observacao: "",
    },
    destaques: [
      { rotulo: "Contratos sem CNPJ", valor: k.semCnpj, unidade: "negócios" },
      { rotulo: "Saídas", valor: k.saidas, unidade: "negócios" },
    ],
    dados: {
      forma: "funil",
      etapas: [
        { rotulo: "Vendas ganhas", valor: k.vendas },
        { rotulo: "Onboarding iniciado", valor: k.ativacaoIniciada },
        { rotulo: "Onboarding concluído", valor: k.ativacaoConcluida },
        { rotulo: "Faturadas", valor: k.faturadas },
        { rotulo: "Pagas (na unidade)", valor: k.recebidasNaUnidade },
      ],
    },
  };
}

const ArgsCaixa = z
  .object({ metrica: z.enum(["emitido_recebido", "inadimplencia", "margem_grupos"]) })
  .strict();

function consultaCaixa(e: EntradaConsulta, a: z.infer<typeof ArgsCaixa>): SemId {
  const c = e.cockpit();
  const cx = c.empresa.caixa;
  const fonte = "Financeiro · funções oficiais de caixa, inadimplência e indicadores";
  const titulos = {
    emitido_recebido: "Emitido × recebido por mês de emissão",
    inadimplencia: "Vencido e não recebido por faixa de atraso",
    margem_grupos: "Margem bruta por grupo de apuração",
  };
  const titulo = titulos[a.metrica];
  if (!cx)
    return semDado(
      titulo,
      "reais",
      "fonte_indisponivel",
      c.empresa.caixaAviso ?? "Caixa não carregado.",
      fonte,
      a.metrica === "emitido_recebido" ? "serie" : "categorias",
    );
  const destino: Destino = {
    rota: "/cockpit-ceo",
    search: { frente: "caixa" },
    rotulo: "Abrir Caixa e margem",
    mesmoRecorte: true,
    observacao: "",
  };
  if (a.metrica === "emitido_recebido") {
    const er = cx.emitidoRecebido;
    if (!er)
      return semDado(
        titulo,
        "reais",
        "fonte_indisponivel",
        "Emitido × recebido não respondeu.",
        fonte,
        "serie",
      );
    return {
      titulo,
      unidade: "reais",
      estado: "disponivel",
      fonte,
      atualizadoEm: null,
      filtrosAplicados: [`${cx.janela.de} a ${cx.janela.ate}`, "grupo inteiro"],
      avisos: [
        er.foto
          ? `Recebido acumulado até a foto de títulos de ${mesBr(er.foto)}; meses depois dela ficam sem recebido medido.`
          : "Sem foto de títulos: recebido não medido.",
      ],
      destino,
      destaques: [],
      dados: {
        forma: "serie",
        pontos: er.meses.map((m) => ({
          x: m.mes,
          valores: { emitido: m.emitido, recebido: m.leitura === "sem_foto" ? null : m.recebido },
        })),
        series: [
          { chave: "emitido", rotulo: "Emitido" },
          { chave: "recebido", rotulo: "Recebido" },
        ],
      },
    };
  }
  if (a.metrica === "inadimplencia") {
    const ina = cx.inadimplencia;
    if (!ina)
      return semDado(
        titulo,
        "reais",
        "fonte_indisponivel",
        "Inadimplência não respondeu.",
        fonte,
        "categorias",
      );
    return {
      titulo,
      unidade: "reais",
      estado: ina.empresasSemSync.length ? "parcial" : "disponivel",
      fonte,
      atualizadoEm: ina.sincronizadoEm,
      filtrosAplicados: ["fotografia de agora", "grupo inteiro"],
      avisos: ina.empresasSemSync.length
        ? [`Sem sincronização de títulos: ${ina.empresasSemSync.join(", ")}.`]
        : [],
      destino,
      destaques: [
        { rotulo: "Vencido e não recebido", valor: ina.atrasado, unidade: "reais" },
        { rotulo: "Total em aberto", valor: ina.emAberto, unidade: "reais" },
        { rotulo: "Títulos vencidos", valor: ina.titulosAtrasados, unidade: "contas" },
      ],
      dados: {
        forma: "categorias",
        itens: ina.faixas.map((f) => ({
          rotulo: f.faixa,
          valor: f.valor,
          detalhe: `${f.titulos} títulos`,
        })),
        total: ina.atrasado,
        somaFecha: true,
      },
    };
  }
  const ind = cx.indicadores;
  if (!ind)
    return semDado(
      titulo,
      "percentual",
      "fonte_indisponivel",
      "Indicadores não responderam.",
      fonte,
      "categorias",
    );
  return {
    titulo,
    unidade: "percentual",
    estado: "disponivel",
    fonte,
    atualizadoEm: null,
    filtrosAplicados: [`${ind.de ?? "?"} a ${ind.ate ?? "?"}`, "meses fechados do ano"],
    avisos: [],
    destino,
    destaques: [
      {
        rotulo: "Margem bruta do grupo (%)",
        valor: ind.margem === null ? null : Math.round(ind.margem * 1000) / 10,
        unidade: "percentual",
      },
      { rotulo: "Receita bruta do grupo", valor: ind.receitaBruta, unidade: "reais" },
    ],
    dados: {
      forma: "categorias",
      itens: ind.porGrupo.map((g) => ({
        rotulo: g.grupo,
        valor: g.receitaBruta ? Math.round((g.lucroBruto / g.receitaBruta) * 1000) / 10 : null,
        detalhe: `receita bruta ${g.receitaBruta.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      })),
      total: null,
      somaFecha: false,
    },
  };
}

function consultaCoortes(e: EntradaConsulta): SemId {
  const titulo = "Retenção por mês de ganho (coortes)";
  const c = e.cockpit();
  const k = c.coortes;
  const fonte = "Contratos (ganho de venda) × churn datado da Central de Tratativas";
  if (!k || !temNumero(k.estado))
    return semDado(
      titulo,
      "percentual",
      k?.estado ?? "fonte_indisponivel",
      c.coortesAviso ?? "Coortes não carregadas.",
      fonte,
      "coorte",
    );
  const linhas = k.linhas.filter((l) => !l.antesDoRegistro && l.denominador > 0);
  return {
    titulo,
    unidade: "percentual",
    estado: k.estado,
    fonte,
    atualizadoEm: null,
    filtrosAplicados: ["rede inteira", "origem Inside Sales"],
    avisos: k.avisos.slice(0, 2),
    destino: {
      rota: "/cockpit-ceo",
      search: { frente: "retencao" },
      rotulo: "Abrir Retenção e expansão",
      mesmoRecorte: true,
      observacao: "",
    },
    destaques: [],
    dados: {
      forma: "coorte",
      colunas: Array.from({ length: k.horizonte + 1 }, (_, i) => `M${i}`),
      linhas: linhas.map((l) => ({
        coorte: l.mes,
        base: l.denominador,
        valores: l.retidos.map((r) =>
          r === null ? null : Math.round((r / l.denominador) * 1000) / 10,
        ),
      })),
    },
  };
}

function consultaClientes(e: EntradaConsulta): SemId {
  const titulo = "Clientes ativos por régua";
  const c = e.cockpit();
  const k = c.clientes;
  const fonte = "Omie (contratos, recebimentos), cadastro de clientes e MRR do Brain";
  if (!k)
    return semDado(
      titulo,
      "clientes",
      "fonte_indisponivel",
      c.clientesAviso ?? "Réguas não carregadas.",
      fonte,
      "categorias",
    );
  return {
    titulo,
    unidade: "clientes",
    estado: "parcial",
    fonte,
    atualizadoEm: null,
    filtrosAplicados: ["rede inteira", "CNPJs distintos"],
    avisos: [
      "Cada régua é uma definição diferente de cliente ativo, e nenhuma foi escolhida como oficial (decisão pendente do CEO): não some as barras.",
    ],
    destino: {
      rota: "/cockpit-ceo",
      search: { frente: "clientes" },
      rotulo: "Abrir Clientes",
      mesmoRecorte: true,
      observacao: "",
    },
    destaques: [
      { rotulo: "Em pelo menos uma régua", valor: k.uniao, unidade: "clientes" },
      { rotulo: "Em todas as réguas", valor: k.emTodas, unidade: "clientes" },
    ],
    dados: {
      forma: "categorias",
      itens: k.definicoes.map((d) => ({
        rotulo: d.titulo,
        valor: temNumero(d.estado) ? d.cnpjs : null,
        detalhe: d.definicao,
      })),
      total: null,
      somaFecha: false,
    },
  };
}

const ArgsPortfolio = z
  .object({
    filtros: FiltrosSchema.pick({ periodo: true, unidades: true, produto: true })
      .strict()
      .optional(),
    metrica: z.enum(["ganhos", "validadas", "trabalhados", "receita_prevista", "contas_prontas"]),
  })
  .strict();

function consultaPortfolio(e: EntradaConsulta, a: z.infer<typeof ArgsPortfolio>): SemId {
  const rotulos = {
    ganhos: ["Contratos ganhos por produto", "negócios"],
    validadas: ["Oportunidades validadas por produto", "negócios"],
    trabalhados: ["Leads trabalhados por produto", "negócios"],
    receita_prevista: ["Receita prevista em oportunidades abertas", "reais"],
    contas_prontas: ["Contas prontas para trabalhar por produto", "contas"],
  } as const;
  const [titulo, unidade] = rotulos[a.metrica];
  const c = e.cockpit(a.filtros);
  const fonte = "Monetização (CRM) e Base de clientes";
  if (!e.fonte.acessoBase && !e.fonte.acessoNegocios)
    return semDado(
      titulo,
      unidade,
      "acesso_insuficiente",
      "Seu acesso não inclui Base de clientes nem Monetização.",
      fonte,
      "categorias",
    );
  if (e.fonte.monetizacao.estado !== "ok")
    return semDado(
      titulo,
      unidade,
      "fonte_indisponivel",
      e.fonte.monetizacao.erro ?? "A carga da Monetização falhou.",
      fonte,
      "categorias",
    );
  const campo = {
    ganhos: "ganhos",
    validadas: "validadas",
    trabalhados: "trabalhados",
    receita_prevista: "receitaPrevista",
    contas_prontas: "contasProntas",
  } as const;
  const linhas = c.porProduto.filter(
    (l) => l.produto !== "sem_produto" && (!a.filtros?.produto || l.produto === a.filtros.produto),
  );
  const itens = linhas.map((l) => ({
    rotulo: NOMES[l.produto],
    valor: l[campo[a.metrica]] as number | null,
  }));
  const conhecidos = itens.filter((i) => i.valor !== null).map((i) => i.valor!);
  return {
    titulo,
    unidade,
    estado: itens.some((i) => i.valor === null) ? "parcial" : "disponivel",
    fonte,
    atualizadoEm: null,
    filtrosAplicados: [
      c.perimetroRotulo,
      ...(a.filtros?.produto ? [ROTULO_PRODUTO[a.filtros.produto]] : PRODUTOS.map((p) => NOMES[p])),
    ],
    avisos:
      a.metrica === "receita_prevista"
        ? ["Valor declarado pelo comercial no CRM: não é faturamento nem recebimento."]
        : [],
    destino: {
      rota: "/cockpit-ceo",
      search: { frente: "portfolio" },
      rotulo: "Abrir Portfólio e monetização",
      mesmoRecorte: true,
      observacao: "",
    },
    destaques: [
      {
        rotulo: "Total dos produtos",
        valor: conhecidos.length === itens.length ? soma(conhecidos) : null,
        unidade,
      },
    ],
    dados: {
      forma: "categorias",
      itens,
      total: conhecidos.length === itens.length ? soma(conhecidos) : null,
      somaFecha: conhecidos.length === itens.length,
    },
  };
}

const ORDEM_GRAVIDADE = { alta: 0, media: 1 } as const;

/** Exceções (regras fixas de ameaça) e decisões do CEO, com dono e destino. */
function consultaAcoes(e: EntradaConsulta): SemId {
  const c = e.cockpit();
  const ameacas = [...c.ameacas].sort(
    (a, b) =>
      ORDEM_GRAVIDADE[a.gravidade] - ORDEM_GRAVIDADE[b.gravidade] ||
      Number(a.origem === "monetizacao") - Number(b.origem === "monetizacao"),
  );
  const destinoDe = (id: string | null) =>
    id ? (c.indicadores.find((i) => i.id === id)?.destino ?? null) : null;
  return {
    titulo: "O que pede atenção",
    unidade: "eventos",
    estado: "disponivel",
    fonte: "Regras fixas do cockpit sobre os números carregados (não é IA)",
    atualizadoEm: null,
    filtrosAplicados: [c.perimetroRotulo],
    avisos: [],
    destino: {
      rota: "/cockpit-ceo",
      search: {},
      rotulo: "Abrir Visão executiva",
      mesmoRecorte: true,
      observacao: "",
    },
    destaques: [],
    dados: {
      forma: "acoes",
      itens: [
        ...ameacas.slice(0, 5).map((a) => ({
          titulo: a.titulo,
          detalhe: a.detalhe,
          gravidade: a.gravidade,
          responsavel: donoDaAmeaca(a),
          destino: destinoDe(a.indicador),
        })),
        ...c.decisoes.map((d) => ({
          titulo: d.titulo,
          detalhe: d.porque,
          gravidade: "decisao" as const,
          responsavel: d.responsavel,
          destino: d.destino,
        })),
      ],
    },
  };
}

function consultaFrescor(e: EntradaConsulta): SemId {
  const c = e.cockpit();
  return {
    titulo: "Atualização das fontes",
    unidade: "dias",
    estado: "disponivel",
    fonte: "Frescor declarado por cada fonte",
    atualizadoEm: null,
    filtrosAplicados: [],
    avisos: [],
    destino: {
      rota: "/cockpit-ceo",
      search: { frente: "capital" },
      rotulo: "Abrir Evidências e capital",
      mesmoRecorte: true,
      observacao: "",
    },
    destaques: [],
    dados: {
      forma: "tabela",
      colunas: [
        { chave: "fonte", rotulo: "Fonte" },
        { chave: "atualizado", rotulo: "Atualizada em" },
        { chave: "situacao", rotulo: "Situação" },
      ],
      linhas: c.empresa.frescor.map((f) => ({
        fonte: f.fonte,
        atualizado: f.atualizadoEm,
        situacao: f.estado === "em_dia" ? "Em dia" : f.estado === "parada" ? "Parada" : "Sem data",
      })),
    },
  };
}

// ── Catálogo ─────────────────────────────────────────────────────────────────

export type Dominio =
  | "receita"
  | "aquisicao"
  | "operacao"
  | "caixa"
  | "unidades"
  | "clientes"
  | "retencao"
  | "portfolio";

interface DefConsulta<S extends z.ZodTypeAny> {
  descricao: string;
  args: S;
  dominios: Dominio[];
  executar: (e: EntradaConsulta, a: z.infer<S>) => SemId;
}
const def = <S extends z.ZodTypeAny>(d: DefConsulta<S>) => d;

export const CONSULTAS = {
  indicador: def({
    descricao:
      "Um número do cockpit com comparação e composição. Ids: faturamento-mes (faturamento do último mês fechado do grupo), faturamento-saiu, mrr-vendido, vencido-em-aberto, onboarding-parado, contratos-ganhos, oportunidades-validadas, leads-trabalhados, receita-prevista-aberta, contas-prontas, meta-bilhao.",
    args: ArgsIndicador,
    dominios: ["receita", "aquisicao", "operacao", "caixa", "portfolio"],
    executar: consultaIndicador,
  }),
  serie_faturamento: def({
    descricao:
      "Faturamento por mês fechado. leitura 'grupo' = Financeiro do grupo (padrão); 'rede' = apuração das unidades, aceita unidades (até 8) e base nova/antiga. Nunca some grupo com rede.",
    args: ArgsSerie,
    dominios: ["receita", "unidades"],
    executar: consultaSerieFaturamento,
  }),
  ponte_faturamento: def({
    descricao:
      "De onde veio a variação do faturamento do grupo num mês fechado: novos, retornos, expansão, contração, saídas.",
    args: ArgsPonte,
    dominios: ["receita", "retencao"],
    executar: consultaPonte,
  }),
  variacao_por_chave: def({
    descricao:
      "Quais unidades (rede) ou empresas (grupo) mais explicam a variação de um mês fechado contra o anterior.",
    args: ArgsVariacao,
    dominios: ["receita", "unidades"],
    executar: consultaVariacao,
  }),
  ranking_unidades: def({
    descricao:
      "Unidades da rede ordenadas por faturamento (ou royalties + CSC) nos meses fechados do período; aceita base nova/antiga e lista de unidades.",
    args: ArgsRanking,
    dominios: ["unidades", "receita"],
    executar: consultaRanking,
  }),
  aquisicao_mensal: def({
    descricao:
      "Aquisição do Inside Sales por mês: realizado × plano (mrr_novo, vendas, mql, leads, investimento, custo_midia_por_venda) e projeção do mês corrente.",
    args: ArgsAquisicao,
    dominios: ["aquisicao"],
    executar: consultaAquisicao,
  }),
  funil_aquisicao: def({
    descricao: "Funil leads → MQL → vendas do Inside Sales num mês.",
    args: ArgsFunil,
    dominios: ["aquisicao"],
    executar: consultaFunilAquisicao,
  }),
  onboarding: def({
    descricao:
      "Clientes em onboarding por fase, parados há mais de 30/60 dias e tempo até concluir.",
    args: ArgsVazio,
    dominios: ["operacao"],
    executar: consultaOnboarding,
  }),
  cadeia_venda_recebimento: def({
    descricao:
      "A mesma safra de vendas até onboarding, faturamento e pagamento: onde trava entre venda e ativação.",
    args: ArgsVazio,
    dominios: ["operacao", "receita"],
    executar: consultaCadeia,
  }),
  caixa: def({
    descricao:
      "Caixa do grupo: emitido × recebido por mês, vencido por faixa de atraso, margem bruta por grupo.",
    args: ArgsCaixa,
    dominios: ["caixa"],
    executar: consultaCaixa,
  }),
  coortes: def({
    descricao: "Retenção de contratos por mês de ganho (coortes).",
    args: ArgsVazio,
    dominios: ["retencao", "clientes"],
    executar: consultaCoortes,
  }),
  clientes_ativos: def({
    descricao: "Clientes ativos por cada régua candidata (não há régua oficial).",
    args: ArgsVazio,
    dominios: ["clientes"],
    executar: consultaClientes,
  }),
  portfolio: def({
    descricao:
      "Monetização por produto (Consultoria, Finance, Cella): ganhos, validadas, trabalhados, receita prevista, contas prontas.",
    args: ArgsPortfolio,
    dominios: ["portfolio", "aquisicao"],
    executar: consultaPortfolio,
  }),
  acoes: def({
    descricao:
      "Exceções que pedem atenção (regras fixas) e decisões do CEO, com responsável e destino.",
    args: ArgsVazio,
    dominios: [
      "receita",
      "aquisicao",
      "operacao",
      "caixa",
      "unidades",
      "clientes",
      "retencao",
      "portfolio",
    ],
    executar: consultaAcoes,
  }),
  frescor: def({
    descricao: "Quando cada fonte foi atualizada e se está parada.",
    args: ArgsVazio,
    dominios: [
      "receita",
      "aquisicao",
      "operacao",
      "caixa",
      "unidades",
      "clientes",
      "retencao",
      "portfolio",
    ],
    executar: consultaFrescor,
  }),
};
export type NomeConsulta = keyof typeof CONSULTAS;
export const NOMES_CONSULTAS = Object.keys(CONSULTAS) as NomeConsulta[];

export class ConsultaRecusada extends Error {}

/**
 * Executa uma consulta do catálogo com argumentos validados. Nome fora do catálogo ou argumento
 * fora do schema é recusado antes de ler qualquer coisa.
 */
export function executarConsulta(
  e: EntradaConsulta,
  nome: string,
  args: unknown,
  id: string,
): Resultado {
  if (!(nome in CONSULTAS)) throw new ConsultaRecusada(`Consulta fora do catálogo: ${nome}.`);
  const d = CONSULTAS[nome as NomeConsulta];
  const lido = d.args.safeParse(args ?? {});
  if (!lido.success)
    throw new ConsultaRecusada(
      `Argumentos inválidos para ${nome}: ${lido.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}.`,
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (d.executar as any)(e, lido.data) as SemId;
  return {
    id,
    consulta: nome,
    args: lido.data as Record<string, unknown>,
    versaoRegra: VERSAO_CATALOGO,
    ...r,
  };
}
