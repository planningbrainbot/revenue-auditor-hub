export function strictDate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();
  let year, month, day;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(raw);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (iso) [, year, month, day] = iso;
  else if (br) [, day, month, year] = br;
  else return null;
  const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (d.getUTCFullYear() !== Number(year) || d.getUTCMonth() !== Number(month) - 1 || d.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}
