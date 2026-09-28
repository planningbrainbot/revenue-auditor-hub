// O que a gaveta lateral diz de cada gráfico do Cockpit do CEO (revisão visual de 28/09/2026).
//
// A tela mostra só gráfico, número e título de uma linha; toda explicação mora aqui e aparece no
// clique (NAVEGACAO N2, N3). Cada explicação traz: o que o gráfico diz, como se calcula, fonte,
// data e período, atenção/limite, quem decide ou é dono, a tela que resolve e os dados desenhados.
// Os dados desenhados são também a vista em tabela do gráfico e o contexto que a conversa recebe
// em "Perguntar ao Brain sobre este gráfico".
import type { Destino, Estado, Frente } from "./contrato.ts";
import { FRENTES } from "./contrato.ts";
import type { Cockpit } from "./indicadores.ts";
import { PERGUNTAS } from "./perguntas.ts";
import { ANO_ALVO, mesBr } from "./receita.ts";
import { montarLeituraExecutiva } from "./visao-executiva.ts";
import {
  CHURN_REFERENCIA,
  LIMIAR_ABERTO,
  mesAnterior,
  modeloChurn,
  modeloComposicao,
  modeloEntrega,
  modeloFontes,
  modeloFranqueadora,
  modeloPonte,
  modeloRedeMrr,
  modeloTrajetoria,
} from "./visual.ts";
import type { SemDado } from "./visual.ts";

export interface LinhaDado {
  rotulo: string;
  valor: string;
}

export interface Explicacao {
  id: string;
  titulo: string;
  /** O número principal do bloco, já formatado; null quando o bloco não tem número. */
  valor: string | null;
  estado: Estado;
  oQueDiz: string;
  comoSeCalcula: string;
  fonte: string;
  dataDado: string | null;
  periodo: string;
  atencao: string[];
  dono: string;
  destino: Destino | null;
  dados: LinhaDado[];
}

// ── Formatação (a mesma forma curta dos cartões) ─────────────────────────────

const compacto = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 1,
});
const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
export const reaisCurto = (v: number) =>
  Math.abs(v) >= 100_000
    ? compacto.format(v).replace(/ /g, " ")
    : `R$ ${inteiro.format(Math.round(v))}`;
export const pctTexto = (x: number, casas = 1) =>
  `${(x * 100).toFixed(casas).replace(".", ",")}%`;
export const vezesTexto = (x: number) => `${x.toFixed(1).replace(".", ",")}×`;
const intTexto = (n: number) => inteiro.format(n);

const ehSemDado = (x: object): x is SemDado => "motivo" in x && !("pontos" in x);

// ── Destinos ─────────────────────────────────────────────────────────────────

const destinoFrente = (f: Frente, rotulo?: string): Destino => ({
  rota: "/cockpit-ceo",
  search: { frente: f },
  rotulo: rotulo ?? `Abrir ${FRENTES[f].titulo}`,
  mesmoRecorte: true,
  observacao: "A frente do cockpit mostra o detalhe deste gráfico.",
});
const FINANCEIRO: Destino = {
  rota: "/financeiro",
  search: {},
  externo: true,
  rotulo: "Abrir Faturamento no Brain Financeiro",
  mesmoRecorte: false,
  observacao: "O Financeiro abre por empresa, cliente e categoria; os recortes padrão são os mesmos.",
};
const PAINEL_CS: Destino = {
  rota: "/painel-cs",
  search: {},
  rotulo: "Abrir Painel de CS (Onboarding)",
  mesmoRecorte: false,
  observacao: "O Painel de CS lista os cards por fase; aqui só contagens.",
};
const RECEITA_REPASSES: Destino = {
  rota: "/receita-overview",
  search: {},
  rotulo: "Abrir Receita e Repasses",
  mesmoRecorte: false,
  observacao: "A tela de Receita e Repasses casa cada título com a apuração da unidade.",
};
const CONTRATOS_CHURN: Destino = {
  rota: "/clientes",
  search: { view: "contratos" },
  rotulo: "Abrir Contratos e churn",
  mesmoRecorte: false,
  observacao: "Contratos e churn lista os contratos; nenhuma régua de churn é a oficial.",
};

// ── Visão executiva ──────────────────────────────────────────────────────────

function semNumero(
  base: Omit<Explicacao, "valor" | "estado" | "dados">,
  s: SemDado,
): Explicacao {
  return { ...base, valor: null, estado: s.estado, dados: [], atencao: [s.motivo, ...base.atencao] };
}

