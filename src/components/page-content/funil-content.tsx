import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { FunilGapClientesDialog } from "@/components/funil-gap-clientes-dialog";
import {
  Carregando,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
  type TomKpi,
  type TomStatus,
} from "@/components/planning";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import {
  brlOuTraco,
  ErroDaConsulta,
  mesCorrente,
  mesEmAndamento,
  MolduraReceita,
  pctOuTraco,
  rotuloMes,
  SeletorMes,
  useMesNaUrl,
} from "@/components/receita/moldura";

type FunilRow = {
  mes: string | null;
  unidade: string | null;
  mrr_contratado: number | null;
  contratos_ativos: number | null;
  faturado: number | null;
  faturas_emitidas: number | null;
  recebido: number | null;
  faturas_recebidas: number | null;
  conv_mrr_to_faturado_pct: number | null;
  conv_faturado_to_recebido_pct: number | null;
  conv_mrr_to_recebido_pct: number | null;
};

const CHAVES = "view.funil_receita ou view.auditoria";

const N = (v: number | null | undefined) => Number(v ?? 0);
const NUM = new Intl.NumberFormat("pt-BR");

// Réguas de cor das conversões (inalteradas): MRR→Faturado e MRR→Recebido
// ficam verdes a partir de 90%, laranja de 70% a 90% e vermelhas abaixo;
// Faturado→Recebido só tem verde (≥ 90%) e laranja.
function tomMrrFat(p: number | null): TomStatus {
  if (p === null) return "neutro";
  if (p >= 90) return "sucesso";
  if (p >= 70) return "atencao";
  return "perigo";
}
function tomFatRec(p: number | null): TomStatus {
  if (p === null) return "neutro";
  return p >= 90 ? "sucesso" : "atencao";
}
function tomKpi(t: TomStatus): TomKpi | undefined {
  return t === "neutro" ? undefined : t;
}

