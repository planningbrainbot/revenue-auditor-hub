import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { EstadoVazio, PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/fila-cella")({
  component: FilaCellaAposentada,
});

// Rota aposentada em 24/09/2026 (DECISIONS): a fila nunca foi sincronizada em
// produção e o trabalho por negócio mora no Follow Day. A rota explica em vez
// de sumir (NAVEGACAO.md N14). Tabelas e chaves `*.fila_cella` ficam no banco.
function FilaCellaAposentada() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader area="monetizacao" titulo="Fila Cella" />
      <EstadoVazio
        titulo="A Fila Cella foi aposentada"
        descricao="Desde 24/09/2026 os negócios abertos que pedem ação ficam no Follow Day, e o ritmo do mês na Operação diária."
        acao={
          <Button asChild>
            <Link to="/monetizacao" search={{ aba: "follow-day" }}>
              Abrir o Follow Day
            </Link>
          </Button>
        }
      />
    </div>
  );
}
