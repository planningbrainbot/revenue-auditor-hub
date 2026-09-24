import type { ReactNode } from "react";
import { usePermissions } from "@/hooks/use-permissions";
import { Carregando, EstadoSemAcesso } from "@/components/planning";

/**
 * Porteiro das telas de Receitas Partners.
 *
 * Enquanto eram abas de uma página só, quem não tinha a chave simplesmente não
 * via a aba. Agora cada uma tem URL própria e pode ser digitada à mão, então a
 * tela precisa dizer o que falta em vez de abrir em branco — mesmo padrão de
 * /fila-cella. Estados do DS: esqueleto enquanto as permissões chegam e
 * `EstadoSemAcesso` com a chave que falta (N8).
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
    return <Carregando variante="tabela" className="px-4 py-6 md:px-6" />;
  }
  if (!can(permissao)) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EstadoSemAcesso oQueFalta={`${permissao} (para abrir ${nome})`} />
      </div>
    );
  }
  return <>{children}</>;
}
