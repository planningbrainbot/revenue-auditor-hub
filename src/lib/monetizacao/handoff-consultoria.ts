// Régua da tela Handoff Consultoria (`/monetizacao?aba=handoff-consultoria`).
// Contrato: docs/design/contratos/monetizacao-handoff-consultoria.md. Pura: recebe o que o RPC
// `ops.handoff_consultoria_painel()` devolve e calcula tudo que a tela mostra, para a tela, os testes
// (tests/monetizacao-handoff-consultoria.test.mjs) e a conferência
// (scripts/monetizacao/conferir-handoff-consultoria.mjs) usarem a mesma conta.
//
// Unidade de contagem: cliente = CNPJ distinto; card sem CNPJ conta como cliente próprio.
// Dinheiro da PAT: do mês da chegada à Consultoria em diante. As porcentagens vêm da tabela de regras.
// Trabalho e crédito recuperado: da plataforma da Consultoria (projetos e créditos por cliente, API desde 05/10).

export type ChaveRegra =
  "repasse_expansao" | "repasse_unidade" | "fee_estimado" | "exclui_cliente_previo_pat";

export interface Regra {
  chave: ChaveRegra;
  valor: number;
  vigente_desde: string;
  situacao: "proposta" | "confirmada";
  origem: string;
}

export interface MesPat {
  mes: string;
  faturado: number;
  creditos: number;
  recebido: number;
  cliente_omie: string | null;
}

export interface ProjetoConsultoria {
  produto: string | null;
  linha_produto: string | null;
  etapa: string | null;
  etapa_descricao: string | null;
  cadastrado_em: string | null;
  na_etapa_desde: string | null;
  entregue_em: string | null;
  encerrado: boolean | null;
  encerrado_em: string | null;
  valor_identificado: number | null;
}

export interface ClienteBruto {
  card: string;
  titulo: string;
  unidade: string | null;
  unidade_id: number | null;
  fase: string | null;
  criado_em: string | null;
  venda_em: string | null;
  kickoff_em: string | null;
  encaminhado: "Sim" | "Não" | null;
  cnpj: string | null;
  cnpj_fonte: string | null;
  faixa: string | null;
  faixa_ordem: number | null;
  faixa_fonte: string | null;
  consultoria: {
    cadastrado_em: string;
    via: "cnpj" | "raiz";
    ativo: boolean | null;
    inativo_desde: string | null;
    valor_a_recuperar: number | null;
    valor_a_recuperar_em: string | null;
    /** Campos da API da plataforma desde 05/10/2026 (ausentes antes disso). */
    valor_identificado?: number | null;
    credito_aprovado?: number | null;
    credito_recuperado?: number | null;
    credito_saldo?: number | null;
    credito_ultima_recuperacao_em?: string | null;
    projetos?: ProjetoConsultoria[] | null;
  } | null;
  propostas: number;
  pat: MesPat[] | null;
}

export interface PainelBruto {
  lido_em: string;
  todas_unidades: boolean;
  porta_financeiro: { aberta: boolean; motivo: string | null };
  regras: Regra[];
  frescor: {
    onboarding: string | null;
    consultoria: string | null;
    pat: string | null;
    financeiro_carregado_em: string | null;
  };
  clientes: ClienteBruto[];
}

/** Dia da carga inicial da plataforma da Consultoria (455 cadastros de uma vez, não entrada real). */
export const CARGA_INICIAL_CONSULTORIA = "2026-07-26";
/** Primeiro mês do painel: o handoff do onboarding para a Consultoria começa em jul/2026. */
export const INICIO_PADRAO = "2026-07-01";
export const SEM_FAIXA = "Sem faixa declarada";

/** Data em São Paulo (aaaa-mm-dd) de um instante ou de uma data. */
export function diaSP(v: string | null | undefined): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

const mesDe = (d: string | null) => (d ? d.slice(0, 7) : null);

