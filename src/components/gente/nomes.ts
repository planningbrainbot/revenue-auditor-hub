// Comparação de nomes do cadastro de gente.

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Mesmo nome, ignorando acento, caixa e espaço. Pega o caso do Adílio
 * (01/10/2026): cadastrado à mão e depois pela planilha, com o e-mail digitado
 * diferente, e o e-mail era a única trava contra duplicidade.
 */
export function mesmoNome(a: string, b: string) {
  const n = (x: string) => semAcento(x).replace(/\s+/g, " ");
  return n(a) === n(b);
}
