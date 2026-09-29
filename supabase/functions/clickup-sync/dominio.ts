// clickup-sync · a parte pura da rodada: o que gravar no espelho, que eventos registrar e a foto
// diária de OKR. Testada em tests/cockpit-coo-sync.test.mjs; o index.ts só faz I/O.
import { diferencas, linhaDoEspelho, podeMarcarSumidas } from "../_shared/clickup/compromissos.ts";
import type { Evento, LinhaEspelho } from "../_shared/clickup/compromissos.ts";
import { listarKrs } from "../_shared/clickup/dashboard.ts";
import { normalizarOkrs, tarefasPorLista } from "../_shared/clickup/normalizar.ts";
import type { PastaBruta, TarefaBruta } from "../_shared/clickup/normalizar.ts";
import { calcularMedicoesBrain } from "../_shared/clickup/medicoes-brain.ts";
import type { DadosBrain } from "../_shared/clickup/medicoes-brain.ts";

/**
 * Pastas do space que não são departamento do quadro de OKRs: a Rotina Semanal (compromissos do
 * COO) e a manutenção do Brain. Entrar na foto faria as tarefas delas contarem como KR.
 */
export const PASTAS_FORA_DOS_OKRS = /rotina semanal|manuten/i;

export interface LinhaSnapshotOkr {
  dia: string;
  kr_id: string;
  departamento: string;
  objetivo: string;
  kr_nome: string;
  progresso: number | null;
  origem: string | null;
  atual: number | null;
  alvo: number | null;
}

export interface PlanoRodada {
  linhas: LinhaEspelho[];
  eventos: Evento[];
  /** Ids que estavam no espelho e não vieram nesta leitura. */
  sumidas: string[];
  sumidasRecusadas: boolean;
  snapshot: LinhaSnapshotOkr[];
}

export function planejarRodada(
  anteriores: LinhaEspelho[],
  tarefas: TarefaBruta[],
  pastas: PastaBruta[],
  dadosBrain: DadosBrain | null,
  diaSaoPaulo: string,
): PlanoRodada {
  const pastaDaLista: Record<string, { id: string; nome: string }> = {};
  for (const p of pastas) for (const l of p.lists) pastaDaLista[l.id] = { id: p.id, nome: p.name };

  // Uma tarefa aparece uma vez só, mesmo que a API repita entre páginas.
  const unicas = [...new Map(tarefas.map((t) => [t.id, t])).values()];
  const linhas = unicas.map((t) => linhaDoEspelho(t, pastaDaLista));

  // Primeira rodada (espelho vazio): é a linha de base, não uma avalanche de "criada".
  const idsAtuais = new Set(linhas.map((l) => l.id));
  const sumidasTodas = anteriores.filter((a) => !idsAtuais.has(a.id)).map((a) => a.id);
  const pode = podeMarcarSumidas(anteriores.length, linhas.length);
  const eventos = anteriores.length === 0
    ? []
    : diferencas(anteriores, linhas).filter((e) => e.tipo !== "sumiu" || pode);

  const pastasOkr = pastas.filter((p) => !PASTAS_FORA_DOS_OKRS.test(p.name));
  const departamentos = normalizarOkrs(pastasOkr, tarefasPorLista(unicas));
  if (dadosBrain) {
    const nomes = new Map<string, string>();
    for (const d of departamentos) for (const o of d.objetivos) for (const k of o.krs) nomes.set(k.id, k.nome);
    const medicoes = calcularMedicoesBrain(dadosBrain, nomes);
    for (const d of departamentos)
      for (const o of d.objetivos)
        for (const k of o.krs) {
          const m = medicoes.get(k.id);
          if (m) k.brain = m;
        }
  }
  const snapshot = listarKrs(departamentos).map((k) => ({
    dia: diaSaoPaulo,
    kr_id: k.kr.id,
    departamento: k.departamento,
    objetivo: k.objetivo,
    kr_nome: k.kr.nome,
    progresso: k.medicao?.progresso ?? null,
    origem: k.medicao?.origem ?? null,
    atual: k.kr.atual,
    alvo: k.kr.alvo,
  }));

  return {
    linhas,
    eventos,
    sumidas: pode ? sumidasTodas : [],
    sumidasRecusadas: !pode && sumidasTodas.length > 0,
    snapshot,
  };
}

/** Dia no fuso de São Paulo (YYYY-MM-DD). */
export function diaSaoPaulo(agora: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(agora);
}
