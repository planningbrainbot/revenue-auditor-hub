// Regras puras da sync da Central de Tratativas, separadas para teste (tests/base-sinais-sync.test.mjs).
import { strictDate } from "../_shared/strict-date.mjs";

export const PIPE_ID = "307196408"; // [PTRS-CLI-02] Tratativas de Churn

// Fases do pipe em 28/09/2026, lidas pela API. O id manda; o nome só decide fase criada depois.
// "Decisão do Cliente" é fase final no Pipefy (done) mas ainda não diz o desfecho: fica como
// tratativa, fora do envio e visível, até o card ir para Recuperado ou Churn Confirmado.
// A versão 14 publicada fora do git mapeava Recuperado para 343394577, id que não existe mais.
export const FASE_ESTADO = {
  343394573: "tratativa", // Contatar ASAP
  343394570: "tratativa", // Contato Inicial com Cliente
  343394571: "tratativa", // Negociação em Andamento
  343394574: "tratativa", // Proposta de Retenção
  343394572: "tratativa", // Decisão do Cliente
  343394575: "revertido", // Cliente Recuperado (Ganho)
  343394578: "concluido", // Churn Confirmado (Perdido)
};

/** Estado do distrato pela fase: tratativa (pode reverter), concluido (perdido), revertido (retido). */
export function estadoDaFase(id, nome) {
  const porId = FASE_ESTADO[String(id)];
  if (porId) return porId;
  const n = String(nome ?? "");
  if (/perdid|churn confirmad|cancelad|arquivad/i.test(n)) return "concluido";
  if (/recuperad|ganho|retid|revertid/i.test(n)) return "revertido";
  return "tratativa";
}

// `status` é a coluna que o painel de CS, o NPS e as views de qualidade já leem: não muda de sentido.
export const STATUS_DO_ESTADO = { tratativa: "open", concluido: "lost", revertido: "won" };

export const CAMPOS = {
  unidade: "unidade_de_neg_cio",
  mrr: "mrr_r",
  categoria: "categoria_do_churn",
  motivo: "motivo_do_churn",
  dataChurn: "data_do_churn",
  deal: "id_deal_pipedrive",
  cliente: "cliente",
};

export function numeroOuNulo(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function dealOuNulo(raw) {
  const s = String(raw ?? "").trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** `array_value` do conector vem como lista de ids; `value` é o texto dos títulos. */
export function idsDoConector(campo) {
  const v = campo?.array_value;
  return Array.isArray(v) ? v.map(String).filter((x) => /^\d+$/.test(x)) : [];
}

/** Um card do Pipefy vira uma linha de ops.central_tratativas. `agora` é o relógio da rodada. */
export function linhaDoCard(card, agora) {
  const campos = {};
  for (const f of card.fields ?? []) campos[f.field.id] = f;
  const valor = (id) => campos[id]?.value ?? null;
  const fase = card.current_phase ?? {};
  const estado = estadoDaFase(fase.id, fase.name);
  // Entrada na fase atual: é quando o estado passou a valer. Sem histórico, a última atualização.
  const entrada = (card.phases_history ?? []).find((h) => String(h.phase?.id) === String(fase.id))
    ?.firstTimeIn;
  return {
    pipefy_card_id: String(card.id),
    titulo: card.title ?? null,
    estagio: fase.name ?? null,
    fase_id: fase.id ? String(fase.id) : null,
    status: STATUS_DO_ESTADO[estado],
    distrato_estado: estado,
    unidade: valor(CAMPOS.unidade),
    mrr: numeroOuNulo(valor(CAMPOS.mrr)),
    motivo: valor(CAMPOS.categoria),
    observacao: valor(CAMPOS.motivo),
    data_churn: strictDate(valor(CAMPOS.dataChurn)),
    pipedrive_deal_id: dealOuNulo(valor(CAMPOS.deal)),
    pipefy_cliente_ids: idsDoConector(campos[CAMPOS.cliente]),
    update_time: card.updated_at ?? null,
    stage_change_time: entrada ?? card.updated_at ?? null,
    pipefy_criado_em: card.created_at ?? null,
    sincronizado_em: agora,
    empresa_id: null,
  };
}

/**
 * Empresa do card: primeiro pelo conector do Pipefy (registro exato), depois pelo id do negócio.
 * `empresas` = linhas de ops.empresas com id, pipefy_record_id, pipedrive_id e created_at. Com mais de
 * uma empresa pelo mesmo negócio, a mais recente (regra da versão anterior, preservada).
 */
export function resolverEmpresa(linha, empresas) {
  const porPipefy = empresas.find((e) => linha.pipefy_cliente_ids.includes(String(e.pipefy_record_id)));
  if (porPipefy) return porPipefy.id;
  if (linha.pipedrive_deal_id === null) return null;
  const porDeal = empresas
    .filter((e) => String(e.pipedrive_id ?? "") === String(linha.pipedrive_deal_id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return porDeal[0]?.id ?? null;
}

/**
 * Quais linhas do espelho saem: as que não vieram na leitura completa. Leitura vazia não apaga
 * nada (a API respondeu errado, não o pipe esvaziou), e perder mais da metade de uma vez também não.
 */
export function cardsQueSairam(atuais, existentes) {
  const vieram = new Set(atuais.map(String));
  const sairam = existentes.map(String).filter((id) => !vieram.has(id));
  if (!atuais.length) return { sairam: [], recusado: "leitura do Pipefy voltou vazia" };
  if (existentes.length >= 10 && sairam.length > existentes.length / 2)
    return { sairam: [], recusado: `leitura removeria ${sairam.length} de ${existentes.length} cards` };
  return { sairam, recusado: null };
}
