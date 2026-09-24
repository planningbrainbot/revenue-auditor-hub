/**
 * Chave e rótulo de mês para as telas da Rede.
 *
 * Por que existe: as fontes da Rede devolvem o mês em dois tipos. As views
 * (`v_reconciliacao_mensal` e as de CAC/NPS/headcount) fazem
 * `date_trunc('month', …)` e chegam como `timestamptz`
 * ("2026-01-01T00:00:00+00:00"); as tabelas (`contratos.ganho_em`,
 * `central_tratativas.data_churn`, `royalties_apuracao.mes_referencia`,
 * `roas_por_unidade.mes`) chegam como `date` ("2026-01-01"). Cada tela
 * normalizava do seu jeito (`slice(0, 7)`, `new Date(mes + "-01")`), e duas
 * coisas quebravam: chaves que não casavam entre view e tabela (abas de CAC e
 * NPS vazias) e rótulo de mês um mês atrás, porque `new Date("2026-01-01")` é
 * meia-noite UTC, que em São Paulo ainda é 31/12.
 *
 * Regra de `chaveMes`:
 * - "aaaa-mm", "aaaa-mm-dd" e timestamp sem fuso: o mês escrito, sem conversão.
 * - `timestamptz` / `Date`: o mês em America/Sao_Paulo, com uma exceção. O
 *   banco roda em UTC (conferido em 24/09/2026: `TimeZone = UTC`), então o
 *   `date_trunc` das views devolve meia-noite UTC do dia 1, que em São Paulo
 *   cai no mês anterior. Um instante exatamente em 01 00:00:00 UTC é tratado
 *   como início de mês truncado em UTC e fica no mês UTC; qualquer outro
 *   instante vai para o mês de São Paulo. Assim "2026-01-01T00:00:00+00:00"
 *   (sessão UTC) e "2026-01-01 03:00:00+00" (sessão em São Paulo) dão os dois
 *   "2026-01".
 *
 * `rotuloMes` monta "jan/26" a partir da string, sem passar por `Date`.
 */

const FUSO = "America/Sao_Paulo";

const MES_SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
});

const ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const RE_MES = /^(\d{4})-(\d{2})$/;
const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

function mesValido(ano: string, mes: string): string | null {
  const m = Number(mes);
  return m >= 1 && m <= 12 ? `${ano}-${mes}` : null;
}

function mesEmSaoPaulo(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const partes = MES_SP.formatToParts(d);
  const ano = partes.find((p) => p.type === "year")?.value;
  const mes = partes.find((p) => p.type === "month")?.value;
  return ano && mes ? `${ano}-${mes}` : null;
}

function inicioDeMesUtc(d: Date): boolean {
  return (
    d.getUTCDate() === 1 &&
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

function mesDoInstante(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  if (inicioDeMesUtc(d)) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return mesEmSaoPaulo(d);
}

/** "aaaa-mm" do valor, ou `null` quando não há mês legível. */
export function chaveMes(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return mesDoInstante(v);
  const s = v.trim();
  if (!s) return null;

  let m = RE_MES.exec(s);
  if (m) return mesValido(m[1], m[2]);
  m = RE_DIA.exec(s);
  if (m) return mesValido(m[1], m[2]);

  m = RE_HORA.exec(s);
  if (!m) return null;
  const [, ano, mes, dia, hh, mi, ss = "00", frac = "", fuso] = m;
  if (!fuso) return mesValido(ano, mes); // timestamp sem fuso: vale o que está escrito
  let offset = fuso.toUpperCase();
  if (offset !== "Z") {
    // "+00" e "-0300" viram "+00:00" e "-03:00", que o parser ISO aceita.
    const digitos = offset.slice(1).replace(":", "");
    offset = `${offset[0]}${digitos.slice(0, 2)}:${(digitos.slice(2) || "00").padEnd(2, "0")}`;
  }
  return mesDoInstante(new Date(`${ano}-${mes}-${dia}T${hh}:${mi}:${ss}${frac}${offset}`));
}

/** "2026-01" → "jan/26". Chave ilegível volta como veio. */
export function rotuloMes(chave: string): string {
  const m = RE_MES.exec(chave);
  if (!m) return chave;
  const i = Number(m[2]) - 1;
  if (i < 0 || i > 11) return chave;
  return `${ABREV[i]}/${m[1].slice(2)}`;
}

// ── Aritmética de mês sobre a chave "aaaa-mm" ──────────────────────────────
// Índice absoluto (ano×12 + mês−1), sem Date: dia do mês e fuso não entram.
// Chave ilegível dá NaN, e a comparação com ela é sempre falsa.
function indiceMes(chave: string): number {
  const [a, m] = chave.split("-").map(Number);
  return a * 12 + (m - 1);
}

function chaveDoIndice(idx: number): string {
  const a = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${a}-${String(m).padStart(2, "0")}`;
}

/** Mês de hoje em São Paulo, "aaaa-mm". */
export function mesCorrente(): string {
  return chaveMes(new Date()) ?? new Date().toISOString().slice(0, 7);
}

/** `chave` deslocada `n` meses (negativo volta). "2026-01", −1 → "2025-12". */
export function somarMeses(chave: string, n: number): string {
  return chaveDoIndice(indiceMes(chave) + n);
}

/** Meses de `a` até `b` (b − a). "2024-07" → "2026-01" = 18. */
export function mesesEntre(a: string, b: string): number {
  return indiceMes(b) - indiceMes(a);
}
