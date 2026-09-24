import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Clock, MessageCircleMore, PhoneCall, RotateCw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  BarraFiltros,
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Procedencia,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { getMyPermissions } from "@/lib/permissions.functions";
import {
  useNpsExecucao,
  useAudienciaPorUnidade,
  useDispararCampanha,
  useDispararPesquisaIndividual,
  useRegistrarRespostaPorLigacao,
  useRegistrarLigacao,
} from "@/hooks/use-nps";
import type { NpsExecucaoRow, NpsLigacaoRow } from "@/lib/nps.functions";
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
  if (cat === "promotor") return <StatusBadge tom="sucesso">Promotor</StatusBadge>;
  if (cat === "neutro") return <StatusBadge tom="atencao">Neutro</StatusBadge>;
  if (cat === "detrator") return <StatusBadge tom="perigo">Detrator</StatusBadge>;
  return null;
}

// "aaaa-mm-dd" → "dd/mm/aaaa" direto da string: `new Date` leria meia-noite
// UTC e mostraria o dia anterior no Brasil.
function dataPura(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
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

const STATUS_TOM: Record<StatusKey, TomStatus> = {
  respondido: "sucesso",
  failed: "perigo",
  read: "info",
  delivered: "neutro",
  sent: "atencao",
  sem_status: "neutro",
};

function statusBadge(row: NpsExecucaoRow) {
  const key = statusKey(row);
  return <StatusBadge tom={STATUS_TOM[key]}>{STATUS_LABELS[key]}</StatusBadge>;
}

// Sem `edit.nps` o servidor recusa o registro; o botão diz isso antes do clique (N8).
// Enquanto a permissão carrega, ou se a leitura falhou, o motivo é esse, não
// "você não tem": dizer que falta a chave antes de saber seria falso.
const MOTIVO_SEM_EDIT_NPS = "Sem a permissão edit.nps: só quem edita NPS registra ligação e resposta.";
const MOTIVO_CONFERINDO = "Conferindo permissão…";
const MOTIVO_FALHA_PERMISSAO = "Não foi possível conferir a permissão edit.nps. Recarregue a página.";

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

type ResultadoLigacao = "" | "nao_atendeu" | "atendeu_retornar" | "atendeu_outro";

// Log de tentativa de ligação — separado da resposta final da pesquisa.
// CS liga, às vezes não atende, às vezes atende e pede pra ligar depois; cada
// tentativa vira uma linha no histórico, sem precisar fechar a pesquisa.
function RegistrarLigacaoForm({
  row,
  historico,
  motivoBloqueio,
}: {
  row: NpsExecucaoRow;
  historico: NpsLigacaoRow[];
  /** `null` = pode registrar; texto = por que o botão está desabilitado. */
  motivoBloqueio: string | null;
}) {
  const registrar = useRegistrarLigacao();
  const [resultado, setResultado] = useState<ResultadoLigacao>("");
  const [retornarEm, setRetornarEm] = useState("");
  const [observacao, setObservacao] = useState("");

  const handleSubmit = () => {
    if (!resultado) {
      toast.error("Escolha o resultado da ligação.");
      return;
    }
    if (resultado === "atendeu_retornar" && !retornarEm) {
      toast.error("Informe a data de retorno.");
      return;
    }
    registrar.mutate(
      {
        pesquisaId: row.pesquisaId,
        telefone: row.telefone,
        atendeu: resultado !== "nao_atendeu",
        retornarEm: resultado === "atendeu_retornar" ? retornarEm : null,
        observacao: observacao.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Ligação registrada.");
          setResultado("");
          setRetornarEm("");
          setObservacao("");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao registrar ligação."),
      },
    );
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <PhoneCall className="size-4 text-muted-foreground" aria-hidden />
        Registrar tentativa de ligação
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Resultado</Label>
        <Select value={resultado} onValueChange={(v) => setResultado(v as ResultadoLigacao)}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Escolher…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nao_atendeu">Não atendeu</SelectItem>
            <SelectItem value="atendeu_retornar">Atendeu — pediu pra ligar depois</SelectItem>
            <SelectItem value="atendeu_outro">Atendeu — outro motivo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {resultado === "atendeu_retornar" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Retornar em</Label>
          <Input type="date" value={retornarEm} onChange={(e) => setRetornarEm(e.target.value)} className="h-9" />
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Observação (opcional)</Label>
        <Input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Ex: pediu pra ligar de manhã"
          className="h-9"
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={registrar.isPending || motivoBloqueio !== null}
        variant="outline"
        className="w-full"
        aria-describedby={motivoBloqueio === null ? undefined : `motivo-ligacao-${row.id}`}
      >
        {registrar.isPending ? "Registrando…" : "Registrar ligação"}
      </Button>
      {motivoBloqueio !== null && (
        <p id={`motivo-ligacao-${row.id}`} className="text-[13px] text-muted-foreground">
          {motivoBloqueio}
        </p>
      )}

      {historico.length > 0 && (
        <div className="space-y-1.5 border-t pt-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Histórico de ligações ({historico.length})
          </span>
          <div className="space-y-1.5">
            {historico.map((l) => (
              <div key={l.id} className="rounded-md border p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span
                    className={l.atendeu ? "font-medium text-success" : "font-medium text-muted-foreground"}
                  >
                    {l.atendeu ? "Atendeu" : "Não atendeu"}
                  </span>
                  <span className="text-muted-foreground">{tempoDecorrido(l.criadoEm)}</span>
                </div>
                {l.retornarEm && (
                  <div className="mt-1 text-warning">Retornar em {dataPura(l.retornarEm)}</div>
                )}
                {l.observacao && <div className="mt-1 text-muted-foreground">{l.observacao}</div>}
                {l.criadoPor && <div className="mt-1 text-xs text-muted-foreground">por {l.criadoPor}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RegistrarRespostaLigacaoForm({
  row,
  onDone,
  motivoBloqueio,
}: {
  row: NpsExecucaoRow;
  onDone: () => void;
  motivoBloqueio: string | null;
}) {
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
        <Phone className="size-4 text-muted-foreground" aria-hidden />
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
        {/* O input fica visível só para leitor de tela e teclado (sr-only, não
            hidden): assim o Tab chega nele e o anel de foco aparece no rótulo. */}
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-input p-2.5 text-xs text-muted-foreground hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background">
          <Upload className="size-4 shrink-0" aria-hidden />
          {arquivo ? arquivo.name : "Escolher arquivo de áudio ou vídeo…"}
          <input
            type="file"
            accept="audio/*,video/*"
            className="sr-only"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={registrar.isPending || enviandoArquivo || motivoBloqueio !== null}
        className="w-full"
        aria-describedby={motivoBloqueio === null ? undefined : `motivo-resposta-${row.id}`}
      >
        {enviandoArquivo ? "Enviando gravação…" : registrar.isPending ? "Registrando…" : "Registrar resposta"}
      </Button>
      {motivoBloqueio !== null && (
        <p id={`motivo-resposta-${row.id}`} className="text-[13px] text-muted-foreground">
          {motivoBloqueio}
        </p>
      )}
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
          <div id="rotulo-disparar" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Disparar campanha
          </div>
          <Select value={unidadeEscolhida} onValueChange={setUnidadeEscolhida} disabled={isLoading}>
            <SelectTrigger className="h-9 w-56" aria-labelledby="rotulo-disparar">
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
              <Send className="size-4" aria-hidden />
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
                  <p className="rounded-md bg-warning-soft p-2.5 text-warning">
                    Custo estimado:{" "}
                    <strong>
                      US$ {custoEstimado.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>{" "}
                    (~US$ {CUSTO_POR_MENSAGEM_USD.toFixed(4)}/mensagem, cobrado pela Meta no envio — não pela entrega
                    confirmada).
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Estimativa em US$ por mensagem; a cobrança real é por conversa, em R$ (aba Custos).
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
        <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Os envios só saem entre <strong className="font-medium text-foreground">8h e 19h</strong> (horário de
          Brasília) — é uma regra automática do workflow, não manual. Se o lote for grande e não terminar até às
          19h, ele pausa sozinho e retoma às 8h do dia seguinte, sem precisar disparar de novo.
        </span>
      </div>
    </Card>
  );
}

// Reenvio pontual — cliente pede na ligação, não é disparo de unidade
// inteira. Reaproveita o mesmo webhook/pipeline (validação de formato, janela
// 8h-19h, alternância de número), só que pra 1 contato.
function ReenviarPesquisaButton({ row }: { row: NpsExecucaoRow }) {
  const reenviar = useDispararPesquisaIndividual();

  const handleConfirm = () => {
    reenviar.mutate(
      {
        telefone: row.telefone,
        empresa: row.empresa,
        unidade: row.unidade,
        nome: row.nomeContato,
        email: row.emailPesquisa,
        empresaId: row.empresaId,
      },
      {
        onSuccess: () => toast.success(`Reenvio pra ${row.empresa ?? row.telefone} iniciado.`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao reenviar."),
      },
    );
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" disabled={reenviar.isPending}>
          <RotateCw className="size-4" aria-hidden />
          {reenviar.isPending ? "Reenviando…" : "Reenviar pesquisa"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reenviar pesquisa pra {row.empresa ?? row.telefone}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                Envia uma nova mensagem real de WhatsApp (template de pesquisa) só pro telefone{" "}
                <strong className="text-foreground">{row.telefone}</strong>. Não afeta os outros contatos da unidade.
                Não tem como cancelar depois de enviado.
              </p>
              <p className="rounded-md bg-warning-soft p-2.5 text-warning">
                Custo estimado: <strong>US$ {CUSTO_POR_MENSAGEM_USD.toFixed(2)}</strong> (cobrado pela Meta no envio).
              </p>
              <p className="text-[13px] text-muted-foreground">
                Estimativa em US$ por mensagem; a cobrança real é por conversa, em R$ (aba Custos).
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Reenviar agora</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type SituacaoLigacao = "todas" | "ja_ligamos" | "agendado" | "nunca_ligamos";
const SITUACOES: { valor: Exclude<SituacaoLigacao, "todas">; rotulo: string }[] = [
  { valor: "nunca_ligamos", rotulo: "Nunca ligamos" },
  { valor: "ja_ligamos", rotulo: "Já ligamos" },
  { valor: "agendado", rotulo: "Agendado para retornar" },
];

const TODAS = "todas";
const TODOS = "todos";
const CHAVES_FILTRO = ["rodada", "unidade", "status", "ligacao", "pendentes"];
const FONTE = "nps_envio_map (webhook de status da Cloud API) · nps_ligacoes";

// A próxima ação da linha (Fila, ARQUETIPOS §2): o que o CS faz com esse
// contato agora, com data quando há retorno marcado. A ação em si acontece no
// Sheet, que a linha abre.
//
// O retorno marcado vem antes da falha de envio: o cliente pediu a ligação, e
// isso vale mais que o status do template. Sem `edit.nps` a pessoa não liga
// nem registra por aqui, então a coluna não promete isso ("Ver contato").
function hojeLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function proximaAcao(
  r: NpsExecucaoRow,
  ultima: NpsLigacaoRow | undefined,
  podeRegistrar: boolean,
): { rotulo: string; vencido: boolean } {
  if (r.respondido) return { rotulo: "Ver resposta", vencido: false };
  if (ultima?.retornarEm) {
    // Comparação de "aaaa-mm-dd" como texto: sem fuso no meio.
    const vencido = ultima.retornarEm.slice(0, 10) < hojeLocal();
    return {
      rotulo: podeRegistrar ? `Ligar em ${dataPura(ultima.retornarEm)}` : "Ver contato",
      vencido,
    };
  }
  if (statusKey(r) === "failed") return { rotulo: "Reenviar", vencido: false };
  if (!podeRegistrar) return { rotulo: "Ver contato", vencido: false };
  if (ultima?.atendeu) return { rotulo: "Registrar resposta", vencido: false };
  if (ultima) return { rotulo: "Ligar de novo", vencido: false };
  return { rotulo: "Ligar", vencido: false };
}

// "atualizado há Ns" que anda sozinho: sem o relógio, o número só mudava
// quando a próxima leitura de 15 s re-renderizava a tela.
function AtualizadoHa({ quando }: { quando: number }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((agora - quando) / 1000));
  const texto = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
  return (
    <span className="num inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="off">
      <Clock className="size-3.5 shrink-0" aria-hidden />
      atualizado há {texto}
    </span>
  );
}

function Filtro({
  valor,
  aoMudar,
  todos,
  padrao,
  opcoes,
  rotulo,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  todos: string;
  padrao: string;
  opcoes: { valor: string; rotulo: string }[];
  rotulo: string;
}) {
  // Valor da URL que não existe mais nas opções continua visível (e removível).
  const lista =
    valor !== padrao && !opcoes.some((o) => o.valor === valor) ? [...opcoes, { valor, rotulo: valor }] : opcoes;
  return (
    <Select value={valor} onValueChange={(v) => aoMudar(v)}>
      <SelectTrigger className="h-8 w-auto min-w-[150px]" aria-label={rotulo}>
        <SelectValue placeholder={rotulo} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={padrao}>{todos}</SelectItem>
        {lista.map((o) => (
          <SelectItem key={o.valor} value={o.valor}>
            {o.rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const NUM = new Intl.NumberFormat("pt-BR");

export function NpsExecucaoTab() {
  const { data, isLoading, error, dataUpdatedAt, refetch } = useNpsExecucao();
  const perms = usePermissions();
  // Mesmo cache do usePermissions (mesma chave), sem buscar de novo: só para
  // saber se a leitura falhou, que o hook não expõe.
  const { user } = useAuth();
  const permsFn = useServerFn(getMyPermissions);
  const permsQuery = useQuery({
    queryKey: ["my-perms", user?.id],
    queryFn: () => permsFn(),
    enabled: false,
  });
  const podeRegistrar = !perms.loading && perms.can("edit.nps");
  const motivoBloqueio: string | null = permsQuery.isError
    ? MOTIVO_FALHA_PERMISSAO
    : perms.loading
      ? MOTIVO_CONFERINDO
      : podeRegistrar
        ? null
        : MOTIVO_SEM_EDIT_NPS;
  const [rodada, setRodada] = useFiltroNaUrl("rodada", TODAS);
  const [unidade, setUnidade] = useFiltroNaUrl("unidade", TODAS);
  const [status, setStatus] = useFiltroNaUrl("status", TODOS);
  const [situacaoLigacao, setSituacaoLigacao] = useFiltroNaUrl("ligacao", TODAS);
  const [soNaoRespondidos, setSoNaoRespondidos] = useFiltroNaUrl("pendentes", false);
  const limparFiltros = useLimparFiltrosNaUrl(CHAVES_FILTRO);
  const [selected, setSelected] = useState<NpsExecucaoRow | null>(null);

  // Mensagens de texto livre desse contato — cruza por telefone canônico
  // (ignora prefixo 55 e o 9º dígito opcional do celular) já que as duas
  // tabelas guardam o número em formatos diferentes.
  const mensagensDoSelecionado = useMemo(() => {
    if (!selected || !data) return [];
    const alvo = validarTelefone(selected.telefone).digitos;
    return data.textoLivre.filter((t) => validarTelefone(t.telefone).digitos === alvo);
  }, [selected, data]);

  // Ligações por telefone canônico, mais recente primeiro (já vem ordenado
  // desc do servidor) — usado pro badge na tabela, pro histórico no painel e
  // pros contadores "já ligamos" / "agendado pra retornar".
  const ligacoesPorTelefone = useMemo(() => {
    const map = new Map<string, NpsLigacaoRow[]>();
    if (!data) return map;
    for (const l of data.ligacoes) {
      const key = validarTelefone(l.telefone).digitos;
      const list = map.get(key) ?? [];
      list.push(l);
      map.set(key, list);
    }
    return map;
  }, [data]);

  const ligacoesDoSelecionado = useMemo(() => {
    if (!selected) return [];
    return ligacoesPorTelefone.get(validarTelefone(selected.telefone).digitos) ?? [];
  }, [selected, ligacoesPorTelefone]);

  // "Agendado pra retornar" olha só a tentativa MAIS RECENTE de cada
  // telefone — uma ligação nova sem retornar_em fecha o agendamento anterior.
  const totalAgendados = useMemo(() => {
    let count = 0;
    for (const list of ligacoesPorTelefone.values()) {
      if (list[0]?.retornarEm) count += 1;
    }
    return count;
  }, [ligacoesPorTelefone]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => {
      if (rodada !== TODAS && r.rodada !== rodada) return false;
      if (unidade !== TODAS && r.unidade !== unidade) return false;
      if (status !== TODOS && statusKey(r) !== status) return false;
      if (soNaoRespondidos && r.respondido) return false;
      if (situacaoLigacao !== TODAS) {
        const list = ligacoesPorTelefone.get(validarTelefone(r.telefone).digitos) ?? [];
        if (situacaoLigacao === "nunca_ligamos" && list.length > 0) return false;
        if (situacaoLigacao === "ja_ligamos" && list.length === 0) return false;
        if (situacaoLigacao === "agendado" && !list[0]?.retornarEm) return false;
      }
      return true;
    });
  }, [data, rodada, unidade, status, soNaoRespondidos, situacaoLigacao, ligacoesPorTelefone]);

  // Só oferece no filtro os status que realmente existem nos disparos carregados.
  const statusDisponiveis = useMemo(() => {
    if (!data) return [];
    const presentes = new Set(data.rows.map(statusKey));
    return STATUS_ORDEM.filter((k) => presentes.has(k));
  }, [data]);

  // Frescor = o evento mais recente que a fonte devolve (envio, status do
  // webhook ou ligação registrada), não a hora em que a tela leu.
  const ultimoEvento = useMemo(() => {
    if (!data) return null;
    // Date.parse, não comparação de texto: timestamptz pode vir com "Z" ou "+00:00".
    let max = 0;
    const ver = (iso: string | null) => {
      const t = iso ? Date.parse(iso) : NaN;
      if (Number.isFinite(t) && t > max) max = t;
    };
    for (const r of data.rows) {
      ver(r.enviadoEm);
      ver(r.statusAtualizadoEm);
    }
    for (const l of data.ligacoes) ver(l.criadoEm);
    return max > 0 ? new Date(max) : null;
  }, [data]);

  const temFiltro =
    rodada !== TODAS || unidade !== TODAS || status !== TODOS || situacaoLigacao !== TODAS || soNaoRespondidos;

  let conteudo: ReactNode;
  if (isLoading) {
    conteudo = (
      <div className="space-y-4">
        <Carregando variante="kpis" />
        <Carregando variante="tabela" />
      </div>
    );
  } else if (error || !data) {
    conteudo = (
      <EstadoErro
        titulo="Não foi possível carregar os disparos"
        detalhe={`Fonte: ${FONTE}: ${error instanceof Error ? error.message : String(error ?? "sem resposta")}`}
        tentarNovamente={() => void refetch()}
      />
    );
  } else {
    conteudo = (
      <>
        <Secao
          titulo="Como está a rodada?"
          descricao="Enviados, respondidos, aguardando e falhas contam os últimos 500 envios. Ligações contam todas as registradas (até 1.000), fora desse recorte. Os KPIs não obedecem aos filtros da tabela."
        >
          <KpiGrade colunas={6}>
            <KpiCard rotulo="Enviados" valor={NUM.format(data.totalEnviados)} nota="dos últimos 500 envios" />
            <KpiCard rotulo="Respondidos" valor={NUM.format(data.totalRespondidos)} />
            <KpiCard rotulo="Aguardando" valor={NUM.format(data.totalAguardando)} nota="sem resposta e sem falha" />
            <KpiCard
              rotulo="Falhas"
              valor={NUM.format(data.totalFalhas)}
              tom={data.totalFalhas > 0 ? "perigo" : undefined}
            />
            <KpiCard
              rotulo="Ligações feitas"
              valor={NUM.format(data.ligacoes.length)}
              nota={`${NUM.format(ligacoesPorTelefone.size)} contatos ligados`}
            />
            <KpiCard
              rotulo="Agendados para retornar"
              valor={NUM.format(totalAgendados)}
              nota="última ligação com retorno marcado"
            />
          </KpiGrade>
        </Secao>

        <Secao
          titulo="Para quem eu ligo agora?"
          descricao="Mais recentes primeiro. Clique na linha para abrir o contato, ligar, registrar a resposta ou reenviar."
          acoes={
            <span className="num text-[13px] text-muted-foreground">
              {NUM.format(filteredRows.length)} de {NUM.format(data.rows.length)}
            </span>
          }
        >
          <BarraFiltros aoLimpar={temFiltro ? limparFiltros : undefined}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={soNaoRespondidos}
              className={soNaoRespondidos ? "gap-2 border-input bg-muted" : "gap-2"}
              onClick={() => setSoNaoRespondidos(!soNaoRespondidos)}
            >
              <Phone className="size-4" aria-hidden />
              Só quem não respondeu
            </Button>
            <Filtro
              rotulo="Rodada"
              valor={rodada}
              aoMudar={setRodada}
              padrao={TODAS}
              todos="Todas as rodadas"
              opcoes={data.rodadas.map((r) => ({ valor: r, rotulo: r }))}
            />
            <Filtro
              rotulo="Unidade"
              valor={unidade}
              aoMudar={setUnidade}
              padrao={TODAS}
              todos="Todas as unidades"
              opcoes={data.unidades.map((u) => ({ valor: u, rotulo: u }))}
            />
            <Filtro
              rotulo="Status"
              valor={status}
              aoMudar={setStatus}
              padrao={TODOS}
              todos="Todos os status"
              opcoes={statusDisponiveis.map((k) => ({ valor: k, rotulo: STATUS_LABELS[k] }))}
            />
            <Filtro
              rotulo="Situação da ligação"
              valor={situacaoLigacao}
              aoMudar={setSituacaoLigacao}
              padrao={TODAS}
              todos="Todas as situações"
              opcoes={SITUACOES}
            />
          </BarraFiltros>

          {data.rows.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum disparo ainda"
              descricao='Assim que o workflow "NPS - Criar Card e Enviar WhatsApp" rodar, os envios aparecem aqui.'
            />
          ) : filteredRows.length === 0 ? (
            <EstadoVazio titulo="Nenhum disparo com esses filtros" total={data.rows.length} />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card [&>div]:max-h-[600px]">
              <Table>
                <TableHeader grudavel>
                  <TableRow>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Rodada</TableHead>
                    <TableHead>Enviado há</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ligação</TableHead>
                    <TableHead className="num text-right">NPS</TableHead>
                    <TableHead>Próxima ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((r) => {
                    const validacao = validarTelefone(r.telefone);
                    const ligacoesDoContato = ligacoesPorTelefone.get(validacao.digitos) ?? [];
                    const ultimaLigacao = ligacoesDoContato[0];
                    const abrir = () => setSelected(r);
                    const acao = proximaAcao(r, ultimaLigacao, podeRegistrar);
                    return (
                      <TableRow
                        key={r.id}
                        tabIndex={0}
                        aria-haspopup="dialog"
                        onClick={abrir}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            abrir();
                          }
                        }}
                        // Outline no <tr> (Chrome/Firefox) e anel inset nas células,
                        // porque o Safari não desenha outline em linha de tabela.
                        className="cursor-pointer focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:[&>td]:shadow-[inset_0_2px_0_0_var(--ring),inset_0_-2px_0_0_var(--ring)] focus-visible:[&>td:first-child]:shadow-[inset_2px_0_0_0_var(--ring),inset_0_2px_0_0_var(--ring),inset_0_-2px_0_0_var(--ring)] focus-visible:[&>td:last-child]:shadow-[inset_-2px_0_0_0_var(--ring),inset_0_2px_0_0_var(--ring),inset_0_-2px_0_0_var(--ring)]"
                      >
                        <TableCell className="font-mono text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            {r.telefone}
                            {!validacao.valido && (
                              <TriangleAlert
                                className="size-3.5 shrink-0 text-warning"
                                aria-label={validacao.motivo ?? "Formato suspeito"}
                              >
                                <title>{validacao.motivo ?? "Formato suspeito"}</title>
                              </TriangleAlert>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">
                          <span className="sr-only">Abrir </span>
                          {r.empresa ?? "—"}
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
                        <TableCell>
                          {ligacoesDoContato.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {ligacoesDoContato.length}x · {ultimaLigacao.atendeu ? "atendeu" : "não atendeu"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="num text-right">{r.npsRecomendacao ?? "—"}</TableCell>
                        <TableCell>
                          {/* Texto, não botão: a linha inteira já é o controle
                              (um segundo alvo de Tab por linha dobraria o caminho). */}
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <span className="text-[13px] font-medium text-primary-text">{acao.rotulo} →</span>
                            {acao.vencido && <StatusBadge tom="atencao">vencido</StatusBadge>}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <Procedencia fonte={FONTE} atualizadoEm={ultimoEvento} />
        </Secao>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Acompanha os disparos feitos pelo workflow de WhatsApp. A leitura se renova sozinha a cada 15 s.
        </p>
        {dataUpdatedAt > 0 && <AtualizadoHa quando={dataUpdatedAt} />}
      </div>

      <DispararCampanhaCard />

      {conteudo}

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
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Status do disparo
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {statusBadge(selected)}
                    <span className="text-xs text-muted-foreground">enviado {tempoDecorrido(selected.enviadoEm)}</span>
                  </div>
                  {selected.status === "failed" && erroResumo(selected.erro) && (
                    <p className="mt-2 text-xs text-danger">{erroResumo(selected.erro)}</p>
                  )}
                  <div className="mt-3">
                    <ReenviarPesquisaButton row={selected} />
                  </div>
                </div>

                {mensagensDoSelecionado.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <MessageCircleMore className="size-4" aria-hidden />
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
                  <>
                    <RegistrarLigacaoForm
                      row={selected}
                      historico={ligacoesDoSelecionado}
                      motivoBloqueio={motivoBloqueio}
                    />
                    <RegistrarRespostaLigacaoForm
                      row={selected}
                      onDone={() => setSelected(null)}
                      motivoBloqueio={motivoBloqueio}
                    />
                  </>
                ) : (
                  <>
                    {selected.canalResposta === "ligacao" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tom="neutro" icone={Phone}>
                          Respondida por telefone
                        </StatusBadge>
                        {selected.recebeuMensagem && (
                          <StatusBadge
                            tom={
                              selected.recebeuMensagem === "sim"
                                ? "sucesso"
                                : selected.recebeuMensagem === "nao"
                                  ? "perigo"
                                  : "atencao"
                            }
                          >
                            {selected.recebeuMensagem === "sim"
                              ? "Confirma que recebeu a mensagem"
                              : selected.recebeuMensagem === "nao"
                                ? "Diz que NÃO recebeu a mensagem"
                                : "Não lembra se recebeu"}
                          </StatusBadge>
                        )}
                      </div>
                    )}
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Recomendação (NPS)
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="num text-2xl font-semibold">{selected.npsRecomendacao ?? "—"}</span>
                        {npsBadge(categorize(selected.npsRecomendacao))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Contato que respondeu
                      </div>
                      <div className="text-sm">{selected.nomeContato ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{selected.emailPesquisa ?? "—"}</div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Avaliação por serviço (CSAT)
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-md border p-2">
                          <div className="text-xs text-muted-foreground">Fiscal</div>
                          <div className="num text-lg font-semibold">{selected.avaliacaoFiscal ?? "—"}</div>
                        </div>
                        <div className="rounded-md border p-2">
                          <div className="text-xs text-muted-foreground">Contábil</div>
                          <div className="num text-lg font-semibold">{selected.avaliacaoContabil ?? "—"}</div>
                        </div>
                        <div className="rounded-md border p-2">
                          <div className="text-xs text-muted-foreground">Folha</div>
                          <div className="num text-lg font-semibold">{selected.avaliacaoFolhaPagamento ?? "—"}</div>
                        </div>
                      </div>
                    </div>

                    {selected.servicosContratados && selected.servicosContratados.length > 0 && (
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Gravação da ligação
                        </div>
                        <a
                          href={selected.gravacaoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-sm text-xs text-primary-text underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
