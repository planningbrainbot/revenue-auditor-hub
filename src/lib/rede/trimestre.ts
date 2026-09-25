/**
 * Trimestres civis para os seletores da Rede (IDU e Indicadores do Trimestre).
 *
 * As duas telas montavam a mesma lista com uma diferença que importa: o fim.
 * `idu_apuracao` espera o fim EXCLUSIVO (1º dia do trimestre seguinte);
 * `indicadores_trimestre` espera o fim INCLUSIVO (último dia do trimestre).
 * Por isso o fim é parâmetro, e não padrão escondido.
 *
 * Datas em "aaaa-mm-dd", montadas em UTC para não depender do fuso de quem
 * abre a tela.
 */

export type Trimestre = { key: string; label: string; ini: string; fim: string };

const MESES = ["jan–mar", "abr–jun", "jul–set", "out–dez"];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Do trimestre corrente para trás, `quantos` trimestres (chave aaaa-Tn). */
export function listaTrimestres({
  fim,
  quantos = 8,
  hoje = new Date(),
}: {
  fim: "exclusivo" | "inclusivo";
  quantos?: number;
  hoje?: Date;
}): Trimestre[] {
  const out: Trimestre[] = [];
  let ano = hoje.getFullYear();
  let q = Math.floor(hoje.getMonth() / 3) + 1;
  for (let i = 0; i < quantos; i += 1) {
    const mesIni = (q - 1) * 3;
    out.push({
      key: `${ano}-T${q}`,
      label: `T${q}/${ano} · ${MESES[q - 1]}`,
      ini: iso(new Date(Date.UTC(ano, mesIni, 1))),
      fim:
        fim === "exclusivo"
          ? iso(new Date(Date.UTC(ano, mesIni + 3, 1)))
          : iso(new Date(Date.UTC(ano, mesIni + 3, 0))),
    });
    q -= 1;
    if (q === 0) {
      q = 4;
      ano -= 1;
    }
  }
  return out;
}
