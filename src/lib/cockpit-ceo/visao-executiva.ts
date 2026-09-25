// A primeira leitura do Cockpit do CEO (revisão de 24/09/2026): resultado, tendência, o que mudou e
// o que pede ação, em dez segundos. Função pura sobre o `Cockpit` já montado: nenhuma regra nova,
// só escolha e ordem do que aparece primeiro.
//
// Regras desta leitura:
// - quatro números, escolhidos por importância e qualidade da evidência; nenhum cartão vazio: número
//   sem dado sai da grade e vira aviso curto com o último período confiável (sem acesso continua
//   visível como "sem acesso", porque esconder mentiria sobre a cobertura);
// - um gráfico principal (faturamento do grupo, meses fechados) cujo último mês é o mesmo número do
//   cartão e o mesmo total da ponte: `conciliado` diz se os três batem ao centavo;
// - até três exceções, cada uma com impacto, responsável e destino;
// - decisões com alternativas e efeito tirados dos próprios dados, nunca inventados.
import type { Cockpit } from "./indicadores.ts";
import type { Destino, Indicador } from "./contrato.ts";
import { MEDIA_MENSAL_NECESSARIA, mesBr } from "./receita.ts";
import { donoDaAmeaca } from "./donos.ts";
import { DIAS_FONTE_PARADA } from "./empresa.ts";
import type { LinhaFrescor } from "./empresa.ts";

export const IDS_PRIMEIRA_LEITURA = [
  "faturamento-mes",
  "mrr-vendido",
  "vencido-em-aberto",
  "onboarding-parado",
] as const;

const COM_NUMERO = new Set(["disponivel", "parcial"]);
const cent = (v: number) => Math.round(v * 100);
const mi = (v: number) => `R$ ${(v / 1e6).toFixed(2).replace(".", ",")} mi`;

/**
 * Rótulo curto da primeira leitura (uma linha num card de notebook). O título completo, com a
 * régua, continua na composição que o clique abre.
 */
export const ROTULO_CURTO: Record<string, (i: Indicador) => string> = {
  "faturamento-mes": (i) =>
    i.periodo ? `Faturamento ${mesBr(i.periodo.de.slice(0, 7))}` : "Faturamento",
  "mrr-vendido": () => "MRR novo vendido",
  "vencido-em-aberto": () => "Vencido a receber",
  "onboarding-parado": () => "Onboarding parado +30d",
};

export interface CartaoExecutivo {
  indicador: Indicador;
  rotulo: string;
  /** Nome curto da fonte, sem tabela nem função (a composição tem o resto). */
  fonteCurta: string;
  tendencia: { valores: (number | null)[]; rotulo: string } | null;
}

export interface Ausente {
  id: string;
  titulo: string;
  motivo: string;
  ultimoConfiavel: string | null;
}

export interface GraficoPrincipal {
  meses: { mes: string; valor: number }[];
  ultimo: { mes: string; valor: number } | null;
  ponte: { mes: string; anterior: number; atual: number; entrou: number; saiu: number } | null;
  /** Cartão, última barra e total da ponte são o mesmo número (centavos). */
  conciliado: boolean;
}

export interface Excecao {
  id: string;
  titulo: string;
  impacto: string;
  responsavel: string;
  gravidade: "alta" | "media";
  indicador: string | null;
  destino: Destino | null;
}

export interface DecisaoExecutiva {
  id: string;
  titulo: string;
  porque: string;
  responsavel: string;
  destino: Destino | null;
  alternativas: string[];
  efeito: string | null;
}

export interface SaudeDados {
  total: number;
  emDia: number;
  paradas: LinhaFrescor[];
  linhas: LinhaFrescor[];
}

export interface LeituraExecutiva {
  cartoes: CartaoExecutivo[];
  ausentes: Ausente[];
  grafico: GraficoPrincipal | null;
  excecoes: Excecao[];
  decisoes: DecisaoExecutiva[];
  saude: SaudeDados;
}

const fonteCurta = (fonte: string) =>
  fonte.split(" · ")[0].replace("Financial Brain", "Financeiro");

const ORDEM = { alta: 0, media: 1 } as const;

