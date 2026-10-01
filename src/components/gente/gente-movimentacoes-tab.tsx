import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRightLeft, Download, FileSpreadsheet, Mail, Plus, Send, Wallet } from "lucide-react";
import {
  MOTIVOS_MOVIMENTACAO,
  cancelarMovimentacao,
  criarMovimentacao,
  documentoMovimentacao,
  enviarMovimentacao,
  importarSalarios,
  listMovimentacoes,
  salvarEmailDp,
  type LinhaSalario,
  type MovimentacaoRow,
  type PessoaRemuneracao,
  type ResultadoSalario,
} from "@/lib/gente-movimentacoes.functions";
import { fmtSalario, gerarPdf, gerarXlsx, nomeArquivo } from "@/lib/gente-movimentacao-documento";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Carregando, EstadoSemAcesso, EstadoVazio, StatusBadge } from "@/components/planning";
import { ErroDaFonte } from "@/components/gente/estados-gente";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Movimentações (`/gente?tela=movimentacoes`), 01/10/2026, pedido do RH de
// Maceió. Só aparece para quem tem `manage.gente.remuneracao` (RH e admin).

const NA = "—";
const fmtData = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : NA;
const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const VINCULOS = [
  { v: "clt", t: "CLT" },
  { v: "pj", t: "PJ" },
  { v: "socio", t: "Sócio" },
  { v: "estagio", t: "Estágio" },
  { v: "prolabore", t: "Pró-labore" },
  { v: "terceiro", t: "Terceiro" },
];

/** "R$ 2.500,00", "2500,00", "2.500" ou número do Excel. */
function lerValor(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "")
    .replace(/[R$\s]/g, "")
    .trim();
  if (!s) return NaN;
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return Number(normal);
}

