import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unitMatches, usePermissions } from "@/hooks/use-permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { listaTrimestres, type Trimestre } from "@/lib/rede/trimestre";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  StatusBadge,
  type EstadoKpi,
} from "@/components/planning";

const NA = "—";

/** Linha devolvida por public.indicadores_trimestre(date, date). */
type Row = {
  unidade_id: number;
  unidade: string;
  data_inauguracao: string | null;
  meses_apurados: number;
  tem_omie: boolean;
  fat_base_nova: number | null;
  fat_total: number | null;
  clientes_base_nova: number;
  inad_a_cobrar: number | null;
  inad_aberto: number | null;
  inad_pct: number | null;
  roy_csc: number | null;
  take_rate_pct: number | null;
  midia: number | null;
  novos_contratos: number;
  mrr_vendido: number | null;
  ticket_medio: number | null;
  receita_anualizada: number | null;
  receita_bookada_ltv: number | null;
  roas: number | null;
  churn_pipefy_n: number;
  churn_pipefy_mrr: number | null;
  churn_faturamento_n: number;
  churn_faturamento_mrr: number | null;
  estoque_aberto: number | null;
  estoque_mais_1ano: number | null;
};

/**
 * Rótulo único de cada número (N11): o card e a coluna do comparativo usam a
 * mesma string, para a pessoa não achar que "Take rate" e "Take rate da rede"
 * são números diferentes.
 */
const R = {
  fat: "Faturamento da base nova",
  inad: "Inadimplência",
  roy: "Royalties + CSC",
  take: "Take rate da unidade",
  anual: "Receita anualizada",
  bookada: "Receita bookada (MRR × 60)",
  novos: "Novos contratos",
  ticket: "Ticket médio mensal",
  mrr: "MRR vendido no trimestre",
  roas: "ROAS",
  churnN: "Churn de clientes",
  churnMrr: "Churn de receita",
  estoque: "Estoque em aberto",
  estoque1a: "Estoque em aberto > 1 ano",
} as const;

// Procedência por card (N3). Sem data: a RPC não devolve quando cada fonte foi
// atualizada, e o Procedencia diz isso em vez de sumir.
const F = {
  apuracao: { fonte: "Apuração confirmada" },
  contratos: { fonte: "Contratos" },
  receber: { fonte: "Contas a receber" },
  roas: { fonte: "Contratos + apuração" },
} as const;

const fmtBRL = (v: number | null | undefined, casas = 0) =>
  v === null || v === undefined
    ? NA
    : v.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: casas,
      });

