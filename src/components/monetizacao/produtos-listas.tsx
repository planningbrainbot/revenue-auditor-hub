// Produtos e Listas na Monetização (Pedro, 15/10/2026, proposta "Base à Prova de Criança", versão 14: "Produtos e
// Listas saem da Base e ficam só na Monetização"). É o mesmo Aquário que vivia em /clientes?view=produtos|listas, com a
// mesma URL de filtros (`components/clientes/busca.ts`): só mudou de casa. As ofertas leem a regra de cliente do
// domínio Clientes (`base.situacao`): quem não é cliente pela regra fica fora de todas (model.ts, foraDaRegraDeCliente).
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useMonetizacao, useAtualizarMonetizacao } from "@/hooks/use-monetizacao";
import { acionarMonetizacao } from "@/lib/monetizacao/functions";
import { normal } from "@/lib/monetizacao/model";
import {
  BarraFiltros,
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  PageHeader,
} from "@/components/planning";
import { BotaoComMotivo, FOCO_VISIVEL, Freshness, number, podeEscrever } from "./common";
import { Aquario, type ExtrasAquario, type SecaoAquario } from "./aquario";
import { MultiSelect } from "./multi-select";
import type { PortfolioFilters } from "@/lib/monetizacao/portfolio";
import { buscaDosFiltros, filtrosDaBusca, type BuscaClientes } from "@/components/clientes/busca";

const ACESSO_NEGADO = /^Seu acesso não inclui/;
const MOTIVO_ATUALIZAR_SEM_ESCOPO = "Relê a tela; disparar a carga do CRM exige escopo geral";
const FONTE_BASE = "Catálogo da Base (Pipefy + Omie, conciliados) e regra de cliente";

export type TelaMonetizacaoBase = "produtos" | "listas";
const META: Record<TelaMonetizacaoBase, { titulo: string; pergunta: string }> = {
  produtos: {
    titulo: "Produtos",
    pergunta: "Quantos clientes cada produto pode trabalhar agora, e quais vão para a lista?",
  },
  listas: {
    titulo: "Listas",
    pergunta: "Quais listas estão prontas para apresentar ao sócio e enviar ao Pipedrive?",
  },
};

