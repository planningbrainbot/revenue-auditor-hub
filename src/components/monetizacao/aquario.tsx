import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  CheckCheck,
  Download,
  ListPlus,
  Search,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMonetizacao, useAtualizarMonetizacao } from "@/hooks/use-monetizacao";
import { acionarMonetizacao } from "@/lib/monetizacao/functions";
import {
  baseRetroativaConsultoria,
  disponibilidade,
  FAIXAS,
  faturamentoDeclarado,
  oferta,
  tetoEmReais,
  rotuloSituacaoReceita,
  situacaoForaDeOferta,
  tetoContradizFaixa,
} from "@/lib/monetizacao/model";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, Conta, Produto, Unidade } from "@/lib/monetizacao/types";
import { AccountDetail } from "./account-detail";
import { ReconAquario } from "./recon";
import { ofertaRecon, potencialRecon } from "@/lib/monetizacao/recon";
import { ListWorkspace } from "./list-workspace";
import { DirectSend } from "./direct-send";
import {
  ABORDAGENS,
  EMPTY_PORTFOLIO_FILTERS,
  estadoProduto,
  filtrarCarteira,
  ORIGENS_BASE,
  origemBase,
  potencialConsultoria,
  situacoesIniciais,
  SITUACOES,
  SITUACOES_RECEITA_FILTRO,
} from "@/lib/monetizacao/portfolio";
import type {
  Abordagem,
  EstadoProduto,
  OrigemBase,
  PortfolioFilters,
  Situacao,
} from "@/lib/monetizacao/portfolio";
import { FieldMulti, MultiSelect } from "./multi-select";
import {
  date,
  downloadCsv,
  Field,
  Freshness,
  inputClass,
  Kpi,
  LoadingState,
  Notice,
  number,
  OfertaTag,
  Panel,
} from "./common";
import { Secao } from "@/components/planning";

