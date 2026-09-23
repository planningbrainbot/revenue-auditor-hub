import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Plus, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BRL, BRL2, mesLabel, type FinRow, type OrcRow, DEPARTAMENTO_OPTS, TIPO_CUSTO_OPTS } from "./constants";
import { OrcamentoFormDialog } from "./orcamento-form-dialog";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ym: string;
  tipoFin: "PAGAR" | "RECEBER";
  tipoOrc: "DESPESA" | "RECEITA";
  groupLabel: string;
  orcCategoria: string;
  codes: string[]; // categoria_codigo list (or [] for outros)
  excludeCodes?: string[]; // if codes is empty, exclude these (outros)
  prefixFilter?: string; // e.g. "2." or "1."
  initialTab?: "real" | "plan";
  onChanged: () => void;
};

export function DrillSheet({
  open, onOpenChange, ym, tipoFin, tipoOrc, groupLabel, orcCategoria,
  codes, excludeCodes, prefixFilter, initialTab = "real", onChanged,
}: Props) {
  const [fin, setFin] = useState<FinRow[]>([]);
  const [orc, setOrc] = useState<OrcRow[]>([]);
  const [forn, setForn] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"real" | "plan">(initialTab);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Partial<OrcRow>>({});
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { setTab(initialTab); }, [initialTab, open]);

  const load = async () => {
    if (!open) return;
    setLoading(true);
    const start = `${ym}-01`;
    const [y, m] = ym.split("-").map(Number);
    const next = new Date(y, m, 1);
    const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;

    let q = supabase
      .from("partners_financeiro")
      .select("numero_documento,departamento,data_vencimento,data_emissao,valor_documento,status_titulo,categoria_codigo,codigo_lancamento_omie,codigo_cliente_fornecedor,tipo")
      .eq("tipo", tipoFin)
      .neq("status_titulo", "CANCELADO")
      .gte("data_vencimento", start)
      .lt("data_vencimento", end);
    if (codes.length > 0) q = q.in("categoria_codigo", codes);
    else if (prefixFilter) q = q.like("categoria_codigo", `${prefixFilter}%`);

    const orcQ = supabase
      .from("partners_orcamento")
      .select("*")
      .eq("tipo", tipoOrc)
      .eq("mes", start)
      .eq("categoria", orcCategoria)
      .order("valor", { ascending: false });

    const [finRes, orcRes] = await Promise.all([q, orcQ]);
    let finData = (finRes.data ?? []) as FinRow[];
    // For "Outros" with excludeCodes
    if (codes.length === 0 && excludeCodes && excludeCodes.length > 0) {
      finData = finData.filter((r) => !excludeCodes.includes(r.categoria_codigo ?? ""));
    }
    setFin(finData);
    setOrc((orcRes.data ?? []) as OrcRow[]);

    // Fetch fornecedor names
    const ids = Array.from(new Set(finData.map((r) => r.codigo_cliente_fornecedor).filter((x): x is number => !!x)));
    if (ids.length > 0) {
      const { data } = await supabase
        .from("partners_financeiro")
        .select("codigo_cliente_fornecedor,raw")
        .in("codigo_cliente_fornecedor", ids)
        .limit(1000);
      const map: Record<number, string> = {};
      for (const r of (data ?? []) as Array<{ codigo_cliente_fornecedor: number | null; raw: Record<string, unknown> | null }>) {
        if (!r.codigo_cliente_fornecedor) continue;
        const raw = (r.raw ?? {}) as Record<string, unknown>;
        const nome = (raw["nome_fornecedor"] || raw["nome_cliente"] || raw["razao_social"] || raw["nome"]) as string | undefined;
        if (nome && !map[r.codigo_cliente_fornecedor]) map[r.codigo_cliente_fornecedor] = nome;
      }
      setForn(map);
    } else setForn({});
    setLoading(false);
  };

  useEffect(() => { load(); }, [open, ym, tipoFin, orcCategoria]);

  const totalReal = fin.reduce((s, r) => s + Number(r.valor_documento ?? 0), 0);
  const totalOrc = orc.reduce((s, r) => s + Number(r.valor ?? 0), 0);

  const handleDelete = async (id: number) => {
    const { error } = await supabase.from("partners_orcamento").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Item removido");
    setConfirmDel(null);
    await load();
    onChanged();
  };

  const handleSaveEdit = async (id: number) => {
    const { error } = await supabase.from("partners_orcamento").update({
      descricao: editValues.descricao ?? null,
      valor: Number(editValues.valor ?? 0),
      departamento: editValues.departamento ?? null,
      tipo_custo: editValues.tipo_custo ?? null,
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Item atualizado");
    setEditing(null);
    await load();
    onChanged();
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[560px]">
          <SheetHeader>
            <SheetTitle>{groupLabel}</SheetTitle>
            <div className="text-xs text-muted-foreground">
              {mesLabel(ym)} &nbsp;|&nbsp; Orçado: <strong>{BRL(totalOrc)}</strong> &nbsp;|&nbsp; Realizado: <strong>{BRL(totalReal)}</strong>
            </div>
          </SheetHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "real" | "plan")} className="mt-4">
            <TabsList className="w-full">
              <TabsTrigger value="real" className="flex-1">Realizados ({fin.length})</TabsTrigger>
              <TabsTrigger value="plan" className="flex-1">Planejados ({orc.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="real" className="mt-3">
              {loading ? <div className="text-sm text-muted-foreground">Carregando…</div> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Venc.</TableHead>
                        <TableHead className="text-xs">Descrição</TableHead>
                        <TableHead className="text-xs">{tipoFin === "PAGAR" ? "Fornecedor" : "Cliente"}</TableHead>
                        <TableHead className="text-xs">Depto</TableHead>
                        <TableHead className="text-right text-xs">Valor</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fin.sort((a, b) => (a.data_vencimento ?? "").localeCompare(b.data_vencimento ?? "")).map((r, i) => (
                        <TableRow key={`${r.codigo_lancamento_omie}-${i}`}>
                          <TableCell className="text-xs">{fmtBR(r.data_vencimento)}</TableCell>
                          <TableCell className="text-xs">{r.numero_documento ?? "—"}</TableCell>
                          <TableCell className="text-xs">{r.codigo_cliente_fornecedor ? (forn[r.codigo_cliente_fornecedor] ?? `#${r.codigo_cliente_fornecedor}`) : "—"}</TableCell>
                          <TableCell className="text-xs">{r.departamento ?? "—"}</TableCell>
                          <TableCell className="text-right text-xs">{BRL2(Number(r.valor_documento ?? 0))}</TableCell>
                          <TableCell className="text-xs"><Badge variant="outline" className="text-xs">{r.status_titulo}</Badge></TableCell>
                        </TableRow>
                      ))}
                      {fin.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground">Nenhum lançamento.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t pt-2 text-xs">
                <span>{fin.length} lançamento(s)</span>
                <span className="font-semibold">Total: {BRL2(totalReal)}</span>
              </div>
            </TabsContent>

            <TabsContent value="plan" className="mt-3">
              {loading ? <div className="text-sm text-muted-foreground">Carregando…</div> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Descrição</TableHead>
                        <TableHead className="text-xs">Depto</TableHead>
                        <TableHead className="text-xs">Unidade</TableHead>
                        <TableHead className="text-right text-xs">Valor</TableHead>
                        <TableHead className="text-xs">Tipo</TableHead>
                        <TableHead className="w-20 text-xs"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orc.map((o) => {
                        const isEdit = editing === o.id;
                        const isDel = confirmDel === o.id;
                        return (
                          <TableRow key={o.id}>
                            <TableCell className="text-xs">
                              {isEdit ? <Input className="h-7 text-xs" value={editValues.descricao ?? ""} onChange={(e) => setEditValues({ ...editValues, descricao: e.target.value })} /> : o.descricao}
                            </TableCell>
                            <TableCell className="text-xs">
                              {isEdit ? (
                                <Select value={editValues.departamento ?? ""} onValueChange={(v) => setEditValues({ ...editValues, departamento: v })}>
                                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>{DEPARTAMENTO_OPTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                                </Select>
                              ) : o.departamento}
                            </TableCell>
                            <TableCell className="text-xs">{o.unidade}</TableCell>
                            <TableCell className="text-right text-xs">
                              {isEdit ? <Input type="number" step="0.01" className="h-7 text-xs text-right" value={editValues.valor ?? 0} onChange={(e) => setEditValues({ ...editValues, valor: Number(e.target.value) })} /> : BRL2(Number(o.valor ?? 0))}
                            </TableCell>
                            <TableCell className="text-xs">
                              {isEdit ? (
                                <Select value={editValues.tipo_custo ?? ""} onValueChange={(v) => setEditValues({ ...editValues, tipo_custo: v })}>
                                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>{TIPO_CUSTO_OPTS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                                </Select>
                              ) : o.tipo_custo}
                            </TableCell>
                            <TableCell className="text-xs">
                              {isEdit ? (
                                <div className="flex gap-1">
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleSaveEdit(o.id)}><Check className="h-3 w-3" /></Button>
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(null)}><X className="h-3 w-3" /></Button>
                                </div>
                              ) : isDel ? (
                                <div className="flex gap-1 text-xs">
                                  <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => handleDelete(o.id)}>Sim</Button>
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirmDel(null)}>Não</Button>
                                </div>
                              ) : (
                                <div className="flex gap-1">
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditing(o.id); setEditValues(o); }}><Pencil className="h-3 w-3" /></Button>
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setConfirmDel(o.id)}><Trash2 className="h-3 w-3" /></Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {orc.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground">Sem itens planejados.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="mt-3 flex justify-between border-t pt-2">
                <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                  <Plus className="mr-1 h-3 w-3" /> Adicionar item
                </Button>
                <span className="text-xs font-semibold">Total: {BRL2(totalOrc)}</span>
              </div>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      <OrcamentoFormDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        initial={{
          tipo: tipoOrc,
          categoria: orcCategoria,
          mes: `${ym}-01`,
          unidade: "Planning",
          departamento: "Todos",
          tipo_custo: "Fixo",
        }}
        onSaved={() => { load(); onChanged(); }}
      />
    </>
  );
}

function fmtBR(d?: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}