function trajetoria(c: Cockpit): Explicacao {
  const m = modeloTrajetoria(c);
  const base = {
    id: "trajetoria",
    titulo: "Trajetória rumo ao bilhão",
    oQueDiz:
      "Onde o faturamento mensal do grupo está hoje e a escada de média mensal que cada ano precisa atingir para chegar a R$ 1 bi por ano em " +
      `${ANO_ALVO}.`,
    comoSeCalcula:
      "Linha: faturamento do grupo por mês de emissão (fn_faturamento_mensal, recortes padrão da tela de Faturamento). Média do ano = média dos meses fechados. Ritmo = (R$ 83,3 mi ÷ média)^(1/anos até 2030). Degrau de cada ano = média × ritmo^n. Distância = meta ÷ média. Eixo em escala logarítmica: a mesma distância vertical é o mesmo multiplicador.",
    fonte: "Brain Financeiro (Financial Brain), faturamento por emissão",
    dataDado: c.empresa.frescor[0]?.atualizadoEm ?? null,
    periodo: "",
    atencao: [
      "D0 pendente: a meta desenhada é faturamento anual; o bilhão também aparece como valuation e como unicórnio.",
      "O mês em curso aparece tracejado e fica fora da média.",
      "Leitura do grupo. A rede de unidades é outra leitura e não se soma (royalties já são receita do grupo).",
    ],
    dono: "CEO (decide o que é o bilhão) · CFO (faturamento)",
    destino: destinoFrente("receita", "Abrir Receita e trajetória"),
  };
  if (ehSemDado(m)) return semNumero({ ...base, periodo: "—" }, m);
  return {
    ...base,
    periodo: `${mesBr(m.pontos[0].mes)} a ${mesBr(m.pontos.at(-1)!.mes)} · média de ${m.mesesNaMedia} meses fechados até ${mesBr(m.ateMes)}`,
    valor: `${reaisCurto(m.media)}/mês`,
    estado: m.estado,
    dados: [
      { rotulo: "Meta", valor: `${reaisCurto(m.meta)}/mês = R$ 1 bi/ano` },
      { rotulo: `Média do grupo em ${m.ano}`, valor: `${reaisCurto(m.media)}/mês` },
      { rotulo: "Distância", valor: vezesTexto(m.distancia) },
      { rotulo: "Ritmo pedido", valor: `${pctTexto(m.ritmoPct, 0)} ao ano` },
      ...m.degraus.slice(1).map((d) => ({
        rotulo: `Degrau ${d.ano}`,
        valor: `${reaisCurto(d.media)}/mês`,
      })),
      ...m.pontos.map((p) => ({
        rotulo: `${mesBr(p.mes)}${p.parcial ? " (parcial)" : ""}`,
        valor: reaisCurto(p.valor),
      })),
    ],
  };
}

function ponte(c: Cockpit): Explicacao {
  const m = modeloPonte(c);
  const base = {
    id: "ponte",
    titulo: "Ponte do último mês fechado",
    oQueDiz:
      "De onde veio a variação do faturamento do grupo entre o mês anterior e o último mês fechado.",
    comoSeCalcula:
      "Cada cliente cai num só movimento: novo ou retorno (faturou só no mês), expansão ou contração (faturou nos dois, mais ou menos), saída (faturou no mês anterior e nada no mês). A soma reconstrói o mês ao centavo; mês que não fecha não é desenhado.",
    fonte: "Brain Financeiro, faturamento por cliente (emissão)",
    dataDado: c.empresa.frescor[0]?.atualizadoEm ?? null,
    periodo: "",
    atencao: [
      "Os níveis são traços e o eixo começa acima de zero: o corte está escrito no gráfico.",
      "Saída é régua de emissão, não churn contratual: cobrança trimestral ou nota atrasada também aparecem aqui.",
      "Unidade nova, monetização e aquisições ainda não têm vínculo de receita por cliente.",
    ],
    dono: "CFO · Departamento de Receitas",
    destino: FINANCEIRO,
  };
  if (ehSemDado(m)) return semNumero({ ...base, periodo: "—" }, m);
  const delta = m.atual - m.anterior;
  return {
    ...base,
    periodo: `${mesBr(mesAnterior(m.mes))} → ${mesBr(m.mes)}`,
    valor: `${delta >= 0 ? "+" : "−"}${reaisCurto(Math.abs(delta))}`,
    estado: "disponivel",
    atencao: [...base.atencao, `Eixo a partir de ${reaisCurto(m.piso)}.`],
    dados: m.degraus.map((d) => ({
      rotulo: d.rotulo,
      valor:
        d.tipo === "nivel"
          ? reaisCurto(d.valor)
          : `${d.valor >= 0 ? "+" : "−"}${reaisCurto(Math.abs(d.valor))}${d.clientes !== null ? ` · ${intTexto(d.clientes)} clientes` : ""}`,
    })),
  };
}

