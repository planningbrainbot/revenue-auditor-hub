import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  StatusBadge,
} from "@/components/planning";

export const Route = createFileRoute("/_authenticated/meus-royalties")({
  head: () => ({ meta: [{ title: "Meus Royalties – Planning" }] }),
  component: MeusRoyaltiesPage,
});

const fmtBRL = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Data pura ("2021-03-15") no dia local: `new Date` a lia como UTC e mostrava o dia anterior. */
function diaLocal(d: string | null): Date | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  const data = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
  return Number.isNaN(data.getTime()) ? null : data;
}
const fmtData = (d: string | null) => diaLocal(d)?.toLocaleDateString("pt-BR") ?? "—";

type UnidadeRegras = {
  nome_da_praca: string | null;
  data_inauguracao: string | null;
  royalties_percentual: number | null;
  csc_valor_fixo: number | null;
  csc_percentual_base_antiga: number | null;
  midia_mensal: number | null;
};

type LinhaMes = {
  mes: string;
  /** Sem linha do billing_esperado para a unidade neste mês. */
  semPrevisto: boolean;
  /** A leitura do previsto deste mês falhou. */
  erroPrevisto: boolean;
  /** A leitura dos repasses falhou (vale para todos os meses). */
  erroRecebido: boolean;
  mrrBase: number;
  royaltiesPrev: number;
  cscPrev: number;
  midia: number;
  totalPrev: number;
  recebido: number | null;
};

function tempoDeCasa(d: string | null): string {
  const ini = diaLocal(d);
  if (!ini) return "—";
  const hoje = new Date();
  const meses = (hoje.getFullYear() - ini.getFullYear()) * 12 + (hoje.getMonth() - ini.getMonth());
  if (meses < 12) return `${meses} mês(es)`;
  return `${Math.floor(meses / 12)}a ${meses % 12}m`;
}

