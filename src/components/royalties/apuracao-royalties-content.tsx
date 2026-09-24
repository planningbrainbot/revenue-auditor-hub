import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRoyaltiesUnidades } from "@/hooks/use-royalties";
import { usePermissions } from "@/hooks/use-permissions";
import { EmitirFaturasDialog } from "@/components/royalties/emitir-faturas-dialog";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listarFaturasRoyalties, type FaturaDoMes } from "@/lib/royalties-faturamento.functions";
import {
  Carregando,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import {
  brlOuTraco,
  ErroDaConsulta,
  mesEmAndamento,
  rotuloDia,
  rotuloMes,
} from "@/components/receita/moldura";

/**
 * Lista do mês da Apuração de Royalties (contrato
 * `docs/design/contratos/receita-e-repasses.md` §5). O mês vem da rota (URL,
 * `?mes=`), para o "Resolver" da Visão geral cair no mesmo mês e o total bater.
 */

const STATUS_APURACAO: Record<string, { label: string; tom: TomStatus }> = {
  rascunho: { label: "Rascunho", tom: "info" },
  em_revisao: { label: "Em revisão", tom: "atencao" },
  confirmado: { label: "Confirmado", tom: "sucesso" },
  faturado: { label: "Faturado", tom: "sucesso" },
};

function CelulaFatura({ f }: { f: FaturaDoMes | undefined }) {
  if (!f) return <StatusBadge tom="neutro">Não emitida</StatusBadge>;
  if (f.status === "erro")
    return (
      <span title={f.erro ?? undefined}>
        <StatusBadge tom="perigo">Erro na emissão</StatusBadge>
      </span>
    );
  if (f.status === "ja_existia") return <StatusBadge tom="neutro">Emitida à mão</StatusBadge>;
  if (f.status === "criada") return <StatusBadge tom="atencao">OS {f.num_os} sem boleto</StatusBadge>;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <StatusBadge tom="sucesso">OS {f.num_os}</StatusBadge>
      <span className="num text-xs text-muted-foreground">
        {brlOuTraco(f.valor_total)} · emitida {rotuloDia(f.faturada_em) ?? "—"}
      </span>
    </div>
  );
}

function CelulaRecebimento({ f }: { f: FaturaDoMes | undefined }) {
  if (!f || f.status === "erro") return <span className="text-xs text-muted-foreground">—</span>;
  const r = f.recebimento;
  if (!r)
    return (
      <span className="text-xs text-muted-foreground" title="O título ainda não chegou do Omie">
        Aguardando sync
      </span>
    );
  switch (r.status) {
    case "RECEBIDO":
      return <StatusBadge tom="sucesso">Recebido {rotuloDia(r.pago_em) ?? ""}</StatusBadge>;
    case "ATRASADO":
      return (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge tom="perigo">Atrasado</StatusBadge>
          <span className="text-xs text-muted-foreground">
            venceu {rotuloDia(r.vencimento) ?? "—"}
          </span>
        </div>
      );
    case "CANCELADO":
      return <StatusBadge tom="neutro">Título cancelado</StatusBadge>;
    default:
      return (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge tom="atencao">A vencer</StatusBadge>
          <span className="text-xs text-muted-foreground">
            vence {rotuloDia(r.vencimento) ?? "—"}
          </span>
        </div>
      );
  }
}

/** Botão "Emitir faturas" com o motivo quando não há o que emitir (N8). */
export function motivoSemEmissao(
  mes: string,
  carregando: boolean,
  rows: { apuracao?: { status?: string | null } | null }[],
): string | undefined {
  if (mesEmAndamento(mes))
    return "O mês ainda não terminou: fatura só sai depois do fim do mês, porque ainda entram recebimentos.";
  if (carregando) return "Carregando as apurações do mês.";
  const fechadas = rows.filter(
    (u) => u.apuracao?.status === "confirmado" || u.apuracao?.status === "faturado",
  ).length;
  if (fechadas === 0)
    return "Nenhuma apuração fechada neste mês: feche a apuração de ao menos uma unidade.";
  return undefined;
}

