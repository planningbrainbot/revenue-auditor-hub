// Tempo de casa pela data de admissão. Usado no filtro do Cadastro e no radar
// de experiência da Avaliação; `data_admissao` é `date`, então a conta é em
// data local ao meio-dia para o fuso não virar o dia.

const DIA = 86_400_000;

const meioDia = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);

function hojeMeioDia(): Date {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), h.getDate(), 12);
}

/** Dias desde a admissão. Negativo quando a admissão é futura. */
export function diasDeCasa(admissao: string | null): number | null {
  if (!admissao) return null;
  return Math.round((hojeMeioDia().getTime() - meioDia(admissao).getTime()) / DIA);
}

/** Data (AAAA-MM-DD) em que a pessoa completa `dias` de casa. */
export function dataDoMarco(admissao: string, dias: number): string {
  const d = new Date(meioDia(admissao).getTime() + dias * DIA);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Tempo de casa em anos, meses e dias de calendário (não em blocos de 30 dias):
 * de 15/01 a 14/02 é 0 mês e 30 dias; a 15/02, 1 mês.
 */
export function tempoDeCasa(
  admissao: string | null,
): { anos: number; meses: number; dias: number } | null {
  if (!admissao) return null;
  const ini = meioDia(admissao);
  const hoje = hojeMeioDia();
  if (hoje < ini) return null;
  let meses = (hoje.getFullYear() - ini.getFullYear()) * 12 + (hoje.getMonth() - ini.getMonth());
  if (hoje.getDate() < ini.getDate()) meses -= 1;
  const marco = new Date(ini.getFullYear(), ini.getMonth() + meses, ini.getDate(), 12);
  const dias = Math.round((hoje.getTime() - marco.getTime()) / DIA);
  return { anos: Math.floor(meses / 12), meses: meses % 12, dias };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "2 anos e 3 meses", "5 meses", "12 dias". Admissão futura: "entra em N dias". */
export function fmtTempoDeCasa(admissao: string | null): string {
  if (!admissao) return "—";
  const t = tempoDeCasa(admissao);
  if (!t) {
    const falta = -(diasDeCasa(admissao) ?? 0);
    return `entra em ${plural(falta, "dia", "dias")}`;
  }
  if (!t.anos && !t.meses) return t.dias ? plural(t.dias, "dia", "dias") : "entrou hoje";
  const partes = [
    t.anos ? plural(t.anos, "ano", "anos") : null,
    t.meses ? plural(t.meses, "mês", "meses") : null,
  ].filter(Boolean);
  return partes.join(" e ");
}

/**
 * Quantos anos de empresa a pessoa completa no mês corrente (1 ou mais), para
 * o RH homenagear. Nulo se não faz aniversário de empresa este mês.
 */
export function aniversarioDeEmpresaNoMes(admissao: string | null): number | null {
  if (!admissao) return null;
  const ini = meioDia(admissao);
  const hoje = hojeMeioDia();
  if (ini.getMonth() !== hoje.getMonth()) return null;
  const anos = hoje.getFullYear() - ini.getFullYear();
  return anos >= 1 ? anos : null;
}
