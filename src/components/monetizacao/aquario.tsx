import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Download, Fish, ListPlus, Search, Send, Users } from "lucide-react";
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
  oferta,
} from "@/lib/monetizacao/model";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, Conta, Produto, Unidade } from "@/lib/monetizacao/types";
import { AccountDetail } from "./account-detail";
import { ReconAquario } from "./recon";
import { ofertaRecon, potencialRecon } from "@/lib/monetizacao/recon";
import { ListWorkspace } from "./list-workspace";
import { DirectSend } from "./direct-send";
import {
  EMPTY_PORTFOLIO_FILTERS,
  filtrarCarteira,
  ORIGENS_BASE,
  origemBase,
  potencialConsultoria,
  situacaoInicialProduto,
} from "@/lib/monetizacao/portfolio";
import type { PortfolioFilters } from "@/lib/monetizacao/portfolio";
import {
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

type Filters = PortfolioFilters;
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
    consultExcluded = consultBase.filter((a) => oferta(a, "consultoria").status === "fora_regra"),
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Fish className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Oportunidades da base</h1>
            <p className="text-xs text-muted-foreground">
              Base de clientes · carteiras e listas para os sócios
            </p>
          </div>
        </div>
        <Freshness data={data} refreshing={refreshing} onRefresh={refresh} />
      </div>
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
          hint={`${consult.length} aptas · ${consultExcluded.length} fora da regra · ${consultPending.length} a confirmar`}
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
                  setFilters({ ...emptyFilters, product: p, status: situacaoInicialProduto(p) });
                  setPicked(new Set());
                  setTab("contas");
                }}
                className={`rounded-lg border p-4 text-left hover:border-primary ${tab === "contas" && filters.product === p ? "border-primary bg-primary/5" : ""}`}
              >
                <span className="flex items-center justify-between font-semibold">
                  {NOMES[p]} <ArrowRight className="h-4 w-4" />
                </span>
                <p className="mt-2 text-sm">
                  {p === "consultoria"
                    ? `${consultPool.length} contas retroativas para análise`
                    : `${eligible.length} aderentes · ${free.length} disponíveis`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p === "consultoria"
                    ? "Base Antiga · sem fechamento comercial identificado · contato opcional"
                    : p === "cella"
                      ? "Faturamento a partir de R$ 25 mi · fora do Simples"
                      : "Contrato ganho no Pipedrive · abaixo de R$ 25 mi · fora do Simples"}
                </p>
                {p === "consultoria" && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    {consultPending.length > 0
                      ? `${consultPending.length} com regime a confirmar. ${eligible.length ? `${eligible.length} aptas confirmadas · ${free.length} disponíveis.` : "Aptidão ainda não apurada."}`
                      : `${eligible.length} aptas confirmadas · ${free.length} disponíveis`}
                    {consultExcluded.length > 0 &&
                      ` ${consultExcluded.length} retroativas excluídas por Simples/MEI.`}
                  </p>
                )}
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
              origin: "antiga",
              status: "review",
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
                  f = accounts.filter((a) => oferta(a, "finance").status === "elegivel").length;
                return (
                  <button
                    key={u.key}
                    onClick={() => {
                      setUnit(u);
                      setFilters(emptyFilters);
                      setPicked(new Set());
                    }}
                    className="group rounded-lg border p-4 text-left transition hover:border-primary hover:bg-primary/5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{u.name}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                    </div>
                    <p className="my-3 text-2xl font-semibold tabular-nums">
                      {number(accounts.length)}{" "}
                      <span className="text-xs font-normal text-muted-foreground">contas</span>
                    </p>
                    <div className="flex flex-wrap gap-3 text-xs">
                      <span className="text-primary">
                        Consultoria · {c} aptas
                        {pending > 0 ? ` · ${pending} com regime a confirmar` : ""}
                      </span>
                      <span>
                        Cella{" "}
                        {accounts.filter((a) => oferta(a, "cella").status === "elegivel").length}
                      </span>
                      <span>Finance {f}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {accounts.filter((a) => origemBase(a) === "antiga").length} antigas ·{" "}
                      {accounts.filter((a) => origemBase(a) === "nova").length} novas ·{" "}
                      {
                        accounts.filter((a) => ["confirmar", "divergente"].includes(origemBase(a)))
                          .length
                      }{" "}
                      a conferir
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {accounts.filter((a) => a.contact).length} com contato ·{" "}
                      {accounts.filter((a) => !a.band).length} sem faturamento declarado
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
        <TabsContent value="listas">
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
        <SheetContent className="w-full overflow-y-auto sm:max-w-[min(1180px,95vw)]">
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
                    setFilters({ ...emptyFilters, origin: key as Filters["origin"] });
                    setPicked(new Set());
                  }}
                />
              ))}
            </div>
            {content(unitAccounts, true)}
          </div>
        </SheetContent>
      </Sheet>
      <AccountDetail account={account} cards={data.cards} close={() => setAccount(null)} />
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
  const [sending, setSending] = useState(false);
  const change = (key: keyof Filters, value: string | boolean) => {
    setFilters({
      ...filters,
      [key]: value,
      ...(key === "product" ? { status: situacaoInicialProduto(value as Produto | "") } : {}),
    });
    setPicked(new Set());
    setLimit(50);
  };
  const rows = useMemo(() => filtrarCarteira(accounts, filters, data), [accounts, filters, data]);
  const visible = rows.slice(0, limit),
    selected = rows.filter((a) => picked.has(a.key));
  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  return (
    <Panel
      title={
        inUnit
          ? "Carteira da unidade"
          : filters.product
            ? `Lista potencial · ${NOMES[filters.product]}`
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
                  "Faturamento anual",
                  "Faixa de faturamento estimado do grupo · Driva",
                  "Driva · consultado em",
                  "Segmento",
                  "Regime",
                  "Contato",
                  "Consultoria",
                  "Finance",
                  "Cella",
                ],
                ...rows.map((a) => [
                  a.name,
                  a.unit_label,
                  ORIGENS_BASE[origemBase(a)],
                  a.base_origin?.reason,
                  a.band,
                  a.driva?.group_revenue_band,
                  a.driva?.queried_at,
                  a.segment,
                  a.regime,
                  a.contact ? "Sim" : "Obter com o sócio",
                  oferta(a, "consultoria").reason,
                  oferta(a, "finance").reason,
                  oferta(a, "cella").reason,
                ]),
              ])
            }
          >
            <Download className="mr-1 h-3 w-3" />
            Exportar filtro
          </Button>
          <Button
            size="sm"
            disabled={!data.permissions.manage || !selected.length}
            onClick={() => onList(selected.map((a) => a.key))}
          >
            <ListPlus className="mr-1 h-4 w-4" />
            Preparar lista ({selected.length})
          </Button>
          <Button
            size="sm"
            disabled={!data.permissions.send || !selected.length}
            onClick={() => setSending(true)}
          >
            <Send className="mr-1 h-4 w-4" />
            Enviar ao Pipedrive ({selected.length})
          </Button>
        </div>
      }
    >
      {sending && (
        <DirectSend
          data={data}
          accounts={selected}
          initialProduct={filters.product}
          unitId={unitId ?? data.units.find((u) => u.key === filters.unit)?.id ?? null}
          close={() => setSending(false)}
          done={() => {
            setSending(false);
            setPicked(new Set());
          }}
        />
      )}
      <div className="mb-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {!inUnit && (
          <Field label="Unidade">
            <select
              className={inputClass}
              value={filters.unit}
              onChange={(e) => change("unit", e.target.value)}
            >
              <option value="">Todas as unidades</option>
              {data.units.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Origem da base">
          <select
            className={inputClass}
            value={filters.origin}
            onChange={(e) => change("origin", e.target.value)}
          >
            <option value="">Antigas, novas e pendentes</option>
            {Object.entries(ORIGENS_BASE).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
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
        <Field label="Faturamento anual · cadastro">
          <select
            className={inputClass}
            value={filters.band}
            onChange={(e) => change("band", e.target.value)}
          >
            <option value="">Todas as faixas</option>
            <option value="10">A partir de R$ 10 mi</option>
            <option value="25">A partir de R$ 25 mi</option>
            <option value="50">A partir de R$ 50 mi</option>
            <option value="unknown">Não informado</option>
            <optgroup label="Faixa cadastrada">
              {[...new Set(accounts.map((a) => a.band).filter(Boolean))].sort().map((band) => (
                <option key={band} value={`exact:${band}`}>
                  {band}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        {accounts.some((a) => a.driva?.group_revenue_band) && (
          <Field label="Faturamento estimado · grupo Driva">
            <select
              className={inputClass}
              value={filters.drivaBand}
              onChange={(e) => change("drivaBand", e.target.value)}
            >
              <option value="">Todas as estimativas</option>
              {[...new Set(accounts.map((a) => a.driva?.group_revenue_band).filter(Boolean))]
                .sort()
                .map((band) => (
                  <option key={band} value={band!}>
                    {band}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="Segmento">
          <select
            className={inputClass}
            value={filters.segment}
            onChange={(e) => change("segment", e.target.value)}
          >
            <option value="">Todos</option>
            <option value="unknown">Não informado</option>
            {[...new Set(accounts.map((a) => a.segment).filter(Boolean))].sort().map((s) => (
              <option key={s} value={s!}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Regime tributário">
          <select
            className={inputClass}
            value={filters.regime}
            onChange={(e) => change("regime", e.target.value)}
          >
            <option value="">Todos os regimes</option>
            <option value="unknown">Não informado</option>
            {[...new Set(accounts.map((a) => a.regime).filter(Boolean))].sort().map((regime) => (
              <option key={regime} value={regime!}>
                {regime}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Contato · filtro opcional">
          <select
            className={inputClass}
            value={filters.contact}
            onChange={(e) => change("contact", e.target.value)}
          >
            <option value="">Com e sem contato</option>
            <option value="true">Com contato</option>
            <option value="false">Obter com o sócio</option>
          </select>
        </Field>
        <Field label="Produto da lista">
          <select
            className={inputClass}
            value={filters.product}
            onChange={(e) => change("product", e.target.value)}
          >
            <option value="">Todos os produtos</option>
            {PRODUTOS.map((p) => (
              <option key={p} value={p}>
                {NOMES[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Situação">
          <select
            className={inputClass}
            value={filters.status}
            disabled={!filters.product}
            onChange={(e) => change("status", e.target.value)}
          >
            {!filters.product && <option value="">Selecione um produto</option>}
            {filters.product === "consultoria" && (
              <option value="potential">Base retroativa · aptas e regime a confirmar</option>
            )}
            <option value="eligible">Perfil aderente</option>
            <option value="review">Dados a confirmar</option>
            <option value="free">Aderentes e disponíveis para o produto</option>
            <option value="occupied">Aderentes já trabalhadas / reservadas</option>
            <option value="excluded">Fora da regra do produto</option>
          </select>
        </Field>
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
            setFilters(emptyFilters);
            setPicked(new Set());
          }}
        >
          Limpar filtros
        </Button>
      </div>
      {filters.product === "consultoria" && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
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
        {number(rows.length)} de {number(accounts.length)} contas · maior faturamento primeiro ·{" "}
        {selected.length} selecionadas
      </p>
      {filters.product && (
        <p className="mb-3 text-xs text-muted-foreground">
          Produto selecionado: <strong>{NOMES[filters.product]}</strong>. Os selos dos demais
          produtos mostram sobreposição, sem alterar este filtro.
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
              <th className="p-2">Faturamento · cadastro / Driva</th>
              <th className="p-2">Segmento / regime</th>
              <th className="p-2">Contato / CRM</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.key} className="border-b last:border-0 hover:bg-muted/30">
                <td className="p-2 align-top">
                  <input
                    aria-label={`Selecionar ${a.name}`}
                    type="checkbox"
                    checked={picked.has(a.key)}
                    onChange={() => toggle(a.key)}
                  />
                </td>
                <td className="min-w-52 p-2">
                  <button
                    className="text-left font-medium hover:text-primary hover:underline"
                    onClick={() => showAccount(a)}
                  >
                    {a.name}
                  </button>
                  <p className="my-1 text-[11px] text-muted-foreground">
                    <span title={a.base_origin?.reason}>{ORIGENS_BASE[origemBase(a)]}</span>
                    {a.base_origin?.commercial && " · fechamento comercial identificado"}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <OfertaTag account={a} product="consultoria" />
                    <OfertaTag account={a} product="finance" />
                    <OfertaTag account={a} product="cella" />
                  </div>
                </td>
                <td className="min-w-40 p-2 text-xs">
                  {a.band || "Declarado não informado"}
                  {a.driva?.group_revenue_band && (
                    <p className="mt-1 font-medium">
                      {a.driva.group_revenue_band}
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        Estimativa Driva · grupo econômico
                      </span>
                    </p>
                  )}
                  {a.band_conflict && <span className="block text-amber-600">Fontes divergem</span>}
                </td>
                <td className="min-w-36 p-2 text-xs">
                  {a.segment || "Segmento a confirmar"}
                  <span className="block text-muted-foreground">
                    {a.regime ||
                      (a.driva?.non_simples === true
                        ? "Fora do Simples · regime específico não informado"
                        : "Regime a confirmar")}
                  </span>
                  {a.regime_source && (
                    <span className="block text-[10px] text-muted-foreground">
                      Regime: {a.regime_source}
                    </span>
                  )}
                  <span className="block text-[10px] text-muted-foreground">
                    {a.segment_source || "Sem fonte preenchida"}
                  </span>
                </td>
                <td className="min-w-36 p-2 text-xs">
                  {a.contact ? "Com contato" : "Obter com o sócio"}
                  <p className="mt-1 text-muted-foreground">
                    {filters.product
                      ? disponibilidade(
                          a,
                          filters.product,
                          data.cards,
                          undefined,
                          data.reservations,
                        ).reason
                      : "Selecione o produto para ver disponibilidade"}
                  </p>
                </td>
              </tr>
            ))}
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
        (a) => baseRetroativaConsultoria(a) && oferta(a, "consultoria").status === "fora_regra",
      ).length,
      "Pertencem à carteira retroativa, mas o regime conhecido não atende à regra de Consultoria.",
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
