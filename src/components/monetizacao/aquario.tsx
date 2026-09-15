import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Download, Fish, ListPlus, Search, Users } from "lucide-react";
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
import { disponibilidade, FAIXAS, normal, oferta } from "@/lib/monetizacao/model";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, Conta, Produto, Unidade } from "@/lib/monetizacao/types";
import { AccountDetail } from "./account-detail";
import { ListWorkspace } from "./list-workspace";
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

type Filters = {
  query: string;
  band: string;
  segment: string;
  contact: string;
  product: Produto | "";
  status: string;
  overlap: boolean;
};
const emptyFilters: Filters = {
  query: "",
  band: "",
  segment: "",
  contact: "",
  product: "",
  status: "",
  overlap: false,
};
export function Aquario() {
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
  if (!q.data) return <LoadingState error={q.error} retry={() => q.refetch()} />;
  const data = q.data;
  const unitAccounts = unit
    ? data.accounts.filter((a) => unit.account_keys.includes(a.key))
    : data.accounts;
  const refresh = async () => {
    setRefreshing(true);
    try {
      if (data.permissions.manage) await sync({ data: { action: "sync" } });
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
  const consult = data.accounts.filter((a) => oferta(a, "consultoria").status === "elegivel"),
    finance = data.accounts.filter((a) => oferta(a, "finance").status === "elegivel");
  const overlap = consult.filter((a) => finance.some((f) => f.key === a.key));
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
    />
  );
  return (
    <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Fish className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Aquário</h1>
            <p className="text-xs text-muted-foreground">
              Clientes · carteiras e listas para os sócios
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
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          label="Contas na base conciliada"
          value={number(data.accounts.length)}
          hint="Uma conta, mesmo com mais de um produto"
        />
        <Kpi
          label="Consultoria · perfil aderente"
          value={number(consult.length)}
          hint="Prioridade das unidades · ainda exige validação"
          accent
        />
        <Kpi
          label="Finance · perfil aderente"
          value={number(finance.length)}
          hint="Contrato Pipedrive · abaixo de R$ 25 mi · fora do Simples"
        />
        <Kpi
          label="Aderentes aos dois produtos"
          value={number(overlap.length)}
          hint="Já incluídas nos dois números ao lado"
        />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="carteiras">Carteiras por unidade</TabsTrigger>
            <TabsTrigger value="contas">Todas as contas</TabsTrigger>
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
                const accounts = data.accounts.filter((a) => u.account_keys.includes(a.key)),
                  c = accounts.filter((a) => oferta(a, "consultoria").status === "elegivel").length,
                  f = accounts.filter((a) => oferta(a, "finance").status === "elegivel").length;
                return (
                  <button
                    key={u.key}
                    onClick={() => {
                      setUnit(u);
                      setFilters({ ...emptyFilters, product: "consultoria" });
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
                    <div className="flex gap-3 text-xs">
                      <span className="text-primary">Consultoria {c}</span>
                      <span>Finance {f}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {accounts.filter((a) => a.contact).length} com contato ·{" "}
                      {accounts.filter((a) => !a.band).length} sem faturamento
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
              {unitAccounts.length} contas · Consultoria primeiro; Finance aparece como oportunidade
              adicional quando atende à regra.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-5">{content(unitAccounts, true)}</div>
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
}) {
  const [limit, setLimit] = useState(50);
  const change = (key: keyof Filters, value: string | boolean) => {
    setFilters({ ...filters, [key]: value });
    setLimit(50);
  };
  const rows = useMemo(
    () =>
      accounts
        .filter((a) => {
          if (
            filters.query &&
            !normal([a.name, a.segment, a.unit_label].join(" ")).includes(normal(filters.query))
          )
            return false;
          if (filters.band === "unknown" && a.band) return false;
          if (
            filters.band &&
            filters.band !== "unknown" &&
            (FAIXAS[a.band || ""]?.[0] ?? -1) < Number(filters.band)
          )
            return false;
          if (filters.segment && a.segment !== filters.segment) return false;
          if (filters.contact && String(a.contact) !== filters.contact) return false;
          if (
            filters.overlap &&
            !(["consultoria", "finance"] as Produto[]).every(
              (p) => oferta(a, p).status === "elegivel",
            )
          )
            return false;
          if (
            filters.product &&
            filters.status === "eligible" &&
            oferta(a, filters.product).status !== "elegivel"
          )
            return false;
          if (
            filters.product &&
            filters.status === "free" &&
            (oferta(a, filters.product).status !== "elegivel" ||
              !disponibilidade(a, filters.product, data.cards).free)
          )
            return false;
          return true;
        })
        .sort(
          (a, b) =>
            (FAIXAS[b.band || ""]?.[0] ?? -1) - (FAIXAS[a.band || ""]?.[0] ?? -1) ||
            a.name.localeCompare(b.name, "pt-BR"),
        ),
    [accounts, filters, data.cards],
  );
  const visible = rows.slice(0, limit),
    selected = accounts.filter((a) => picked.has(a.key));
  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  return (
    <Panel
      title={inUnit ? "Carteira da unidade" : "Carteira conciliada"}
      action={
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCsv("aquario.csv", [
                [
                  "Empresa",
                  "Unidade",
                  "Faturamento anual",
                  "Segmento",
                  "Regime",
                  "Contato",
                  "Consultoria",
                  "Finance",
                ],
                ...rows.map((a) => [
                  a.name,
                  a.unit_label,
                  a.band,
                  a.segment,
                  a.regime,
                  a.contact ? "Sim" : "Obter com o sócio",
                  oferta(a, "consultoria").reason,
                  oferta(a, "finance").reason,
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
        </div>
      }
    >
      <div className="mb-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
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
        <Field label="Faturamento anual">
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
          </select>
        </Field>
        <Field label="Segmento">
          <select
            className={inputClass}
            value={filters.segment}
            onChange={(e) => change("segment", e.target.value)}
          >
            <option value="">Todos</option>
            {[...new Set(accounts.map((a) => a.segment).filter(Boolean))].sort().map((s) => (
              <option key={s} value={s!}>
                {s}
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
            <option value="">Todos · Consultoria primeiro</option>
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
            <option value="">Todas as contas</option>
            <option value="eligible">Perfil aderente</option>
            <option value="free">Aderentes e disponíveis para o produto</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-xs">
          <input
            type="checkbox"
            checked={filters.overlap}
            onChange={(e) => change("overlap", e.target.checked)}
          />
          Aderentes a Consultoria e Finance
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
      <p className="mb-2 text-xs text-muted-foreground">
        {number(rows.length)} contas no filtro · maior faturamento primeiro · {picked.size}{" "}
        selecionadas
      </p>
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
              <th className="p-2">Faturamento anual</th>
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
                    {a.old_base
                      ? "Base antiga declarada"
                      : a.new_commercial
                        ? "Contrato comercial"
                        : "Origem retroativa a confirmar"}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <OfertaTag account={a} product="consultoria" />
                    <OfertaTag account={a} product="finance" />
                    {filters.product === "cella" && <OfertaTag account={a} product="cella" />}
                  </div>
                </td>
                <td className="min-w-40 p-2 text-xs">
                  {a.band || "A confirmar com o sócio"}
                  {a.band_conflict && <span className="block text-amber-600">Fontes divergem</span>}
                </td>
                <td className="min-w-36 p-2 text-xs">
                  {a.segment || "Segmento a confirmar"}
                  <span className="block text-muted-foreground">
                    {a.regime || "Regime a confirmar"}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {a.segment_source || "Sem fonte preenchida"}
                  </span>
                </td>
                <td className="min-w-36 p-2 text-xs">
                  {a.contact ? "Com contato" : "Obter com o sócio"}
                  <p className="mt-1 text-muted-foreground">
                    {filters.product
                      ? disponibilidade(a, filters.product, data.cards).reason
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
                        free = disponibilidade(a, p, data.cards).free;
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
