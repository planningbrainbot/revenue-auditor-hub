import { useMemo, useState } from "react";
import { Clock, MessageCircleMore, Send, SlidersHorizontal } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Phone, TriangleAlert, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNpsExecucao, useAudienciaPorUnidade, useDispararCampanha, useRegistrarRespostaPorLigacao } from "@/hooks/use-nps";
import type { NpsExecucaoRow } from "@/lib/nps.functions";
import { validarTelefone } from "@/lib/telefone";

const SERVICOS_OPCOES = ["Serviço Fiscal", "Serviço Contábil", "Serviço de Folha de Pagamento"];

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
// Sem status = a Meta nunca confirmou nem "enviado" pra esse número — não dá
// pra assumir que a mensagem saiu (pode ser throttling/proteção antispam da
// Meta represando silenciosamente, confirmado em 27/08/2026). "Aguardando
// status" dava a entender que já sabíamos que tinha saído; isso é mais honesto.
type StatusKey = "respondido" | "failed" | "read" | "delivered" | "sent" | "sem_status";

const STATUS_LABELS: Record<StatusKey, string> = {
  respondido: "Respondido",
  failed: "Falhou",
  read: "Lida",
  delivered: "Entregue",
  sent: "Enviado",
  sem_status: "Aguardando disparo",
};

// Ordem de exibição no filtro — do desfecho mais relevante pro mais cru.
const STATUS_ORDEM: StatusKey[] = ["respondido", "failed", "read", "delivered", "sent", "sem_status"];

// Chave única usada tanto pelo badge quanto pelo filtro, pra os dois nunca
// discordarem: respondido ganha do status do webhook.
function statusKey(row: NpsExecucaoRow): StatusKey {
  if (row.respondido) return "respondido";
  switch (row.status) {
    case "failed":
    case "read":
    case "delivered":
    case "sent":
      return row.status;
    default:
      return "sem_status";
  }
}