function composicao(c: Cockpit): Explicacao {
  const m = modeloComposicao(c.visual);
  const base = {
    id: "composicao",
    titulo: "Composição da receita",
    oQueDiz:
      "Quanto cada categoria de serviço pesa no faturamento do ano, e quanto dele é recorrente.",
    comoSeCalcula:
      "Receita 1.1 por categoria do de/para da controladoria, nos meses fechados do ano, com os recortes padrão da tela de Faturamento. Recorrente e não recorrente vêm da própria marcação do de/para.",
    fonte: "Brain Financeiro, categorias do de/para",
    dataDado: c.visual?.lidoEm ?? null,
    periodo: "",
    atencao: [
      "Categoria é linha de serviço, não produto nem vertical: ainda falta ligar categoria a produto.",
    ],
    dono: "Controladoria (de/para) · CFO",
    destino: FINANCEIRO,
  };
  if (ehSemDado(m)) return semNumero({ ...base, periodo: "—" }, m);
  return {
    ...base,
    periodo: `${mesBr(m.de)} a ${mesBr(m.ate)}`,
    valor: `${pctTexto(m.total ? m.recorrente / m.total : 0, 0)} recorrente`,
    estado: "disponivel",
    atencao: m.semClassificacao
      ? [...base.atencao, `${reaisCurto(m.semClassificacao)} sem marcação de recorrência na fonte.`]
      : base.atencao,
    dados: [
      { rotulo: "Total", valor: reaisCurto(m.total) },
      { rotulo: "Recorrente", valor: reaisCurto(m.recorrente) },
      { rotulo: "Não recorrente", valor: reaisCurto(m.naoRecorrente) },
      ...m.itens.map((i) => ({
        rotulo: i.categoria,
        valor: `${reaisCurto(i.receita)} · ${pctTexto(i.participacao)}`,
      })),
    ],
  };
}

function churn(c: Cockpit): Explicacao {
  const fs = modeloChurn(c, c.visual);
  const com = fs.filter((f) => f.media !== null);
  const menor = com.length ? Math.min(...com.map((f) => f.media!)) : null;
  const maior = com.length ? Math.max(...com.map((f) => f.media!)) : null;
  return {
    id: "churn",
    titulo: "Churn por fórmula",
    valor: menor !== null ? `${pctTexto(menor)} a ${pctTexto(maior!)}` : null,
    estado: com.length === fs.length ? "disponivel" : com.length ? "parcial" : "nao_apurado",
    oQueDiz:
      "As fórmulas de churn mensal que existem hoje, lado a lado: nenhuma é a oficial, e nenhuma reproduz os 2,34% do mapa de investidores.",
    comoSeCalcula:
      "Ponto = média das taxas mensais; faixa = do mês de menor ao de maior taxa. " +
      fs.map((f) => `${f.rotulo}: ${f.regua}.`).join(" "),
    fonte: [...new Set(fs.map((f) => f.fonte))].join(" · "),
    dataDado: c.visual?.lidoEm ?? null,
    periodo: "Últimos 12 meses fechados (Omie e Tratativas); meses fechados do ano (Financeiro)",
    atencao: [
      `Referência: ${pctTexto(CHURN_REFERENCIA, 2)} ao mês, citado no mapa de investidores; a origem não foi encontrada.`,
      "Omie: o significado do código de encerramento (99) precisa ser confirmado pela controladoria.",
      ...(c.visual?.tratativas.estado === "ok"
        ? [
            `Central de Tratativas: ${intTexto(c.visual.tratativas.comData)} churns têm data${c.visual.tratativas.ultimaData ? `, o último em ${c.visual.tratativas.ultimaData.split("-").reverse().join("/")}` : ""}.`,
          ]
        : []),
      ...fs.filter((f) => f.motivo).map((f) => `${f.rotulo}: ${f.motivo}`),
    ],
    dono: "CEO + Departamento de Receitas (qual régua vale)",
    destino: CONTRATOS_CHURN,
    dados: fs.map((f) => ({
      rotulo: f.rotulo,
      valor:
        f.media === null
          ? "sem número"
          : `média ${pctTexto(f.media)} · ${pctTexto(f.min!.taxa)} (${mesBr(f.min!.mes)}) a ${pctTexto(f.max!.taxa)} (${mesBr(f.max!.mes)})`,
    })),
  };
}

function redeMrr(c: Cockpit): Explicacao {
  const m = modeloRedeMrr(c.visual);
  const base = {
    id: "rede-mrr",
    titulo: "MRR ativo por unidade",
    oQueDiz: "Quanto de receita mensal contratada cada base do Omie das unidades carrega hoje, e quanto a maior concentra.",
    comoSeCalcula:
      "Soma do valor mensal dos contratos de serviço em situação ativa (código 10) e valor maior que zero, por base do Omie. Mesma régua da definição “Contrato de serviço ativo no Omie” da frente Clientes.",
    fonte: "Omie das unidades (contratos de serviço), lido pelo Brain",
    dataDado: null as string | null,
    periodo: "Fotografia de agora",
    atencao: [
      "É MRR contratado, não faturado nem recebido.",
      "Contratos suspensos (código 90) e encerrados (99) ficam fora.",
      "As bases de Curitiba e da matriz aparecem como estão no Omie.",
    ],
    dono: "Unidades · Departamento de Receitas",
    destino: destinoFrente("rede", "Abrir Unidades"),
  };
  if (ehSemDado(m)) return semNumero(base, m);
  return {
    ...base,
    dataDado: m.sincronizadoEm,
    valor: reaisCurto(m.total),
    estado: "disponivel",
    dados: m.unidades.map((u) => ({
      rotulo: u.unidade,
      valor: `${reaisCurto(u.mrr)} · ${pctTexto(u.participacao)} · ${intTexto(u.contratos)} contratos`,
    })),
  };
}