function convOuNull(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Percentual de conversão com o tom da régua: ícone e número, nunca cor sozinha (V7). */
function Conversao({ pct, tom }: { pct: number | null; tom: TomStatus }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  return (
    <StatusBadge tom={tom} className="num">
      {pctOuTraco(pct)}
    </StatusBadge>
  );
}

function nextMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthBounds(mes: string): { dataIni: string; dataFim: string } {
  const [y, m] = mes.split("-").map(Number);
  const last = new Date(y, m, 0);
  return {
    dataIni: `${mes}-01`,
    dataFim: `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`,
  };
}

function CellLink({
  to,
  search,
  className,
  children,
}: {
  to: string;
  search: Record<string, string>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      search={search}
      className={cn(
        "rounded-sm underline-offset-2 hover:text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Aba Funil do Funil de Receita (contrato §2): MRR contratado → faturado →
 * recebido, por unidade. O mês padrão é o corrente (as outras telas da área
 * abrem no anterior), e a descrição avisa que ele é parcial.
 */
export function FunilContent({ abas }: { abas?: ReactNode }) {
  const { can, loading: permLoading, scopedToOwnUnit, unidade: userUnidade } = usePermissions();
  const [mes, setMes] = useMesNaUrl(mesCorrente());
  const [unidadesUrl, setUnidadesUrl] = useFiltroNaUrl("unidades", [] as string[]);
  const [gapDialog, setGapDialog] = useState<{ unidade: string; mes: string; gap: number } | null>(
    null,
  );

  const mesIso = `${mes}-01`;
  const pode = can("view.funil_receita") || can("view.auditoria");

  const q = useQuery({
    queryKey: ["v_funil_mensal", mesIso],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_funil_mensal")
        .select("*")
        .gte("mes", mesIso)
        .lt("mes", nextMonth(mesIso))
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as FunilRow[];
    },
    enabled: !permLoading && pode,
  });

  // Sócio regional enxerga só a própria unidade — o recorte vem antes da
  // lista de unidades, para que o seletor também não revele a rede.
  const escopoUnidade = scopedToOwnUnit && !!userUnidade;
  const baseRows = useMemo(
    () =>
      escopoUnidade
        ? (q.data ?? []).filter((r) => unitMatches(userUnidade, r.unidade))
        : (q.data ?? []),
    [q.data, escopoUnidade, userUnidade],
  );

  const allUnidades = useMemo(
    () => Array.from(new Set(baseRows.map((r) => r.unidade ?? "").filter(Boolean))).sort(),
    [baseRows],
  );

  // Sem `?unidades=` na URL vale "todas". Unidade da URL que não existe no mês
  // é ignorada; se nenhuma sobrar, também vale "todas".
  const escolhidas = unidadesUrl.filter((u) => allUnidades.includes(u));
  const todas = escolhidas.length === 0 || escolhidas.length === allUnidades.length;
  const selected = todas ? allUnidades : escolhidas;
  const rows = baseRows.filter((r) => selected.includes(r.unidade ?? ""));

  const alternarUnidade = (u: string, marcar: boolean) => {
    const proxima = marcar
      ? Array.from(new Set([...selected, u]))
      : selected.filter((x) => x !== u);
    // Desmarcar a última volta para "todas": a tabela vazia não responde nada.
    setUnidadesUrl(
      proxima.length === 0 || proxima.length === allUnidades.length ? undefined : proxima.sort(),
    );
  };

  const totals = rows.reduce(
    (a, r) => {
      a.mrr += N(r.mrr_contratado);
      a.contratos += N(r.contratos_ativos);
      a.faturado += N(r.faturado);
      a.faturas += N(r.faturas_emitidas);
      a.recebido += N(r.recebido);
      a.recebidas += N(r.faturas_recebidas);
      return a;
    },
    { mrr: 0, contratos: 0, faturado: 0, faturas: 0, recebido: 0, recebidas: 0 },
  );

  const convMF = totals.mrr > 0 ? (totals.faturado / totals.mrr) * 100 : null;
  const convFR = totals.faturado > 0 ? (totals.recebido / totals.faturado) * 100 : null;
  const convMR = totals.mrr > 0 ? (totals.recebido / totals.mrr) * 100 : null;

  const insights: { tom: "perigo" | "atencao"; unidade: string; texto: string }[] = [];
  for (const r of rows) {
    const unit = r.unidade ?? "—";
    const mrr = N(r.mrr_contratado);
    const fat = N(r.faturado);
    const rec = N(r.recebido);
    const mf = convOuNull(r.conv_mrr_to_faturado_pct);
    const fr = convOuNull(r.conv_faturado_to_recebido_pct);
    if (mrr > 0 && fat === 0) {
      insights.push({
        tom: "perigo",
        unidade: unit,
        texto: `tem MRR de ${brlOuTraco(mrr)} e nenhuma fatura no Omie`,
      });
      continue;
    }
    if (mf !== null && mf < 80) {
      insights.push({
        tom: "atencao",
        unidade: unit,
        texto: `só ${pctOuTraco(mf)} do MRR foi faturado: ${brlOuTraco(mrr - fat)} não cobrado`,
      });
    }
    if (fr !== null && fr < 85) {
      insights.push({
        tom: "atencao",
        unidade: unit,
        texto: `${brlOuTraco(fat - rec)} faturado ainda não recebido`,
      });
    }
  }

  const { dataIni, dataFim } = monthBounds(mes);
  const emAndamento = mesEmAndamento(mes);
  const nomeMes = rotuloMes(mes);
  // O card abre as faturas em Contas a Receber só com UMA unidade no recorte.
  // Com a rede inteira o total do destino não bate: o Funil conta só franquias
  // com contrato ativo e exclui fatura CANCELADA, e Contas a Receber não (N2).
  const recorteDestino: Record<string, string> | null =
    selected.length === 1 ? { unidade: selected[0] } : null;
  const hrefFaturas = (extra: Record<string, string> = {}) =>
    recorteDestino
      ? `/contas-receber?${new URLSearchParams({ ...recorteDestino, dataIni, dataFim, ...extra }).toString()}`
      : undefined;

  const carregando = permLoading || q.isLoading;
  const semDadosNoMes = !carregando && !q.error && baseRows.length === 0;

  const filtros = (
    <>
      <SeletorMes mes={mes} aoMudar={setMes} />
      {!escopoUnidade && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="min-w-[12rem] justify-start"
              disabled={allUnidades.length === 0}
            >
              <span className="text-muted-foreground">Unidades:</span>
              {todas
                ? `Todas (${allUnidades.length})`
                : `${selected.length} de ${allUnidades.length}`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="mb-2 flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => setUnidadesUrl(undefined)}>
                Todas
              </Button>
            </div>
            <div className="max-h-64 space-y-1 overflow-auto">
              {allUnidades.map((u) => (
                <label
                  key={u}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted"
                >
                  <Checkbox
                    checked={todas || selected.includes(u)}
                    onCheckedChange={(c) => {
                      // Com "todas" tudo está marcado: desmarcar uma tira só ela.
                      if (todas) {
                        if (!c) setUnidadesUrl(allUnidades.filter((x) => x !== u));
                      } else alternarUnidade(u, Boolean(c));
                    }}
                  />
                  <span className="text-sm">{u}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {!todas && (
        <span className="num text-[13px] text-muted-foreground">
          {selected.length} de {allUnidades.length} unidades
        </span>
      )}
    </>
  );

  return (
    <MolduraReceita
      titulo="Funil de Receita"
      pergunta="Onde o MRR contratado deixa de virar faturado e recebido?"
      descricao={
        <>
          {escopoUnidade
            ? userUnidade
            : `${NUM.format(selected.length)} ${selected.length === 1 ? "unidade" : "unidades"}`}{" "}
          · {nomeMes}
          {emAndamento && " (mês corrente, parcial)"} · MRR dos contratos ativos hoje (foto de hoje,
          não do mês); faturado e recebido pelas notas do Omie com <strong>competência</strong> no
          mês, bruto de nota.
        </>
      }
      procedencia={{
        fonte: "v_funil_mensal · contratos e títulos do Omie",
        regua: "competência",
      }}
      filtros={filtros}
    >
      <div className="space-y-6 p-4 md:p-6">
        {abas}

        {!permLoading && !pode ? (
          <EstadoSemAcesso oQueFalta={CHAVES} />
        ) : q.error ? (
          <ErroDaConsulta erro={q.error} chaves={CHAVES} tentarNovamente={() => void q.refetch()} />
        ) : carregando ? (
          <>
            <Carregando variante="kpis" />
            <Carregando variante="tabela" />
          </>
        ) : semDadosNoMes ? (
          <EstadoVazio
            titulo={`Sem funil para ${nomeMes}`}
            descricao="Nenhuma unidade tem contrato ativo ou fatura neste mês."
          />
        ) : (
          <>
            {/* O aviso de cobertura parcial saiu daqui em 22/09, junto com o selo dos cards do
                Aquário: lacuna de fonte é assunto de auditoria, e auditoria mora numa tela só. */}
            <KpiGrade colunas={4}>
              <KpiCard
                rotulo="MRR contratado"
                valor={brlOuTraco(totals.mrr)}
                nota={`${NUM.format(totals.contratos)} contratos ativos`}
                procedencia={{ fonte: "contratos" }}
              />
              <KpiCard
                rotulo="Faturado"
                valor={brlOuTraco(totals.faturado)}
                nota={`${NUM.format(totals.faturas)} faturas emitidas · ${pctOuTraco(convMF)} do MRR`}
                tom={tomKpi(tomMrrFat(convMF))}
                procedencia={{ fonte: "Omie" }}
                abrir={hrefFaturas() ? { href: hrefFaturas(), rotulo: "Abrir faturas" } : undefined}
              />
              <KpiCard
                rotulo="Recebido"
                valor={brlOuTraco(totals.recebido)}
                nota={`${NUM.format(totals.recebidas)} faturas recebidas · ${pctOuTraco(convFR)} do faturado`}
                tom={tomKpi(tomFatRec(convFR))}
                procedencia={{ fonte: "Omie" }}
                abrir={
                  hrefFaturas({ status: "RECEBIDO" })
                    ? { href: hrefFaturas({ status: "RECEBIDO" }), rotulo: "Abrir faturas" }
                    : undefined
                }
              />
              <KpiCard
                rotulo="Conversão total"
                valor={pctOuTraco(convMR)}
                estado={convMR === null ? "nao-apurado" : "ok"}
                nota={
                  convMR === null ? "sem MRR contratado no recorte" : "recebido ÷ MRR contratado"
                }
                tom={tomKpi(tomMrrFat(convMR))}
              />
            </KpiGrade>

            <Secao
              titulo={`Em que unidade o MRR não virou faturado ou recebido em ${nomeMes}?`}
              descricao="Clique no valor para abrir os registros: MRR na Base de clientes, faturado e recebido em Contas a Receber; o gap de faturamento abre os contratos sem fatura."
            >
              <div className="overflow-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unidade</TableHead>
                      <TableHead className="text-right">MRR contratado</TableHead>
                      <TableHead className="text-right">Faturado</TableHead>
                      <TableHead className="text-right">Gap faturamento</TableHead>
                      <TableHead className="text-right">Recebido</TableHead>
                      <TableHead className="text-right">Gap cobrança</TableHead>
                      <TableHead className="text-right">MRR→Fat</TableHead>
                      <TableHead className="text-right">Fat→Rec</TableHead>
                      <TableHead className="text-right">MRR→Rec</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const mrr = N(r.mrr_contratado),
                        fat = N(r.faturado),
                        rec = N(r.recebido);
                      const gapF = mrr - fat;
                      const gapC = fat - rec;
                      const mf = convOuNull(r.conv_mrr_to_faturado_pct);
                      const fr = convOuNull(r.conv_faturado_to_recebido_pct);
                      const mr = convOuNull(r.conv_mrr_to_recebido_pct);
                      const semDados = mrr > 0 && fat === 0;
                      const unidadeStr = r.unidade ?? "";
                      return (
                        <TableRow key={r.unidade}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{r.unidade}</span>
                              {semDados && (
                                <StatusBadge tom="neutro">Sem faturas no Omie</StatusBadge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="num text-right">
                            <CellLink to="/clientes" search={{ unidade: unidadeStr }}>
                              {brlOuTraco(r.mrr_contratado)}
                            </CellLink>
                          </TableCell>
                          <TableCell className="num text-right">
                            <CellLink
                              to="/contas-receber"
                              search={{ unidade: unidadeStr, dataIni, dataFim }}
                            >
                              {brlOuTraco(r.faturado)}
                            </CellLink>
                          </TableCell>
                          <TableCell
                            className={cn("num text-right", gapF > 0 && "font-medium text-danger")}
                          >
                            {Math.abs(gapF) < 0.01 ? (
                              brlOuTraco(gapF)
                            ) : gapF > 0 ? (
                              <button
                                type="button"
                                className="rounded-sm underline-offset-2 hover:text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() =>
                                  setGapDialog({ unidade: unidadeStr, mes, gap: gapF })
                                }
                              >
                                {brlOuTraco(gapF)}
                              </button>
                            ) : (
                              <CellLink
                                to="/contas-receber"
                                search={{ unidade: unidadeStr, dataIni, dataFim }}
                              >
                                {brlOuTraco(gapF)}
                              </CellLink>
                            )}
                          </TableCell>
                          <TableCell className="num text-right">
                            <CellLink
                              to="/contas-receber"
                              search={{ unidade: unidadeStr, status: "RECEBIDO", dataIni, dataFim }}
                            >
                              {brlOuTraco(r.recebido)}
                            </CellLink>
                          </TableCell>
                          <TableCell
                            className={cn("num text-right", gapC > 0 && "font-medium text-warning")}
                          >
                            <CellLink
                              to="/contas-receber"
                              search={{
                                unidade: unidadeStr,
                                status: "NAO_RECEBIDO",
                                dataIni,
                                dataFim,
                              }}
                            >
                              {brlOuTraco(gapC)}
                            </CellLink>
                          </TableCell>
                          <TableCell className="text-right">
                            <Conversao pct={mf} tom={tomMrrFat(mf)} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Conversao pct={fr} tom={tomFatRec(fr)} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Conversao pct={mr} tom={tomMrrFat(mr)} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="num text-right font-semibold">
                        {brlOuTraco(totals.mrr)}
                      </TableCell>
                      <TableCell className="num text-right font-semibold">
                        {brlOuTraco(totals.faturado)}
                      </TableCell>
                      <TableCell className="num text-right font-semibold">
                        {brlOuTraco(totals.mrr - totals.faturado)}
                      </TableCell>
                      <TableCell className="num text-right font-semibold">
                        {brlOuTraco(totals.recebido)}
                      </TableCell>
                      <TableCell className="num text-right font-semibold">
                        {brlOuTraco(totals.faturado - totals.recebido)}
                      </TableCell>
                      <TableCell className="num text-right font-semibold">
                        {pctOuTraco(convMF)}
                      </TableCell>
                      <TableCell className="num text-right font-semibold">
                        {pctOuTraco(convFR)}
                      </TableCell>
                      <TableCell className="num text-right font-semibold">
                        {pctOuTraco(convMR)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </Secao>

            <Secao
              titulo="O que pede atenção no recorte?"
              descricao="Unidade com MRR e nenhuma fatura; menos de 80% do MRR faturado; menos de 85% do faturado recebido."
            >
              {insights.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm">
                  <CircleCheck className="size-4 text-success" aria-hidden />
                  Nenhum alerta para o filtro atual.
                </div>
              ) : (
                <ul className="divide-y rounded-xl border bg-card">
                  {insights.map((it, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                      <StatusBadge tom={it.tom}>
                        {it.tom === "perigo" ? "Sem fatura" : "Atenção"}
                      </StatusBadge>
                      <span>
                        <span className="font-medium">{it.unidade}</span>: {it.texto}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          </>
        )}
      </div>

      {gapDialog && (
        <FunilGapClientesDialog
          unidade={gapDialog.unidade}
          mes={gapDialog.mes}
          gap={gapDialog.gap}
          open={!!gapDialog}
          onOpenChange={(o) => {
            if (!o) setGapDialog(null);
          }}
        />
      )}
    </MolduraReceita>
  );
}