function statusBadge(row: NpsExecucaoRow) {
  const key = statusKey(row);
  const classes: Record<StatusKey, string> = {
    respondido: "border-emerald-600/30 bg-emerald-600/[0.07] text-emerald-700 dark:text-emerald-400",
    failed: "border-red-600/30 bg-red-600/[0.07] text-red-700 dark:text-red-400",
    read: "border-sky-600/30 bg-sky-600/[0.07] text-sky-700 dark:text-sky-400",
    delivered: "border-muted-foreground/30 bg-muted-foreground/[0.07]",
    sent: "border-amber-600/30 bg-amber-600/[0.07] text-amber-700 dark:text-amber-400",
    sem_status: "",
  };
  return (
    <Badge variant="outline" className={classes[key] || undefined}>
      {STATUS_LABELS[key]}
    </Badge>
  );
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

function RegistrarRespostaLigacaoForm({ row, onDone }: { row: NpsExecucaoRow; onDone: () => void }) {
  const registrar = useRegistrarRespostaPorLigacao();
  const [recebeuMensagem, setRecebeuMensagem] = useState("");
  const [nota, setNota] = useState("");
  const [fiscal, setFiscal] = useState("");
  const [contabil, setContabil] = useState("");
  const [folha, setFolha] = useState("");
  const [servicos, setServicos] = useState<string[]>([]);
  const [nomeAtendente, setNomeAtendente] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);

  const toggleServico = (s: string) =>
    setServicos((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const handleSubmit = async () => {
    if (!row.pesquisaId) {
      toast.error("Essa pesquisa não tem um vínculo válido — não dá pra registrar a resposta.");
      return;
    }
    if (!recebeuMensagem) {
      toast.error("Informe se o cliente confirma ter recebido a mensagem da pesquisa.");
      return;
    }
    if (!nota) {
      toast.error("Informe a nota de recomendação.");
      return;
    }

    let gravacaoUrl: string | undefined;
    if (arquivo) {
      setEnviandoArquivo(true);
      const ext = arquivo.name.split(".").pop() || "bin";
      const path = `${row.pesquisaId}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("nps-gravacoes").upload(path, arquivo);
      setEnviandoArquivo(false);
      if (uploadError) {
        toast.error(`Falha ao subir a gravação: ${uploadError.message}`);
        return;
      }
      const { data: signed } = await supabase.storage.from("nps-gravacoes").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      gravacaoUrl = signed?.signedUrl;
    }

    registrar.mutate(
      {
        pesquisaId: row.pesquisaId,
        telefone: row.telefone,
        npsRecomendacao: nota,
        recebeuMensagem: recebeuMensagem as "sim" | "nao" | "nao_lembra",
        avaliacaoFiscal: fiscal || undefined,
        avaliacaoContabil: contabil || undefined,
        avaliacaoFolhaPagamento: folha || undefined,
        servicosContratados: servicos.length > 0 ? servicos : undefined,
        nomeContato: nomeAtendente || undefined,
        gravacaoUrl,
      },
      {
        onSuccess: () => {
          toast.success("Resposta registrada — a pesquisa aparece como respondida agora.");
          onDone();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao registrar a resposta."),
      },
    );
  };

  const notasValidas = Array.from({ length: 11 }, (_, i) => String(i));

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Phone className="size-4 text-muted-foreground" />
        Registrar resposta colhida por telefone
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Você chegou a receber a mensagem da pesquisa de satisfação? *</Label>
        <Select value={recebeuMensagem} onValueChange={setRecebeuMensagem}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Escolher…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sim">Sim, recebeu</SelectItem>
            <SelectItem value="nao">Não recebeu</SelectItem>
            <SelectItem value="nao_lembra">Não sabe / não lembra</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Nota de recomendação (0-10) *</Label>
        <Select value={nota} onValueChange={setNota}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Escolher nota…" />
          </SelectTrigger>
          <SelectContent>
            {notasValidas.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["Fiscal", fiscal, setFiscal],
            ["Contábil", contabil, setContabil],
            ["Folha", folha, setFolha],
          ] as const
        ).map(([label, value, setter]) => (
          <div key={label} className="space-y-1.5">
            <Label className="text-xs">{label}</Label>
            <Select value={value} onValueChange={setter}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {notasValidas.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Serviços contratados</Label>
        <div className="space-y-1.5">
          {SERVICOS_OPCOES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <Checkbox checked={servicos.includes(s)} onCheckedChange={() => toggleServico(s)} />
              {s}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Quem atendeu a ligação</Label>
        <Input value={nomeAtendente} onChange={(e) => setNomeAtendente(e.target.value)} placeholder="Nome de quem ligou" className="h-9" />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Gravação da ligação (opcional)</Label>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed p-2.5 text-xs text-muted-foreground hover:bg-muted/50">
          <Upload className="size-3.5 shrink-0" />
          {arquivo ? arquivo.name : "Escolher arquivo de áudio ou vídeo…"}
          <input
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <Button onClick={handleSubmit} disabled={registrar.isPending || enviandoArquivo} className="w-full">
        {enviandoArquivo ? "Enviando gravação…" : registrar.isPending ? "Registrando…" : "Registrar resposta"}
      </Button>
    </div>
  );
}

// Custo real observado por mensagem de template Marketing enviada (extrato
// de cobrança da Meta, pricing_analytics, 25-31/08/2026: US$0,3217/msg,
// consistente nos 5 dias). É por mensagem ENVIADA, não por entregue — a
// Meta cobra mesmo quando não confirma o status de volta pra gente.
const CUSTO_POR_MENSAGEM_USD = 0.3217;

function DispararCampanhaCard() {
  const { data: audiencia, isLoading } = useAudienciaPorUnidade();
  const disparar = useDispararCampanha();
  const [unidadeEscolhida, setUnidadeEscolhida] = useState<string>("");

  const linhaEscolhida = audiencia?.rows.find((r) => r.unidade === unidadeEscolhida);
  const custoEstimado = linhaEscolhida ? linhaEscolhida.totalContatos * CUSTO_POR_MENSAGEM_USD : 0;

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
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Isso envia uma mensagem real de WhatsApp (template de pesquisa) pra{" "}
                    <strong className="text-foreground">{linhaEscolhida?.totalContatos ?? "—"} contatos</strong> da lista{" "}
                    <strong className="text-foreground">{unidadeEscolhida}</strong>
                    {linhaEscolhida && linhaEscolhida.jaDisparados > 0
                      ? `, incluindo os ${linhaEscolhida.jaDisparados} que já receberam disparo antes (podem receber de novo)`
                      : ""}
                    . Não tem como cancelar depois de enviado.
                  </p>
                  <p className="rounded-md border border-amber-600/30 bg-amber-600/[0.07] p-2.5 text-amber-800 dark:text-amber-300">
                    Custo estimado:{" "}
                    <strong>
                      US$ {custoEstimado.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>{" "}
                    (~US$ {CUSTO_POR_MENSAGEM_USD.toFixed(4)}/mensagem, cobrado pela Meta no envio — não pela entrega
                    confirmada).
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirm}>Disparar agora</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Clock className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Os envios só saem entre <strong className="font-medium text-foreground">8h e 19h</strong> (horário de
          Brasília) — é uma regra automática do workflow, não manual. Se o lote for grande e não terminar até às
          19h, ele pausa sozinho e retoma às 8h do dia seguinte, sem precisar disparar de novo.
        </span>
      </div>
    </Card>
  );
}

export function NpsExecucaoTab() {
  const { data, isLoading, error, dataUpdatedAt } = useNpsExecucao();
  const [rodada, setRodada] = useState<string>("todas");
  const [unidade, setUnidade] = useState<string>("todas");
  const [status, setStatus] = useState<string>("todos");
  const [soNaoRespondidos, setSoNaoRespondidos] = useState(false);
  const [selected, setSelected] = useState<NpsExecucaoRow | null>(null);

  // Mensagens de texto livre desse contato — cruza por telefone canônico
  // (ignora prefixo 55 e o 9º dígito opcional do celular) já que as duas
  // tabelas guardam o número em formatos diferentes.
  const mensagensDoSelecionado = useMemo(() => {
    if (!selected || !data) return [];
    const alvo = validarTelefone(selected.telefone).digitos;
    return data.textoLivre.filter((t) => validarTelefone(t.telefone).digitos === alvo);
  }, [selected, data]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => {
      if (rodada !== "todas" && r.rodada !== rodada) return false;
      if (unidade !== "todas" && r.unidade !== unidade) return false;
      if (status !== "todos" && statusKey(r) !== status) return false;
      if (soNaoRespondidos && r.respondido) return false;
      return true;
    });
  }, [data, rodada, unidade, status, soNaoRespondidos]);

  // Só oferece no filtro os status que realmente existem nos disparos carregados.
  const statusDisponiveis = useMemo(() => {
    if (!data) return [];
    const presentes = new Set(data.rows.map(statusKey));
    return STATUS_ORDEM.filter((k) => presentes.has(k));
  }, [data]);

  const activeFilters =
    (rodada !== "todas" ? 1 : 0) + (unidade !== "todas" ? 1 : 0) + (status !== "todos" ? 1 : 0) +
    (soNaoRespondidos ? 1 : 0);

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
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
              <span className="text-sm font-medium">Disparos (mais recentes primeiro)</span>
              <div className="flex items-center gap-2">
                <Button
                  variant={soNaoRespondidos ? "default" : "outline"}
                  size="sm"
                  className="gap-2"
                  onClick={() => setSoNaoRespondidos((v) => !v)}
                >
                  <Phone className="size-3.5" />
                  Ligar pra quem não respondeu
                </Button>
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
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Status</span>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        {statusDisponiveis.map((k) => (
                          <SelectItem key={k} value={k}>
                            {STATUS_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </PopoverContent>
              </Popover>
              </div>
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
                  {filteredRows.map((r) => {
                    const validacao = validarTelefone(r.telefone);
                    return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          {r.telefone}
                          {!validacao.valido && (
                            <TriangleAlert
                              className="size-3.5 shrink-0 text-amber-600"
                              aria-label={validacao.motivo ?? "Formato suspeito"}
                            >
                              <title>{validacao.motivo ?? "Formato suspeito"}</title>
                            </TriangleAlert>
                          )}
                        </span>
                      </TableCell>
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
                    );
                  })}
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

                {mensagensDoSelecionado.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <MessageCircleMore className="size-3.5" />
                      Mensagens de texto livre
                    </div>
                    <div className="space-y-2">
                      {mensagensDoSelecionado.map((m) => (
                        <div key={m.id} className="rounded-md border p-2.5 text-sm">
                          <p>{m.texto ?? "—"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">recebida {tempoDecorrido(m.recebidoEm)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!selected.respondido ? (
                  <RegistrarRespostaLigacaoForm row={selected} onDone={() => setSelected(null)} />
                ) : (
                  <>
                    {selected.canalResposta === "ligacao" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="gap-1.5">
                          <Phone className="size-3" />
                          Respondida por telefone
                        </Badge>
                        {selected.recebeuMensagem && (
                          <Badge
                            variant="outline"
                            className={
                              selected.recebeuMensagem === "sim"
                                ? "border-emerald-600/30 bg-emerald-600/[0.07] text-emerald-700 dark:text-emerald-400"
                                : selected.recebeuMensagem === "nao"
                                  ? "border-red-600/30 bg-red-600/[0.07] text-red-700 dark:text-red-400"
                                  : "border-amber-600/30 bg-amber-600/[0.07] text-amber-700 dark:text-amber-400"
                            }
                          >
                            {selected.recebeuMensagem === "sim"
                              ? "Confirma que recebeu a mensagem"
                              : selected.recebeuMensagem === "nao"
                                ? "Diz que NÃO recebeu a mensagem"
                                : "Não lembra se recebeu"}
                          </Badge>
                        )}
                      </div>
                    )}
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

                    {selected.gravacaoUrl && (
                      <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Gravação da ligação
                        </div>
                        <a
                          href={selected.gravacaoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary underline underline-offset-2"
                        >
                          ouvir/baixar gravação
                        </a>
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
