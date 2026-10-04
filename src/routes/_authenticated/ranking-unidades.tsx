import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import {
  BarraFiltros,
  Carregando,
  EstadoErro,
  PageHeader,
  Procedencia,
  StatusBadge,
} from "@/components/planning";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Ranking entre as unidades regionais, por trimestre. Pedido do Eliezek em
// 02/10/2026. Os números vêm de ops.ranking_unidades (migration
// 20261002170000), que devolve só o agregado por unidade e diz a situação de
// cada linha. Unidade sem dado ou com amostra pequena não ganha posição: fica
// numa faixa à parte, para que não lançar churn ou NPS não pareça último lugar
// (nem primeiro). Todos os sócios veem todas as unidades, com números, como no
// IDU (decisão de 28/08/2026); royalties e taxas não entram.
export const Route = createFileRoute("/_authenticated/ranking-unidades")({
  head: () => ({ meta: [{ title: "Ranking da Rede – Planning" }] }),
  component: RankingPage,
});

type Linha = {
  ranking: string;
  unidade_id: number;
  unidade: string;
  valor: number | null;
  valor_secundario: number | null;
  amostra: number;
  situacao: "ok" | "amostra_insuficiente" | "sem_dado";
  posicao: number | null;
};

const fmtBRL = (v: number | null) =>
  v == null
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtPct = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const fmtNum = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const plural = (n: number, um: string, varios: string) => `${fmtNum(n)} ${n === 1 ? um : varios}`;

type Definicao = {
  chave: string;
  titulo: string;
  pergunta: string;
  regua: string;
  valor: (l: Linha) => string;
  detalhe: (l: Linha) => string;
  /** Por que a linha não tem posição. */
  semPosicao: (l: Linha) => string;
};

const RANKINGS: Definicao[] = [
  {
    chave: "mrr_carteira",
    titulo: "Maior carteira",
    pergunta: "Quem tem a maior receita recorrente na carteira?",
    regua:
      "MRR de hoje de cada cliente: Omie, senão Pipefy, senão Pipedrive. Um CNPJ conta uma vez. Retrato de hoje, não muda com o trimestre.",
    valor: (l) => fmtBRL(l.valor),
    detalhe: (l) => plural(l.valor_secundario ?? 0, "cliente com MRR", "clientes com MRR"),
    semPosicao: () => "Nenhum cliente com MRR",
  },
  {
    chave: "hunter_socio",
    titulo: "Hunter Sócio",
    pergunta: "Qual sócio mais vendeu com as próprias mãos?",
    regua:
      "Clientes ganhos no pipe Negociação - Sócios. Deals lançados em lote em agosto/2026 contam na data do lançamento.",
    valor: (l) => plural(l.valor ?? 0, "cliente", "clientes"),
    detalhe: (l) => `${fmtBRL(l.valor_secundario)} de MRR`,
    semPosicao: () => "",
  },
  {
    chave: "idu",
    titulo: "IDU",
    pergunta: "Qual unidade tem o melhor Índice de Desempenho?",
    regua:
      "Nota do IDU no trimestre. Só ranqueia com pelo menos 50 dos 100 pontos medidos; sem churn e NPS lançados, a nota fica incompleta.",
    valor: (l) => fmtNum(l.valor),
    detalhe: (l) => `${fmtNum(l.amostra)} de 100 pontos medidos`,
    semPosicao: (l) =>
      l.situacao === "sem_dado"
        ? "Sem apuração no trimestre"
        : `Só ${fmtNum(l.amostra)} de 100 pontos medidos`,
  },
  {
    chave: "retencao",
    titulo: "Melhor retenção",
    pergunta: "Quem mais segura os clientes que já tem?",
    regua:
      "Dos clientes recorrentes do trimestre anterior (título em 2 meses ou mais), quantos seguiram com título. Omie da unidade.",
    valor: (l) => fmtPct(l.valor),
    detalhe: (l) => `${fmtNum(l.valor_secundario)} de ${plural(l.amostra, "cliente", "clientes")}`,
    semPosicao: (l) =>
      l.situacao === "sem_dado"
        ? "Sem Omie da unidade no sistema"
        : `${plural(l.amostra, "cliente recorrente", "clientes recorrentes")}; o mínimo é 20`,
  },
  {
    chave: "monetizacao",
    titulo: "Melhor monetização",
    pergunta: "Quem mais vendeu para a própria base?",
    regua:
      "Oportunidades do pipe Caixa ganhas no trimestre. Desempate pelas validadas no trimestre.",
    valor: (l) => plural(l.valor ?? 0, "ganha", "ganhas"),
    detalhe: (l) =>
      `${plural(l.valor_secundario ?? 0, "validada", "validadas")} · ${plural(l.amostra, "oportunidade", "oportunidades")} no pipe`,
    semPosicao: () => "Nenhuma oportunidade no pipe Caixa",
  },
  {
    chave: "inadimplencia",
    titulo: "Menor inadimplência",
    pergunta: "Quem recebe melhor o que fatura?",
    regua:
      "% do valor ainda em aberto dos títulos que venceram no trimestre e já têm 60 dias. Menor é melhor. Omie da unidade.",
    valor: (l) => fmtPct(l.valor),
    detalhe: (l) =>
      `${fmtBRL(l.valor_secundario)} em aberto · ${plural(l.amostra, "título", "títulos")}`,
    semPosicao: (l) =>
      l.situacao === "sem_dado"
        ? "Sem Omie da unidade no sistema"
        : `${plural(l.amostra, "título maduro", "títulos maduros")}; o mínimo é 10`,
  },
  {
    chave: "nps",
    titulo: "Melhor NPS",
    pergunta: "Quem tem o cliente mais satisfeito?",
    regua:
      "% de promotores menos % de detratores nas respostas do trimestre. Mínimo de 10 respostas.",
    valor: (l) => fmtNum(l.valor),
    detalhe: (l) => plural(l.amostra, "resposta", "respostas"),
    semPosicao: (l) =>
      l.situacao === "sem_dado"
        ? "Nenhuma resposta no trimestre"
        : `${plural(l.amostra, "resposta", "respostas")}; o mínimo é 10`,
  },
];

