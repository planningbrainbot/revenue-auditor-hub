import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  PageHeader,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { listaTrimestres } from "@/lib/rede/trimestre";
import { cn } from "@/lib/utils";
import {
  ComMotivo,
  ConfirmarApagar,
  IduMetasPadrao,
  MOTIVO_SEM_EDICAO,
  type Indicador,
  type PadraoRow,
  type Periodo,
} from "./idu-metas-padrao";

const NA = "—";

/** Linha de public.idu_ranking(date, date). */
type RankRow = {
  posicao: number;
  unidade_id: number;
  unidade: string;
  curva: string;
  soma_pontos: number | null;
  base_efetiva: number | null;
  idu: number | null;
  faixa: string;
  liberado_pct: number | null;
  falta_corte: number | null;
  pilar_fraco: string | null;
};

/** Linha de public.idu_apuracao(date, date). */
type DetRow = {
  unidade_id: number;
  unidade: string;
  curva: string;
  trimestres: number;
  indicador: string;
  rotulo: string;
  pilar: string;
  peso: number;
  direcao: string;
  unidade_medida: string;
  meta: number | null;
  realizado: number | null;
  atingimento: number | null;
  ajuste: string;
  pontos: number | null;
  /** De onde veio a meta: 'unidade' | 'tier' | 'rede' | 'fixa' (churn 5%). Nulo = sem meta. */
  meta_origem: string | null;
};

const ORIGEM_ROTULO: Record<string, string> = {
  unidade: "unidade",
  tier: "tier",
  rede: "rede",
  fixa: "fixa",
};

/** Faixa do IDU em StatusBadge (contrato idu.md): ícone + palavra, cinco tons. */
const FAIXA_TOM: Record<string, TomStatus> = {
  Crítico: "perigo",
  Abaixo: "atencao",
  "Na meta": "sucesso",
  Superação: "info",
  "sem base": "neutro",
};

/** Faixas que cruzaram o corte de 75: "cruzou" sai da faixa, não de falta_corte === 0. */
const CRUZOU = new Set(["Na meta", "Superação"]);

const PERGUNTA = "Qual unidade está abaixo do corte de 75 neste trimestre, e em qual pilar?";

const PROCEDENCIA = {
  fonte:
    "RPC idu_ranking e idu_apuracao (contratos, tratativas, NPS, auditorias) · metas em idu_metas e idu_metas_padrao",
  regua: "corte 75, piso 50%, teto 120%",
};

/**
 * Trimestres civis com fim EXCLUSIVO: é o que idu_apuracao espera.
 * Começa no PRÓXIMO trimestre: as metas se pactuam antes de o trimestre abrir (main, 34e0f85).
 */
const trimestres = (): (Periodo & { futuro: boolean })[] => {
  const hoje = new Date();
  const daquiATres = new Date(hoje.getFullYear(), hoje.getMonth() + 3, 1);
  return listaTrimestres({ fim: "exclusivo", quantos: 9, hoje: daquiATres }).map((t, i) => ({
    ...t,
    label: i === 0 ? `${t.label} (próximo)` : t.label,
    futuro: i === 0,
  }));
};

const fmtNum = (v: number | null | undefined, casas = 1) =>
  v === null || v === undefined
    ? NA
    : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

function fmtValor(v: number | null, medida: string) {
  if (v === null || v === undefined) return NA;
  if (medida === "R$/mês")
    return v.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    });
  if (medida === "%") return `${fmtNum(v, 1)}%`;
  return fmtNum(v, 0);
}

/** Unidade sem base efetiva: nenhum indicador com meta e dado, IDU nulo. */
const semBase = (r: RankRow) => r.idu === null || !r.base_efetiva;

type VoltarPadrao = { unidadeId: number; unidade: string; indicador: string; rotulo: string };

