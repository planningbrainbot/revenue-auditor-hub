// Lógica pura da carga de faturamento do SPED (API de faturamento do Silas). Sem rede e sem banco: testada no Node
// em tests/faturamento-sped.test.mjs. O index.ts só faz as chamadas.

export type MesApi = {
  competencia: string;
  status: string;
  vendas?: number | null;
  devolucoes?: number | null;
  servicos?: number | null;
  faturamento?: number | null;
  fontes?: string[] | null;
  entregue_em?: string | null;
  baixado_em?: string | null;
  retificado?: boolean | null;
};
export type EmpresaApi = { cnpj: string; raiz: string; meses: MesApi[] };
export type Carga = { id: number; iniciada_em: string; status: string; proxima_pagina: number };
export type Linha = {
  cnpj: string;
  raiz: string;
  competencia: string;
  status: string;
  vendas: number | null;
  devolucoes: number | null;
  servicos: number | null;
  faturamento: number | null;
  fontes: string[] | null;
  entregue_em: string | null;
  baixado_em: string | null;
  retificado: boolean | null;
  carga_id: number;
};

// Só estes status viram linha. "sped_fora_base_motivo_diverso" não vira: mês sem arquivo é ausência de linha, nunca zero.
export const GUARDA = new Set(["ok", "aguardando_entrega"]);

export function diaSP(agora: Date): { dia: number; mes: number; data: string } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const v = (t: string) => partes.find((p) => p.type === t)!.value;
  return { dia: Number(v("day")), mes: Number(v("month")), data: `${v("year")}-${v("month")}-${v("day")}` };
}

// Regra do Silas (22/10/2026): senha base + (dia + 1) + (mês − 1), sem zero à esquerda, no dia de São Paulo.
// Em 22/10 o sufixo é "239"; dia 31 vira "32"; janeiro vira "0".
export function senhaDoDia(base: string, agora: Date): string {
  const { dia, mes } = diaSP(agora);
  return `${base}${dia + 1}${mes - 1}`;
}

// O que fazer nesta chamada do cron. A carga é uma por dia de São Paulo e retoma pela página em que parou.
export function decidirCarga(
  ultima: Carga | null,
  agora: Date,
): { acao: "nova" | "continuar" | "feita"; interromper?: number; pagina: number } {
  if (!ultima) return { acao: "nova", pagina: 1 };
  const mesmoDia = diaSP(new Date(ultima.iniciada_em)).data === diaSP(agora).data;
  if (mesmoDia && ultima.status === "ok") return { acao: "feita", pagina: ultima.proxima_pagina };
  if (mesmoDia && (ultima.status === "rodando" || ultima.status === "erro"))
    return { acao: "continuar", pagina: ultima.proxima_pagina };
  const aberta = ultima.status === "rodando" || ultima.status === "erro";
  return { acao: "nova", pagina: 1, ...(aberta ? { interromper: ultima.id } : {}) };
}

const numero = (x: unknown): number | null =>
  x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? null : Number(x);
const dataIso = (x: unknown): string | null => {
  const m = String(x ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

// Mês anterior ao de São Paulo, AAAA-MM: a última competência que a API devolve e a única que pode estar "aguardando".
export function ultimaCompetencia(agora: Date): string {
  const { mes, data } = diaSP(agora);
  const ano = Number(data.slice(0, 4));
  return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, "0")}`;
}

// Uma página da API vira linhas da tabela. CNPJ fora de 14 dígitos ou competência fora de AAAA-MM é descartado.
// "aguardando_entrega" só vale para a última competência: em 22/10 à tarde a API passou a marcar assim também os meses
// antigos sem arquivo, e esses continuam sem linha.
export function linhasDaPagina(empresas: EmpresaApi[], cargaId: number, ultima: string): Linha[] {
  const linhas: Linha[] = [];
  for (const e of empresas || []) {
    const cnpj = String(e?.cnpj ?? "").replace(/\D/g, "");
    if (cnpj.length !== 14) continue;
    for (const m of e.meses || []) {
      if (!GUARDA.has(m?.status)) continue;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m.competencia))) continue;
      if (m.status === "aguardando_entrega" && m.competencia !== ultima) continue;
      linhas.push({
        cnpj,
        raiz: cnpj.slice(0, 8),
        competencia: `${m.competencia}-01`,
        status: m.status,
        vendas: numero(m.vendas),
        devolucoes: numero(m.devolucoes),
        servicos: numero(m.servicos),
        faturamento: numero(m.faturamento),
        fontes: Array.isArray(m.fontes) ? m.fontes.map(String) : null,
        entregue_em: dataIso(m.entregue_em),
        baixado_em: dataIso(m.baixado_em),
        retificado: typeof m.retificado === "boolean" ? m.retificado : null,
        carga_id: cargaId,
      });
    }
  }
  return linhas;
}
