// Resolução de custom field do ClickUp pelo NOME (ids de campo são por space). Portado do Growth
// (`brain-web/src/lib/okrs/campos.ts`).
//
// A armadilha que o Growth já pagou: `GET /task/{id}` só devolve os campos ANEXADOS àquela lista.
// Um campo que existe no space mas nunca foi usado na lista não aparece ali, e tratar a ausência
// como "o campo não existe" manda criar um campo que já existe. Por isso a busca cai para os campos
// do space antes de desistir.
import type { CampoBruto, OpcaoBruta } from "./normalizar.ts";

export function acharCampo(campos: CampoBruto[] | undefined, nome: string): CampoBruto | null {
  return campos?.find((f) => f.name.includes(nome)) ?? null;
}

export type ResolucaoCampo =
  | { ok: true; id: string; origem: "tarefa" | "space"; opcoes: OpcaoBruta[] }
  | { ok: false; motivo: "ausente_no_space" };

export function resolverCampo(
  camposDaTarefa: CampoBruto[] | undefined,
  camposDoSpace: CampoBruto[] | undefined,
  nome: string,
): ResolucaoCampo {
  const naTarefa = acharCampo(camposDaTarefa, nome);
  if (naTarefa)
    return { ok: true, id: naTarefa.id, origem: "tarefa", opcoes: naTarefa.type_config?.options ?? [] };
  const noSpace = acharCampo(camposDoSpace, nome);
  if (noSpace)
    return { ok: true, id: noSpace.id, origem: "space", opcoes: noSpace.type_config?.options ?? [] };
  return { ok: false, motivo: "ausente_no_space" };
}

/** Normaliza para comparar nomes de opção ("São Luís" = "sao luis"). */
function chave(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Id da opção de um dropdown pelo nome; null quando a opção não existe no campo. */
export function opcaoPorNome(opcoes: OpcaoBruta[], nome: string): string | null {
  const alvo = chave(nome);
  return opcoes.find((o) => chave(o.name) === alvo)?.id ?? null;
}
