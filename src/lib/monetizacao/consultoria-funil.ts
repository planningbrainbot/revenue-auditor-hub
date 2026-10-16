// Régua das visões Funil e Fila de cobrança da tela Consultoria (`/monetizacao?aba=handoff-consultoria`).
// Contrato: docs/design/contratos/monetizacao-consultoria-funil.md. Pura: recebe o payload de
// ops.consultoria_funil_painel() (migration 20261016190000) e devolve o que as telas mostram.
// Testes: tests/monetizacao-consultoria-funil.test.mjs.
//
// Pedido do CEO, call de 16/10/2026 (7:45–10:11): "entrou 300 clientes esse ano... quantos que a consultoria auditou...
// quantos tem dinheiro... quanto que ela monetizou... onde que está esse gelo que não me pagou?".
// O funil é cumulativo (monetizacao/memoria, 30/09): cada empresa tem um nível, o da etapa mais adiantada a que chegou;
// cada etapa conta quem chegou até ela ou além; a porcentagem é a etapa dividida pela de cima, exatamente.

export type Origem = "inside_sales" | "socios" | "goiania" | "outra";

export interface EmpresaFunil {
  chave: string;
  cnpj: string | null;
  nome: string;
  origem: Origem;
  unidade: string | null;
  closer: string | null;
  ganho_em: string | null;
  mrr: number | string | null;
  negocios: number;
  deal: string | null;
  cnpj_fonte: string | null;
  regime: string | null;
  faturamento_teto: number | string | null;
  cliente_id: string | null;
  cadastrado_em: string | null;
  canais: string[];
  projetos: number;
  abertos: number;
  auditado: boolean;
  entregue_em: string | null;
  etapa: string | null;
  produto: string | null;
  dias_na_etapa: number | null;
  meta_dias: number | null;
  dias_alem: number | null;
  identificado: number | string;
  aceito: number | string;
  negociacao: number | string;
  aprovado: number | string;
  garantido: number | string;
  tem_estoque: boolean;
  propostas_aceitas: number;
  /** Os seis valores do Omie da Consultoria: `null` sem a porta do Financeiro. */
  faturado: number | string | null;
  faturado_2026: number | string | null;
  recebido: number | string | null;
  recebido_2026: number | string | null;
  a_receber: number | string | null;
  em_atraso: number | string | null;
  tem_fatura: boolean;
  ultimo_fup: string | null;
  registro: {
    resultado: Resultado;
    nota: string | null;
    proximo: string | null;
    autor: string | null;
    em: string;
    total: number;
  } | null;
}

export interface FunilBruto {
  lido_em: string;
  porta_financeiro: { aberta: boolean; motivo: string | null };
  frescor: { plataforma: string | null; cnpj_resolvido: string | null };
  empresas: EmpresaFunil[];
}

export const ORIGENS: { id: Origem; rotulo: string; curto: string }[] = [
  { id: "inside_sales", rotulo: "Vendas da máquina (Inside Sales)", curto: "Máquina" },
  { id: "socios", rotulo: "Vendas dos sócios", curto: "Sócios" },
  { id: "goiania", rotulo: "Carteira de Goiânia", curto: "Goiânia" },
  { id: "outra", rotulo: "Outras origens", curto: "Outra" },
];
/** O funil olha o que veio de nós: as vendas de 2026 e a carteira de Goiânia (decisão do Pedro, 16/10/2026). */
export const ORIGENS_FUNIL: Origem[] = ["inside_sales", "socios", "goiania"];

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const dias = (de: string | null, ate: string) =>
  de ? Math.floor((Date.parse(ate.slice(0, 10)) - Date.parse(de.slice(0, 10))) / 86_400_000) : null;

// ─── As etapas ───────────────────────────────────────────────────────────────────────────────────

export interface Etapa {
  n: number;
  titulo: string;
  /** Uma frase, para quem nunca viu a tela. */
  explica: string;
  /** O dinheiro que a etapa soma, quando soma algum. */
  dinheiro?: "identificado" | "aceito" | "faturado" | "recebido";
}

