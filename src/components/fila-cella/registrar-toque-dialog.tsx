import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRegistrarToque } from "@/hooks/use-fila-cella";
import {
  CANAIS,
  RESULTADOS,
  sinalizarFormulacoesProibidas,
  type Canal,
  type FilaContaRow,
  type GatilhoContaRow,
  type Resultado,
} from "@/lib/fila-cella.types";

// O modal do §6.5.
//
// Ciclo e toque são AUTO e read-only: numerar no cliente seria negociar a trava
// com quem ela existe para conter. A frente vem travada do ciclo (a FK composta
// (ciclo_id, frente) recusa qualquer divergência no banco).
//
// Conta sem gatilho não abre este modal — "nenhum cliente entra na fila sem
// gatilho identificado e registrado" (playbook §3.6). Quem barra é o chamador.

export function RegistrarToqueDialog({
  open,
  onOpenChange,
  conta,
  gatilhos,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conta: FilaContaRow;
  gatilhos: GatilhoContaRow[];
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(hoje);
  const [canal, setCanal] = useState<Canal | "">("");
  const [gatilho, setGatilho] = useState("");
  const [literal, setLiteral] = useState("");
  const [atesto, setAtesto] = useState(false);
  const [resposta, setResposta] = useState("");
  const [resultado, setResultado] = useState<Resultado | "">("");
  const [proximoPasso, setProximoPasso] = useState("");
  const [proximoPassoEm, setProximoPassoEm] = useState("");
  const [motivo, setMotivo] = useState("");
  const [confirmouLiteral, setConfirmouLiteral] = useState(false);

  const registrar = useRegistrarToque(conta.id);
  const proximoNum = (conta.toques ?? 0) + 1;

  useEffect(() => {
    if (!open) return;
    setData(hoje);
    setCanal("");
    setGatilho(conta.gatilho_principal ?? "");
    setLiteral("");
    setAtesto(false);
    setResposta("");
    setResultado("");
    setProximoPasso("");
    setProximoPassoEm("");
    setMotivo("");
    setConfirmouLiteral(false);
  }, [open, conta.gatilho_principal, hoje]);

  const sinalizadas = useMemo(() => sinalizarFormulacoesProibidas(literal), [literal]);
  const exigeProximoPasso = resultado !== "" && resultado !== "Não explícito";
  const opcoesGatilho = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const g of gatilhos) if (!vistos.has(g.gatilho)) vistos.set(g.gatilho, g.nome_conta);
    if (conta.gatilho_principal && !vistos.has(conta.gatilho_principal)) {
      vistos.set(conta.gatilho_principal, conta.gatilho_principal_nome ?? conta.gatilho_principal);
    }
    return [...vistos.entries()];
  }, [gatilhos, conta.gatilho_principal, conta.gatilho_principal_nome]);

  const salvar = async () => {
    if (sinalizadas.length > 0 && !confirmouLiteral) {
      toast.error("Confirme que quer registrar o literal mesmo com as formulações sinalizadas.");
      return;
    }
    try {
      const r = await registrar.mutateAsync({
        ciclo_id: conta.ciclo_id!,
        data,
        canal: canal as Canal,
        gatilho_ref: gatilho,
        literal,
        atesto_sem_citar_cliente: atesto,
        resposta: resposta || null,
        resultado: resultado as Resultado,
        proximo_passo: proximoPasso || null,
        proximo_passo_em: proximoPassoEm || null,
        motivo: motivo || null,
      });
      toast.success(`Toque ${r.toque_num} de 4 registrado.`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao registrar o toque.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar toque — {conta.titulo}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 rounded-md bg-muted px-3 py-2 text-sm">
            <span>
              Ciclo <strong>{conta.ciclo_num}</strong>
            </span>
            <span>
              Toque <strong>{proximoNum} de 4</strong>
            </span>
            <span>
              Frente <strong>{conta.ciclo_frente}</strong>{" "}
              <span className="text-xs text-muted-foreground">
                (uma frente por ciclo, playbook §4.6)
              </span>
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="toque-data">Data</Label>
              <Input
                id="toque-data"
                type="date"
                max={hoje}
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
              {data < hoje && (
                <p className="text-xs text-amber-600">
                  Registrar no mesmo dia é a regra (playbook §5.6 nº 1).
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Canal</Label>
              <Select value={canal} onValueChange={(v) => setCanal(v as Canal)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {CANAIS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Gatilho usado</Label>
            <Select value={gatilho} onValueChange={setGatilho}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o gatilho apurado" />
              </SelectTrigger>
              <SelectContent>
                {opcoesGatilho.map(([g, nome]) => (
                  <SelectItem key={g} value={g}>
                    {g} · {nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="toque-literal">Literal do que foi dito</Label>
            <Textarea
              id="toque-literal"
              rows={4}
              value={literal}
              onChange={(e) => {
                setLiteral(e.target.value);
                setConfirmouLiteral(false);
              }}
              placeholder="Cole a mensagem enviada ou transcreva o que foi falado."
            />
            <p className="text-xs text-muted-foreground">
              Registro de compliance — vai inteiro no handoff ao Cella. O verificador cobre 6 das 7
              formulações proibidas do playbook §2.5; a sétima (citar nome de outro cliente) é
              semântica e nenhum matcher de texto a pega — por isso o atesto abaixo.
            </p>
            {sinalizadas.length > 0 && (
              <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
                <p className="font-medium text-red-700 dark:text-red-200">
                  {sinalizadas.length} formulação(ões) proibida(s) no texto:
                </p>
                <ul className="list-disc space-y-1 pl-5 text-red-700 dark:text-red-200">
                  {sinalizadas.map((s) => (
                    <li key={s.rotulo}>
                      {s.rotulo} — diga no lugar: <em>{s.noLugar}</em>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="confirma-literal"
                    checked={confirmouLiteral}
                    onCheckedChange={(v) => setConfirmouLiteral(v === true)}
                  />
                  <Label htmlFor="confirma-literal" className="text-xs">
                    Registrar assim mesmo — é o que foi dito, e evidência não se reescreve.
                  </Label>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="atesto"
                checked={atesto}
                onCheckedChange={(v) => setAtesto(v === true)}
              />
              <Label htmlFor="atesto" className="text-xs">
                Atesto que não citei nome de outro cliente da Planning.
              </Label>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Resultado</Label>
              <Select value={resultado} onValueChange={(v) => setResultado(v as Resultado)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {RESULTADOS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="toque-resposta">Resposta do cliente (opcional)</Label>
              <Input
                id="toque-resposta"
                value={resposta}
                onChange={(e) => setResposta(e.target.value)}
              />
            </div>
          </div>

          {exigeProximoPasso && (
            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <div className="space-y-1">
                <Label htmlFor="toque-passo">Próximo passo</Label>
                <Input
                  id="toque-passo"
                  value={proximoPasso}
                  onChange={(e) => setProximoPasso(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="toque-passo-em">Quando</Label>
                <Input
                  id="toque-passo-em"
                  type="date"
                  value={proximoPassoEm}
                  onChange={(e) => setProximoPassoEm(e.target.value)}
                />
              </div>
            </div>
          )}

          {resultado === "Não explícito" && (
            <div className="space-y-1">
              <Label htmlFor="toque-motivo">Motivo da recusa</Label>
              <Input
                id="toque-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Obrigatório — e é o que separa 60 de 180 dias no encerramento."
              />
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            O toque não avança o estágio. Estágio só muda por ação explícita — funil inflado é o
            defeito mais comum e o mais caro (playbook §5.1).
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={salvar}
            disabled={registrar.isPending || !canal || !gatilho || !literal.trim() || !resultado}
          >
            {registrar.isPending ? "Registrando…" : `Registrar toque ${proximoNum}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