function franqueadora(c: Cockpit): Explicacao {
  const m = modeloFranqueadora(c.visual, c.hoje);
  const base = {
    id: "franqueadora",
    titulo: "Faturado × recebido da franqueadora",
    oQueDiz: "Quanto a franqueadora cobrou em cada mês e quanto já entrou no caixa.",
    comoSeCalcula:
      "Títulos do Omie da Partners por mês de vencimento. Faturado = não cancelados; recebido = pagos; em aberto = atrasado + a vencer. O valor em aberto é escrito na coluna quando passa de " +
      `${reaisCurto(LIMIAR_ABERTO)}.`,
    fonte: "Omie da Partners (contas a receber), lido pelo Brain",
    dataDado: null as string | null,
    periodo: "",
    atencao: [
      "O mês em curso é parcial: ainda tem título a vencer.",
      "Mês sem título aparece hachurado, não como zero.",
    ],
    dono: "Financeiro da franqueadora · Controladoria",
    destino: RECEITA_REPASSES,
  };
  if (ehSemDado(m)) return semNumero({ ...base, periodo: "—" }, m);
  const com = m.meses.filter((x) => !x.semTitulo);
  const aberto = com.reduce((s, x) => s + ("emAberto" in x ? x.emAberto : 0), 0);
  return {
    ...base,
    dataDado: m.ultimaCarga,
    periodo: `${mesBr(m.meses[0].mes)} a ${mesBr(m.meses.at(-1)!.mes)} (vencimento)`,
    valor: `${reaisCurto(aberto)} em aberto`,
    estado: "disponivel",
    dados: m.meses.map((x) => ({
      rotulo: `${mesBr(x.mes)}${x.parcial ? " (parcial)" : ""}`,
      valor: x.semTitulo
        ? "sem título"
        : `faturado ${reaisCurto(x.faturado)} · recebido ${reaisCurto(x.recebido)} · em aberto ${reaisCurto(x.emAberto)}`,
    })),
  };
}

function entrega(c: Cockpit): Explicacao {
  const m = modeloEntrega(c);
  const base = {
    id: "entrega",
    titulo: "Onboarding por fase",
    oQueDiz: "Quantos clientes vendidos estão em cada fase do onboarding, e onde a fila trava.",
    comoSeCalcula:
      "Cards do pipe de Onboarding em curso (fora Concluído e Churn), por fase atual. Gargalo = fase com mais clientes há mais de 30 dias nela.",
    fonte: "Pipefy de Onboarding, lido pelo Ops",
    dataDado: null as string | null,
    periodo: "Fotografia de agora",
    atencao: [
      "30 e 60 dias são faixas de leitura, não prazo: nenhum SLA de onboarding foi decidido.",
      "Cards criados desde agosto estão sem empresa vinculada (a automação de vínculo falha desde 17/08).",
    ],
    dono: "Operações + CS",
    destino: PAINEL_CS,
  };
  if (ehSemDado(m)) return semNumero(base, m);
  return {
    ...base,
    dataDado: m.atualizadoEm,
    valor: `${intTexto(m.emCurso)} em curso`,
    estado: "disponivel",
    dados: m.fases.map((f) => ({
      rotulo: `${f.fase}${f.fase === m.gargalo ? " (gargalo)" : ""}`,
      valor: `${intTexto(f.cards)} clientes · ${intTexto(f.acima30)} há mais de 30 dias`,
    })),
  };
}

function fontes(c: Cockpit, agora: string): Explicacao {
  const saude = montarLeituraExecutiva(c).saude;
  const m = modeloFontes(saude.linhas, agora);
  return {
    id: "fontes",
    titulo: "Saúde das fontes",
    valor: `${m.paradas.length} de ${m.total} paradas`,
    estado: "disponivel",
    oQueDiz: "Quais fontes do cockpit estão fora da cadência de carga, e há quantos dias.",
    comoSeCalcula:
      "Dias desde a última carga declarada por cada fonte. Parada = mais de dois dias sem carga (a cadência declarada é diária), ou número da primeira leitura com dado mais velho que isso.",
    fonte: "Registro de carga de cada fonte (frescor)",
    dataDado: agora,
    periodo: "Agora",
    atencao: [
      "Fonte parada deixa o número dela parcial: o gráfico que depende dela diz isso.",
      ...m.paradas.filter((p) => p.dias === null).map((p) => `${p.fonte}: sem data de carga.`),
    ],
    dono: "Dono de cada fonte (Financeiro, Growth, Ops)",
    destino: destinoFrente("capital", "Abrir Evidências e capital"),
    dados: saude.linhas.map((l) => ({
      rotulo: l.fonte,
      valor:
        l.estado === "em_dia"
          ? "em dia"
          : l.atualizadoEm
            ? `parada · ${m.paradas.find((p) => p.fonte === l.fonte)?.dias ?? "?"} dias`
            : "sem data",
    })),
  };
}

