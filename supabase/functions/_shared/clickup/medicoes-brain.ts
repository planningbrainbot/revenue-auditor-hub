// Medição automática das KRs que o Brain já acompanha. Portado do Growth
// (`brain-web/src/lib/okrs/brain.ts`, parte pura): o ponteiro vem do dado do Growth, na mesma régua
// das telas Executivo e Tráfego. O vínculo é por id de tarefa do ClickUp; o ALVO sai do nome da
// tarefa quando dá para ler (renomear a KR atualiza a meta), e os números abaixo são só reserva.
//
// A foto diária de OKR (growth.okr_snapshot) precisa desta régua: sem ela, as seis KRs medidas pelo
// Brain cairiam para o ponteiro manual e a série mudaria de régua no meio.
import type { MedicaoBrain } from "./tipos.ts";

export interface DadosBrain {
  campanhas: { investimento: number | null; mql: number | null }[];
  trafegoDia: { investimento: number | null; score_rm: number | null }[];
  metricasPessoa: {
    papel: string | null;
    mql: number | null;
    rm: number | null;
    rr: number | null;
    vendas: number | null;
  }[];
  ticketReal: number | null;
}

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
    .format(n)
    .replace(/ /g, " ");
const pct = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;

const razaoMenor = (atual: number, alvo: number) => (atual <= alvo ? 1 : alvo / atual);
const razaoMaior = (atual: number, alvo: number) => Math.min(atual / alvo, 1);

export function alvoBrlDoNome(nome: string | undefined, padrao: number): number {
  const m = nome?.match(/R\$\s*([\d.]+(?:,\d+)?)/);
  if (!m) return padrao;
  const n = Number(m[1].replaceAll(".", "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

export function alvosPctDoNome(nome: string | undefined, padroes: number[]): number[] {
  const achados = [...(nome ?? "").matchAll(/(\d+(?:,\d+)?)\s*%/g)].map(
    (x) => Number(x[1].replace(",", ".")) / 100,
  );
  return padroes.map((p, i) => (achados[i] != null && achados[i] > 0 && achados[i] <= 1 ? achados[i] : p));
}

export const KRS_MEDIDAS_PELO_BRAIN = [
  "86e2gnh64", // CPMQL
  "86e2gnh67", // CPRMScore
  "86e2gnh69", // MQL→RM e RM→RR
  "86e2gnh6d", // no-show
  "86e2gnh6p", // RR→venda
  "86e2gnh6u", // ticket médio
] as const;

export function calcularMedicoesBrain(
  d: DadosBrain,
  nomes: Map<string, string> = new Map(),
): Map<string, MedicaoBrain> {
  const m = new Map<string, MedicaoBrain>();
  const soma = (papel: "sdr" | "closer", col: "mql" | "rm" | "rr" | "vendas") =>
    d.metricasPessoa.filter((l) => l.papel === papel).reduce((s, l) => s + Number(l[col] ?? 0), 0);
  // Régua da home: cada etapa vem do papel dono dela.
  const mql = soma("sdr", "mql");
  const rm = soma("sdr", "rm");
  const rr = soma("closer", "rr");
  const vendas = soma("closer", "vendas");

  {
    const inv = d.campanhas.reduce((s, c) => s + Number(c.investimento ?? 0), 0);
    const mqlPago = d.campanhas.reduce((s, c) => s + Number(c.mql ?? 0), 0);
    if (mqlPago > 0) {
      const alvo = alvoBrlDoNome(nomes.get("86e2gnh64"), 300);
      const cpmql = inv / mqlPago;
      m.set("86e2gnh64", {
        progresso: razaoMenor(cpmql, alvo),
        resumo: `${brl(cpmql)} / ${brl(alvo)}`,
        detalhe: `${brl(inv)} investidos · ${mqlPago} MQLs no mês`,
      });
    }
  }
  {
    const inv = d.trafegoDia.reduce((s, r) => s + Number(r.investimento ?? 0), 0);
    const score = d.trafegoDia.reduce((s, r) => s + Number(r.score_rm ?? 0), 0);
    if (score > 0) {
      const alvo = alvoBrlDoNome(nomes.get("86e2gnh67"), 400);
      const cprm = inv / score;
      m.set("86e2gnh67", {
        progresso: razaoMenor(cprm, alvo),
        resumo: `${brl(cprm)} / ${brl(alvo)}`,
        detalhe: `${brl(inv)} ÷ score RM ${score.toFixed(1)}`,
      });
    }
  }
  if (mql > 0 && rm > 0) {
    const [alvoMqlRm, alvoRmRr] = alvosPctDoNome(nomes.get("86e2gnh69"), [0.3, 0.85]);
    const mqlRm = rm / mql;
    const rmRr = rr / rm;
    m.set("86e2gnh69", {
      progresso: (razaoMaior(mqlRm, alvoMqlRm) + razaoMaior(rmRr, alvoRmRr)) / 2,
      resumo: `${pct(mqlRm)} · ${pct(rmRr)}`,
      detalhe: `MQL→RM ${pct(mqlRm)} (meta ${pct(alvoMqlRm)}) · RM→RR ${pct(rmRr)} (meta ${pct(alvoRmRr)})`,
    });
  }
  if (rm > 0) {
    const [alvo] = alvosPctDoNome(nomes.get("86e2gnh6d"), [0.15]);
    const noshow = Math.max(1 - rr / rm, 0);
    m.set("86e2gnh6d", {
      progresso: razaoMenor(noshow, alvo),
      resumo: `${pct(noshow)} / ${pct(alvo)}`,
      detalhe: `${rr} RRs de ${rm} RMs no mês`,
    });
  }
  if (rr > 0) {
    const [alvo] = alvosPctDoNome(nomes.get("86e2gnh6p"), [0.2]);
    const conv = vendas / rr;
    m.set("86e2gnh6p", {
      progresso: razaoMaior(conv, alvo),
      resumo: `${pct(conv)} / ${pct(alvo)}`,
      detalhe: `${vendas} vendas de ${rr} RRs no mês`,
    });
  }
  if (d.ticketReal != null && d.ticketReal > 0) {
    const alvo = alvoBrlDoNome(nomes.get("86e2gnh6u"), 7000);
    m.set("86e2gnh6u", {
      progresso: razaoMaior(d.ticketReal, alvo),
      resumo: `${brl(d.ticketReal)} / ${brl(alvo)}`,
      detalhe: "ticket real do mês (painel executivo)",
    });
  }
  return m;
}
