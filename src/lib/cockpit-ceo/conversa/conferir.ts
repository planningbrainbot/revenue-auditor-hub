// Conferência do texto da conclusão: todo número precisa vir de um resultado da rodada.
//
// O modelo escreve a frase; o número tem de existir nos resultados (valor, comparação, composição
// ou destaque derivado por regra), com a tolerância do arredondamento que o próprio texto mostra
// ("R$ 7,46 mi" aceita ±R$ 5 mil). Frase com número sem origem sai inteira e o descarte fica
// registrado. Datas, anos, números da própria pergunta e contagens de itens mostrados não contam.
import { numerosDoResultado } from "./resultado.ts";
import type { Resultado } from "./resultado.ts";
import { MEDIA_MENSAL_NECESSARIA, META_ANUAL, ANO_ALVO } from "../receita.ts";

export interface NumeroLido {
  texto: string;
  valor: number;
  tolerancia: number;
  percentual: boolean;
  reais: boolean;
}

const ESCALAS: [RegExp, number][] = [
  [/^(bi|bilh(ão|ões|ao|oes))$/i, 1e9],
  [/^(mi|milh(ão|ões|ao|oes)|mm)$/i, 1e6],
  [/^mil$/i, 1e3],
];

// Número em pt-BR: 1.234.567,89 · 7,46 · 560 · com R$ antes, % ou escala depois.
const NUMERO =
  /(R\$\s*)?(?<![\p{L}\d/.,])([+\-−]?\d{1,3}(?:\.\d{3})+(?:,\d+)?|[+\-−]?\d+(?:,\d+)?)(?![\d/])(\s*%|\s*(?:bilhões|bilhão|bilhoes|bilhao|bi|milhões|milhão|milhoes|milhao|mi|mm|mil)\b)?/giu;

export function lerNumeros(texto: string): NumeroLido[] {
  const out: NumeroLido[] = [];
  for (const m of texto.matchAll(NUMERO)) {
    const [bruto, rs, num, sufixo] = m;
    // Datas (24/09, 08/2026) ficam fora pelo lookbehind/lookahead de "/".
    const semSinal = num.replace(/^[+\-−]/, "");
    const [inteira, dec = ""] = semSinal.split(",");
    const valorBase = Number(inteira.replace(/\./g, "") + (dec ? "." + dec : ""));
    const suf = (sufixo ?? "").trim();
    const percentual = suf === "%";
    let escala = 1;
    for (const [re, e] of ESCALAS) if (re.test(suf)) escala = e;
    const tolerancia = 0.5 * 10 ** -dec.length * escala;
    out.push({
      texto: bruto.trim(),
      valor: valorBase * escala,
      tolerancia,
      percentual,
      reais: !!rs || escala > 1,
    });
  }
  return out;
}

const ehAno = (n: NumeroLido) =>
  !n.reais && !n.percentual && Number.isInteger(n.valor) && n.valor >= 2000 && n.valor <= 2100;

/** Frases: corta em ponto final, exclamação ou interrogação seguidos de espaço e maiúscula. */
function frases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9"“])/u)
    .map((f) => f.trim())
    .filter(Boolean);
}

export function conferirTexto(
  texto: string,
  resultados: Resultado[],
  pergunta: string,
): { texto: string; descartadas: string[] } {
  const permitidos = new Set<number>([META_ANUAL, MEDIA_MENSAL_NECESSARIA, ANO_ALVO]);
  for (const r of resultados) {
    for (const n of numerosDoResultado(r)) permitidos.add(n);
    const d = r.dados;
    // Quantidade de itens mostrados ("2 unidades", "6 meses") é contagem visível na tela.
    const qtd =
      d.forma === "categorias"
        ? d.itens.length
        : d.forma === "serie"
          ? d.pontos.length
          : d.forma === "funil"
            ? d.etapas.length
            : d.forma === "acoes"
              ? d.itens.length
              : d.forma === "coorte"
                ? d.linhas.length
                : null;
    if (qtd !== null) permitidos.add(qtd);
    if (d.forma === "serie") permitidos.add(d.series.length);
  }
  for (const n of lerNumeros(pergunta)) permitidos.add(n.valor);
  const lista = [...permitidos];
  const confere = (n: NumeroLido) =>
    ehAno(n) || lista.some((p) => Math.abs(Math.abs(p) - Math.abs(n.valor)) <= n.tolerancia + 1e-9);

  const mantidas: string[] = [];
  const descartadas: string[] = [];
  for (const f of frases(texto)) {
    if (lerNumeros(f).every(confere)) mantidas.push(f);
    else descartadas.push(f);
  }
  return { texto: mantidas.join(" "), descartadas };
}