export const ETAPAS: Etapa[] = [
  { n: 1, titulo: "Vendemos", explica: "Venda ganha em 2026 no Pipedrive, ou cliente da carteira de Goiânia." },
  { n: 2, titulo: "Sabemos o CNPJ", explica: "Sem o CNPJ não dá para achar a empresa na Consultoria." },
  { n: 3, titulo: "Chegou à Consultoria", explica: "Está cadastrada na plataforma do Pedro Siqueira." },
  { n: 4, titulo: "Diagnóstico entregue", explica: "A Consultoria auditou e entregou o resultado." },
  {
    n: 5,
    titulo: "Achou dinheiro",
    explica: "O diagnóstico achou crédito a recuperar.",
    dinheiro: "identificado",
  },
  {
    n: 6,
    titulo: "Cliente aceitou",
    explica: "Disse sim a uma tese, tem crédito aprovado ou aceitou uma proposta.",
    dinheiro: "aceito",
  },
  { n: 7, titulo: "Faturamos", explica: "A Consultoria emitiu o honorário.", dinheiro: "faturado" },
  { n: 8, titulo: "Recebemos", explica: "O honorário entrou no caixa.", dinheiro: "recebido" },
];

/** A etapa mais adiantada a que a empresa chegou (1 a 8). */
export function nivelDe(e: EmpresaFunil): number {
  let n = 1;
  if (e.cnpj) n = 2;
  if (e.cliente_id) n = 3;
  if (e.auditado) n = 4;
  if (num(e.identificado) > 0) n = 5;
  if (num(e.aceito) > 0 || e.tem_estoque || e.propostas_aceitas > 0) n = 6;
  if (e.tem_fatura) n = 7;
  if (num(e.recebido) > 0) n = 8;
  return n;
}

// ─── Por que parou ───────────────────────────────────────────────────────────────────────────────

export type TomMotivo = "perigo" | "atencao" | "neutro" | "info";
export interface Motivo {
  id: string;
  rotulo: string;
  /** O que fazer, numa frase. */
  leitura: string;
  tom: TomMotivo;
}

const M = (id: string, rotulo: string, leitura: string, tom: TomMotivo): Motivo => ({
  id,
  rotulo,
  leitura,
  tom,
});
export const MOTIVOS: Record<number, Motivo[]> = {
  2: [M("sem_cnpj", "Sem CNPJ", "Nem o contrato, nem o Pipedrive, nem a Base têm o CNPJ. Não dá para acompanhar.", "atencao")],
  3: [
    M("recente", "Venda recente", "Vendida há menos de 30 dias; ainda dá tempo de chegar.", "neutro"),
    M("real", "Lucro Real", "É o perfil da Consultoria e não chegou: furo do handoff.", "perigo"),
    M("presumido", "Lucro Presumido", "Só entra acima de R$ 50 mi de faturamento.", "atencao"),
    M("simples", "Simples Nacional", "Fora do perfil da Consultoria.", "neutro"),
    M("pequena", "Empresa pequena", "Porte ME ou EPP pela Receita: fora do perfil.", "neutro"),
    M("sem_regime", "Regime desconhecido", "Ninguém sabe o regime; não dá para dizer se devia chegar.", "atencao"),
  ],
  4: [
    M("documentos", "Esperando documentos", "Parada em Fila ou Fluxo de Documentos.", "atencao"),
    M("diagnostico", "Em diagnóstico", "A Consultoria está trabalhando.", "info"),
    M("sem_projeto", "Sem projeto aberto", "Cadastrada, mas sem trabalho em andamento.", "atencao"),
  ],
  5: [M("sem_oportunidade", "Sem oportunidade", "O diagnóstico não achou crédito.", "neutro")],
  6: [
    M("ate_30", "Entregue há menos de 30 dias", "Ainda em conversa com o cliente.", "info"),
    M("30_90", "Entregue há 30 a 90 dias", "Cobrar a decisão do cliente.", "atencao"),
    M("mais_90", "Entregue há mais de 90 dias", "Dinheiro parado: ninguém fechou.", "perigo"),
    M("sem_data", "Sem data de entrega", "A plataforma não tem a data da entrega.", "atencao"),
  ],
  7: [M("aceitou", "Aceitou e não faturamos", "O cliente disse sim e o honorário não saiu.", "perigo")],
  8: [
    M("em_atraso", "Faturado e em atraso", "Cobrar o pagamento.", "perigo"),
    M("a_vencer", "Faturado, a vencer", "Ainda no prazo.", "neutro"),
  ],
};

