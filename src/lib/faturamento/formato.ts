// Formatos do Portal de Faturamento (contrato `docs/design/contratos/faturamento.md` §1.4).
//
// - Dinheiro em R$ com centavos; valor ausente é "—", nunca "R$ 0,00" (N4).
// - Datas em America/Sao_Paulo. Momento (ISO com hora) passa pelo fuso; data pura ("AAAA-MM-DD") é lida
//   como texto, porque `new Date("2026-10-21")` é meia-noite UTC e no Brasil vira o dia anterior.
// - Competência como "out/2026".
//
// Módulo puro (sem React, sem `@/`), testado em tests/faturamento-rotulos.test.mjs.

export const FUSO = "America/Sao_Paulo";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INTEIRO = new Intl.NumberFormat("pt-BR");

/** "R$ 1.500,00"; "—" quando o valor não existe. */
export function dinheiro(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : BRL.format(v);
}

/** Contagem inteira com separador de milhar. */
export function inteiro(v: number): string {
  return INTEIRO.format(Math.round(v));
}

/** "3 pedidos", "1 parcela": unidade de contagem no plural certo. */
export function contagem(n: number, singular: string, plural = `${singular}s`): string {
  return `${inteiro(n)} ${n === 1 ? singular : plural}`;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const DATA_PURA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Partes da data e hora de um momento no fuso de São Paulo. */
function partesSP(
  momento: string | Date,
): { ano: string; mes: string; dia: string; hora: string; minuto: string } | null {
  const d = momento instanceof Date ? momento : new Date(momento);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return { ano: v("year"), mes: v("month"), dia: v("day"), hora: v("hour"), minuto: v("minute") };
}

/** "AAAA-MM-DD" do dia em São Paulo (de um momento ISO, de um `Date` ou de uma data pura). */
export function diaSP(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && DATA_PURA.test(v)) return v;
  const p = partesSP(v);
  return p ? `${p.ano}-${p.mes}-${p.dia}` : null;
}

/** "21/10". */
export function diaMes(v: string | Date | null | undefined): string | null {
  const d = diaSP(v);
  if (!d) return null;
  const [, m, dia] = d.split("-");
  return `${dia}/${m}`;
}

/** "21/10/2026". */
export function dataCompleta(v: string | Date | null | undefined): string | null {
  const d = diaSP(v);
  if (!d) return null;
  const [a, m, dia] = d.split("-");
  return `${dia}/${m}/${a}`;
}

/** "14:20", no fuso de São Paulo. Data pura não tem hora: devolve `null`. */
export function horaSP(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && DATA_PURA.test(v)) return null;
  const p = partesSP(v);
  return p ? `${p.hora}:${p.minuto}` : null;
}

/** "21/10 às 14:20" (ou só "21/10" quando não há hora). */
export function diaEHora(v: string | Date | null | undefined): string | null {
  const dia = diaMes(v);
  if (!dia) return null;
  const hora = horaSP(v);
  return hora ? `${dia} às ${hora}` : dia;
}

/** "out/2026" de "2026-10", "2026-10-01" ou de um momento. */
export function rotuloMes(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})/.exec(v);
  if (!m) return null;
  const i = Number(m[2]) - 1;
  if (i < 0 || i > 11) return null;
  return `${MESES[i]}/${m[1]}`;
}

/** "AAAA-MM" do mês corrente em São Paulo. */
export function mesCorrenteSP(agora: Date = new Date()): string {
  return (diaSP(agora) as string).slice(0, 7);
}

/** "AAAA-MM" somado de `delta` meses. */
export function deslocarMes(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const total = a * 12 + (m - 1) + delta;
  const ano = Math.floor(total / 12);
  const mesNovo = (total % 12) + 1;
  return `${ano}-${String(mesNovo).padStart(2, "0")}`;
}

/**
 * CNPJ "11.222.333/0001-81" (ou alfanumérico, "12.ABC.345/01DE-35"), CPF "123.456.789-09"; o resto passa
 * como veio.
 */
export function documento(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (/^[0-9A-Z]{12}\d{2}$/.test(d))
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (/^\d{11}$/.test(d)) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v;
}

/** "DOC", "DOC e PIS", "DOC, PIS e PRJ". */
export function listaNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Primeiro nome ("Hugo Silva" → "Hugo"); e-mail vira a parte antes do @. */
export function primeiroNome(nome: string | null | undefined): string {
  if (!nome) return "";
  const limpo = nome.includes("@") ? nome.split("@")[0] : nome;
  return limpo.trim().split(/\s+/)[0] ?? "";
}