type Filters = PortfolioFilters;
// Mesmo limite da validação do servidor para listas e envios (salvarListaAquario / monetizacao_save_list).
const LIMITE_LOTE = 300;
// Valor explícito de "todas as situações": vazio significa a situação padrão do produto.
const TODAS = "todas";
const emptyFilters = EMPTY_PORTFOLIO_FILTERS;
export function Aquario({
  embedded = false,
  accountKeys,
}: { embedded?: boolean; accountKeys?: Set<string> } = {}) {
  const q = useMonetizacao(),
    invalidate = useAtualizarMonetizacao(),
    sync = useServerFn(acionarMonetizacao);
  const [tab, setTab] = useState("carteiras"),
    [unit, setUnit] = useState<Unidade | null>(null),
    [account, setAccount] = useState<Conta | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters),
    [picked, setPicked] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<{
    unit: Unidade | null;
    accounts: string[];
    product: Produto;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const data = useMemo(
    () =>
      q.data &&
      (accountKeys
        ? { ...q.data, accounts: q.data.accounts.filter((a) => accountKeys.has(a.key)) }
        : q.data),
    [q.data, accountKeys],
  );
  if (!data) return <LoadingState error={q.error} retry={() => q.refetch()} />;
  const unitKeys = new Set(unit?.account_keys);
  const unitAccounts = unit ? data.accounts.filter((a) => unitKeys.has(a.key)) : data.accounts;
  const refresh = async () => {
    setRefreshing(true);
    try {
      if (data.permissions.view && data.permissions.all_units)
        await sync({ data: { action: "sync" } });
      await invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const startList = (keys: string[], forUnit: Unidade | null, product: Produto) => {
    setDraft({ unit: forUnit, accounts: keys, product });
    setUnit(null);
    setTab("listas");
    setPicked(new Set());
  };
  const cella = data.accounts.filter((a) => oferta(a, "cella").status === "elegivel"),
    consult = data.accounts.filter((a) => oferta(a, "consultoria").status === "elegivel"),
    consultPool = data.accounts.filter(potencialConsultoria),
    consultPending = consultPool.filter((a) => oferta(a, "consultoria").status === "revisar"),
    consultBase = data.accounts.filter(baseRetroativaConsultoria),
    // Exclusão por regime e exclusão por situação cadastral são motivos diferentes; misturá-las
    // faria o cartão afirmar que centenas de empresas fechadas são do Simples.
    consultExcluded = consultBase.filter(
      (a) => oferta(a, "consultoria").status === "fora_regra" && !situacaoForaDeOferta(a),
    ),
    consultInativas = consultBase.filter((a) => situacaoForaDeOferta(a)),
    finance = data.accounts.filter((a) => oferta(a, "finance").status === "elegivel");
  const overlap = data.accounts.filter(
    (a) =>
      PRODUTOS.filter((p) => oferta(a, p).status === "elegivel").length +
        Number(ofertaRecon(a).status === "elegivel") >
      1,
  );
  const content = (rows: Conta[], drawer = false) => (
    <PortfolioTable
      data={data}
      accounts={rows}
      filters={filters}
      setFilters={setFilters}
      picked={picked}
      setPicked={setPicked}
      showAccount={setAccount}
      onList={(keys) => startList(keys, unit, filters.product || "consultoria")}
      inUnit={drawer}
      unitId={unit?.id ?? null}
    />
  );
  return (
    <main className={embedded ? "space-y-4" : "mx-auto max-w-[1600px] space-y-4 p-4 md:p-6"}>
      {/* Vive embutido em /clientes, que já tem o PageHeader: aqui o título é de
          seção (h2), não um segundo título de página. */}
      <Secao
        titulo="Cockpit da base"
        descricao="Base de clientes · carteiras e listas para os sócios"
        acoes={<Freshness data={data} refreshing={refreshing} onRefresh={refresh} />}
        className="space-y-4"
      >
        {data.sync_error && (
          <Notice>
            A atualização do CRM falhou. Os dados exibidos são da última carga concluída.{" "}
            {data.sync_error}
          </Notice>
        )}
        {!data.permissions.all_units && !data.units.length && (
          <Notice>
            Seu acesso está ativo, mas nenhuma unidade foi liberada para você. A administração precisa
            definir suas carteiras.
          </Notice>
        )}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <Kpi
            label="Contas na base conciliada"
            value={number(data.accounts.length)}
            hint="Uma conta, mesmo com mais de um produto"
          />
          <Kpi
            label="Cella · perfil aderente"
            value={number(cella.length)}
            hint="A partir de R$ 25 mi · fora do Simples"
          />
          <Kpi
            label="Consultoria · carteira retroativa"
            value={number(consultBase.length)}
            hint={`${consult.length} aptas · ${consultExcluded.length} por Simples/MEI · ${consultInativas.length} inativas na Receita · ${consultPending.length} a confirmar`}
            accent
          />
          <Kpi
            label="Finance · perfil aderente"
            value={number(finance.length)}
            hint="Contrato Pipedrive · abaixo de R$ 25 mi · fora do Simples"
          />
          <Kpi
            label="Mais de um produto"
            value={number(overlap.length)}
            hint="Contas já incluídas nos produtos ao lado"
          />
        </div>
        <Panel title="Listas potenciais por produto">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <button
              onClick={() => setTab("recon")}
              className={`rounded-lg border p-4 text-left hover:border-primary ${tab === "recon" ? "border-primary bg-primary/5" : ""}`}
            >
              <span className="flex items-center justify-between font-semibold">
                Recon <ArrowRight className="h-4 w-4" />
              </span>
              <p className="mt-2 text-sm">
                {data.accounts.filter(potencialRecon).length} contas no radar ·{" "}
                {data.accounts.filter((a) => ofertaRecon(a).status === "elegivel").length} aptas
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Acima de R$ 5 mi · fora de qualquer BPO · seleção no Aquário
              </p>
            </button>
            {(["consultoria", "cella", "finance"] as Produto[]).map((p) => {
              const eligible = data.accounts.filter((a) => oferta(a, p).status === "elegivel");
              const free = eligible.filter(
                (a) => disponibilidade(a, p, data.cards, undefined, data.reservations).free,
              );
              return (
                <button
                  key={p}
                  onClick={() => {
                    setFilters({ ...emptyFilters, product: p, status: situacoesIniciais(p) });
                    setPicked(new Set());
                    setTab("contas");
                  }}
                  className={`rounded-lg border p-4 text-left hover:border-primary ${tab === "contas" && filters.product === p ? "border-primary bg-primary/5" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2 font-semibold">
                    {NOMES[p]}
                    <span className="flex shrink-0 items-center gap-1">
                      {p === "consultoria" && consultPending.length > 0 && (
                        <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">
                          {consultPending.length} a confirmar
                        </span>
                      )}
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </span>
                  {/* Uma métrica dominante: o que dá para trabalhar hoje. As contagens de perfil
                      aderente já estão na faixa de KPIs acima e saíram daqui para não repetir. */}
                  <p className="my-2 text-3xl font-semibold tabular-nums">
                    {number(free.length)}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      aptas e disponíveis
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p === "consultoria"
                      ? `${number(eligible.length)} aptas de ${number(consultPool.length)} retroativas para análise`
                      : `${number(eligible.length)} com perfil aderente`}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {p === "consultoria"
                      ? "Base Antiga · sem fechamento comercial · contato opcional"
                      : p === "cella"
                        ? "A partir de R$ 25 mi · fora do Simples"
                        : "Contrato ganho no Pipedrive · abaixo de R$ 25 mi"}
                  </p>
                </button>
              );
            })}
          </div>
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => {
              setFilters({
                ...emptyFilters,
                product: "consultoria",
                origin: ["antiga"],
                status: ["qualificar"],
              });
              setPicked(new Set());
              setTab("contas");
            }}
          >
            Conferir regime da base retroativa
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            A mesma conta pode aparecer em mais de uma lista. A seleção define o produto que será
            preenchido no Pipedrive; contato é opcional.
          </p>
        </Panel>
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="carteiras">Carteiras por unidade</TabsTrigger>
              <TabsTrigger value="contas">Todas as contas</TabsTrigger>
              <TabsTrigger value="recon">Recon</TabsTrigger>
              <TabsTrigger value="listas">
                Listas para sócios <span className="ml-1 text-xs">{data.lists.length}</span>
              </TabsTrigger>
              <TabsTrigger value="gates">Entenda os números</TabsTrigger>
            </TabsList>
            <Link
              to="/monetizacao"
              search={{ aba: "operacao" }}
              className="flex items-center gap-1 text-xs font-medium text-primary"
            >
              Acompanhar operação <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <TabsContent value="carteiras" className="space-y-4">
            <Panel title="Abra a unidade para organizar a apresentação">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {data.units.map((u) => {
                  const keys = new Set(u.account_keys);
                  const accounts = data.accounts.filter((a) => keys.has(a.key)),
                    c = accounts.filter((a) => oferta(a, "consultoria").status === "elegivel").length,
                    pending = accounts.filter(
                      (a) => potencialConsultoria(a) && oferta(a, "consultoria").status === "revisar",
                    ).length,
                    f = accounts.filter((a) => oferta(a, "finance").status === "elegivel").length,
                    cella_u = accounts.filter((a) => oferta(a, "cella").status === "elegivel").length,
                    antigas = accounts.filter((a) => origemBase(a) === "antiga").length,
                    novas = accounts.filter((a) => origemBase(a) === "nova").length,
                    conferir = accounts.filter((a) =>
                      ["confirmar", "divergente"].includes(origemBase(a)),
                    ).length;
                  return (
                    <button
                      key={u.key}
                      onClick={() => {
                        // Trocar de unidade zera o recorte; reabrir a mesma preserva o trabalho.
                        if (unit?.key !== u.key) {
                          setFilters(emptyFilters);
                          setPicked(new Set());
                        }
                        setUnit(u);
                      }}
                      className="group rounded-lg border p-4 text-left transition hover:border-primary hover:bg-primary/5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{u.name}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          {u.omie_integrado === false && (u.cnpjs ?? 0) > 0 && (
                            <span
                              className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning"
                              title="O Omie desta unidade não chega ao Brain. A carteira faturada pode ser maior do que o que aparece aqui."
                            >
                              cobertura parcial
                            </span>
                          )}
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                        </div>
                      </div>
                      {/* Uma métrica dominante: CNPJs distintos é o que responde "tamanho da
                          unidade". "contas" some daqui — é unidade de trabalho, não de tamanho. */}
                      <p className="my-2 text-3xl font-semibold tabular-nums">
                        {number(u.cnpjs ?? accounts.length)}{" "}
                        <span className="text-xs font-normal text-muted-foreground">empresas</span>
                      </p>
                      {/* Procedência: o card declara de onde conhece a carteira em vez de afirmar
                          censo. As fontes se sobrepõem, por isso não somam. */}
                      <p className="text-xs text-muted-foreground">
                        {u.omie_integrado === false
                          ? `catálogo Pipefy ${number(u.cnpjs_pipefy ?? 0)} · Omie não integrado`
                          : `catálogo Pipefy ${number(u.cnpjs_pipefy ?? 0)} · Omie ${number(u.cnpjs_omie ?? 0)}`}
                      </p>
                      {/* Composição da origem em barra: comprimento compara melhor que três números. */}
                      <div
                        className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-muted"
                        title={`${antigas} antigas · ${novas} novas · ${conferir} a conferir`}
                      >
                        {[
                          ["bg-primary", antigas],
                          ["bg-info", novas],
                          ["bg-muted-foreground/40", conferir],
                        ].map(([cor, n], i) =>
                          (n as number) > 0 ? (
                            <div
                              key={i}
                              className={cor as string}
                              style={{
                                width: `${Math.max(2, ((n as number) / Math.max(1, accounts.length)) * 100)}%`,
                              }}
                            />
                          ) : null,
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                        <span className="text-primary">{c} aptas em Consultoria</span>
                        {pending > 0 && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                            {pending} a confirmar
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {number(accounts.length)} contas conciliadas · Cella {cella_u} · Finance {f}
                      </p>
                    </button>
                  );
                })}
              </div>
            </Panel>
            <Notice>
              As carteiras podem compartilhar contas. Os totais por unidade não devem ser somados.
              Para a Consultoria, a falta de contato pode ser resolvida com o sócio.
            </Notice>
          </TabsContent>
          <TabsContent value="contas">{content(data.accounts)}</TabsContent>
          <TabsContent value="recon">
            <ReconAquario accounts={data.accounts} showAccount={setAccount} />
          </TabsContent>
          <TabsContent value="listas" forceMount className={tab === "listas" ? "" : "hidden"}>
            <ListWorkspace
              data={data}
              initial={draft}
              onConsume={() => setDraft(null)}
              showAccount={setAccount}
            />
          </TabsContent>
          <TabsContent value="gates">
            <Gates data={data} />
          </TabsContent>
        </Tabs>
        <Sheet open={!!unit} onOpenChange={(o) => !o && setUnit(null)}>
          <SheetContent
            className="w-full overflow-y-auto sm:max-w-[min(1180px,95vw)]"
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
          >
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                {unit?.name}
              </SheetTitle>
              <SheetDescription>
                {unitAccounts.length} contas · veja a origem da carteira e filtre o produto para
                trabalhar.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(ORIGENS_BASE).map(([key, label]) => (
                  <Kpi
                    key={key}
                    label={label}
                    value={number(unitAccounts.filter((a) => origemBase(a) === key).length)}
                    onClick={() => {
                      setFilters({ ...emptyFilters, origin: [key as OrigemBase] });
                      setPicked(new Set());
                    }}
                  />
                ))}
              </div>
              {content(unitAccounts, true)}
            </div>
            {/* Dentro do SheetContent de proposito: como irmao, o fade de saida da ficha devolvia o
                clique ao overlay da gaveta e fechava a unidade junto, levando a montagem de lista. */}
            {unit && (
              <AccountDetail account={account} cards={data.cards} close={() => setAccount(null)} />
            )}
          </SheetContent>
        </Sheet>
        {!unit && (
          <AccountDetail account={account} cards={data.cards} close={() => setAccount(null)} />
        )}
      </Secao>
    </main>
  );
}

function PortfolioTable({
  data,
  accounts,
  filters,
  setFilters,
  picked,
  setPicked,
  showAccount,
  onList,
  inUnit,
  unitId,
}: {
  data: BaseMonetizacao;
  accounts: Conta[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  picked: Set<string>;
  setPicked: (p: Set<string>) => void;
  showAccount: (a: Conta) => void;
  onList: (keys: string[]) => void;
  inUnit: boolean;
  unitId: number | null;
}) {
  const [limit, setLimit] = useState(50);
  // Cópia da seleção no momento do envio: o resultado continua legível mesmo quando as contas
  // enviadas saem do filtro após a atualização.
  const [sending, setSending] = useState<Conta[] | null>(null);
  const product = filters.product;
  const situacaoEfetiva = filters.status.length ? filters.status : situacoesIniciais(product);
  // Mudar filtro limpa a seleção: nunca enviar conta que saiu da tela (decisão de 16/09).
  const change = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters({
      ...filters,
      [key]: value,
      ...(key === "product"
        ? { status: situacoesIniciais(value as Produto | ""), approach: [] }
        : {}),
    });
    // Busca so estreita o que ja esta na tela; mexer nela nao e trocar de recorte.
    if (key !== "query") setPicked(new Set());
    setLimit(50);
  };
  const rows = useMemo(() => filtrarCarteira(accounts, filters, data), [accounts, filters, data]);
  const semSituacao = useMemo(
    () => (product ? filtrarCarteira(accounts, filters, data, { ignorarSituacao: true }) : []),
    [accounts, filters, data, product],
  );
  const estado = (a: Conta) => (product ? estadoProduto(a, product, data) : null);
  const contagem = useMemo(() => {
    const n: Record<string, number> = {
      free: 0,
      occupied: 0,
      qualificar: 0,
      review: 0,
      excluded: 0,
    };
    if (!product) return n;
    for (const a of semSituacao) {
      const e = estadoProduto(a, product, data);
      n[e.situacao]++;
      if (e.perfil.status === "revisar" && e.situacao !== "review") n.review++;
    }
    return n;
  }, [semSituacao, product, data]);
  const visible = rows.slice(0, limit),
    selected = rows.filter((a) => picked.has(a.key));
  const prontas = product ? rows.filter((a) => estado(a)!.situacao === "free") : [];
  const acimaDoLimite = selected.length > LIMITE_LOTE;
  const prontasSelecionadas = product
    ? selected.filter((a) => estado(a)!.situacao === "free").length
    : 0;
  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  const unique = (values: (string | null | undefined)[]) =>
    [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const chips: { key: Situacao; label: string; n: number; tone: string }[] = product
    ? [
        {
          key: "free",
          label: "Prontas para enviar",
          n: contagem.free,
          tone: "text-success",
        },
        {
          key: "qualificar",
          label: "A confirmar",
          n: contagem.qualificar,
          tone: "text-warning",
        },
        { key: "occupied", label: "Aptas já em trabalho", n: contagem.occupied, tone: "" },
        {
          key: "excluded",
          label: "Fora da regra",
          n: contagem.excluded,
          tone: "text-muted-foreground",
        },
      ]
    : [];
  const situacoes = (Object.keys(SITUACOES) as Situacao[]).filter(
    (s) => s !== "potential" || product === "consultoria",
  );
  return (
    <Panel
      title={
        inUnit
          ? "Carteira da unidade"
          : product
            ? `Lista potencial · ${NOMES[product]}`
            : "Carteira conciliada"
      }
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCsv("aquario.csv", [
                [
                  "Empresa",
                  "Unidade",
                  "Origem da base",
                  "Fonte da origem",
                  "Situação na Receita",
                  "Fonte da situação",
                  "Faturamento anual",
                  "Conflito de faturamento",
                  "Faixa de faturamento estimado do grupo · Driva",
                  "Driva · consultado em",
                  "Segmento",
                  "Regime",
                  "Contato",
                  "Consultoria",
                  "Finance",
                  "Cella",
                  ...(product ? [`Situação · ${NOMES[product]}`, "Abordagem"] : []),
                ],
                ...rows.map((a) => {
                  const e = estado(a);
                  return [
                    a.name,
                    a.unit_label,
                    ORIGENS_BASE[origemBase(a)],
                    a.base_origin?.reason,
                    rotuloSituacaoReceita(a) ?? "Sem consulta na Receita",
                    a.situacao_receita_fonte,
                    faturamentoDeclarado(a),
                    tetoContradizFaixa(a),
                    a.driva?.group_revenue_band,
                    a.driva?.queried_at,
                    a.segment,
                    a.regime,
                    a.contact ? "Sim" : "Obter com o sócio",
                    oferta(a, "consultoria").reason,
                    oferta(a, "finance").reason,
                    oferta(a, "cella").reason,
                    ...(e
                      ? [
                          ROTULO_SITUACAO[e.situacao],
                          e.abordagem
                            .map((x) =>
                              x === "enviada" && e.envio === "incerto"
                                ? "Envio incerto, conferir no Pipedrive"
                                : ABORDAGENS[x],
                            )
                            .join("; "),
                        ]
                      : []),
                  ];
                }),
              ])
            }
          >
            <Download className="mr-1 h-3 w-3" />
            Exportar filtro
          </Button>
          {product && (
            <Button
              size="sm"
              variant="outline"
              disabled={!prontas.length}
              title={`Seleciona as contas deste filtro que estão aptas e disponíveis, inclusive as que ainda não apareceram na página. Envio e lista aceitam até ${LIMITE_LOTE} por vez: acima disso, entram as ${LIMITE_LOTE} primeiras da ordem da tabela.`}
              onClick={() => setPicked(new Set(prontas.slice(0, LIMITE_LOTE).map((a) => a.key)))}
            >
              <CheckCheck className="mr-1 h-4 w-4" />
              {prontas.length > LIMITE_LOTE
                ? `Selecionar ${LIMITE_LOTE} de ${number(prontas.length)} prontas`
                : `Selecionar prontas (${number(prontas.length)})`}
            </Button>
          )}
          <Button
            size="sm"
            disabled={!data.permissions.manage || !selected.length || acimaDoLimite}
            title={
              acimaDoLimite
                ? `Uma lista aceita até ${LIMITE_LOTE} contas; desmarque ${selected.length - LIMITE_LOTE}.`
                : undefined
            }
            onClick={() => onList(selected.map((a) => a.key))}
          >
            <ListPlus className="mr-1 h-4 w-4" />
            Preparar lista ({selected.length})
          </Button>
          <Button
            size="sm"
            disabled={!data.permissions.send || !selected.length || acimaDoLimite}
            title={
              !data.permissions.send
                ? "Seu acesso não permite enviar ao Pipedrive."
                : !selected.length
                  ? "Selecione as contas para enviar."
                  : acimaDoLimite
                    ? `O envio aceita até ${LIMITE_LOTE} contas por vez; desmarque ${selected.length - LIMITE_LOTE}.`
                    : undefined
            }
            onClick={() => setSending(selected)}
          >
            <Send className="mr-1 h-4 w-4" />
            Enviar ao Pipedrive ({product ? prontasSelecionadas : selected.length})
          </Button>
        </div>
      }
    >
      {sending && (
        <DirectSend
          data={data}
          accounts={sending}
          initialProduct={product}
          unitId={
            unitId ??
            (filters.unit.length === 1
              ? (data.units.find((u) => u.key === filters.unit[0])?.id ?? null)
              : null)
          }
          close={() => setSending(null)}
          done={() => {
            setSending(null);
            setPicked(new Set());
          }}
        />
      )}
      <div className="mb-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {!inUnit && (
          <FieldMulti label="Unidade">
            <MultiSelect
              label="Unidade"
              placeholder="Todas as unidades"
              value={filters.unit}
              onChange={(v) => change("unit", v)}
              options={data.units.map((u) => ({ value: u.key, label: u.name }))}
            />
          </FieldMulti>
        )}
        <FieldMulti label="Origem da base">
          <MultiSelect
            label="Origem da base"
            placeholder="Antigas, novas e pendentes"
            value={filters.origin}
            onChange={(v) => change("origin", v as OrigemBase[])}
            options={Object.entries(ORIGENS_BASE).map(([value, label]) => ({ value, label }))}
          />
        </FieldMulti>
        <Field label="Buscar empresa">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              className={`${inputClass} pl-8`}
              value={filters.query}
              onChange={(e) => change("query", e.target.value)}
              placeholder="Nome ou segmento"
            />
          </div>
        </Field>
        <FieldMulti label="Faturamento anual · cadastro">
          <MultiSelect
            label="Faturamento anual · cadastro"
            placeholder="Todas as faixas"
            value={filters.band}
            onChange={(v) => change("band", v)}
            options={[
              { value: "10", label: "A partir de R$ 10 mi" },
              { value: "25", label: "A partir de R$ 25 mi" },
              { value: "50", label: "A partir de R$ 50 mi" },
              { value: "unknown", label: "Nada informado" },
              ...unique(accounts.map((a) => a.band)).map((band) => ({
                value: `exact:${band}`,
                label: band,
                group: "Faixa cadastrada",
              })),
              ...unique(
                accounts.map((a) =>
                  !a.band && a.faturamento_teto != null ? String(a.faturamento_teto) : null,
                ),
              ).map((teto) => ({
                value: `teto:${teto}`,
                label: `Até ${tetoEmReais(Number(teto))}`,
                group: "Teto pelo porte na Receita · sem faixa declarada",
              })),
            ]}
          />
        </FieldMulti>
        {accounts.some((a) => a.driva?.group_revenue_band) && (
          <FieldMulti label="Faturamento estimado · grupo Driva">
            <MultiSelect
              label="Faturamento estimado · grupo Driva"
              placeholder="Todas as estimativas"
              value={filters.drivaBand}
              onChange={(v) => change("drivaBand", v)}
              options={unique(accounts.map((a) => a.driva?.group_revenue_band)).map((band) => ({
                value: band,
                label: band,
              }))}
            />
          </FieldMulti>
        )}
        <FieldMulti label="Segmento">
          <MultiSelect
            label="Segmento"
            placeholder="Todos"
            value={filters.segment}
            onChange={(v) => change("segment", v)}
            options={[
              { value: "unknown", label: "Não informado" },
              ...unique(accounts.map((a) => a.segment)).map((s) => ({ value: s, label: s })),
            ]}
          />
        </FieldMulti>
        <FieldMulti label="Regime tributário">
          <MultiSelect
            label="Regime tributário"
            placeholder="Todos os regimes"
            value={filters.regime}
            onChange={(v) => change("regime", v)}
            options={[
              { value: "unknown", label: "Não informado" },
              ...unique(accounts.map((a) => a.regime)).map((r) => ({ value: r, label: r })),
            ]}
          />
        </FieldMulti>
        <FieldMulti label="Situação na Receita">
          <MultiSelect
            label="Situação na Receita"
            placeholder="Todas as situações cadastrais"
            value={filters.receita}
            onChange={(v) => change("receita", v)}
            options={Object.entries(SITUACOES_RECEITA_FILTRO).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </FieldMulti>
        <FieldMulti label="Contato · filtro opcional">
          <MultiSelect
            label="Contato"
            placeholder="Com e sem contato"
            value={filters.contact}
            onChange={(v) => change("contact", v)}
            options={[
              { value: "true", label: "Com contato" },
              { value: "false", label: "Obter com o sócio" },
            ]}
          />
        </FieldMulti>
        <Field label="Produto da lista">
          <select
            className={inputClass}
            value={product}
            onChange={(e) => change("product", e.target.value as Produto | "")}
          >
            <option value="">Todos os produtos</option>
            {PRODUTOS.map((p) => (
              <option key={p} value={p}>
                {NOMES[p]}
              </option>
            ))}
          </select>
        </Field>
        <FieldMulti label="Situação no produto">
          <MultiSelect
            label="Situação no produto"
            disabled={!product}
            placeholder={product ? "Todas as situações" : "Selecione um produto"}
            // A situação padrão do produto aparece marcada; desmarcar tudo significa todas.
            value={situacaoEfetiva.filter((s) => s !== TODAS)}
            onChange={(v) => change("status", v.length ? v : [TODAS])}
            options={situacoes.map((s) => ({ value: s, label: SITUACOES[s] }))}
          />
        </FieldMulti>
        {product && (
          <FieldMulti label="Abordagem no produto">
            <MultiSelect
              label="Abordagem no produto"
              placeholder="Abordadas ou não"
              value={filters.approach}
              onChange={(v) => change("approach", v as Abordagem[])}
              options={(Object.entries(ABORDAGENS) as [Abordagem, string][]).map(
                ([value, label]) => ({ value, label }),
              )}
            />
          </FieldMulti>
        )}
        <label className="flex items-center gap-2 self-end pb-2 text-xs">
          <input
            type="checkbox"
            checked={filters.overlap}
            onChange={(e) => change("overlap", e.target.checked)}
          />
          Aderentes a mais de um produto
        </label>
        <Button
          variant="ghost"
          className="self-end"
          onClick={() => {
            // Preserva o produto escolhido; limpar filtros não é trocar de lista.
            setFilters({ ...emptyFilters, product, status: situacoesIniciais(product) });
            setPicked(new Set());
            setLimit(50);
          }}
        >
          Limpar filtros
        </Button>
      </div>
      {product && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {chips.map((c) => {
            const active = situacaoEfetiva.length === 1 && situacaoEfetiva[0] === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={active}
                onClick={() => change("status", active ? situacoesIniciais(product) : [c.key])}
                className={`rounded-lg border p-3 text-left transition hover:border-primary ${active ? "border-primary bg-primary/5" : ""}`}
              >
                <span className="text-xs text-muted-foreground">{c.label}</span>
                <span className={`block text-xl font-semibold tabular-nums ${c.tone}`}>
                  {number(c.n)}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {product === "consultoria" && (
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
          <p className="font-medium">Regime não informado não significa empresa inapta.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A base para análise reúne contas antigas das unidades sem fechamento comercial
            identificado. Para confirmar aptidão, falta verificar se estão fora do Simples. Contato
            e faturamento não são exigidos. Você pode organizar essas contas em listas; o envio
            exige regime confirmado.
          </p>
        </div>
      )}
      <p className="mb-2 text-xs text-muted-foreground">
        {number(rows.length)} de {number(accounts.length)} contas ·{" "}
        {product
          ? "prontas para enviar primeiro, depois maior faturamento"
          : "maior faturamento primeiro"}{" "}
        · {selected.length} selecionadas
        {product && selected.length > 0 && (
          <>
            {" "}
            ({prontasSelecionadas} prontas para enviar
            {selected.length - prontasSelecionadas > 0
              ? ` · ${selected.length - prontasSelecionadas} ficam fora do envio e podem ir para uma lista`
              : ""}
            )
          </>
        )}
      </p>
      {product && (
        <p className="mb-3 text-xs text-muted-foreground">
          Produto selecionado: <strong>{NOMES[product]}</strong>. Os selos dos demais produtos
          mostram sobreposição, sem alterar este filtro.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="p-2">
                <input
                  aria-label="Selecionar contas desta página"
                  type="checkbox"
                  checked={!!visible.length && visible.every((a) => picked.has(a.key))}
                  onChange={(e) => {
                    const next = new Set(picked);
                    visible.forEach((a) =>
                      e.target.checked ? next.add(a.key) : next.delete(a.key),
                    );
                    setPicked(next);
                  }}
                />
              </th>
              <th className="p-2">Empresa</th>
              {product && <th className="p-2">Situação · {NOMES[product]}</th>}
              <th className="p-2">Faturamento · cadastro / Driva</th>
              <th className="p-2">Segmento / regime</th>
              <th className="p-2">Contato</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => {
              const e = estado(a);
              return (
                <tr key={a.key} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-2 align-top">
                    <input
                      aria-label={`Selecionar ${a.name}`}
                      type="checkbox"
                      checked={picked.has(a.key)}
                      onChange={() => toggle(a.key)}
                    />
                  </td>
                  <td className="min-w-52 p-2 align-top">
                    <button
                      className="text-left font-medium hover:text-primary hover:underline"
                      onClick={() => showAccount(a)}
                    >
                      {a.name}
                    </button>
                    <p className="my-1 text-xs text-muted-foreground">
                      {a.unit_label ? `${a.unit_label} · ` : ""}
                      <span title={a.base_origin?.reason}>{ORIGENS_BASE[origemBase(a)]}</span>
                      {a.situacao_receita && a.situacao_receita !== "ativa" && (
                        <span
                          className="ml-1 rounded bg-muted px-1 font-semibold"
                          title={a.situacao_receita_fonte ?? undefined}
                        >
                          {rotuloSituacaoReceita(a)}
                        </span>
                      )}
                      {a.base_origin?.commercial && " · fechamento comercial identificado"}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <OfertaTag account={a} product="consultoria" />
                      <OfertaTag account={a} product="finance" />
                      <OfertaTag account={a} product="cella" />
                    </div>
                  </td>
                  {e && (
                    <td className="min-w-56 p-2 align-top">
                      <SituacaoProduto estado={e} />
                    </td>
                  )}
                  <td className="min-w-40 p-2 align-top text-xs">
                    {faturamentoDeclarado(a)}
                    {tetoContradizFaixa(a) && (
                      <p className="mt-1 text-xs font-medium text-warning">
                        {tetoContradizFaixa(a)}
                      </p>
                    )}
                    {a.driva?.group_revenue_band && (
                      <p className="mt-1 font-medium">
                        {a.driva.group_revenue_band}
                        <span className="block text-xs font-normal text-muted-foreground">
                          Estimativa Driva · grupo econômico
                        </span>
                      </p>
                    )}
                    {a.band_conflict && (
                      <span className="block text-warning">Fontes divergem</span>
                    )}
                  </td>
                  <td className="min-w-36 p-2 align-top text-xs">
                    {a.segment || "Segmento a confirmar"}
                    <span className="block text-muted-foreground">
                      {a.regime ||
                        (a.base?.tax_evidence?.non_simples === true || a.driva?.non_simples === true
                          ? "Fora do Simples · regime específico não informado"
                          : "Regime a confirmar")}
                    </span>
                    {a.regime_source && (
                      <span className="block text-xs text-muted-foreground">
                        Regime: {a.regime_source}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {a.segment_source || "Sem fonte preenchida"}
                    </span>
                  </td>
                  <td className="min-w-32 p-2 align-top text-xs">
                    {a.contact ? "Com contato" : "Obter com o sócio"}
                    {!product && (
                      <p className="mt-1 text-muted-foreground">
                        Selecione o produto para ver situação e abordagem
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma conta neste filtro.
        </p>
      )}
      {rows.length > limit && (
        <Button className="mt-3" variant="outline" onClick={() => setLimit(limit + 50)}>
          Mostrar mais 50
        </Button>
      )}
    </Panel>
  );
}

// O Pipedrive devolve "AAAA-MM-DD HH:MM:SS" em UTC; sem o "Z" o navegador leria como hora local.
const quando = (v: string) =>
  date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v) ? v.replace(" ", "T") + "Z" : v);

const ROTULO_SITUACAO: Record<EstadoProduto["situacao"], string> = {
  free: "Apta · pronta para enviar",
  occupied: "Apta · já em trabalho ou reservada",
  qualificar: "A confirmar",
  review: "A confirmar",
  excluded: "Fora da regra",
};

function SituacaoProduto({ estado: e }: { estado: EstadoProduto }) {
  const perfil =
    e.perfil.status === "elegivel"
      ? {
          label: "Apta · validada",
          tone: "bg-success/15 text-success",
        }
      : e.perfil.status === "revisar"
        ? { label: "A confirmar", tone: "bg-warning/15 text-warning" }
        : { label: "Fora da regra", tone: "bg-muted text-muted-foreground" };
  const lista = e.listas[0];
  return (
    <div className="space-y-1 text-xs">
      <span
        className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${perfil.tone}`}
        title={e.perfil.reason}
      >
        {perfil.label}
      </span>
      {e.perfil.status === "elegivel" ? (
        e.livre ? (
          <p className="font-medium text-success">Pronta para enviar</p>
        ) : (
          <p className="text-muted-foreground">{e.motivoDisponibilidade}</p>
        )
      ) : (
        <p className="line-clamp-2 text-muted-foreground" title={e.perfil.reason}>
          {e.perfil.reason}
        </p>
      )}
      {e.aberto && (
        <a
          href={e.aberto.url}
          target="_blank"
          rel="noreferrer"
          className="block font-medium text-primary hover:underline"
        >
          No Pipedrive · {e.aberto.stage} · {e.aberto.owner}
        </a>
      )}
      {e.envio && !e.aberto && (
        <p className="font-medium">
          {e.envio === "incerto"
            ? "Envio incerto · conferir no Pipedrive antes de reenviar"
            : "Envio registrado · negócio ainda não sincronizado do Pipedrive"}
        </p>
      )}
      {e.encerrado && (
        <a
          href={e.encerrado.url}
          target="_blank"
          rel="noreferrer"
          className="block text-muted-foreground hover:underline"
        >
          {e.encerrado.status === "won"
            ? `Abordada antes · ganho${e.encerrado.won_on ? ` em ${quando(e.encerrado.won_on)}` : ""}`
            : `Abordada antes · perdido${e.encerrado.lost_reason ? ` · ${e.encerrado.lost_reason}` : ""}${e.encerrado.updated_at ? ` · atualizado em ${quando(e.encerrado.updated_at)}` : ""}`}
        </a>
      )}
      {e.semProduto && (
        <a
          href={e.semProduto.url}
          target="_blank"
          rel="noreferrer"
          className="block text-warning hover:underline"
        >
          Negócio sem produto no Pipedrive · {e.semProduto.stage} ·{" "}
          {e.semProduto.status === "open"
            ? "aberto"
            : e.semProduto.status === "won"
              ? "ganho"
              : "perdido"}
        </a>
      )}
      {lista && (
        <p className="text-muted-foreground">
          Em lista: {lista.lista.nome}
          {lista.validada ? " · validada pelo sócio" : ""}
          {e.listas.length > 1 ? ` +${e.listas.length - 1}` : ""}
        </p>
      )}
      {e.abordagem.includes("nunca") && (
        <p className="text-muted-foreground">Sem negócio, envio ou lista neste produto</p>
      )}
    </div>
  );
}

function Gates({ data }: { data: BaseMonetizacao }) {
  const rows = [
    [
      "Contas na base conciliada",
      data.accounts.length,
      "União das fontes reconciliadas. Não equivale automaticamente a clientes ativos pagantes.",
    ],
    [
      "Com vínculo de Matriz",
      data.accounts.filter((a) => a.matrix).length,
      "Vínculo identificado na reconciliação; não inferido pela ausência de unidade.",
    ],
    [
      "Expansão · contratos comerciais",
      data.accounts.filter((a) => a.new_commercial).length,
      "Origem comercial identificada no cadastro.",
    ],
    [
      "Expansão comercial · faixa a partir de R$ 25 mi",
      data.accounts.filter(
        (a) => a.new_commercial && (FAIXAS[a.band || ""]?.[0] ?? -1) >= 25 && !a.band_conflict,
      ).length,
      "Faixa conhecida e sem divergência; é um recorte do número anterior.",
    ],
    [
      "Base retroativa declarada",
      data.accounts.filter((a) => a.old_base).length,
      "Origem Base Antiga declarada. Outras contas das unidades exigem confirmação do sócio.",
    ],
    [
      "Com resumo ECD vinculado",
      data.accounts.filter((a) => a.ecd).length,
      "Cobertura de evidência contábil; não acrescenta clientes ao total.",
    ],
    [
      "Consultoria · base antiga sem fechamento comercial",
      data.accounts.filter(baseRetroativaConsultoria).length,
      "Origem conferida nos registros vinculados. Exclui conflitos e fechamentos comerciais identificados.",
    ],
    [
      "Consultoria · fora do Simples comprovado",
      data.accounts.filter((a) => oferta(a, "consultoria").status === "elegivel").length,
      "Base apta. Não exige contato, faturamento mínimo, Lucro Real ou segmento específico.",
    ],
    [
      "Consultoria · excluídas por Simples/MEI",
      data.accounts.filter(
        (a) =>
          baseRetroativaConsultoria(a) &&
          oferta(a, "consultoria").status === "fora_regra" &&
          !situacaoForaDeOferta(a),
      ).length,
      "Pertencem à carteira retroativa, mas o regime conhecido não atende à regra de Consultoria.",
    ],
    [
      "Consultoria · fora por situação na Receita",
      data.accounts.filter((a) => baseRetroativaConsultoria(a) && situacaoForaDeOferta(a)).length,
      "Baixadas, inaptas ou suspensas na consulta em lote. Saem das ofertas e formam a lista separada de empresas inativas; o regime delas não foi avaliado.",
    ],
    [
      "Consultoria · regime a confirmar",
      data.accounts.filter(
        (a) => baseRetroativaConsultoria(a) && oferta(a, "consultoria").status === "revisar",
      ).length,
      "Não entram na base apta até comprovar que estão fora do Simples.",
    ],
  ];
  return (
    <div className="space-y-4">
      <Panel title="De onde vem a base">
        <Notice>
          Os recortes de origem podem se sobrepor. Cada linha explica seu próprio conjunto; não some
          Matriz, comercial e retroativos como se fossem grupos exclusivos.
        </Notice>
        <table className="mt-3 w-full text-left text-sm">
          <tbody>
            {rows.map(([label, n, why]) => (
              <tr key={String(label)} className="border-b last:border-0">
                <th className="py-3 pr-4 font-medium">{label}</th>
                <td className="pr-4 text-right font-semibold tabular-nums">
                  {number(n as number)}
                </td>
                <td className="text-xs text-muted-foreground">{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Da conta à oportunidade disponível">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="py-2">Gate</th>
                {PRODUTOS.map((p) => (
                  <th key={p}>{NOMES[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                "Perfil aderente",
                "Dados a confirmar",
                "Fora do perfil",
                "Aderente, já no CRM / carga no mês",
                "Aderente e disponível",
              ].map((label, index) => (
                <tr className="border-t" key={label}>
                  <th className="py-3 font-normal">{label}</th>
                  {PRODUTOS.map((p) => {
                    const n = data.accounts.filter((a) => {
                      const s = oferta(a, p).status,
                        free = disponibilidade(a, p, data.cards, undefined, data.reservations).free;
                      return index === 0
                        ? s === "elegivel"
                        : index === 1
                          ? s === "revisar"
                          : index === 2
                            ? s === "fora_regra"
                            : index === 3
                              ? s === "elegivel" && !free
                              : s === "elegivel" && free;
                    }).length;
                    return (
                      <td key={p} className="font-semibold tabular-nums">
                        {number(n)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          A disponibilidade é por empresa + produto. Uma oportunidade de Cella não ocupa
          automaticamente Finance. Todas exigem validação antes do envio; listas salvas e reservas
          de envio são conferidas novamente no botão de enviar.
        </p>
      </Panel>
    </div>
  );
}
