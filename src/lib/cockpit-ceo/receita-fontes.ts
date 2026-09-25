// Leituras candidatas do faturamento, montadas a partir das réguas que a casa já usa.
//
// Grupo: `financeiro.fn_faturamento_mensal`, a função da tela de Faturamento do Brain Financeiro.
// Definição (DRE 1.1 por emissão), notas canceladas, exclusões da controladoria, recortes padrão e
// meses parciais são dela; o cockpit não soma lançamento nenhum.
//
// Rede: `ops.royalties_apuracao` confirmada, `receita_base + receita_base_antiga` — a régua que o
// DECISIONS.md adotou em 26/08/2026 para o faturamento das unidades (a do Funil, por
// `data_competencia`, foi declarada não confiável). Mês em que uma unidade já inaugurada não tem
// apuração confirmada é mês parcial, não mês de faturamento menor.
//
// Tudo aqui é puro. Quem chama traz o dado já lido com a sessão da pessoa.
import type { Destino, Estado } from "./contrato.ts";
import { mesBr } from "./receita.ts";
import type { LeituraReceita, LinhaMensal } from "./receita.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (v: number) => BRL.format(v);
const cent = (v: number) => Math.round(v * 100);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const numero = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const mesDe = (x: unknown): string | null =>
  typeof x === "string" && /^\d{4}-\d{2}/.test(x) ? x.slice(0, 7) : null;

// ── Grupo ────────────────────────────────────────────────────────────────────

/** O que o cockpit guarda do payload do Faturamento: só agregado. Linha de cliente fica de fora. */
export interface FaturamentoGrupo {
  definicao: string;
  serie: { mes: string; valor: number; parcial: boolean }[];
  meses: { mes: string; parcial: boolean; motivo: string | null; semCobertura: boolean }[];
  mesesForaDaCobertura: string[];
  recortesExcluidos: string[];
  excluidoPelosRecortes: number;
  excluidoDoFaturamento: number;
  total: number;
}

function formatoInesperado(onde: string): never {
  throw new Error(`Faturamento do Financeiro em formato inesperado (${onde}).`);
}

/** Valida o payload de `fn_faturamento_mensal` e descarta tudo que não é agregado. */
export function extrairFaturamento(cru: unknown): FaturamentoGrupo {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = cru as any;
  if (!j || typeof j !== "object" || !Array.isArray(j.serie) || !Array.isArray(j.meses))
    formatoInesperado("serie/meses");
  const serie = j.serie.map((s: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = s as any;
    const mes = mesDe(x?.competencia);
    const valor = numero(x?.receita);
    if (!mes || valor === null) formatoInesperado("serie");
    return { mes, valor, parcial: x.parcial === true };
  });
  const meses = j.meses.map((s: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = s as any;
    const mes = mesDe(x?.competencia);
    if (!mes) formatoInesperado("meses");
    return {
      mes,
      parcial: x.parcial === true,
      motivo: typeof x.motivo === "string" ? x.motivo : null,
      semCobertura: x.sem_cobertura === true,
    };
  });
  const total = numero(j.totais?.receita_total_escopo);
  if (total === null) formatoInesperado("totais");
  return {
    definicao: typeof j.definicao === "string" ? j.definicao : "",
    serie,
    meses,
    mesesForaDaCobertura: (Array.isArray(j.meses_fora_da_cobertura)
      ? j.meses_fora_da_cobertura
      : []
    )
      .map(mesDe)
      .filter((m: string | null): m is string => !!m),
    recortesExcluidos: (Array.isArray(j.escopo?.recortes_excluidos)
      ? j.escopo.recortes_excluidos
      : []
    ).filter((r: unknown): r is string => typeof r === "string"),
    excluidoPelosRecortes: numero(j.excluido_pelos_recortes?.receita) ?? 0,
    excluidoDoFaturamento: numero(j.excluido_do_faturamento?.receita) ?? 0,
    total,
  };
}

const DESTINO_GRUPO: Destino = {
  rota: "/financeiro",
  search: {},
  externo: true,
  rotulo: "Abrir Faturamento no Brain Financeiro",
  mesmoRecorte: false,
  observacao:
    "O Faturamento abre por empresa, cliente e categoria; o cockpit mostra só o consolidado mensal.",
};

const BASE_GRUPO = {
  id: "grupo" as const,
  titulo: "Empresas do grupo",
  definicao:
    "Faturamento consolidado das empresas do grupo como a tela de Faturamento do Brain Financeiro mostra: receita bruta de vendas (DRE 1.1) por mês de competência da emissão, sem nota cancelada e sem as exclusões da controladoria.",
  fonte: "Brain Financeiro · Faturamento (fn_faturamento_mensal)",
  destino: DESTINO_GRUPO,
};

const vazia = (
  base: Pick<LeituraReceita, "id" | "titulo" | "definicao" | "fonte" | "destino">,
  estado: Estado,
  nota: string,
): LeituraReceita => ({ ...base, estado, nota, linhas: [], cobertura: [] });

