/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive e do banco chega sem tipo. */
// Próximo passo sugerido pelo Jev para os cards parados da reta final do pipe 39 (pedido do Pedro em 14/10/2026,
// depois da call com o Paulo). Sem API do Deno: testado no Node em tests/monetizacao-proximo-passo.test.mjs.
//
// Card elegível: aberto, do Agendado em diante (Stand by incluído), sem atividade futura (sem próxima ou atrasada).
// O Jev (OpenRouter Decisions, typesafe/jev-1.13) recebe a etapa, os dias parado, a última e a próxima atividade, a data
// esperada e as notas escritas pelo dono do card (o dossiê e as notas automáticas ficam fora), e devolve uma escolha
// entre seis passos e uma urgência de 0 a 2. A sugestão não escreve nada no Pipedrive: só o Brain mostra.

export const VERSAO = "jev-proximo-passo-v1-2026-10-14";
export const JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODELO = "typesafe/jev-1.13";
/** Reavalia o card quando ele muda ou quando a sugestão passa disto. */
export const VALIDADE_MS = 20 * 3600_000;
/** Teto de texto das notas mandado ao Jev (o `state` acima de ~16 mil caracteres dá 400). */
export const LIMITE_NOTAS = 3000;

export const PASSOS: Record<string, string> = {
  ligar_hoje:
    "Ligar para o decisor e retomar a conversa: o card está parado, sem contato recente, e não houve recusa.",
  marcar_especialista:
    "Marcar a reunião de proposta com o especialista do produto (Cella, Finance ou Consultoria): o levantamento com o sócio aconteceu e a call do especialista ainda não está marcada.",
  enviar_proposta:
    "Preparar e enviar a proposta por escrito: a reunião de proposta aconteceu ou a negociação já pede a proposta.",
  cobrar_retorno:
    "Cobrar o retorno do cliente sobre a proposta, a minuta ou o contrato que ele recebeu e ainda não respondeu.",
  agendar_retomada:
    "Agendar uma retomada com data: o cliente pediu para esperar (transição contábil, orçamento, momento da empresa).",
  perder_com_motivo:
    "Marcar como perdido com motivo: o cliente recusou, não tem fit, ou está sem resposta há muito tempo apesar das tentativas.",
};
export const ROTULO_PASSO: Record<string, string> = {
  ligar_hoje: "Ligar e retomar",
  marcar_especialista: "Marcar call com especialista",
  enviar_proposta: "Enviar proposta",
  cobrar_retorno: "Cobrar retorno",
  agendar_retomada: "Agendar retomada com data",
  perder_com_motivo: "Perder com motivo",
};
export const URGENCIAS = ["Pode esperar até a semana que vem", "Fazer nesta semana", "Fazer hoje"];

export interface Etapa {
  id: number;
  name: string;
  order: number;
}

/** Dia (aaaa-mm-dd) em São Paulo. */
export const diaSP = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

const instante = (at: string) => {
  const s = String(at).trim().replace(" ", "T");
  return Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z");
};

/** Dias desde a última entrada na etapa atual (pelas passagens da carga). */
export function diasNaEtapa(c: any, agora: Date): number | null {
  const entradas = (c.moves ?? []).filter((m: any) => m.stage_id === c.stage_id);
  const ultima = entradas.at(-1);
  if (!ultima) return null;
  return Math.max(0, Math.floor((agora.getTime() - instante(ultima.at)) / 86400000));
}

/** Aberto, do Agendado em diante, sem atividade futura. `ordemAgendado` = ordem da etapa Agendado no pipe. */
export function elegivel(c: any, etapas: Etapa[], ordemAgendado: number, hoje: string): boolean {
  if (c?.status !== "open") return false;
  const ordem = etapas.find((e) => e.id === c.stage_id)?.order ?? -1;
  if (ordem < ordemAgendado) return false;
  return !c.next_activity || String(c.next_activity) < hoje;
}

/** Assinatura do que o Jev viu: muda quando o card muda, e a sugestão é refeita. */
export const baseDoCard = (c: any) =>
  [
    c.stage_id,
    c.next_activity ?? "",
    c.last_activity_date ?? "",
    c.expected_close ?? "",
    c.updated_at ?? "",
  ].join("|");

export function precisaAvaliar(
  c: any,
  anterior: { base: string; gerado_em: string; versao: string } | undefined,
  agora: Date,
): boolean {
  if (!anterior) return true;
  if (anterior.versao !== VERSAO || anterior.base !== baseDoCard(c)) return true;
  return agora.getTime() - Date.parse(anterior.gerado_em) > VALIDADE_MS;
}

const semHtml = (s: string) =>
  String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

