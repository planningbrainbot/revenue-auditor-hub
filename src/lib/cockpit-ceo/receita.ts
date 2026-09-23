// Receita e trajetória para a meta de R$ 1 bilhão de faturamento anual em 2030.
//
// O perímetro da meta NÃO está decidido (decisão do dono em 22/09/2026: "mostrar candidatos, decido
// depois"). Por isso aqui não existe "o" gap: cada leitura candidata é resumida sozinha — o que ela
// já tem de realizado, a média mensal, quantas vezes precisa crescer para chegar aos R$ 83,3 mi por
// mês que a meta exige em 2030 e, só quando há 12 meses fechados completos, o crescimento anual
// necessário. Leituras não se somam: royalties da rede aparecem como receita da matriz no grupo.
//
// Regras de honestidade: mês em andamento fica de fora de toda conta; mês sem dado na fonte não vira
// zero e quebra a janela de 12 meses; leitura sem acesso não mostra número nenhum.
import type { Destino, Estado } from "./contrato.ts";

export const META_ANUAL = 1_000_000_000;
export const ANO_ALVO = 2030;
export const MEDIA_MENSAL_NECESSARIA = META_ANUAL / 12;

export type IdLeitura = "grupo" | "rede";

/** Agregado por mês ("AAAA-MM") e por empresa ou unidade. Nunca linha de cliente. */
export interface LinhaMensal {
  mes: string;
  chave: string;
  valor: number;
}

export interface LeituraReceita {
  id: IdLeitura;
  titulo: string;
  definicao: string;
  fonte: string;
  estado: Estado;
  nota: string | null;
  linhas: LinhaMensal[];
  cobertura: string[];
  destino: Destino;
  /** Meses ("AAAA-MM") que a própria fonte marca como incompletos. Nunca entram na conta. */
  parciaisFonte?: string[];
  /** Observação da fonte para o mês (cobertura, ausência declarada). Só texto de sistema. */
  notasPorMes?: Record<string, string>;
  /** Só a rede: royalties + CSC devidos à matriz por unidade e mês, da mesma apuração. */
  complementos?: { mes: string; chave: string; royaltiesCsc: number }[];
}

export interface ResumoLeitura {
  id: IdLeitura;
  titulo: string;
  definicao: string;
  fonte: string;
  estado: Estado;
  historicoDesde: string | null;
  serie: { mes: string; valor: number; parcial: boolean }[];
  fechados: { de: string; ate: string; meses: number; soma: number; media: number } | null;
  doze: number | null;
  multiploNecessario: number | null;
  crescimentoAnualNecessario: number | null;
  anosAteAlvo: number | null;
  porChave: { chave: string; valor: number; participacao: number }[];
  notas: string[];
  notasPorMes: Record<string, string>;
  destino: Destino;
}

export const mesBr = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const mesAnterior = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
const mesesEntre = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
  (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));