function decisoes(c: Cockpit): Explicacao {
  return {
    id: "decisoes",
    titulo: "Decisões suas",
    valor: String(c.decisoes.length),
    estado: "disponivel",
    oQueDiz: "O que está parado esperando decisão do CEO, na ordem em que uma destrava a outra.",
    comoSeCalcula:
      "Regras fixas sobre os números do cockpit; D0 (o que é o bilhão) vem antes de todas. Nenhuma é sugerida por IA.",
    fonte: "Regras do cockpit",
    dataDado: null,
    periodo: "Agora",
    atencao: c.decisoes.map((d) => `${d.titulo}: ${d.porque}`),
    dono: [...new Set(c.decisoes.map((d) => d.responsavel))].join(" · "),
    destino: null,
    dados: c.decisoes.map((d, i) => ({
      rotulo: `${i === 0 ? "D0" : `D${i}`} · ${d.titulo}`,
      valor: `quem decide: ${d.responsavel}`,
    })),
  };
}

function ameacas(c: Cockpit): Explicacao {
  const altas = c.ameacas.filter((a) => a.gravidade === "alta").length;
  return {
    id: "ameacas",
    titulo: "Ameaças",
    valor: String(c.ameacas.length),
    estado: "disponivel",
    oQueDiz: "Alertas disparados por regras fixas sobre os números, os mais graves primeiro.",
    comoSeCalcula:
      "Cada regra compara um número com o plano, com o mês anterior ou com um limite de idade. Não é IA.",
    fonte: "Regras do cockpit",
    dataDado: null,
    periodo: "Agora",
    atencao: [
      `${altas} de gravidade alta.`,
      "Alerta sem dono atribuído aparece assim até alguém assumir: o dono sugerido é o do contrato do indicador.",
      ...c.ameacas.map((a) => `${a.titulo}: ${a.detalhe}`),
    ],
    dono: "Dono de cada indicador",
    destino: null,
    dados: c.ameacas.map((a) => ({
      rotulo: a.titulo,
      valor: a.gravidade === "alta" ? "gravidade alta" : "gravidade média",
    })),
  };
}

// ── Frentes: o cartão principal de cada uma ──────────────────────────────────

