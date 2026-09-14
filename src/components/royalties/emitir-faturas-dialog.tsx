import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileText, Loader2, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { brl } from "@/components/audit/format";
import {
  emitirFaturasRoyalties,
  simularFaturamentoRoyalties,
  type LinhaFaturamento,
  type RespostaFaturamento,
} from "@/lib/royalties-faturamento.functions";

/**
 * Emissão das faturas da apuração na conta Omie da Planning Partners.
 *
 * Duas etapas sempre, nunca uma: abrir o diálogo só simula (não escreve no
 * Omie nem no banco), e o botão de emitir só fica disponível depois que a
 * simulação voltou e alguém escolheu a data de vencimento. Fatura é dinheiro
 * saindo para a unidade: não vale um clique só.
 *
 * O que entra: royalties, CAC e outras receitas. CSC fixo e reembolso de
 * tráfego pago ficam de fora porque já saem pela rotina mensal do CSC.
 */

const ROTULO: Record<string, { texto: string; cls: string }> = {
  a_emitir: { texto: "A emitir", cls: "text-emerald-700 dark:text-emerald-300" },
  ja_existia: { texto: "Já no Omie", cls: "text-amber-700 dark:text-amber-300" },
  ja_registrada: { texto: "Já emitida", cls: "text-amber-700 dark:text-amber-300" },
  nao_fechada: { texto: "Não fechada", cls: "text-muted-foreground" },
  sem_valor: { texto: "Sem valor", cls: "text-muted-foreground" },
  sem_apuracao: { texto: "Sem apuração", cls: "text-muted-foreground" },
  criada: { texto: "OS criada", cls: "text-sky-700 dark:text-sky-300" },
  faturada: { texto: "Faturada", cls: "text-emerald-700 dark:text-emerald-300" },
  erro: { texto: "Erro", cls: "text-destructive" },
};

/** Quinto dia útil do mês seguinte à competência, a régua da rede. */
function vencimentoSugerido(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes, 1)); // mês seguinte
  let uteis = 0;
  for (let i = 0; i < 40; i++) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) uteis++;
    if (uteis === 5) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