export function ApuracaoRoyaltiesContent({ mes }: { mes: string }) {
  const { isAdmin, loading } = usePermissions();
  const { data, isLoading, error, refetch } = useRoyaltiesUnidades(mes);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const listarFaturas = useServerFn(listarFaturasRoyalties);
  const emAndamento = mesEmAndamento(mes);
  const {
    data: faturasData,
    error: erroFaturas,
    isLoading: carregandoFaturas,
  } = useQuery({
    queryKey: ["royalties", "faturas", mes],
    queryFn: () => listarFaturas({ data: { competencia: mes } }),
    enabled: !emAndamento,
    staleTime: 30_000,
  });
  const faturaPorUnidade = useMemo(
    () => new Map((faturasData?.faturas ?? []).map((f) => [f.unidade_id, f])),
    [faturasData],
  );

  const totais = useMemo(
    () =>
      rows.reduce(
        (acc, u) => {
          const ap = u.apuracao;
          if (!ap) return acc;
          acc.royalties += Number(ap.royalties_valor ?? 0);
          acc.csc += Number((ap.csc_valor_fixo ?? ap.csc_base_antiga_valor ?? 0) as number);
          acc.cac += Number(ap.cac_valor ?? 0);
          acc.midia += Number(ap.csc_trafego_pago ?? 0);
          acc.outras += Number(ap.outras_receitas ?? 0);
          acc.totalFatura += Number(ap.total_fatura ?? 0);
          acc.comApuracao += 1;
          return acc;
        },
        { royalties: 0, csc: 0, cac: 0, midia: 0, outras: 0, totalFatura: 0, comApuracao: 0 },
      ),
    [rows],
  );

  if (loading) return <Carregando variante="pagina" className="px-4 py-6 md:px-6" />;
  if (!isAdmin)
    return (
      <div className="px-4 py-6 md:px-6">
        <EstadoSemAcesso oQueFalta="admin (a apuração de royalties é da matriz)" />
      </div>
    );

  const motivoEmitir = motivoSemEmissao(mes, isLoading, rows);
  // Sem apuração no mês os totais não são zero, são ausência (N4).
  const estadoTotais = totais.comApuracao === 0 ? "nao-apurado" : emAndamento ? "parcial" : "ok";
  const notaTotais =
    totais.comApuracao === 0
      ? "nenhuma unidade com apuração neste mês"
      : `${totais.comApuracao} de ${rows.length} unidades com apuração`;

  return (
    <div className="space-y-6 px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {emAndamento
            ? "Mês em andamento: a apuração só fecha depois que o mês termina, e a fatura só sai depois do fechamento."
            : "Feche a apuração de cada unidade e emita as faturas do mês no Omie."}
        </p>
        <EmitirFaturasDialog competencia={mes} motivoIndisponivel={motivoEmitir} />
      </div>

      {error ? (
        <ErroDaConsulta
          erro={error}
          chaves="admin"
          titulo="Não foi possível carregar as apurações do mês"
          tentarNovamente={() => void refetch()}
        />
      ) : isLoading ? (
        <Carregando variante="kpis" />
      ) : (
        <Secao
          titulo={`Quanto a rede repassa em ${rotuloMes(mes).toLowerCase()}?`}
          descricao="Soma das apurações abertas e fechadas do mês; unidade sem apuração não entra."
        >
          <KpiGrade>
            <KpiCard rotulo="Royalties" valor={brlOuTraco(totais.royalties)} estado={estadoTotais} nota={notaTotais} />
            <KpiCard
              rotulo="CSC (fixo ou base antiga)"
              valor={brlOuTraco(totais.csc)}
              estado={estadoTotais}
              nota="por unidade: o fixo; sem fixo, o % da base antiga"
            />
            <KpiCard rotulo="CAC" valor={brlOuTraco(totais.cac)} estado={estadoTotais} />
            <KpiCard rotulo="Mídia (tráfego pago)" valor={brlOuTraco(totais.midia)} estado={estadoTotais} />
            <KpiCard rotulo="Outras receitas" valor={brlOuTraco(totais.outras)} estado={estadoTotais} />
            <KpiCard rotulo="Total fatura" valor={brlOuTraco(totais.totalFatura)} estado={estadoTotais} />
          </KpiGrade>
        </Secao>
      )}

      {!error && (
        <Secao
          titulo="Qual unidade ainda não fechou, faturou ou recebeu?"
          descricao={
            emAndamento
              ? "Fatura e recebimento só aparecem em mês encerrado."
              : erroFaturas
                ? undefined
                : "Fatura e recebimento vêm do Omie da Planning Partners."
          }
        >
          {erroFaturas && !emAndamento && (
            <ErroDaConsulta
              erro={erroFaturas}
              titulo="Não foi possível ler as faturas no Omie; as colunas de fatura e recebimento ficam sem dado"
            />
          )}
          {isLoading ? (
            <Carregando variante="tabela" />
          ) : rows.length === 0 ? (
            <EstadoVazio titulo="Nenhuma unidade para apurar neste mês" />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              {/* Cabeçalho fixo: a rolagem acontece dentro deste container, não na
                  página, senão o `overflow-auto` do wrapper padrão do Table anula o
                  sticky. Mesmo padrão de contas-receber-view. */}
              <div className="relative max-h-[calc(100vh-320px)] overflow-auto">
                <table className="w-full caption-bottom border-separate border-spacing-0 text-sm [&_tbody_td]:border-b">
                  <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
                    <TableRow>
                      <TableHead className="bg-card">Unidade</TableHead>
                      <TableHead className="bg-card">Modelo</TableHead>
                      <TableHead className="bg-card">Apuração</TableHead>
                      <TableHead className="bg-card text-right">Royalties</TableHead>
                      <TableHead className="bg-card text-right">CSC (fixo ou base antiga)</TableHead>
                      <TableHead className="bg-card text-right">CAC</TableHead>
                      <TableHead className="bg-card text-right">Mídia (tráfego pago)</TableHead>
                      <TableHead className="bg-card text-right">Outras</TableHead>
                      <TableHead className="bg-card text-right">Total fatura</TableHead>
                      <TableHead className="bg-card">Fatura no Omie</TableHead>
                      <TableHead className="bg-card">Recebimento</TableHead>
                      <TableHead className="bg-card text-right">
                        <span className="sr-only">Próxima ação</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((u) => {
                      const ap = u.apuracao;
                      const st = ap?.status ? STATUS_APURACAO[ap.status] : undefined;
                      const cscModel =
                        u.csc_percentual_base_antiga != null
                          ? `${u.csc_percentual_base_antiga}% base antiga`
                          : u.csc_valor_fixo != null
                            ? `CSC fixo ${brlOuTraco(u.csc_valor_fixo)}`
                            : "sem CSC cadastrado";
                      const fatura = faturaPorUnidade.get(u.id);
                      const fechada = ap?.status === "confirmado" || ap?.status === "faturado";
                      return (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">{u.nome_da_praca}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            Royalties {u.royalties_percentual != null ? `${u.royalties_percentual}%` : "—"} •{" "}
                            {cscModel}
                          </TableCell>
                          <TableCell>
                            {st ? (
                              <StatusBadge tom={st.tom}>{st.label}</StatusBadge>
                            ) : ap ? (
                              <StatusBadge tom="neutro">{ap.status}</StatusBadge>
                            ) : (
                              <StatusBadge tom="neutro">Não iniciada</StatusBadge>
                            )}
                          </TableCell>
                          <TableCell className="num text-right">
                            {ap ? brlOuTraco(Number(ap.royalties_valor ?? 0)) : "—"}
                          </TableCell>
                          <TableCell className="num text-right">
                            {ap
                              ? brlOuTraco(Number((ap.csc_valor_fixo ?? ap.csc_base_antiga_valor ?? 0) as number))
                              : "—"}
                          </TableCell>
                          <TableCell className="num text-right">
                            {ap ? brlOuTraco(Number(ap.cac_valor ?? 0)) : "—"}
                          </TableCell>
                          <TableCell className="num text-right">
                            {ap ? brlOuTraco(Number(ap.csc_trafego_pago ?? 0)) : "—"}
                          </TableCell>
                          <TableCell className="num text-right">
                            {ap ? brlOuTraco(Number(ap.outras_receitas ?? 0)) : "—"}
                          </TableCell>
                          <TableCell className="num text-right font-semibold">
                            {ap ? brlOuTraco(Number(ap.total_fatura ?? 0)) : "—"}
                          </TableCell>
                          <TableCell>
                            {emAndamento ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : carregandoFaturas ? (
                              <span className="text-xs text-muted-foreground">…</span>
                            ) : erroFaturas ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <CelulaFatura f={fatura} />
                            )}
                          </TableCell>
                          <TableCell>
                            {emAndamento || carregandoFaturas || erroFaturas ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <CelulaRecebimento f={fatura} />
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" asChild>
                              <Link
                                to="/royalties/$unidadeId/$mes"
                                params={{ unidadeId: String(u.id), mes }}
                              >
                                {fechada ? "Ver apuração" : ap ? "Continuar" : "Iniciar apuração"}
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
              </div>
            </div>
          )}
        </Secao>
      )}
    </div>
  );
}