/** Explicação do cartão principal de uma frente: reaproveita a do gráfico que a frente estende. */
function frente(c: Cockpit, f: Frente, agora: string): Explicacao {
  const reuso: Partial<Record<Frente, () => Explicacao>> = {
    receita: () => trajetoria(c),
    retencao: () => churn(c),
    operacao: () => entrega(c),
    rede: () => redeMrr(c),
    capital: () => fontes(c, agora),
  };
  const r = reuso[f]?.();
  if (r) return { ...r, id: `frente-${f}` };
  const ind = (id: string) => c.indicadores.find((i) => i.id === id);
  if (f === "comercial") {
    const i = ind("mrr-vendido");
    return {
      id: "frente-comercial",
      titulo: "MRR novo vendido × plano",
      valor: i?.valor != null ? reaisCurto(i.valor) : null,
      estado: i?.estado ?? "nao_apurado",
      oQueDiz: "Quanto o Inside Sales vendeu de MRR novo em cada mês, contra o plano do Growth.",
      comoSeCalcula: i?.definicao ?? "Série mensal do Growth.",
      fonte: i?.fonte ?? "Growth",
      dataDado: i?.dataDado ?? null,
      periodo: "Meses do plano do Growth; o mês em curso é parcial",
      atencao: ["MRR vendido não é faturamento: ele vira receita depois do onboarding."],
      dono: "Diretoria de Growth",
      destino: destinoFrente("comercial"),
      dados: (c.empresa.aquisicao?.meses ?? []).map((m) => ({
        rotulo: `${mesBr(m.mes)}${m.emAndamento ? " (parcial)" : ""}`,
        valor: `${m.mrrNovo === null ? "sem dado" : reaisCurto(m.mrrNovo)}${m.plano?.mrrNovo != null ? ` · plano ${reaisCurto(m.plano.mrrNovo)}` : ""}`,
      })),
    };
  }
  if (f === "clientes") {
    const defs = (c.clientes?.definicoes ?? []).filter((d) => d.cnpjs !== null);
    const ns = defs.map((d) => d.cnpjs!);
    return {
      id: "frente-clientes",
      titulo: "Clientes por régua",
      valor: ns.length ? `${intTexto(Math.min(...ns))} a ${intTexto(Math.max(...ns))}` : null,
      estado: ns.length ? "disponivel" : "nao_apurado",
      oQueDiz: "Quantos clientes temos por cada régua candidata de cliente ativo.",
      comoSeCalcula:
        "CNPJs distintos por definição: contrato ativo no Omie, pagou em 90 dias, cadastro ativo, MRR maior que zero. As réguas não se somam.",
      fonte: "Omie das unidades, contas a receber, cadastro e MRR do Ops",
      dataDado: null,
      periodo: "Fotografia de agora",
      atencao: [
        c.clientesAviso ?? "Nenhuma régua é a oficial: a decisão está com o CEO.",
      ],
      dono: "CEO + Departamento de Receitas",
      destino: destinoFrente("clientes"),
      dados: defs.map((d) => ({ rotulo: d.titulo, valor: `${intTexto(d.cnpjs!)} CNPJs` })),
    };
  }
  if (f === "portfolio") {
    const i = ind("contratos-ganhos");
    return {
      id: "frente-portfolio",
      titulo: "Contratos ganhos por produto",
      valor: i?.valor != null ? intTexto(i.valor) : null,
      estado: i?.estado ?? "nao_apurado",
      oQueDiz: "Quantos contratos a Monetização ganhou no período, por produto.",
      comoSeCalcula: i?.definicao ?? "Negócios do pipe de Monetização com evento de ganho.",
      fonte: i?.fonte ?? "Monetização",
      dataDado: i?.dataDado ?? null,
      periodo: i?.periodo ? `${i.periodo.de} a ${i.periodo.ate}` : "Período filtrado",
      atencao: ["Ganho no CRM, não receita: receita por vertical ainda não é separável no Financeiro."],
      dono: "Comercial + Departamento de Receitas",
      destino: i?.destino ?? null,
      dados: c.porProduto
        .filter((p) => p.produto !== "sem_produto")
        .map((p) => ({ rotulo: p.rotulo, valor: p.ganhos === null ? "sem dado" : intTexto(p.ganhos) })),
    };
  }
  // caixa
  const i = ind("vencido-em-aberto");
  const er = c.empresa.caixa?.emitidoRecebido?.meses ?? [];
  return {
    id: "frente-caixa",
    titulo: "Vencido e não recebido",
    valor: i?.valor != null ? reaisCurto(i.valor) : null,
    estado: i?.estado ?? "nao_apurado",
    oQueDiz: "Quanto já venceu e não entrou, e como o emitido de cada mês vira recebido.",
    comoSeCalcula: i?.definicao ?? "Títulos vencidos em aberto do Financeiro.",
    fonte: i?.fonte ?? "Brain Financeiro",
    dataDado: i?.dataDado ?? null,
    periodo: "Fotografia de agora; emitido × recebido por mês de emissão",
    atencao: ["Recebido é acumulado até a foto de títulos: mês recente ainda tem título a vencer."],
    dono: "CFO · Controladoria",
    destino: FINANCEIRO,
    dados: er.map((m) => ({
      rotulo: mesBr(m.mes),
      valor: `emitido ${reaisCurto(m.emitido)}${m.leitura === "sem_foto" ? " · recebido não medido" : ` · recebido ${reaisCurto(m.recebido)}`}`,
    })),
  };
}

// ── Painéis das frentes: a descrição que saiu da tela ────────────────────────

interface TextoPainel {
  titulo: string;
  oQueDiz: string;
  comoSeCalcula: string;
  fonte: string;
  atencao: string[];
  dono: string;
  destino: Destino | null;
}