function lerData(v: unknown): string | null {
  if (v === "" || v == null) return null;
  if (typeof v === "number") {
    const t = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function baixar(buf: ArrayBuffer, nome: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([buf], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

function EmailDp({
  unidades,
}: {
  unidades: { id: number; nome: string; emailDp: string | null }[];
}) {
  const fn = useServerFn(salvarEmailDp);
  const qc = useQueryClient();
  const [valores, setValores] = useState<Record<number, string>>(() =>
    Object.fromEntries(unidades.map((u) => [u.id, u.emailDp ?? ""])),
  );
  const salvar = useMutation({
    mutationFn: (u: { id: number }) =>
      fn({ data: { unidadeId: u.id, email: valores[u.id] ?? "" } }),
    onSuccess: () => {
      toast.success("E-mail do Departamento Pessoal salvo.");
      qc.invalidateQueries({ queryKey: ["gente-movimentacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center gap-2">
        <Mail className="h-4 w-4 text-primary-text" />
        <h3 className="font-semibold">Para onde vai a movimentação</h3>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">
        O e-mail do Departamento Pessoal que recebe cada movimentação enviada, com PDF e Excel em
        anexo.
      </p>
      <div className="grid gap-2">
        {unidades.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-2">
            {unidades.length > 1 ? <span className="w-32 text-sm">{u.nome}</span> : null}
            <Input
              type="email"
              className="h-8 w-72"
              placeholder="dp@empresa.com.br"
              value={valores[u.id] ?? ""}
              onChange={(e) => setValores((s) => ({ ...s, [u.id]: e.target.value }))}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => salvar.mutate(u)}
              disabled={salvar.isPending || (valores[u.id] ?? "") === (u.emailDp ?? "")}
            >
              Salvar
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CarregarSalariosDialog() {
  const fn = useServerFn(importarSalarios);
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<(LinhaSalario & { problema: string | null })[]>([]);
  const [resultados, setResultados] = useState<ResultadoSalario[] | null>(null);

  const validas = linhas.filter((l) => !l.problema);
  const enviar = useMutation({
    mutationFn: () => fn({ data: { linhas: validas.map(({ problema: _p, ...l }) => l) } }),
    onSuccess: ({ resultados: r }) => {
      setResultados(r);
      toast.success(
        `${r.filter((x) => x.situacao === "carregado").length} salário(s) carregado(s).`,
      );
      qc.invalidateQueries({ queryKey: ["gente-movimentacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ler = async (f: File) => {
    setResultados(null);
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const bruto = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
      defval: "",
      raw: true,
    });
    const lidas = bruto
      .map((r, i) => {
        let email = "";
        let salario: unknown = "";
        let vigencia: unknown = "";
        for (const [h, v] of Object.entries(r)) {
          const k = semAcento(h);
          if (/e-?mail/.test(k))
            email = String(v ?? "")
              .trim()
              .toLowerCase();
          else if (/salario|remuneracao|valor/.test(k)) salario = v;
          else if (/vigencia|desde|data/.test(k)) vigencia = v;
        }
        const valor = lerValor(salario);
        const vig = lerData(vigencia) ?? hojeISO();
        const problema = !email
          ? "sem e-mail"
          : !Number.isFinite(valor) || valor <= 0
            ? "salário inválido"
            : vigencia !== "" && !lerData(vigencia)
              ? "vigência inválida"
              : null;
        return { linha: i + 2, email, salario: valor, vigencia: vig, problema };
      })
      .filter((l) => l.email || Number.isFinite(l.salario));
    if (!lidas.length) toast.error("Não achei linhas. Use o modelo: E-mail, Salário, Vigência.");
    setLinhas(lidas);
  };

  const modelo = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["E-mail", "Salário", "Vigência"],
      ["maria.souza@planning.com.br", 3500, "01/01/2026"],
    ]);
    ws["!cols"] = [{ wch: 34 }, { wch: 14 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Salários");
    XLSX.writeFile(wb, "modelo-salarios.xlsx");
  };

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (!o) {
          setLinhas([]);
          setResultados(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Carregar salários
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Carregar salários por planilha</DialogTitle>
          <DialogDescription>
            Uma pessoa por linha, pelo e-mail do cadastro, com o salário e a data desde quando ele
            vale (sem data, vale a partir de hoje). Carregar de novo não apaga o anterior: o mais
            recente passa a ser o atual.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={modelo}>
            <Download className="mr-2 h-4 w-4" />
            Baixar modelo
          </Button>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void ler(f);
              e.target.value = "";
            }}
          />
        </div>
        {linhas.length ? (
          <div className="max-h-72 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Linha</th>
                  <th className="px-3 py-2 text-left">E-mail</th>
                  <th className="px-3 py-2 text-right">Salário</th>
                  <th className="px-3 py-2 text-left">Vigência</th>
                  <th className="px-3 py-2 text-left">{resultados ? "Resultado" : "Problema"}</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const r = resultados?.find((x) => x.linha === l.linha);
                  const ruim = l.problema || (r && r.situacao !== "carregado");
                  return (
                    <tr key={l.linha} className={"border-t " + (ruim ? "bg-danger-soft" : "")}>
                      <td className="px-3 py-1.5 tabular-nums">{l.linha}</td>
                      <td className="px-3 py-1.5">{l.email}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {Number.isFinite(l.salario) ? fmtSalario(l.salario) : NA}
                      </td>
                      <td className="px-3 py-1.5">{fmtData(l.vigencia)}</td>
                      <td className="px-3 py-1.5">
                        {r ? (r.situacao === "carregado" ? "carregado" : r.mensagem) : l.problema}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setAberto(false)}>
            {resultados ? "Fechar" : "Cancelar"}
          </Button>
          {!resultados ? (
            <Button onClick={() => enviar.mutate()} disabled={!validas.length || enviar.isPending}>
              {enviar.isPending ? "Carregando…" : `Carregar ${validas.length || ""}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SEM = "__sem__";

function NovaMovimentacaoDialog({ pessoas }: { pessoas: PessoaRemuneracao[] }) {
  const fn = useServerFn(criarMovimentacao);
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [pessoaId, setPessoaId] = useState("");
  const [vigencia, setVigencia] = useState(hojeISO());
  const [motivo, setMotivo] = useState(MOTIVOS_MOVIMENTACAO[0]);
  const [obs, setObs] = useState("");
  const [muda, setMuda] = useState({
    salario: false,
    cargo: false,
    depto: false,
    gestor: false,
    vinculo: false,
  });
  const [salario, setSalario] = useState("");
  const [cargo, setCargo] = useState("");
  const [depto, setDepto] = useState("");
  const [gestor, setGestor] = useState(SEM);
  const [vinculo, setVinculo] = useState("clt");

  const pessoa = pessoas.find((p) => String(p.id) === pessoaId) ?? null;
  const candidatosGestor = pessoas.filter(
    (p) =>
      p.status === "ativo" && p.id !== pessoa?.id && (!pessoa || p.unidadeId === pessoa.unidadeId),
  );
  const valor = lerValor(salario);

  const limpar = () => {
    setPessoaId("");
    setVigencia(hojeISO());
    setMotivo(MOTIVOS_MOVIMENTACAO[0]);
    setObs("");
    setMuda({ salario: false, cargo: false, depto: false, gestor: false, vinculo: false });
    setSalario("");
    setCargo("");
    setDepto("");
    setGestor(SEM);
  };

  const criar = useMutation({
    mutationFn: () =>
      fn({
        data: {
          pessoaId: Number(pessoaId),
          vigencia,
          motivo,
          observacao: obs,
          salarioDepois: muda.salario ? valor : null,
          cargoDepois: muda.cargo ? cargo : null,
          departamentoDepois: muda.depto ? depto : null,
          gestorDepoisId: muda.gestor && gestor !== SEM ? Number(gestor) : null,
          vinculoDepois: muda.vinculo ? vinculo : null,
        },
      }),
    onSuccess: () => {
      toast.success("Movimentação salva como rascunho. Confira e envie ao DP.");
      setAberto(false);
      limpar();
      qc.invalidateQueries({ queryKey: ["gente-movimentacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const marcar = (k: keyof typeof muda) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setMuda((s) => ({ ...s, [k]: e.target.checked }));

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (!o) limpar();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Nova movimentação
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova movimentação</DialogTitle>
          <DialogDescription>
            Fica em rascunho até você enviar ao Departamento Pessoal. No dia da vigência o cadastro
            e o salário são atualizados sozinhos.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mv-pessoa">Pessoa</Label>
            <Select value={pessoaId} onValueChange={setPessoaId}>
              <SelectTrigger id="mv-pessoa">
                <SelectValue placeholder="Escolha a pessoa" />
              </SelectTrigger>
              <SelectContent>
                {pessoas.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pessoa ? (
              <p className="text-[13px] text-muted-foreground">
                Hoje: {pessoa.cargo ?? "sem cargo"} · {pessoa.departamento ?? "sem setor"} · gestor{" "}
                {pessoa.gestorNome ?? "não definido"} · salário {fmtSalario(pessoa.salarioAtual)}
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="mv-vig">Vigência</Label>
              <Input
                id="mv-vig"
                type="date"
                value={vigencia}
                onChange={(e) => setVigencia(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mv-motivo">Motivo</Label>
              <Select value={motivo} onValueChange={setMotivo}>
                <SelectTrigger id="mv-motivo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOTIVOS_MOVIMENTACAO.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2 rounded-md border p-3">
            <span className="text-sm font-medium">O que muda</span>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={muda.salario} onChange={marcar("salario")} /> Salário
            </label>
            {muda.salario ? (
              <div className="grid gap-1 pl-6">
                <Input
                  inputMode="decimal"
                  placeholder="Novo salário, ex.: 3.200,00"
                  value={salario}
                  onChange={(e) => setSalario(e.target.value)}
                />
                <span className="text-[12px] text-muted-foreground">
                  De {fmtSalario(pessoa?.salarioAtual)} para{" "}
                  {Number.isFinite(valor) && valor > 0 ? fmtSalario(valor) : NA}
                  {pessoa?.salarioAtual && Number.isFinite(valor) && valor > 0
                    ? ` (${valor >= pessoa.salarioAtual ? "+" : ""}${(((valor - pessoa.salarioAtual) / pessoa.salarioAtual) * 100).toFixed(1).replace(".", ",")}%)`
                    : ""}
                </span>
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={muda.cargo} onChange={marcar("cargo")} /> Cargo
            </label>
            {muda.cargo ? (
              <Input
                className="ml-6 w-auto"
                placeholder="Novo cargo"
                value={cargo}
                onChange={(e) => setCargo(e.target.value)}
              />
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={muda.depto} onChange={marcar("depto")} /> Setor
            </label>
            {muda.depto ? (
              <Input
                className="ml-6 w-auto"
                placeholder="Novo setor"
                value={depto}
                onChange={(e) => setDepto(e.target.value)}
              />
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={muda.gestor} onChange={marcar("gestor")} /> Gestor
            </label>
            {muda.gestor ? (
              <div className="pl-6">
                <Select value={gestor} onValueChange={setGestor}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM}>Escolha o novo gestor</SelectItem>
                    {candidatosGestor.map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>
                        {g.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={muda.vinculo} onChange={marcar("vinculo")} /> Vínculo
            </label>
            {muda.vinculo ? (
              <div className="pl-6">
                <Select value={vinculo} onValueChange={setVinculo}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VINCULOS.map((v) => (
                      <SelectItem key={v.v} value={v.v}>
                        {v.t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="mv-obs">Observação para o DP (opcional)</Label>
            <Textarea id="mv-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
          <Button onClick={() => criar.mutate()} disabled={!pessoaId || criar.isPending}>
            {criar.isPending ? "Salvando…" : "Salvar rascunho"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AcoesMovimentacao({ m, temEmailDp }: { m: MovimentacaoRow; temEmailDp: boolean }) {
  const docFn = useServerFn(documentoMovimentacao);
  const enviarFn = useServerFn(enviarMovimentacao);
  const cancelarFn = useServerFn(cancelarMovimentacao);
  const qc = useQueryClient();
  const [confirmar, setConfirmar] = useState(false);

  const baixarDoc = async (formato: "pdf" | "xlsx") => {
    try {
      const doc = await docFn({ data: { id: m.id } });
      if (formato === "pdf")
        baixar(await gerarPdf(doc), nomeArquivo(doc, "pdf"), "application/pdf");
      else
        baixar(
          await gerarXlsx(doc),
          nomeArquivo(doc, "xlsx"),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar o arquivo.");
    }
  };

  const enviar = useMutation({
    mutationFn: () => enviarFn({ data: { id: m.id } }),
    onSuccess: (r) => {
      toast.success(
        `Enviada para ${r.enviadaPara}.${r.aplicadaAgora ? " A vigência já começou: cadastro e salário atualizados." : " O cadastro muda no dia da vigência."}`,
      );
      setConfirmar(false);
      qc.invalidateQueries({ queryKey: ["gente-movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["gente"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelar = useMutation({
    mutationFn: () => cancelarFn({ data: { id: m.id } }),
    onSuccess: () => {
      toast.success("Movimentação cancelada.");
      qc.invalidateQueries({ queryKey: ["gente-movimentacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() => void baixarDoc("pdf")}
      >
        PDF
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() => void baixarDoc("xlsx")}
      >
        Excel
      </Button>
      {m.status === "rascunho" ? (
        confirmar ? (
          <>
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => enviar.mutate()}
              disabled={enviar.isPending}
            >
              {enviar.isPending ? "Enviando…" : "Confirmar envio"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setConfirmar(false)}
            >
              Voltar
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setConfirmar(true)}
              disabled={!temEmailDp}
              title={temEmailDp ? undefined : "Cadastre o e-mail do DP acima"}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              Enviar ao DP
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-danger"
              onClick={() => cancelar.mutate()}
              disabled={cancelar.isPending}
            >
              Cancelar
            </Button>
          </>
        )
      ) : null}
    </div>
  );
}

function situacao(m: MovimentacaoRow) {
  if (m.status === "cancelada") return <StatusBadge tom="neutro">cancelada</StatusBadge>;
  if (m.status === "rascunho") return <StatusBadge tom="info">rascunho</StatusBadge>;
  if (m.aplicadaEm) return <StatusBadge tom="sucesso">aplicada</StatusBadge>;
  return <StatusBadge tom="atencao">enviada, vigência futura</StatusBadge>;
}

export function GenteMovimentacoesTab() {
  const fn = useServerFn(listMovimentacoes);
  const q = useQuery({ queryKey: ["gente-movimentacoes"], queryFn: () => fn() });
  const [busca, setBusca] = useState("");

  const pessoas = useMemo(() => q.data?.pessoas ?? [], [q.data]);
  const filtradas = useMemo(() => {
    const t = semAcento(busca.trim());
    return t ? pessoas.filter((p) => semAcento(p.nome).includes(t)) : pessoas;
  }, [pessoas, busca]);

  if (q.isLoading) return <Carregando variante="tabela" linhas={4} />;
  if (q.isError)
    return <ErroDaFonte fonte="as movimentações" erro={q.error} tentar={() => q.refetch()} />;
  if (!q.data?.podeVer) return <EstadoSemAcesso oQueFalta="manage.gente.remuneracao" />;

  const { unidades, movimentacoes } = q.data;
  const emailPorUnidade = new Map(unidades.map((u) => [u.nome, u.emailDp]));
  const semSalario = pessoas.filter((p) => p.status === "ativo" && p.salarioAtual == null).length;

  return (
    <div className="space-y-4">
      {unidades.length ? <EmailDp unidades={unidades} /> : null}

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-primary-text" />
          <h3 className="font-semibold">Movimentações</h3>
          <div className="ml-auto">
            <NovaMovimentacaoDialog pessoas={pessoas.filter((p) => p.status !== "desligado")} />
          </div>
        </div>
        {movimentacoes.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead>Vigência</TableHead>
                <TableHead>O que muda</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {movimentacoes.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="font-medium">{m.pessoaNome}</div>
                    <div className="text-[13px] text-muted-foreground">
                      #{m.id}
                      {m.criadoPor ? ` · ${m.criadoPor}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="num">{fmtData(m.vigencia)}</TableCell>
                  <TableCell className="text-[13px]">
                    {m.mudancas.map(([c, a, d]) => (
                      <div key={c}>
                        <span className="font-medium">{c}:</span> {a} → {d}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="text-[13px]">{m.motivo ?? NA}</TableCell>
                  <TableCell>
                    {situacao(m)}
                    {m.enviadaEm ? (
                      <div className="mt-1 text-[12px] text-muted-foreground">
                        {new Date(m.enviadaEm).toLocaleDateString("pt-BR")} para {m.enviadaPara}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <AcoesMovimentacao
                      m={m}
                      temEmailDp={Boolean(m.unidade && emailPorUnidade.get(m.unidade))}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EstadoVazio
            titulo="Nenhuma movimentação ainda"
            descricao="Registre uma mudança de salário, cargo, setor, gestor ou vínculo em Nova movimentação."
          />
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Wallet className="h-4 w-4 text-primary-text" />
          <h3 className="font-semibold">Salário atual</h3>
          {semSalario ? (
            <span className="text-[13px] text-muted-foreground">
              {semSalario} pessoa(s) ativa(s) sem salário carregado
            </span>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Input
              className="h-8 w-56"
              placeholder="Buscar pessoa"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <CarregarSalariosDialog />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pessoa</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Setor</TableHead>
              <TableHead className="text-right">Salário</TableHead>
              <TableHead>Desde</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.nome}</div>
                  <div className="text-[13px] text-muted-foreground">
                    {[p.unidade, p.status === "afastado" ? "afastada" : null]
                      .filter(Boolean)
                      .join(" · ") || NA}
                  </div>
                </TableCell>
                <TableCell>{p.cargo ?? NA}</TableCell>
                <TableCell>{p.departamento ?? NA}</TableCell>
                <TableCell className="num text-right">{fmtSalario(p.salarioAtual)}</TableCell>
                <TableCell className="num">{fmtData(p.salarioVigencia)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
