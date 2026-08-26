import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useEncerrarCiclo } from "@/hooks/use-fila-cella";
import { dataBR, type FilaContaRow } from "@/lib/fila-cella.types";

/**
 * Encerrar ciclo — playbook §4.6.
 *
 * O checkbox de recusa explícita muda o bloqueio de 60 para 180 dias e passa a
 * exigir fato novo na reabertura. Os dois casos NUNCA oferecem o mesmo botão: o
 * operador precisa ver que negar é diferente de não responder.
 */
export function EncerrarCicloDialog({
  open,
  onOpenChange,
  conta,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conta: FilaContaRow;
}) {
  const [motivo, setMotivo] = useState("");
  const [recusa, setRecusa] = useState(false);
  const encerrar = useEncerrarCiclo(conta.id);

  useEffect(() => {
    if (!open) return;
    setMotivo("");
    setRecusa(false);
  }, [open]);

  const previsao = new Date();
  previsao.setDate(previsao.getDate() + (recusa ? 180 : 60));

  const salvar = async () => {
    try {
      const r = await encerrar.mutateAsync({
        ciclo_id: conta.ciclo_id!,
        motivo_saida: motivo,
        recusa_explicita: recusa,
      });
      toast.success(`Ciclo encerrado. Reentrada liberada a partir de ${dataBR(r.bloqueado_ate)}.`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao encerrar o ciclo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encerrar ciclo {conta.ciclo_num} — {conta.titulo}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="motivo-saida">Motivo do encerramento</Label>
            <Input
              id="motivo-saida"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Obrigatório."
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox
              id="recusa-explicita"
              checked={recusa}
              onCheckedChange={(v) => setRecusa(v === true)}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="recusa-explicita" className="font-medium">
                O cliente disse &quot;não&quot; explicitamente
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Não marque para &quot;não respondeu&quot;. Recusa explícita encerra por{" "}
                <strong>180 dias</strong> e a reabertura passa a exigir fato novo relevante —
                fiscalização ou mudança de decisor.
              </p>
            </div>
          </div>

          <p
            className={
              recusa
                ? "rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                : "rounded-md border bg-muted px-3 py-2 text-sm"
            }
          >
            Reentrada liberada a partir de{" "}
            <strong>{previsao.toLocaleDateString("pt-BR")}</strong> ({recusa ? "180" : "60"} dias).
            {recusa
              ? " Antes disso, só com fato novo e a permissão manage.fila_cella_override."
              : " Antes disso, só com fato novo e motivo diferente."}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant={recusa ? "destructive" : "default"}
            onClick={salvar}
            disabled={encerrar.isPending || !motivo.trim()}
          >
            {recusa ? "Encerrar por recusa (180 dias)" : "Encerrar ciclo (60 dias)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
