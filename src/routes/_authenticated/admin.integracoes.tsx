import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  deleteOmieCredential,
  listOmieCredentials,
  setOmieCredentialAtivo,
  upsertOmieCredential,
} from "@/lib/omie-credentials.functions";
import { listIntegracoesStatus, type IntegracaoStatus } from "@/lib/integracoes-status.functions";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/integracoes")({
  ssr: false,
  head: () => ({ meta: [{ title: "Integrações – Planning Brain" }] }),
  beforeLoad: async ({ context }) => {
    const user = (context as { user?: { id: string } }).user;
    if (!user) throw redirect({ to: "/auth" });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: "/" });
  },
  component: IntegracoesPage,
});

function IntegracoesPage() {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = usePermissions();
  const qc = useQueryClient();

  const listFn = useServerFn(listOmieCredentials);
  const upsertFn = useServerFn(upsertOmieCredential);
  const toggleFn = useServerFn(setOmieCredentialAtivo);
  const deleteFn = useServerFn(deleteOmieCredential);
  const statusFn = useServerFn(listIntegracoesStatus);

  useEffect(() => {
    if (!roleLoading && !isAdmin) navigate({ to: "/" });
  }, [roleLoading, isAdmin, navigate]);

  const credsQuery = useQuery({
    queryKey: ["omie-credentials"],
    queryFn: () => listFn(),
    enabled: isAdmin,
  });

  const statusQuery = useQuery({
    queryKey: ["integracoes-status"],
    queryFn: () => statusFn(),
    enabled: isAdmin,
    refetchInterval: 60_000,
  });

  const [showForm, setShowForm] = useState(false);
  const [unidade, setUnidade] = useState("");
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setUnidade("");
    setAppKey("");
    setAppSecret("");
    setShowForm(false);
    setError(null);
  }

  const upsertMut = useMutation({
    mutationFn: (input: { unidade: string; app_key: string; app_secret: string; ativo: boolean }) => upsertFn({ data: input }),
    onSuccess: () => {
      resetForm();
      qc.invalidateQueries({ queryKey: ["omie-credentials"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Erro ao salvar credencial"),
  });

  const toggleMut = useMutation({
    mutationFn: (input: { id: string; ativo: boolean }) => toggleFn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["omie-credentials"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["omie-credentials"] }),
  });

  if (roleLoading) return <div className="p-8 text-muted-foreground">Carregando...</div>;
  if (!isAdmin) return null;

  function statusIntegracao(i: IntegracaoStatus): { label: string; cls: string } {
    if (i.ultimo_status === "erro") return { label: "Erro", cls: "bg-destructive/10 text-destructive" };
    if (i.tipo === "cron" && i.atrasada) return { label: "Atrasada", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" };
    if (!i.ultima_execucao) return { label: "Sem execução ainda", cls: "bg-muted text-muted-foreground" };
    return { label: "OK", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" };
  }

  function formatUltimaExecucao(i: IntegracaoStatus): string {
    if (!i.ultima_execucao) return "nunca rodou";
    const data = new Date(i.ultima_execucao).toLocaleString("pt-BR");
    const min = i.minutos_desde_ultima_execucao;
    if (min == null) return data;
    if (min < 60) return `${data} (há ${Math.round(min)}min)`;
    if (min < 60 * 24) return `${data} (há ${Math.round(min / 60)}h)`;
    return `${data} (há ${Math.round(min / 60 / 24)}d)`;
  }

  return (
    <AppShell title="Integrações" subtitle="Credenciais de APIs externas por unidade (ex: Omie)">
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">

        <div className="rounded-lg border border-border bg-accent/30 px-4 py-2 text-xs text-muted-foreground">
          As credenciais ficam no Supabase e nunca são expostas ao navegador — apenas os scripts de sync no servidor têm acesso a elas.
          O APP_SECRET não é reexibido depois de salvo; para trocar, cadastre a unidade novamente.
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            Status dos syncs ({statusQuery.data?.length ?? 0})
          </h2>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="min-w-full text-sm">
              <thead className="bg-accent/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Integração</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Última execução</th>
                  <th className="px-4 py-2">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {statusQuery.isLoading && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Carregando...</td></tr>
                )}
                {statusQuery.data?.map((i) => {
                  const st = statusIntegracao(i);
                  return (
                    <tr key={i.fonte} className="border-t align-top">
                      <td className="px-4 py-2 font-medium text-foreground">
                        {i.nome_exibicao}
                        {i.observacao && (
                          <div className="mt-0.5 text-xs font-normal text-muted-foreground">{i.observacao}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {i.tipo === "cron" ? `cron (${i.intervalo_esperado_minutos}min)` : "webhook"}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {formatUltimaExecucao(i)}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground max-w-md">
                        {i.ultimo_status === "erro" && i.ultimo_detalhes
                          ? <span className="text-destructive">{JSON.stringify(i.ultimo_detalhes).slice(0, 200)}</span>
                          : i.ultimo_total_registros != null
                            ? `${i.ultimo_total_registros} registros`
                            : "—"}
                      </td>
                    </tr>
                  );
                })}
                {statusQuery.data && statusQuery.data.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Nenhuma integração configurada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Credenciais Omie ({credsQuery.data?.length ?? 0})</h2>
          <button
            onClick={() => { setShowForm((s) => !s); setError(null); }}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {showForm ? "Cancelar" : "Nova unidade"}
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              upsertMut.mutate({ unidade, app_key: appKey, app_secret: appSecret, ativo: true });
            }}
            className="rounded-xl border bg-card p-4 grid gap-3 sm:grid-cols-4"
          >
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-foreground">Unidade</label>
              <input required value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="Ex: Curitiba" className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-foreground">APP_KEY</label>
              <input required value={appKey} onChange={(e) => setAppKey(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-foreground">APP_SECRET</label>
              <input required type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono" />
            </div>
            <div className="sm:col-span-4 flex justify-end">
              <button type="submit" disabled={upsertMut.isPending} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {upsertMut.isPending ? "Salvando..." : "Salvar credencial"}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-accent/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Unidade</th>
                <th className="px-4 py-2">APP_KEY</th>
                <th className="px-4 py-2">APP_SECRET</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Atualizado em</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {credsQuery.isLoading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Carregando...</td></tr>
              )}
              {credsQuery.data?.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2 font-medium text-foreground">{c.unidade}</td>
                  <td className="px-4 py-2 font-mono text-xs text-foreground">{c.app_key}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{c.app_secret_masked}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => toggleMut.mutate({ id: c.id, ativo: !c.ativo })}
                      disabled={toggleMut.isPending}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        c.ativo
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {c.ativo ? "Ativa" : "Inativa"}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {c.updated_at ? new Date(c.updated_at).toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => { if (confirm(`Excluir credencial de ${c.unidade}?`)) deleteMut.mutate(c.id); }}
                      disabled={deleteMut.isPending}
                      className="rounded-full border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
              {credsQuery.data && credsQuery.data.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Nenhuma credencial cadastrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
