// Perímetro do Cockpit do COO: TODAS as unidades do cadastro (`ops.unidades`).
//
// Em 29/09/2026 o COO respondeu à proposta "Preciso olhar para todas as unidades, inclusive
// matriz, consultoria e construção civil". A spec original deixava Goiânia e as internas de fora;
// a resposta dele venceu. O cadastro separa dois grupos, e a tela mostra os dois:
// - rede regional (`tipo = 'regional'`): paga royalties e CSC, tem IDU e Pacto Trimestral;
// - operação própria (`tipo = 'interna'`): Goiânia, Construção Civil, Consultoria e São Paulo.
//
// Unidade regional sem inauguração (São Bernardo, Recife, Sorocaba em 29/09) está em implantação:
// entra na contagem e nos compromissos, mas não em número de desempenho.
//
// Arquivo puro. A lista de nomes fixa `UNIDADES_REDE` (src/lib/unidades-rede.ts) NÃO é usada aqui:
// ela tem 9 nomes, inclui Itaúna e não tem as três unidades em implantação.

export type GrupoUnidade = "rede" | "propria";

export interface UnidadeCadastro {
  id: number;
  nome_da_praca: string;
  tipo: string | null;
  data_inauguracao: string | null;
}

export interface UnidadeCoo {
  id: number;
  nome: string;
  grupo: GrupoUnidade;
  /** Rede regional já inaugurada, ou unidade própria (que não tem inauguração). */
  emOperacao: boolean;
  /** Chave normalizada do nome, a mesma de `ops.base_unidade()`. */
  chave: string;
}

/** Filtro da URL: vazio = todas; "rede"; "propria"; ou o id de uma unidade. */
export type FiltroUnidade = string;

export const ROTULO_GRUPO: Record<GrupoUnidade, string> = {
  rede: "Rede regional",
  propria: "Operação própria",
};

/**
 * Chave de unidade igual à de `ops.base_unidade()` (banco único): minúsculas, sem acento, espaço
 * único, e os apelidos que os sistemas gravam para Goiânia ("Matriz" no Pipedrive, "Goiânia /
 * Matriz" no Pipefy, "Partners" no Omie) e para o Rio ("Sudeste (RJ)").
 */
export function chaveUnidade(texto: string | null | undefined): string {
  const s = (texto ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  switch (s) {
    case "sudeste (rj)":
      return "rio de janeiro";
    case "goiania / matriz":
    case "matriz":
    case "partners":
      return "goiania";
    default:
      return s;
  }
}

export function lerUnidades(cadastro: UnidadeCadastro[]): UnidadeCoo[] {
  return cadastro
    .map((u) => {
      const grupo: GrupoUnidade = u.tipo === "regional" ? "rede" : "propria";
      return {
        id: u.id,
        nome: u.nome_da_praca,
        grupo,
        emOperacao: grupo === "propria" || Boolean(u.data_inauguracao),
        chave: chaveUnidade(u.nome_da_praca),
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** As unidades que o filtro seleciona. Filtro desconhecido volta para todas (a tela avisa). */
export function unidadesDoFiltro(unidades: UnidadeCoo[], filtro: FiltroUnidade): UnidadeCoo[] {
  if (!filtro) return unidades;
  if (filtro === "rede" || filtro === "propria") return unidades.filter((u) => u.grupo === filtro);
  const id = Number(filtro);
  const uma = unidades.filter((u) => u.id === id);
  return uma.length ? uma : unidades;
}

export function filtroValido(unidades: UnidadeCoo[], filtro: FiltroUnidade): boolean {
  if (!filtro || filtro === "rede" || filtro === "propria") return true;
  return unidades.some((u) => u.id === Number(filtro));
}

/** Casa um texto de unidade de qualquer fonte com o cadastro; null quando não casa. */
export function acharUnidade(unidades: UnidadeCoo[], texto: string | null | undefined): UnidadeCoo | null {
  const c = chaveUnidade(texto);
  if (!c) return null;
  return unidades.find((u) => u.chave === c) ?? null;
}

/** Rótulo do filtro para o universo do cabeçalho. */
export function rotuloDoFiltro(unidades: UnidadeCoo[], filtro: FiltroUnidade): string {
  if (!filtro) return "Todas as unidades";
  if (filtro === "rede" || filtro === "propria") return ROTULO_GRUPO[filtro];
  return unidades.find((u) => u.id === Number(filtro))?.nome ?? "Todas as unidades";
}

/**
 * Universo em uma linha (N1): quantas unidades, quantas em operação e o que ficou de fora.
 * Ex.: "15 unidades · 11 da rede regional (8 em operação) · 4 de operação própria".
 */
export function universo(unidades: UnidadeCoo[], filtro: FiltroUnidade): string {
  const sel = unidadesDoFiltro(unidades, filtro);
  if (sel.length === 1 && filtro && filtro !== "rede" && filtro !== "propria") {
    const u = sel[0];
    if (u.grupo === "propria") return `${u.nome} · operação própria`;
    return `${u.nome} · rede regional · ${u.emOperacao ? "em operação" : "em implantação"}`;
  }
  const rede = sel.filter((u) => u.grupo === "rede");
  const propria = sel.filter((u) => u.grupo === "propria");
  const partes = [`${sel.length} ${sel.length === 1 ? "unidade" : "unidades"}`];
  if (rede.length)
    partes.push(`${rede.length} da rede regional (${rede.filter((u) => u.emOperacao).length} em operação)`);
  if (propria.length) partes.push(`${propria.length} de operação própria`);
  return partes.join(" · ");
}
