/**
 * Feriados nacionais que tiram o dia útil da conta da Monetização (spec de 01/10/2026). Lista num
 * lugar só: `uteis()` do model e a visão "Hoje" leem daqui.
 *
 * Carnaval (segunda e terça) e Corpus Christi não são feriados nacionais por lei: são pontos
 * facultativos de uso geral. Entram porque o comércio e os escritórios dos clientes param nesses
 * dias, e um dia em que ninguém atende não é dia útil de abordagem.
 *
 * Para um ano que não está aqui, `ehDiaUtil` conta só segunda a sexta. Acrescente o ano antes que
 * ele chegue.
 */
export const FERIADOS_NACIONAIS: ReadonlySet<string> = new Set([
  // 2026
  "2026-01-01", // Confraternização Universal
  "2026-02-16", // Carnaval (ponto facultativo)
  "2026-02-17", // Carnaval (ponto facultativo)
  "2026-04-03", // Sexta-feira Santa
  "2026-04-21", // Tiradentes
  "2026-05-01", // Dia do Trabalho
  "2026-06-04", // Corpus Christi (ponto facultativo)
  "2026-09-07", // Independência
  "2026-10-12", // Nossa Senhora Aparecida
  "2026-11-02", // Finados
  "2026-11-15", // Proclamação da República
  "2026-11-20", // Consciência Negra
  "2026-12-25", // Natal
  // 2027
  "2027-01-01", // Confraternização Universal
  "2027-02-08", // Carnaval (ponto facultativo)
  "2027-02-09", // Carnaval (ponto facultativo)
  "2027-03-26", // Sexta-feira Santa
  "2027-04-21", // Tiradentes
  "2027-05-01", // Dia do Trabalho
  "2027-05-27", // Corpus Christi (ponto facultativo)
  "2027-09-07", // Independência
  "2027-10-12", // Nossa Senhora Aparecida
  "2027-11-02", // Finados
  "2027-11-15", // Proclamação da República
  "2027-11-20", // Consciência Negra
  "2027-12-25", // Natal
]);

/** Segunda a sexta, fora dos feriados nacionais. `dia` em aaaa-mm-dd (data de São Paulo). */
export function ehDiaUtil(dia: string): boolean {
  const semana = new Date(dia + "T12:00:00Z").getUTCDay();
  return semana !== 0 && semana !== 6 && !FERIADOS_NACIONAIS.has(dia);
}

const somarDias = (dia: string, n: number) =>
  new Date(Date.parse(dia + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** O dia útil antes de `dia`: o "Ontem" dos filtros de período (na segunda, a sexta; 22/10/2026). */
export function diaUtilAnterior(dia: string): string {
  let d = somarDias(dia, -1);
  while (!ehDiaUtil(d)) d = somarDias(d, -1);
  return d;
}

/** A segunda-feira da semana de `dia`: o começo do "Semana" dos filtros de período (22/10/2026). */
export function segundaDaSemana(dia: string): string {
  const semana = new Date(dia + "T12:00:00Z").getUTCDay();
  return somarDias(dia, -((semana + 6) % 7));
}
