// Financeiro do grupo para o Cockpit do CEO: ponte de faturamento por cliente, emitido × recebido,
// inadimplência, caixa livre e margem por grupo de apuração.
//
// A fonte é o projeto Financial Brain (itpddzjfrgrbathcqbpo), o mesmo que a tela do Brain Financeiro
// lê em produção. A cópia do schema `financeiro` no banco único parou no corte de 02/09 e diverge
// ~10% da tela (docs/dev_notes/cockpit-ceo-empresa/diagnostico.md §0). Nenhuma regra de receita é
// refeita aqui: faturamento, recebido, inadimplência, caixa e margem vêm das funções oficiais.
// O que este módulo faz é validar o payload, descartar identidade de cliente e agregar.
//
// A ponte é a única conta própria, e fecha por construção com o total da fonte: cada cliente cai
// em exatamente um movimento, em centavos. Quando a soma das linhas por cliente não bate com a
// série da própria função, a ponte do mês sai como "não fecha", com a diferença à mostra.
//
// Tudo aqui é puro. Quem chama traz o payload já lido no servidor.

const cent = (v: number) => Math.round(v * 100);
const numero = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const mesDe = (x: unknown): string | null =>
  typeof x === "string" && /^\d{4}-\d{2}/.test(x) ? x.slice(0, 7) : null;
const mesAnterior = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);

function formatoInesperado(fonte: string, onde: string): never {
  throw new Error(`${fonte} em formato inesperado (${onde}).`);
}

// ── Ponte de faturamento por cliente ─────────────────────────────────────────

/** Faturamento por cliente e mês, em centavos. Só existe no servidor: tem o nome do cliente. */
export interface FaturamentoPorCliente {
  /** cliente → mês ("AAAA-MM") → centavos. Mês ausente = nenhum lançamento (não é zero). */
  clientes: Map<string, Map<string, number>>;
  /** Linha da fonte sem cliente preenchido, por mês, em centavos. */
  semCliente: Record<string, number>;
  /** Receita com cliente por mês, como a série da própria função declara (centavos). */
  comClienteDaSerie: Record<string, number>;
  meses: string[];
}

/** Lê `linhas`, `serie` e `sem_cliente` de `fn_faturamento_mensal` chamada sem limite de clientes. */
export function extrairPorCliente(cru: unknown): FaturamentoPorCliente {
  const F = "Faturamento por cliente do Financeiro";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = cru as any;
  if (!j || !Array.isArray(j.linhas) || !Array.isArray(j.serie))
    formatoInesperado(F, "linhas/serie");
  if (j.truncado?.aplicado === true)
    throw new Error(
      `${F} veio cortado (limite de clientes aplicado): a ponte exige todas as linhas.`,
    );
  const clientes = new Map<string, Map<string, number>>();
  for (const l of j.linhas) {
    const nome = typeof l?.cliente === "string" ? l.cliente : null;
    if (!nome || !Array.isArray(l.meses)) formatoInesperado(F, "linha de cliente");
    const porMes = clientes.get(nome) ?? new Map<string, number>();
    for (const m of l.meses) {
      const mes = mesDe(m?.competencia);
      if (!mes) formatoInesperado(F, "mês da linha");
      const v = numero(m.receita);
      if (v === null) continue; // null = nenhum lançamento naquele mês
      porMes.set(mes, (porMes.get(mes) ?? 0) + cent(v));
    }
    clientes.set(nome, porMes);
  }
  const comClienteDaSerie: Record<string, number> = {};
  const meses: string[] = [];
  for (const s of j.serie) {
    const mes = mesDe(s?.competencia);
    const v = numero(s?.receita_com_cliente);
    if (!mes || v === null) formatoInesperado(F, "série");
    comClienteDaSerie[mes] = cent(v);
    meses.push(mes);
  }
  const semCliente: Record<string, number> = {};
  for (const p of Array.isArray(j.sem_cliente?.por_mes) ? j.sem_cliente.por_mes : []) {
    const mes = mesDe(p?.competencia);
    const v = numero(p?.receita);
    if (mes && v !== null) semCliente[mes] = cent(v);
  }
  return { clientes, semCliente, comClienteDaSerie, meses: [...new Set(meses)].sort() };
}

export interface Movimento {
  clientes: number;
  /** Reais; positivo soma na ponte, negativo subtrai. */
  valor: number;
}

