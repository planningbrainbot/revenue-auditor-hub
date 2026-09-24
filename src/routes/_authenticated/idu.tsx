import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { IduView } from "@/components/idu/idu-view";

type BuscaIdu = { trimestre?: string; unidade?: string };

// Trimestre e unidade aberta moram na URL (N7): recarregar ou colar o link
// reproduz a tela. Só entram as chaves com valor, para o link limpo continuar
// sendo o da tela no padrão (último trimestre fechado, nenhuma linha aberta).
function validarBusca(s: Record<string, unknown>): BuscaIdu {
  const texto = (v: unknown, max: number) =>
    typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
  const trimestre = texto(s.trimestre, 7);
  const busca: BuscaIdu = {
    trimestre: trimestre && /^\d{4}-T[1-4]$/.test(trimestre) ? trimestre : undefined,
    unidade: texto(s.unidade, 120),
  };
  return Object.fromEntries(Object.entries(busca).filter(([, v]) => v)) as BuscaIdu;
}

export const Route = createFileRoute("/_authenticated/idu")({
  head: () => ({ meta: [{ title: "IDU – Planning" }] }),
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBusca(s),
  component: IduPage,
});

// O PageHeader mora na view: o universo (`descricao`) diz quantas unidades e
// qual trimestre, e o seletor de trimestre fica no cabeçalho em todos os
// estados (carregando, erro, vazio).
function IduPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <IduView />
    </div>
  );
}