export function ProdutosEListas({
  tela,
  search,
}: {
  tela: TelaMonetizacaoBase;
  search: BuscaClientes;
}) {
  const query = useMonetizacao(),
    invalidate = useAtualizarMonetizacao(),
    sync = useServerFn(acionarMonetizacao);
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const rota = tela === "produtos" ? "/monetizacao/produtos" : "/monetizacao/listas";
  // A carteira da unidade (seção "base" do Aquário) mora em Produtos, como segunda visão.
  const secao: SecaoAquario =
    tela === "listas" ? "listas" : search.secao === "carteira" ? "base" : "produtos";
  const mudar = (patch: Partial<BuscaClientes>, destino?: string, resetScroll = false) =>
    void navigate({
      to: destino ?? rota,
      search: { ...search, pagina: undefined, ...patch } as never,
      replace: true,
      resetScroll,
    });
  const unidadesUrl = search.unidade ?? [];
  const unidades = useMemo(
    () =>
      unidadesUrl.length && query.data
        ? query.data.units.filter((u) =>
            unidadesUrl.some((v) => u.key === v || normal(u.name) === normal(v)),
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, JSON.stringify(unidadesUrl)],
  );
  const unidadeKeys = unidades.map((u) => u.key);
  // O recorte do topo: busca e unidade. A lista não segue o topo.
  const accountKeys = useMemo(() => {
    const data = query.data;
    if (!data) return new Set<string>();
    const daUnidade = new Set(unidades.flatMap((u) => u.account_keys));
    const q = normal(search.q);
    const digitos = search.q.replace(/\D/g, "");
    return new Set(
      data.accounts
        .filter((a) => !unidadesUrl.length || daUnidade.has(a.key))
        .filter(
          (a) =>
            !q ||
            normal([a.name, a.segment, a.unit_label, ...(a.base?.cnpjs || [])].join(" ")).includes(
              q,
            ) ||
            (digitos.length >= 3 && !!a.base?.cnpjs.some((c) => c.includes(digitos))),
        )
        .map((a) => a.key),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, unidades, search.q]);
  const assinatura = JSON.stringify([
    unidadeKeys,
    search.origem,
    search.produto,
    search.situacao,
    search.abordagem,
    search.faixa,
    search.driva,
    search.segmento,
    search.regime,
    search.receita,
    search.contato,
    search.sobreposicao,
    search.distrato,
    search.consultoria,
    search.omie,
    search.prova,
  ]);
  const filtros = useMemo(
    () => filtrosDaBusca(search, unidadeKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assinatura],
  );
  // Trocar de seção: Produtos e Listas são páginas da Monetização; a carteira é a segunda visão de Produtos; os números
  // da Base (Entenda os números) moram em Arrumar a base.
  const destinoDa = (s: SecaoAquario): { to: string; patch: Partial<BuscaClientes> } =>
    s === "listas"
      ? { to: "/monetizacao/listas", patch: { secao: undefined } }
      : s === "produtos"
        ? { to: "/monetizacao/produtos", patch: { secao: undefined } }
        : s === "base"
          ? { to: "/monetizacao/produtos", patch: { secao: "carteira" } }
          : { to: "/clientes", patch: { view: "arrumar", sub: "gates" } };
  const irPara = (s: SecaoAquario) => {
    const d = destinoDa(s);
    mudar(d.patch, d.to, true);
  };
  const mudarFiltros = (f: PortfolioFilters, destino?: SecaoAquario, extras?: ExtrasAquario) => {
    const d = destino ? destinoDa(destino) : null;
    mudar(
      {
        ...buscaDosFiltros(f),
        ...(extras ? { painel: extras.painel } : {}),
        ...(d?.patch ?? {}),
      },
      d?.to,
      !!destino,
    );
  };
  const meta = META[tela];
  if (!query.data) {
    const erro = query.error;
    return (
      <main className="mx-auto max-w-[1700px] space-y-4 p-4 md:p-6">
        <PageHeader titulo={meta.titulo} pergunta={meta.pergunta} />
        {!erro ? (
          <>
            <Carregando variante="kpis" />
            <Carregando variante="tabela" />
          </>
        ) : ACESSO_NEGADO.test(erro.message) ? (
          <EstadoSemAcesso oQueFalta="view.aquario, view.clientes ou view.monetizacao" />
        ) : (
          <EstadoErro
            detalhe={`Fonte: carga da Base de clientes. ${erro.message}`}
            tentarNovamente={() => void query.refetch()}
          />
        )}
      </main>
    );
  }
  const data = query.data;
  const refresh = async () => {
    setRefreshing(true);
    try {
      const disparou = podeEscrever(data);
      if (disparou) await sync({ data: { action: "sync" } });
      await invalidate();
      toast.success(disparou ? "Carga pedida" : "Tela relida");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const clientes = data.accounts.filter((a) => a.base?.situacao?.estado === "cliente").length;
  const perimetro = unidades.length
    ? unidades.map((u) => u.name).join(", ")
    : "todas as unidades liberadas";
  const temFiltroTopo = !!(search.q || unidadesUrl.length);
  const descricao =
    tela === "listas"
      ? `${number(data.lists.length)} listas salvas · listas de todas as unidades do seu escopo · a lista não segue os filtros do topo`
      : `${number(accountKeys.size)} contas no recorte · ${perimetro} · só os ${number(clientes)} clientes pela regra entram nas ofertas · Consultoria, Finance, Cella e Recon, cada um pela própria régua`;
  return (
    <main className="mx-auto max-w-[1700px] space-y-4 p-4 md:p-6">
      <PageHeader
        titulo={meta.titulo}
        pergunta={meta.pergunta}
        descricao={descricao}
        procedencia={{ fonte: FONTE_BASE, atualizadoEm: data.catalog_at }}
        acoes={
          <Freshness
            data={data}
            refreshing={refreshing}
            onRefresh={refresh}
            motivoAtualizar={podeEscrever(data) ? null : MOTIVO_ATUALIZAR_SEM_ESCOPO}
          />
        }
      />
      {tela === "produtos" && (
        <>
          <nav aria-label="Visões de Produtos" className="flex gap-1 border-b">
            {(
              [
                ["produtos", "Por produto"],
                ["base", "Carteira da unidade"],
              ] as const
            ).map(([s, rotulo]) => (
              <button
                key={s}
                type="button"
                aria-current={secao === s ? "page" : undefined}
                onClick={() => irPara(s)}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm ${FOCO_VISIVEL} ${secao === s ? "border-primary font-semibold text-primary-text" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {rotulo}
              </button>
            ))}
          </nav>
          <BarraFiltros>
            <label className="relative min-w-56 flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Buscar empresa, segmento ou CNPJ"
                className="pl-9"
                value={search.q}
                placeholder="Buscar empresa, segmento ou CNPJ"
                onChange={(e) => mudar({ q: e.target.value })}
              />
            </label>
            <div className="w-56">
              <MultiSelect
                label="Unidade"
                placeholder="Todas as unidades liberadas"
                value={unidadeKeys}
                onChange={(v) => mudar({ unidade: v.length ? v : undefined })}
                options={data.units
                  .filter((u) => u.account_keys.length)
                  .map((u) => ({ value: u.key, label: u.name }))}
              />
            </div>
            <BotaoComMotivo
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              disabled={!temFiltroTopo}
              motivo={temFiltroTopo ? null : "Nenhum filtro aplicado."}
              onClick={() => mudar({ q: "", unidade: undefined })}
            >
              <X className="size-4" aria-hidden />
              Limpar filtros
            </BotaoComMotivo>
          </BarraFiltros>
        </>
      )}
      <Aquario
        embedded
        accountKeys={accountKeys}
        secao={secao}
        irPara={irPara}
        accountKeysSemOrigem={accountKeys}
        filtros={filtros}
        mudarFiltros={mudarFiltros}
        recorte={JSON.stringify([unidadeKeys, search.q])}
        painel={search.painel}
        lista={search.lista}
        aoAbrirLista={(id) => mudar({ lista: id ?? undefined })}
      />
    </main>
  );
}
