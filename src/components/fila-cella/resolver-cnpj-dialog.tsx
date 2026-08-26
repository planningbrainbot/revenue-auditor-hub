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
import { Badge } from "@/components/ui/badge";
import { useCandidatosCnpj, useResolverCnpj } from "@/hooks/use-fila-cella";
import {
  cnpjDvValido,
  formatCnpj,
  type CandidatoCnpj,
  type FilaContaRow,
} from "@/lib/fila-cella.types";

/**
 * §6.7 item 4 — resolver o CNPJ de uma conta.
 *
 * Mostra as duas razões sociais lado a lado e o resultado do dígito verificador,
 * que é a checagem que o operador consegue conferir olhando. O trigram roda no
 * job de reconciliação, não aqui: a régua medida (≥0,60 sugere · 0,45–0,60 exige
 * corroboração · <0,45 não sugere) está escrita no rodapé para quem vier trazer
 * um candidato de fora.
 *
 * Confirmar grava `revisado_por` — e linha revisada nunca é sobrescrita.
 */
export function ResolverCnpjDialog({
  open,
  onOpenChange,
  conta,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conta: FilaContaRow;
}) {
  const [termo, setTermo] = useState("");
  const [manual, setManual] = useState("");
  const [candidatos, setCandidatos] = useState<CandidatoCnpj[]>([]);
  const buscar = useCandidatosCnpj();
  const resolver = useResolverCnpj();

  useEffect(() => {
    if (!open) return;
    setTermo(conta.titulo);
    setManual("");
    setCandidatos([]);
  }, [open, conta.titulo]);

  const procurar = async () => {
    try {
      const r = await buscar.mutateAsync(termo);
      setCandidatos(r.candidatos);
      if (r.candidatos.length === 0) toast.info("Nenhum candidato para esse termo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na busca.");
    }
  };

  const confirmar = async (cnpj: string, razao: string | null) => {
    if (!conta.pipedrive_deal_id) {
      toast.error("Esta conta não tem deal do Pipedrive — o de-para é indexado por deal.");
      return;
    }
    try {
      await resolver.mutateAsync({
        pipedrive_deal_id: conta.pipedrive_deal_id,
        cnpj,
        papel: "principal",
        razao_social: razao,
      });
      toast.success("CNPJ vinculado. O sinal de ECD aparece no próximo sync.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gravar o vínculo.");
    }
  };

  const manualDigits = manual.replace(/\D/g, "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resolver CNPJ — {conta.titulo}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <div>
              Título do negócio (Growth): <strong>{conta.titulo}</strong>
            </div>
            {conta.razao_social && conta.razao_social !== conta.titulo && (
              <div className="text-muted-foreground">Razão social no Ops: {conta.razao_social}</div>
            )}
          </div>

          <div className="flex gap-2">
            <Input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Buscar por razão social / nome fantasia no Omie"
              onKeyDown={(e) => e.key === "Enter" && procurar()}
            />
            <Button onClick={procurar} disabled={buscar.isPending || termo.trim().length < 3}>
              {buscar.isPending ? "Buscando…" : "Buscar"}
            </Button>
          </div>

          {candidatos.length > 0 && (
            <div className="divide-y rounded-md border">
              {candidatos.map((c) => (
                <div key={c.cnpj} className="flex items-center gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.razao_social ?? "(sem razão social)"}</div>
                    {c.nome_fantasia && (
                      <div className="truncate text-xs text-muted-foreground">{c.nome_fantasia}</div>
                    )}
                    <div className="font-mono text-xs text-muted-foreground">
                      {formatCnpj(c.cnpj)}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      c.dv_valido
                        ? "border-emerald-300 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300"
                        : "border-red-300 text-red-700 dark:border-red-900 dark:text-red-300"
                    }
                  >
                    DV {c.dv_valido ? "válido" : "inválido"}
                  </Badge>
                  {c.similaridade != null && (
                    <span className="font-mono text-xs">
                      {c.similaridade.toFixed(3).replace(".", ",")}
                    </span>
                  )}
                  <Button
                    size="sm"
                    disabled={resolver.isPending || !c.dv_valido}
                    onClick={() => confirmar(c.cnpj, c.razao_social)}
                  >
                    Vincular
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="cnpj-manual">Ou informe o CNPJ direto</Label>
            <div className="flex gap-2">
              <Input
                id="cnpj-manual"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="00.000.000/0000-00"
              />
              <Button
                variant="outline"
                disabled={
                  resolver.isPending || manualDigits.length !== 14 || !cnpjDvValido(manualDigits)
                }
                onClick={() => confirmar(manualDigits, null)}
              >
                Vincular
              </Button>
            </div>
            {manualDigits.length === 14 && !cnpjDvValido(manualDigits) && (
              <p className="text-xs text-red-600">
                Dígito verificador inválido. Já aconteceu na base (SantaMaria,{" "}
                <span className="font-mono">27412261100075</span>) — transposição de dígitos.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col items-start gap-2 sm:flex-row sm:items-center">
          <p className="text-xs text-muted-foreground">
            Régua medida do trigram: ≥ 0,60 sugere (21 acertos / 0 erros) · 0,45–0,60 exige
            corroboração (4/2) · &lt; 0,45 não é sugerido (1/4). Confirmar grava seu usuário como
            revisor, e linha revisada não é sobrescrita por rotina.
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
