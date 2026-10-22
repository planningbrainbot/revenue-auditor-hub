import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  PageHeader,
} from "@/components/planning";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CHAVE } from "@/components/tarefas/comum";
import { usePermissions } from "@/hooks/use-permissions";
import { listarDepartamentos, salvarDepartamento } from "@/lib/tarefas/tarefas.functions";

// Departamentos das tarefas (arquétipo Configuração). A lista é uma só para todos os quadros,
// para dar para filtrar "tudo de Financeiro" entre quadros. Só a administração mexe (RLS).

export const Route = createFileRoute("/_authenticated/tarefas/departamentos")({
  head: () => ({ meta: [{ title: "Departamentos · Planning Brain" }] }),
  component: Pagina,
});

const TITULO = "Departamentos";
const PERGUNTA = "Quais departamentos as tarefas podem ter?";

function Pagina() {
  const perms = usePermissions();
  if (perms.loading)
    return (
      <main className="mx-auto max-w-3xl space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="tarefas" titulo={TITULO} pergunta={PERGUNTA} />
        <Carregando variante="tabela" />
      </main>
    );
  if (!perms.temArea("tarefas") || !perms.temArea("admin"))
    return (
      <main className="mx-auto max-w-3xl space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="tarefas" titulo={TITULO} pergunta={PERGUNTA} />
        <EstadoSemAcesso oQueFalta="as áreas Tarefas e Administração" />
      </main>
    );
  return <ComAcesso />;
}

function ComAcesso() {
  const client = useQueryClient();
  const fn = useServerFn(listarDepartamentos);
  const q = useQuery({ queryKey: [...CHAVE, "departamentos"], queryFn: () => fn(), retry: false });
  const salvarFn = useServerFn(salvarDepartamento);
  const salvar = useMutation({
    mutationFn: (v: { id?: string; nome?: string; ativo?: boolean }) => salvarFn({ data: v }),
    onSuccess: () => client.invalidateQueries({ queryKey: CHAVE }),
    onError: (e: Error) => {
      toast.error(e.message);
      client.invalidateQueries({ queryKey: CHAVE });
    },
  });
  const [novo, setNovo] = useState("");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="tarefas"
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao="Lista única para todos os quadros. Inativo some das opções, mas fica nas tarefas que já tinham."
      />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (novo.trim()) salvar.mutate({ nome: novo.trim() }, { onSuccess: () => setNovo("") });
        }}
      >
        <Input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          placeholder="Novo departamento"
          maxLength={80}
          aria-label="Novo departamento"
        />
        <Button type="submit" disabled={!novo.trim() || salvar.isPending}>
          Adicionar
        </Button>
      </form>
      {q.isLoading ? (
        <Carregando variante="tabela" />
      ) : q.isError ? (
        <EstadoErro
          detalhe={`Fonte: ops.tarefas_departamentos. ${(q.error as Error).message}`}
          tentarNovamente={() => q.refetch()}
        />
      ) : !q.data?.length ? (
        <EstadoVazio
          titulo="Nenhum departamento ainda"
          descricao="Adicione os departamentos acima."
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {q.data.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2">
              <Input
                defaultValue={d.nome}
                key={d.nome}
                maxLength={80}
                aria-label={`Nome do departamento ${d.nome}`}
                className="h-8"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== d.nome) salvar.mutate({ id: d.id, nome: v });
                }}
              />
              <label className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                <Switch
                  checked={d.ativo}
                  onCheckedChange={(v) => salvar.mutate({ id: d.id, ativo: v })}
                />
                Ativo
              </label>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
