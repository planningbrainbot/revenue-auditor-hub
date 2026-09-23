// Rede por unidade: faturamento, royalties + CSC e concentração na mesma janela de meses completos
// da trajetória (resumirLeitura da leitura "rede"). Fora dessa janela nada entra: mês parcial ou em
// rascunho não vira realizado.
import type { Estado } from "./contrato.ts";
import type { LeituraReceita, ResumoLeitura } from "./receita.ts";

export interface LinhaUnidade {
  unidade: string;
  faturamento: number;
  participacao: number;
  /** Royalties + CSC devidos à matriz na janela; null quando a leitura não trouxe a apuração. */
  royaltiesCsc: number | null;
  takeRate: number | null;
}

export interface RedeUnidades {
  estado: Estado;
  janela: { de: string; ate: string; meses: number } | null;
  linhas: LinhaUnidade[];
  total: number | null;
  top1: number | null;
  top3: number | null;
  /** Herfindahl (0 a 1) sobre a participação no faturamento. */
  hhi: number | null;
  somaParticipacoes: number | null;
  notas: string[];
}

export function resumirRedeUnidades(leitura: LeituraReceita, resumo: ResumoLeitura): RedeUnidades {
  const f = resumo.fechados;
  if (!f)
    return {
      estado: resumo.estado,
      janela: null,
      linhas: [],
      total: null,
      top1: null,
      top3: null,
      hhi: null,
      somaParticipacoes: null,
      notas: resumo.notas,
    };
  const dentro = (m: string) => m >= f.de && m <= f.ate;
  const fat = new Map<string, number>();
  for (const l of leitura.linhas)
    if (dentro(l.mes)) fat.set(l.chave, (fat.get(l.chave) ?? 0) + Math.round(l.valor * 100));
  // null = alguma apuração da unidade na janela veio sem royalties: a soma da unidade é desconhecida.
  const roy = new Map<string, number | null>();
  for (const c of leitura.complementos ?? [])
    if (dentro(c.mes)) {
      const antes = roy.has(c.chave) ? roy.get(c.chave)! : 0;
      roy.set(
        c.chave,
        antes === null || c.royaltiesCsc === null ? null : antes + Math.round(c.royaltiesCsc * 100),
      );
    }
  const totalCent = [...fat.values()].reduce((s, v) => s + v, 0);
  const royaltiesDa = (u: string) => {
    const v = roy.has(u) ? roy.get(u)! : 0;
    return v === null ? null : v / 100;
  };
  const linhas = [...fat]
    .map(([unidade, c]) => ({
      unidade,
      faturamento: c / 100,
      participacao: totalCent ? c / totalCent : 0,
      royaltiesCsc: leitura.complementos ? royaltiesDa(unidade) : null,
      takeRate:
        leitura.complementos && c && royaltiesDa(unidade) !== null ? roy.get(unidade)! / c : null,
    }))
    .sort((a, b) => b.faturamento - a.faturamento);
  const soma = (n: number) => linhas.slice(0, n).reduce((s, l) => s + l.participacao, 0);
  return {
    estado: resumo.estado,
    janela: { de: f.de, ate: f.ate, meses: f.meses },
    linhas,
    total: totalCent / 100,
    top1: linhas.length ? soma(1) : null,
    top3: linhas.length ? soma(3) : null,
    hhi: linhas.length ? linhas.reduce((s, l) => s + l.participacao ** 2, 0) : null,
    somaParticipacoes: linhas.length ? linhas.reduce((s, l) => s + l.participacao, 0) : null,
    notas: resumo.notas,
  };
}
