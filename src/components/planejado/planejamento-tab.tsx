import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Trash2, Plus, Download, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BRL, MES_OPTS, mesLabel, type OrcRow } from "./constants";
import { OrcamentoFormDialog } from "./orcamento-form-dialog";
import { Skeleton } from "@/components/ui/skeleton";

export function PlanejamentoTab() {
  const [rows, setRows] = useState<OrcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fTipo, setFTipo] = useState<"all" | "DESPESA" | "RECEITA">("all");
  const [fCat, setFCat] = useState<string>("all");
  const [fDept, setFDept] = useState<string>("all");
  const [fMes, setFMes] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [editing, setEditing] = useState<OrcRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [copyFrom, setCopyFrom] = useState(MES_OPTS[4].value);
  const [copyTo, setCopyTo] = useState(MES_OPTS[5].value);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("partners_orcamento")
        .select("*")
        .order("categoria")
        .order("valor", { ascending: false });
      if (error) {
        toast.error(error.message);
        return;
      }
      setRows((data ?? []) as OrcRow[]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);


  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (r.categoria === "_TOTAL") return false;
      if (fTipo !== "all" && r.tipo !== fTipo) return false;
      if (fCat !== "all" && r.categoria !== fCat) return false;
      if (fDept !== "all" && r.departamento !== fDept) return false;
      if (fMes !== "all" && !r.mes.startsWith(fMes)) return false;
      if (search && !(r.descricao ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rows, fTipo, fCat, fDept, fMes, search]);

  const categorias = useMemo(() => Array.from(new Set(rows.map((r) => r.categoria).filter((c): c is string => !!c && c !== "_TOTAL"))).sort(), [rows]);
  const departamentos = useMemo(() => Array.from(new Set(rows.map((r) => r.departamento).filter((c): c is string => !!c))).sort(), [rows]);

  // Group by descrição+categoria+depto+unidade across months
  type Group = { key: string; tipo: string; descricao: string; categoria: string; departamento: string; unidade: string; tipo_custo: string; items: Record<string, OrcRow> };
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const r of filtered) {
      const key = `${r.tipo}|${r.categoria}|${r.descricao}|${r.departamento}|${r.unidade}`;
      if (!m.has(key)) {
        m.set(key, {
          key, tipo: r.tipo, descricao: r.descricao ?? "",
          categoria: r.categoria ?? "", departamento: r.departamento ?? "",
          unidade: r.unidade ?? "", tipo_custo: r.tipo_custo ?? "",
          items: {},
        });
      }
      m.get(key)!.items[r.mes.slice(0, 7)] = r;
    }
    return Array.from(m.values()).sort((a, b) => {
      if (a.categoria !== b.categoria) return a.categoria.localeCompare(b.categoria);
      const ta = Object.values(a.items).reduce((s, x) => s + Number(x.valor), 0);
      const tb = Object.values(b.items).reduce((s, x) => s + Number(x.valor), 0);
      return tb - ta;
    });
  }, [filtered]);

  const monthCols = useMemo(() => {
    if (fMes !== "all") return MES_OPTS.filter((m) => m.value === fMes);
    return MES_OPTS.filter((m) => filtered.some((r) => r.mes.startsWith(m.value)));
  }, [filtered, fMes]);

  // Totals per month
  const totals = useMemo(() => {
    const t: Record<string, { rec: number; desp: number }> = {};
    for (const m of monthCols) t[m.value] = { rec: 0, desp: 0 };
    for (const r of filtered) {
      const ym = r.mes.slice(0, 7);
      if (!t[ym]) continue;
      if (r.tipo === "RECEITA") t[ym].rec += Number(r.valor);
      else t[ym].desp += Number(r.valor);
    }
    return t;
  }, [filtered, monthCols]);

  const handleDelete = async (id: number) => {
    const { error } = await supabase.from("partners_orcamento").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Item removido");
    setConfirmDel(null);
    load();
  };

  const handleExport = () => {
    const sep = ";";
    const header = ["Tipo", "Categoria", "Descrição", "Departamento", "Unidade", "Mês", "Valor", "Tipo Custo"].join(sep);
    const lines = filtered.map((r) => [
      r.tipo, r.categoria, r.descricao, r.departamento, r.unidade, r.mes,
      String(r.valor).replace(".", ","), r.tipo_custo,
    ].map((v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(sep));
    const csv = [header, ...lines].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `planejamento_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    const src = rows.filter((r) => r.mes.startsWith(copyFrom) && r.categoria !== "_TOTAL");
    if (src.length === 0) { toast.error("Sem itens no mês origem"); return; }
    const inserts = src.map((r) => ({
      tipo: r.tipo, mes: `${copyTo}-01`,
      descricao: r.descricao, categoria: r.categoria, departamento: r.departamento,
      unidade: r.unidade, valor: r.valor, tipo_custo: r.tipo_custo,
      origem: "copia",
    }));
    const { error } = await supabase.from("partners_orcamento").insert(inserts);
    if (error) { toast.error(error.message); return; }
    toast.success(`${inserts.length} item(ns) copiados para ${mesLabel(copyTo)}`);
    setShowCopy(false);
    load();
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <div className="space-y-1">
          <Label className="text-xs">Mês</Label>
          <Select value={fMes} onValueChange={setFMes}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {MES_OPTS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={fTipo} onValueChange={(v) => setFTipo(v as "all" | "DESPESA" | "RECEITA")}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="DESPESA">DESPESA</SelectItem>
              <SelectItem value="RECEITA">RECEITA</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Categoria</Label>
          <Select value={fCat} onValueChange={setFCat}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {categorias.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Departamento</Label>
          <Select value={fDept} onValueChange={setFDept}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {departamentos.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Busca</Label>
          <Input className="w-56" placeholder="Descrição…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}><Download className="mr-1 h-3 w-3" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => setShowCopy(true)}><Copy className="mr-1 h-3 w-3" /> Copiar mês</Button>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-1 h-3 w-3" /> Novo Item</Button>
        </div>
      </Card>

      <Card className="p-0">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="space-y-2 p-4">{Array.from({length:6}).map((_,i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-background text-xs">Descrição</TableHead>
                  <TableHead className="text-xs">Tipo</TableHead>
                  <TableHead className="text-xs">Categoria</TableHead>
                  <TableHead className="text-xs">Depto</TableHead>
                  <TableHead className="text-xs">Unidade</TableHead>
                  {monthCols.map((m) => <TableHead key={m.value} className="text-right text-xs">{m.label}</TableHead>)}
                  <TableHead className="text-right text-xs">Total</TableHead>
                  <TableHead className="sticky right-0 z-10 bg-background text-xs">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderGroupedRows(groups, monthCols, {
                  onEdit: (r) => setEditing(r),
                  onDelete: (id) => setConfirmDel(id),
                  confirmDel,
                  onConfirmDelete: handleDelete,
                  onCancelDelete: () => setConfirmDel(null),
                })}
                {/* Totals */}
                <TableRow className="bg-muted/70 font-semibold">
                  <TableCell className="sticky left-0 z-10 bg-muted/70 text-xs" colSpan={5}>TOTAL RECEITAS</TableCell>
                  {monthCols.map((m) => <TableCell key={m.value} className="text-right text-xs text-success">{BRL(totals[m.value]?.rec ?? 0)}</TableCell>)}
                  <TableCell className="text-right text-xs">{BRL(Object.values(totals).reduce((s, t) => s + t.rec, 0))}</TableCell>
                  <TableCell className="sticky right-0 z-10 bg-muted/70" />
                </TableRow>
                <TableRow className="bg-muted/70 font-semibold">
                  <TableCell className="sticky left-0 z-10 bg-muted/70 text-xs" colSpan={5}>TOTAL DESPESAS</TableCell>
                  {monthCols.map((m) => <TableCell key={m.value} className="text-right text-xs text-danger">{BRL(totals[m.value]?.desp ?? 0)}</TableCell>)}
                  <TableCell className="text-right text-xs">{BRL(Object.values(totals).reduce((s, t) => s + t.desp, 0))}</TableCell>
                  <TableCell className="sticky right-0 z-10 bg-muted/70" />
                </TableRow>
                <TableRow className="bg-muted font-bold">
                  <TableCell className="sticky left-0 z-10 bg-muted text-xs" colSpan={5}>RESULTADO</TableCell>
                  {monthCols.map((m) => {
                    const r = (totals[m.value]?.rec ?? 0) - (totals[m.value]?.desp ?? 0);
                    return <TableCell key={m.value} className={`text-right text-xs ${r >= 0 ? "text-success" : "text-danger"}`}>{BRL(r)}</TableCell>;
                  })}
                  <TableCell className="text-right text-xs">{BRL(Object.values(totals).reduce((s, t) => s + t.rec - t.desp, 0))}</TableCell>
                  <TableCell className="sticky right-0 z-10 bg-muted" />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      <OrcamentoFormDialog
        open={showCreate || !!editing}
        onOpenChange={(o) => { if (!o) { setShowCreate(false); setEditing(null); } }}
        initial={editing ?? undefined}
        editingId={editing?.id ?? null}
        onSaved={load}
      />

      <Dialog open={showCopy} onOpenChange={setShowCopy}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Copiar planejamento</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">De</Label>
              <Select value={copyFrom} onValueChange={setCopyFrom}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MES_OPTS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Para</Label>
              <Select value={copyTo} onValueChange={setCopyTo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MES_OPTS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Cria registros duplicados de {mesLabel(copyFrom)} para {mesLabel(copyTo)}.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCopy(false)}>Cancelar</Button>
            <Button onClick={handleCopy}>Copiar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDel !== null && (
        <Dialog open onOpenChange={() => setConfirmDel(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Remover item?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Essa ação não pode ser desfeita.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDel(null)}>Não</Button>
              <Button variant="destructive" onClick={() => handleDelete(confirmDel)}>Sim, remover</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

type Group = { key: string; tipo: string; descricao: string; categoria: string; departamento: string; unidade: string; tipo_custo: string; items: Record<string, OrcRow> };

function renderGroupedRows(
  groups: Group[],
  monthCols: { value: string; label: string }[],
  actions: {
    onEdit: (r: OrcRow) => void;
    onDelete: (id: number) => void;
    confirmDel: number | null;
    onConfirmDelete: (id: number) => void;
    onCancelDelete: () => void;
  },
) {
  const out: React.ReactNode[] = [];
  let lastCat = "";
  let catSubtotal: Record<string, number> = {};
  let catRows: Group[] = [];

  const flushSubtotal = () => {
    if (catRows.length === 0) return;
    out.push(
      <TableRow key={`sub-${lastCat}`} className="bg-muted/40 text-xs font-semibold">
        <TableCell className="sticky left-0 z-10 bg-muted/40" colSpan={5}>Subtotal: {lastCat}</TableCell>
        {monthCols.map((m) => <TableCell key={m.value} className="text-right">{BRL(catSubtotal[m.value] ?? 0)}</TableCell>)}
        <TableCell className="text-right">{BRL(Object.values(catSubtotal).reduce((s, v) => s + v, 0))}</TableCell>
        <TableCell className="sticky right-0 z-10 bg-muted/40" />
      </TableRow>,
    );
  };

  for (const g of groups) {
    if (g.categoria !== lastCat) {
      flushSubtotal();
      lastCat = g.categoria;
      catSubtotal = {};
      catRows = [];
    }
    catRows.push(g);
    let total = 0;
    for (const m of monthCols) {
      const v = Number(g.items[m.value]?.valor ?? 0);
      catSubtotal[m.value] = (catSubtotal[m.value] ?? 0) + v;
      total += v;
    }
    // Single row representing the group; actions act on the first existing item
    const anyItem = Object.values(g.items)[0];
    out.push(
      <TableRow key={g.key} className="text-xs">
        <TableCell className="sticky left-0 z-10 bg-background">{g.descricao}</TableCell>
        <TableCell>{g.tipo}</TableCell>
        <TableCell>{g.categoria}</TableCell>
        <TableCell>{g.departamento}</TableCell>
        <TableCell>{g.unidade}</TableCell>
        {monthCols.map((m) => {
          const item = g.items[m.value];
          return (
            <TableCell key={m.value} className="text-right">
              {item ? (
                <button className="hover:underline" onClick={() => actions.onEdit(item)} title="Editar">
                  {BRL(Number(item.valor))}
                </button>
              ) : "—"}
            </TableCell>
          );
        })}
        <TableCell className="text-right font-semibold">{BRL(total)}</TableCell>
        <TableCell className="sticky right-0 z-10 bg-background">
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => actions.onEdit(anyItem)}><Pencil className="h-3 w-3" /></Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => actions.onDelete(anyItem.id)}><Trash2 className="h-3 w-3" /></Button>
          </div>
        </TableCell>
      </TableRow>,
    );
  }
  flushSubtotal();
  return out;
}
