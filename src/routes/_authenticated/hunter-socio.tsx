import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import {
  BarraFiltros,
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Procedencia,
  Secao,
  StatusBadge,
} from "@/components/planning";
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

// Hunter Sócio: as vendas que a unidade fechou pelo pipe "Negociação - Sócios"
// (pipeline 4 do Pipedrive). Pedido do Eliezek em 02/10/2026. O recorte por
// unidade é feito dentro de ops.v_hunter_socio (migration 20261002150000): o
// sócio só recebe as linhas da unidade dele. O grão é a unidade, e não o sócio,
// porque o dono do deal só é o sócio quando ele mesmo criou o deal. Venda sem
// "Unidade de Negócio" no Pipedrive cai na unidade do sócio dono do deal, e a
// linha diz isso.
export const Route = createFileRoute("/_authenticated/hunter-socio")({
  head: () => ({ meta: [{ title: "Hunter Sócio – Planning" }] }),
  component: HunterSocioPage,
});

type Venda = {
  contrato_id: number;
  pipedrive_deal_id: string | null;
  empresa_id: number | null;
  cliente: string | null;
  ganho_em: string | null;
  mrr_mensal: number | null;
  unidade: string;
  unidade_inferida: boolean;
  socio_dono: string | null;
};

const LIMITE = 1000;

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtData = (iso: string | null) => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

const ROTULO_MES = (chave: string) => {
  const [a, m] = chave.split("-");
  const nome = new Date(Number(a), Number(m) - 1, 1).toLocaleDateString("pt-BR", {
    month: "short",
  });
  return `${nome.replace(".", "")}/${a}`;
};

/** Cliente é a empresa; sem empresa ligada, o nome do deal. */
const chaveDoCliente = (v: Venda) =>
  v.empresa_id != null ? `e${v.empresa_id}` : `t${v.cliente ?? v.contrato_id}`;

