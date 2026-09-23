import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CategoriaRow, Cadastro, Item, Natureza, TipoItem, MESES_LABEL, BRL, gerarValoresLocal,
} from "./types";
import { criarItem, atualizarItem } from "./data";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  natureza: Natureza;
  cenarioId: string | null;
  item?: Item | null;
  categorias: CategoriaRow[];
  departamentos: Cadastro[];
  tiposRateio: Cadastro[];
  onSaved: () => void;
}

const TIPOS: { value: TipoItem; label: string }[] = [
  { value: "fixo", label: "Fixo" },
  { value: "fixo_variavel", label: "Fixo Variável" },
  { value: "parcelado", label: "Parcelado" },
  { value: "pontual", label: "Pontual" },
];

export function ItemFormDialog({
  open, onOpenChange, natureza, cenarioId, item, categorias, departamentos, tiposRateio, onSaved,
}: Props) {
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [departamento, setDepartamento] = useState<string | null>(null);
  const [tipoRateio, setTipoRateio] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoItem>("fixo");
  const [valorBase, setValorBase] = useState<string>("0");
  const [mesInicio, setMesInicio] = useState<number>(1);
  const [parcelas, setParcelas] = useState<number>(1);
  const [mesesPontuais, setMesesPontuais] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNome(item?.nome ?? "");
    setCategoria(item?.categoria ?? null);
    setDepartamento(item?.departamento ?? null);
    setTipoRateio(item?.tipo_rateio ?? null);
    setTipo(item?.tipo ?? "fixo");
    setValorBase(String(item?.valor_base ?? 0));
    setMesInicio(item?.mes_inicio ?? 1);
    setParcelas(item?.parcelas ?? 1);
    setMesesPontuais(item?.meses_pontuais ?? []);
  }, [open, item]);

  const preview = gerarValoresLocal({
    tipo,
    valor_base: Number(valorBase.replace(",", ".")) || 0,
    mes_inicio: mesInicio,
    parcelas,
    meses_pontuais: mesesPontuais,
  });

  async function handleSave() {
    if (!nome.trim()) { toast.error("Informe o nome"); return; }
    setSaving(true);
    try {
      const payload = {
        cenario_id: cenarioId,
        natureza,
        nome: nome.trim(),
        categoria,
        departamento,
        tipo_rateio: tipoRateio,
        tipo,
        valor_base: Number(valorBase.replace(",", ".")) || 0,
        mes_inicio: mesInicio,
        parcelas: tipo === "parcelado" ? parcelas : null,
        meses_pontuais: tipo === "pontual" ? mesesPontuais : null,
      };
      if (item) await atualizarItem(item.id, { ...payload, natureza });
      else await criarItem(payload);
      toast.success(item ? "Atualizado" : "Criado");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {item ? "Editar" : "Nova"} {natureza === "receita" ? "receita" : "despesa"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Aluguel matriz" />
          </div>
          <div>
            <Label>Categoria</Label>
            <Select value={categoria ?? "_"} onValueChange={(v) => setCategoria(v === "_" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">—</SelectItem>
                {categorias.map((c) => <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Departamento</Label>
            <Select value={departamento ?? "_"} onValueChange={(v) => setDepartamento(v === "_" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">—</SelectItem>
                {departamentos.map((c) => <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tipo de rateio</Label>
            <Select value={tipoRateio ?? "_"} onValueChange={(v) => setTipoRateio(v === "_" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">—</SelectItem>
                {tiposRateio.map((c) => <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoItem)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Valor base (R$)</Label>
            <Input value={valorBase} onChange={(e) => setValorBase(e.target.value)} inputMode="decimal" />
          </div>
          {tipo !== "pontual" && (
            <div>
              <Label>Mês de início</Label>
              <Select value={String(mesInicio)} onValueChange={(v) => setMesInicio(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MESES_LABEL.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {tipo === "parcelado" && (
            <div>
              <Label>Nº de parcelas</Label>
              <Input type="number" min={1} max={12} value={parcelas} onChange={(e) => setParcelas(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} />
            </div>
          )}
          {tipo === "pontual" && (
            <div className="col-span-2">
              <Label>Meses</Label>
              <div className="grid grid-cols-6 gap-2 mt-1">
                {MESES_LABEL.map((m, i) => {
                  const mes = i + 1;
                  const checked = mesesPontuais.includes(mes);
                  return (
                    <label key={mes} className="flex items-center gap-1 text-sm">
                      <Checkbox checked={checked} onCheckedChange={(v) => {
                        setMesesPontuais((prev) => v ? [...prev, mes].sort((a, b) => a - b) : prev.filter((x) => x !== mes));
                      }} />
                      {m}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div className="col-span-2 mt-2 rounded-md border p-2 bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">Pré-visualização mensal</div>
            <div className="grid grid-cols-12 gap-1 text-xs">
              {preview.map((v, i) => (
                <div key={i} className="text-center">
                  <div className="text-muted-foreground">{MESES_LABEL[i]}</div>
                  <div className={v ? "font-medium" : "text-muted-foreground/50"}>{v ? BRL(v) : "—"}</div>
                </div>
              ))}
            </div>
            <div className="text-right mt-1 text-xs">
              Total: <strong>{BRL(preview.reduce((a, b) => a + b, 0))}</strong>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
