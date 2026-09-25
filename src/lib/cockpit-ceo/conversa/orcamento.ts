// Teto de consumo de IA da conversa. Conferido antes de cada chamada ao modelo, sobre o agregado
// que o banco devolve (ops.cockpit_ia_orcamento): mês de todas as pessoas, dia de quem pergunta.
// Não há renovação por lote: o mês só vira no calendário. Chamada sem custo informado conta pelo
// custo estimado de uma chamada cara, para o teto não ficar cego.
export interface Orcamento {
  mes_usd: number;
  mes_desconhecidas: number;
  dia_usuario_usd: number;
  dia_usuario_chamadas: number;
}

export interface Limites {
  mesUsd: number;
  diaUsuarioUsd: number;
  diaUsuarioChamadas: number;
  custoEstimadoDesconhecida: number;
}

const num = (v: string | undefined, padrao: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : padrao;
};

export function limitesDoAmbiente(env: Record<string, string | undefined>): Limites {
  return {
    mesUsd: num(env.COCKPIT_IA_TETO_MES_USD, 20),
    diaUsuarioUsd: num(env.COCKPIT_IA_TETO_DIA_USD, 3),
    diaUsuarioChamadas: num(env.COCKPIT_IA_CHAMADAS_DIA, 150),
    custoEstimadoDesconhecida: num(env.COCKPIT_IA_CUSTO_DESCONHECIDA_USD, 0.25),
  };
}

export function avaliarOrcamento(o: Orcamento, l: Limites): { ok: boolean; motivo?: string } {
  const mes = Number(o.mes_usd) + Number(o.mes_desconhecidas) * l.custoEstimadoDesconhecida;
  if (mes >= l.mesUsd)
    return { ok: false, motivo: `o teto do mês (US$ ${l.mesUsd.toFixed(2)}) foi atingido` };
  if (Number(o.dia_usuario_usd) >= l.diaUsuarioUsd)
    return {
      ok: false,
      motivo: `o seu teto do dia (US$ ${l.diaUsuarioUsd.toFixed(2)}) foi atingido`,
    };
  if (Number(o.dia_usuario_chamadas) >= l.diaUsuarioChamadas)
    return {
      ok: false,
      motivo: `o seu limite de ${l.diaUsuarioChamadas} chamadas no dia foi atingido`,
    };
  return { ok: true };
}