const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined
    ? NA
    : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const fmtX = (v: number | null | undefined) =>
  v === null || v === undefined
    ? NA
    : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`;

const fmtNum = (v: number | null | undefined) =>
  v === null || v === undefined ? NA : v.toLocaleString("pt-BR");

/** Trimestres civis com fim INCLUSIVO: é o que indicadores_trimestre espera. */
const trimestresDisponiveis = (): Trimestre[] => listaTrimestres({ fim: "inclusivo" });

/**
 * Maturação da safra de inadimplência. O indicador só estabiliza ~60 dias depois do
 * vencimento — antes disso ele mede fatura recente, não perda (DATA-RULES 25/08/2026).
 */
function maturacao(fim: string): { madura: boolean; dias: number } {
  const dias = Math.floor((Date.now() - new Date(`${fim}T00:00:00Z`).getTime()) / 86400000);
  return { madura: dias >= 60, dias };
}

// Adaptador sobre o KpiCard do design system. `NA` é o "—" que os
// formatadores devolvem para null: vira "não apurado" em vez de um traço que
// parece número (N4). O alerta vai na nota do card, com ícone e palavra (V7,
// N9), no lugar dos antigos cards âmbar soltos.
function CardKPI({
  label,
  valor,
  hint,
  alerta,
  parcial,
  estado,
  procedencia,
}: {
  label: string;
  valor: string;
  hint?: string;
  alerta?: string;
  parcial?: boolean;
  estado?: EstadoKpi;
  procedencia: { fonte: string };
}) {
  const est: EstadoKpi = estado ?? (valor === NA ? "nao-apurado" : parcial ? "parcial" : "ok");
  return (
    <KpiCard
      rotulo={label}
      valor={valor}
      estado={est}
      procedencia={procedencia}
      nota={
        hint || alerta ? (
          <>
            {hint}
            {alerta ? (
              <span className={cn("flex items-start gap-1 text-warning", hint && "mt-1")}>
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="sr-only">Atenção: </span>
                  {alerta}
                </span>
              </span>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}

const PERGUNTA = "Como cada unidade fechou o trimestre, em finanças e em vendas?";

export function IndicadoresTrimestreView() {
  const trimestres = useMemo(trimestresDisponiveis, []);
  // Padrão: trimestre anterior ao corrente — o último com apuração fechada e safra madura.
  const padrao = trimestres[1] ?? trimestres[0];
  const [trimestreUrl, setTrimestreUrl] = useFiltroNaUrl("trimestre", padrao.key);
  const periodo = trimestres.find((t) => t.key === trimestreUrl) ?? padrao;
  const [unidadeUrl, setUnidadeUrl] = useFiltroNaUrl("unidade", "");
  // A página é usada para apresentar os números PARA a unidade, na reunião trimestral.
  // Por isso o comparativo da rede nasce fechado e é opt-in: ninguém abre a tela na frente
  // de um sócio regional e mostra, sem querer, o resultado dos outros. Mesma lógica da decisão
  // de 11/08/2026 em /rede-overview (dados agregados de rede ficam fechados por padrão).
  const [comparativo, setComparativo] = useFiltroNaUrl("comparativo", "fechado");
  const mostrarRede = comparativo === "aberto";

  const { can, loading: permLoading, unidade: unidadeDoUsuario } = usePermissions();
  const temAcesso = can("view.indicadores_trimestre");
  const podeVerRede = can("view.network.benchmarks");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    // Sem a permissão a RPC devolve zero linhas, que pareciam "sem dados":
    // nem chama, e a tela diz o que falta.
    if (permLoading || !temAcesso) return;
    let alive = true;
    setLoading(true);
    setErro(null);
    (async () => {
      const { data, error } = await supabase.rpc("indicadores_trimestre", {
        _ini: periodo.ini,
        _fim: periodo.fim,
      });
      if (!alive) return;
      if (error) {
        setErro(error.message);
        setRows([]);
      } else {
        setRows((data ?? []) as unknown as Row[]);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [periodo.ini, periodo.fim, permLoading, temAcesso, tentativa]);

  // Unidade: a da URL; senão a do usuário, quando ele é de uma unidade; senão a primeira.
  const selecionada = useMemo(
    () =>
      rows.find((r) => r.unidade === unidadeUrl) ??
      (unidadeDoUsuario ? rows.find((r) => unitMatches(unidadeDoUsuario, r.unidade)) : undefined) ??
      rows[0] ??
      null,
    [rows, unidadeUrl, unidadeDoUsuario],
  );

  const mat = maturacao(periodo.fim);
  const carregando = permLoading || (temAcesso && loading);
  const semAcesso = !permLoading && !temAcesso;

  const filtros = semAcesso ? undefined : (
    <>
      <Select value={periodo.key} onValueChange={(v) => setTrimestreUrl(v)}>
        <SelectTrigger className="w-[200px]" aria-label="Trimestre">
          <SelectValue placeholder="Trimestre" />
        </SelectTrigger>
        <SelectContent>
          {trimestres.map((t) => (
            <SelectItem key={t.key} value={t.key}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!carregando && !erro && rows.length > 0 && selecionada ? (
        <Select value={selecionada.unidade} onValueChange={(v) => setUnidadeUrl(v)}>
          <SelectTrigger className="w-[220px]" aria-label="Unidade">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            {rows.map((r) => (
              <SelectItem key={r.unidade_id} value={r.unidade}>
                {r.unidade}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </>
  );

  const nomeUnidade = selecionada?.unidade ?? unidadeUrl ?? "";
  const descricao = `${nomeUnidade ? `${nomeUnidade} · ` : ""}${periodo.label} · faturamento e take rate da apuração de royalties confirmada; vendas pelos contratos ganhos no trimestre`;

  const cabecalho = (
    <PageHeader
      titulo="Indicadores do Trimestre"
      pergunta={PERGUNTA}
      descricao={descricao}
      procedencia={{
        fonte: "RPC indicadores_trimestre (apuração de royalties, contratos, contas a receber)",
      }}
      filtros={filtros}
    />
  );

  if (semAcesso) {
    return (
      <>
        {cabecalho}
        <EstadoSemAcesso oQueFalta="view.indicadores_trimestre" />
      </>
    );
  }

  if (carregando) {
    return (
      <>
        {cabecalho}
        <Carregando variante="kpis" />
      </>
    );
  }

  if (erro) {
    return (
      <>
        {cabecalho}
        <EstadoErro
          titulo="Não foi possível carregar os indicadores"
          detalhe={`RPC indicadores_trimestre: ${erro}`}
          tentarNovamente={() => setTentativa((n) => n + 1)}
        />
      </>
    );
  }

  if (!rows.length) {
    return (
      <>
        {cabecalho}
        <EstadoVazio
          titulo="Sem apuração confirmada neste trimestre"
          descricao={`Nenhuma unidade com dado em ${periodo.label}. Escolha outro trimestre no filtro acima.`}
        />
      </>
    );
  }

  return (
    <>
      {cabecalho}

      {selecionada ? <DetalheUnidade row={selecionada} mat={mat} /> : null}

      {/* Comparativo da rede — fechado por padrão. Ver comentário em `comparativo`. */}
      {permLoading || !podeVerRede ? null : (
        <Secao
          titulo="Como as unidades se comparam neste trimestre?"
          descricao={
            mostrarRede
              ? "Mesmos rótulos dos cards acima. Clique no nome para ver a unidade."
              : "Fechado por padrão: esta tela é usada para apresentar os números para a própria unidade."
          }
          acoes={
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={mostrarRede}
              aria-controls="comparativo-rede"
              onClick={() => setComparativo(mostrarRede ? "fechado" : "aberto")}
            >
              {mostrarRede ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
              {mostrarRede ? "Fechar comparativo" : "Abrir comparativo"}
            </Button>
          }
        >
          {mostrarRede ? (
            <div className="space-y-2">
              <div id="comparativo-rede" className="overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unidade</TableHead>
                      <TableHead className="text-right">{R.fat}</TableHead>
                      <TableHead className="text-right">{R.inad}</TableHead>
                      <TableHead className="text-right">{R.roy}</TableHead>
                      <TableHead className="text-right">{R.take}</TableHead>
                      <TableHead className="text-right">{R.novos}</TableHead>
                      <TableHead className="text-right">{R.mrr}</TableHead>
                      <TableHead className="text-right">{R.ticket}</TableHead>
                      <TableHead className="text-right">{R.roas}</TableHead>
                      <TableHead className="text-right">{R.churnN}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const rampa = r.meses_apurados < 3;
                      const ativa = selecionada?.unidade === r.unidade;
                      return (
                        <TableRow key={r.unidade_id} className={cn(ativa && "bg-muted/50")}>
                          <TableCell className="font-medium">
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-sm"
                              aria-current={ativa ? "true" : undefined}
                              onClick={() => setUnidadeUrl(r.unidade)}
                            >
                              {r.unidade}
                            </Button>
                            {rampa ? (
                              <Badge variant="outline" className="ml-2 text-xs">
                                {r.meses_apurados}/3 meses
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.fat_base_nova !== null ? (
                              fmtBRL(r.fat_base_nova)
                            ) : (
                              <span className="text-muted-foreground">sem apuração</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtPct(r.inad_pct)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtBRL(r.roy_csc)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {rampa && r.take_rate_pct !== null ? (
                              <span className="text-muted-foreground">
                                {fmtPct(r.take_rate_pct)}
                                <span aria-hidden>*</span>
                                <span className="sr-only"> unidade em rampa</span>
                              </span>
                            ) : (
                              fmtPct(r.take_rate_pct)
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtNum(r.novos_contratos)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtBRL(r.mrr_vendido)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtBRL(r.ticket_medio)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtX(r.roas)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.tem_omie ? (
                              <span className="inline-flex items-center justify-end gap-2">
                                {fmtNum(r.churn_faturamento_n)}
                                {r.churn_faturamento_n > r.churn_pipefy_n ? (
                                  <StatusBadge tom="neutro">
                                    Tratativas: {fmtNum(r.churn_pipefy_n)}
                                  </StatusBadge>
                                ) : null}
                              </span>
                            ) : (
                              fmtNum(r.churn_pipefy_n)
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                * {R.take} em rampa não é comparável — o CSC fixo domina uma base ainda pequena.
                {" "}
                {R.churnN}: régua Omie quando a unidade tem, senão Tratativas.
              </p>
            </div>
          ) : null}
        </Secao>
      )}
    </>
  );
}

function DetalheUnidade({ row: r, mat }: { row: Row; mat: { madura: boolean; dias: number } }) {
  const gapChurn = r.tem_omie && r.churn_faturamento_n > r.churn_pipefy_n;
  const rampa = r.meses_apurados < 3;
  const temApuracao = r.fat_base_nova !== null;
  const fonteChurn = r.tem_omie ? { fonte: "Omie" } : { fonte: "Tratativas (Pipefy)" };
  const pctMais1Ano =
    r.estoque_aberto && r.estoque_mais_1ano !== null
      ? Math.round((100 * r.estoque_mais_1ano) / r.estoque_aberto)
      : null;

  return (
    <div className="space-y-8">
      <Secao
        titulo={`Como ${r.unidade} fechou o trimestre em finanças?`}
        descricao="Apuração de royalties confirmada e contas a receber com vencimento no trimestre"
      >
        <KpiGrade colunas={6}>
          <CardKPI
            label={R.fat}
            valor={fmtBRL(r.fat_base_nova)}
            procedencia={F.apuracao}
            parcial={rampa}
            hint={[
              !temApuracao
                ? "Nenhuma apuração confirmada no trimestre — não é zero, é ausência de fonte"
                : "Base das apurações de royalties confirmadas",
              r.clientes_base_nova > 0 ? `${fmtNum(r.clientes_base_nova)} clientes` : null,
              (r.fat_total ?? 0) > (r.fat_base_nova ?? 0)
                ? `com base antiga ${fmtBRL(r.fat_total)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            alerta={
              temApuracao && rampa
                  ? `Só ${r.meses_apurados} de 3 meses confirmados na apuração — o trimestre está subrepresentado.`
                  : undefined
            }
          />
          <CardKPI
            label={R.inad}
            valor={fmtPct(r.inad_pct)}
            procedencia={F.receber}
            parcial={!mat.madura}
            hint={
              r.inad_a_cobrar
                ? `${fmtBRL(r.inad_aberto)} em aberto de ${fmtBRL(r.inad_a_cobrar)} a cobrar`
                : undefined
            }
            alerta={
              mat.madura
                ? undefined
                : `${mat.dias < 0 ? "Trimestre ainda não fechou" : `Trimestre fechou há ${mat.dias} dias`}: a inadimplência só estabiliza ~60 dias depois do vencimento e até lá sai superestimada.`
            }
          />
          <CardKPI
            label={R.roy}
            valor={fmtBRL(r.roy_csc)}
            procedencia={F.apuracao}
            hint={r.midia ? `Tráfego pago à parte: ${fmtBRL(r.midia)}` : undefined}
          />
          <CardKPI
            label={R.take}
            valor={fmtPct(r.take_rate_pct)}
            procedencia={F.apuracao}
            hint="Royalties + CSC ÷ base apurada"
            alerta={
              rampa && r.take_rate_pct !== null
                ? "Unidade em rampa: CSC fixo distorce o percentual."
                : undefined
            }
          />
          <CardKPI
            label={R.anual}
            valor={fmtBRL(r.receita_anualizada)}
            procedencia={F.contratos}
            hint="MRR vendido no trimestre × 12"
          />
          <CardKPI
            label={R.bookada}
            valor={fmtBRL(r.receita_bookada_ltv)}
            procedencia={F.contratos}
            hint="MRR vendido × 60 meses"
          />
        </KpiGrade>
      </Secao>

      <Secao
        titulo={`Quanto ${r.unidade} vendeu e perdeu no trimestre?`}
        descricao="Contratos ganhos no trimestre; churn pelo Omie quando a unidade tem, senão pelas Tratativas"
      >
        <KpiGrade colunas={6}>
          <CardKPI
            label={R.novos}
            valor={fmtNum(r.novos_contratos)}
            procedencia={F.contratos}
          />
          <CardKPI
            label={R.ticket}
            valor={fmtBRL(r.ticket_medio)}
            procedencia={F.contratos}
            hint="MRR vendido ÷ novos contratos"
          />
          <CardKPI
            label={R.mrr}
            valor={fmtBRL(r.mrr_vendido)}
            procedencia={F.contratos}
            hint="Σ MRR dos contratos ganhos"
          />
          <CardKPI
            label={R.roas}
            valor={fmtX(r.roas)}
            procedencia={F.roas}
            hint={
              r.midia
                ? `Valor 12m ÷ ${fmtBRL(r.midia)} de mídia`
                : r.roas === null && !temApuracao
                  ? "Sem apuração confirmada no trimestre: a mídia vem da apuração."
                  : undefined
            }
            alerta={
              r.roas === null && temApuracao
                ? "Sem investimento de mídia registrado no período."
                : undefined
            }
          />
          <CardKPI
            label={R.churnN}
            valor={fmtNum(r.tem_omie ? r.churn_faturamento_n : r.churn_pipefy_n)}
            procedencia={fonteChurn}
            hint={
              r.tem_omie
                ? "Régua Omie: última fatura caiu no trimestre"
                : "Régua Tratativas: cards do pipe no trimestre"
            }
            alerta={
              gapChurn
                ? `Tratativas registra só ${fmtNum(r.churn_pipefy_n)} card(s) (${fmtBRL(r.churn_pipefy_mrr)}); os que faltam nunca foram lançados. Vale o Omie, a fonte mais completa.`
                : undefined
            }
          />
          <CardKPI
            label={R.churnMrr}
            valor={fmtBRL(r.tem_omie ? r.churn_faturamento_mrr : r.churn_pipefy_mrr)}
            procedencia={fonteChurn}
            hint={
              r.tem_omie
                ? "MRR perdido no trimestre · régua Omie"
                : "MRR perdido no trimestre · régua Tratativas"
            }
          />
        </KpiGrade>
      </Secao>

      <Secao
        titulo={`Quanto ${r.unidade} tem vencido e não recebido hoje?`}
        descricao="Foto de hoje, sem corte de período: não entra no card de inadimplência acima"
      >
        <KpiGrade colunas={2}>
          <CardKPI
            label={R.estoque}
            valor={fmtBRL(r.estoque_aberto)}
            procedencia={F.receber}
            estado={r.tem_omie ? undefined : "indisponivel"}
            hint={r.tem_omie ? "Σ títulos atrasados hoje" : "A unidade não tem contas a receber no Omie"}
          />
          <CardKPI
            label={R.estoque1a}
            valor={fmtBRL(r.estoque_mais_1ano)}
            procedencia={F.receber}
            estado={r.tem_omie ? undefined : "indisponivel"}
            hint={
              r.tem_omie
                ? pctMais1Ano !== null
                  ? `${pctMais1Ano}% do estoque em aberto`
                  : undefined
                : "A unidade não tem contas a receber no Omie"
            }
          />
        </KpiGrade>
      </Secao>
    </div>
  );
}
