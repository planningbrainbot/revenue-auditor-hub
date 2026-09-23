import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  ArrowRight,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useMonetizacao, useAtualizarMonetizacao } from "@/hooks/use-monetizacao";
import {
  contatosBase,
  estadoSincronizacaoBase,
  validarOrigemBase,
} from "@/lib/clientes-base.functions";
import { passaRefinamento, type Refinamento } from "@/lib/clientes-base";
import {
  normal,
  oferta,
  rotuloSituacaoReceita,
  situacaoForaDeOferta,
} from "@/lib/monetizacao/model";
import { NOMES, PRODUTOS, type Conta } from "@/lib/monetizacao/types";
import { downloadCsv, inputClass, LoadingState, number } from "@/components/monetizacao/common";
import { AccountDetail } from "@/components/monetizacao/account-detail";
import { Aquario } from "@/components/monetizacao/aquario";
import { ContratosClientes } from "./contratos-clientes";

const views = [
  // O cockpit abre a base: é onde se decide o que trabalhar. "Empresas" vem logo depois.
  ["monetizacao", "Cockpit da base"],
  ["empresas", "Empresas"],
  ["contatos", "Contatos"],
  ["negocios", "Negócios"],
  ["pendencias", "Validar origem"],
  ["contratos", "Contratos da rede"],
];
const originNames: Record<string, string> = {
  nova: "Base nova",
  antiga: "Base antiga",
  confirmar: "A confirmar",
};
const at = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "Sem leitura confirmada";
export function ClientesBase() {
  const query = useMonetizacao(),
    invalidate = useAtualizarMonetizacao(),
    perms = usePermissions();
  const { user } = useAuth();
  const search = useSearch({ from: "/_authenticated/clientes" }),
    navigate = useNavigate({ from: "/clientes" });
  const view = views.some(([v]) => v === search.view) ? search.view : "monetizacao";
  const change = (patch: Record<string, string>) => {
    setPage(1);
    void navigate({ search: { ...search, ...patch }, replace: true });
  };
  const [page, setPage] = useState(1),
    [detail, setDetail] = useState<Conta | null>(null),
    [validation, setValidation] = useState<Conta | null>(null);
  const healthFn = useServerFn(estadoSincronizacaoBase),
    contactsFn = useServerFn(contatosBase);
  const health = useQuery({
    queryKey: ["base-health", user?.id],
    queryFn: () => healthFn(),
    enabled: !!user,
    refetchInterval: 60000,
  });
  const contacts = useQuery({
    queryKey: ["base-contacts", user?.id],
    queryFn: () => contactsFn(),
    refetchInterval: 60000,
    enabled: view === "contatos" && perms.can("view.contatos"),
    staleTime: 30000,
  });
  const rows = useMemo(() => {
    const data = query.data;
    if (!data) return [];
    const selectedUnit = search.unidade
      ? data.units.find(
          (u) => u.key === search.unidade || normal(u.name) === normal(search.unidade),
        )
      : null;
    const unitKeys = new Set(selectedUnit?.account_keys);
    return data.accounts.filter((a) => {
      if (search.unidade && !unitKeys.has(a.key)) return false;
      if (search.origem && a.base?.origin !== search.origem) return false;
      if (
        search.q &&
        !normal([a.name, a.unit_label, ...(a.base?.cnpjs || [])].join(" ")).includes(
          normal(search.q),
        ) &&
        !(
          search.q.replace(/\D/g, "").length >= 3 &&
          a.base?.cnpjs.some((c) => c.includes(search.q.replace(/\D/g, "")))
        )
      )
        return false;
      return true;
    });
  }, [query.data, search.unidade, search.origem, search.q]);
  const counts = useMemo(
    () => ({
      raw: rows.length,
      cnpj: rows.filter((a) => passaRefinamento(a, "cnpj")).length,
      contato: rows.filter((a) => passaRefinamento(a, "contato")).length,
      ecd: rows.filter((a) => passaRefinamento(a, "ecd")).length,
    }),
    [rows],
  );
  const filtered = useMemo(
    () => rows.filter((a) => passaRefinamento(a, search.gate as Refinamento)),
    [rows, search.gate],
  );
  const visible =
    view === "pendencias"
      ? filtered.filter((a) => a.base?.needs_validation || a.base?.needs_source_correction)
      : filtered;
  const accountKeys = useMemo(() => new Set(filtered.map((a) => a.key)), [filtered]);
  if (!query.data) return <LoadingState error={query.error} retry={() => query.refetch()} />;
  const data = query.data,
    units = data.units.filter((u) => u.account_keys.length),
    pages = Math.max(1, Math.ceil(visible.length / 50)),
    currentPage = Math.min(page, pages);
  const contactsRows = (contacts.data || []).filter((c) =>
    c.accounts.some((k) => accountKeys.has(k)),
  );
  const deals = data.cards.filter(
    (d) =>
      filtered.some((a) => d.org_id !== null && a.orgs.includes(d.org_id)) ||
      (!search.unidade && !search.origem && !search.q && !search.gate && d.org_id === null),
  );
  const exportRows = () => {
    const records = visible.map((a) => ({
      Empresa: a.name,
      CNPJ: a.base?.cnpjs.join(" / ") || "",
      Unidade: a.unit_label || "A confirmar",
      Origem: originNames[a.base?.origin || "confirmar"],
      Motivo: a.base?.origin_reason || "",
      Origem_no_Pipefy: a.base?.declared_origin.join(" / ") || "",
      Omie: a.base?.omie_units.join(" / ") || "",
      Contato: a.contact ? "Sim" : "Não",
      ECD: a.base?.ecd.map((e) => e.year).join(" / ") || "",
      Proximo_passo: a.base?.needs_source_correction
        ? "Corrigir origem no Pipefy"
        : a.base?.needs_validation
          ? "Validar origem com a unidade"
          : "Cadastro conferido",
    }));
    downloadCsv("base-clientes.csv", [
      [
        "Empresa",
        "CNPJ",
        "Unidade",
        "Origem",
        "Motivo",
        "Origem no Pipefy",
        "Omie",
        "Contato",
        "ECD",
        "Próximo passo",
      ],
      ...records.map((r) => Object.values(r)),
    ]);
  };
  return (
    <main className="mx-auto max-w-[1700px] space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Building2 className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Base de clientes</h1>
            <p className="text-xs text-muted-foreground">
              Uma base · empresas, contatos, negócios e oportunidades
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => {
            void invalidate();
            void health.refetch();
            void contacts.refetch();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Atualizar
        </Button>
      </header>
      <nav aria-label="Visões da base" className="flex gap-1 overflow-x-auto border-b">
        {views.map(([key, label]) => (
          <button
            key={key}
            onClick={() => change({ view: key })}
            className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm ${view === key ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
            {key === "pendencias" && (
              <span className="ml-2 rounded bg-warning-soft px-1.5 text-xs text-warning">
                {
                  rows.filter((a) => a.base?.needs_validation || a.base?.needs_source_correction)
                    .length
                }
              </span>
            )}
          </button>
        ))}
      </nav>
      {view === "contratos" ? (
        <ContratosClientes
          statusParam={search.status}
          // A aba Empresas guarda a CHAVE da unidade na URL (`monetizacao_unidades.key`),
          // e a de contratos filtra por nome (`empresas.unidade`). Sem traduzir aqui,
          // trocar de aba com uma unidade filtrada zerava a lista inteira.
          unidadeParam={data.units.find((u) => u.key === search.unidade)?.name ?? search.unidade}
        />
      ) : (
        <>
          <section
            className="grid gap-3 rounded-xl border bg-card p-3 md:grid-cols-[2fr_1fr_1fr_auto]"
            aria-label="Filtros da base"
          >
            <label className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Buscar empresa ou CNPJ"
                className="pl-9"
                value={search.q}
                placeholder="Buscar empresa ou CNPJ"
                onChange={(e) => change({ q: e.target.value })}
              />
            </label>
            <select
              aria-label="Unidade"
              className={inputClass}
              value={search.unidade}
              onChange={(e) => change({ unidade: e.target.value })}
            >
              <option value="">Todas as unidades liberadas</option>
              {units.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Origem da base"
              className={inputClass}
              value={search.origem}
              onChange={(e) => change({ origem: e.target.value })}
            >
              <option value="">Todas as origens</option>
              {Object.entries(originNames).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              onClick={() => change({ q: "", unidade: "", origem: "", gate: "" })}
            >
              Limpar
            </Button>
          </section>
          <section
            aria-label="Funil de refinamento"
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            {[
              ["", "Bruta", counts.raw],
              ["cnpj", "Com CNPJ válido", counts.cnpj],
              ["contato", "Com contato", counts.contato],
              ["ecd", "Com ECD registrada", counts.ecd],
            ].map(([gate, label, value], index) => (
              <button
                key={String(gate)}
                onClick={() => change({ gate: String(gate) })}
                className={`relative rounded-xl border p-4 text-left transition-colors ${search.gate === gate ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"}`}
              >
                <div className="text-xs font-medium text-muted-foreground">
                  {index + 1} · {label}
                </div>
                <div className="mt-1 text-3xl font-semibold tabular-nums">
                  {number(Number(value))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {index === 0
                    ? "Contas conciliadas, sem multiplicar por contato"
                    : "Dentro do degrau anterior"}
                </p>
                {index < 3 && (
                  <ArrowRight className="absolute right-3 top-5 h-4 w-4 text-muted-foreground" />
                )}
              </button>
            ))}
          </section>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>
              Funil cumulativo. Contato e ECD medem completude; não bloqueiam Consultoria. Uma conta
              pode reunir CNPJs vinculados.
            </p>
            <button className="underline" onClick={() => change({ view: "pendencias" })}>
              {health.isError
                ? "Sincronização indisponível"
                : `${health.data?.pending_changes ?? 0} alterações na fila de envio ao Pipefy`}
            </button>
          </div>
          {view === "monetizacao" ? (
            <Aquario embedded accountKeys={accountKeys} />
          ) : view === "contatos" ? (
            <section className="overflow-hidden rounded-xl border bg-card">
              <div className="border-b p-4 text-sm font-medium">
                {contactsRows.length} pessoas vinculadas às empresas deste recorte
              </div>
              {!perms.can("view.contatos") ? (
                <p className="p-4 text-sm">Seu acesso não inclui os dados dos contatos.</p>
              ) : contacts.isPending ? (
                <p className="p-4">Carregando contatos…</p>
              ) : contacts.isError ? (
                <p className="p-4 text-destructive">
                  Não foi possível consultar os contatos. Atualize para tentar novamente.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                      <tr>
                        {["Pessoa / cargo", "E-mail", "Telefone", "Empresa"].map((h) => (
                          <th key={h} className="p-3">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contactsRows.map((c) => (
                        <tr key={c.id} className="border-t">
                          <td className="p-3">
                            {c.name}
                            <div className="text-xs text-muted-foreground">{c.role}</div>
                          </td>
                          <td className="p-3">{c.email || "—"}</td>
                          <td className="p-3">{c.phone || "—"}</td>
                          <td className="p-3">
                            {c.accounts
                              .filter((k) => accountKeys.has(k))
                              .map((k) => (
                                <button
                                  key={k}
                                  className="block text-left text-primary underline"
                                  onClick={() =>
                                    setDetail(data.accounts.find((a) => a.key === k) || null)
                                  }
                                >
                                  {data.accounts.find((a) => a.key === k)?.name}
                                </button>
                              ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : view === "negocios" ? (
            <section className="overflow-hidden rounded-xl border bg-card">
              <div className="border-b p-4 text-sm font-medium">
                {deals.length} negócios de Monetização · cada card aparece uma vez
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      {["Negócio", "Produto", "Responsável", "Etapa", "Situação"].map((h) => (
                        <th key={h} className="p-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((d) => (
                      <tr className="border-t" key={d.id}>
                        <td className="p-3">
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline"
                          >
                            {d.title}
                          </a>
                          {!d.org_id && (
                            <div className="text-xs text-warning">Sem empresa vinculada</div>
                          )}
                        </td>
                        <td className="p-3">{NOMES[d.route]}</td>
                        <td className="p-3">{d.owner}</td>
                        <td className="p-3">{d.stage}</td>
                        <td className="p-3">{d.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
                <div>
                  <h2 className="font-semibold">
                    {view === "pendencias"
                      ? "Validação da carteira por unidade"
                      : "Empresas da base"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {number(visible.length)} contas ·{" "}
                    {view === "pendencias"
                      ? "Confira a origem, registre a evidência e acompanhe a correção."
                      : "Clique na empresa para abrir fontes, contatos e oportunidades."}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={exportRows}>
                  <Download className="mr-2 h-4 w-4" />
                  Exportar recorte
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {[
                        "Empresa / CNPJ",
                        "Unidade",
                        "Origem",
                        "Contato / ECD",
                        "Situação",
                        view === "pendencias" ? "Validação" : "Produtos",
                      ].map((h) => (
                        <th className="px-4 py-3" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.slice((currentPage - 1) * 50, currentPage * 50).map((a) => (
                      <tr className="border-t hover:bg-muted/20" key={a.key}>
                        <td className="max-w-xs px-4 py-3">
                          <button
                            className="text-left font-medium hover:text-primary hover:underline"
                            onClick={() => setDetail(a)}
                          >
                            {a.name}
                          </button>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {a.base?.cnpjs.join(" · ") || "CNPJ a refinar"}
                          </p>
                        </td>
                        <td className="max-w-[180px] px-4 py-3">{a.unit_label || "A confirmar"}</td>
                        <td className="px-4 py-3">
                          <Badge variant={a.base?.origin === "confirmar" ? "outline" : "secondary"}>
                            {originNames[a.base?.origin || "confirmar"]}
                          </Badge>
                          {view === "pendencias" && (
                            <p className="mt-2 max-w-xs text-xs text-muted-foreground">
                              {a.base?.origin_reason}
                            </p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs">
                          <div>{a.contact ? "Com contato" : "Sem contato"}</div>
                          <div className="mt-1 text-muted-foreground">
                            {a.base?.ecd.length
                              ? `ECD: ${[...new Set(a.base.ecd.map((e) => e.year))].join(", ")}`
                              : "ECD não vinculada"}
                          </div>
                        </td>
                        <td className="max-w-[190px] px-4 py-3 text-xs">
                          {a.base?.needs_source_correction ? (
                            <span className="text-warning">Origem a corrigir no Pipefy</span>
                          ) : a.base?.source_status === "ok" ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <CheckCircle2 className="h-3 w-3" />
                              Pipefy conferido
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <AlertCircle className="h-3 w-3" />
                              {a.base?.source_status === "absent"
                                ? "Ausente no Pipefy"
                                : a.base?.source_status === "not_linked"
                                  ? "Sem vínculo Pipefy"
                                  : a.base?.synced_at
                                    ? "Cadastro com divergências"
                                    : "Leitura pendente"}
                            </span>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {a.base?.synced_at
                              ? at(a.base.synced_at)
                              : `${a.base?.omie_records || 0} registros Omie`}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          {view === "pendencias" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!data.permissions.manage}
                              onClick={() => setValidation(a)}
                            >
                              Validar origem
                            </Button>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {PRODUTOS.filter((p) => oferta(a, p).status === "elegivel").map(
                                (p) => (
                                  <Badge key={p} variant="outline">
                                    {NOMES[p]}
                                  </Badge>
                                ),
                              )}
                              {!PRODUTOS.some((p) => oferta(a, p).status === "elegivel") &&
                                (situacaoForaDeOferta(a) ? (
                                  // Empresa fechada não é falta de dado: dizer "a qualificar" manda
                                  // o operador atrás de informação de um CNPJ que não existe mais.
                                  <span
                                    className="text-xs font-medium text-muted-foreground"
                                    title={a.situacao_receita_fonte ?? undefined}
                                  >
                                    Fora das ofertas · {rotuloSituacaoReceita(a)}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    A qualificar
                                  </span>
                                ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.length && (
                  <p className="p-8 text-center text-sm text-muted-foreground">
                    Nenhuma empresa neste recorte. Limpe os filtros para revisar a base.
                  </p>
                )}
              </div>
              <footer className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                <span>
                  Página {currentPage} de {pages} · 50 por página
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === pages}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Próxima
                  </Button>
                </div>
              </footer>
            </section>
          )}
          <details className="rounded-lg border bg-card px-4 py-3 text-xs">
            <summary className="cursor-pointer font-medium">Atualização das fontes</summary>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {(health.data?.sources || []).map((s: any) => (
                <div key={s.fonte} className="rounded border p-3">
                  <strong>{s.fonte}</strong>
                  <p className="mt-1">
                    {s.status} · {at(s.fim || s.inicio)} · {s.gravados}/{s.recebidos} registros
                  </p>
                  {s.erro && <p className="mt-1 text-destructive">{s.erro}</p>}
                </div>
              ))}
              {!health.data?.sources?.length && (
                <p>Ainda não há reconciliação concluída registrada.</p>
              )}
            </div>
          </details>
        </>
      )}
      <AccountDetail account={detail} cards={data.cards} close={() => setDetail(null)} />
      <ValidarOrigem
        account={validation}
        close={() => setValidation(null)}
        done={() => {
          setValidation(null);
          void invalidate();
          void health.refetch();
        }}
      />
    </main>
  );
}
function ValidarOrigem({
  account,
  close,
  done,
}: {
  account: Conta | null;
  close: () => void;
  done: () => void;
}) {
  const fn = useServerFn(validarOrigemBase),
    [origin, setOrigin] = useState<"antiga" | "nova" | "">(""),
    [responsible, setResponsible] = useState(""),
    [evidence, setEvidence] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    setOrigin("");
    setResponsible("");
    setEvidence("");
  }, [account?.key]);
  const submit = async () => {
    if (!account || !origin) return;
    setSaving(true);
    try {
      const r = await fn({ data: { key: account.key, origin, responsible, evidence } });
      toast.success(
        r.status === "pending_source"
          ? "Validação registrada; correção do Pipefy na fila."
          : "Origem confirmada.",
      );
      setResponsible("");
      setEvidence("");
      done();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Validar origem da carteira</DialogTitle>
          <DialogDescription>
            {account?.name} · {account?.unit_label || "Unidade a confirmar"}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">{account?.base?.origin_reason}</p>
        <label className="space-y-1 text-xs">
          Origem confirmada
          <select
            className={inputClass}
            value={origin}
            onChange={(e) => setOrigin(e.target.value as "antiga" | "nova")}
          >
            <option value="">Selecione a origem confirmada</option>
            <option value="antiga">Base antiga</option>
            <option value="nova">Base nova</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          Responsável da unidade
          <Input
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
            placeholder="Quem confirmou a origem"
          />
        </label>
        <label className="space-y-1 text-xs">
          Evidência da confirmação
          <textarea
            className={`${inputClass} min-h-24`}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Como e quando a unidade confirmou esta carteira"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          O registro guarda seu usuário e a data. Se houver correção no Pipefy, o espelho muda após
          a confirmação da origem.
        </p>
        <Button
          disabled={
            saving || !origin || responsible.trim().length < 3 || evidence.trim().length < 10
          }
          onClick={submit}
        >
          {saving ? "Registrando…" : "Registrar validação"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
