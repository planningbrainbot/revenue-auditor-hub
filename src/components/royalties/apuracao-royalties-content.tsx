import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Coins, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRoyaltiesUnidades } from "@/hooks/use-royalties";
import { brl } from "@/components/audit/format";
import { usePermissions } from "@/hooks/use-permissions";
import { EmitirFaturasDialog } from "@/components/royalties/emitir-faturas-dialog";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listarFaturasRoyalties, type FaturaDoMes } from "@/lib/royalties-faturamento.functions";

function defaultMes(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMes(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isMesEmAndamento(mes: string): boolean {
  const d = new Date();
  const atual = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return mes >= atual;
}

function formatMesLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  rascunho: {
    label: "Rascunho",
    cls: "bg-muted text-foreground",
  },
  em_revisao: {
    label: "Em revisão",
    cls: "bg-warning-soft text-warning",
  },
  confirmado: {
    label: "Confirmado",
    cls: "bg-success-soft text-success",
  },
  faturado: {
    label: "Faturado",
    cls: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200",
  },
};

const TOM = {
  ok: "bg-success-soft text-success",
  aviso: "bg-warning-soft text-warning",
  ruim: "bg-danger-soft text-danger",
  neutro: "bg-muted text-foreground",
};

function dataCurta(iso: string | null | undefined): string {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

function CelulaFatura({ f }: { f: FaturaDoMes | undefined }) {
  if (!f) return <span className="text-xs text-muted-foreground">Não emitida</span>;
  if (f.status === "erro")
    return (
      <Badge className={TOM.ruim} title={f.erro ?? undefined}>
        Erro na emissão
      </Badge>
    );
  if (f.status === "ja_existia") return <Badge className={TOM.neutro}>Emitida à mão</Badge>;
  if (f.status === "criada") return <Badge className={TOM.aviso}>OS {f.num_os} sem boleto</Badge>;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Badge className={TOM.ok}>OS {f.num_os}</Badge>
      <span className="text-xs text-muted-foreground">
        {brl(f.valor_total)} · emitida {dataCurta(f.faturada_em)}
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
  const vence = `vence ${dataCurta(r.vencimento)}`;
  switch (r.status) {
    case "RECEBIDO":
      return <Badge className={TOM.ok}>Recebido {dataCurta(r.pago_em)}</Badge>;
    case "ATRASADO":
      return (
        <div className="flex flex-col items-start gap-0.5">
          <Badge className={TOM.ruim}>Atrasado</Badge>
          <span className="text-xs text-muted-foreground">
            venceu {dataCurta(r.vencimento)}
          </span>
        </div>
      );
    case "CANCELADO":
      return <Badge className={TOM.neutro}>Título cancelado</Badge>;
    default:
      return (
        <div className="flex flex-col items-start gap-0.5">
          <Badge className={TOM.aviso}>A vencer</Badge>
          <span className="text-xs text-muted-foreground">{vence}</span>
        </div>
      );
  }
}

export function ApuracaoRoyaltiesContent() {
  const { isAdmin, loading } = usePermissions();
  const [mes, setMes] = useState(defaultMes());
  const { data, isLoading } = useRoyaltiesUnidades(mes);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const listarFaturas = useServerFn(listarFaturasRoyalties);
  const { data: faturasData } = useQuery({
    queryKey: ["royalties", "faturas", mes],
    queryFn: () => listarFaturas({ data: { competencia: mes } }),
    enabled: !isMesEmAndamento(mes),
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

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (!isAdmin)
    return (
      <div className="p-6 text-sm text-muted-foreground">Acesso restrito a usuários admin.</div>
    );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Coins className="h-6 w-6 text-primary" />
          <div>
            {/* Sem <h1> aqui: o nome da página vem do AppShell desde que a aba
                virou rota própria, e dois títulos iguais empilhados só ocupavam
                a primeira dobra. */}
            <p className="text-sm text-muted-foreground">
              Gere a base de cobrança mensal de cada unidade.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Fatura é dinheiro saindo para a unidade: só aparece em mês fechado,
              porque mês em andamento ainda vai receber recebimento. */}
          {!isMesEmAndamento(mes) && <EmitirFaturasDialog competencia={mes} />}
          <Button variant="outline" size="icon" onClick={() => setMes(shiftMes(mes, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[160px] rounded-md border bg-card px-3 py-1.5 text-center text-sm font-medium capitalize">
            {formatMesLabel(mes)}
          </div>
          <Button variant="outline" size="icon" onClick={() => setMes(shiftMes(mes, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isMesEmAndamento(mes) && (
        <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
          Mês em andamento — a apuração só fecha depois que o mês termina. Use as setas para voltar
          ao mês anterior.
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <Card className="p-4 bg-primary/5 border-primary/20">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Total da rede</div>
            <div className="text-xs text-muted-foreground">
              {totais.comApuracao} de {rows.length} unidades com apuração
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
            <div>
              <div className="text-xs text-muted-foreground">Royalties</div>
              <div className="font-medium">{brl(totais.royalties)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">CSC</div>
              <div className="font-medium">{brl(totais.csc)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">CAC</div>
              <div className="font-medium">{brl(totais.cac)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Mídia</div>
              <div className="font-medium">{brl(totais.midia)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Outras receitas</div>
              <div className="font-medium">{brl(totais.outras)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total fatura</div>
              <div className="text-base font-semibold">{brl(totais.totalFatura)}</div>
            </div>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando unidades…</div>
      ) : (
        <Card className="overflow-hidden">
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
                  <TableHead className="bg-card text-right">CSC</TableHead>
                  <TableHead className="bg-card text-right">CAC</TableHead>
                  <TableHead className="bg-card text-right">Mídia</TableHead>
                  <TableHead className="bg-card text-right">Outras</TableHead>
                  <TableHead className="bg-card text-right">Total fatura</TableHead>
                  <TableHead className="bg-card">Fatura no Omie</TableHead>
                  <TableHead className="bg-card">Recebimento</TableHead>
                  <TableHead className="bg-card text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => {
                  const ap = u.apuracao;
                  const statusKey = ap?.status ?? "nao_iniciada";
                  const badge = STATUS_BADGE[statusKey];
                  const cscModel =
                    u.csc_percentual_base_antiga != null
                      ? `${u.csc_percentual_base_antiga}% base antiga`
                      : `CSC fixo ${brl(u.csc_valor_fixo ?? 0)}`;
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.nome_da_praca}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        Royalties {u.royalties_percentual ?? 0}% • {cscModel}
                      </TableCell>
                      <TableCell>
                        {badge ? (
                          <Badge className={badge.cls}>{badge.label}</Badge>
                        ) : (
                          <Badge variant="outline">Não iniciada</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {ap ? brl(ap.royalties_valor ?? 0) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {ap
                          ? brl((ap.csc_valor_fixo ?? ap.csc_base_antiga_valor ?? 0) as number)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {ap ? brl(ap.cac_valor ?? 0) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {ap ? brl(ap.csc_trafego_pago ?? 0) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {ap ? brl(ap.outras_receitas ?? 0) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {ap ? brl(ap.total_fatura ?? 0) : "—"}
                      </TableCell>
                      <TableCell>
                        <CelulaFatura f={faturaPorUnidade.get(u.id)} />
                      </TableCell>
                      <TableCell>
                        <CelulaRecebimento f={faturaPorUnidade.get(u.id)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to="/royalties/$unidadeId/$mes"
                          params={{ unidadeId: String(u.id), mes }}
                        >
                          <Button size="sm" variant={ap ? "outline" : "default"}>
                            {ap?.status === "confirmado" || ap?.status === "faturado"
                              ? "Ver apuração"
                              : ap
                                ? "Continuar"
                                : "Iniciar apuração"}
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
