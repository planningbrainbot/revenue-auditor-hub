// Avaliação rotulada do Jev no encaminhamento de perguntas do CEO (lote 7 do piloto).
//
// 40 perguntas FICTÍCIAS em português, escritas e rotuladas pelo autor antes de qualquer chamada:
// claras, ambíguas, contraditórias e fora de escopo. Para ambígua e contraditória o rótulo é o
// conjunto de frentes aceitáveis, não uma resposta única. Nenhum texto sai do banco; nenhum nome de
// cliente, unidade real ou pessoa aparece aqui.
//
// A mesma pergunta passa pela baseline de palavras-chave, para saber se o Jev acrescenta alguma
// coisa sobre uma regra trivial. `confidence` é avaliada como está: forma da distribuição, não
// probabilidade de acerto — a calibração mostra o quanto uma coisa se aproxima da outra.

export const TAXONOMIA_AVALIACAO = "cockpit-ceo-roteamento-v1";
/** Autorização do dono em 22/09/2026: chave atual, até 50 chamadas; US$ 0,10 é o teto do piloto. */
export const LIMITES_AVALIACAO = { tentativas: 50, custoUsd: 0.1 } as const;

export const CLASSES = ["clara", "ambigua", "contraditoria", "fora_de_escopo"] as const;
export type Classe = (typeof CLASSES)[number];

export interface CasoAvaliacao {
  id: string;
  classe: Classe;
  texto: string;
  /** Frentes aceitáveis; a primeira é o rótulo principal (usado na matriz de confusão). */
  aceitas: string[];
  /** A pergunta pede número ou evidência verificável? null = o autor não rotula. */
  pedeDado: boolean | null;
}

const caso = (
  id: string,
  classe: Classe,
  texto: string,
  aceitas: string[],
  pedeDado: boolean | null,
): CasoAvaliacao => ({ id, classe, texto, aceitas, pedeDado });

