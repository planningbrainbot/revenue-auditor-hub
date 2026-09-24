// A cadeia venda → ativação → faturamento → retenção, só onde o vínculo é comprovado por chave.
//
// Safra: contratos ganhos no pipe de vendas (Inside Sales) desde que o pipe de Onboarding passou a
// ser sincronizado. Cada elo é uma contagem sobre a MESMA safra, com o denominador fixo:
//   venda (contrato ganho) → ativação iniciada (card de onboarding da mesma empresa) → ativação
//   concluída → faturada (o CNPJ do contrato aparece no Faturamento do grupo a partir do mês do
//   ganho) → saída registrada (churn datado na Central de Tratativas).
//
// Onde a venda é faturada depende de quem fatura: cliente de unidade regional recebe a nota do Omie
// da UNIDADE (ops.contas_receber, com CNPJ, vencimento e pagamento por título); cliente do grupo, das
// empresas do grupo (Financial Brain). O elo "faturada" aceita as duas evidências e diz de onde veio
// cada uma (medido em 23/09: a safra desde 16/07 não aparecia em nenhuma nota do grupo, e 10
// contratos já tinham título na unidade).
//
// No Financeiro do grupo, faturamento e contrato não têm chave comum: ele guarda o NOME do cliente.
// O vínculo é CNPJ → cadastro de contrapartes do Omie (documento → nome normalizado) → nome
// normalizado do cliente na receita. A normalização é a da própria base (`fn_norm_contraparte`),
// portada abaixo e conferida contra a função SQL (7.067 de 7.067 nomes iguais). Nome que aponta
// para mais de um documento é ambíguo e NÃO conta como faturado. Nada é casado por semelhança.
//
// Recebimento por cliente só existe no contas a receber das unidades; no grupo, só agregado mensal
// (Caixa e margem). O CNPJ da venda vem do contrato e, na falta, do cadastro da empresa.

const PALAVRAS_FORA = new Set([
  "ltda",
  "ltd",
  "sa",
  "sc",
  "me",
  "epp",
  "epps",
  "eireli",
  "mei",
  "cia",
  "ss",
]);

