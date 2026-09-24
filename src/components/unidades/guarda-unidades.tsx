import type { ReactNode } from "react";
import { usePermissions } from "@/hooks/use-permissions";

/**
 * Porteiro das telas de Receitas Partners.
 *
 * Enquanto eram abas de uma página só, quem não tinha a chave simplesmente não
 * via a aba. Agora cada uma tem URL própria e pode ser digitada à mão, então a
 * tela precisa dizer o que falta em vez de abrir em branco — mesmo padrão que
 * a Fila Cella usava (aposentada em 24/09).
 */
export function GuardaUnidades({
  permissao,
  nome,
  children,
}: {
  permissao: string;
  nome: string;
  children: ReactNode;
}) {
  const { can, loading } = usePermissions();

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!can(permissao)) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Peça a um admin a permissão <code>{permissao}</code> para acessar {nome}.
      </div>
    );
  }
  return <>{children}</>;
}
