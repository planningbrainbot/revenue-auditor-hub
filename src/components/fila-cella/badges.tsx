import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ECD_ESTADO_EXPLICACAO,
  ECD_ESTADO_LABEL,
  type Curva,
  type EcdEstado,
  type FilaContaRow,
  type Forca,
  type Frente,
} from "@/lib/fila-cella.types";

// Chips puros — sem dado, sem fetch. Este é o único lugar do módulo onde texto
// de estado é escrito: se um rótulo mudar, muda aqui e em lugar nenhum mais.

const ECD_CLASSE: Record<EcdEstado, string> = {
  ecd_com_sinal:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 hover:bg-emerald-100",
  ecd_sem_sinal:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 hover:bg-amber-100",
  ecd_sem_nome_de_conta:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 hover:bg-amber-100",
  sem_ecd: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:bg-slate-200",
  sem_cnpj: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 hover:bg-red-100",
};

/** Os cinco estados do §6.7. Nunca vazio, nunca "sem ECD" genérico, nunca R$ 0. */
export function EcdChip({ estado }: { estado: EcdEstado }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className={cn("whitespace-nowrap font-normal", ECD_CLASSE[estado])}>
          {ECD_ESTADO_LABEL[estado]}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{ECD_ESTADO_EXPLICACAO[estado]}</p>
        {estado !== "ecd_com_sinal" && (
          <p className="mt-1 text-muted-foreground">
            Teto de score 5 — sem gatilho apurado não há força.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

const FORCA_CLASSE: Record<Forca, string> = {
  Forte: "bg-emerald-600 text-white hover:bg-emerald-600",
  Moderado: "bg-amber-500 text-white hover:bg-amber-500",
  Fraco: "bg-slate-400 text-white hover:bg-slate-400",
};

export function ForcaChip({
  forca,
  temOverride,
  motivo,
}: {
  forca: Forca | null;
  temOverride?: boolean;
  motivo?: string | null;
}) {
  // "sem força" e "força fraca" são coisas diferentes: sem gatilho apurado não
  // existe força nenhuma, e o traço diz isso.
  if (!forca) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className={cn("whitespace-nowrap font-normal", FORCA_CLASSE[forca])}>
          {forca}
          {temOverride ? " †" : ""}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {temOverride ? (
          <p>Força definida à mão: {motivo || "sem motivo registrado"}.</p>
        ) : (
          <p>Força apurada da ECD (regra provisória de casa_ecd.py — ver D1 no Dicionário).</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Duas curvas, sempre — nunca uma escolha silenciosa. A declarada vem de faixa
 * auto-declarada em formulário; a apurada, da receita operacional da ECD contra
 * 80/30MM. Divergem em 4 dos 6 casos com ECD útil.
 */
export function CurvaChips({
  declarada,
  apurada,
  diverge,
}: {
  declarada: Curva | null;
  apurada: Curva | null;
  diverge: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="font-medium">{declarada ?? "—"}</span>
      <span className="text-muted-foreground">│</span>
      {apurada ? (
        <span className="font-medium">{apurada}</span>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground">—</span>
          </TooltipTrigger>
          <TooltipContent>
            Receita não apurada nesta ECD — não é o mesmo que curva C.
          </TooltipContent>
        </Tooltip>
      )}
      {apurada &&
        (diverge ? (
          <span className="text-red-600" title="declarada e apurada divergem">
            ✗
          </span>
        ) : (
          <span className="text-emerald-600" title="declarada e apurada batem">
            ✓
          </span>
        ))}
    </span>
  );
}

const FRENTE_CLASSE: Record<Frente, string> = {
  Contencioso:
    "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200 hover:bg-purple-100",
  Transação: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200 hover:bg-sky-100",
  Tese: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200 hover:bg-indigo-100",
};

export function FrenteChip({ frente }: { frente: Frente | null }) {
  if (!frente) return <span className="text-xs text-muted-foreground">escolher</span>;
  return (
    <Badge className={cn("whitespace-nowrap font-normal", FRENTE_CLASSE[frente])}>{frente}</Badge>
  );
}

export interface Bloqueio {
  rotulo: string;
  motivo: string;
}

/**
 * Coluna 3. Deriva os bloqueios da linha — é aqui que a ressalva que o score
 * ignora (o `LEFT($C2,1)` do Excel) volta a aparecer.
 */
export function bloqueiosDaConta(r: FilaContaRow): Bloqueio[] {
  const b: Bloqueio[] = [];
  if (r.relacionamento === "Alerta aberto") {
    b.push({
      rotulo: "Alerta",
      motivo: "Relacionamento com alerta aberto — veto absoluto, não nota.",
    });
  }
  if (r.elegivel === "Não") {
    b.push({
      rotulo: "Simples",
      motivo: "Simples Nacional na Receita — não elegível. Degrada, não some.",
    });
  }
  if (!r.regime_tributario || r.regime_tributario === "NAO CONFIRMADO") {
    b.push({
      rotulo: "regime?",
      motivo:
        "Regime tributário não confirmado — a curva declarada carrega ressalva que o score ignora.",
    });
  }
  if (r.curva_a_sem_lucro_real) {
    b.push({
      rotulo: "A s/ Lucro Real",
      motivo: "Curva A declarada sem regime de Lucro Real confirmado.",
    });
  }
  if (r.conflito_interno) {
    b.push({
      rotulo: "conflito",
      motivo: "Conflito com a frente de Auditoria Tributária — alinhar antes de abordar.",
    });
  }
  if ((r.avisos ?? []).some((a) => a.toLowerCase().includes("duplicado"))) {
    b.push({ rotulo: "duplicata", motivo: "Registro duplicado no CRM." });
  }
  if (r.reentrada_bloqueada) {
    b.push({
      rotulo: "reentrada",
      motivo: `Reentrada bloqueada até ${r.bloqueado_ate} (${r.recusa_explicita ? "180 dias, recusa explícita" : "60 dias"}).`,
    });
  }
  return b;
}

export function BloqueiosChips({ bloqueios }: { bloqueios: Bloqueio[] }) {
  if (bloqueios.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {bloqueios.map((b) => (
        <Tooltip key={b.rotulo}>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="whitespace-nowrap border-red-300 bg-red-50 font-normal text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {b.rotulo}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{b.motivo}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

/** Contador de cadência. `C1 ██░░ 2/4` — agregado, nunca digitado. */
export function CadenciaChip({
  cicloNum,
  toques,
}: {
  cicloNum: number | null;
  toques: number | null;
}) {
  if (cicloNum == null) return <span className="text-muted-foreground">—</span>;
  const n = toques ?? 0;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-xs">
      <span className="text-muted-foreground">C{cicloNum}</span>
      <span className={cn(n >= 4 && "text-red-600")}>
        {"█".repeat(Math.min(n, 4))}
        {"░".repeat(Math.max(0, 4 - n))}
      </span>
      <span className={cn(n >= 4 && "font-semibold text-red-600")}>{n}/4</span>
    </span>
  );
}