export function resumirLeitura(l: LeituraReceita, hoje: string): ResumoLeitura {
  const base: ResumoLeitura = {
    id: l.id,
    titulo: l.titulo,
    definicao: l.definicao,
    fonte: l.fonte,
    estado: l.estado,
    historicoDesde: null,
    serie: [],
    fechados: null,
    doze: null,
    multiploNecessario: null,
    crescimentoAnualNecessario: null,
    anosAteAlvo: null,
    porChave: [],
    notas: [...(l.nota ? [l.nota] : []), ...l.cobertura],
    notasPorMes: l.notasPorMes ?? {},
    destino: l.destino,
  };
  if (l.estado !== "disponivel" && l.estado !== "parcial") return base;

  // Somas em centavos, como receitaSomada(): nada de 600,5999….
  const centavos = new Map<string, number>();
  for (const x of l.linhas)
    centavos.set(x.mes, (centavos.get(x.mes) ?? 0) + Math.round(x.valor * 100));
  if (!centavos.size)
    return {
      ...base,
      estado: "nao_apurado",
      notas: [...base.notas, "Nenhum lançamento na fonte."],
    };

  const mesAtual = hoje.slice(0, 7);
  const parciaisFonte = new Set(l.parciaisFonte ?? []);
  const todos = [...centavos.keys()].sort();
  const reais = (m: string) => (centavos.get(m) ?? 0) / 100;
  const serie = todos
    .filter((m) => m <= mesAtual)
    .slice(-24)
    .map((m) => ({ mes: m, valor: reais(m), parcial: m === mesAtual || parciaisFonte.has(m) }));

  // Janela: meses fechados contíguos, terminando no último mês fechado, até 12. Mês que a fonte
  // marca como parcial não é mês fechado: no fim da série ele é pulado (a janela termina antes);
  // no meio, é lacuna como mês sem dado.
  const notas = [...base.notas];
  const ultimoFechado = mesAnterior(mesAtual);
  const completo = (x: string) => centavos.has(x) && !parciaisFonte.has(x);
  let m = ultimoFechado;
  if (!centavos.has(m)) notas.push(`O último mês fechado (${mesBr(m)}) não tem dado na fonte.`);
  const pulados: string[] = [];
  while (centavos.has(m) && parciaisFonte.has(m)) {
    pulados.unshift(m);
    m = mesAnterior(m);
  }
  if (pulados.length)
    notas.push(
      `${pulados.map(mesBr).join(", ")} ${pulados.length > 1 ? "estão marcados" : "está marcado"} como parcial pela fonte e fica${pulados.length > 1 ? "m" : ""} fora da conta.`,
    );
  const janela: string[] = [];
  while (janela.length < 12 && completo(m)) {
    janela.unshift(m);
    m = mesAnterior(m);
  }
  if (janela.length < 12 && janela.length > 0) {
    if (parciaisFonte.has(m))
      notas.push(
        `${mesBr(m)} está marcado como parcial pela fonte. A conta de 12 meses não atravessa lacuna: ${janela.length} de 12 meses fechados contíguos.`,
      );
    else if (todos.some((x) => x < m))
      notas.push(
        `Mês sem dado na fonte: ${mesBr(m)}. A conta de 12 meses não atravessa lacuna: ${janela.length} de 12 meses fechados contíguos.`,
      );
    else
      notas.push(
        `${janela.length} de 12 meses fechados com dado (histórico desde ${mesBr(todos[0])}).`,
      );
  }
  if (centavos.has(mesAtual))
    notas.push(`${mesBr(mesAtual)} está em andamento e não entra na conta.`);
  if (!janela.length) return { ...base, estado: "parcial", historicoDesde: todos[0], serie, notas };

  const somaCent = janela.reduce((s, x) => s + (centavos.get(x) ?? 0), 0);
  const soma = somaCent / 100;
  const media = soma / janela.length;
  const ate = janela.at(-1)!;
  const doze = janela.length === 12 ? soma : null;
  const anosAteAlvo = mesesEntre(ate, `${ANO_ALVO}-12`) / 12;

  const porChaveCent = new Map<string, number>();
  const naJanela = new Set(janela);
  for (const x of l.linhas)
    if (naJanela.has(x.mes))
      porChaveCent.set(x.chave, (porChaveCent.get(x.chave) ?? 0) + Math.round(x.valor * 100));
  const porChave = [...porChaveCent]
    .map(([chave, c]) => ({ chave, valor: c / 100, participacao: somaCent ? c / somaCent : 0 }))
    .sort((a, b) => b.valor - a.valor);

  return {
    ...base,
    estado: l.estado === "disponivel" && doze !== null ? "disponivel" : "parcial",
    historicoDesde: todos[0],
    serie,
    fechados: { de: janela[0], ate, meses: janela.length, soma, media },
    doze,
    multiploNecessario: media > 0 ? MEDIA_MENSAL_NECESSARIA / media : null,
    crescimentoAnualNecessario:
      doze && doze > 0 && anosAteAlvo > 0 ? Math.pow(META_ANUAL / doze, 1 / anosAteAlvo) - 1 : null,
    anosAteAlvo,
    porChave,
    notas,
  };
}
