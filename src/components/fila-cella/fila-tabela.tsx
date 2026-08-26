import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  BRL,
  dataBR,
  diasDesde,
  type FilaContaRow,
} from "@/lib/fila-cella.types";
import {
  BloqueiosChips,
  CadenciaChip,
  CurvaChips,
  EcdChip,
  ForcaChip,
  FrenteChip,
  bloqueiosDaConta,
} from "@/components/fila-cella/badges";

// As 16 colunas do §6.3. Ordem de leitura = ordem da decisão:
// vale a pena? posso? o que eu digo? onde parei?
//
// A ordem PADRÃO já vem da view (as 5 chaves de build_planilha.py:107-109). O
// front só reordena quando o usuário clica — e o terceiro clique volta à ordem
// natural, que é a da view.

type SortKey =
  | "score"
  | "titulo"
  | "curva_declarada"
  | "mrr"
  | "ecd_estado"
  | "forca"
  | "relacionamento"
  | "estagio"
  | "toques"
  | "ultimo_toque"
  | "proximo_passo_em";

const TOOLTIP_SCORE =
  "O score chega a 11 nas contas com ECD e trava em 5 nas outras — comparável dentro do grupo, não entre grupos. Curva (A=3·B=2·resto=1) + segmento prioritário (2) + força (3/2/1/0) + urgência (3).";

const COLUNAS: { key: SortKey | null; label: string; align?: "right" }[] = [
  { key: null, label: "#" },
  { key: "score", label: "Score" },
  { key: null, label: "⚑" },
  { key: "titulo", label: "Empresa" },
  { key: "curva_declarada", label: "Curva" },
  { key: null, label: "Segmento" },
  { key: "mrr", label: "MRR", align: "right" },
  { key: "ecd_estado", label: "ECD" },
  { key: "forca", label: "Gatilho / Força" },
  { key: null, label: "Frente" },
  { key: "relacionamento", label: "Relacionamento" },
  { key: "estagio", label: "Estágio" },
  { key: "toques", label: "Ciclo · Toques" },
  { key: "ultimo_toque", label: "Último toque" },
  { key: "proximo_passo_em", label: "Próximo passo" },
];

function valorDe(r: FilaContaRow, k: SortKey): string | number {
  switch (k) {
    case "score":
      return r.score ?? -1;
    case "mrr":
      return r.mrr ?? -1;
    case "toques":
      return r.toques ?? -1;
    case "forca":
      return r.forca === "Forte" ? 0 : r.forca === "Moderado" ? 1 : r.forca === "Fraco" ? 2 : 3;
    default: {
      const v = r[k];
      return typeof v === "number" ? v : ((v as string | null) ?? "");
    }
  }
}

export function FilaTabela({
  rows,
  onAbrir,
}: {
  rows: FilaContaRow[];
  onAbrir: (r: FilaContaRow) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // 3º clique volta à ordem natural da view
    });
  };

  const ordenadas = sort
    ? [...rows].sort((a, b) => {
        const va = valorDe(a, sort.key);
        const vb = valorDe(b, sort.key);
        const cmp =
          typeof va === "number" && typeof vb === "number"
            ? va - vb
            : String(va).localeCompare(String(vb), "pt-BR");
        return sort.dir === "asc" ? cmp : -cmp;
      })
    : rows;

  return (
    <div className="space-y-2">
      {sort?.key === "score" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Ordenado por Score. Lembre que o score não é comparável entre contas com e sem ECD — sem
          gatilho apurado não há força, e o teto cai de 11 para 5.
        </p>
      )}
      <div className="max-h-[calc(100vh-420px)] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm shadow-[inset_0_-1px_0_hsl(var(--border))]">
            <TableRow>
              {COLUNAS.map((col) => {
                const active = col.key && sort?.key === col.key;
                const Icon = !active ? ArrowUpDown : sort?.dir === "asc" ? ArrowUp : ArrowDown;
                const conteudo = col.key ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key!)}
                    className={cn(
                      "inline-flex items-center gap-1 select-none hover:text-foreground transition-colors",
                      col.align === "right" && "ml-auto",
                      active ? "text-foreground font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {col.label}
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5",
                        active ? "text-primary" : "text-muted-foreground/60",
                      )}
                    />
                  </button>
                ) : (
                  <span className="text-muted-foreground">{col.label}</span>
                );
                return (
                  <TableHead
                    key={col.label}
                    className={cn(
                      "sticky top-0 whitespace-nowrap bg-card/95 backdrop-blur-sm",
                      col.align === "right" && "text-right",
                    )}
                  >
                    {col.key === "score" ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{conteudo}</TooltipTrigger>
                        <TooltipContent className="max-w-sm">{TOOLTIP_SCORE}</TooltipContent>
                      </Tooltip>
                    ) : (
                      conteudo
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordenadas.map((r, i) => {
              const dias = diasDesde(r.ultimo_toque);
              const razaoDiverge =
                r.razao_social && r.razao_social.trim().toLowerCase() !== r.titulo.trim().toLowerCase();
              return (
                <TableRow
                  key={r.id}
                  onClick={() => onAbrir(r)}
                  className={cn(
                    "cursor-pointer hover:bg-muted/50",
                    r.vetado && "opacity-60",
                  )}
                >
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    {r.vetado ? (
                      <span className="font-semibold text-red-600">FORA</span>
                    ) : (
                      <span
                        className={cn(
                          "font-semibold",
                          !r.score_comparavel && "text-muted-foreground",
                        )}
                      >
                        {r.score ?? "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <BloqueiosChips bloqueios={bloqueiosDaConta(r)} />
                  </TableCell>
                  <TableCell className="max-w-[240px]">
                    <div className="truncate font-medium">{r.titulo}</div>
                    {razaoDiverge && (
                      <div className="truncate text-xs text-muted-foreground">{r.razao_social}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <CurvaChips
                      declarada={r.curva_declarada}
                      apurada={r.curva_ecd}
                      diverge={r.curva_diverge}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.segmento ?? "—"}
                    {r.segmento_prioritario && <span className="ml-1 text-amber-500">★</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{BRL(r.mrr)}</TableCell>
                  <TableCell>
                    <EcdChip estado={r.ecd_estado} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {r.gatilho_principal_nome ?? "—"}
                      </span>
                      <ForcaChip
                        forca={r.forca}
                        temOverride={r.forca_tem_override}
                        motivo={r.forca_motivo}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <FrenteChip frente={r.frente} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{r.relacionamento}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{r.estagio}</TableCell>
                  <TableCell>
                    <CadenciaChip cicloNum={r.ciclo_num} toques={r.toques} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      "whitespace-nowrap text-sm",
                      dias != null && dias > 15 && "font-medium text-red-600",
                    )}
                  >
                    {dataBR(r.ultimo_toque)}
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    {r.proximo_passo ? (
                      <div
                        className={cn(
                          "truncate text-sm",
                          r.passo_vencido && "font-medium text-red-600",
                        )}
                        title={r.proximo_passo}
                      >
                        {r.proximo_passo}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {dataBR(r.proximo_passo_em)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-amber-600">sem próximo passo</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {ordenadas.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={COLUNAS.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Nenhuma conta com esses filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
