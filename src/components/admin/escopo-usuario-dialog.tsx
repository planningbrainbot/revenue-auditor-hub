import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Store, X } from "lucide-react";
import { getEscopoDoUsuario, salvarEscopoDoUsuario } from "@/lib/permissions.functions";
import { cn } from "@/lib/utils";

/**
 * Nível 2 do acesso: dentro das áreas que o papel abriu, o que esta pessoa vê.
 *
 * Duas listas porque são duas perguntas diferentes, e cada área diz qual delas
 * a recorta (`ops.areas.escopo`):
 *   - unidade da rede, para as áreas do Ops;
 *   - empresa do grupo, para o Brain Financeiro.
 *
 * Isto é POR PESSOA, e não por papel, porque dois analistas com o mesmo papel
 * cuidam de unidades diferentes. Até 15/09/2026 o escopo do cockpit era chave
 * de papel, e por isso os oito usuários do papel `financeiro` enxergavam os
 * oito escopos.
 */
export function EscopoUsuarioDialog({
  userId,
  nome,
  onClose,
}: {
  userId: string;
  nome: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getEscopoDoUsuario);
  const saveFn = useServerFn(salvarEscopoDoUsuario);

  const q = useQuery({
    queryKey: ["escopo-usuario", userId],
    queryFn: () => getFn({ data: { userId } }),
  });

  const [todasUnidades, setTodasUnidades] = useState(false);
  const [todasEmpresas, setTodasEmpresas] = useState(false);
  const [unidades, setUnidades] = useState<number[]>([]);
  const [empresas, setEmpresas] = useState<string[]>([]);

  useEffect(() => {
    if (!q.data) return;
    setTodasUnidades(q.data.escopo.todas_unidades);
    setTodasEmpresas(q.data.escopo.todas_empresas);
    setUnidades(q.data.escopo.unidades);
    setEmpresas(q.data.escopo.empresas);
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          userId,
          todas_unidades: todasUnidades,
          todas_empresas: todasEmpresas,
          unidades,
          empresas,
        },
      }),
    onSuccess: () => {
      toast.success(`Recorte de ${nome}: ${descreverRecorte()}. Vale no próximo carregamento.`);
      qc.invalidateQueries({ queryKey: ["escopo-usuario", userId] });
      qc.invalidateQueries({ queryKey: ["my-perms"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar o escopo."),
  });

  /** O recorte que vai ser salvo, em palavras, para o toast. */
  function descreverRecorte(): string {
    const nomesUnidades = (q.data?.unidades ?? [])
      .filter((u) => unidades.includes(u.id))
      .map((u) => u.nome_da_praca);
    const u = todasUnidades
      ? "todas as unidades"
      : nomesUnidades.length === 0
        ? "nenhuma unidade"
        : nomesUnidades.length <= 3
          ? nomesUnidades.join(", ")
          : `${nomesUnidades.length} unidades`;
    const e = todasEmpresas
      ? "todas as empresas"
      : empresas.length === 0
        ? "nenhuma empresa"
        : `${empresas.length} ${empresas.length === 1 ? "empresa" : "empresas"}`;
    return `${u} · ${e}`;
  }

  const porGrupo = useMemo(() => {
    const m = new Map<string, { id: string; apelido: string; nome_fantasia: string }[]>();
    for (const e of q.data?.empresas ?? []) {
      const lista = m.get(e.grupo_apuracao) ?? [];
      lista.push(e);
      m.set(e.grupo_apuracao, lista);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [q.data]);

  // A navegação do cockpit é por GRUPO de apuração, não por empresa. A tradução
  // é conservadora de propósito: o grupo só abre quando a pessoa tem todas as
  // empresas ativas dele. Ter uma empresa do grupo não abre o grupo inteiro.
  const gruposQueAbrem = useMemo(() => {
    if (todasEmpresas) return porGrupo.map(([g]) => g);
    const escolhidas = new Set(empresas);
    return porGrupo.filter(([, es]) => es.every((e) => escolhidas.has(e.id))).map(([g]) => g);
  }, [porGrupo, empresas, todasEmpresas]);

  function alternaUnidade(id: number) {
    setUnidades((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }
  function alternaEmpresa(id: string) {
    setEmpresas((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="mt-8 w-full max-w-2xl rounded-xl border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Escopo de {nome}</h2>
            <p className="text-xs text-muted-foreground">
              O papel já decidiu quais áreas ela abre. Aqui você decide o que ela enxerga dentro
              delas.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {q.isLoading ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">Carregando...</div>
        ) : (
          <div className="space-y-6 px-5 py-4">
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Store className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Unidades da rede</h3>
                <span className="text-xs text-muted-foreground">recorta as áreas do Ops</span>
              </div>
              <label className="mb-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={todasUnidades}
                  onChange={(e) => setTodasUnidades(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span>Todas as unidades, inclusive as que ainda vão existir</span>
              </label>
              <div
                className={cn(
                  "grid grid-cols-2 gap-1.5 sm:grid-cols-3",
                  todasUnidades && "pointer-events-none opacity-40",
                )}
              >
                {(q.data?.unidades ?? []).map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={todasUnidades || unidades.includes(u.id)}
                      onChange={() => alternaUnidade(u.id)}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span className="truncate">{u.nome_da_praca}</span>
                  </label>
                ))}
              </div>
              {!todasUnidades && unidades.length === 0 && (
                <p className="mt-2 text-xs text-warning">
                  Sem nenhuma unidade marcada, as telas com recorte por unidade abrem vazias.
                </p>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Empresas do grupo</h3>
                <span className="text-xs text-muted-foreground">recorta o Brain Financeiro</span>
              </div>
              <label className="mb-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={todasEmpresas}
                  onChange={(e) => setTodasEmpresas(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span>Todas as empresas</span>
              </label>
              <div className={cn("space-y-2", todasEmpresas && "pointer-events-none opacity-40")}>
                {porGrupo.map(([grupo, es]) => (
                  <div key={grupo}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {grupo}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {es.map((e) => (
                        <label key={e.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={todasEmpresas || empresas.includes(e.id)}
                            onChange={() => alternaEmpresa(e.id)}
                            className="h-4 w-4 rounded border-input accent-primary"
                          />
                          <span className="truncate" title={e.nome_fantasia}>
                            {e.apelido}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                No cockpit ela vai enxergar:{" "}
                <strong className="text-foreground">
                  {gruposQueAbrem.length ? gruposQueAbrem.join(", ") : "nenhum grupo"}
                </strong>
                . A navegação de lá é por grupo de apuração, e o grupo só abre com todas as empresas
                dele marcadas.
              </p>
            </section>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || q.isLoading}
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {mut.isPending ? "Salvando..." : "Salvar escopo"}
          </button>
        </div>
        {mut.isError && (
          <p className="px-5 pb-3 text-xs text-destructive">
            {(mut.error as Error)?.message ?? "Erro ao salvar."}
          </p>
        )}
      </div>
    </div>
  );
}
