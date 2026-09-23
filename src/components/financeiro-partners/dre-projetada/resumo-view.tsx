import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { BRL, Cadastro, CategoriaRow, Granularidade, GrupoDRE, GRUPO_DRE_LABEL, Item, RateioPartners, Valor, agruparMeses, normNome, pctPartnersFor } from "./types";
import { cn } from "@/lib/utils";
import {
  categoriaVemDaApuracao,
  valorDaApuracao,
  type RoyaltiesPorUnidadeInfo,
} from "@/hooks/use-royalties";

interface Props {
  itens: Item[];
  valores: Valor[];
  categorias: CategoriaRow[];
  departamentos: Cadastro[];
  modoPartners?: boolean;
  rateio?: RateioPartners;
  granularidade?: Granularidade;
  /** Mês (1..12) para filtrar a exibição a uma única coluna. `undefined`/`null` = todos os meses. */
  mesFiltro?: number | null;
  /** Royalties/CSC/CAC/Verba de mídia/Outras vêm daqui em vez de valor_base/overrides — só preenchido nas visões Base. */
  royaltiesMap?: Map<string, RoyaltiesPorUnidadeInfo>;
}

function sum(arr: number[]) { return arr.reduce((a, b) => a + b, 0); }
function addArrs(a: number[], b: number[]) { return a.map((v, i) => v + b[i]); }
function subArrs(a: number[], b: number[]) { return a.map((v, i) => v - b[i]); }
function zero12() { return Array(12).fill(0) as number[]; }

type CatAgg = { nome: string; total: number[]; itens: Item[] };
type DepAgg = { nome: string; total: number[]; porCat: Map<string, CatAgg> };
type BlocoAgg = { total: number[]; porDep: Map<string, DepAgg> };

type BlocoKey = GrupoDRE | "nao_classificado";

const BLOCO_ACCENT: Record<BlocoKey, "receita" | "despesa" | "neutro"> = {
  entrada: "receita",
  aporte: "receita",
  imposto_direto: "despesa",
  custo_variavel: "despesa",
  custo_fixo: "despesa",
  capex: "despesa",
  nao_classificado: "neutro",
};

const BLOCO_PREFIX: Record<BlocoKey, string> = {
  entrada: "(+)",
  aporte: "(+)",
  imposto_direto: "(−)",
  custo_variavel: "(−)",
  custo_fixo: "(−)",
  capex: "(−)",
  nao_classificado: "( )",
};

const BLOCO_LABEL: Record<BlocoKey, string> = {
  entrada: "RECEITAS BRUTAS",
  aporte: "APORTES DE CAPITAL",
  imposto_direto: "IMPOSTOS DIRETOS",
  custo_variavel: "CUSTOS VARIÁVEIS",
  custo_fixo: "CUSTOS FIXOS",
  capex: "CAPEX",
  nao_classificado: "Não classificado",
};

