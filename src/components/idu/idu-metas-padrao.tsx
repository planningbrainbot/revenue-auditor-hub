import { useState } from "react";
import { Copy, Pencil, Target } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Linha de ops.idu_metas_padrao. */
export type PadraoRow = {
  escopo: string;
  indicador: string;
  meta: number;
};

export type Indicador = {
  indicador: string;
  rotulo: string;
  pilar: string;
  unidade_medida: string;
};

export type Periodo = { key: string; label: string; ini: string; fim: string };

/** Ordem da cascata, da mais larga para a mais específica. A unidade vence todas. */
const ESCOPOS: { escopo: string; titulo: string; dica: string }[] = [
  { escopo: "rede", titulo: "Rede", dica: "toda unidade" },
  { escopo: "Madura", titulo: "Madura", dica: "5+ trimestres" },
  { escopo: "Ramp-up", titulo: "Ramp-up", dica: "até 4 trimestres" },
];

type Props = {
  periodo: Periodo;
  anterior: Periodo | undefined;
  indicadores: Indicador[];
  padrao: PadraoRow[];
  unidadesPorTier: Record<string, number>;
  podeEditar: boolean;
  fmtValor: (v: number | null, medida: string) => string;
  onSalvo: () => Promise<void>;
};

export function IduMetasPadrao({
  periodo,
  anterior,
  indicadores,
  padrao,
  unidadesPorTier,
  podeEditar,
  fmtValor,
  onSalvo,
}: Props) {
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [copiando, setCopiando] = useState(false);

  const valor = (escopo: string, indicador: string) =>
    padrao.find((p) => p.escopo === escopo && p.indicador === indicador)?.meta ?? null;

  async function salvar(escopo: string, indicador: string, texto: string) {
    setEditando(null);
    const limpo = texto.trim();
    // Campo vazio apaga a meta padrão: o nível volta a não existir na cascata.
    if (limpo === "") {
      if (valor(escopo, indicador) === null) return;
      const { error } = await supabase
        .from("idu_metas_padrao")
        .delete()
        .eq("periodo_inicio", periodo.ini)
        .eq("escopo", escopo)
        .eq("indicador", indicador);
      if (error) toast.error(error.message);
      else await onSalvo();
      return;
    }
    const meta = Number(limpo.replace(",", "."));
    if (!Number.isFinite(meta)) return;
    const { error } = await supabase.from("idu_metas_padrao").upsert(
      {
        periodo_inicio: periodo.ini,
        periodo_fim: periodo.fim,
        escopo,
        indicador,
        meta,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "periodo_inicio,escopo,indicador" },
    );
    if (error) toast.error(error.message);
    else await onSalvo();
  }

  /** Traz as metas padrão do trimestre anterior. Não sobrescreve o que já foi definido neste. */
  async function copiarAnterior() {
    if (!anterior) return;
    setCopiando(true);
    const { data, error } = await supabase
      .from("idu_metas_padrao")
      .select("escopo, indicador, meta")
      .eq("periodo_inicio", anterior.ini);
    if (error) {
      setCopiando(false);
      toast.error(error.message);
      return;
    }
    const novas = (data ?? [])
      .filter((p) => valor(p.escopo, p.indicador) === null)
      .map((p) => ({
        periodo_inicio: periodo.ini,
        periodo_fim: periodo.fim,
        escopo: p.escopo,
        indicador: p.indicador,
        meta: p.meta,
      }));
    if (!novas.length) {
      setCopiando(false);
      toast.info(
        `Nada a copiar: ${anterior.label.split(" ·")[0]} não tem meta padrão que falte neste trimestre.`,
      );
      return;
    }
    const ins = await supabase.from("idu_metas_padrao").insert(novas);
    setCopiando(false);
    if (ins.error) toast.error(ins.error.message);
    else {
      toast.success(
        `${novas.length} meta${novas.length > 1 ? "s" : ""} copiada${novas.length > 1 ? "s" : ""}`,
      );
      await onSalvo();
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Target className="h-4 w-4 text-primary-text" />
        <h2 className="text-sm font-semibold">Metas do trimestre</h2>
        <span className="text-xs text-muted-foreground">
          valem para várias unidades de uma vez; a meta definida na unidade vence o tier, e o tier
          vence a rede
        </span>
        {podeEditar && anterior && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 gap-1 text-xs"
            disabled={copiando}
            onClick={() => void copiarAnterior()}
          >
            <Copy className="h-3 w-3" />
            Copiar de {anterior.label.split(" ·")[0]}
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Indicador</TableHead>
              <TableHead>Pilar</TableHead>
              {ESCOPOS.map((e) => (
                <TableHead key={e.escopo} className="text-right">
                  <div>{e.titulo}</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    {e.dica}
                    {e.escopo !== "rede" &&
                      ` · ${unidadesPorTier[e.escopo] ?? 0} unidade${
                        (unidadesPorTier[e.escopo] ?? 0) === 1 ? "" : "s"
                      }`}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {indicadores.map((ind) => (
              <TableRow key={ind.indicador}>
                <TableCell className="font-medium">
                  {ind.rotulo}
                  <span className="ml-1 text-xs text-muted-foreground">({ind.unidade_medida})</span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{ind.pilar}</TableCell>
                {ESCOPOS.map((e) => {
                  const chave = `${e.escopo}:${ind.indicador}`;
                  const v = valor(e.escopo, ind.indicador);
                  // Churn sem meta em nenhum nível cai no 5% fixo da rede.
                  const vazio =
                    e.escopo === "rede" && ind.indicador === "churn" ? "5% (fixa)" : "—";
                  return (
                    <TableCell key={chave} className="text-right tabular-nums">
                      {editando === chave ? (
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            autoFocus
                            value={rascunho}
                            placeholder="vazio apaga"
                            onChange={(ev) => setRascunho(ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter")
                                void salvar(e.escopo, ind.indicador, rascunho);
                              if (ev.key === "Escape") setEditando(null);
                            }}
                            className="h-7 w-24 text-right"
                          />
                          <Button
                            size="sm"
                            className="h-7"
                            onClick={() => void salvar(e.escopo, ind.indicador, rascunho)}
                          >
                            ok
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!podeEditar}
                          onClick={() => {
                            setEditando(chave);
                            setRascunho(v === null ? "" : String(v));
                          }}
                          className={cn(
                            "inline-flex items-center gap-1",
                            podeEditar && "hover:underline",
                            v === null && "text-muted-foreground",
                          )}
                        >
                          {v === null ? vazio : fmtValor(v, ind.unidade_medida)}
                          {podeEditar && <Pencil className="h-3 w-3 opacity-50" />}
                        </button>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
