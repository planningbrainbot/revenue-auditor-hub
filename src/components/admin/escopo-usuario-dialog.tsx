import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getEscopoDoUsuario, salvarEscopoDoUsuario } from "@/lib/permissions.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Carregando } from "@/components/planning";
import { cn } from "@/lib/utils";

/**
 * O RECORTE de uma pessoa: quais unidades da rede ela enxerga dentro das áreas
 * que o perfil abriu. É por pessoa, e não por perfil, porque dois analistas com
 * o mesmo perfil cuidam de unidades diferentes.
 *
 * Até 24/09/2026 este diálogo também editava as empresas do Financeiro, com
 * uma regra oposta à do cockpit e sem sincronizar com ele. As empresas agora
 * ficam só em /admin/acessos-financeiro.
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

  const [todas, setTodas] = useState(false);
  const [unidades, setUnidades] = useState<number[]>([]);

  useEffect(() => {
    if (!q.data) return;
    setTodas(q.data.escopo.todas_unidades);
    setUnidades(q.data.escopo.unidades);
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () => saveFn({ data: { userId, todas_unidades: todas, unidades } }),
    onSuccess: () => {
      toast.success(`Recorte de ${nome} salvo.`);
      qc.invalidateQueries({ queryKey: ["escopo-usuario", userId] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["ficha-pessoa", userId] });
      qc.invalidateQueries({ queryKey: ["my-perms"] });
      onClose();
    },
  });

  function alterna(id: number) {
    setUnidades((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Unidades que {nome} vê</DialogTitle>
          <DialogDescription>
            O perfil decide quais áreas a pessoa abre. Aqui você decide de quais unidades ela vê os
            dados dentro delas. Vale no próximo carregamento de tela.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <Carregando variante="tabela" linhas={4} />
        ) : q.isError ? (
          <p className="text-sm text-danger">
            Não foi possível ler o recorte atual. Feche e abra de novo; nada foi alterado.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox id="todas-unidades" checked={todas} onCheckedChange={(v) => setTodas(v === true)} />
              <Label htmlFor="todas-unidades">Todas as unidades, inclusive as que ainda vão existir</Label>
            </div>
            <div
              className={cn(
                "grid grid-cols-2 gap-2 sm:grid-cols-3",
                todas && "pointer-events-none opacity-40",
              )}
            >
              {(q.data?.unidades ?? []).map((u) => (
                <div key={u.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`un-${u.id}`}
                    checked={todas || unidades.includes(u.id)}
                    onCheckedChange={() => alterna(u.id)}
                  />
                  <Label htmlFor={`un-${u.id}`} className="truncate font-normal">
                    {u.nome_da_praca}
                  </Label>
                </div>
              ))}
            </div>
            {!todas && unidades.length === 0 && (
              <p className="text-sm text-warning">
                Sem nenhuma unidade marcada, as telas recortadas por unidade abrem vazias para esta
                pessoa.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              As empresas que ela vê no Financeiro ficam em{" "}
              <Link to="/admin/acessos-financeiro" className="text-primary-text underline underline-offset-4">
                Acessos do Financeiro
              </Link>
              .
            </p>
          </div>
        )}

        {mut.isError && (
          <p className="text-sm text-destructive">{(mut.error as Error)?.message ?? "Erro ao salvar."}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || q.isLoading || q.isError}>
            {mut.isPending ? "Salvando…" : "Salvar recorte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