export function montarLeituraExecutiva(c: Cockpit): LeituraExecutiva {
  const grupo = c.trajetoria?.find((t) => t.id === "grupo") ?? null;
  const fechadosGrupo = grupo ? grupo.serie.filter((s) => !s.parcial) : [];

  // ── Gráfico principal ─────────────────────────────────────────────────
  const fat = c.indicadores.find((i) => i.id === "faturamento-mes");
  const mesFat = fat?.periodo?.de.slice(0, 7) ?? null;
  const ultimaPonte = c.empresa.ponte?.ultimo ?? null;
  let grafico: GraficoPrincipal | null = null;
  if (fechadosGrupo.length) {
    const ate = mesFat ?? fechadosGrupo[fechadosGrupo.length - 1].mes;
    const meses = fechadosGrupo
      .filter((s) => s.mes <= ate)
      .slice(-12)
      .map((s) => ({ mes: s.mes, valor: s.valor }));
    const ultimo = meses[meses.length - 1] ?? null;
    const ponte =
      ultimaPonte && ultimaPonte.fecha
        ? {
            mes: ultimaPonte.mes,
            anterior: ultimaPonte.anterior,
            atual: ultimaPonte.atual,
            entrou:
              ultimaPonte.novos.valor + ultimaPonte.retornos.valor + ultimaPonte.expansao.valor,
            saiu: ultimaPonte.contracao.valor + ultimaPonte.semFaturamento.valor,
          }
        : null;
    const conciliado =
      !!ultimo &&
      !!ponte &&
      fat?.valor != null &&
      ponte.mes === ultimo.mes &&
      cent(ponte.atual) === cent(ultimo.valor) &&
      cent(fat.valor) === cent(ultimo.valor);
    grafico = { meses, ultimo, ponte, conciliado };
  }

  // ── Cartões ───────────────────────────────────────────────────────────
  const cartoes: CartaoExecutivo[] = [];
  const ausentes: Ausente[] = [];
  const aq = c.empresa.aquisicao;
  for (const id of IDS_PRIMEIRA_LEITURA) {
    const i = c.indicadores.find((x) => x.id === id);
    if (!i) continue;
    const semNumero =
      !COM_NUMERO.has(i.estado) || (i.valor === null && i.estado !== "acesso_insuficiente");
    if (semNumero && i.estado !== "acesso_insuficiente") {
      ausentes.push({
        id,
        titulo: i.titulo,
        motivo: i.lacuna?.oQueFalta ?? "a fonte não respondeu",
        ultimoConfiavel:
          id === "faturamento-mes" && grupo?.fechados ? mesBr(grupo.fechados.ate) : null,
      });
      continue;
    }
    let tendencia: CartaoExecutivo["tendencia"] = null;
    if (id === "faturamento-mes" && grafico && grafico.meses.length >= 3)
      tendencia = {
        valores: grafico.meses.map((m) => m.valor),
        rotulo: `Faturamento dos ${grafico.meses.length} meses fechados até ${mesBr(grafico.meses[grafico.meses.length - 1].mes)}`,
      };
    if (id === "mrr-vendido" && aq) {
      const fechados = aq.meses.filter((m) => !m.emAndamento).slice(-6);
      if (fechados.length >= 3)
        tendencia = {
          valores: fechados.map((m) => m.mrrNovo),
          rotulo: `MRR novo dos ${fechados.length} meses fechados até ${mesBr(fechados[fechados.length - 1].mes)}`,
        };
    }
    cartoes.push({
      indicador: i,
      rotulo: ROTULO_CURTO[id]?.(i) ?? i.titulo,
      fonteCurta: fonteCurta(i.fonte),
      tendencia,
    });
  }

  // ── Exceções (regras fixas, as mais graves primeiro) ───────────────────
  const excecoes = [...c.ameacas]
    .sort(
      (a, b) =>
        ORDEM[a.gravidade] - ORDEM[b.gravidade] ||
        Number(a.origem === "monetizacao") - Number(b.origem === "monetizacao"),
    )
    .slice(0, 3)
    .map((a) => ({
      id: a.id,
      titulo: a.titulo,
      impacto: a.detalhe,
      responsavel: donoDaAmeaca(a),
      gravidade: a.gravidade,
      indicador: a.indicador,
      destino: a.indicador
        ? (c.indicadores.find((i) => i.id === a.indicador)?.destino ?? null)
        : null,
    }));

  // ── Decisões com alternativas tiradas dos dados ───────────────────────
  const onboarding = c.empresa.onboarding;
  const decisoes = c.decisoes.slice(0, 3).map((d): DecisaoExecutiva => {
    let alternativas: string[] = [];
    let efeito: string | null = null;
    if (d.id === "perimetro-meta") {
      alternativas = (c.trajetoria ?? [])
        .filter((t) => t.fechados && t.multiploNecessario)
        .map(
          (t) =>
            `${t.titulo}: média de ${mi(t.fechados!.media)}/mês, ${t.multiploNecessario!.toFixed(1).replace(".", ",")}× abaixo de ${mi(MEDIA_MENSAL_NECESSARIA)}/mês`,
        );
      efeito = "A visão passa a mostrar um gap único e o ritmo necessário até 2030.";
    } else if (d.id === "sla-onboarding" && onboarding) {
      alternativas = [
        `Prazo de 30 dias: ${onboarding.parados30} clientes fora hoje`,
        `Prazo de 60 dias: ${onboarding.parados60} clientes fora hoje`,
      ];
      efeito = "A fila de onboarding ganha régua, e o atraso passa a ter dono.";
    } else if (d.id === "cliente-ativo" && c.clientes) {
      alternativas = c.clientes.definicoes
        .filter((x) => x.cnpjs !== null)
        .map((x) => `${x.titulo}: ${x.cnpjs!.toLocaleString("pt-BR")} CNPJs`);
      efeito =
        '"Quantos clientes temos" passa a ter um número só, e a penetração por produto ganha denominador.';
    }
    return { ...d, alternativas, efeito };
  });

  // O selo de saúde soma às fontes declaradas a data de cada número da primeira leitura: um cartão
  // com dado velho (ex.: títulos sincronizados há dias) não pode conviver com "fontes em dia".
  const diasDesde = (iso: string) =>
    Math.floor((Date.parse(`${c.hoje}T12:00:00Z`) - Date.parse(iso)) / 86_400_000);
  const linhas: LinhaFrescor[] = [...c.empresa.frescor];
  for (const k of cartoes) {
    const d = k.indicador.dataDado;
    if (!d || diasDesde(d) <= DIAS_FONTE_PARADA) continue;
    linhas.push({
      fonte: `${k.fonteCurta} · ${k.rotulo}`,
      atualizadoEm: d,
      cobreAte: null,
      estado: "parada",
      nota: `Dado de ${diasDesde(d)} dias atrás; o número aparece como parcial.`,
    });
  }
  const paradas = linhas.filter((l) => l.estado !== "em_dia");
  return {
    cartoes,
    ausentes,
    grafico,
    excecoes,
    decisoes,
    saude: { total: linhas.length, emDia: linhas.length - paradas.length, paradas, linhas },
  };
}