export function ResumoView({ itens, valores, categorias, modoPartners, rateio, granularidade = "mensal", mesFiltro, royaltiesMap }: Props) {
  const agrupar = (vals: number[]) => agruparMeses(vals, granularidade, mesFiltro);
  const isDaApuracao = (i: Item) =>
    i.cenario_id === null && !!royaltiesMap && categoriaVemDaApuracao(i.categoria);
  // Blocos começam fechados: a leitura inicial da DRE deve mostrar só as
  // linhas em cascata (Receitas → Receita Líquida → Custos Variáveis →
  // Margem de Contribuição → ...), sem misturar Departamento/Categoria/
  // Fornecedor logo abaixo de um subtotal — isso é o que gerava a leitura
  // errada de "Custos Variáveis está dentro de Receita Líquida".
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  // Chave normalizada (trim + lowercase) — categorias digitadas com capitalização
  // diferente da cadastrada em Cadastros (ex.: "Ajuda de custo" vs "Ajuda de Custo")
  // não devem cair silenciosamente em "Não classificado".
  const catGrupoMap = useMemo(() => {
    const m = new Map<string, GrupoDRE>();
    categorias.forEach((c) => { if (c.grupo_dre) m.set(normNome(c.nome), c.grupo_dre); });
    return m;
  }, [categorias]);

  function grupoDoItem(it: Item): BlocoKey {
    if (it.categoria) {
      const g = catGrupoMap.get(normNome(it.categoria));
      if (g) return g;
    }
    // fallback por natureza
    if (it.natureza === "receita") return "entrada";
    return "nao_classificado";
  }

  const valPorItem = useMemo(() => {
    const m = new Map<string, number[]>();
    const primeiroOv = new Map<string, number>();
    valores.forEach((v) => {
      const cur = primeiroOv.get(v.item_id);
      if (cur === undefined || v.mes < cur) primeiroOv.set(v.item_id, v.mes);
    });
    itens.forEach((i) => {
      const arr = zero12();
      if (isDaApuracao(i)) {
        for (let m2 = 1; m2 <= 12; m2++) {
          const info = royaltiesMap!.get(`${i.unidade}|${String(m2).padStart(2, "0")}`);
          arr[m2 - 1] = valorDaApuracao(info, i.categoria)?.valor ?? 0;
        }
        m.set(i.id, arr);
        return;
      }
      const inicio = Math.max(1, Math.min(12, i.mes_inicio || 1));
      const base = Number(i.valor_base) || 0;
      if (i.tipo === "fixo" || i.tipo === "fixo_variavel") {
        const ov = primeiroOv.get(i.id);
        const inicioEf = ov !== undefined ? Math.max(inicio, ov) : inicio;
        for (let m2 = inicioEf; m2 <= 12; m2++) arr[m2 - 1] = base;
      } else if (i.tipo === "parcelado") {
        const n = Math.max(1, i.parcelas ?? 1);
        for (let k = 0; k < n; k++) { const m2 = inicio + k; if (m2 >= 1 && m2 <= 12) arr[m2 - 1] = base; }
      } else if (i.tipo === "pontual") {
        (i.meses_pontuais ?? []).forEach((m2) => { if (m2 >= 1 && m2 <= 12) arr[m2 - 1] = base; });
      }
      m.set(i.id, arr);
    });
    valores.forEach((v) => {
      const item = itens.find((i) => i.id === v.item_id);
      if (item && isDaApuracao(item)) return; // vem da apuração — ignora overrides manuais
      const arr = m.get(v.item_id);
      if (arr) arr[v.mes - 1] = Number(v.valor) || 0;
    });
    if (modoPartners && rateio) {
      itens.forEach((i) => {
        if (i.natureza !== "despesa") return;
        const arr = m.get(i.id);
        if (!arr) return;
        for (let k = 0; k < 12; k++) {
          const pct = pctPartnersFor(i.nome, k + 1, rateio);
          if (pct !== 1) arr[k] = arr[k] * pct;
        }
      });
    }
    return m;
  }, [itens, valores, modoPartners, rateio, royaltiesMap]);

  const blocos = useMemo(() => {
    const acc = new Map<BlocoKey, BlocoAgg>();
    itens.forEach((it) => {
      const vals = valPorItem.get(it.id) ?? zero12();
      const bk = grupoDoItem(it);
      const bloco: BlocoAgg = acc.get(bk) ?? { total: zero12(), porDep: new Map() };
      bloco.total = addArrs(bloco.total, vals);

      const depKey = it.departamento ?? "_";
      const depNome = it.departamento ?? "Sem departamento";
      const dep: DepAgg = bloco.porDep.get(depKey) ?? { nome: depNome, total: zero12(), porCat: new Map() };
      dep.total = addArrs(dep.total, vals);

      const catKey = it.categoria ?? "_";
      const catNome = it.categoria ?? "Sem categoria";
      const cat: CatAgg = dep.porCat.get(catKey) ?? { nome: catNome, total: zero12(), itens: [] };
      cat.total = addArrs(cat.total, vals);
      cat.itens.push(it);
      dep.porCat.set(catKey, cat);

      bloco.porDep.set(depKey, dep);
      acc.set(bk, bloco);
    });
    return acc;
  }, [itens, valPorItem, catGrupoMap]);

  function bloco(k: BlocoKey): number[] {
    return blocos.get(k)?.total ?? zero12();
  }

  const receitaBruta = bloco("entrada");
  const impostos = bloco("imposto_direto");
  const receitaLiquida = subArrs(receitaBruta, impostos);
  const custosVar = bloco("custo_variavel");
  const margemContrib = subArrs(receitaLiquida, custosVar);
  const custosFix = bloco("custo_fixo");
  const ebitda = subArrs(margemContrib, custosFix);
  const capex = bloco("capex");
  const ebit = subArrs(ebitda, capex);
  const aportes = bloco("aporte");
  const naoClassif = blocos.get("nao_classificado");

  const colHeaders = agrupar(zero12()).map((b) => b.label);

  function colorFor(accent: "receita" | "despesa" | "resultado" | "neutro", total: number) {
    if (accent === "receita") return "text-success";
    if (accent === "despesa") return "text-danger";
    if (accent === "resultado") return total >= 0 ? "text-success" : "text-danger";
    return "text-muted-foreground";
  }

  function BlocoHeader({ k, label }: { k: BlocoKey; label?: string }) {
    const data = blocos.get(k);
    if (!data && k !== "nao_classificado") {
      // ainda mostra a linha do bloco (zeros) para deixar a estrutura visível
    }
    const vals = data?.total ?? zero12();
    const buckets = agrupar(vals);
    const total = sum(vals);
    const accent = BLOCO_ACCENT[k];
    const expKey = `bloco:${k}`;
    const isOpen = expanded.has(expKey);
    const hasChildren = !!data;
    return (
      <tr
        className={cn("border-t bg-muted/40 font-semibold", hasChildren && "cursor-pointer hover:bg-muted/60")}
        onClick={() => hasChildren && toggle(expKey)}
      >
        <td className="p-2 sticky left-0 z-10 bg-muted/40">
          <div className="flex items-center gap-1">
            {hasChildren ? (isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : <span className="w-3" />}
            <span>{BLOCO_PREFIX[k]} {label ?? BLOCO_LABEL[k]}</span>
          </div>
        </td>
        {buckets.map((b, i) => (
          <td key={i} className={cn("p-2 text-right tabular-nums", colorFor(accent, b.valor))}>
            {b.valor ? b.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—"}
          </td>
        ))}
        <td className={cn("p-2 text-right tabular-nums font-semibold", colorFor(accent, total))}>{BRL(total)}</td>
      </tr>
    );
  }

  function SubtotalRow({ label, vals, base }: { label: string; vals: number[]; base?: number[] }) {
    const buckets = agrupar(vals);
    const baseBuckets = base ? agrupar(base) : null;
    const total = sum(vals);
    const baseTotal = base ? sum(base) : 0;
    const cls = colorFor("resultado", total);
    const fmtPct = (v: number, b: number) => (b > 0 ? `${((v / b) * 100).toFixed(1).replace(".", ",")}%` : "—");
    return (
      <tr className="border-t-2 border-foreground/30 bg-muted/60 font-bold">
        <td className="p-2 sticky left-0 z-10 bg-muted/60">(=) {label}</td>
        {buckets.map((b, i) => (
          <td key={i} className={cn("p-2 text-right tabular-nums", cls)}>
            <div>{b.valor ? b.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—"}</div>
            {baseBuckets && (
              <div className="text-xs font-normal text-muted-foreground">
                {fmtPct(b.valor, baseBuckets[i].valor)}
              </div>
            )}
          </td>
        ))}
        <td className={cn("p-2 text-right tabular-nums", cls)}>
          <div>{BRL(total)}</div>
          {base && (
            <div className="text-xs font-normal text-muted-foreground">
              {fmtPct(total, baseTotal)}
            </div>
          )}
        </td>
      </tr>
    );
  }

  function renderBlocoChildren(k: BlocoKey) {
    const expKey = `bloco:${k}`;
    if (!expanded.has(expKey)) return null;
    const data = blocos.get(k);
    if (!data) return null;
    return Array.from(data.porDep.entries()).map(([depKey, dep]) => {
      const depExpKey = `${k}:${depKey}`;
      const depOpen = expanded.has(depExpKey);
      const depBuckets = agrupar(dep.total);
      return (
        <FragmentRows key={depExpKey}>
          <tr className="border-t cursor-pointer hover:bg-muted/30" onClick={() => toggle(depExpKey)}>
            <td className="p-2 sticky left-0 bg-background z-10" style={{ paddingLeft: 8 + 1 * 16 }}>
              <div className="flex items-center gap-1">
                {depOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span>{dep.nome}</span>
              </div>
            </td>
            {depBuckets.map((b, i) => (
              <td key={i} className="p-2 text-right tabular-nums text-muted-foreground">
                {b.valor ? b.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—"}
              </td>
            ))}
            <td className="p-2 text-right tabular-nums">{BRL(sum(dep.total))}</td>
          </tr>
          {depOpen && Array.from(dep.porCat.entries()).map(([catKey, cat]) => {
            const catExpKey = `${k}:${depKey}:${catKey}`;
            const catOpen = expanded.has(catExpKey);
            const catBuckets = agrupar(cat.total);
            return (
              <FragmentRows key={catExpKey}>
                <tr className="border-t cursor-pointer hover:bg-muted/30" onClick={() => toggle(catExpKey)}>
                  <td className="p-2 sticky left-0 bg-background z-10" style={{ paddingLeft: 8 + 2 * 16 }}>
                    <div className="flex items-center gap-1">
                      {catOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <span className="text-muted-foreground">{cat.nome}</span>
                    </div>
                  </td>
                  {catBuckets.map((b, i) => (
                    <td key={i} className="p-2 text-right tabular-nums text-muted-foreground">
                      {b.valor ? b.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—"}
                    </td>
                  ))}
                  <td className="p-2 text-right tabular-nums">{BRL(sum(cat.total))}</td>
                </tr>
                {catOpen && cat.itens.map((it) => {
                  const vals = valPorItem.get(it.id) ?? zero12();
                  const itBuckets = agrupar(vals);
                  return (
                    <tr key={it.id} className="border-t">
                      <td className="p-2 sticky left-0 bg-background z-10" style={{ paddingLeft: 8 + 3 * 16 }}>
                        <span className="text-foreground">{it.nome}</span>
                      </td>
                      {itBuckets.map((b, i) => (
                        <td key={i} className="p-2 text-right tabular-nums text-muted-foreground">
                          {b.valor ? b.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—"}
                        </td>
                      ))}
                      <td className="p-2 text-right tabular-nums">{BRL(sum(vals))}</td>
                    </tr>
                  );
                })}
              </FragmentRows>
            );
          })}
        </FragmentRows>
      );
    });
  }

  return (
    <div className="space-y-3">
      {naoClassif && (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          Há despesas sem grupo DRE classificado. Abra <strong>Cadastros</strong> e defina o "Grupo DRE" das categorias para que entrem nos subtotais.
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-2 sticky left-0 bg-muted/50 z-10 min-w-[280px]"></th>
              {colHeaders.map((m) => <th key={m} className="text-right p-2 min-w-[80px]">{m}</th>)}
              <th className="text-right p-2 min-w-[110px]">Total</th>
            </tr>
          </thead>
          <tbody>
            <BlocoHeader k="entrada" />
            {renderBlocoChildren("entrada")}

            <BlocoHeader k="imposto_direto" />
            {renderBlocoChildren("imposto_direto")}

            <SubtotalRow label="RECEITA LÍQUIDA" vals={receitaLiquida} />

            <BlocoHeader k="custo_variavel" />
            {renderBlocoChildren("custo_variavel")}

            <SubtotalRow label="MARGEM DE CONTRIBUIÇÃO" vals={margemContrib} base={receitaLiquida} />

            <BlocoHeader k="custo_fixo" />
            {renderBlocoChildren("custo_fixo")}

            <SubtotalRow label="EBITDA" vals={ebitda} base={receitaLiquida} />

            <BlocoHeader k="capex" />
            {renderBlocoChildren("capex")}

            <SubtotalRow label="LUCRO OPERACIONAL (EBIT)" vals={ebit} />

            {/* Linha em branco visual */}
            <tr><td className="p-1" colSpan={colHeaders.length + 2}></td></tr>

            <BlocoHeader k="aporte" />
            {renderBlocoChildren("aporte")}

            {naoClassif && (
              <>
                <BlocoHeader k="nao_classificado" />
                {renderBlocoChildren("nao_classificado")}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