export function montarLeituraGrupo(entrada: {
  acesso: boolean;
  motivo?: string;
  erro?: string;
  faturamento: FaturamentoGrupo | null;
}): LeituraReceita {
  if (!entrada.acesso)
    return vazia(
      BASE_GRUPO,
      "acesso_insuficiente",
      entrada.motivo ?? "Seu acesso não alcança o faturamento consolidado do grupo.",
    );
  const f = entrada.faturamento;
  if (entrada.erro || !f)
    return vazia(
      BASE_GRUPO,
      "fonte_indisponivel",
      `O Faturamento do Brain Financeiro não respondeu: ${entrada.erro ?? "sem resposta"}.`,
    );

  const cobertura: string[] = [];
  const somaSerie = f.serie.reduce((s, x) => s + cent(x.valor), 0);
  const fecha = Math.abs(somaSerie - cent(f.total)) <= 1;
  if (!fecha)
    cobertura.push(
      `A soma da série (${brl(somaSerie / 100)}) não fecha com o total da fonte (${brl(f.total)}).`,
    );
  if (f.recortesExcluidos.length)
    cobertura.push(
      `Fora deste número por padrão da tela de Faturamento: recortes ${f.recortesExcluidos.join(", ")} (${brl(f.excluidoPelosRecortes)} no período lido).`,
    );
  if (f.excluidoDoFaturamento)
    cobertura.push(
      `Categorias que a controladoria tira do Faturamento e mantém na DRE: ${brl(f.excluidoDoFaturamento)} no período lido.`,
    );
  const primeiro = f.serie.map((s) => s.mes).sort()[0];
  const antes = f.mesesForaDaCobertura.filter((m) => primeiro && m < primeiro).sort();
  if (antes.length)
    cobertura.push(
      `Sem fechamento no Financeiro de ${mesBr(antes.at(-1)!)} para trás: o histórico começa em ${mesBr(primeiro)}.`,
    );
  const semCobertura = f.meses.filter((m) => m.semCobertura).map((m) => mesBr(m.mes));
  if (semCobertura.length)
    cobertura.push(`Mês com lançamento e sem fechamento registrado: ${semCobertura.join(", ")}.`);

  const linhas: LinhaMensal[] = f.serie.map((s) => ({
    mes: s.mes,
    chave: "Grupo (consolidado)",
    valor: s.valor,
  }));
  const parciaisFonte = [
    ...new Set([
      ...f.serie.filter((s) => s.parcial).map((s) => s.mes),
      ...f.meses.filter((m) => m.parcial).map((m) => m.mes),
    ]),
  ].sort();
  const notasPorMes = Object.fromEntries(
    f.meses.filter((m) => m.motivo).map((m) => [m.mes, m.motivo as string]),
  );
  return {
    ...BASE_GRUPO,
    estado: fecha ? "disponivel" : "parcial",
    nota: null,
    linhas,
    cobertura,
    parciaisFonte,
    notasPorMes,
  };
}

// ── Rede ─────────────────────────────────────────────────────────────────────

export interface UnidadeRede {
  id: number;
  nome: string;
  tipo: string | null;
  /** Data de inauguração ("AAAA-MM-DD"); null quando o cadastro não tem. */
  inauguracao: string | null;
}

export interface ApuracaoRede {
  unidade_id: number;
  mes: string;
  status: string;
  receita_base: number | string | null;
  receita_base_antiga: number | string | null;
  /** Royalties + CSC (a soma que a apuração cobra da unidade, sem mídia). Opcionais. */
  royalties_valor?: number | string | null;
  csc_valor_fixo?: number | string | null;
  csc_base_antiga_valor?: number | string | null;
}

const DESTINO_REDE: Destino = {
  // `/royalties` só redireciona em silêncio; a tela do menu é a Apuração de Royalties (23/09).
  rota: "/unidades/royalties",
  search: {},
  rotulo: "Abrir Apuração de Royalties",
  mesmoRecorte: false,
  observacao: "A apuração abre por unidade e mês, com os itens que cada unidade assinou.",
};

const BASE_REDE = {
  id: "rede" as const,
  titulo: "Rede de unidades",
  definicao:
    "Faturamento das unidades regionais pela apuração de royalties confirmada (receita da base nova + base antiga), a régua que a unidade assina. É o faturamento das unidades com os clientes delas, não receita do grupo.",
  fonte: "Apuração de royalties (ops.royalties_apuracao, status confirmado)",
  destino: DESTINO_REDE,
};

