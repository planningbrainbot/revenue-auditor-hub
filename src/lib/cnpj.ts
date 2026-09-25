// Validação de CNPJ em lib neutra: a tela da Base de Contatos não deve
// depender dos tipos da Fila Cella (que outra branch remove).
// Origem: cópia de `cnpjDvValido` em src/lib/fila-cella.types.ts
// ("Dígito verificador de CNPJ. Usado no diálogo de resolução (§6.7 item 4)").

/** Dígito verificador de CNPJ: 14 dígitos, não repetidos, os dois DV conferem. */
export function cnpjDvValido(cnpj: string): boolean {
  const d = (cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((acc, c, i) => acc + Number(c) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const dv1 = calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = calc(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(d[12]) && dv2 === Number(d[13]);
}