export function IduView() {
  const periodos = useMemo(trimestres, []);
  // Padrão: trimestre anterior ao corrente, o último fechado. [0] é o próximo, [1] o corrente.
  const padraoTri = periodos[2] ?? periodos[0];
  const [trimestreUrl, setTrimestreUrl] = useFiltroNaUrl("trimestre", padraoTri.key);
  const periodo = periodos.find((p) => p.key === trimestreUrl) ?? padraoTri;
  const [unidadeUrl, setUnidadeUrl] = useFiltroNaUrl("unidade", "");

  const [rank, setRank] = useState<RankRow[]>([]);
  const [det, setDet] = useState<DetRow[]>([]);
  const [padrao, setPadrao] = useState<PadraoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [voltar, setVoltar] = useState<VoltarPadrao | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { can, loading: permLoading } = usePermissions();
  const temAcesso = can("view.idu");
  const podeEditarMetas = can("edit.idu_metas");

  /**
   * `silencioso` recarrega depois de salvar sem trocar a página pelo
   * esqueleto: a tabela fica, a linha aberta fica, e uma falha vira toast.
   */
  const carregar = useCallback(
    async (silencioso = false) => {
      if (!silencioso) {
        setLoading(true);
        setErro(null);
      }
      const args = { p_inicio: periodo.ini, p_fim: periodo.fim };
      const [r, d, p] = await Promise.all([
        supabase.rpc("idu_ranking", args),
        supabase.rpc("idu_apuracao", args),
        supabase
          .from("idu_metas_padrao")
          .select("escopo, indicador, meta")
          .eq("periodo_inicio", periodo.ini),
      ]);
      const falha = r.error?.message ?? d.error?.message ?? p.error?.message ?? null;
      if (falha) {
        if (silencioso) {
          toast.error(`Salvo, mas não foi possível recarregar o IDU: ${falha}`);
        } else {
          setErro(falha);
          setRank([]);
          setDet([]);
          setPadrao([]);
        }
      } else {
        setRank((r.data ?? []) as RankRow[]);
        setDet((d.data ?? []) as DetRow[]);
        setPadrao((p.data ?? []) as PadraoRow[]);
      }
      if (!silencioso) setLoading(false);
    },
    [periodo.ini, periodo.fim],
  );

  const recarregar = useCallback(() => carregar(true), [carregar]);

  useEffect(() => {
    // Sem view.idu as RPCs devolvem zero linhas, que pareciam "sem apuração":
    // nem chama, e a tela diz o que falta.
    if (!permLoading && temAcesso) void carregar();
  }, [carregar, permLoading, temAcesso]);

  async function salvarMeta(l: DetRow, valor: string) {
    const limpo = valor.trim();
    const meta = Number(limpo.replace(",", "."));
    if (limpo === "" || !Number.isFinite(meta)) {
      toast.error(
        limpo === ""
          ? `Informe a meta de ${l.rotulo}. Para seguir o tier ou a rede, use "Voltar ao padrão".`
          : `Meta inválida: "${limpo}" não é um número.`,
      );
      return;
    }
    if (salvando) return;
    setSalvando(true);
    const { error } = await supabase.from("idu_metas").upsert(
      {
        unidade_id: l.unidade_id,
        periodo_inicio: periodo.ini,
        periodo_fim: periodo.fim,
        indicador: l.indicador,
        meta,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "unidade_id,periodo_inicio,indicador" },
    );
    setSalvando(false);
    // Erro fica no campo: a edição continua aberta e a página não muda.
    if (error) {
      toast.error(`Não foi possível salvar a meta de ${l.rotulo}: ${error.message}`);
      return;
    }
    setEditando(null);
    toast.success(`Meta de ${l.rotulo} salva para ${l.unidade}`);
    await recarregar();
  }

  /** Apaga a meta própria da unidade: ela volta a seguir o tier ou a rede. */
  async function confirmarVoltar() {
    if (!voltar) return;
    const alvo = voltar;
    setVoltar(null);
    const { error } = await supabase
      .from("idu_metas")
      .delete()
      .eq("unidade_id", alvo.unidadeId)
      .eq("periodo_inicio", periodo.ini)
      .eq("indicador", alvo.indicador);
    if (error) {
      toast.error(`Não foi possível voltar ao padrão em ${alvo.rotulo}: ${error.message}`);
      return;
    }
    toast.success(`${alvo.unidade} voltou a seguir a meta padrão de ${alvo.rotulo}`);
    await recarregar();
  }

  // Linha aberta na URL pelo unidade_id; o nome (links antigos) vale como
  // fallback e é trocado pelo id. Valor que não acha unidade sai da URL.
  const achada = useMemo(
    () =>
      unidadeUrl
        ? (rank.find((r) => String(r.unidade_id) === unidadeUrl) ??
          rank.find((r) => r.unidade === unidadeUrl) ??
          null)
        : null,
    [rank, unidadeUrl],
  );
  const aberta = achada?.unidade_id ?? null;
  useEffect(() => {
    if (loading || erro || !unidadeUrl) return;
    if (!achada) setUnidadeUrl("");
    else if (String(achada.unidade_id) !== unidadeUrl) setUnidadeUrl(String(achada.unidade_id));
  }, [loading, erro, unidadeUrl, achada, setUnidadeUrl]);

  const semAcesso = !permLoading && !temAcesso;
  const carregando = permLoading || (temAcesso && loading);
  const pronto = !semAcesso && !carregando && !erro;

  // Selo de metas faltando: conta indicadores, não pares unidade × indicador.
  const semMeta = useMemo(() => {
    const porIndicador = new Map<string, { rotulo: string; unidades: string[] }>();
    for (const d of det) {
      if (d.meta !== null) continue;
      const item = porIndicador.get(d.indicador) ?? { rotulo: d.rotulo, unidades: [] };
      item.unidades.push(d.unidade);
      porIndicador.set(d.indicador, item);
    }
    return [...porIndicador.values()];
  }, [det]);

  const filtros = semAcesso ? undefined : (
    <>
      <Select value={periodo.key} onValueChange={(v) => setTrimestreUrl(v)}>
        <SelectTrigger className="w-[200px]" aria-label="Trimestre">
          <SelectValue placeholder="Trimestre" />
        </SelectTrigger>
        <SelectContent>
          {periodos.map((p) => (
            <SelectItem key={p.key} value={p.key}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pronto && semMeta.length > 0 ? (
        <StatusBadge tom="atencao">
          {semMeta.length} indicador{semMeta.length > 1 ? "es" : ""} sem meta, fora do denominador
        </StatusBadge>
      ) : null}
    </>
  );

  const universo = pronto && rank.length ? `${rank.length} unidades · ` : "";
  const cabecalho = (
    <PageHeader
      titulo="IDU"
      pergunta={PERGUNTA}
      descricao={`${universo}${periodo.label} · nota 0–100 sobre a base efetiva de pesos; indicador sem meta ou sem dado sai do denominador`}
      procedencia={PROCEDENCIA}
      filtros={filtros}
    >
      {pronto && semMeta.length > 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Sem meta em nenhum nível:{" "}
          {semMeta
            .map((s) =>
              s.unidades.length === rank.length
                ? `${s.rotulo} (todas as ${rank.length} unidades)`
                : `${s.rotulo} (${s.unidades.join(", ")})`,
            )
            .join(" · ")}
          .
        </p>
      ) : null}
    </PageHeader>
  );

  if (semAcesso) {
    return (
      <>
        {cabecalho}
        <EstadoSemAcesso oQueFalta="view.idu" />
      </>
    );
  }

  if (carregando) {
    return (
      <>
        {cabecalho}
        <Carregando variante="tabela" />
      </>
    );
  }

  if (erro) {
    return (
      <>
        {cabecalho}
        <EstadoErro
          titulo="Não foi possível carregar o IDU"
          detalhe={erro}
          tentarNovamente={() => void carregar()}
        />
      </>
    );
  }

  if (!rank.length) {
    return (
      <>
        {cabecalho}
        <EstadoVazio
          titulo="Sem apuração neste trimestre"
          descricao={`Nenhuma unidade apurada em ${periodo.label}. Escolha outro trimestre no filtro acima.`}
        />
      </>
    );
  }

  // Catálogo e contagem por tier saem da própria apuração: a ordem é a da tela de detalhe.
  const indicadores: Indicador[] = [];
  for (const d of det)
    if (!indicadores.some((i) => i.indicador === d.indicador)) indicadores.push(d);
  const unidadesPorTier: Record<string, number> = {};
  for (const r of rank) unidadesPorTier[r.curva] = (unidadesPorTier[r.curva] ?? 0) + 1;
  const idx = periodos.findIndex((p) => p.key === periodo.key);

  return (
    <>
      {cabecalho}

      <IduMetasPadrao
        periodo={periodo}
        anterior={periodos[idx + 1]}
        indicadores={indicadores}
        padrao={padrao}
        unidadesPorTier={unidadesPorTier}
        podeEditar={podeEditarMetas}
        fmtValor={fmtValor}
        onSalvo={recarregar}
      />

      {/* No trimestre futuro o ranking vira lista de unidades, sem nota, faixa nem percentual
          liberado: sem venda e com churn zero a apuração daria Superação para todo mundo. */}
      <Secao
        titulo={
          periodo.futuro
            ? "Quais unidades vão pactuar meta no próximo trimestre?"
            : "Como cada unidade ficou no ranking da rede?"
        }
        descricao={
          periodo.futuro
            ? "O trimestre ainda não começou, então não há nota. Clique na unidade para definir uma meta só dela."
            : "A nota mede quanto do combinado foi entregue, não o tamanho da unidade. Clique na unidade para abrir os indicadores e pactuar a meta dela."
        }
      >
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">Abrir</span>
                </TableHead>
                <TableHead className="w-12 text-right">#</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Curva</TableHead>
                <TableHead className="text-right">IDU</TableHead>
                <TableHead>Faixa</TableHead>
                <TableHead className="text-right">Libera</TableHead>
                <TableHead className="text-right">Falta p/ 75</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead>Pilar mais fraco</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rank.map((r) => {
                const aberto = aberta === r.unidade_id;
                const linhas = det.filter((d) => d.unidade_id === r.unidade_id);
                const alternar = () => setUnidadeUrl(aberto ? "" : String(r.unidade_id));
                const sb = semBase(r);
                return (
                  <Fragment key={r.unidade_id}>
                    <TableRow className="cursor-pointer" onClick={alternar}>
                      <TableCell>
                        <button
                          type="button"
                          aria-expanded={aberto}
                          aria-controls={aberto ? `idu-det-${r.unidade_id}` : undefined}
                          aria-label={`${aberto ? "Fechar" : "Abrir"} indicadores de ${r.unidade}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            alternar();
                          }}
                          className="inline-flex rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          {aberto ? (
                            <ChevronDown className="size-4" aria-hidden />
                          ) : (
                            <ChevronRight className="size-4" aria-hidden />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {periodo.futuro ? NA : r.posicao}
                      </TableCell>
                      <TableCell className="font-medium">{r.unidade}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.curva}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {periodo.futuro ? NA : fmtNum(r.idu)}
                      </TableCell>
                      <TableCell>
                        {periodo.futuro ? (
                          NA
                        ) : (
                          <StatusBadge tom={FAIXA_TOM[r.faixa] ?? "neutro"}>{r.faixa}</StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {periodo.futuro || r.liberado_pct === null
                          ? NA
                          : `${fmtNum(r.liberado_pct, 0)}%`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {periodo.futuro
                          ? NA
                          : sb || r.falta_corte === null
                            ? "sem base"
                            : CRUZOU.has(r.faixa)
                              ? "cruzou"
                              : fmtNum(r.falta_corte)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {periodo.futuro ? NA : sb ? "sem base" : r.base_efetiva}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {periodo.futuro ? NA : (r.pilar_fraco ?? NA)}
                      </TableCell>
                    </TableRow>
                    {aberto && (
                      <TableRow
                        id={`idu-det-${r.unidade_id}`}
                        className="bg-muted/30 hover:bg-muted/30"
                      >
                        <TableCell colSpan={10} className="p-0">
                          <div className="overflow-x-auto p-4">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Indicador</TableHead>
                                  <TableHead>Pilar</TableHead>
                                  <TableHead className="text-right">Peso</TableHead>
                                  <TableHead className="text-right">Meta</TableHead>
                                  <TableHead className="text-right">Realizado</TableHead>
                                  <TableHead className="text-right">Ating.</TableHead>
                                  <TableHead className="text-right">Pontos</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {linhas.map((l) => (
                                  <LinhaIndicador
                                    key={`${l.unidade_id}:${l.indicador}`}
                                    l={l}
                                    editando={editando === `${l.unidade_id}:${l.indicador}`}
                                    rascunho={rascunho}
                                    salvando={salvando}
                                    podeEditar={podeEditarMetas}
                                    onEditar={() => {
                                      setEditando(`${l.unidade_id}:${l.indicador}`);
                                      setRascunho(l.meta === null ? "" : String(l.meta));
                                    }}
                                    onRascunho={setRascunho}
                                    onSalvar={() => void salvarMeta(l, rascunho)}
                                    onCancelar={() => setEditando(null)}
                                    onVoltar={() =>
                                      setVoltar({
                                        unidadeId: l.unidade_id,
                                        unidade: l.unidade,
                                        indicador: l.indicador,
                                        rotulo: l.rotulo,
                                      })
                                    }
                                  />
                                ))}
                                <TableRow className="bg-muted/50">
                                  <TableCell colSpan={6} className="font-medium">
                                    {sb
                                      ? "Sem base efetiva: nenhum indicador com meta e dado neste trimestre"
                                      : `Soma sobre base efetiva de ${r.base_efetiva} pontos`}
                                  </TableCell>
                                  <TableCell className="text-right font-semibold tabular-nums">
                                    {fmtNum(r.soma_pontos)}
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Secao>

      <p className="text-xs text-muted-foreground">
        Piso de 50% zera o indicador · teto de 120% · nota limitada a 100 · abaixo de 75 a nota é o
        próprio percentual liberado, de 75 a 89 libera 100%, de 90 a 100 libera até 120%. A meta da
        unidade vence a do tier, que vence a da rede. Indicador sem meta em nenhum nível ou sem dado
        sai do denominador. Churn é o que está lançado no pipe de Tratativas.
      </p>

      <ConfirmarApagar
        aberto={!!voltar}
        titulo={voltar ? `Voltar ${voltar.unidade} ao padrão em ${voltar.rotulo}?` : ""}
        descricao={
          voltar
            ? `A meta própria da unidade em ${periodo.label.split(" ·")[0]} é apagada, e ela passa a seguir a meta do tier ou da rede.`
            : ""
        }
        rotuloAcao="Voltar ao padrão"
        onCancelar={() => setVoltar(null)}
        onConfirmar={() => void confirmarVoltar()}
      />
    </>
  );
}

function LinhaIndicador({
  l,
  editando,
  rascunho,
  salvando,
  podeEditar,
  onEditar,
  onRascunho,
  onSalvar,
  onCancelar,
  onVoltar,
}: {
  l: DetRow;
  editando: boolean;
  rascunho: string;
  salvando: boolean;
  podeEditar: boolean;
  onEditar: () => void;
  onRascunho: (v: string) => void;
  onSalvar: () => void;
  onCancelar: () => void;
  onVoltar: () => void;
}) {
  const origem = l.meta_origem ? ORIGEM_ROTULO[l.meta_origem] : undefined;
  return (
    <TableRow>
      <TableCell className="font-medium">{l.rotulo}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{l.pilar}</TableCell>
      <TableCell className="text-right tabular-nums">{l.peso}</TableCell>
      <TableCell className="text-right tabular-nums">
        {editando ? (
          <div className="flex items-center justify-end gap-1">
            <Input
              autoFocus
              value={rascunho}
              aria-label={`Meta de ${l.rotulo} para ${l.unidade}`}
              onChange={(e) => onRascunho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSalvar();
                if (e.key === "Escape") onCancelar();
              }}
              className="h-8 w-24 text-right"
            />
            <Button size="sm" disabled={salvando} onClick={onSalvar}>
              ok
            </Button>
          </div>
        ) : (
          <span className="inline-flex items-center justify-end gap-1">
            <ComMotivo ativo={!podeEditar} motivo={MOTIVO_SEM_EDICAO}>
              <button
                type="button"
                disabled={!podeEditar}
                onClick={onEditar}
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  podeEditar && "hover:underline",
                  !podeEditar && "pointer-events-none",
                  l.meta === null && "text-warning",
                )}
              >
                {l.meta === null
                  ? podeEditar
                    ? "definir meta"
                    : "sem meta"
                  : fmtValor(l.meta, l.unidade_medida)}
                {origem && (
                  <span className="rounded bg-muted px-1 text-xs text-muted-foreground">
                    {origem}
                  </span>
                )}
                {podeEditar && <Pencil className="size-3 text-muted-foreground" aria-hidden />}
              </button>
            </ComMotivo>
            {podeEditar && l.meta_origem === "unidade" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                title="Voltar ao padrão: apagar a meta própria e seguir o tier ou a rede"
                aria-label={`Voltar ao padrão em ${l.rotulo}`}
                onClick={onVoltar}
              >
                <RotateCcw className="size-4" aria-hidden />
              </Button>
            )}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {fmtValor(l.realizado, l.unidade_medida)}
      </TableCell>
      <TableCell
        className={cn(
          "text-right tabular-nums",
          l.ajuste === "piso" && "text-danger",
          l.ajuste === "teto" && "text-info",
          l.ajuste === "sem dado" && "text-muted-foreground",
        )}
      >
        {l.atingimento === null
          ? l.meta === null
            ? "sem meta"
            : "sem dado"
          : `${fmtNum(l.atingimento, 0)}%${
              l.ajuste === "piso" ? " ↓piso" : l.ajuste === "teto" ? " ↑teto" : ""
            }`}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {l.pontos === null ? NA : fmtNum(l.pontos, 1)}
      </TableCell>
    </TableRow>
  );
}