// Trimestres desde o 1º de 2025 (as unidades regionais inauguraram a partir daí).
type Trimestre = { chave: string; rotulo: string; inicio: string; fim: string };
function trimestres(hoje = new Date()): Trimestre[] {
  const lista: Trimestre[] = [];
  for (let ano = 2025; ano <= hoje.getFullYear(); ano++) {
    for (let t = 1; t <= 4; t++) {
      const inicio = new Date(ano, (t - 1) * 3, 1);
      if (inicio > hoje) break;
      const fim = new Date(ano, t * 3, 0);
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      lista.push({
        chave: `${ano}-T${t}`,
        rotulo: `${t}º trimestre de ${ano}`,
        inicio: iso(inicio),
        fim: iso(fim),
      });
    }
  }
  return lista.reverse();
}

/** O trimestre corrente só abre sozinho depois do primeiro mês; antes disso, o último fechado. */
function trimestrePadrao(lista: Trimestre[], hoje = new Date()): string {
  const atual = lista[0];
  const diasNoTrimestre =
    (hoje.getTime() - new Date(`${atual.inicio}T00:00:00`).getTime()) / 86_400_000;
  return diasNoTrimestre >= 31 || lista.length === 1 ? atual.chave : lista[1].chave;
}

function RankingPage() {
  const { user } = useAuth();
  const { unidade: minhaUnidade, scopedToOwnUnit, verComo } = usePermissions();
  const lista = useMemo(() => trimestres(), []);
  const [triBruto, setTri] = useFiltroNaUrl("tri", trimestrePadrao(lista));
  const tri =
    lista.find((t) => t.chave === triBruto) ??
    lista.find((t) => t.chave === trimestrePadrao(lista))!;

  const q = useQuery({
    queryKey: ["ranking-unidades", user?.id, verComo?.unidade ?? null, tri.chave],
    enabled: !!user?.id,
    queryFn: async () => {
      // A função não está nos tipos gerados.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("ranking_unidades", {
        p_inicio: tri.inicio,
        p_fim: tri.fim,
      });
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });

  const porRanking = useMemo(() => {
    const m = new Map<string, Linha[]>();
    for (const l of q.data ?? []) m.set(l.ranking, [...(m.get(l.ranking) ?? []), l]);
    return m;
  }, [q.data]);

  // O sócio vê a própria unidade grifada em todos os rankings.
  const ehMinha = (nome: string) =>
    scopedToOwnUnit && !!minhaUnidade && unitMatches(minhaUnidade, nome);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6">
      <PageHeader
        titulo="Ranking da Rede"
        pergunta="Quem está na frente, e em quê?"
        descricao={`Unidades regionais · ${tri.rotulo} · unidade sem dado ou com amostra pequena fica sem posição`}
        filtros={
          <BarraFiltros>
            <Select value={tri.chave} onValueChange={(v) => setTri(v)}>
              <SelectTrigger className="w-[220px]" aria-label="Trimestre">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {lista.map((t) => (
                  <SelectItem key={t.chave} value={t.chave}>
                    {t.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </BarraFiltros>
        }
      />

      {q.isLoading ? (
        <Carregando variante="pagina" />
      ) : q.isError ? (
        <EstadoErro
          titulo="Não foi possível montar o ranking"
          detalhe={(q.error as Error)?.message}
          tentarNovamente={() => q.refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {RANKINGS.map((d) => (
              <CartaoRanking
                key={d.chave}
                def={d}
                linhas={porRanking.get(d.chave) ?? []}
                ehMinha={ehMinha}
              />
            ))}
          </div>
          <Procedencia
            fonte="Carteira (Omie, Pipefy e Pipedrive), pipe Sócios e pipe Caixa do Pipedrive, apuração do IDU, Omie das unidades e NPS do Pipefy"
            atualizadoEm={new Date(q.dataUpdatedAt)}
            regua={`${tri.rotulo}, de ${tri.inicio.split("-").reverse().join("/")} a ${tri.fim.split("-").reverse().join("/")}`}
          />
        </>
      )}
    </div>
  );
}

function CartaoRanking({
  def,
  linhas,
  ehMinha,
}: {
  def: Definicao;
  linhas: Linha[];
  ehMinha: (nome: string) => boolean;
}) {
  const ranqueadas = linhas
    .filter((l) => l.situacao === "ok")
    .sort(
      (a, b) =>
        (a.posicao ?? 99) - (b.posicao ?? 99) || a.unidade.localeCompare(b.unidade, "pt-BR"),
    );
  const fora = linhas
    .filter((l) => l.situacao !== "ok")
    .sort((a, b) => a.unidade.localeCompare(b.unidade, "pt-BR"));

  return (
    <section
      className="flex flex-col rounded-xl border bg-card p-4"
      aria-labelledby={`r-${def.chave}`}
    >
      <header className="mb-3 space-y-1">
        <h2 id={`r-${def.chave}`} className="flex items-center gap-2 text-base font-semibold">
          <Trophy className="h-4 w-4 text-muted-foreground" aria-hidden />
          {def.titulo}
        </h2>
        <p className="text-sm text-foreground">{def.pergunta}</p>
        <p className="text-xs text-muted-foreground">{def.regua}</p>
      </header>

      {ranqueadas.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Nenhuma unidade com dado suficiente neste trimestre.
        </p>
      ) : (
        <ol className="space-y-1">
          {ranqueadas.map((l) => (
            <li
              key={l.unidade_id}
              className={cn(
                "flex items-center gap-3 rounded-md px-2 py-1.5",
                ehMinha(l.unidade) && "bg-primary/10 ring-1 ring-primary/40",
              )}
            >
              <span
                className={cn(
                  "num inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                  l.posicao === 1
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
                aria-label={`${l.posicao}º lugar`}
              >
                {l.posicao}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {l.unidade}
                {ehMinha(l.unidade) && (
                  <span className="ml-2 text-xs text-primary-text">sua unidade</span>
                )}
              </span>
              <span className="text-right">
                <span className="num block font-semibold">{def.valor(l)}</span>
                <span className="num block text-xs text-muted-foreground">{def.detalhe(l)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {fora.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sem posição
          </p>
          <ul className="space-y-1">
            {fora.map((l) => (
              <li
                key={l.unidade_id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm",
                  ehMinha(l.unidade) && "bg-primary/10 ring-1 ring-primary/40",
                )}
              >
                <span className="truncate">{l.unidade}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {def.semPosicao(l)}
                  <StatusBadge tom={l.situacao === "sem_dado" ? "neutro" : "atencao"} icone={false}>
                    {l.situacao === "sem_dado" ? "Sem dado" : "Amostra pequena"}
                  </StatusBadge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