/** Meses aaaa-mm de `de` a `ate`, inclusive. */
export function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  let [a, m] = [Number(de.slice(0, 4)), Number(de.slice(5, 7))];
  const fim = ate.slice(0, 7);
  for (let i = 0; i < 240; i++) {
    const k = `${a}-${String(m).padStart(2, "0")}`;
    if (k > fim) break;
    out.push(k);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
  }
  return out;
}

/** A regra vigente de cada chave em `hoje`: a de `vigente_desde` mais recente que já começou. */
export function regrasVigentes(regras: Regra[], hoje: string) {
  const vig = (chave: ChaveRegra) =>
    regras
      .filter((r) => r.chave === chave && r.vigente_desde <= hoje)
      .sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))[0] ?? null;
  const expansao = vig("repasse_expansao");
  const unidade = vig("repasse_unidade");
  const fee = vig("fee_estimado");
  const exclui = vig("exclui_cliente_previo_pat");
  const todas = [expansao, unidade, fee, exclui].filter(Boolean) as Regra[];
  return {
    expansao: expansao ? Number(expansao.valor) : null,
    unidade: unidade ? Number(unidade.valor) : null,
    fee: fee ? Number(fee.valor) : null,
    excluiPrevio: exclui ? Number(exclui.valor) === 1 : true,
    proposta: todas.some((r) => r.situacao === "proposta"),
    lista: todas,
  };
}
export type Regras = ReturnType<typeof regrasVigentes>;

export interface Cliente {
  chave: string;
  card: string;
  titulo: string;
  unidade: string;
  fase: string | null;
  cnpj: string | null;
  cnpjFonte: string | null;
  faixa: string;
  faixaOrdem: number;
  entrada: string | null;
  kickoff: string | null;
  encaminhado: boolean;
  chegada: string | null;
  cargaInicial: boolean;
  via: "cnpj" | "raiz" | null;
  propostas: number;
  valorARecuperar: number | null;
  projetos: ProjetoConsultoria[];
  /** Etapa do projeto aberto mais recente na plataforma. */
  etapa: string | null;
  identificado: number | null;
  aprovado: number | null;
  /** Crédito já recuperado para o cliente, acumulado na plataforma. `null` = a plataforma não informa. */
  recuperado: number | null;
  saldo: number | null;
  ultimaRecuperacao: string | null;
  /** A PAT já faturava ou recebia do cliente antes do mês da chegada. `null` sem a porta do Financeiro. */
  jaPagavaPat: boolean | null;
  /** Por mês, do mês da chegada em diante. */
  porMes: Record<string, { faturado: number; creditos: number; recebido: number }>;
  trabalhado: boolean;
  mesTrabalho: string | null;
  recebido: number;
  creditos: number;
  /** Entra na base do repasse. */
  naBase: boolean;
}

/** Um cliente por CNPJ: fica o card de entrada mais antiga; "Sim" em qualquer card vale. */
function deduplicar(brutos: ClienteBruto[]) {
  const porChave = new Map<string, ClienteBruto[]>();
  for (const b of brutos) {
    const k = b.cnpj ?? `card:${b.card}`;
    porChave.set(k, [...(porChave.get(k) ?? []), b]);
  }
  return [...porChave.entries()].map(([chave, cs]) => {
    const entrada = (c: ClienteBruto) => c.venda_em ?? diaSP(c.criado_em) ?? "9999";
    const ordem = [...cs].sort(
      (a, b) => entrada(a).localeCompare(entrada(b)) || a.card.localeCompare(b.card),
    );
    return { chave, base: ordem[0], encaminhado: cs.some((c) => c.encaminhado === "Sim") };
  });
}

