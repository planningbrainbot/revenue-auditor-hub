import { Database } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * De onde vem o número, de quando é e por qual régua (NAVEGACAO.md N3).
 *
 * Declarar a régua é informação, não alerta: por isso o tom é o do texto
 * secundário, sem cor de status. Sem data, diz que não há data, em vez de
 * sumir: procedência omitida é indistinguível de número inventado.
 */
export function Procedencia({
  fonte,
  atualizadoEm,
  regua,
  compacta,
  className,
}: {
  fonte: string;
  atualizadoEm?: string | Date | null;
  regua?: string;
  /** Linha de uma altura só, cortada com reticências (rodapé de KpiCard). */
  compacta?: boolean;
  className?: string;
}) {
  const quando = formatarQuando(atualizadoEm);
  const partes = [fonte, quando ? `atualizado ${quando}` : "sem data de atualização"];
  if (regua) partes.push(`régua ${regua}`);
  const texto = partes.join(" · ");

  return (
    <p
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground",
        compacta && "whitespace-nowrap",
        className,
      )}
      title={texto}
    >
      <Database className="size-3.5 shrink-0" aria-hidden />
      <span className={cn("min-w-0", compacta && "truncate")}>
        <span className="sr-only">Fonte: </span>
        {texto}
      </span>
    </p>
  );
}

const DIA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * "em 23/09/2026 às 07:40". Data pura ("2026-09-23") é lida como dia local: o
 * `Date` a trataria como meia-noite UTC e mostraria o dia anterior no Brasil.
 * Texto que não é data ("há 2 h") passa como veio.
 */
export function formatarQuando(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  let data: Date;
  let temHora = true;
  if (v instanceof Date) {
    data = v;
  } else {
    const soDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (soDia) {
      data = new Date(Number(soDia[1]), Number(soDia[2]) - 1, Number(soDia[3]));
      temHora = false;
    } else {
      data = new Date(v);
      if (Number.isNaN(data.getTime())) return v;
    }
  }
  if (Number.isNaN(data.getTime())) return null;
  if (temHora && data.getHours() === 0 && data.getMinutes() === 0) temHora = false;
  return `em ${DIA.format(data)}${temHora ? ` às ${HORA.format(data)}` : ""}`;
}
