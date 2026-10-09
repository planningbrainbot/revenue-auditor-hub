import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { EstadoVazio, PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/fila-cella")({
  component: FilaCellaAposentada,
});

// Rota aposentada em 24/09/2026 (DECISIONS): a fila nunca foi sincronizada em
// produção. O trabalho por negócio foi para o Follow Day, que saiu do menu em
// 09/10/2026; hoje o destino é a Operação diária (lista de atenção e cadência no
// Pipedrive). A rota explica em vez de sumir (NAVEGACAO.md N14). Tabelas e
// chaves `*.fila_cella` ficam no banco.
function FilaCellaAposentada() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader area="monetizacao" titulo="Fila Cella" />
      <EstadoVazio
        titulo="A Fila Cella foi aposentada"
        descricao="A Fila Cella saiu em 24/09/2026. Hoje o trabalho da pré-venda fica na Operação diária: o ritmo do mês e a lista de abordados que pedem atenção."
        acao={
          <Button asChild>
            <Link to="/monetizacao" search={{ aba: "operacao" }}>
              Abrir a Operação diária
            </Link>
          </Button>
        }
      />
    </div>
  );
}