function rotuloMes(competencia: string): string {
  const [y, m] = competencia.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function EmitirFaturasDialog({ competencia }: { competencia: string }) {
  const [aberto, setAberto] = useState(false);
  const [venceEm, setVenceEm] = useState("");
  const [escolhidas, setEscolhidas] = useState<number[]>([]);
  const [plano, setPlano] = useState<RespostaFaturamento | null>(null);
  const [resultado, setResultado] = useState<RespostaFaturamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const simular = useMutation({
    mutationFn: () => simularFaturamentoRoyalties({ data: { competencia } }),
    onSuccess: (r) => {
      setPlano(r);
      setEscolhidas(r.unidades.filter((u) => u.status === "a_emitir").map((u) => u.unidade_id));
    },
    onError: (e: Error) => setErro(e.message),
  });

  const emitir = useMutation({
    mutationFn: () =>
      emitirFaturasRoyalties({ data: { competencia, vence_em: venceEm, unidades: escolhidas } }),
    onSuccess: (r) => setResultado(r),
    onError: (e: Error) => setErro(e.message),
  });

  // Abrir o diálogo já simula: a tela nunca mostra número velho.
  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setResultado(null);
    setVenceEm(vencimentoSugerido(competencia));
    simular.mutate();
    // competencia muda o plano inteiro; simular é estável o bastante aqui
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, competencia]);

  const linhas = resultado?.unidades ?? plano?.unidades ?? [];
  const emitiveis = useMemo(
    () => (plano?.unidades ?? []).filter((u) => u.status === "a_emitir"),
    [plano],
  );
  const totalEscolhido = useMemo(
    () =>
      emitiveis
        .filter((u) => escolhidas.includes(u.unidade_id))
        .reduce((s, u) => s + Number(u.total ?? 0), 0),
    [emitiveis, escolhidas],
  );

  const jaFoi = linhas.filter((u) => u.status === "ja_existia" || u.status === "ja_registrada");
  const naoFechadas = linhas.filter((u) => u.status === "nao_fechada");
  const podeEmitir = !!venceEm && escolhidas.length > 0 && !emitir.isPending && !resultado;

  function alternar(id: number) {
    setEscolhidas((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="default" className="gap-2">
          <FileText className="h-4 w-4" />
          Emitir faturas no Omie
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="capitalize">
            Emitir faturas de {rotuloMes(competencia)}
          </DialogTitle>
          <DialogDescription>
            Uma ordem de serviço por unidade na conta Omie da Planning Partners, com um item por
            natureza: royalties, CAC e outras receitas. CSC fixo e reembolso de tráfego pago não
            entram aqui, porque já saem pela rotina mensal do CSC. Só entra unidade com a apuração
            do mês fechada, e nenhuma sai duas vezes.
          </DialogDescription>
        </DialogHeader>

        {simular.isPending && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Conferindo no Omie o que já foi emitido…
          </div>
        )}

        {erro && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        {!simular.isPending && linhas.length > 0 && (
          <>
            {naoFechadas.length > 0 && !resultado && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                {naoFechadas.length === 1
                  ? "1 unidade tem apuração aberta"
                  : `${naoFechadas.length} unidades têm apuração aberta`}{" "}
                e ficou de fora: só mês fechado vira fatura, porque rascunho ainda muda de número.
                Feche a apuração da unidade e volte aqui.
              </div>
            )}

            {jaFoi.length > 0 && !resultado && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {jaFoi.length === 1
                  ? "1 unidade já tem fatura"
                  : `${jaFoi.length} unidades já têm fatura`}{" "}
                desta competência no Omie e ficou de fora do lote. A varredura enxerga também o que
                foi emitido à mão, sem código de integração.
              </div>
            )}

            <div className="max-h-[45vh] overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 p-2"></th>
                    <th className="p-2 text-left font-medium">Unidade</th>
                    <th className="p-2 text-right font-medium">Royalties</th>
                    <th className="p-2 text-right font-medium">CAC</th>
                    <th className="p-2 text-right font-medium">Outras</th>
                    <th className="p-2 text-right font-medium">Total</th>
                    <th className="p-2 text-left font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((u: LinhaFaturamento) => {
                    const r = ROTULO[u.status] ?? { texto: u.status, cls: "" };
                    const selecionavel = u.status === "a_emitir" && !resultado;
                    return (
                      <tr key={u.unidade_id} className="border-t">
                        <td className="p-2">
                          {selecionavel && (
                            <Checkbox
                              checked={escolhidas.includes(u.unidade_id)}
                              onCheckedChange={() => alternar(u.unidade_id)}
                              aria-label={`Incluir ${u.unidade}`}
                            />
                          )}
                        </td>
                        <td className="p-2">
                          <div className="font-medium">{u.unidade}</div>
                          {u.motivo && (
                            <div className="text-xs text-muted-foreground">{u.motivo}</div>
                          )}
                          {u.erro && <div className="text-xs text-destructive">{u.erro}</div>}
                          {u.num_os && (
                            <div className="text-xs text-muted-foreground">
                              OS {u.num_os}
                              {u.num_recibo ? ` · recibo ${u.num_recibo}` : ""}
                            </div>
                          )}
                        </td>
                        <td className="p-2 text-right tabular-nums">{brl(u.royalties ?? 0)}</td>
                        <td className="p-2 text-right tabular-nums">{brl(u.cac ?? 0)}</td>
                        <td className="p-2 text-right tabular-nums">{brl(u.outras ?? 0)}</td>
                        <td className="p-2 text-right font-medium tabular-nums">
                          {brl(u.total ?? 0)}
                        </td>
                        <td className={`p-2 text-xs ${r.cls}`}>{r.texto}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!resultado && (
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="vence-em">Data de vencimento do boleto</Label>
                  <Input
                    id="vence-em"
                    type="date"
                    value={venceEm}
                    onChange={(e) => setVenceEm(e.target.value)}
                    className="w-[180px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Sugerido: 5º dia útil do mês seguinte, a régua da rede.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">
                    {escolhidas.length} de {emitiveis.length} unidades escolhidas
                  </div>
                  <div className="text-lg font-semibold tabular-nums">{brl(totalEscolhido)}</div>
                </div>
              </div>
            )}

            {resultado && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {resultado.resumo.faturadas} faturada(s), {resultado.resumo.criadas} criada(s) sem
                  faturar e {resultado.resumo.erros} com erro. Nota de débito e boleto seguem para
                  os destinatários cadastrados da unidade.
                </span>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setAberto(false)}>
            {resultado ? "Fechar" : "Cancelar"}
          </Button>
          {!resultado && (
            <Button
              disabled={!podeEmitir}
              onClick={() => {
                setErro(null);
                emitir.mutate();
              }}
            >
              {emitir.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {emitir.isPending
                ? "Emitindo no Omie…"
                : `Emitir ${escolhidas.length > 0 ? `${escolhidas.length} fatura(s)` : ""}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