/** Por que a empresa parou na etapa em que está (o motivo do vazamento para a etapa seguinte). */
export function motivoDe(e: EmpresaFunil, hoje: string): string {
  const n = nivelDe(e);
  if (n === 1) return "sem_cnpj";
  if (n === 2) {
    const ganho = dias(e.ganho_em, hoje);
    if (ganho !== null && ganho < 30) return "recente";
    const r = (e.regime ?? "").toLowerCase();
    if (r.includes("simples") || r === "mei") return "simples";
    if (r.includes("real")) return "real";
    if (r.includes("presumido")) return "presumido";
    if (e.faturamento_teto !== null && e.faturamento_teto !== undefined && num(e.faturamento_teto) <= 4.8)
      return "pequena";
    return "sem_regime";
  }
  if (n === 3) {
    if (e.etapa === "fluxo_documentos" || e.etapa === "fila_processamento") return "documentos";
    if (e.etapa) return "diagnostico";
    return "sem_projeto";
  }
  if (n === 4) return "sem_oportunidade";
  if (n === 5) {
    const d = dias(e.entregue_em, hoje);
    if (d === null) return "sem_data";
    return d > 90 ? "mais_90" : d >= 30 ? "30_90" : "ate_30";
  }
  if (n === 6) return "aceitou";
  if (n === 7) return num(e.em_atraso) > 0 ? "em_atraso" : "a_vencer";
  return "recebido";
}

// ─── O funil ─────────────────────────────────────────────────────────────────────────────────────

export interface PassoFunil {
  etapa: Etapa;
  /** Quem chegou até esta etapa ou além. */
  empresas: number;
  /** Etapa ÷ etapa de cima, em %, inteiro; a primeira não tem. */
  taxa: number | null;
  /** Dinheiro da etapa (das empresas que chegaram até ela). `null` sem a porta do Financeiro. */
  dinheiro: number | null;
  /** Quem parou nesta etapa e não passou para a seguinte, por motivo. */
  parou: { motivo: Motivo; empresas: number }[];
  pararam: number;
}

export interface Filtro {
  origens: Origem[];
  unidade?: string | null;
}

export function filtrar(empresas: EmpresaFunil[], f: Filtro): EmpresaFunil[] {
  return empresas.filter(
    (e) => f.origens.includes(e.origem) && (!f.unidade || (e.unidade ?? "") === f.unidade),
  );
}

export function montarFunil(empresas: EmpresaFunil[], hoje: string, portaAberta: boolean): PassoFunil[] {
  const niveis = empresas.map((e) => ({ e, n: nivelDe(e), m: motivoDe(e, hoje) }));
  return ETAPAS.map((etapa, i) => {
    const ate = niveis.filter((x) => x.n >= etapa.n);
    const acima = i === 0 ? null : niveis.filter((x) => x.n >= ETAPAS[i - 1].n).length;
    const aqui = niveis.filter((x) => x.n === etapa.n);
    const motivos = MOTIVOS[etapa.n + 1] ?? [];
    const soma = (k: "identificado" | "aceito" | "faturado" | "recebido") =>
      ate.reduce((s, x) => s + num(x.e[k]), 0);
    const financeiro = etapa.dinheiro === "faturado" || etapa.dinheiro === "recebido";
    return {
      etapa,
      empresas: ate.length,
      taxa: acima ? Math.round((100 * ate.length) / acima) : acima === 0 ? 0 : null,
      dinheiro: !etapa.dinheiro ? null : financeiro && !portaAberta ? null : soma(etapa.dinheiro),
      parou: motivos
        .map((motivo) => ({ motivo, empresas: aqui.filter((x) => x.m === motivo.id).length }))
        .filter((x) => x.empresas > 0),
      pararam: etapa.n < 8 ? aqui.length : 0,
    };
  });
}

/** As empresas de um clique no funil: "3" = chegaram à etapa 3 ou além; "3-real" = pararam na 3 pelo motivo "real". */
export function empresasDoPasso(empresas: EmpresaFunil[], passo: string, hoje: string): EmpresaFunil[] {
  const [n, motivo] = passo.split("-") as [string, string | undefined];
  const etapa = Number(n);
  // "3-atrasado": paradas antes do diagnóstico e além da meta da etapa, qualquer que seja a etapa.
  if (motivo === "atrasado") return empresas.filter((e) => nivelDe(e) === etapa && (e.dias_alem ?? 0) > 0);
  return empresas.filter((e) =>
    motivo ? nivelDe(e) === etapa && motivoDe(e, hoje) === motivo : nivelDe(e) >= etapa,
  );
}