const PAINEIS: Record<string, TextoPainel> = {
  "ponte-mensal": {
    titulo: "Ponte mês a mês",
    oQueDiz: "O que entrou (acima de zero) e o que saiu (abaixo) do faturamento do grupo em cada mês fechado.",
    comoSeCalcula:
      "Ponte por cliente, régua de emissão: novos e retornos, expansão, contração e sem faturamento no mês. Cada mês fecha em centavos com o Faturamento.",
    fonte: "Brain Financeiro, faturamento por cliente",
    atencao: ["Sem faturamento no mês não prova churn."],
    dono: "CFO",
    destino: FINANCEIRO,
  },
  previsao: {
    titulo: "Pipeline em aberto",
    oQueDiz: "O MRR em negócios abertos do Inside Sales, por mês de fechamento esperado.",
    comoSeCalcula:
      "Soma do MRR dos negócios abertos, sem ponderação: nenhuma fonte tem probabilidade por etapa. Negócio sem data de fechamento e com data vencida são contados à parte.",
    fonte: "Growth (espelho do CRM)",
    atencao: [
      "Não existe previsão empresarial de faturamento: é lacuna com dono (CFO + RevOps).",
      "Pipeline não ponderado não é previsão.",
    ],
    dono: "CFO + RevOps",
    destino: null,
  },
  aquisicao: {
    titulo: "Aquisição × plano",
    oQueDiz: "MRR novo vendido do Inside Sales contra o plano do Growth, e o funil do último mês fechado.",
    comoSeCalcula:
      "Série mensal do Growth; plano cadastrado pelo Growth desde jun/2026 (mês sem plano fica sem linha). Forecast do mês pelo modelo do próprio Growth, sem recálculo.",
    fonte: "Growth",
    atencao: ["Custo de mídia por venda é só mídia paga, não o CAC completo."],
    dono: "Diretoria de Growth",
    destino: null,
  },
  coortes: {
    titulo: "Coortes de retenção",
    oQueDiz: "Quantos contratos de cada mês de ganho continuam ativos mês a mês.",
    comoSeCalcula:
      "Contratos ganhos (venda) por mês de ganho, denominador fixo, contra o churn datado da Central de Tratativas, de M0 a M12.",
    fonte: "Contratos do CRM e Central de Tratativas",
    atencao: ["O churn datado só existe desde 06/2025, e a Central está parada desde 15/09."],
    dono: "CS · Departamento de Receitas",
    destino: CONTRATOS_CHURN,
  },
  onboarding: {
    titulo: "Onboarding por fase e idade",
    oQueDiz: "Clientes em cada fase do onboarding, separados pela idade na fase atual.",
    comoSeCalcula: "Pipe de Onboarding por fase e dias desde a entrada na fase atual.",
    fonte: "Pipefy de Onboarding, lido pelo Ops",
    atencao: ["Faixas de leitura, não SLA: nenhum prazo de onboarding foi decidido."],
    dono: "Operações + CS",
    destino: PAINEL_CS,
  },
  cadeia: {
    titulo: "Da venda ao faturamento",
    oQueDiz: "A mesma safra de contratos em cada elo: onboarding, conclusão, faturamento e saída.",
    comoSeCalcula:
      "Ligação só por chave: empresa, CNPJ e nome normalizado único no cadastro de contrapartes do Omie. Contrato sem CNPJ não liga ao faturamento.",
    fonte: "Contratos, onboarding, títulos das unidades e Financeiro",
    atencao: ["Recebimento por cliente não é lido: só o agregado mensal, em Caixa e margem."],
    dono: "Operações · CFO",
    destino: PAINEL_CS,
  },
  capacidade: {
    titulo: "Capacidade da entrega",
    oQueDiz: "Se a entrega comporta crescer.",
    comoSeCalcula: "Sem fonte: horas, SLA, retrabalho e capacidade por equipe não são registrados.",
    fonte: "Nenhuma",
    atencao: ["A tabela de headcount mensal está vazia; a fila de onboarding é o único sinal de capacidade."],
    dono: "Operações",
    destino: null,
  },
  metas: {
    titulo: "Meta de venda por unidade",
    oQueDiz: "Meta e vendido por unidade no trimestre.",
    comoSeCalcula: "Metas e vendido do Growth (distribuição de metas por unidade).",
    fonte: "Growth",
    atencao: ["A meta por unidade tem leitura restrita à diretoria comercial do Growth."],
    dono: "Diretoria comercial",
    destino: null,
  },
  "rede-unidades": {
    titulo: "Faturamento das unidades",
    oQueDiz: "Faturamento, royalties + CSC e concentração por unidade da rede.",
    comoSeCalcula: "Apuração de royalties confirmada, janela de meses completos.",
    fonte: "Apuração de royalties",
    atencao: ["Recebido por unidade não entra: a série mensal disponível agrupa por competência."],
    dono: "Unidades · Receita e Repasses",
    destino: RECEITA_REPASSES,
  },
  demanda: {
    titulo: "Demanda por produto",
    oQueDiz: "Oportunidades validadas e contratos ganhos da Monetização por produto.",
    comoSeCalcula: "Negócios do pipe de Monetização no período filtrado.",
    fonte: "Monetização (CRM)",
    atencao: ["Demanda, não faturamento."],
    dono: "Comercial",
    destino: null,
  },
  diario: {
    titulo: "Eventos comerciais por dia",
    oQueDiz: "Leads trabalhados, reuniões marcadas e realizadas por dia do período.",
    comoSeCalcula: "Eventos do pipe de Monetização pela data do evento, fuso de São Paulo.",
    fonte: "Monetização (CRM)",
    atencao: ["Eventos, não coorte."],
    dono: "Comercial",
    destino: null,
  },
  caixa: {
    titulo: "Emitido × recebido",
    oQueDiz: "Se o faturamento vira caixa: emitido por mês, recebido até a foto, vencido por faixa e caixa livre.",
    comoSeCalcula:
      "Funções do Financeiro: recebido por mês de emissão, acumulado até a foto de títulos; vencido ao vivo por faixa de atraso; caixa livre pelo saldo bancário.",
    fonte: "Brain Financeiro",
    atencao: [
      "Mês em que a foto cobre só parte do mês mostra o não recebido como piso.",
      "Mês sem foto de títulos não tem recebido medido.",
    ],
    dono: "CFO · Controladoria",
    destino: FINANCEIRO,
  },
  margem: {
    titulo: "Margem por grupo",
    oQueDiz: "Receita bruta e lucro bruto por grupo de apuração do Financeiro.",
    comoSeCalcula: "Meses fechados do ano, por entidade faturadora agrupada.",
    fonte: "Brain Financeiro",
    atencao: ["Não é receita por produto nem por vertical: a fonte não classifica assim."],
    dono: "CFO",
    destino: FINANCEIRO,
  },
  frescor: {
    titulo: "Frescor das fontes",
    oQueDiz: "Última carga declarada por cada fonte do cockpit.",
    comoSeCalcula: "Registro de carga de cada fonte; parada acima de dois dias.",
    fonte: "Registro de carga",
    atencao: [],
    dono: "Dono de cada fonte",
    destino: null,
  },
  pilares: {
    titulo: "O que conseguimos demonstrar",
    oQueDiz: "Os oito pilares e as 11 exigências do mapa de investidores, pela situação da pergunta que responde cada uma.",
    comoSeCalcula: "Situação de cada pergunta do catálogo: respondida, parcial ou lacuna.",
    fonte: "Catálogo de perguntas do cockpit",
    atencao: ["A troca das frentes pelos 8 pilares ou pelos 15 componentes do livro ainda está em aberto."],
    dono: "CEO",
    destino: null,
  },
  clientes: {
    titulo: "Clientes ativos por régua",
    oQueDiz: "CNPJs por definição candidata de cliente ativo, a sobreposição entre elas e a penetração ganha no CRM.",
    comoSeCalcula: "Cada definição é uma régua diferente; a sobreposição é par a par, por CNPJ.",
    fonte: "Omie das unidades, contas a receber, cadastro e MRR do Ops",
    atencao: ["Nenhuma régua é a oficial."],
    dono: "CEO + Departamento de Receitas",
    destino: CONTRATOS_CHURN,
  },
};

