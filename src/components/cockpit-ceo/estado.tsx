import { FlaskConical, Lock, Unplug } from "lucide-react";
import { StatusBadge } from "@/components/planning";
import type { TomStatus } from "@/components/planning";
import { ESTADOS, formatarNumero } from "@/lib/cockpit-ceo/contrato";
import type { Estado, UnidadeContagem } from "@/lib/cockpit-ceo/contrato";
import { COBERTURAS } from "@/lib/cockpit-ceo/perguntas";
import type { Cobertura } from "@/lib/cockpit-ceo/perguntas";

// Selos do cockpit no Design System v2: sempre ícone + palavra (V7), só os cinco tons.
// O estado do DADO segue o KpiCard: parcial em atenção, fonte fora em perigo, o resto neutro.

const TOM_ESTADO: Record<Estado, TomStatus> = {
  disponivel: "sucesso",
  parcial: "atencao",
  nao_apurado: "neutro",
  fonte_indisponivel: "perigo",
  acesso_insuficiente: "neutro",
};

export function EstadoBadge({ estado }: { estado: Estado }) {
  return (
    <StatusBadge
      tom={TOM_ESTADO[estado]}
      icone={
        estado === "acesso_insuficiente"
          ? Lock
          : estado === "fonte_indisponivel"
            ? Unplug
            : undefined
      }
    >
      {ESTADOS[estado]}
    </StatusBadge>
  );
}

const TOM_COBERTURA: Record<Cobertura, TomStatus> = {
  verificada: "sucesso",
  implementada_nao_homologada: "info",
  depende_dado: "neutro",
  depende_decisao: "atencao",
};

export function CoberturaBadge({ cobertura }: { cobertura: Cobertura }) {
  return <StatusBadge tom={TOM_COBERTURA[cobertura]}>{COBERTURAS[cobertura]}</StatusBadge>;
}

export function SinteticoBadge() {
  return (
    <StatusBadge tom="info" icone={FlaskConical}>
      Dados sintéticos
    </StatusBadge>
  );
}

const compacto = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 1,
});

/** No cartão, reais grandes em forma curta; a composição mostra o valor inteiro. */
export function valorCurto(valor: number | null, unidade: UnidadeContagem): string {
  if (valor !== null && unidade === "reais" && Math.abs(valor) >= 100_000)
    return compacto.format(valor).replace(/ /g, " ");
  return formatarNumero(valor, unidade);
}
