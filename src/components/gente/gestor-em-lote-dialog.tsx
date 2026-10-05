import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UsersRound } from "lucide-react";
import { definirGestorEmLote } from "@/lib/gente.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Gestor de várias pessoas de uma vez (05/10/2026, pedido do RH de Maceió).
// É o campo Gestor que faz alguém ser líder no People: com ele a pessoa entra
// em "Meu time", nos 1:1, no PDI e na AVE do líder.

const TIRAR = "__tirar__";

export function GestorEmLoteDialog({
  pessoaIds,
  gestores,
  unidadeIds,
  aoConcluir,
}: {
  pessoaIds: number[];
  gestores: { id: number; nome: string; unidadeId: number | null }[];
  /** Unidades das pessoas selecionadas: o gestor sai delas. */
  unidadeIds: (number | null)[];
  aoConcluir: () => void;
}) {
  const fn = useServerFn(definirGestorEmLote);
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [gestor, setGestor] = useState("");
  const candidatos = gestores.filter((g) => unidadeIds.includes(g.unidadeId));

  const salvar = useMutation({
    mutationFn: () =>
      fn({ data: { pessoaIds, gestorId: gestor === TIRAR ? null : Number(gestor) } }),
    onSuccess: (r) => {
      const msg = `${r.alterados} pessoa(s) atualizada(s).`;
      if (r.ignorados.length) {
        toast.warning(
          `${msg} ${r.ignorados.length} ficaram de fora: ${r.ignorados
            .map((i) => `${i.nome} (${i.motivo})`)
            .join("; ")}.`,
          { duration: 15_000 },
        );
      } else toast.success(msg);
      setAberto(false);
      setGestor("");
      qc.invalidateQueries({ queryKey: ["gente"] });
      qc.invalidateQueries({ queryKey: ["gente-menu"] });
      qc.invalidateQueries({ queryKey: ["gente-historico"] });
      aoConcluir();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UsersRound className="mr-2 h-4 w-4" />
          Definir gestor
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Definir gestor de {pessoaIds.length} pessoa(s)</DialogTitle>
          <DialogDescription>
            O gestor passa a ver essas pessoas em Meu time, nos 1:1, no PDI e recebe a avaliação de
            experiência delas. Cada mudança fica no histórico do cadastro.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="gl-gestor">Gestor</Label>
          <Select value={gestor} onValueChange={setGestor}>
            <SelectTrigger id="gl-gestor">
              <SelectValue placeholder="Escolha o gestor" />
            </SelectTrigger>
            <SelectContent>
              {candidatos.map((g) => (
                <SelectItem key={g.id} value={String(g.id)}>
                  {g.nome}
                </SelectItem>
              ))}
              <SelectItem value={TIRAR}>Tirar o gestor (deixar sem)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[12px] text-muted-foreground">
            Se o gestor escolhido estiver entre os selecionados, ele mesmo fica de fora; quem
            estiver acima dele na hierarquia também, para não fechar um círculo.
          </p>
        </div>
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={!gestor || salvar.isPending}>
            {salvar.isPending ? "Salvando…" : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