// ─── Dinheiro de verdade ─────────────────────────────────────────────────────────────────────────

export interface Dinheiro {
  recebido2026: number | null;
  faturado2026: number | null;
  garantido: number;
  empresasGarantido: number;
  parado: number;
  empresasParado: number;
}

/** Os três níveis de certeza do honorário (decisão de 16/10: a meta é o faturado) e o dinheiro identificado parado. */
export function dinheiroDe(empresas: EmpresaFunil[], portaAberta: boolean): Dinheiro {
  const parados = empresas.filter((e) => nivelDe(e) === 5);
  const garantidos = empresas.filter((e) => num(e.garantido) > 0);
  return {
    recebido2026: portaAberta ? empresas.reduce((s, e) => s + num(e.recebido_2026), 0) : null,
    faturado2026: portaAberta ? empresas.reduce((s, e) => s + num(e.faturado_2026), 0) : null,
    garantido: garantidos.reduce((s, e) => s + num(e.garantido), 0),
    empresasGarantido: garantidos.length,
    parado: parados.reduce((s, e) => s + num(e.identificado), 0),
    empresasParado: parados.length,
  };
}

// ─── Onde agir agora ─────────────────────────────────────────────────────────────────────────────

export interface Acao {
  id: string;
  titulo: string;
  empresas: number;
  valor: number | null;
  leitura: string;
  tom: TomMotivo;
  /** Para onde o botão leva: um passo do funil ou um grupo da fila. */
  passo?: string;
  grupo?: GrupoFila;
}

export function ondeAgir(empresas: EmpresaFunil[], hoje: string): Acao[] {
  const com = (n: number, m: string) => empresas.filter((e) => nivelDe(e) === n && motivoDe(e, hoje) === m);
  const aceitou = empresas.filter((e) => nivelDe(e) === 6);
  const parado90 = com(5, "mais_90");
  const atrasados = empresas.filter((e) => nivelDe(e) === 3 && (e.dias_alem ?? 0) > 0);
  const real = com(2, "real");
  const semCnpj = empresas.filter((e) => nivelDe(e) === 1);
  const acoes: Acao[] = [
    {
      id: "aceitou",
      titulo: "Disseram sim e nada andou",
      empresas: aceitou.length,
      valor: aceitou.reduce((s, e) => s + num(e.aceito), 0),
      leitura: "Aceitaram teses e o honorário não foi faturado. É o dinheiro mais perto do caixa.",
      tom: "perigo",
      grupo: "aceitou",
    },
    {
      id: "parado90",
      titulo: "Diagnóstico com dinheiro há mais de 90 dias",
      empresas: parado90.length,
      valor: parado90.reduce((s, e) => s + num(e.identificado), 0),
      leitura: "A Consultoria achou crédito e ninguém fechou com o cliente.",
      tom: "perigo",
      grupo: "90",
    },
    {
      id: "atrasados",
      titulo: "Parados antes do diagnóstico, fora do prazo",
      empresas: atrasados.length,
      valor: null,
      leitura: "Chegaram à Consultoria e estão além da meta da etapa (como a Ollie).",
      tom: "atencao",
      passo: "3-atrasado",
    },
    {
      id: "real",
      titulo: "Lucro Real que não chegou à Consultoria",
      empresas: real.length,
      valor: null,
      leitura: "Têm o perfil e não foram cadastradas: furo do handoff.",
      tom: "atencao",
      passo: "2-real",
    },
    {
      id: "sem_cnpj",
      titulo: "Sem CNPJ",
      empresas: semCnpj.length,
      valor: null,
      leitura: "Nem o contrato, nem o Pipedrive, nem a Base têm o CNPJ: não dá para saber o que aconteceu com elas.",
      tom: "neutro",
      passo: "1-sem_cnpj",
    },
  ];
  return acoes.filter((a) => a.empresas > 0);
}