export function clientesDoPainel(bruto: PainelBruto, regras: Regras): Cliente[] {
  return deduplicar(bruto.clientes).map(({ chave, base: b, encaminhado }) => {
    const chegada = diaSP(b.consultoria?.cadastrado_em);
    const mesCheg = mesDe(chegada);
    const pat = bruto.porta_financeiro.aberta ? (b.pat ?? []) : null;
    const porMes: Cliente["porMes"] = {};
    let jaPagavaPat: boolean | null = pat ? false : null;
    for (const p of pat ?? []) {
      const m = p.mes.slice(0, 7);
      if (mesCheg && m >= mesCheg)
        porMes[m] = {
          faturado: Number(p.faturado) || 0,
          creditos: Number(p.creditos) || 0,
          recebido: Number(p.recebido) || 0,
        };
      else if ((Number(p.faturado) || 0) > 0 || (Number(p.recebido) || 0) > 0) jaPagavaPat = true;
    }
    const meses = Object.keys(porMes).sort();
    const recebido = meses.reduce((s, m) => s + porMes[m].recebido, 0);
    const creditos = meses.reduce((s, m) => s + porMes[m].creditos, 0);
    const comReceita = meses.filter((m) => porMes[m].faturado > 0 || porMes[m].recebido > 0);
    const cons = b.consultoria;
    const valorARecuperar = cons?.valor_a_recuperar ?? null;
    const projetos = cons?.projetos ?? [];
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const trabalhado =
      !!chegada &&
      (projetos.length > 0 || b.propostas > 0 || valorARecuperar !== null || comReceita.length > 0);
    // Mês do trabalho: o primeiro sinal (projeto, receita ou valor apurado), nunca antes da chegada.
    const sinais = [
      ...projetos.map((x) => mesDe(diaSP(x.cadastrado_em))),
      comReceita[0] ?? null,
      mesDe(diaSP(cons?.valor_a_recuperar_em)),
    ].filter((x): x is string => !!x);
    const primeiro = sinais.sort()[0] ?? mesCheg;
    const mesTrabalho = !trabalhado
      ? null
      : primeiro && mesCheg && primeiro < mesCheg
        ? mesCheg
        : primeiro;
    const aberto = [...projetos]
      .filter((x) => !x.encerrado)
      .sort((x, y) => (y.cadastrado_em ?? "").localeCompare(x.cadastrado_em ?? ""))[0];
    return {
      chave,
      card: b.card,
      titulo: b.titulo,
      unidade: b.unidade ?? "Sem unidade",
      fase: b.fase,
      cnpj: b.cnpj,
      cnpjFonte: b.cnpj_fonte,
      faixa: b.faixa ?? SEM_FAIXA,
      faixaOrdem: b.faixa_ordem ?? 999,
      entrada: b.venda_em ?? diaSP(b.criado_em),
      kickoff: b.kickoff_em,
      encaminhado,
      chegada,
      cargaInicial: chegada === CARGA_INICIAL_CONSULTORIA,
      via: b.consultoria?.via ?? null,
      propostas: b.propostas,
      valorARecuperar,
      projetos,
      etapa: aberto?.etapa_descricao ?? null,
      identificado: num(cons?.valor_identificado),
      aprovado: num(cons?.credito_aprovado),
      recuperado: num(cons?.credito_recuperado),
      saldo: num(cons?.credito_saldo),
      ultimaRecuperacao: cons?.credito_ultima_recuperacao_em ?? null,
      jaPagavaPat,
      porMes,
      trabalhado,
      mesTrabalho,
      recebido,
      creditos,
      naBase: !!chegada && recebido > 0 && !(regras.excluiPrevio && jaPagavaPat === true),
    };
  });
}

export interface MesPainel {
  mes: string;
  chegaram: Cliente[];
  cargaInicial: number;
  encaminhados: Cliente[];
  trabalhados: Cliente[];
  recuperado: number | null;
  recebido: number | null;
  fora: number | null;
  base: number | null;
  expansao: number | null;
  unidade: number | null;
}

export interface EtapaFunil {
  id: "onboarding" | "consultoria" | "trabalhados" | "identificado" | "recuperado";
  rotulo: string;
  clientes: Cliente[];
  /** Etapa ÷ etapa de cima, inteiro em %. Nulo na primeira. */
  taxa: number | null;
}

