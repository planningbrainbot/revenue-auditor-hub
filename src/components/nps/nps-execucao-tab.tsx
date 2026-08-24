import { useMemo, useState } from "react";
import { MessageCircleMore, Send, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useNpsExecucao, useAudienciaPorUnidade, useDispararCampanha } from "@/hooks/use-nps";
import type { NpsExecucaoRow } from "@/lib/nps.functions";

type Categoria = "promotor" | "neutro" | "detrator" | null;

function categorize(score: string | null): Categoria {
  if (score == null || score === "") return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 9) return "promotor";
  if (n >= 7) return "neutro";
  return "detrator";
}

function npsBadge(cat: Categoria) {
  if (cat === "promotor")
    return <Badge variant="outline" className="border-emerald-600/30 bg-emerald-600/[0.07] text-emerald-700 dark:text-emerald-400">Promotor</Badge>;
  if (cat === "neutro")
    return <Badge variant="outline" className="border-amber-600/30 bg-amber-600/[0.07] text-amber-700 dark:text-amber-400">Neutro</Badge>;
  if (cat === "detrator")
    return <Badge variant="outline" className="border-red-600/30 bg-red-600/[0.07] text-red-700 dark:text-red-400">Detrator</Badge>;
  return null;
}

function tempoDecorrido(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 > 0 ? ` ${min % 60}min` : ""}`;
  return `${Math.floor(h / 24)}d`;
}

// Status vem do webhook de status da Cloud API (sent/delivered/read/failed).
// Enquanto o webhook ainda não bateu pra aquele envio, status fica null — só
// sabemos que foi disparado.
function statusBadge(row: NpsExecucaoRow) {
  if (row.respondido) {
    return (
      <Badge variant="outline" className="border-emerald-600/30 bg-emerald-600/[0.07] text-emerald-700 dark:text-emerald-400">
        Respondido
      </Badge>
    );
  }
  switch (row.status) {
    case "failed":
      return (
        <Badge variant="outline" className="border-red-600/30 bg-red-600/[0.07] text-red-700 dark:text-red-400">
          Falhou
        </Badge>
      );
    case "read":
      return (
        <Badge variant="outline" className="border-sky-600/30 bg-sky-600/[0.07] text-sky-700 dark:text-sky-400">
          Lida
        </Badge>
      );
    case "delivered":
      return (
        <Badge variant="outline" className="border-muted-foreground/30 bg-muted-foreground/[0.07]">
          Entregue
        </Badge>
      );
    case "sent":
      return (
        <Badge variant="outline" className="border-amber-600/30 bg-amber-600/[0.07] text-amber-700 dark:text-amber-400">
          Enviado
        </Badge>
      );
    default:
      return <Badge variant="outline">Aguardando status</Badge>;
  }
}

function erroResumo(erro: NpsExecucaoRow["erro"]): string | null {
  if (!erro) return null;
  if (Array.isArray(erro)) {
    const first = erro[0];
    if (first && typeof first === "object" && "title" in first) {
      return String((first as { title?: unknown }).title ?? "Falha no envio");
    }
  }
  if (typeof erro === "object" && "title" in (erro as Record<string, unknown>)) {
    return String((erro as { title?: unknown }).title ?? "Falha no envio");
  }
  return "Falha no envio";
}

function DispararCampanhaCard() {
  const { data: audiencia, isLoading } = useAudienciaPorUnidade();
  const disparar = useDispararCampanha();
  const [unidadeEscolhida, setUnidadeEscolhida] = useState<string>("");

  const linhaEscolhida = audiencia?.rows.find((r) => r.unidade === unidadeEscolhida);

  const handleConfirm = () => {
    disparar.mutate(
      { unidade: unidadeEscolhida },
      {
        onSuccess: () => {
          toast.success(`Disparo iniciado pra ${unidadeEscolhida} — os envios aparecem na tabela abaixo em minutos.`);
          setUnidadeEscolhida("");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao disparar."),
      },
    );
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Disparar campanha</div>
          <Select value={unidadeEscolhida} onValueChange={setUnidadeEscolhida} disabled={isLoading}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue placeholder="Escolher unidade…" />
            </SelectTrigger>
            <SelectContent>
              {(audiencia?.rows ?? []).map((r) => (
                <SelectItem key={r.unidade} value={r.unidade}>
                  {r.unidade} ({r.totalContatos} contatos{r.jaDisparados > 0 ? `, ${r.jaDisparados} já disparados` : ""})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={!unidadeEscolhida || disparar.isPending} className="gap-2">
              <Send className="size-4" />
              {disparar.isPending ? "Disparando…" : "Disparar"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disparar pesquisa de NPS pra {unidadeEscolhida}?</AlertDialogTitle>
              <AlertDialogDescription>
                Isso envia uma mensagem real de WhatsApp (template de pesquisa) pra{" "}
                <strong>{linhaEscolhida?.totalContatos ?? "—"} contatos</strong> de {unidadeEscolhida}
                {linhaEscolhida && linhaEscolhida.jaDisparados > 0
                  ? `, incluindo os ${linhaEscolhida.jaDisparados} que já receberam disparo antes (podem receber de novo)`
                  : ""}
                . Não tem como cancelar depois de enviado.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirm}>Disparar agora</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Card>
  );
}

export function NpsExecucaoTab() {
  const { data, isLoading, error, dataUpdatedAt } = useNpsExecucao();
  const [rodada, setRodada] = useState<string>("todas");
  const [unidade, setUnidade] = useState<string>("todas");
  const [selected, setSelected] = useState<NpsExecucaoRow | null>(null);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => {
      if (rodada !== "todas" && r.rodada !== rodada) return false;
      if (unidade !== "todas" && r.unidade !== unidade) return false;
      return true;
    });
  }, [data, rodada, unidade]);

  const activeFilters = (rodada !== "todas" ? 1 : 0) + (unidade !== "todas" ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Acompanha em tempo real os disparos feitos pelo workflow de WhatsApp — atualiza sozinho a cada 15s.
        </p>
        {dataUpdatedAt > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            atualizado há {Math.round((Date.now() - dataUpdatedAt) / 1000)}s
          </span>
        )}
      </div>

      <DispararCampanhaCard />

      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Carregando execução…</Card>}
      {error && <Card className="p-6 text-sm text-red-600">Erro ao carregar execução.</Card>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Enviados</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{data.totalEnviados}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Respondidos</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">{data.totalRespondidos}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Aguardando</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-600">{data.totalAguardando}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Falhas</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-red-600">{data.totalFalhas}</div>
            </Card>
          </div>

          <Card>
            <div className="flex items-center justify-between border-b p-3">
              <span className="text-sm font-medium">Disparos (mais recentes primeiro)</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <SlidersHorizontal className="size-3.5" />
                    Filtros
                    {activeFilters > 0 && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                        {activeFilters}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 space-y-3">
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Rodada de disparo</span>
                    <Select value={rodada} onValueChange={setRodada}>
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todas">Todas</SelectItem>
                        {data.rodadas.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Unidade</span>
                    <Select value={unidade} onValueChange={setUnidade}>
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todas">Todas</SelectItem>
                        {data.unidades.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="relative max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="bg-background">Telefone</TableHead>
                    <TableHead className="bg-background">Empresa</TableHead>
                    <TableHead className="bg-background">Unidade</TableHead>
                    <TableHead className="bg-background">Rodada</TableHead>
                    <TableHead className="bg-background">Enviado há</TableHead>
                    <TableHead className="bg-background">Status</TableHead>
                    <TableHead className="bg-background text-center">NPS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.telefone}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setSelected(r)}
                          className="text-left underline-offset-2 hover:underline"
                        >
                          {r.empresa ?? "—"}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.unidade ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.rodada ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{tempoDecorrido(r.enviadoEm)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {statusBadge(r)}
                          {r.status === "failed" && erroResumo(r.erro) && (
                            <span className="text-xs text-muted-foreground" title={erroResumo(r.erro) ?? undefined}>
                              {erroResumo(r.erro)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">{r.npsRecomendacao ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {filteredRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        {data.rows.length === 0
                          ? 'Nenhum disparo ainda. Assim que o workflow "NPS - Criar Card e Enviar WhatsApp" rodar, os envios aparecem aqui em tempo real.'
                          : "Nenhum disparo com esses filtros."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 border-b p-3 text-sm font-medium">
              <MessageCircleMore className="size-4 text-muted-foreground" />
              Mensagens de texto livre
              <span className="font-normal text-muted-foreground">
                — respostas fora do fluxo estruturado da pesquisa
              </span>
            </div>
            <div className="relative max-h-[360px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="bg-background">Telefone</TableHead>
                    <TableHead className="bg-background">Mensagem</TableHead>
                    <TableHead className="bg-background">Recebida há</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.textoLivre.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.telefone}</TableCell>
                      <TableCell className="max-w-md truncate" title={t.texto ?? undefined}>
                        {t.texto ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{tempoDecorrido(t.recebidoEm)}</TableCell>
                    </TableRow>
                  ))}
                  {data.textoLivre.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                        Nenhuma mensagem de texto livre recebida ainda.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.empresa ?? "Empresa não identificada"}</SheetTitle>
                <SheetDescription>
                  {selected.telefone} · {selected.unidade ?? "unidade não identificada"}
                  {selected.rodada && ` · rodada ${selected.rodada}`}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Status do disparo
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {statusBadge(selected)}
                    <span className="text-xs text-muted-foreground">enviado {tempoDecorrido(selected.enviadoEm)}</span>
                  </div>
                  {selected.status === "failed" && erroResumo(selected.erro) && (
                    <p className="mt-2 text-xs text-red-600">{erroResumo(selected.erro)}</p>
                  )}
                </div>

                {!selected.respondido ? (
                  <p className="text-sm text-muted-foreground">Ainda não respondeu à pesquisa.</p>
                ) : (
                  <>
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Recomendação (NPS)
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-semibold tabular-nums">{selected.npsRecomendacao ?? "—"}</span>
                        {npsBadge(categorize(selected.npsRecomendacao))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Contato que respondeu
                      </div>
                      <div className="text-sm">{selected.nomeContato ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{selected.emailPesquisa ?? "—"}</div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Avaliação por serviço (CSAT)
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-md border p-2">
                          <div className="text-[11px] text-muted-foreground">Fiscal</div>
                          <div className="text-lg font-semibold">{selected.avaliacaoFiscal ?? "—"}</div>
                        </div>
                        <div className="rounded-md border p-2">
                          <div className="text-[11px] text-muted-foreground">Contábil</div>
                          <div className="text-lg font-semibold">{selected.avaliacaoContabil ?? "—"}</div>
                        </div>
                        <div className="rounded-md border p-2">
                          <div className="text-[11px] text-muted-foreground">Folha</div>
                          <div className="text-lg font-semibold">{selected.avaliacaoFolhaPagamento ?? "—"}</div>
                        </div>
                      </div>
                    </div>

                    {selected.servicosContratados && selected.servicosContratados.length > 0 && (
                      <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Serviços contratados
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {selected.servicosContratados.map((s) => (
                            <Badge key={s} variant="outline">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