export const CASOS_AVALIACAO: CasoAvaliacao[] = [
  // ── Claras ──────────────────────────────────────────────────────────────
  caso(
    "c01",
    "clara",
    "Quanto faturamos nos últimos doze meses e quanto falta para chegar ao bilhão?",
    ["receita"],
    true,
  ),
  caso(
    "c02",
    "clara",
    "Qual foi o faturamento consolidado do grupo em julho comparado com junho?",
    ["receita"],
    true,
  ),
  caso(
    "c03",
    "clara",
    "De qual produto veio o maior incremento de receita neste trimestre?",
    ["receita"],
    true,
  ),
  caso(
    "c04",
    "clara",
    "Quantos clientes ativos temos hoje, contando cada empresa uma vez só?",
    ["clientes"],
    true,
  ),
  caso(
    "c05",
    "clara",
    "Quantas empresas da base já contrataram Consultoria e também Finance?",
    ["clientes"],
    true,
  ),
  caso(
    "c06",
    "clara",
    "Onde há contas prontas para oferecer o produto de crédito agora?",
    ["clientes", "comercial"],
    true,
  ),
  caso(
    "c07",
    "clara",
    "Quantos leads o comercial trabalhou esta semana e quantas reuniões saíram deles?",
    ["comercial"],
    true,
  ),
  caso(
    "c08",
    "clara",
    "Qual vendedor está convertendo melhor as oportunidades validadas em contrato?",
    ["comercial"],
    true,
  ),
  caso(
    "c09",
    "clara",
    "O funil de Monetização está andando ou os negócios estão parados em negociação?",
    ["comercial"],
    true,
  ),
  caso(
    "c10",
    "clara",
    "Quais unidades cresceram o faturamento com margem nos últimos meses?",
    ["rede"],
    true,
  ),
  caso(
    "c11",
    "clara",
    "Os sócios das unidades estão satisfeitos com o apoio da matriz?",
    ["rede"],
    true,
  ),
  caso(
    "c12",
    "clara",
    "Quanto cada unidade pagou de royalties no último trimestre?",
    ["rede"],
    true,
  ),
  caso(
    "c13",
    "clara",
    "Dos clientes que entraram no ano passado, quantos ainda estão com a gente?",
    ["retencao"],
    true,
  ),
  caso("c14", "clara", "Qual foi o churn de clientes por mês de entrada?", ["retencao"], true),
  caso(
    "c15",
    "clara",
    "Quais empresas poderíamos adquirir e quanto capital isso exigiria?",
    ["capital"],
    true,
  ),
  caso(
    "c16",
    "clara",
    "Conseguimos reproduzir as demonstrações consolidadas para a diligência de um investidor?",
    ["capital"],
    true,
  ),
  // ── Ambíguas ────────────────────────────────────────────────────────────
  caso("a01", "ambigua", "Como estamos?", ["insuficiente"], null),
  caso(
    "a02",
    "ambigua",
    "E a Consultoria, está indo bem?",
    ["comercial", "receita", "clientes"],
    null,
  ),
  caso(
    "a03",
    "ambigua",
    "O que aconteceu com a unidade do Sul este mês?",
    ["rede", "insuficiente", "receita"],
    null,
  ),
  caso(
    "a04",
    "ambigua",
    "Vale a pena acelerar o Finance?",
    ["comercial", "clientes", "receita"],
    false,
  ),
  caso("a05", "ambigua", "Os números do mês fecham?", ["receita", "capital", "insuficiente"], null),
  caso(
    "a06",
    "ambigua",
    "Quem está puxando a meta para baixo?",
    ["comercial", "receita", "rede"],
    null,
  ),
  caso(
    "a07",
    "ambigua",
    "Temos estrutura para crescer sem perder qualidade na entrega?",
    ["retencao", "clientes"],
    null,
  ),
  caso("a08", "ambigua", "Quanto vale a empresa hoje?", ["capital", "fora_de_escopo"], null),
  caso("a09", "ambigua", "Me mostra os números.", ["insuficiente"], null),
  caso("a10", "ambigua", "A rede está saudável?", ["rede"], null),
  // ── Contraditórias ──────────────────────────────────────────────────────
  caso(
    "x01",
    "contraditoria",
    "Quantos clientes cancelaram, sem olhar para cancelamento, só para vendas novas?",
    ["comercial", "retencao", "insuficiente"],
    null,
  ),
  caso(
    "x02",
    "contraditoria",
    "Quero o faturamento das unidades, mas sem contar nenhuma unidade.",
    ["insuficiente", "rede", "receita"],
    null,
  ),
  caso(
    "x03",
    "contraditoria",
    "Qual a retenção do produto que ainda não lançamos?",
    ["insuficiente", "retencao"],
    null,
  ),
  caso(
    "x04",
    "contraditoria",
    "Mostre o crescimento de receita sem usar nenhum dado de faturamento.",
    ["insuficiente", "receita"],
    null,
  ),
  caso(
    "x05",
    "contraditoria",
    "Quais leads viraram clientes antes mesmo de serem prospectados?",
    ["comercial", "insuficiente"],
    null,
  ),
  caso(
    "x06",
    "contraditoria",
    "Quero saber quem saiu da base no mês que vem.",
    ["retencao", "insuficiente"],
    null,
  ),
  // ── Fora de escopo ──────────────────────────────────────────────────────
  caso(
    "f01",
    "fora_de_escopo",
    "Onde fazemos a festa de fim de ano do time?",
    ["fora_de_escopo"],
    null,
  ),
  caso("f02", "fora_de_escopo", "Qual a previsão do tempo para amanhã?", ["fora_de_escopo"], null),
  caso("f03", "fora_de_escopo", "Escreva um poema sobre contabilidade.", ["fora_de_escopo"], null),
  caso("f04", "fora_de_escopo", "Quem ganhou o jogo de futebol ontem?", ["fora_de_escopo"], null),
  caso(
    "f05",
    "fora_de_escopo",
    "Como faço para trocar a senha do meu e-mail?",
    ["fora_de_escopo"],
    null,
  ),
  caso(
    "f06",
    "fora_de_escopo",
    "Qual o melhor livro de liderança para ler nas férias?",
    ["fora_de_escopo"],
    null,
  ),
  caso("f07", "fora_de_escopo", "Como se diz faturamento em inglês?", ["fora_de_escopo"], null),
  caso(
    "f08",
    "fora_de_escopo",
    "Quanto custa uma passagem para Lisboa em dezembro?",
    ["fora_de_escopo"],
    null,
  ),
];

// ── Baseline por palavras-chave ─────────────────────────────────────────────
const PALAVRAS: [string, RegExp][] = [
  ["receita", /fatur|receita|bilh|meta\b|increment|crescimento de receita/i],
  ["clientes", /client|base\b|contrat(aram|ou)|contas? prontas|empresas da base|consom/i],
  ["comercial", /lead|reuni|vendedor|convert|funil|negocia|oportunidad|comercial/i],
  ["rede", /unidade|sócio|royalt|repass|rede\b/i],
  ["retencao", /churn|cancel|reten|coorte|ainda estão|saiu|saíram|entrega/i],
  ["capital", /investidor|adquir|aquisi|capital|diligên|demonstra|consolidad|vale a empresa/i],
];