export interface Painel {
  de: string;
  ate: string;
  meses: string[];
  unidades: string[];
  regras: Regras;
  porta: PainelBruto["porta_financeiro"];
  frescor: PainelBruto["frescor"];
  lidoEm: string;
  todos: Cliente[];
  chegaram: Cliente[];
  trabalhados: Cliente[];
  dinheiro: {
    /** Crédito recuperado dos clientes que chegaram no período: o da plataforma ou, sem ele, o estimado. */
    recuperado: number | null;
    recuperadoFonte: "plataforma" | "estimado";
    identificado: number | null;
    recebido: number | null;
    base: number | null;
    fora: number | null;
    expansao: number | null;
    unidade: number | null;
  };
  porMes: MesPainel[];
  funil: EtapaFunil[];
  faixas: { faixa: string; ordem: number; chegaram: Cliente[]; noOnboarding: Cliente[] }[];
  porUnidade: {
    unidade: string;
    base: number;
    expansao: number | null;
    unidade_: number | null;
    clientes: Cliente[];
  }[];
  atencao: {
    encaminhadosFora: Cliente[];
    semCnpj: Cliente[];
    /** A plataforma não mandou projeto, crédito nem valor a recuperar de nenhum cliente que chegou. */
    plataformaSemStatus: boolean;
  };
}

const soma = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const arred = (v: number) => Math.round(v * 100) / 100;

