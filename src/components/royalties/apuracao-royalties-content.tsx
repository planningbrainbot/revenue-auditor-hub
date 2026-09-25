import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRoyaltiesUnidades } from "@/hooks/use-royalties";
import { usePermissions } from "@/hooks/use-permissions";
import { EmitirFaturasDialog } from "@/components/royalties/emitir-faturas-dialog";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listarFaturasRoyalties, type FaturaDoMes } from "@/lib/royalties-faturamento.functions";
import {
  BarraFiltros,
  Carregando,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { BotaoComMotivo } from "@/components/royalties/botao-com-motivo";
import {
  brlOuTraco,
  ErroDaConsulta,
  mesCorrente,
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

/**
 * Filtros da tabela, na URL (N7). Cada opção corresponde a um selo que a
 * célula mostra, para o filtro nunca separar o que a tela junta.
 */
export const CHAVES_FILTRO_APURACAO = ["busca", "apuracao", "fatura", "recebimento"] as const;
const TODOS = "todos";

const OPCOES_APURACAO: Record<string, string> = {
  nao_iniciada: "Não iniciada",
  rascunho: "Rascunho",
  em_revisao: "Em revisão",
  confirmado: "Confirmado",
  faturado: "Faturado",
};

const OPCOES_FATURA: Record<string, string> = {
  nao_emitida: "Não emitida",
  emitida: "Emitida",
  sem_boleto: "OS sem boleto",
  erro: "Erro na emissão",
};

const OPCOES_RECEBIMENTO: Record<string, string> = {
  recebido: "Recebido",
  a_vencer: "A vencer",
  atrasado: "Atrasado",
  aguardando_sync: "Aguardando sync",
  cancelado: "Título cancelado",
  sem_fatura: "Sem fatura",
};

function estadoFatura(f: FaturaDoMes | undefined): string {
  if (!f) return "nao_emitida";
  if (f.status === "erro") return "erro";
  if (f.status === "criada") return "sem_boleto";
  return "emitida"; // faturada ou emitida à mão (ja_existia)
}

function estadoRecebimento(f: FaturaDoMes | undefined): string {
  if (!f || f.status === "erro") return "sem_fatura";
  const r = f.recebimento;
  if (!r) return "aguardando_sync";
  switch (r.status) {
    case "RECEBIDO":
      return "recebido";
    case "ATRASADO":
      return "atrasado";
    case "CANCELADO":
      return "cancelado";
    default:
      return "a_vencer";
  }
}

/** Sem acento e minúsculo: "maceio" acha "Maceió". */
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function SeletorFiltro({
  rotulo,
  todos,
  opcoes,
  valor,
  aoMudar,
  motivoIndisponivel,
}: {
  rotulo: string;
  todos: string;
  opcoes: Record<string, string>;
  valor: string;
  aoMudar: (v: string) => void;
  motivoIndisponivel?: string;
}) {
  return (
    <span title={motivoIndisponivel}>
      <Select
        value={valor || TODOS}
        onValueChange={(v) => aoMudar(v === TODOS ? "" : v)}
        disabled={!!motivoIndisponivel}
      >
        <SelectTrigger className="h-8 w-44" aria-label={rotulo}>
          <SelectValue placeholder={rotulo} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>{todos}</SelectItem>
          {Object.entries(opcoes).map(([v, label]) => (
            <SelectItem key={v} value={v}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}

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

/**
 * A fatura que vale para a unidade no mês, com a MESMA regra na lista e na
 * ficha: a mais recente que não deu erro; só sem nenhuma dessas, a mais
 * recente com erro. Antes a lista pegava a última do array e a ficha a
 * primeira, e as duas podiam discordar.
 */
export function faturaDaUnidade(
  faturas: FaturaDoMes[] | undefined,
  unidadeId: number,
): FaturaDoMes | undefined {
  const daUnidade = (faturas ?? []).filter((f) => f.unidade_id === unidadeId);
  const quando = (f: FaturaDoMes) => f.faturada_em ?? f.vence_em ?? "";
  const maisRecente = (lista: FaturaDoMes[]) =>
    lista.reduce<FaturaDoMes | undefined>((m, f) => (!m || quando(f) > quando(m) ? f : m), undefined);
  return maisRecente(daUnidade.filter((f) => f.status !== "erro")) ?? maisRecente(daUnidade);
}

/** Botão "Emitir faturas" com o motivo quando não há o que emitir (N8). */
export function motivoSemEmissao(
  mes: string,
  carregando: boolean,
  rows: { apuracao?: { status?: string | null } | null }[],
  erro?: unknown,
): string | undefined {
  if (mesEmAndamento(mes))
    return "O mês ainda não terminou: fatura só sai depois do fim do mês, porque ainda entram recebimentos.";
  if (erro)
    return "Não foi possível carregar as apurações do mês; sem elas não dá para saber o que emitir.";
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
  const faturaPorUnidade = useMemo(() => {
    const faturas = faturasData?.faturas ?? [];
    const ids = new Set(faturas.map((f) => f.unidade_id));
    return new Map([...ids].map((id) => [id, faturaDaUnidade(faturas, id)]));
  }, [faturasData]);

  const [busca, setBusca] = useFiltroNaUrl("busca", "");
  const [filtroApuracao, setFiltroApuracao] = useFiltroNaUrl("apuracao", "");
  const [filtroFatura, setFiltroFatura] = useFiltroNaUrl("fatura", "");
  const [filtroRecebimento, setFiltroRecebimento] = useFiltroNaUrl("recebimento", "");
  const limparFiltros = useLimparFiltrosNaUrl([...CHAVES_FILTRO_APURACAO]);
  const filtroAtivo = !!busca || !!filtroApuracao || !!filtroFatura || !!filtroRecebimento;

  // Sem dado de fatura (mês em andamento, carregando ou erro do Omie) os dois
  // filtros do Omie ficam travados e não se aplicam: filtrar por ausência de
  // dado esconderia todas as linhas sem explicar por quê.
  const motivoSemFatura = emAndamento
    ? "Fatura e recebimento só aparecem em mês encerrado."
    : carregandoFaturas
      ? "Carregando as faturas do Omie."
      : erroFaturas
        ? "Não foi possível ler as faturas no Omie."
        : undefined;

  const filtradas = useMemo(() => {
    const termo = normalizar(busca.trim());
    return rows.filter((u) => {
      if (termo && !normalizar(u.nome_da_praca ?? "").includes(termo)) return false;
      if (filtroApuracao && (u.apuracao?.status ?? "nao_iniciada") !== filtroApuracao) return false;
      if (motivoSemFatura) return true;
      const f = faturaPorUnidade.get(u.id);
      if (filtroFatura && estadoFatura(f) !== filtroFatura) return false;
      if (filtroRecebimento && estadoRecebimento(f) !== filtroRecebimento) return false;
      return true;
    });
  }, [
    rows,
    busca,
    filtroApuracao,
    filtroFatura,
    filtroRecebimento,
    motivoSemFatura,
    faturaPorUnidade,
  ]);

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

  const motivoEmitir = motivoSemEmissao(mes, isLoading, rows, error);
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
            ? "Mês em andamento: fechar antes do fim do mês é possível; recebimentos posteriores ficam fora. A fatura só sai depois do fim do mês."
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
          {!isLoading && rows.length > 0 && (
            <BarraFiltros aoLimpar={filtroAtivo ? limparFiltros : undefined} className="mb-3">
              <div className="relative">
                <Search
                  className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  aria-label="Buscar unidade"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Unidade"
                  className="h-8 w-44 pl-8"
                />
              </div>
              <SeletorFiltro
                rotulo="Apuração"
                todos="Toda apuração"
                opcoes={OPCOES_APURACAO}
                valor={filtroApuracao}
                aoMudar={setFiltroApuracao}
              />
              <SeletorFiltro
                rotulo="Fatura no Omie"
                todos="Toda fatura"
                opcoes={OPCOES_FATURA}
                valor={filtroFatura}
                aoMudar={setFiltroFatura}
                motivoIndisponivel={motivoSemFatura}
              />
              <SeletorFiltro
                rotulo="Recebimento"
                todos="Todo recebimento"
                opcoes={OPCOES_RECEBIMENTO}
                valor={filtroRecebimento}
                aoMudar={setFiltroRecebimento}
                motivoIndisponivel={motivoSemFatura}
              />
              <span className="num text-[13px] text-muted-foreground">
                {filtradas.length} de {rows.length} unidades
              </span>
            </BarraFiltros>
          )}
          {isLoading ? (
            <Carregando variante="tabela" />
          ) : rows.length === 0 ? (
            <EstadoVazio titulo="Nenhuma unidade para apurar neste mês" />
          ) : filtradas.length === 0 ? (
            <EstadoVazio titulo="Nenhuma unidade com esses filtros" />
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
                    {filtradas.map((u) => {
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
                            {/* Mês futuro colado na URL: abrir a ficha criaria a
                                apuração no banco antes de o mês existir. */}
                            {!ap && mes > mesCorrente() ? (
                              <BotaoComMotivo
                                rotulo="Iniciar apuração"
                                motivo="Mês futuro: a apuração ainda não pode começar."
                                variant="outline"
                                size="sm"
                              />
                            ) : (
                            <Button size="sm" variant="outline" asChild>
                              <Link
                                to="/royalties/$unidadeId/$mes"
                                params={{ unidadeId: String(u.id), mes }}
                              >
                                {fechada ? "Ver apuração" : ap ? "Continuar" : "Iniciar apuração"}
                              </Link>
                            </Button>
                            )}
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