/**
 * Notas que o Jev lê: as escritas pelo dono do card, das mais novas para as mais velhas, até o teto. O dossiê, a
 * "Preparação comercial" e as avaliações por IA entram pelo usuário de integração (Ops Planning) e ficam fora.
 */
export function notasParaJev(notas: any[], dono: number | null): string {
  const doDono = (notas ?? [])
    .filter((n) => n && n.active_flag !== false && dono && Number(n.user_id) === dono)
    .sort((a, b) => String(b.add_time).localeCompare(String(a.add_time)));
  let texto = "";
  for (const n of doDono) {
    const linha = `[${String(n.add_time).slice(0, 10)}] ${semHtml(n.content)}\n`;
    if (texto.length + linha.length > LIMITE_NOTAS) {
      if (!texto) texto = linha.slice(0, LIMITE_NOTAS);
      break;
    }
    texto += linha;
  }
  return texto.trim() || "sem notas do responsável";
}

/** Teto da última nota guardada para a fila do Forecast. */
export const LIMITE_NOTA_FILA = 600;

/**
 * A última nota escrita pelo dono do card, sem HTML, com o instante em ISO (19/10/2026, fila do Forecast). As mesmas
 * notas que o Jev lê: o dossiê e as notas automáticas entram pelo usuário de integração e ficam fora. null sem nota.
 */
export function ultimaNotaDoDono(
  notas: any[],
  dono: number | null,
): { nota: string; nota_em: string | null } | null {
  const ultima = (notas ?? [])
    .filter((n) => n && n.active_flag !== false && dono && Number(n.user_id) === dono)
    .sort((a, b) => String(b.add_time).localeCompare(String(a.add_time)))
    .find((n) => semHtml(String(n.content ?? "")).trim());
  if (!ultima) return null;
  const quando = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(ultima.add_time))
    ? String(ultima.add_time).replace(" ", "T") + "Z"
    : null;
  return {
    nota: semHtml(String(ultima.content ?? ""))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, LIMITE_NOTA_FILA),
    nota_em: quando && Number.isFinite(Date.parse(quando)) ? new Date(quando).toISOString() : null,
  };
}

export function pedidoJev(c: any, etapa: string, notas: string, agora: Date) {
  const dias = diasNaEtapa(c, agora);
  const hoje = diaSP(agora);
  const proxima = !c.next_activity
    ? "nenhuma marcada"
    : String(c.next_activity) < hoje
      ? `atrasada desde ${c.next_activity}`
      : String(c.next_activity);
  return {
    model: JEV_MODELO,
    state: {
      etapa,
      dias_na_etapa: dias === null ? "desconhecido" : String(dias),
      produto: String(c.route ?? "sem produto"),
      ultima_atividade: c.last_activity_date ? String(c.last_activity_date) : "nenhuma registrada",
      proxima_atividade: proxima,
      data_esperada_de_fechamento: c.expected_close ? String(c.expected_close) : "não preenchida",
      notas,
    },
    questions: {
      passo: {
        type: "choice",
        instructions:
          "Você apoia a pré-venda de um pipe de vendas B2B. O negócio está na etapa `etapa`, parado há `dias_na_etapa` dias e sem próximo passo marcado. Pelas `notas` do responsável e pelas datas, qual é o próximo passo mais útil para mover este negócio agora?",
        criteria: PASSOS,
      },
      urgencia: {
        type: "score",
        instructions:
          "Quão urgente é dar esse próximo passo, considerando os dias parado, a etapa e o que dizem as notas?",
        criteria: URGENCIAS,
      },
    },
  };
}

export interface Sugestao {
  passo: string;
  confianca: number | null;
  urgencia: number;
  custo_usd: number | null;
}

/** Valida a resposta do Jev contra as opções; fora do contrato é erro, nunca um palpite. */
export function lerResposta(raw: any): Sugestao {
  const a = raw?.answers;
  const passo = a?.passo?.choice;
  if (typeof passo !== "string" || !(passo in PASSOS))
    throw new Error("Jev: passo fora das opções");
  // O score do Jev é o valor esperado da escala (ex.: 1,22 entre 0 e 2); o nível é o mais próximo.
  const urg = a?.urgencia?.score;
  if (typeof urg !== "number" || !Number.isFinite(urg) || urg < 0 || urg > URGENCIAS.length - 1)
    throw new Error("Jev: urgência fora da escala");
  const conf = a?.passo?.confidence;
  const custo = raw?.usage?.cost;
  return {
    passo,
    confianca: typeof conf === "number" && conf >= 0 && conf <= 1 ? conf : null,
    urgencia: Math.round(urg),
    custo_usd: typeof custo === "number" && custo >= 0 ? custo : null,
  };
}

