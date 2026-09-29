// Evolução dos OKRs por tema, a partir da foto diária `growth.okr_snapshot`.
//
// Pedido do COO em 29/09/2026: "Lembra de trazer em TODAS as análises por área a evolução das
// OKRs." Cada tema acompanha os departamentos do seu mapa (contrato.ts) e mostra, por departamento,
// o progresso médio das KRs medidas dia a dia contra o esperado linear do ciclo (01/08 a 31/12).
//
// A régua é a da tela de OKRs (dashboard.ts, portado do Growth): média simples das KRs medidas.
// A foto parou em 02/09/2026 (o cron do Growth toma um redirect e conta como sucesso). Enquanto a
// sincronização do ClickUp no Ops não voltar a gravar, o bloco diz desde quando está parado.
import { corProgresso, fracaoEsperada } from "../../../supabase/functions/_shared/clickup/dashboard.ts";
import type { FaixaCor } from "../../../supabase/functions/_shared/clickup/dashboard.ts";
import { TEMAS, departamentoBase, temasDoDepartamento } from "./contrato.ts";
import type { Estado, Tema } from "./contrato.ts";

export interface LinhaSnapshot {
  dia: string;
  kr_id: string;
  departamento: string;
  objetivo: string | null;
  kr_nome: string | null;
  progresso: number | string | null;
  origem: string | null;
}

export interface PontoSerie {
  dia: string;
  progresso: number | null;
  esperado: number;
}

export interface OkrDepartamento {
  nome: string;
  base: string;
  progresso: number | null;
  esperado: number;
  /** progresso ÷ esperado; 1 = no ritmo do calendário. */
  razao: number | null;
  faixa: FaixaCor | null;
  serie: PontoSerie[];
  krs: { total: number; medidas: number; noRitmo: number; atras: number; semMedicao: number };
  piorKr: { nome: string; progresso: number } | null;
}

export interface OkrsTema {
  tema: Tema;
  estado: Estado;
  motivo?: string;
  ultimoDia: string | null;
  /** Dias entre a última foto e hoje. */
  diasSemFoto: number | null;
  parado: boolean;
  departamentos: OkrDepartamento[];
  /** Departamentos do mapa do tema que não aparecem na foto (pasta sem KR ou renomeada). */
  semFoto: string[];
}

/** Foto com mais de 2 dias é foto parada: a coleta é diária. */
export const DIAS_FOTO_PARADA = 2;

const num = (v: number | string | null): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

export function montarOkrsTema(tema: Tema, linhas: LinhaSnapshot[], hojeIso: string): OkrsTema {
  const doTema = linhas.filter((l) => temasDoDepartamento(l.departamento).includes(tema));
  const mapa = TEMAS[tema].departamentos;
  if (!linhas.length)
    return {
      tema,
      estado: "fonte_indisponivel",
      motivo: "a foto diária de OKRs (growth.okr_snapshot) não trouxe nenhuma linha",
      ultimoDia: null,
      diasSemFoto: null,
      parado: true,
      departamentos: [],
      semFoto: mapa,
    };
  const ultimoDia = linhas.reduce((m, l) => (l.dia > m ? l.dia : m), linhas[0].dia);
  const diasSemFoto = diasEntre(ultimoDia, hojeIso);
  const parado = diasSemFoto > DIAS_FOTO_PARADA;

  const porDepto = new Map<string, LinhaSnapshot[]>();
  for (const l of doTema) {
    const lista = porDepto.get(l.departamento) ?? [];
    lista.push(l);
    porDepto.set(l.departamento, lista);
  }

  const departamentos: OkrDepartamento[] = [...porDepto.entries()].map(([nome, ls]) => {
    const dias = [...new Set(ls.map((l) => l.dia))].sort();
    const serie: PontoSerie[] = dias.map((dia) => ({
      dia,
      progresso: media(
        ls.filter((l) => l.dia === dia).map((l) => num(l.progresso)).filter((p): p is number => p != null),
      ),
      esperado: fracaoEsperada(dia),
    }));
    const ultimo = dias[dias.length - 1];
    const doUltimo = ls.filter((l) => l.dia === ultimo);
    const esperado = fracaoEsperada(ultimo);
    const medidas = doUltimo
      .map((l) => ({ nome: l.kr_nome ?? l.kr_id, p: num(l.progresso) }))
      .filter((x): x is { nome: string; p: number } => x.p != null);
    const progresso = media(medidas.map((m) => m.p));
    const pior = medidas.reduce<{ nome: string; p: number } | null>(
      (min, m) => (min == null || m.p < min.p ? m : min),
      null,
    );
    return {
      nome,
      base: departamentoBase(nome),
      progresso,
      esperado,
      razao: progresso == null || esperado <= 0 ? null : progresso / esperado,
      faixa: progresso == null ? null : corProgresso(progresso / (esperado || 1)),
      serie,
      krs: {
        total: doUltimo.length,
        medidas: medidas.length,
        noRitmo: medidas.filter((m) => m.p >= esperado).length,
        atras: medidas.filter((m) => m.p < esperado).length,
        semMedicao: doUltimo.length - medidas.length,
      },
      piorKr: pior ? { nome: pior.nome, progresso: pior.p } : null,
    };
  });
  // Ordem do mapa do tema (a pauta segue a mesma ordem toda semana).
  departamentos.sort(
    (a, b) =>
      mapa.findIndex((d) => d === a.base) - mapa.findIndex((d) => d === b.base) ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
  const presentes = new Set(departamentos.map((d) => d.base));
  const semFoto = mapa.filter((d) => !presentes.has(d));

  return {
    tema,
    estado: parado ? "parcial" : "disponivel",
    motivo: parado ? `a foto diária de OKRs parou em ${ultimoDia.split("-").reverse().join("/")}` : undefined,
    ultimoDia,
    diasSemFoto,
    parado,
    departamentos,
    semFoto,
  };
}