/** Porte de `public.fn_norm_contraparte` (Financial Brain). `null` para vazio. */
export function normContraparte(t: string | null | undefined): string | null {
  const s = (t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[./]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const out = s
    .split(" ")
    .filter((tok) => tok !== "" && !PALAVRAS_FORA.has(tok))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return out === "" ? null : out;
}

export const docDigitos = (x: unknown): string | null => {
  const d = typeof x === "string" ? x.replace(/\D/g, "") : "";
  return d.length === 14 ? d : null;
};

/** 14 dígitos → "00.000.000/0000-00", o formato do contas a receber das unidades. */
export const cnpjComMascara = (d: string) =>
  `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;

export interface VendaSafra {
  empresaId: number | null;
  cnpj: string | null;
  /** "AAAA-MM-DD" */
  ganhoEm: string;
  dealId: string | null;
}

export interface EntradaCadeia {
  vendas: VendaSafra[];
  /** empresa_id → card de onboarding: iniciado sempre; concluído quando entrou em "Concluído". */
  onboarding: Map<number, { concluido: boolean }>;
  /** CNPJ (14 dígitos) → nomes normalizados no cadastro de contrapartes. */
  nomesPorCnpj: Map<string, Set<string>>;
  /** nome normalizado → documentos distintos com esse nome no cadastro de contrapartes. */
  documentosPorNome: Map<string, number>;
  /** nome normalizado do cliente na receita → meses ("AAAA-MM") com faturamento ≠ 0. */
  mesesFaturadosPorNome: Map<string, Set<string>>;
  /** Títulos no contas a receber das unidades, por CNPJ: vencimentos e se foram pagos. */
  titulosUnidadePorCnpj: Map<string, { vencimento: string; pago: boolean }[]>;
  /** O contas a receber das unidades foi lido (senão os elos dele saem `null`). */
  unidadesLidas: boolean;
  /** Saída registrada: por empresa e por negócio do CRM. */
  churnEmpresas: Set<number>;
  churnNegocios: Set<string>;
  /** O elo do faturamento foi lido. Se não, os três números dele saem `null`, nunca 0. */
  faturamentoLido: boolean;
}

export interface Cadeia {
  safra: { de: string | null; ate: string | null };
  vendas: number;
  semEmpresa: number;
  semCnpj: number;
  ativacaoIniciada: number;
  ativacaoConcluida: number;
  /** Faturada no grupo OU na unidade, a partir do mês do ganho. */
  faturadas: number | null;
  faturadasNoGrupo: number | null;
  faturadasNaUnidade: number | null;
  /** Com título pago no contas a receber das unidades (vencimento a partir do ganho). */
  recebidasNaUnidade: number | null;
  /** CNPJ achado no cadastro, mas só com nome que aponta para mais de um documento. */
  faturamentoAmbiguo: number | null;
  /** CNPJ fora do cadastro de contrapartes do Omie do grupo e sem título na unidade. */
  semContraparte: number | null;
  saidas: number;
}

export function montarCadeia(e: EntradaCadeia): Cadeia {
  const datas = e.vendas.map((v) => v.ganhoEm).sort();
  let ativacaoIniciada = 0;
  let ativacaoConcluida = 0;
  let faturadas = 0;
  let noGrupo = 0;
  let naUnidade = 0;
  let recebidas = 0;
  let faturamentoAmbiguo = 0;
  let semContraparte = 0;
  let saidas = 0;
  for (const v of e.vendas) {
    const card = v.empresaId !== null ? e.onboarding.get(v.empresaId) : undefined;
    if (card) {
      ativacaoIniciada += 1;
      if (card.concluido) ativacaoConcluida += 1;
    }
    if (v.cnpj) {
      const titulos = (e.titulosUnidadePorCnpj.get(v.cnpj) ?? []).filter(
        (t) => t.vencimento >= v.ganhoEm,
      );
      const naUnid = titulos.length > 0;
      if (naUnid) naUnidade += 1;
      if (titulos.some((t) => t.pago)) recebidas += 1;
      let noGrp = false;
      const nomes = e.nomesPorCnpj.get(v.cnpj);
      if (!nomes || nomes.size === 0) {
        if (!naUnid) semContraparte += 1;
      } else {
        const mesGanho = v.ganhoEm.slice(0, 7);
        const unicos = [...nomes].filter((n) => (e.documentosPorNome.get(n) ?? 0) === 1);
        noGrp = unicos.some((n) =>
          [...(e.mesesFaturadosPorNome.get(n) ?? [])].some((m) => m >= mesGanho),
        );
        if (!noGrp && !naUnid && unicos.length === 0) faturamentoAmbiguo += 1;
      }
      if (noGrp) noGrupo += 1;
      if (noGrp || naUnid) faturadas += 1;
    }
    if (
      (v.empresaId !== null && e.churnEmpresas.has(v.empresaId)) ||
      (v.dealId !== null && e.churnNegocios.has(v.dealId))
    )
      saidas += 1;
  }
  return {
    safra: { de: datas[0] ?? null, ate: datas.at(-1) ?? null },
    vendas: e.vendas.length,
    semEmpresa: e.vendas.filter((v) => v.empresaId === null).length,
    semCnpj: e.vendas.filter((v) => !v.cnpj).length,
    ativacaoIniciada,
    ativacaoConcluida,
    // Sem uma das duas fontes, o total de faturadas seria um piso com cara de número: fica null.
    faturadas: e.faturamentoLido && e.unidadesLidas ? faturadas : null,
    faturadasNoGrupo: e.faturamentoLido ? noGrupo : null,
    faturadasNaUnidade: e.unidadesLidas ? naUnidade : null,
    recebidasNaUnidade: e.unidadesLidas ? recebidas : null,
    faturamentoAmbiguo: e.faturamentoLido ? faturamentoAmbiguo : null,
    semContraparte: e.faturamentoLido && e.unidadesLidas ? semContraparte : null,
    saidas,
  };
}