function painel(id: string, c: Cockpit): Explicacao | null {
  const t = PAINEIS[id];
  if (!t) return null;
  return {
    id: `painel-${id}`,
    ...t,
    valor: null,
    estado: "disponivel",
    dataDado: c.empresa.frescor[0]?.atualizadoEm ?? null,
    periodo: "Como o painel indica",
    dados: [],
  };
}

function pergunta(id: string): Explicacao | null {
  const p = PERGUNTAS.find((x) => x.id === id);
  if (!p) return null;
  return {
    id: `pergunta-${id}`,
    titulo: `${p.id} · ${p.texto}`,
    valor: null,
    estado:
      p.estados.dado === "integrado"
        ? "disponivel"
        : p.estados.dado === "parcial"
          ? "parcial"
          : "nao_apurado",
    oQueDiz: p.resposta,
    comoSeCalcula: p.aceite,
    fonte: p.fonte,
    dataDado: null,
    periodo: "—",
    atencao: [
      ...(p.pendencia ? [`Falta: ${p.pendencia}`] : []),
      ...(p.estados.decisao ? [`Decisão pendente: ${p.estados.decisao}`] : []),
      `Growth: ${p.growth}`,
      `Ops: ${p.ops}`,
    ],
    dono: p.responsavel,
    destino: null,
    dados: [],
  };
}

export const IDS_VISAO = [
  "trajetoria",
  "ponte",
  "composicao",
  "churn",
  "rede-mrr",
  "franqueadora",
  "entrega",
  "fontes",
  "decisoes",
  "ameacas",
] as const;

/** A explicação de um id de gráfico (`?grafico=`); null para id desconhecido. */
export function explicar(c: Cockpit, id: string, agora = new Date().toISOString()): Explicacao | null {
  switch (id) {
    case "trajetoria":
      return trajetoria(c);
    case "ponte":
      return ponte(c);
    case "composicao":
      return composicao(c);
    case "churn":
      return churn(c);
    case "rede-mrr":
      return redeMrr(c);
    case "franqueadora":
      return franqueadora(c);
    case "entrega":
      return entrega(c);
    case "fontes":
      return fontes(c, agora);
    case "decisoes":
      return decisoes(c);
    case "ameacas":
      return ameacas(c);
  }
  if (id.startsWith("frente-")) {
    const f = id.slice(7) as Frente;
    return f in FRENTES ? frente(c, f, agora) : null;
  }
  if (id.startsWith("painel-")) return painel(id.slice(7), c);
  if (id.startsWith("pergunta-")) return pergunta(id.slice(9));
  return null;
}

/**
 * O contexto que a conversa recebe quando a pessoa pergunta a partir de um gráfico: título, o que
 * ele diz, período e os dados desenhados, em texto. Os números deste texto contam como mostrados.
 */
export function contextoParaConversa(e: Explicacao): string {
  return [
    `Gráfico do cockpit: ${e.titulo}.`,
    e.valor ? `Número principal: ${e.valor}.` : null,
    `O que diz: ${e.oQueDiz}`,
    `Como se calcula: ${e.comoSeCalcula}`,
    `Fonte: ${e.fonte}. Período: ${e.periodo}.`,
    e.dados.length ? `Dados desenhados:\n${e.dados.map((d) => `- ${d.rotulo}: ${d.valor}`).join("\n")}` : null,
    e.atencao.length ? `Atenção: ${e.atencao.join(" ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