export function montarLeituraRede(entrada: {
  acesso: boolean;
  motivo?: string;
  erro?: string;
  unidades: UnidadeRede[];
  apuracoes: ApuracaoRede[];
}): LeituraReceita {
  if (!entrada.acesso)
    return vazia(
      BASE_REDE,
      "acesso_insuficiente",
      entrada.motivo ?? "Seu acesso não alcança a apuração de royalties da rede inteira.",
    );
  if (entrada.erro)
    return vazia(
      BASE_REDE,
      "fonte_indisponivel",
      `A apuração de royalties não respondeu: ${entrada.erro}.`,
    );

  const regionais = new Map(
    entrada.unidades.filter((u) => u.tipo === "regional").map((u) => [u.id, u]),
  );
  const confirmadas = entrada.apuracoes.filter(
    (a) => a.status === "confirmado" && regionais.has(a.unidade_id) && mesDe(a.mes),
  );
  const rascunhos = entrada.apuracoes.filter(
    (a) => a.status !== "confirmado" && regionais.has(a.unidade_id),
  ).length;

  // Unidade sem data de inauguração passa a ser esperada a partir da primeira apuração confirmada.
  const primeiraApuracao = new Map<number, string>();
  for (const a of confirmadas) {
    const m = mesDe(a.mes)!;
    const atual = primeiraApuracao.get(a.unidade_id);
    if (!atual || m < atual) primeiraApuracao.set(a.unidade_id, m);
  }
  const esperadaDesde = (u: UnidadeRede) =>
    mesDe(u.inauguracao) ?? primeiraApuracao.get(u.id) ?? null;

  const centavos = new Map<string, number>(); // "mes|unidade" → centavos
  // As duas parcelas da mesma soma, para recortar por base sem outra régua (conversa, 24/09).
  const porBaseCent = new Map<string, { nova: number; antiga: number }>();
  const royCent = new Map<string, number | null>();
  const temRoyalties = confirmadas.some((a) => a.royalties_valor !== undefined);
  const apuradas = new Map<string, Set<number>>();
  for (const a of confirmadas) {
    const m = mesDe(a.mes)!;
    const nova = cent(numero(a.receita_base) ?? 0);
    const antiga = cent(numero(a.receita_base_antiga) ?? 0);
    const v = nova + antiga;
    const k = `${m}|${a.unidade_id}`;
    centavos.set(k, (centavos.get(k) ?? 0) + v);
    const b = porBaseCent.get(k) ?? { nova: 0, antiga: 0 };
    porBaseCent.set(k, { nova: b.nova + nova, antiga: b.antiga + antiga });
    // Mesma soma de `roy_csc` da RPC de indicadores do trimestre (migration 20260826140000).
    // Royalties ausentes numa apuração confirmada não viram R$ 0: a unidade fica sem royalties no mês.
    if (temRoyalties) {
      const roy = numero(a.royalties_valor);
      const antes = royCent.has(k) ? royCent.get(k)! : 0;
      royCent.set(
        k,
        roy === null || antes === null
          ? null
          : antes +
              cent(roy) +
              cent(numero(a.csc_valor_fixo) ?? 0) +
              cent(numero(a.csc_base_antiga_valor) ?? 0),
      );
    }
    if (!apuradas.has(m)) apuradas.set(m, new Set());
    apuradas.get(m)!.add(a.unidade_id);
  }

  const linhas: LinhaMensal[] = [...centavos]
    .map(([k, c]) => {
      const [mes, id] = k.split("|");
      return { mes, chave: regionais.get(Number(id))!.nome, valor: c / 100 };
    })
    .sort((a, b) => a.mes.localeCompare(b.mes) || b.valor - a.valor);

  const parciaisFonte: string[] = [];
  const notasPorMes: Record<string, string> = {};
  for (const [mes, ids] of [...apuradas].sort(([a], [b]) => a.localeCompare(b))) {
    const faltam = [...regionais.values()].filter((u) => {
      const desde = esperadaDesde(u);
      return desde !== null && desde <= mes && !ids.has(u.id);
    });
    if (faltam.length) {
      parciaisFonte.push(mes);
      notasPorMes[mes] =
        `${plural(faltam.length, "unidade já inaugurada está", "unidades já inauguradas estão")} sem apuração confirmada: ${faltam.map((u) => u.nome).join(", ")}.`;
    } else notasPorMes[mes] = `${plural(ids.size, "unidade apurada", "unidades apuradas")}.`;
  }

  const cobertura: string[] = [];
  const semData = [...regionais.values()].filter((u) => !mesDe(u.inauguracao));
  if (semData.length)
    cobertura.push(
      `${plural(semData.length, "unidade", "unidades")} sem data de inauguração no cadastro: conta${semData.length > 1 ? "m" : ""} a partir da primeira apuração confirmada.`,
    );
  if (rascunhos)
    cobertura.push(
      `${plural(rascunhos, "apuração em rascunho não entra", "apurações em rascunho não entram")} até ser confirmada.`,
    );
  if (!confirmadas.length) cobertura.push("Nenhuma apuração confirmada visível para a sua conta.");
  const complementos = temRoyalties
    ? [...royCent].map(([k, c]) => {
        const [mes, id] = k.split("|");
        return {
          mes,
          chave: regionais.get(Number(id))!.nome,
          royaltiesCsc: c === null ? null : c / 100,
        };
      })
    : undefined;
  const porBase = [...porBaseCent].map(([k, c]) => {
    const [mes, id] = k.split("|");
    return {
      mes,
      chave: regionais.get(Number(id))!.nome,
      nova: c.nova / 100,
      antiga: c.antiga / 100,
    };
  });
  return {
    ...BASE_REDE,
    estado: "disponivel",
    nota: null,
    linhas,
    porBase,
    cobertura,
    parciaisFonte,
    notasPorMes,
    ...(complementos ? { complementos } : {}),
  };
}
