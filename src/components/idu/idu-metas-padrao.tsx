import { useState, type ReactNode } from "react";
import { Copy, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Secao } from "@/components/planning";
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

/** Motivo mostrado no tooltip de todo campo de meta desabilitado (N8). */
export const MOTIVO_SEM_EDICAO = "Editar metas exige a permissão edit.idu_metas.";

/**
 * Controle desabilitado não recebe hover nem foco: o tooltip fica num `span`
 * focável em volta dele, para o motivo aparecer com mouse e com teclado.
 */
export function ComMotivo({
  ativo,
  motivo,
  children,
}: {
  ativo: boolean;
  motivo: string;
  children: ReactNode;
}) {
  if (!ativo) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-not-allowed rounded-sm">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{motivo}</TooltipContent>
    </Tooltip>
  );
}

/** Confirmação de ação que apaga valor (V6): nunca `confirm()` nativo. */
export function ConfirmarApagar({
  aberto,
  titulo,
  descricao,
  rotuloAcao,
  onCancelar,
  onConfirmar,
}: {
  aberto: boolean;
  titulo: string;
  descricao: ReactNode;
  rotuloAcao: string;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <AlertDialog open={aberto} onOpenChange={(v) => !v && onCancelar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{descricao}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={onConfirmar}
          >
            {rotuloAcao}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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

type Apagar = { escopo: string; indicador: string; rotulo: string; tituloEscopo: string };

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
  const [apagar, setApagar] = useState<Apagar | null>(null);

  const valor = (escopo: string, indicador: string) =>
    padrao.find((p) => p.escopo === escopo && p.indicador === indicador)?.meta ?? null;

  const nomeAnterior = anterior?.label.split(" ·")[0];

  async function salvar(ind: Indicador, escopo: string, tituloEscopo: string, texto: string) {
    const limpo = texto.trim();
    // Campo vazio apaga a meta padrão: o nível volta a não existir na cascata.
    // Apaga valor, então confirma antes.
    if (limpo === "") {
      setEditando(null);
      if (valor(escopo, ind.indicador) === null) return;
      setApagar({ escopo, indicador: ind.indicador, rotulo: ind.rotulo, tituloEscopo });
      return;
    }
    const meta = Number(limpo.replace(",", "."));
    if (!Number.isFinite(meta)) {
      toast.error(`Meta inválida: "${limpo}" não é um número.`);
      return;
    }
    const { error } = await supabase.from("idu_metas_padrao").upsert(
      {
        periodo_inicio: periodo.ini,
        periodo_fim: periodo.fim,
        escopo,
        indicador: ind.indicador,
        meta,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "periodo_inicio,escopo,indicador" },
    );
    // Erro fica no campo: a edição continua aberta com o que foi digitado.
    if (error) {
      toast.error(`Não foi possível salvar a meta de ${ind.rotulo}: ${error.message}`);
      return;
    }
    setEditando(null);
    toast.success(`Meta ${tituloEscopo} de ${ind.rotulo} salva`);
    await onSalvo();
  }

  async function confirmarApagar() {
    if (!apagar) return;
    const alvo = apagar;
    setApagar(null);
    const { error } = await supabase
      .from("idu_metas_padrao")
      .delete()
      .eq("periodo_inicio", periodo.ini)
      .eq("escopo", alvo.escopo)
      .eq("indicador", alvo.indicador);
    if (error) {
      toast.error(`Não foi possível apagar a meta de ${alvo.rotulo}: ${error.message}`);
      return;
    }
    toast.success(`Meta ${alvo.tituloEscopo} de ${alvo.rotulo} apagada`);
    await onSalvo();
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
      toast.info(`Nada a copiar: ${nomeAnterior} não tem meta padrão que falte neste trimestre.`);
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
    <Secao
      titulo="Quais metas valem para a rede neste trimestre?"
      descricao="Valem para várias unidades de uma vez; a meta definida na unidade vence o tier, e o tier vence a rede."
      acoes={
        anterior ? (
          <ComMotivo ativo={!podeEditar} motivo={MOTIVO_SEM_EDICAO}>
            <Button
              size="sm"
              variant="outline"
              disabled={!podeEditar || copiando}
              onClick={() => void copiarAnterior()}
            >
              <Copy className="size-4" aria-hidden />
              Copiar de {nomeAnterior}
            </Button>
          </ComMotivo>
        ) : null
      }
    >
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Indicador</TableHead>
              <TableHead>Pilar</TableHead>
              {ESCOPOS.map((e) => (
                <TableHead key={e.escopo} className="text-right">
                  <div>{e.titulo}</div>
                  <div className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
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
                  const tituloEscopo = e.escopo === "rede" ? "da rede" : `do tier ${e.titulo}`;
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
                            aria-label={`Meta ${tituloEscopo} de ${ind.rotulo}`}
                            onChange={(ev) => setRascunho(ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter")
                                void salvar(ind, e.escopo, tituloEscopo, rascunho);
                              if (ev.key === "Escape") setEditando(null);
                            }}
                            className="h-8 w-24 text-right"
                          />
                          <Button
                            size="sm"
                            onClick={() => void salvar(ind, e.escopo, tituloEscopo, rascunho)}
                          >
                            ok
                          </Button>
                        </div>
                      ) : (
                        <ComMotivo ativo={!podeEditar} motivo={MOTIVO_SEM_EDICAO}>
                          <button
                            type="button"
                            disabled={!podeEditar}
                            onClick={() => {
                              setEditando(chave);
                              setRascunho(v === null ? "" : String(v));
                            }}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-sm",
                              podeEditar && "hover:underline",
                              !podeEditar && "pointer-events-none",
                              v === null && "text-muted-foreground",
                            )}
                          >
                            {v === null ? vazio : fmtValor(v, ind.unidade_medida)}
                            {podeEditar && (
                              <Pencil className="size-3 text-muted-foreground" aria-hidden />
                            )}
                          </button>
                        </ComMotivo>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmarApagar
        aberto={!!apagar}
        titulo={apagar ? `Apagar a meta ${apagar.tituloEscopo} de ${apagar.rotulo}?` : ""}
        descricao={
          apagar
            ? `${periodo.label.split(" ·")[0]}: as unidades que seguiam esta meta passam a seguir o nível acima na cascata, ou ficam sem meta e o indicador sai do denominador delas.`
            : ""
        }
        rotuloAcao="Apagar meta"
        onCancelar={() => setApagar(null)}
        onConfirmar={() => void confirmarApagar()}
      />
    </Secao>
  );
}
