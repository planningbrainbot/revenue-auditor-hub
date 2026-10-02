/**
 * Regra de região do Finance (frente 02 da call de 01/10/2026, anotação do Pedro às 14:48: "Finance: filtrar por
 * região, o produto FCO do finance funciona só para centro-oeste"). Duas leituras esperam o Dárcio:
 *
 * - `so_centro_oeste`: o Finance inteiro fica só para GO, MT, MS e DF;
 * - `regiao_escolhe_linha`: o Finance vale em todo lugar e a região escolhe a linha (FCO no Centro-Oeste; BNDES e
 *   FINAME nacionais; BASA e FNE só se o Dárcio confirmar).
 *
 * A leitura vigente e as linhas moram no banco (`ops.monetizacao_regras`, chave `finance_regiao`, e
 * `ops.monetizacao_finance_linhas`), não aqui: ligar é um UPDATE, sem deploy. Com a chave `desligada` (o padrão) ou
 * sem a migration, a oferta não muda. O servidor repete a mesma regra em `ops.monetizacao_finance_regiao_issue`.
 *
 * A UF da conta vem de `ops.base_conta_uf`, na ordem Receita (via Consultoria), cadastro, ECD, Omie e, por último, o
 * campo Estado dos negócios da organização no Pipedrive.
 */
import type { Oferta } from "./types";

export type RegraRegiao = "desligada" | "so_centro_oeste" | "regiao_escolhe_linha";

export interface LinhaFinance {
  linha: string;
  /** `null` = linha nacional. */
  regioes: string[] | null;
  ativa: boolean;
}

export interface RegiaoDaConta {
  regra: RegraRegiao;
  uf: string | null;
  regiao: string | null;
  fonte: string | null;
  conflito: boolean;
  linhas: LinhaFinance[];
}

export const REGRAS_REGIAO: RegraRegiao[] = [
  "desligada",
  "so_centro_oeste",
  "regiao_escolhe_linha",
];
export const CENTRO_OESTE = "Centro-Oeste";

/** Linhas ativas que atendem a região (nacionais primeiro, na ordem do banco). */
export function linhasDaRegiao(linhas: LinhaFinance[], regiao: string | null): string[] {
  const ativas = linhas.filter((l) => l.ativa);
  const regionais = regiao ? ativas.filter((l) => l.regioes?.includes(regiao)) : [];
  return [...regionais, ...ativas.filter((l) => !l.regioes)].map((l) => l.linha);
}

/**
 * Aplica a leitura vigente a uma oferta de Finance que já passou na régua do produto. Só mexe em `elegivel`: conta
 * que já está fora ou a confirmar continua com o motivo dela.
 */
export function aplicarRegiaoFinance(
  resultado: Oferta,
  r: RegiaoDaConta | undefined | null,
): Oferta {
  if (!r || r.regra === "desligada" || resultado.status !== "elegivel") return resultado;
  if (r.regra === "so_centro_oeste") {
    if (!r.uf)
      return {
        status: "revisar",
        reason:
          "Confirmar a UF da empresa: pela regra de região, o Finance só atende o Centro-Oeste (FCO).",
      };
    if (r.regiao !== CENTRO_OESTE)
      return {
        status: "fora_regra",
        reason: `Fora do Finance pela regra de região: só Centro-Oeste (FCO); a empresa é de ${r.uf}.`,
      };
    return { ...resultado, reason: `${resultado.reason} Centro-Oeste (${r.uf}): linha FCO.` };
  }
  const linhas = linhasDaRegiao(r.linhas, r.regiao);
  if (!r.uf)
    return {
      ...resultado,
      reason: `${resultado.reason} Linha regional a definir: falta a UF${linhas.length ? `; nacionais: ${linhas.join(", ")}` : ""}.`,
    };
  return {
    ...resultado,
    reason: `${resultado.reason} ${r.uf}: ${linhas.length ? "linhas " + linhas.join(", ") : "nenhuma linha ativa para a região"}.`,
  };
}

/** Junta a resposta de `ops.monetizacao_regiao_contas` às contas da página. Regra desconhecida vira `desligada`. */
export function regiaoPorConta(
  resposta: {
    regra?: string | null;
    linhas?: LinhaFinance[] | null;
    contas?:
      | {
          key: string;
          uf: string | null;
          regiao: string | null;
          fonte: string | null;
          conflito: boolean;
        }[]
      | null;
  } | null,
): Map<string, RegiaoDaConta> {
  const regra = REGRAS_REGIAO.includes(resposta?.regra as RegraRegiao)
    ? (resposta!.regra as RegraRegiao)
    : "desligada";
  const linhas = resposta?.linhas ?? [];
  return new Map(
    (resposta?.contas ?? []).map((c) => [
      c.key,
      { regra, uf: c.uf, regiao: c.regiao, fonte: c.fonte, conflito: !!c.conflito, linhas },
    ]),
  );
}
