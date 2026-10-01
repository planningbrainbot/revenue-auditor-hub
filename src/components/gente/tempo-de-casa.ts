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
