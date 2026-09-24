import { createFileRoute } from "@tanstack/react-router";
import { NpsPainelTab } from "@/components/nps/nps-painel-tab";

const ABAS = ["resumo", "unidades", "respostas"] as const;
type Aba = (typeof ABAS)[number];
const CATEGORIAS = ["promotor", "neutro", "detrator"] as const;
type CategoriaFiltro = (typeof CATEGORIAS)[number];

// Aba e filtros moram na URL (N7): recarregar ou colar o link reproduz a
// tela. Todas as chaves são opcionais, para os links que já apontam para /nps
// sem search continuarem valendo. O TanStack desserializa JSON do search
// ("?q=123" chega como número), então os filtros de texto são coagidos a
// string em vez de descartados.
function texto(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return typeof v === "string" ? v : String(v);
}

export const Route = createFileRoute("/_authenticated/nps")({
  validateSearch: (s: Record<string, unknown>) => ({
    aba: ABAS.includes(s.aba as Aba) ? (s.aba as Aba) : undefined,
    q: texto(s.q),
    unidade: texto(s.unidade),
    segmento: texto(s.segmento),
    categoria: CATEGORIAS.includes(s.categoria as CategoriaFiltro)
      ? (s.categoria as CategoriaFiltro)
      : undefined,
    fase: texto(s.fase),
    rodada: texto(s.rodada),
  }),
  component: NpsPage,
});

// O PageHeader mora no NpsPainelTab: o universo (unidade, rodada), a data de
// atualização e as opções dos filtros saem das próprias pesquisas carregadas.
function NpsPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <NpsPainelTab />
    </div>
  );
}
