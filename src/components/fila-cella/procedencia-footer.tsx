import { Card } from "@/components/ui/card";
import type { EstadoFonte } from "@/lib/fila-cella.types";

/**
 * Bloco H do §6.2 — o rodapé de procedência.
 *
 * Renderiza MESMO nos estados degradados: é justamente onde o motivo da
 * degradação aparece. Regra inviolável de spec-dash-funil-cella.md:49 — "erro de
 * fonte aparece na tela, não silencia".
 *
 * Não usa `<AppShell>`/`DataFreshnessBar`: aquela barra só conhece Omie,
 * Pipedrive e Tratativas (data-freshness-bar.tsx:11-15), nenhuma das quais é
 * fonte desta tela.
 */
export function ProcedenciaFooter({
  estado,
  sincronizadoEm,
  aviso,
}: {
  estado: EstadoFonte;
  sincronizadoEm: string | null;
  aviso: string | null;
}) {
  const sync = sincronizadoEm
    ? new Date(sincronizadoEm).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "nunca";

  return (
    <Card className="space-y-1 px-4 py-3 text-xs text-muted-foreground">
      <p>
        Fontes: Growth <code>deals</code> (won, DISTINCT <code>org_id</code>) · ECD do exercício 2024
        · base Receita 967 · Ops (<code>empresas</code>, <code>contratos</code>,{" "}
        <code>omie_clientes</code>).
      </p>
      <p>
        Sincronizado em <strong>{sync}</strong> · a ECD não tem controle de retificadora: uma
        escrituração substituta não é distinguível da original nesta base.
      </p>
      {estado !== "ok" && aviso && <p className="text-amber-700 dark:text-amber-400">{aviso}</p>}
    </Card>
  );
}