// ── Previsão de fechamento (15/10/2026) ───────────────────────────────────────────────────────────────────────────
// A tela Forecast agrupa pela data esperada do Pipedrive, e o time ainda não preenche. Enquanto o card da Reunião de
// proposta em diante (sem Stand by) não tem data, o Jev lê as notas e estima o horizonte. A data do card, quando
// existe, sempre manda; a estimativa aparece na tela marcada como do Jev.
export const VERSAO_PREVISAO = "jev-previsao-v1-2026-10-15";
export const HORIZONTES_JEV: Record<string, string> = {
  esta_semana:
    "Deve fechar (cliente aceita a proposta ou assina) até o próximo domingo: há sinal claro e recente nas notas.",
  este_mes: "Deve fechar ainda neste mês, depois desta semana.",
  proximo_mes: "Deve fechar no mês que vem.",
  sem_previsao:
    "Não há sinal de fechamento próximo: cliente sumido, pediu para esperar sem data, ou as notas não dizem nada.",
};

/** Aberto, da Reunião de proposta em diante, sem Stand by e sem data esperada de fechamento. */
export function elegivelPrevisao(c: any, etapas: Etapa[], ordemProposta: number): boolean {
  if (c?.status !== "open" || c.expected_close) return false;
  const etapa = etapas.find((e) => e.id === c.stage_id);
  if (!etapa || /stand ?by/i.test(etapa.name)) return false;
  return etapa.order >= ordemProposta;
}

export function pedidoPrevisao(c: any, etapa: string, notas: string, agora: Date) {
  const dias = diasNaEtapa(c, agora);
  return {
    model: JEV_MODELO,
    state: {
      hoje: diaSP(agora),
      etapa,
      dias_na_etapa: dias === null ? "desconhecido" : String(dias),
      produto: String(c.route ?? "sem produto"),
      ultima_atividade: c.last_activity_date ? String(c.last_activity_date) : "nenhuma registrada",
      proxima_atividade: c.next_activity ? String(c.next_activity) : "nenhuma marcada",
      notas,
    },
    questions: {
      fechamento: {
        type: "choice",
        instructions:
          "Hoje é `hoje`. O negócio está na etapa `etapa` de um pipe de vendas B2B. Pelas `notas` do responsável e pelas datas, quando ele deve fechar?",
        criteria: HORIZONTES_JEV,
      },
    },
  };
}

export function lerPrevisao(raw: any): {
  horizonte: string;
  confianca: number | null;
  custo_usd: number | null;
} {
  const a = raw?.answers?.fechamento;
  if (typeof a?.choice !== "string" || !(a.choice in HORIZONTES_JEV))
    throw new Error("Jev: previsão fora das opções");
  const conf = a.confidence;
  const custo = raw?.usage?.cost;
  return {
    horizonte: a.choice,
    confianca: typeof conf === "number" && conf >= 0 && conf <= 1 ? conf : null,
    custo_usd: typeof custo === "number" && custo >= 0 ? custo : null,
  };
}

export interface DepsProximoPasso {
  cards: () => Promise<any[]>;
  etapas: () => Promise<Etapa[]>;
  anteriores: () => Promise<Map<number, { base: string; gerado_em: string; versao: string }>>;
  notas: (deal: number) => Promise<any[]>;
  jev: (pedido: any) => Promise<any>;
  gravar: (linha: Record<string, unknown>) => Promise<void>;
  /** Previsão de fechamento (15/10/2026); sem estes dois, a rodada só faz o próximo passo. */
  anterioresPrevisao?: () => Promise<
    Map<number, { base: string; gerado_em: string; versao: string }>
  >;
  gravarPrevisao?: (linha: Record<string, unknown>) => Promise<void>;
  /** Última nota do dono de cada card da reta final, para a fila do Forecast (19/10/2026). */
  gravarNotas?: (linhas: Record<string, unknown>[]) => Promise<void>;
  agora: Date;
  ativo: boolean;
  limite: number;
  orcamentoMs: number;
}

