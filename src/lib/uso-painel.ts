// Contas da tela /uso-brain (contrato docs/design/contratos/uso-brain.md), sobre o JSON de
// ops.uso_brain_painel. Puro, para o teste rodar no node. Semana de USO é segunda a domingo em
// São Paulo, igual ao Growth; a média de 4 semanas divide por 4 fixo (semana sem uso conta zero).

export type Membro = {
  user_id: string;
  email: string;
  nome: string | null;
  ativo: boolean;
  concedido_em: string | null;
  papeis: string | null;
  ultimo_login: string | null;
};
export type Dia = {
  user_id: string;
  dia: string;
  minutos: number;
  sessoes: number;
  primeiro: string;
  ultimo: string;
};
export type Sessao = {
  user_id: string;
  inicio: string;
  fim: string;
  minutos: number;
  rotas: string[];
};
export type RotaSemana = { user_id: string; semana: string; rota: string; minutos: number };
export type Calor = { user_id: string; dow: number; hora: number; minutos: number };
export type Historico = { user_id: string; primeiro_dia: string; ultimo_uso: string };
export type Painel = {
  membros: Membro[];
  dia: Dia[];
  sessoes: Sessao[];
  rota_semana: RotaSemana[];
  calor: Calor[];
  historico: Historico[];
};

// ops.uso_brain_agora: quem teve minuto ativo nos últimos 2 minutos.
export type Online = {
  user_id: string;
  email: string;
  nome: string | null;
  papeis: string | null;
  rota: string;
  ultimo: string;
  desde: string;
};

export type LinhaPessoa = {
  membro: Membro;
  minutosSemana: number;
  mediaMin4Sem: number;
  ultimoUso: string | null;
};

export type Resumo = {
  comAcesso: number;
  ativos: number;
  minutosSemana: number;
  mediaMin4Sem: number;
  ranking: LinhaPessoa[];
  semUso: LinhaPessoa[];
  telas: { rota: string; minutos: number }[];
  calor: number[][]; // [dow 0=seg][hora]
};

export const INTERVALO_SESSAO_MIN = 15;

export function somarDias(diaIso: string, n: number): string {
  const d = new Date(`${diaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function segundaDaSemana(diaIso: string): string {
  const dow = new Date(`${diaIso}T00:00:00Z`).getUTCDay(); // dom=0 … sáb=6
  return somarDias(diaIso, -((dow + 6) % 7));
}

export function hojeSP(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(agora);
}

export function ehAdmin(m: Membro): boolean {
  return (m.papeis ?? "").split(",").includes("admin");
}

export function formatarHoras(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * Resume o painel para a semana que começa em `semana` (segunda-feira).
 * `comAdmins = false` tira do número quem tem o papel admin (R-06 do PRD).
 */
export function resumir(p: Painel, semana: string, comAdmins: boolean, pessoa?: string): Resumo {
  const fimSemana = somarDias(semana, 6);
  const inicio4 = somarDias(semana, -28);
  const membros = p.membros.filter(
    (m) =>
      m.ativo &&
      (comAdmins || !ehAdmin(m)) &&
      (!m.concedido_em || m.concedido_em.slice(0, 10) <= fimSemana),
  );
  const conta = new Set(membros.map((m) => m.user_id));

  const naSemana = new Map<string, number>();
  const nas4 = new Map<string, number>();
  for (const d of p.dia) {
    if (!conta.has(d.user_id)) continue;
    if (d.dia >= semana && d.dia <= fimSemana)
      naSemana.set(d.user_id, (naSemana.get(d.user_id) ?? 0) + d.minutos);
    else if (d.dia >= inicio4 && d.dia < semana)
      nas4.set(d.user_id, (nas4.get(d.user_id) ?? 0) + d.minutos);
  }
  const ultimo = new Map(p.historico.map((h) => [h.user_id, h.ultimo_uso]));
  const linhas: LinhaPessoa[] = membros.map((m) => ({
    membro: m,
    minutosSemana: naSemana.get(m.user_id) ?? 0,
    mediaMin4Sem: (nas4.get(m.user_id) ?? 0) / 4,
    ultimoUso: ultimo.get(m.user_id) ?? null,
  }));
  const nome = (l: LinhaPessoa) => l.membro.nome ?? l.membro.email;
  const ranking = linhas
    .filter((l) => l.minutosSemana > 0)
    .sort((a, b) => b.minutosSemana - a.minutosSemana || nome(a).localeCompare(nome(b)));
  const semUso = linhas
    .filter((l) => l.minutosSemana === 0)
    .sort((a, b) => (b.membro.ultimo_login ?? "").localeCompare(a.membro.ultimo_login ?? ""));

  const porRota = new Map<string, number>();
  for (const r of p.rota_semana) {
    if (r.semana !== semana || !conta.has(r.user_id) || (pessoa && r.user_id !== pessoa)) continue;
    porRota.set(r.rota, (porRota.get(r.rota) ?? 0) + r.minutos);
  }
  const telas = [...porRota]
    .map(([rota, minutos]) => ({ rota, minutos }))
    .sort((a, b) => b.minutos - a.minutos || a.rota.localeCompare(b.rota))
    .slice(0, 10);

  const calor = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const c of p.calor) {
    if (!conta.has(c.user_id) || (pessoa && c.user_id !== pessoa)) continue;
    calor[c.dow][c.hora] += c.minutos;
  }

  const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    comAcesso: membros.length,
    ativos: ranking.length,
    minutosSemana: soma(linhas.map((l) => l.minutosSemana)),
    mediaMin4Sem: soma(linhas.map((l) => l.mediaMin4Sem)),
    ranking,
    semUso,
    telas,
    calor,
  };
}
