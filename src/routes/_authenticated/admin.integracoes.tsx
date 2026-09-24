import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
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
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
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
  const [excluirAlvo, setExcluirAlvo] = useState<{ id: string; unidade: string; ativo: boolean } | null>(null);

  function resetForm() {
    setUnidade("");
    setAppKey("");
    setAppSecret("");
    setShowForm(false);
    setError(null);
  }

  const upsertMut = useMutation({
    mutationFn: (input: { unidade: string; app_key: string; app_secret: string; ativo: boolean }) => upsertFn({ data: input }),
    onSuccess: (_r, input) => {
      toast.success(`Credencial Omie de ${input.unidade} salva. Entra nos syncs a partir da próxima rodada.`);
      resetForm();
      qc.invalidateQueries({ queryKey: ["omie-credentials"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro ao salvar credencial";
      setError(msg);
      toast.error(msg);
    },
  });

  // Os syncs do Omie só leem credencial com `ativo = true`: desativar tira a
  // unidade da próxima rodada, reativar devolve. É reversível, então não confirma.
  const toggleMut = useMutation({
    mutationFn: (input: { id: string; ativo: boolean; unidade: string }) =>
      toggleFn({ data: { id: input.id, ativo: input.ativo } }),
    onSuccess: (_r, input) => {
      toast.success(
        input.ativo
          ? `${input.unidade} ativada. Volta aos syncs do Omie na próxima rodada.`
          : `${input.unidade} desativada. Sai dos syncs do Omie a partir da próxima rodada; o sync da base de clientes registra erro para ela a cada rodada até ser reativada.`,
      );
      qc.invalidateQueries({ queryKey: ["omie-credentials"] });
    },
    onError: (e, input) =>
      toast.error(
        `Não foi possível ${input.ativo ? "ativar" : "desativar"} ${input.unidade}: ${
          e instanceof Error ? e.message : "erro desconhecido"
        }`,
      ),
  });

  const deleteMut = useMutation({
    mutationFn: (alvo: { id: string; unidade: string }) => deleteFn({ data: { id: alvo.id } }),
    onSuccess: (_r, alvo) => {
      toast.success(
        `Credencial de ${alvo.unidade} excluída. O sync da base de clientes registra erro para ela a cada rodada até uma credencial nova ser cadastrada.`,
      );
      setExcluirAlvo(null);
      qc.invalidateQueries({ queryKey: ["omie-credentials"] });
    },
    onError: (e, alvo) =>
      toast.error(
        `Não foi possível excluir a credencial de ${alvo.unidade}: ${
          e instanceof Error ? e.message : "erro desconhecido"
        }`,
      ),
  });

  const titulo = "Integrações";
  const pergunta = "Quais integrações estão ativas, e quando rodaram?";

  if (roleLoading)
    return (
      <div className="p-4 md:p-6">
        <Carregando variante="pagina" />
      </div>
    );
  if (!isAdmin)
    return (
      <AppShell title={titulo} pergunta={pergunta}>
        <div className="mx-auto max-w-7xl px-4 py-6">
          <EstadoSemAcesso oQueFalta="admin (Administração)" />
        </div>
      </AppShell>
    );

  // listIntegracoesStatus devolve `ultimo_detalhes: Record<string, unknown>`, que o
  // validador de serialização do TanStack recusa e tipa `data` como `{}` (erro
  // antigo, na função de servidor, que não é desta tarefa). O cast é só de leitura.
  const status = statusQuery.data as IntegracaoStatus[] | undefined;
  const creds = credsQuery.data ?? [];
  const ativas = creds.filter((c) => c.ativo).length;
  // A coluna `unidade` é UNIQUE e diferencia maiúsculas: o upsert só substitui
  // quando o nome bate caractere a caractere (tirados os espaços das pontas).
  const unidadeExistente = unidade.trim()
    ? creds.find((c) => c.unidade.trim() === unidade.trim())
    : undefined;

  function statusIntegracao(i: IntegracaoStatus): { label: string; tom: TomStatus } {
    if (i.ultimo_status === "erro") return { label: "Erro", tom: "perigo" };
    if (i.tipo === "cron" && i.atrasada) return { label: "Atrasada", tom: "atencao" };
    if (!i.ultima_execucao) return { label: "Sem execução ainda", tom: "neutro" };
    return { label: "OK", tom: "sucesso" };
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
    <AppShell
      title={titulo}
      pergunta={pergunta}
      subtitle={
        <>
          {status ? `${status.length} syncs monitorados · ` : ""}
          {credsQuery.data ? `${ativas} de ${creds.length} credenciais Omie ativas · ` : ""}
          Desativar ou excluir a credencial de uma unidade tira essa unidade dos syncs do Omie a
          partir da próxima rodada, e o sync da base de clientes passa a registrar erro para ela a
          cada rodada até ser reativada. O status se atualiza a cada minuto.
        </>
      }
    >
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
            Status dos syncs{status ? ` (${status.length})` : ""}
          </h2>
          {statusQuery.isLoading ? (
            <Carregando variante="tabela" />
          ) : statusQuery.isError ? (
            <EstadoErro
              titulo="Não foi possível carregar o status dos syncs"
              detalhe={statusQuery.error instanceof Error ? statusQuery.error.message : undefined}
              tentarNovamente={() => statusQuery.refetch()}
            />
          ) : !status?.length ? (
            <EstadoVazio titulo="Nenhuma integração configurada" />
          ) : (
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
                {status?.map((i) => {
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
                        <StatusBadge tom={st.tom}>{st.label}</StatusBadge>
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
              </tbody>
            </table>
          </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Credenciais Omie{credsQuery.data ? ` (${creds.length})` : ""}</h2>
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
            {unidadeExistente && (
              <p className="sm:col-span-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Já existe credencial de <strong className="text-foreground">{unidadeExistente.unidade}</strong>:
                salvar substitui a APP_KEY e o APP_SECRET dela, e o secret anterior não volta. Se o novo
                estiver errado, o sync dessa unidade para até uma credencial certa ser salva.
                {!unidadeExistente.ativo && " Ela está inativa: salvar substitui a credencial e a unidade volta a ficar ativa."}
              </p>
            )}
            <div className="sm:col-span-4 flex justify-end">
              <button type="submit" disabled={upsertMut.isPending} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {upsertMut.isPending ? "Salvando..." : unidadeExistente ? "Substituir credencial" : "Salvar credencial"}
              </button>
            </div>
          </form>
        )}

        {credsQuery.isLoading ? (
          <Carregando variante="tabela" />
        ) : credsQuery.isError ? (
          <EstadoErro
            titulo="Não foi possível carregar as credenciais Omie"
            detalhe={credsQuery.error instanceof Error ? credsQuery.error.message : undefined}
            tentarNovamente={() => credsQuery.refetch()}
          />
        ) : creds.length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma credencial cadastrada"
            descricao="Use “Nova unidade” para cadastrar a APP_KEY e o APP_SECRET do Omie."
          />
        ) : (
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
              {creds.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2 font-medium text-foreground">{c.unidade}</td>
                  <td className="px-4 py-2 font-mono text-xs text-foreground">{c.app_key}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{c.app_secret_masked}</td>
                  <td className="px-4 py-2">
                    <StatusBadge tom={c.ativo ? "sucesso" : "neutro"}>
                      {c.ativo ? "Ativa" : "Inativa"}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {c.updated_at ? new Date(c.updated_at).toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleMut.mutate({ id: c.id, ativo: !c.ativo, unidade: c.unidade })}
                      disabled={toggleMut.isPending}
                      title={
                        c.ativo
                          ? "Tira a unidade dos syncs do Omie a partir da próxima rodada"
                          : "Devolve a unidade aos syncs do Omie na próxima rodada"
                      }
                      className="mr-2"
                    >
                      {c.ativo ? "Desativar" : "Ativar"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExcluirAlvo({ id: c.id, unidade: c.unidade, ativo: c.ativo })}
                      disabled={deleteMut.isPending}
                      className="border-destructive/40 text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      Excluir
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      <AlertDialog open={!!excluirAlvo} onOpenChange={(o) => !o && setExcluirAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a credencial Omie de {excluirAlvo?.unidade}?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluirAlvo?.ativo
                ? "A unidade sai dos syncs do Omie (contratos de serviço e base de clientes) a partir da próxima rodada, e o sync da base de clientes registra erro para ela a cada rodada até uma credencial nova ser cadastrada. "
                : "Ela já está inativa e fora dos syncs. "}
              A APP_KEY e o APP_SECRET são apagados e não voltam: para reativar, é preciso cadastrar a
              unidade de novo. Se a ideia é só pausar, use Desativar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMut.isPending}
              className={buttonVariants({ variant: "destructive" })}
              onClick={(e) => {
                e.preventDefault();
                if (excluirAlvo) deleteMut.mutate({ id: excluirAlvo.id, unidade: excluirAlvo.unidade });
              }}
            >
              {deleteMut.isPending ? "Excluindo…" : "Excluir credencial"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
