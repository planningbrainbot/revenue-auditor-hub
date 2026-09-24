import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Carregando,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
} from "@/components/planning";
import {
  brlOuTraco,
  ErroDaConsulta,
  mesAnterior,
  mesEmAndamento,
  MolduraReceita,
  rotuloMes,
  SeletorMes,
  useMesNaUrl,
} from "@/components/receita/moldura";

type BillingEsperadoRow = {
  unidade: string;
  clientes_ativos: number;
  mrr_base: number;
  royalties_pct: number;
  royalties_esp: number;
  csc_fixo: number;
  midia_mensal: number;
  total_esperado: number;
  paga_cac: boolean;
  tem_base_antiga: boolean;
};

type FinRow = {
  codigo_categoria: string | null;
  valor_documento: number | null;
};

const CAT_ROYALTIES = "1.01.95";
const CAT_CSC = "1.01.96";
const CAT_MIDIA = "1.03.96";
const CAT_OUTRAS = "1.01.94";

const CHAVES = "view.roas ou view.auditoria";
/** O PostgREST devolve no máximo 1.000 linhas, apesar do `.limit(20000)` (defeito de dado 7). */
const CORTE_POSTGREST = 1000;
const NUM = new Intl.NumberFormat("pt-BR");

function monthBounds(ym: string): { start: string; end: string; mesRef: string } {
  const [y, m] = ym.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const endDate = new Date(y, m, 1);
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-01`;
  return { start, end, mesRef: start };
}

/**
 * Aba Esperado × Recebido do Funil de Receita (contrato §2). O "Recebido" daqui
 * é por **data de emissão** em `partners_financeiro`: a terceira régua com o
 * mesmo nome na área (N11). Por isso o rótulo diz "Recebido (por emissão)".
 * Mês padrão: o anterior (o esperado é de um mês fechado).
 */
export function AuditoriaFaturamentoContent({ abas }: { abas?: ReactNode }) {
  const { can, loading: permLoading } = usePermissions();
  const [mes, setMes] = useMesNaUrl(mesAnterior());
  const { start, end, mesRef } = useMemo(() => monthBounds(mes), [mes]);
  const pode = can("view.roas") || can("view.auditoria");

  const esperadoQ = useQuery({
    queryKey: ["billing-esperado", mesRef],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("billing_esperado", { mes_ref: mesRef });
      if (error) throw error;
      return (data ?? []) as BillingEsperadoRow[];
    },
    enabled: !permLoading && pode,
  });

  const recebidoQ = useQuery({
    queryKey: ["partners-financeiro-mes", start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partners_financeiro")
        .select("codigo_categoria,valor_documento,data_emissao,status_titulo")
        .eq("status_titulo", "RECEBIDO")
        .gte("data_emissao", start)
        .lt("data_emissao", end)
        .limit(20000);
      if (error) throw error;
      return (data ?? []) as FinRow[];
    },
    enabled: !permLoading && pode,
  });

  const totalEsperado = (esperadoQ.data ?? []).reduce(
    (s, r) => s + Number(r.total_esperado ?? 0),
    0,
  );

  const recebidoPorCategoria = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of recebidoQ.data ?? []) {
      const k = r.codigo_categoria ?? "__null__";
      map.set(k, (map.get(k) ?? 0) + Number(r.valor_documento ?? 0));
    }
    return map;
  }, [recebidoQ.data]);

  const totalRecebidoPrincipal =
    (recebidoPorCategoria.get(CAT_ROYALTIES) ?? 0) +
    (recebidoPorCategoria.get(CAT_CSC) ?? 0) +
    (recebidoPorCategoria.get(CAT_MIDIA) ?? 0);

  const delta = totalRecebidoPrincipal - totalEsperado;

  const esperado = esperadoQ.data ?? [];
  const totals = esperado.reduce(
    (acc, r) => {
      acc.clientes += Number(r.clientes_ativos ?? 0);
      acc.mrr += Number(r.mrr_base ?? 0);
      acc.royalties += Number(r.royalties_esp ?? 0);
      acc.csc += Number(r.csc_fixo ?? 0);
      acc.midia += r.paga_cac ? 0 : Number(r.midia_mensal ?? 0);
      acc.total += Number(r.total_esperado ?? 0);
      return acc;
    },
    { clientes: 0, mrr: 0, royalties: 0, csc: 0, midia: 0, total: 0 },
  );

  const carregando = permLoading || esperadoQ.isLoading || recebidoQ.isLoading;
  const erro = esperadoQ.error ?? recebidoQ.error;
  // Resposta no teto do PostgREST: pode haver título a mais que não veio.
  const cortado = (recebidoQ.data?.length ?? 0) >= CORTE_POSTGREST;
  const nomeMes = rotuloMes(mes);
  const semNada = esperado.length === 0 && (recebidoQ.data?.length ?? 0) === 0;

  return (
    <MolduraReceita
      titulo="Funil de Receita"
      pergunta="Onde o MRR contratado deixa de virar faturado e recebido?"
      descricao={
        <>
          {esperado.length ? `${NUM.format(esperado.length)} unidades` : "Unidades da rede"} ·{" "}
          {nomeMes}
          {mesEmAndamento(mes) && " (em andamento, parcial)"} · esperado pelos contratos ativos no
          Pipedrive; recebido pelos títulos pagos com <strong>data de emissão</strong> no mês, outra
          régua que a do Funil e a da Visão geral.
        </>
      }
      procedencia={{
        fonte: "billing_esperado · partners_financeiro (Omie)",
        regua: "emissão",
      }}
      filtros={<SeletorMes mes={mes} aoMudar={setMes} />}
    >
      <div className="space-y-6 p-4 md:p-6">
        {abas}

        {!permLoading && !pode ? (
          <EstadoSemAcesso oQueFalta={CHAVES} />
        ) : erro ? (
          <ErroDaConsulta
            erro={erro}
            chaves={CHAVES}
            tentarNovamente={() => {
              void esperadoQ.refetch();
              void recebidoQ.refetch();
            }}
          />
        ) : carregando ? (
          <>
            <Carregando variante="kpis" />
            <Carregando variante="tabela" />
          </>
        ) : semNada ? (
          <EstadoVazio
            titulo={`Sem esperado nem recebido para ${nomeMes}`}
            descricao="Nenhuma unidade com contrato ativo e nenhum título pago emitido no mês."
          />
        ) : (
          <>
            <KpiGrade colunas={3}>
              <KpiCard
                rotulo="Total esperado"
                valor={brlOuTraco(totalEsperado)}
                nota="royalties + CSC + mídia, pelos contratos ativos"
                procedencia={{ fonte: "billing_esperado" }}
              />
              <KpiCard
                rotulo="Recebido (por emissão)"
                valor={brlOuTraco(totalRecebidoPrincipal)}
                estado={cortado ? "parcial" : "ok"}
                nota={
                  cortado
                    ? "royalties + CSC + mídia · leitura cortada em 1.000 títulos: pode faltar recebido"
                    : "royalties + CSC + mídia, títulos pagos emitidos no mês"
                }
                procedencia={{ fonte: "partners_financeiro" }}
              />
              <KpiCard
                rotulo="Delta (recebido − esperado)"
                valor={brlOuTraco(delta)}
                estado={cortado ? "parcial" : "ok"}
                // Com a leitura cortada o recebido está subestimado: o sinal do delta
                // não é confiável e o card fica sem tom.
                tom={cortado ? undefined : delta >= 0 ? "sucesso" : "perigo"}
                tomRotulo={
                  cortado ? undefined : delta >= 0 ? "acima do esperado" : "abaixo do esperado"
                }
              />
            </KpiGrade>

            <Secao
              titulo={`Quanto cada unidade deveria repassar em ${nomeMes}?`}
              descricao="O esperado sai dos contratos ativos no Pipedrive. Unidades com base antiga (Curitiba e Patos de Minas) têm uma parcela de CSC que o Pipedrive não calcula: ela aparece como “Sem categoria” no Omie."
            >
              {esperado.length === 0 ? (
                <EstadoVazio titulo="Sem esperado para o mês" />
              ) : (
                <div className="overflow-auto rounded-xl border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unidade</TableHead>
                        <TableHead className="text-right">Clientes ativos</TableHead>
                        <TableHead className="text-right">MRR base</TableHead>
                        <TableHead className="text-right">Royalties</TableHead>
                        <TableHead className="text-right">CSC expansão</TableHead>
                        <TableHead className="text-right">Mídia / CAC</TableHead>
                        <TableHead className="text-right">Total esperado</TableHead>
                        <TableHead>Observação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {esperado.map((r) => (
                        <TableRow key={r.unidade}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{r.unidade}</span>
                              {r.paga_cac && <StatusBadge tom="info">Paga CAC</StatusBadge>}
                            </div>
                          </TableCell>
                          <TableCell className="num text-right">
                            {NUM.format(Number(r.clientes_ativos ?? 0))}
                          </TableCell>
                          <TableCell className="num text-right">{brlOuTraco(r.mrr_base)}</TableCell>
                          <TableCell className="num text-right">
                            <div>{brlOuTraco(r.royalties_esp)}</div>
                            <div className="text-xs text-muted-foreground">
                              {Number(r.royalties_pct ?? 0)}%
                            </div>
                          </TableCell>
                          <TableCell className="num text-right">{brlOuTraco(r.csc_fixo)}</TableCell>
                          <TableCell className="num text-right">
                            {r.paga_cac ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              brlOuTraco(r.midia_mensal)
                            )}
                          </TableCell>
                          <TableCell className="num text-right font-semibold">
                            {brlOuTraco(r.total_esperado)}
                          </TableCell>
                          <TableCell>
                            {r.tem_base_antiga && (
                              <StatusBadge tom="atencao">Base antiga não calculada</StatusBadge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="num text-right font-semibold">
                          {NUM.format(totals.clientes)}
                        </TableCell>
                        <TableCell className="num text-right font-semibold">
                          {brlOuTraco(totals.mrr)}
                        </TableCell>
                        <TableCell className="num text-right font-semibold">
                          {brlOuTraco(totals.royalties)}
                        </TableCell>
                        <TableCell className="num text-right font-semibold">
                          {brlOuTraco(totals.csc)}
                        </TableCell>
                        <TableCell className="num text-right font-semibold">
                          {brlOuTraco(totals.midia)}
                        </TableCell>
                        <TableCell className="num text-right font-semibold">
                          {brlOuTraco(totals.total)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </Secao>

            <Secao
              titulo="Quanto entrou no Omie em cada categoria?"
              descricao={`Recebido (por emissão): títulos pagos com data de emissão em ${nomeMes}.${cortado ? " A leitura parou em 1.000 títulos: os valores podem estar abaixo do real." : ""}`}
            >
              <div className="overflow-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Categoria Omie</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead className="text-right">Recebido (por emissão)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { label: "Royalties", code: CAT_ROYALTIES, key: CAT_ROYALTIES },
                      { label: "CSC Expansão", code: CAT_CSC, key: CAT_CSC },
                      { label: "CSC Tráfego Pago (Mídia)", code: CAT_MIDIA, key: CAT_MIDIA },
                      { label: "Outras Receitas", code: CAT_OUTRAS, key: CAT_OUTRAS },
                      { label: "Sem categoria (base antiga)", code: "NULL", key: "__null__" },
                    ].map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>{row.label}</TableCell>
                        <TableCell className="text-muted-foreground">{row.code}</TableCell>
                        <TableCell className="num text-right">
                          {brlOuTraco(recebidoPorCategoria.get(row.key) ?? 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell />
                      <TableCell className="num text-right font-semibold">
                        {brlOuTraco(
                          Array.from(recebidoPorCategoria.values()).reduce((s, v) => s + v, 0),
                        )}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </Secao>
          </>
        )}
      </div>
    </MolduraReceita>
  );
}
