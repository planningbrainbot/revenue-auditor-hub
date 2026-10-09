/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive, do banco e do modelo chega sem tipo. */
// Da atividade de Reunião do card do Pipedrive para a linha da fila do bot de reuniões (Brain Meet). Sem API do
// Deno: roda também no Node, nos testes.
import { chaveDaEtapa } from "../_shared/etapas-pipe39.ts";
import type { TipoReuniao } from "./avaliacao.ts";

type Atividade = Record<string, any>;
export type Reuniao = { inicio: string; fim: string; link: string; atividade_id: number };

const TEAMS = /https:\/\/teams\.(?:microsoft|live)\.com\/[^\s"'<>]+/i;
const HORA_DE_TOLERANCIA = 60 * 60 * 1000;

/**
 * Etapa de reunião, lida pelo nome (nunca pelo id): a frente 01 reordena e renomeia o pipe. Aceita o nome antigo e o
 * novo ("4 · Reunião de levantamento agendada" e "4 · Agendado - Levantamento com sócio", 09/10/2026). Levantamento
 * realizado não é etapa de reunião: o bot só entra na agendada e na de proposta.
 */
export function tipoDaEtapa(nome: string | null | undefined): TipoReuniao | null {
  const chave = chaveDaEtapa(nome);
  if (chave === "reuniaoProposta") return "proposta";
  if (chave === "agendada") return "levantamento";
  return null;
}

/** O primeiro link do Teams em algum campo da atividade. */
export function linkDoTeams(a: Atividade): string | null {
  for (const campo of ["conference_meeting_url", "location", "public_description", "note"]) {
    const m = TEAMS.exec(String(a?.[campo] ?? ""));
    if (m) return m[0].replace(/&amp;/g, "&");
  }
  return null;
}

/** Início em UTC: a API v1 do Pipedrive devolve due_date e due_time em UTC. */
export function inicioDaAtividade(a: Atividade): Date | null {
  if (!a?.due_date || !a?.due_time) return null;
  const d = new Date(`${a.due_date}T${String(a.due_time).slice(0, 5)}:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function duracaoMs(a: Atividade): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(a?.duration ?? ""));
  const ms = m ? (Number(m[1]) * 60 + Number(m[2])) * 60_000 : 0;
  return ms > 0 ? ms : 60 * 60_000;
}

/** A próxima reunião válida do card: tipo Reunião, aberta, com hora e link, que não passou há mais de 1 hora. */
export function proximaReuniao(atividades: Atividade[], agora = new Date()): Reuniao | null {
  const validas = atividades
    .filter((a) => a?.type === "meeting" && !a?.done)
    .map((a) => ({ a, inicio: inicioDaAtividade(a), link: linkDoTeams(a) }))
    .filter((x) => x.inicio && x.link && x.inicio.getTime() >= agora.getTime() - HORA_DE_TOLERANCIA)
    .sort((x, y) => x.inicio!.getTime() - y.inicio!.getTime());
  const v = validas[0];
  if (!v) return null;
  return {
    inicio: v.inicio!.toISOString(),
    fim: new Date(v.inicio!.getTime() + duracaoMs(v.a)).toISOString(),
    link: v.link!,
    atividade_id: Number(v.a.id),
  };
}

/** O mesmo formato da SDR IA (pedido-ia-<deal>-<AAAAMMDDTHHMM UTC>), com o prefixo da Monetização. */
export function eventId(deal: number, inicioIso: string): string {
  const d = new Date(inicioIso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `pedido-monet-${deal}-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/** Data da reunião em São Paulo, para a nota: "02/10/2026 14:00". */
export function dataSaoPaulo(iso: string): string {
  const f = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return f.format(new Date(iso)).replace(",", "");
}

/** Motivo legível do bot que não gravou. */
export function motivoSemGravacao(joinerStatus: string | null, transcricao: string | null): string {
  if (joinerStatus === "falhou_lobby") return "o bot ficou no lobby do Teams e ninguém o admitiu";
  if (joinerStatus === "falhou_join") return "o bot não conseguiu entrar na reunião";
  if (joinerStatus === "interrompida") return "a gravação foi interrompida";
  if (joinerStatus === "cancelada") return "a reunião foi cancelada ou remarcada";
  if (transcricao === "sem_fala") return "a gravação não captou conversa";
  if (transcricao === "falhou") return "a transcrição da gravação falhou";
  return "nada foi gravado até 3 horas depois do início";
}