/** Frente com mais palavras-chave; empate fica com a primeira da lista; nenhuma = fora de escopo. */
export function baselinePalavras(texto: string): string {
  let melhor = "fora_de_escopo";
  let pontos = 0;
  for (const [frente, re] of PALAVRAS) {
    const n = (texto.match(new RegExp(re.source, "gi")) ?? []).length;
    if (n > pontos) {
      melhor = frente;
      pontos = n;
    }
  }
  return melhor;
}

// ── Métricas ────────────────────────────────────────────────────────────────
export type ResultadoCaso =
  | {
      id: string;
      estado: "ok";
      escolha: string;
      confianca: number | null;
      /** Resposta noul de pede_dado (0..1). */
      pedeDado: number | null;
      latenciaMs: number;
      custoUsd: number | null;
      baseline: string;
    }
  | { id: string; estado: "falha" | "bloqueado"; codigo: string; baseline: string };

const FAIXAS: [string, number, number][] = [
  ["0,00–0,50", 0, 0.5],
  ["0,50–0,70", 0.5, 0.7],
  ["0,70–0,90", 0.7, 0.9],
  ["0,90–1,00", 0.9, 1.0000001],
];

const percentil = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.max(0, Math.ceil(p * o.length) - 1)];
};

export function medirAvaliacao(casos: CasoAvaliacao[], resultados: ResultadoCaso[]) {
  const porId = new Map(casos.map((c) => [c.id, c]));
  const ok = resultados.filter(
    (r): r is Extract<ResultadoCaso, { estado: "ok" }> => r.estado === "ok",
  );
  const acerto = (id: string, escolha: string) => porId.get(id)!.aceitas.includes(escolha);
  const placar = (escolha: (r: (typeof ok)[number]) => string) => {
    const porClasse = Object.fromEntries(
      CLASSES.map((classe) => {
        const rs = ok.filter((r) => porId.get(r.id)!.classe === classe);
        const acertos = rs.filter((r) => acerto(r.id, escolha(r))).length;
        return [classe, { n: rs.length, acertos, taxa: rs.length ? acertos / rs.length : null }];
      }),
    ) as Record<Classe, { n: number; acertos: number; taxa: number | null }>;
    const acertos = ok.filter((r) => acerto(r.id, escolha(r))).length;
    return {
      geral: { n: ok.length, acertos, taxa: ok.length ? acertos / ok.length : null },
      porClasse,
    };
  };

  const confusao: Record<string, Record<string, number>> = {};
  for (const r of ok) {
    const esperado = porId.get(r.id)!.aceitas[0];
    confusao[esperado] ??= {};
    confusao[esperado][r.escolha] = (confusao[esperado][r.escolha] ?? 0) + 1;
  }

  const comDado = ok.filter((r) => porId.get(r.id)!.pedeDado !== null && r.pedeDado !== null);
  const pedeDado = {
    n: comDado.length,
    acertos: comDado.filter((r) => r.pedeDado! >= 0.5 === porId.get(r.id)!.pedeDado).length,
  };

  const calibracao = FAIXAS.map(([faixa, de, ate]) => {
    const rs = ok.filter((r) => r.confianca !== null && r.confianca >= de && r.confianca < ate);
    const acertos = rs.filter((r) => acerto(r.id, r.escolha)).length;
    const media = rs.length ? rs.reduce((s, r) => s + r.confianca!, 0) / rs.length : null;
    return {
      faixa,
      n: rs.length,
      confiancaMedia: media,
      acertos,
      taxa: rs.length ? acertos / rs.length : null,
    };
  });
  const comConf = calibracao.filter((b) => b.n > 0);
  const nConf = comConf.reduce((s, b) => s + b.n, 0);
  const erroCalibracao = nConf
    ? comConf.reduce((s, b) => s + (b.n / nConf) * Math.abs(b.confiancaMedia! - b.taxa!), 0)
    : null;

  const latencias = ok.map((r) => r.latenciaMs);
  const custos = ok.map((r) => r.custoUsd).filter((c): c is number => typeof c === "number");
  const total = Math.round(custos.reduce((s, c) => s + c, 0) * 1e9) / 1e9;
  return {
    casos: casos.length,
    respondidos: ok.length,
    falhas: resultados.length - ok.length,
    jev: placar((r) => r.escolha),
    baseline: placar((r) => r.baseline),
    confusao,
    pedeDado: { ...pedeDado, taxa: pedeDado.n ? pedeDado.acertos / pedeDado.n : null },
    calibracao,
    erroCalibracao,
    latencia: { p50: percentil(latencias, 0.5), p95: percentil(latencias, 0.95) },
    custo: {
      totalUsd: total,
      comCusto: custos.length,
      semCusto: ok.length - custos.length,
      porMilUsd: custos.length ? (total / custos.length) * 1000 : null,
    },
  };
}