export interface PonteMes {
  mes: string;
  anterior: number;
  atual: number;
  novos: Movimento;
  retornos: Movimento;
  expansao: Movimento;
  contracao: Movimento;
  semFaturamento: Movimento;
  estaveis: number;
  /** Variação da linha sem cliente identificado (não vira cliente). */
  semCliente: number;
  /** A soma das parcelas reconstrói o mês E as linhas por cliente batem com a série da fonte. */
  fecha: boolean;
  /** Diferença, em reais, entre as linhas por cliente e a série da fonte (0 quando fecha). */
  diferencaFonte: number;
  clientesNoMes: number;
}

export interface Ponte {
  /** Primeiro mês com faturamento na janela lida: "novo" significa "sem faturamento desde ele". */
  historicoDesde: string | null;
  meses: PonteMes[];
}

const mov = (): { clientes: number; c: number } => ({ clientes: 0, c: 0 });

/**
 * Ponte mês a mês sobre os meses FECHADOS contíguos da fonte. Cada cliente cai num só movimento:
 * faturou em M−1 e M → expansão, contração ou estável; só em M → novo (nunca antes na janela) ou
 * retorno; só em M−1 → sem faturamento no mês (régua de emissão: não é churn confirmado).
 * "Faturou" = soma do mês diferente de zero.
 */
export function montarPonte(f: FaturamentoPorCliente, fechados: string[]): Ponte {
  const meses = [...fechados].sort();
  const historicoDesde = f.meses[0] ?? null;
  const resultado: PonteMes[] = [];
  for (const mes of meses) {
    const ant = mesAnterior(mes);
    if (!meses.includes(ant)) continue; // precisa do mês anterior fechado
    const novos = mov();
    const retornos = mov();
    const expansao = mov();
    const contracao = mov();
    const sem = mov();
    let estaveis = 0;
    let somaAnt = 0;
    let somaAtual = 0;
    let clientesNoMes = 0;
    for (const porMes of f.clientes.values()) {
      const a = porMes.get(ant) ?? 0;
      const b = porMes.get(mes) ?? 0;
      somaAnt += a;
      somaAtual += b;
      if (b !== 0) clientesNoMes += 1;
      if (a !== 0 && b !== 0) {
        const d = b - a;
        if (d > 0) {
          expansao.clientes += 1;
          expansao.c += d;
        } else if (d < 0) {
          contracao.clientes += 1;
          contracao.c += d;
        } else estaveis += 1;
      } else if (b !== 0) {
        const antes = [...porMes.entries()].some(([m, v]) => m < ant && v !== 0);
        const alvo = antes ? retornos : novos;
        alvo.clientes += 1;
        alvo.c += b;
      } else if (a !== 0) {
        sem.clientes += 1;
        sem.c -= a;
      }
    }
    const scAnt = f.semCliente[ant] ?? 0;
    const scAtual = f.semCliente[mes] ?? 0;
    const anterior = somaAnt + scAnt;
    const atual = somaAtual + scAtual;
    const reconstruido =
      anterior + novos.c + retornos.c + expansao.c + contracao.c + sem.c + (scAtual - scAnt);
    const serieAnt = f.comClienteDaSerie[ant];
    const serieAtual = f.comClienteDaSerie[mes];
    // Cada mês confere sozinho com a série da fonte: somar as duas diferenças deixaria um erro
    // compensar o outro.
    const diferenca =
      serieAnt === undefined || serieAtual === undefined
        ? null
        : Math.abs(somaAnt - serieAnt) + Math.abs(somaAtual - serieAtual);
    const r = (x: { clientes: number; c: number }): Movimento => ({
      clientes: x.clientes,
      valor: x.c / 100,
    });
    resultado.push({
      mes,
      anterior: anterior / 100,
      atual: atual / 100,
      novos: r(novos),
      retornos: r(retornos),
      expansao: r(expansao),
      contracao: r(contracao),
      semFaturamento: r(sem),
      estaveis,
      semCliente: (scAtual - scAnt) / 100,
      fecha: reconstruido === atual && diferenca === 0,
      diferencaFonte: diferenca === null ? NaN : diferenca / 100,
      clientesNoMes,
    });
  }
  return { historicoDesde, meses: resultado };
}

// ── Emitido × recebido ───────────────────────────────────────────────────────