function HunterSocioPage() {
  const { scopedToOwnUnit, verComo, loading: carregandoPerm } = usePermissions();
  const { user } = useAuth();
  const [anoBruto, setAno] = useFiltroNaUrl("ano", "todos");

  const q = useQuery({
    // Por conta e por simulação: trocar de login ou vestir outra unidade no
    // mesmo navegador não pode mostrar as vendas de quem olhava antes.
    queryKey: ["hunter-socio", user?.id, verComo?.unidade ?? null],
    enabled: !!user?.id,
    queryFn: async () => {
      // A view não está nos tipos gerados.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("v_hunter_socio")
        .select(
          "contrato_id,pipedrive_deal_id,empresa_id,cliente,ganho_em,mrr_mensal,unidade,unidade_inferida,socio_dono",
        )
        .order("ganho_em", { ascending: false })
        .limit(LIMITE);
      if (error) throw error;
      return (data ?? []) as Venda[];
    },
  });

  const vendas = useMemo(() => q.data ?? [], [q.data]);
  const anos = useMemo(
    () =>
      [...new Set(vendas.map((v) => v.ganho_em?.slice(0, 4)).filter(Boolean) as string[])]
        .sort()
        .reverse(),
    [vendas],
  );
  const ano = anoBruto !== "todos" && anos.includes(anoBruto) ? anoBruto : "todos";
  const doPeriodo = useMemo(
    () => (ano === "todos" ? vendas : vendas.filter((v) => v.ganho_em?.startsWith(ano))),
    [vendas, ano],
  );
  // Na visão do sócio a unidade é uma só; para a matriz a tabela mostra de quem é cada venda.
  const variasUnidades = new Set(vendas.map((v) => v.unidade)).size > 1 || !scopedToOwnUnit;

  const clientes = new Set(doPeriodo.map(chaveDoCliente)).size;
  const mrr = doPeriodo.reduce((s, v) => s + (v.mrr_mensal ?? 0), 0);
  const mesAtual = new Date().toISOString().slice(0, 7);
  const noMes = vendas.filter((v) => v.ganho_em?.startsWith(mesAtual));
  const inferidas = doPeriodo.filter((v) => v.unidade_inferida).length;

  const porMes = useMemo(() => {
    const m = new Map<string, { vendas: number; mrr: number }>();
    for (const v of doPeriodo) {
      const k = v.ganho_em?.slice(0, 7);
      if (!k) continue;
      const atual = m.get(k) ?? { vendas: 0, mrr: 0 };
      atual.vendas += 1;
      atual.mrr += v.mrr_mensal ?? 0;
      m.set(k, atual);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [doPeriodo]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
      <PageHeader
        titulo="Hunter Sócio"
        pergunta="Quantos clientes a unidade vendeu pelas mãos dos sócios?"
        descricao="Vendas ganhas no pipe Negociação - Sócios do Pipedrive · por data de ganho · um cliente pode ter mais de uma venda"
        filtros={
          <BarraFiltros>
            <Select value={ano} onValueChange={(v) => setAno(v === "todos" ? undefined : v)}>
              <SelectTrigger className="w-[160px]" aria-label="Ano da venda">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os anos</SelectItem>
                {anos.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </BarraFiltros>
        }
      />

      {q.isLoading || carregandoPerm ? (
        <Carregando variante="pagina" />
      ) : q.isError ? (
        <EstadoErro
          titulo="Não foi possível carregar as vendas dos sócios"
          detalhe={(q.error as Error)?.message}
          tentarNovamente={() => q.refetch()}
        />
      ) : vendas.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma venda de sócio registrada para a unidade"
          descricao="Conta aqui o deal ganho no pipe Negociação - Sócios do Pipedrive com a Unidade de Negócio preenchida."
        />
      ) : (
        <>
          <KpiGrade colunas={4}>
            <KpiCard
              rotulo="Clientes vendidos"
              valor={clientes}
              nota={`em ${doPeriodo.length} ${doPeriodo.length === 1 ? "venda" : "vendas"}${ano === "todos" ? "" : ` em ${ano}`}`}
            />
            <KpiCard
              rotulo="MRR vendido"
              valor={fmtBRL(mrr)}
              nota="Valor mensal do deal no Pipedrive"
            />
            <KpiCard
              rotulo="Vendas neste mês"
              valor={noMes.length}
              nota={fmtBRL(noMes.reduce((s, v) => s + (v.mrr_mensal ?? 0), 0)) + " de MRR"}
            />
            <KpiCard
              rotulo="Sem unidade no Pipedrive"
              valor={inferidas}
              nota="Atribuídas pelo sócio dono do deal"
            />
          </KpiGrade>

          {vendas.length >= LIMITE && (
            <p className="text-sm text-warning">
              Mostrando as {LIMITE} vendas mais recentes. As anteriores não entraram nos números
              acima.
            </p>
          )}

          <Secao
            titulo="Como as vendas se distribuem no tempo?"
            descricao="Vendas e MRR por mês de ganho."
          >
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mês</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">MRR vendido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porMes.map(([mes, v]) => (
                    <TableRow key={mes}>
                      <TableCell>{ROTULO_MES(mes)}</TableCell>
                      <TableCell className="num text-right">{v.vendas}</TableCell>
                      <TableCell className="num text-right">{fmtBRL(v.mrr)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Secao>

          <Secao
            titulo="Quais clientes foram vendidos?"
            descricao={`${doPeriodo.length} vendas, da mais recente para a mais antiga.`}
          >
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    {variasUnidades && <TableHead>Unidade</TableHead>}
                    <TableHead>Ganho em</TableHead>
                    <TableHead className="text-right">MRR</TableHead>
                    <TableHead>Sócio dono do deal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doPeriodo.map((v) => (
                    <TableRow key={v.contrato_id}>
                      <TableCell className="font-medium">
                        {v.cliente ?? "—"}
                        {v.unidade_inferida && (
                          <div className="mt-1">
                            <StatusBadge tom="atencao">Sem unidade no Pipedrive</StatusBadge>
                          </div>
                        )}
                      </TableCell>
                      {variasUnidades && <TableCell>{v.unidade}</TableCell>}
                      <TableCell className="num">{fmtData(v.ganho_em)}</TableCell>
                      <TableCell className="num text-right">
                        {v.mrr_mensal != null ? fmtBRL(v.mrr_mensal) : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {v.socio_dono ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Secao>

          <Procedencia
            fonte="Pipedrive · pipe Negociação - Sócios (contratos do Ops)"
            atualizadoEm={new Date(q.dataUpdatedAt)}
            regua="data de ganho do deal; deals lançados em lote em agosto/2026 levam a data do lançamento"
          />
        </>
      )}
    </div>
  );
}
