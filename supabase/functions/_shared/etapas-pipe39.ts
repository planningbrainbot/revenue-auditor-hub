// Etapas do pipe 39 (Caixa de Oportunidade) lidas pelo NOME, nunca pelo id: o pipe é reordenado e renomeado, e o
// histórico guardado (payload dos cards, `monetizacao_sync.stages` de cargas antigas) tem os nomes de cada época.
// Um lugar só para a carga (`monetizacao-crm`), o bot de reuniões (`monetizacao-reunioes`), a régua da Operação e a
// tela Gravações. Sem API do Deno: roda também no Node (testes e scripts) e no app.
//
// Cada expressão aceita o nome antigo e o novo:
//   290 · 3 · Conexão                              → 3 · Qualificação (09/10/2026)
//   277 · Reunião agendada (até 01/10)             → 4 · Reunião de levantamento agendada (01/10)
//                                                  → 4 · Agendado - Levantamento com sócio (09/10)
//   287 · Reunião realizada (até 01/10)            → 5 · Reunião de levantamento realizada (01/10)
//                                                  → 5 · Realizado - Levantamento com sócio (09/10)
// "Reunião de proposta" nunca é levantamento, e "Realizado - Levantamento" nunca é agendado: `chaveDaEtapa` decide
// nessa ordem.

export type ChaveEtapa =
  | "base"
  | "abordagem"
  | "gatilho"
  | "conexao"
  | "agendada"
  | "realizada"
  | "reuniaoProposta"
  | "negociacao"
  | "propostaEnviada"
  | "standby";

export const ETAPA: Readonly<Record<ChaveEtapa, RegExp>> = {
  base: /base/i,
  abordagem: /abordag/i,
  // Encerrada em 01/10/2026; antes da etapa Conexão existir, fazia o papel dela.
  gatilho: /gatilho/i,
  // "Desqualificado" não é a etapa de qualificação.
  conexao: /conex|(?<!des)qualifica/i,
  agendada: /reuni.*(agend|marc)|agendad.*levant|levant.*agendad/i,
  realizada: /reuni.*realiz|realizad.*levant|levant.*realizad/i,
  reuniaoProposta: /reuni.*propost/i,
  negociacao: /negocia/i,
  propostaEnviada: /proposta.*envi/i,
  standby: /stand ?by/i,
};

// Ordem de decisão: a primeira que casa é a chave. Proposta antes de agendada/realizada; realizada antes de agendada.
const ORDEM: ChaveEtapa[] = [
  "base",
  "gatilho",
  "standby",
  "reuniaoProposta",
  "realizada",
  "agendada",
  "conexao",
  "abordagem",
  "propostaEnviada",
  "negociacao",
];

/** O papel da etapa no funil, pelo nome (antigo ou novo); `null` quando o nome não é de nenhuma etapa conhecida. */
export function chaveDaEtapa(nome: string | null | undefined): ChaveEtapa | null {
  const n = String(nome ?? "");
  if (!n) return null;
  for (const chave of ORDEM) if (ETAPA[chave].test(n)) return chave;
  return null;
}

/** A primeira etapa da lista com este papel. */
export function etapaDaChave<T extends { name: string }>(
  stages: readonly T[],
  chave: ChaveEtapa,
): T | undefined {
  return stages.find((s) => chaveDaEtapa(s.name) === chave);
}