export async function rodarProximoPasso(d: DepsProximoPasso) {
  const comeco = Date.now();
  const etapas = await d.etapas();
  const agendado = etapas.find(
    (e) => /agend|marcad/i.test(e.name) && /reuni|levantamento/i.test(e.name),
  );
  if (!agendado) throw new Error("Etapa Agendado não encontrada no pipe");
  const hoje = diaSP(d.agora);
  const [cards, anteriores] = await Promise.all([d.cards(), d.anteriores()]);
  // As notas de um card são lidas uma vez por rodada, para o próximo passo e para a previsão.
  const cacheNotas = new Map<number, Promise<any[]>>();
  const notasDe = (deal: number) => {
    if (!cacheNotas.has(deal)) cacheNotas.set(deal, d.notas(deal));
    return cacheNotas.get(deal)!;
  };
  const elegiveis = cards.filter((c) => elegivel(c, etapas, agendado.order, hoje));
  const fila = elegiveis.filter((c) => precisaAvaliar(c, anteriores.get(Number(c.id)), d.agora));
  const resumo = {
    elegiveis: elegiveis.length,
    pendentes: fila.length,
    avaliados: 0,
    erros: [] as { deal: number; erro: string }[],
    custo_usd: 0,
    ativo: d.ativo,
  };
  for (const c of fila.slice(0, d.limite)) {
    if (Date.now() - comeco > d.orcamentoMs) break;
    const etapa = etapas.find((e) => e.id === c.stage_id)?.name ?? String(c.stage ?? "");
    try {
      const notas = notasParaJev(await notasDe(Number(c.id)), Number(c.owner_id) || null);
      const pedido = pedidoJev(c, etapa, notas, d.agora);
      if (!d.ativo) {
        resumo.avaliados++;
        continue;
      }
      const s = lerResposta(await d.jev(pedido));
      resumo.custo_usd += s.custo_usd ?? 0;
      await d.gravar({
        deal_id: Number(c.id),
        passo: s.passo,
        confianca: s.confianca,
        urgencia: s.urgencia,
        base: baseDoCard(c),
        versao: VERSAO,
        gerado_em: d.agora.toISOString(),
        custo_usd: s.custo_usd,
        erro: null,
      });
      resumo.avaliados++;
    } catch (e) {
      resumo.erros.push({ deal: Number(c.id), erro: (e as Error).message.slice(0, 200) });
    }
  }
  const previsao = { elegiveis: 0, pendentes: 0, avaliados: 0 };
  const proposta = etapas.find((e) => /reuni/i.test(e.name) && /propost/i.test(e.name));
  if (d.anterioresPrevisao && d.gravarPrevisao && proposta) {
    const antes = await d.anterioresPrevisao();
    const doForecast = cards.filter((c) => elegivelPrevisao(c, etapas, proposta.order));
    const pendentes = doForecast.filter((c) => {
      const a = antes.get(Number(c.id));
      if (!a) return true;
      if (a.versao !== VERSAO_PREVISAO || a.base !== baseDoCard(c)) return true;
      return d.agora.getTime() - Date.parse(a.gerado_em) > VALIDADE_MS;
    });
    previsao.elegiveis = doForecast.length;
    previsao.pendentes = pendentes.length;
    for (const c of pendentes.slice(0, d.limite)) {
      if (Date.now() - comeco > d.orcamentoMs) break;
      const etapa = etapas.find((e) => e.id === c.stage_id)?.name ?? String(c.stage ?? "");
      try {
        const notas = notasParaJev(await notasDe(Number(c.id)), Number(c.owner_id) || null);
        const pedido = pedidoPrevisao(c, etapa, notas, d.agora);
        if (!d.ativo) {
          previsao.avaliados++;
          continue;
        }
        const r = lerPrevisao(await d.jev(pedido));
        resumo.custo_usd += r.custo_usd ?? 0;
        await d.gravarPrevisao({
          deal_id: Number(c.id),
          horizonte: r.horizonte,
          confianca: r.confianca,
          base: baseDoCard(c),
          versao: VERSAO_PREVISAO,
          gerado_em: d.agora.toISOString(),
          custo_usd: r.custo_usd,
        });
        previsao.avaliados++;
      } catch (e) {
        resumo.erros.push({
          deal: Number(c.id),
          erro: "previsão: " + (e as Error).message.slice(0, 180),
        });
      }
    }
  }
  // Fila do Forecast (19/10/2026): a última nota do dono de toda a reta final, da Reunião de proposta em diante (o
  // Stand by entra). As notas já lidas nesta rodada vêm do cache; o resto é lido agora.
  const notasFila = { cards: 0, gravadas: 0 };
  if (d.gravarNotas && proposta) {
    const ordem = new Map(etapas.map((e) => [e.id, e.order]));
    const reta = cards.filter(
      (c) => c.status === "open" && (ordem.get(Number(c.stage_id)) ?? -1) >= proposta.order,
    );
    notasFila.cards = reta.length;
    const linhas: Record<string, unknown>[] = [];
    for (const c of reta) {
      if (Date.now() - comeco > d.orcamentoMs) break;
      try {
        const u = ultimaNotaDoDono(await notasDe(Number(c.id)), Number(c.owner_id) || null);
        if (u) linhas.push({ deal_id: Number(c.id), ...u, atualizado_em: d.agora.toISOString() });
      } catch (e) {
        resumo.erros.push({
          deal: Number(c.id),
          erro: "nota: " + (e as Error).message.slice(0, 180),
        });
      }
    }
    if (d.ativo && linhas.length) await d.gravarNotas(linhas);
    notasFila.gravadas = d.ativo ? linhas.length : 0;
  }
  return { ...resumo, previsao, notas_fila: notasFila };
}
