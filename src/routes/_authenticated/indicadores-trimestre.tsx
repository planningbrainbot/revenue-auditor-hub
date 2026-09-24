import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { IndicadoresTrimestreView } from "@/components/indicadores-trimestre/indicadores-trimestre-view";

type BuscaIndicadores = { trimestre?: string; unidade?: string; comparativo?: string };

// Trimestre, unidade e comparativo moram na URL (N7): recarregar ou colar o
// link reproduz a tela. Só entram as chaves com valor, para o link limpo
// continuar sendo o da tela no padrão (trimestre anterior, unidade do usuário,
// comparativo fechado).
function validarBusca(s: Record<string, unknown>): BuscaIndicadores {
  const texto = (v: unknown, max: number) =>
    typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
  const trimestre = texto(s.trimestre, 7);
  const comparativo = texto(s.comparativo, 7);
  const busca: BuscaIndicadores = {
    trimestre: trimestre && /^\d{4}-T[1-4]$/.test(trimestre) ? trimestre : undefined,
    unidade: texto(s.unidade, 120),
    comparativo: comparativo === "aberto" ? comparativo : undefined,
  };
  return Object.fromEntries(Object.entries(busca).filter(([, v]) => v)) as BuscaIndicadores;
}

export const Route = createFileRoute("/_authenticated/indicadores-trimestre")({
  head: () => ({ meta: [{ title: "Indicadores do Trimestre – Planning" }] }),
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBusca(s),
  component: IndicadoresTrimestrePage,
});

// O PageHeader mora na view: pergunta fixa, mas o universo (`descricao`) diz a
// unidade e o trimestre escolhidos, e o seletor de trimestre fica no cabeçalho
// em todos os estados (carregando, erro, vazio).
function IndicadoresTrimestrePage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <IndicadoresTrimestreView />
    </div>
  );
}