export interface EmitidoRecebidoMes {
  mes: string;
  emitido: number;
  recebido: number;
  emAberto: number;
  /**
   * Recebido acumulado até a foto sobre o emitido do mês (0..1). `null` quando a foto de títulos
   * não alcança o mês: ali o recebido da fonte está superestimado (a própria função avisa).
   */
  pctRecebido: number | null;
  /**
   * Como ler o mês, pela distância até a foto de títulos em aberto (`meses_ate_a_foto`):
   * maduro (2+ meses antes), prazo (títulos que ainda nem venceram), piso (a foto cobre só parte do
   * mês: o não recebido é mínimo) e sem_foto (nada medido).
   */
  leitura: "maduro" | "prazo" | "piso" | "sem_foto";
  alerta: string | null;
}

export interface EmitidoRecebido {
  definicao: string;
  foto: string | null;
  meses: EmitidoRecebidoMes[];
}

/** `fn_receita_emitido_recebido`: recebido é ACUMULADO ATÉ A FOTO, por mês de emissão. */
export function extrairEmitidoRecebido(cru: unknown): EmitidoRecebido {
  const F = "Emitido × recebido do Financeiro";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = cru as any;
  if (!j || !Array.isArray(j.serie)) formatoInesperado(F, "serie");
  const meses = j.serie.map((s: unknown): EmitidoRecebidoMes => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = s as any;
    const mes = mesDe(x?.competencia);
    const emitido = numero(x?.reconhecido);
    const recebido = numero(x?.recebido);
    const emAberto = numero(x?.em_aberto);
    const distancia = numero(x?.meses_ate_a_foto);
    if (!mes || emitido === null || recebido === null || emAberto === null || distancia === null)
      formatoInesperado(F, "mês");
    const leitura =
      distancia < -1 ? "sem_foto" : distancia === -1 ? "piso" : distancia <= 1 ? "prazo" : "maduro";
    return {
      mes,
      emitido,
      recebido,
      emAberto,
      pctRecebido: leitura === "sem_foto" ? null : numero(x?.pct_recebido),
      leitura,
      alerta: typeof x?.alerta === "string" ? x.alerta : null,
    };
  });
  const foto = mesDe(j.snapshot_ref);
  return {
    definicao: typeof j.definicao === "string" ? j.definicao : "",
    foto,
    meses: meses.sort((a: EmitidoRecebidoMes, b: EmitidoRecebidoMes) => a.mes.localeCompare(b.mes)),
  };
}

// ── Inadimplência ao vivo ────────────────────────────────────────────────────

export interface Inadimplencia {
  hoje: string | null;
  sincronizadoEm: string | null;
  emAberto: number;
  atrasado: number;
  titulosAtrasados: number;
  faixas: { faixa: string; valor: number; titulos: number }[];
  empresasSemSync: string[];
}