function MeusRoyaltiesPage() {
  const { unidade: userUnidade, loading: permLoading } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [tentativa, setTentativa] = useState(0);
  const [erros, setErros] = useState<string[]>([]);
  const [lidoEm, setLidoEm] = useState<Date | null>(null);
  const [regras, setRegras] = useState<UnidadeRegras | null>(null);
  const [historico, setHistorico] = useState<LinhaMes[]>([]);

  useEffect(() => {
    if (permLoading || !userUnidade) return;
    let alive = true;
    setLoading(true);
    setErros([]);
    (async () => {
      const falhas: string[] = [];
      const { data: unidadesData, error: erroUnidades } = await supabase
        .from("unidades")
        .select("nome_da_praca,data_inauguracao,royalties_percentual,csc_valor_fixo,csc_percentual_base_antiga,midia_mensal")
        .limit(200);
      if (erroUnidades) falhas.push(`regras da unidade: ${erroUnidades.message}`);
      const minhaUnidade = (unidadesData ?? []).find((u) => unitMatches(userUnidade, u.nome_da_praca));

      // últimos 12 meses
      const hoje = new Date();
      const meses: { iso: string; label: string }[] = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        meses.push({
          iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
          label: d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }),
        });
      }

      // Esperado por mês via RPC billing_esperado
      const esperadoPorMes: Record<string, { mrr: number; royalties: number; csc: number; midia: number; total: number }> = {};
      const mesesComErro: string[] = [];
      const isoComErro = new Set<string>();
      await Promise.all(
        meses.map(async (m) => {
          const { data, error } = await supabase.rpc("billing_esperado", { mes_ref: m.iso });
          if (error) {
            mesesComErro.push(m.label);
            isoComErro.add(m.iso);
            return;
          }
          const linha = (data ?? []).find((r: any) => unitMatches(userUnidade, r.unidade));
          if (linha) {
            esperadoPorMes[m.iso] = {
              mrr: Number(linha.mrr_base ?? 0),
              royalties: Number(linha.royalties_esp ?? 0),
              csc: Number(linha.csc_fixo ?? 0),
              midia: Number(linha.midia_mensal ?? 0),
              total: Number(linha.total_esperado ?? 0),
            };
          }
        }),
      );
      if (mesesComErro.length) falhas.push(`previsto (billing_esperado) de ${mesesComErro.length} mês(es)`);

      // Recebido (repasses_unidade) - filtra pela unidade
      const { data: repassesData, error: erroRepasses } = await supabase
        .from("repasses_unidade")
        .select("competencia,tipo,valor_recebido,unidade")
        .gte("competencia", meses[meses.length - 1].iso)
        .limit(1000);
      if (erroRepasses) falhas.push(`repasses recebidos: ${erroRepasses.message}`);
      const recebidoPorMes: Record<string, number> = {};
      (repassesData ?? []).forEach((r: any) => {
        if (!unitMatches(userUnidade, r.unidade)) return;
        const key = String(r.competencia).slice(0, 7) + "-01";
        recebidoPorMes[key] = (recebidoPorMes[key] ?? 0) + Number(r.valor_recebido ?? 0);
      });

      if (!alive) return;
      setErros(falhas);
      setRegras(minhaUnidade ?? null);
      setHistorico(
        meses.map((m) => {
          const e = esperadoPorMes[m.iso];
          const esp = e ?? { mrr: 0, royalties: 0, csc: 0, midia: 0, total: 0 };
          const recebido = recebidoPorMes[m.iso] ?? null;
          return {
            mes: m.label,
            semPrevisto: !e,
            erroPrevisto: isoComErro.has(m.iso),
            erroRecebido: !!erroRepasses,
            mrrBase: esp.mrr,
            royaltiesPrev: esp.royalties,
            cscPrev: esp.csc,
            midia: esp.midia,
            totalPrev: esp.total,
            recebido,
          };
        }),
      );
      setLidoEm(new Date());
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [permLoading, userUnidade, tentativa]);

  function situacao(h: LinhaMes) {
    // Leitura que falhou não vira "Sem cobrança" nem "Em aberto": não se sabe.
    if (h.erroPrevisto || h.erroRecebido) return <span className="text-muted-foreground">—</span>;
    if (h.semPrevisto && h.recebido == null) return <span className="text-muted-foreground">—</span>;
    // Nada previsto e nada repassado não é "Pago": não houve cobrança.
    if (h.totalPrev === 0 && (h.recebido ?? 0) === 0) return <StatusBadge tom="neutro">Sem cobrança</StatusBadge>;
    if (h.recebido == null) return <span className="text-muted-foreground">—</span>;
    if (h.recebido >= h.totalPrev * 0.99) return <StatusBadge tom="sucesso">Pago</StatusBadge>;
    if (h.recebido > 0) return <StatusBadge tom="atencao">Parcial</StatusBadge>;
    return <StatusBadge tom="perigo">Em aberto</StatusBadge>;
  }

  const prev = (h: LinhaMes, v: number) => (h.semPrevisto ? "—" : fmtBRL(v));
  const carregando = permLoading || (!!userUnidade && loading);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        titulo="Meus Royalties"
        pergunta="Quanto a minha unidade repassou, e o que está em aberto?"
        descricao={`${userUnidade ?? "Sem unidade vinculada"} · últimos 12 meses · previsto pelas regras da unidade contra o repasse recebido`}
        procedencia={{
          fonte: "Regras da unidade · previsto (billing_esperado) · repasses recebidos",
          atualizadoEm: lidoEm,
          regua: "Pago quando o recebido cobre 99% do previsto; leitura de até 1.000 repasses",
        }}
      />

      {carregando ? (
        <Carregando variante="tabela" />
      ) : !userUnidade ? (
        <EstadoVazio
          titulo="Seu usuário não tem unidade vinculada"
          descricao="Os royalties são da unidade do seu usuário. Peça a quem administra os acessos para vincular a sua."
        />
      ) : (
        <>
          {erros.length > 0 && (
            <EstadoErro
              titulo="Parte dos dados não pôde ser lida"
              detalhe={`Falhou: ${erros.join(" · ")}. Os meses afetados aparecem como "—".`}
              tentarNovamente={() => setTentativa((x) => x + 1)}
            />
          )}

          <KpiGrade colunas={4}>
            <KpiCard
              rotulo="Royalties"
              valor={regras?.royalties_percentual != null ? `${regras.royalties_percentual}%` : "—"}
              estado={regras?.royalties_percentual != null ? "ok" : "nao-apurado"}
            />
            <KpiCard
              rotulo="CSC (fixo)"
              valor={fmtBRL(regras?.csc_valor_fixo ?? null)}
              estado={regras?.csc_valor_fixo != null ? "ok" : "nao-apurado"}
              nota={regras?.csc_percentual_base_antiga ? `Base antiga: ${regras.csc_percentual_base_antiga}%` : undefined}
            />
            <KpiCard
              rotulo="Mídia mensal"
              valor={fmtBRL(regras?.midia_mensal ?? null)}
              estado={regras?.midia_mensal != null ? "ok" : "nao-apurado"}
            />
            <KpiCard
              rotulo="Tempo de casa"
              valor={tempoDeCasa(regras?.data_inauguracao ?? null)}
              estado={diaLocal(regras?.data_inauguracao ?? null) ? "ok" : "nao-apurado"}
              nota={`Inauguração: ${fmtData(regras?.data_inauguracao ?? null)}`}
            />
          </KpiGrade>

          <Secao titulo="Mês a mês, o previsto foi repassado?" descricao="Últimos 12 meses, do mais recente para o mais antigo">
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mês</TableHead>
                    <TableHead className="text-right">MRR base</TableHead>
                    <TableHead className="text-right">Royalties</TableHead>
                    <TableHead className="text-right">CSC</TableHead>
                    <TableHead className="text-right">Mídia</TableHead>
                    <TableHead className="text-right">Total previsto</TableHead>
                    <TableHead className="text-right">Recebido</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historico.map((h) => (
                    <TableRow key={h.mes}>
                      <TableCell className="font-medium capitalize">{h.mes}</TableCell>
                      <TableCell className="text-right tabular-nums">{prev(h, h.mrrBase)}</TableCell>
                      <TableCell className="text-right tabular-nums">{prev(h, h.royaltiesPrev)}</TableCell>
                      <TableCell className="text-right tabular-nums">{prev(h, h.cscPrev)}</TableCell>
                      <TableCell className="text-right tabular-nums">{prev(h, h.midia)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{prev(h, h.totalPrev)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBRL(h.recebido)}</TableCell>
                      <TableCell>{situacao(h)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Secao>
        </>
      )}
    </div>
  );
}