export function montarPainel(
  bruto: PainelBruto,
  filtro: { de?: string; ate?: string; unidade?: string },
  hoje: string,
): Painel {
  const de = filtro.de ?? INICIO_PADRAO;
  const ate = filtro.ate ?? hoje;
  const meses = mesesEntre(de, ate);
  const regras = regrasVigentes(bruto.regras, hoje);
  const todosBrutos = clientesDoPainel(bruto, regras);
  const unidades = [...new Set(todosBrutos.map((c) => c.unidade))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const todos = filtro.unidade
    ? todosBrutos.filter((c) => c.unidade === filtro.unidade)
    : todosBrutos;
  const naJanela = (d: string | null) => !!d && d >= de && d <= ate;
  const chegaram = todos.filter((c) => naJanela(c.chegada));
  const trabalhados = chegaram.filter((c) => c.trabalhado);
  const comPorta = bruto.porta_financeiro.aberta;
  // A plataforma informa o crédito recuperado desde 05/10; o fee só estima quando ela não informa.
  const daPlataforma = chegaram.some((c) => c.recuperado !== null);
  const fee = daPlataforma ? null : regras.fee;

  const porMes: MesPainel[] = meses.map((m) => {
    const recebido = soma(todos.map((c) => c.porMes[m]?.recebido ?? 0));
    const base = soma(todos.filter((c) => c.naBase).map((c) => c.porMes[m]?.recebido ?? 0));
    const creditos = soma(todos.map((c) => c.porMes[m]?.creditos ?? 0));
    return {
      mes: m,
      chegaram: chegaram.filter((c) => mesDe(c.chegada) === m),
      cargaInicial: chegaram.filter((c) => mesDe(c.chegada) === m && c.cargaInicial).length,
      encaminhados: todos.filter((c) => c.encaminhado && mesDe(c.kickoff ?? c.entrada) === m),
      trabalhados: todos.filter((c) => c.mesTrabalho === m),
      recuperado: comPorta && fee ? arred(creditos / fee) : null,
      recebido: comPorta ? arred(recebido) : null,
      fora: comPorta ? arred(recebido - base) : null,
      base: comPorta ? arred(base) : null,
      expansao: comPorta && regras.expansao !== null ? arred(base * regras.expansao) : null,
      unidade: comPorta && regras.unidade !== null ? arred(base * regras.unidade) : null,
    };
  });
  const somaMeses = (k: "recuperado" | "recebido" | "base" | "fora" | "expansao" | "unidade") =>
    porMes.some((x) => x[k] === null) ? null : arred(soma(porMes.map((x) => x[k] as number)));

  // Funil: o pipe inteiro (estoque), do onboarding ao crédito recuperado; não segue o período.
  // Cada etapa é a de cima com mais uma condição, então só desce.
  const naConsultoria = todos.filter((c) => c.chegada);
  const trabalhadosTodos = naConsultoria.filter((c) => c.trabalhado);
  // Quem já recuperou teve crédito identificado, mesmo que a plataforma mande o identificado zerado
  // (Universal Stok, 05/10): sem isso o funil perderia um cliente que o número do topo soma.
  const comIdentificado = trabalhadosTodos.filter(
    (c) => (c.identificado ?? 0) > 0 || (c.recuperado ?? 0) > 0,
  );
  const etapas: Omit<EtapaFunil, "taxa">[] = [
    { id: "onboarding", rotulo: "No onboarding", clientes: todos },
    { id: "consultoria", rotulo: "Na Consultoria", clientes: naConsultoria },
    { id: "trabalhados", rotulo: "Trabalhados", clientes: trabalhadosTodos },
    { id: "identificado", rotulo: "Crédito identificado", clientes: comIdentificado },
    {
      id: "recuperado",
      rotulo: "Crédito recuperado",
      clientes: comIdentificado.filter((c) => (c.recuperado ?? 0) > 0),
    },
  ];
  const funil = etapas.map((e, i) => ({
    ...e,
    taxa:
      i === 0
        ? null
        : etapas[i - 1].clientes.length
          ? Math.round((e.clientes.length / etapas[i - 1].clientes.length) * 100)
          : null,
  }));

  const faixasMapa = new Map<
    string,
    { faixa: string; ordem: number; chegaram: Cliente[]; noOnboarding: Cliente[] }
  >();
  for (const c of todos) {
    const f = faixasMapa.get(c.faixa) ?? {
      faixa: c.faixa,
      ordem: c.faixaOrdem,
      chegaram: [],
      noOnboarding: [],
    };
    f.noOnboarding.push(c);
    if (naJanela(c.chegada)) f.chegaram.push(c);
    faixasMapa.set(c.faixa, f);
  }
  const faixas = [...faixasMapa.values()].sort(
    (a, b) => a.ordem - b.ordem || a.faixa.localeCompare(b.faixa),
  );

  const unidadesMapa = new Map<string, Cliente[]>();
  for (const c of todos.filter((x) => x.naBase))
    unidadesMapa.set(c.unidade, [...(unidadesMapa.get(c.unidade) ?? []), c]);
  const porUnidade = [...unidadesMapa.entries()]
    .map(([unidade, cs]) => {
      const base = arred(soma(cs.map((c) => soma(meses.map((m) => c.porMes[m]?.recebido ?? 0)))));
      return {
        unidade,
        base,
        expansao: regras.expansao !== null ? arred(base * regras.expansao) : null,
        unidade_: regras.unidade !== null ? arred(base * regras.unidade) : null,
        clientes: cs,
      };
    })
    .filter((u) => u.base > 0)
    .sort((a, b) => b.base - a.base);

  return {
    de,
    ate,
    meses,
    unidades,
    regras,
    porta: bruto.porta_financeiro,
    frescor: bruto.frescor,
    lidoEm: bruto.lido_em,
    todos,
    chegaram,
    trabalhados,
    dinheiro: {
      recuperado: daPlataforma
        ? arred(soma(chegaram.map((c) => c.recuperado ?? 0)))
        : somaMeses("recuperado"),
      recuperadoFonte: daPlataforma ? "plataforma" : "estimado",
      identificado: chegaram.some((c) => c.identificado !== null)
        ? arred(soma(chegaram.map((c) => c.identificado ?? 0)))
        : null,
      recebido: somaMeses("recebido"),
      base: somaMeses("base"),
      fora: somaMeses("fora"),
      expansao: somaMeses("expansao"),
      unidade: somaMeses("unidade"),
    },
    porMes,
    funil,
    faixas,
    porUnidade,
    atencao: {
      encaminhadosFora: todos.filter((c) => c.encaminhado && !c.chegada),
      semCnpj: todos.filter((c) => !c.cnpj),
      plataformaSemStatus:
        naConsultoria.length > 0 &&
        naConsultoria.every(
          (c) => !c.projetos.length && c.valorARecuperar === null && c.recuperado === null,
        ),
    },
  };
}