/** `fn_inadimplencia_live`: só agregados; a lista por cliente é descartada. */
export function extrairInadimplencia(cru: unknown): Inadimplencia {
  const F = "Inadimplência do Financeiro";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = cru as any;
  const emAberto = numero(j?.totais?.em_aberto);
  const atrasado = numero(j?.totais?.previsto_atrasado);
  if (emAberto === null || atrasado === null) formatoInesperado(F, "totais");
  const faixas = (Array.isArray(j.faixas_de_atraso) ? j.faixas_de_atraso : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((f: any) => ({
      faixa: String(f?.faixa ?? ""),
      valor: numero(f?.valor) ?? 0,
      titulos: numero(f?.titulos) ?? 0,
    }))
    .filter((f: { faixa: string }) => f.faixa);
  return {
    hoje: typeof j.hoje === "string" ? j.hoje : null,
    sincronizadoEm: typeof j.sincronizado_em === "string" ? j.sincronizado_em : null,
    emAberto,
    atrasado,
    titulosAtrasados: numero(j?.totais?.titulos_atrasados) ?? 0,
    faixas,
    empresasSemSync: (Array.isArray(j?.cobertura?.sem_sync) ? j.cobertura.sem_sync : []).map(
      String,
    ),
  };
}

// ── Margem por grupo de apuração e caixa livre ───────────────────────────────

export interface MargemGrupo {
  grupo: string;
  receitaBruta: number;
  lucroBruto: number;
  resultado: number;
  empresas: number;
}

export interface IndicadoresFinanceiros {
  de: string | null;
  ate: string | null;
  receitaBruta: number | null;
  lucroBruto: number | null;
  margem: number | null;
  rotuloLucro: string;
  porGrupo: MargemGrupo[];
  caixa: {
    valor: number | null;
    mesReferencia: string | null;
    semDado: boolean;
    defasado: boolean;
    empresasSemSaldo: string[];
    definicao: string;
  };
}

/** `fn_cockpit_indicadores`: soma as empresas por grupo de apuração; CNPJ e razão social ficam. */
export function extrairIndicadores(cru: unknown): IndicadoresFinanceiros {
  const F = "Indicadores do Financeiro";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = cru as any;
  if (!j || !Array.isArray(j.por_empresa)) formatoInesperado(F, "por_empresa");
  const grupos = new Map<string, MargemGrupo & { cr: number; cl: number; cs: number }>();
  for (const e of j.por_empresa) {
    const g = typeof e?.grupo_apuracao === "string" ? e.grupo_apuracao : "Sem grupo";
    const x = grupos.get(g) ?? {
      grupo: g,
      receitaBruta: 0,
      lucroBruto: 0,
      resultado: 0,
      empresas: 0,
      cr: 0,
      cl: 0,
      cs: 0,
    };
    x.cr += cent(numero(e?.receita_bruta) ?? 0);
    x.cl += cent(numero(e?.lucro_bruto) ?? 0);
    x.cs += cent(numero(e?.resultado) ?? 0);
    x.empresas += 1;
    grupos.set(g, x);
  }
  const porGrupo = [...grupos.values()]
    .map(({ cr, cl, cs, ...g }) => ({
      ...g,
      receitaBruta: cr / 100,
      lucroBruto: cl / 100,
      resultado: cs / 100,
    }))
    .sort((a, b) => b.receitaBruta - a.receitaBruta);
  const c = j.caixa_livre ?? {};
  return {
    de: mesDe(j.escopo?.comp_de),
    ate: mesDe(j.escopo?.comp_ate),
    receitaBruta: numero(j.receita_bruta?.valor ?? j.receita_bruta),
    lucroBruto: numero(j.lucro_bruto?.valor),
    margem: numero(j.margem_pct),
    rotuloLucro: typeof j.lucro_bruto?.rotulo === "string" ? j.lucro_bruto.rotulo : "Lucro bruto",
    porGrupo,
    caixa: {
      valor: c.sem_dado ? null : numero(c.valor),
      mesReferencia: mesDe(c.mes_referencia),
      semDado: c.sem_dado === true,
      defasado: c.defasado === true,
      empresasSemSaldo: (Array.isArray(c.cobertura?.empresas_sem_saldo)
        ? c.cobertura.empresas_sem_saldo
        : []
      ).map(String),
      definicao: typeof c.definicao === "string" ? c.definicao : "",
    },
  };
}

// ── Frescor da fonte ─────────────────────────────────────────────────────────

export interface Frescor {
  carregadoEm: string | null;
  cobreAte: string | null;
}

/** `dado_frescor` do Financial Brain, dataset `lancamentos`: a última carga que chegou. */
export function extrairFrescor(linhas: { carregado_em?: unknown; cobre_ate?: unknown }[]): Frescor {
  let carregadoEm: string | null = null;
  let cobreAte: string | null = null;
  for (const l of linhas) {
    const c = typeof l.carregado_em === "string" ? l.carregado_em : null;
    const a = typeof l.cobre_ate === "string" ? l.cobre_ate : null;
    if (c && (!carregadoEm || c > carregadoEm)) carregadoEm = c;
    if (a && (!cobreAte || a > cobreAte)) cobreAte = a;
  }
  return { carregadoEm, cobreAte };
}

/** Dias inteiros entre a carga e agora. Acima da cadência diária, a tela avisa. */
export function idadeEmDias(carregadoEm: string | null, agora: string): number | null {
  if (!carregadoEm) return null;
  const d = (Date.parse(agora) - Date.parse(carregadoEm)) / 86_400_000;
  return Number.isFinite(d) ? Math.floor(d) : null;
}

// ── Resposta da leitura de caixa (caixa.functions.ts) ────────────────────────

export type ParteCaixa<T> =
  | { estado: "ok"; dado: T }
  | {
      estado: "acesso_insuficiente" | "fonte_indisponivel";
      motivo: string;
    };

export interface RespostaCaixa {
  lidoEm: string;
  /** Janela dos indicadores: de janeiro do ano até o último mês antes do corrente. */
  janela: { de: string; ate: string };
  emitidoRecebido: ParteCaixa<EmitidoRecebido>;
  inadimplencia: ParteCaixa<Inadimplencia>;
  indicadores: ParteCaixa<IndicadoresFinanceiros>;
}
