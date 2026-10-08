import { PRE_VENDEDORES } from "./types.ts";

/**
 * Quem o recorte mede (08/10/2026: dois pré-vendedores, Matheus e Heloá). `owner` é uma pessoa;
 * sem `owner`, `owners` é a pré-venda inteira; sem os dois, todo movimento conta (inclusive o do
 * usuário de integração). O crédito é de quem fez o movimento (ator), como desde a carga v6.
 */
export interface RecorteResponsavel {
  owner: number | null;
  owners?: readonly number[];
}

export const doResponsavel = (f: RecorteResponsavel, actor: number | null | undefined) =>
  f.owner ? actor === f.owner : f.owners?.length ? actor != null && f.owners.includes(actor) : true;

/** Quantas pessoas o recorte mede: 1 com uma pessoa, a pré-venda inteira sem ela. */
export const pessoasNoRecorte = (f: RecorteResponsavel) =>
  f.owner ? 1 : (f.owners?.length ?? PRE_VENDEDORES.length);

/** Nome de quem o recorte mede, para título e procedência. */
export function nomeDoRecorte(f: RecorteResponsavel): string {
  if (f.owner)
    return PRE_VENDEDORES.find(([id]) => id === f.owner)?.[1] ?? `responsável ${f.owner}`;
  return f.owners?.length ? "Pré-venda (Matheus e Heloá)" : "Toda a frente";
}

/** Primeiro nome, para a pergunta dos quadros ("Heloá está no ritmo das metas?"). */
export const primeiroNome = (nome: string) => nome.split(" ")[0];
