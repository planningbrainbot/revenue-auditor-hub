import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, AlertTriangle, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useRepasses } from "@/hooks/use-repasses";
import { normalizeUnitName, unitMatches } from "@/hooks/use-permissions";
import { brl } from "./format";
import type { TipoRepasse } from "@/lib/repasses.functions";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  tipo: TipoRepasse;
  unidadesConhecidas: string[];
}

interface ParsedRow {
  unidadeArquivo: string;
  valor: number;
  unidadeMatch: string | null; // nome canônico ou null
}

function matchUnit(raw: string, known: string[]): string | null {
  for (const k of known) {
    if (unitMatches(k, raw)) return k;
  }
  const norm = normalizeUnitName(raw);
  for (const k of known) {
    if (normalizeUnitName(k).includes(norm) || norm.includes(normalizeUnitName(k))) return k;
  }
  return null;
}

function parseValor(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const cleaned = v.replace(/[R$\s.]/g, "").replace(",", ".");
  return Number(cleaned);
}

export function ImportRepassesDialog({ open, onClose, tipo, unidadesConhecidas }: Props) {
  const { importar } = useRepasses(tipo);
  const today = new Date();
  const defaultComp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [competencia, setCompetencia] = useState(defaultComp); // YYYY-MM
  const [arquivoNome, setArquivoNome] = useState<string>("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [overrides, setOverrides] = useState<Record<number, string>>({});

  const handleFile = async (file: File) => {
    setArquivoNome(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const arr = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed: ParsedRow[] = [];
      for (const r of arr) {
        const keys = Object.keys(r);
        const kUnidade = keys.find((k) => /unidade|praca|praça|nome/i.test(k));
        const kValor = keys.find((k) => /valor|total|recebid/i.test(k));
        if (!kUnidade || !kValor) continue;
        const unidade = String(r[kUnidade] ?? "").trim();
        const valor = parseValor(r[kValor]);
        if (!unidade || !Number.isFinite(valor)) continue;
        parsed.push({
          unidadeArquivo: unidade,
          valor,
          unidadeMatch: matchUnit(unidade, unidadesConhecidas),
        });
      }
      if (parsed.length === 0) {
        toast.error("Não encontrei colunas de 'unidade' e 'valor' na planilha.");
        return;
      }
      setRows(parsed);
      setOverrides({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao ler planilha");
    }
  };

  const linhasFinal = useMemo(
    () =>
      rows
        .map((r, i) => ({ unidade: overrides[i] ?? r.unidadeMatch ?? "", valor: r.valor }))
        .filter((l) => l.unidade && Number.isFinite(l.valor)),
    [rows, overrides],
  );

  const naoCasadas = rows.filter((r, i) => !(overrides[i] ?? r.unidadeMatch)).length;
  const total = linhasFinal.reduce((s, l) => s + l.valor, 0);

  async function submit() {
    if (linhasFinal.length === 0) {
      toast.error("Nenhuma linha pronta para importar.");
      return;
    }
    try {
      await importar.mutateAsync({
        competencia: `${competencia}-01`,
        arquivo_nome: arquivoNome || undefined,
        linhas: linhasFinal,
      });
      toast.success(`Importadas ${linhasFinal.length} linhas`);
      reset();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar");
    }
  }

  function reset() {
    setRows([]);
    setArquivoNome("");
    setOverrides({});
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar repasses — {tipo === "royalties" ? "Royalties" : "CAC"}</DialogTitle>
          <DialogDescription>
            Planilha (.xlsx ou .csv) com colunas "unidade" e "valor". O tipo é definido pela aba atual.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Competência</span>
              <input
                type="month"
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Arquivo</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
                className="text-sm"
              />
            </label>
            {arquivoNome && (
              <span className="text-xs text-muted-foreground">{arquivoNome} — {rows.length} linhas</span>
            )}
          </div>

          {rows.length > 0 && (
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs">
                <span>
                  {linhasFinal.length} prontas • {naoCasadas} sem correspondência
                </span>
                <span className="font-medium">Total: {brl(total)}</span>
              </div>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Unidade no arquivo</th>
                      <th className="px-3 py-2 text-left">Mapear para</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const escolha = overrides[i] ?? r.unidadeMatch ?? "";
                      return (
                        <tr key={i} className={"border-t " + (!escolha ? "bg-danger-soft" : "")}>
                          <td className="px-3 py-1.5">{r.unidadeArquivo}</td>
                          <td className="px-3 py-1.5">
                            <select
                              value={escolha}
                              onChange={(e) => setOverrides({ ...overrides, [i]: e.target.value })}
                              className="h-7 w-full rounded border border-border bg-background px-1 text-xs"
                            >
                              <option value="">— ignorar —</option>
                              {unidadesConhecidas.map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-right">{brl(r.valor)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {naoCasadas > 0 && (
                <div className="flex items-center gap-2 border-t bg-warning-soft px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Linhas sem correspondência serão ignoradas. Selecione uma unidade ou deixe como "ignorar".
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => { reset(); onClose(); }}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={linhasFinal.length === 0 || importar.isPending}
            onClick={() => void submit()}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {importar.isPending ? <Upload className="h-4 w-4 animate-pulse" /> : <Check className="h-4 w-4" />}
            Importar {linhasFinal.length || ""}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
