import type { AuditRegistro, PagamentoMensal } from "@/lib/audit-types";

export type MonthStatus = "pago" | "parcial" | "aberto" | "futuro" | "a_maior";

export interface ScheduleRow {
  month: string; // YYYY-MM
  expected: number;
  received: number;
  diff: number; // received - expected
  status: MonthStatus;
  isFuture: boolean;
}

export interface ScheduleSummary {
  totalContrato: number;
  totalRecebido: number;
  esperadoAteHoje: number;
  saldoEmAberto: number;
  pctRecebido: number; // 0..1 do contrato total
  mesesContrato: number;
  mesesDecorridos: number;
}

function ymKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseYM(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function startDate(r: AuditRegistro): Date | null {
  const raw = r.inicio_contrato ?? r.data_fechamento;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function buildSchedule(r: AuditRegistro): {
  rows: ScheduleRow[];
  summary: ScheduleSummary;
  isRecorrente: boolean;
} {
  const isRecorrente = (r.tipo_contrato ?? "").toLowerCase().startsWith("recorrente");
  const pagos = (r.pagamentos_mensais ?? []) as PagamentoMensal[];
  const recebidoPorMes = new Map<string, number>();
  for (const p of pagos) {
    recebidoPorMes.set(p.month, (recebidoPorMes.get(p.month) ?? 0) + (p.value ?? 0));
  }
  const totalRecebido = pagos.reduce((s, p) => s + (p.value ?? 0), 0);
  const totalContrato = r.valor_contrato ?? 0;
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  if (!isRecorrente) {
    // Avulso: 1 parcela única no mês do fechamento
    const start = startDate(r) ?? currentMonth;
    const expected = totalContrato;
    const received = totalRecebido;
    let status: MonthStatus;
    if (received >= expected && expected > 0) status = "pago";
    else if (received > 0 && received < expected) status = "parcial";
    else if (received === 0) status = start <= currentMonth ? "aberto" : "futuro";
    else status = "a_maior";

    const rows: ScheduleRow[] = [
      {
        month: ymKey(start),
        expected,
        received,
        diff: received - expected,
        status,
        isFuture: start > currentMonth,
      },
      // se houver pagamentos em meses diferentes do esperado, listar também
      ...pagos
        .filter((p) => p.month !== ymKey(start))
        .map<ScheduleRow>((p) => ({
          month: p.month,
          expected: 0,
          received: p.value ?? 0,
          diff: p.value ?? 0,
          status: "a_maior",
          isFuture: false,
        })),
    ].sort((a, b) => a.month.localeCompare(b.month));

    return {
      rows,
      isRecorrente,
      summary: {
        totalContrato,
        totalRecebido,
        esperadoAteHoje: start <= currentMonth ? expected : 0,
        saldoEmAberto: Math.max(0, (start <= currentMonth ? expected : 0) - totalRecebido),
        pctRecebido: totalContrato > 0 ? Math.min(1, totalRecebido / totalContrato) : 0,
        mesesContrato: 1,
        mesesDecorridos: start <= currentMonth ? 1 : 0,
      },
    };
  }

  // Recorrente
  const mrr = r.mrr ?? 0;
  const start = startDate(r);
  const mesesContrato = mrr > 0 && totalContrato > 0 ? Math.max(1, Math.ceil(totalContrato / mrr)) : 0;

  const monthsSet = new Map<string, ScheduleRow>();

  if (start && mesesContrato > 0) {
    for (let i = 0; i < mesesContrato; i++) {
      const d = addMonths(start, i);
      const key = ymKey(d);
      const received = recebidoPorMes.get(key) ?? 0;
      const isFuture = d > currentMonth;
      let status: MonthStatus;
      if (received === 0) status = isFuture ? "futuro" : "aberto";
      else if (received >= mrr) status = received > mrr * 1.01 ? "a_maior" : "pago";
      else status = "parcial";
      monthsSet.set(key, {
        month: key,
        expected: mrr,
        received,
        diff: received - mrr,
        status,
        isFuture,
      });
    }
  }

  // Pagamentos fora da janela do contrato (ex.: antes do início ou depois do fim)
  for (const p of pagos) {
    if (!monthsSet.has(p.month)) {
      monthsSet.set(p.month, {
        month: p.month,
        expected: 0,
        received: p.value ?? 0,
        diff: p.value ?? 0,
        status: "a_maior",
        isFuture: false,
      });
    }
  }

  const rows = Array.from(monthsSet.values()).sort((a, b) => a.month.localeCompare(b.month));

  // meses decorridos dentro do contrato
  let mesesDecorridos = 0;
  if (start) {
    const diff =
      (currentMonth.getFullYear() - start.getFullYear()) * 12 +
      (currentMonth.getMonth() - start.getMonth()) +
      1;
    mesesDecorridos = Math.max(0, Math.min(mesesContrato, diff));
  }
  const esperadoAteHoje = Math.min(totalContrato, mesesDecorridos * mrr);
  const saldoEmAberto = Math.max(0, esperadoAteHoje - totalRecebido);

  return {
    rows,
    isRecorrente,
    summary: {
      totalContrato,
      totalRecebido,
      esperadoAteHoje,
      saldoEmAberto,
      pctRecebido: totalContrato > 0 ? Math.min(1, totalRecebido / totalContrato) : 0,
      mesesContrato,
      mesesDecorridos,
    },
  };
}

export function statusLabel(s: MonthStatus): { label: string; cls: string; dot: string } {
  switch (s) {
    case "pago":
      return { label: "Pago", cls: "text-success bg-success-soft", dot: "bg-success" };
    case "parcial":
      return { label: "Parcial", cls: "text-warning bg-warning-soft", dot: "bg-warning" };
    case "aberto":
      return { label: "Em aberto", cls: "text-danger bg-danger-soft", dot: "bg-danger" };
    case "futuro":
      return { label: "Futuro", cls: "text-foreground bg-muted", dot: "bg-muted-foreground" };
    case "a_maior":
      return { label: "A maior", cls: "text-info bg-info-soft", dot: "bg-info" };
  }
}

export function formatMonthLabel(ym: string): string {
  const d = parseYM(ym);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
}