// ─── Fila de cobrança ────────────────────────────────────────────────────────────────────────────

export const GRUPOS_FILA = ["aceitou", "atraso", "90", "30_90", "recente"] as const;
export type GrupoFila = (typeof GRUPOS_FILA)[number];
export const ROTULO_GRUPO: Record<GrupoFila, { titulo: string; tom: TomMotivo }> = {
  aceitou: { titulo: "Disse sim, não faturamos", tom: "perigo" },
  atraso: { titulo: "Faturado em atraso", tom: "perigo" },
  "90": { titulo: "Dinheiro parado há mais de 90 dias", tom: "perigo" },
  "30_90": { titulo: "Dinheiro parado há 30 a 90 dias", tom: "atencao" },
  recente: { titulo: "Diagnóstico recente", tom: "info" },
};

export const RESULTADOS = ["vai_seguir", "pediu_tempo", "sem_resposta", "nao_quer", "ja_resolvido"] as const;
export type Resultado = (typeof RESULTADOS)[number];
export const ROTULO_RESULTADO: Record<Resultado, { rotulo: string; tom: TomMotivo }> = {
  vai_seguir: { rotulo: "Vai seguir", tom: "info" },
  pediu_tempo: { rotulo: "Pediu tempo", tom: "atencao" },
  sem_resposta: { rotulo: "Sem resposta", tom: "atencao" },
  nao_quer: { rotulo: "Não quer", tom: "neutro" },
  ja_resolvido: { rotulo: "Já resolvido", tom: "info" },
};

export interface ItemFila {
  e: EmpresaFunil;
  grupo: GrupoFila;
  /** O dinheiro em jogo: aceito (disse sim), em atraso (faturado) ou identificado (parado). */
  valor: number;
  diasDesdeEntrega: number | null;
  /** O último contato: o registro no Brain ou o follow-up escrito na plataforma, o mais recente. */
  ultimoContato: { em: string; por: string | null; fonte: "brain" | "plataforma" } | null;
  diasSemContato: number | null;
}

/** Quem a Jordana cobra, na ordem: disse sim; faturado em atraso; dinheiro parado, do mais antigo; maior valor primeiro. */
export function montarFila(empresas: EmpresaFunil[], hoje: string): ItemFila[] {
  const ordem = new Map(GRUPOS_FILA.map((g, i) => [g, i]));
  const itens: ItemFila[] = [];
  for (const e of empresas) {
    if (!e.cliente_id) continue;
    const n = nivelDe(e);
    const atraso = num(e.em_atraso);
    let grupo: GrupoFila | null = null;
    let valor = 0;
    if (n === 6) {
      grupo = "aceitou";
      valor = num(e.aceito) || num(e.garantido);
    } else if (atraso > 0) {
      grupo = "atraso";
      valor = atraso;
    } else if (n === 5) {
      const m = motivoDe(e, hoje);
      grupo = m === "mais_90" ? "90" : m === "30_90" ? "30_90" : "recente";
      valor = num(e.identificado);
    }
    if (!grupo) continue;
    const doBrain = e.registro ? { em: e.registro.em, por: e.registro.autor, fonte: "brain" as const } : null;
    const daPlataforma = e.ultimo_fup ? { em: e.ultimo_fup, por: null, fonte: "plataforma" as const } : null;
    const ultimoContato =
      doBrain && daPlataforma
        ? doBrain.em >= daPlataforma.em
          ? doBrain
          : daPlataforma
        : (doBrain ?? daPlataforma);
    itens.push({
      e,
      grupo,
      valor,
      diasDesdeEntrega: dias(e.entregue_em, hoje),
      ultimoContato,
      diasSemContato: ultimoContato ? dias(ultimoContato.em, hoje) : null,
    });
  }
  return itens.sort(
    (a, b) => (ordem.get(a.grupo) ?? 9) - (ordem.get(b.grupo) ?? 9) || b.valor - a.valor,
  );
}

export function resumoFila(itens: ItemFila[]) {
  return {
    empresas: itens.length,
    valor: itens.reduce((s, x) => s + x.valor, 0),
    contatadas7: itens.filter((x) => x.diasSemContato !== null && x.diasSemContato <= 7).length,
    nuncaContatadas: itens.filter((x) => !x.ultimoContato).length,
  };
}
