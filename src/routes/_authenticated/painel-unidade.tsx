import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
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
} from "@/components/planning";
import { CORES_SERIE, eixoProps, gradeProps, tooltipProps } from "@/lib/planning/grafico";

export const Route = createFileRoute("/_authenticated/painel-unidade")({
  head: () => ({ meta: [{ title: "Painel da Unidade – Planning" }] }),
  component: PainelUnidadePage,
});

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
// Data pura ("2026-09-01") é o dia local; `new Date` a lia como meia-noite UTC
// e mostrava o dia anterior no Brasil.
const fmtData = (d: string | null) => {
  if (!d) return "—";
  const soDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const data = soDia ? new Date(Number(soDia[1]), Number(soDia[2]) - 1, Number(soDia[3])) : new Date(d);
  return Number.isNaN(data.getTime())
    ? "—"
    : data.toLocaleDateString("pt-BR", soDia ? undefined : { timeZone: "America/Sao_Paulo" });
};
const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");
const NUM = new Intl.NumberFormat("pt-BR");
// N2: o destino não recorta igual (Contratos e churn conta só franquias de
// unidades regionais), então o card diz que o total pode ser outro.
const AVISO_CONTRATOS = "Em Contratos e churn o recorte é outro (só franquias regionais) e o total pode diferir.";

// Tetos das leituras (as consultas não mudam; a procedência diz o teto).
const TETO = { empresas: 10000, contratos: 20000, tratativas: 10000, nps: 10000 } as const;

type Empresa = { id: number; razao_social: string | null; cnpj: string | null; unidade: string | null; pipedrive_id: string | null; status_financeiro: string | null };
type Contrato = { pipedrive_deal_id: string | null; mrr_mensal: number | null; status_contrato: string | null; ganho_em: string | null; unidade: string | null };
type CR = { valor: number | null; status_pagamento: string | null; data_pagamento: string | null; data_vencimento: string | null; cpf_cnpj: string | null; unidade: string | null };
type Tratativa = { status: string | null; unidade: string | null; update_time: string | null; stage_change_time: string | null };
type Nps = { nps_recomendacao: string | null; created_at: string | null; unidade: string | null };

type Fonte = "empresas" | "contratos" | "tratativas" | "nps" | "cr";
const NOME_FONTE: Record<Fonte, string> = {
  empresas: "empresas",
  contratos: "contratos",
  tratativas: "central de tratativas",
  nps: "pesquisas",
  cr: "contas a receber",
};

function PainelUnidadePage() {
  const { unidade: userUnidade, loading: permLoading, temArea } = usePermissions();
  const [lidoEm, setLidoEm] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [tentativa, setTentativa] = useState(0);
  const [erros, setErros] = useState<Partial<Record<Fonte, string>>>({});
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [cr, setCr] = useState<CR[]>([]);
  const [tratativas, setTratativas] = useState<Tratativa[]>([]);
  const [nps, setNps] = useState<Nps[]>([]);

  useEffect(() => {
    if (permLoading) return;
    let alive = true;
    setLoading(true);
    setErros({});
    (async () => {
      const [e, c, t, n] = await Promise.all([
        // Sem filtro por tipo_unidade: a coluna está vazia em boa parte da base
        // (as empresas vindas da Omie não a preenchem) e filtrar por ela
        // escondia a maioria dos clientes da unidade.
        supabase.from("empresas").select("id,razao_social,cnpj,unidade,pipedrive_id,status_financeiro").limit(10000),
        supabase.from("contratos").select("pipedrive_deal_id,mrr_mensal,status_contrato,ganho_em,unidade").limit(20000),
        supabase.from("central_tratativas").select("status,unidade,update_time,stage_change_time").limit(10000),
        supabase.from("nps_pesquisas").select("nps_recomendacao,created_at,unidade").limit(10000),
      ]);
      const pageSize = 1000;
      let from = 0;
      const allCr: CR[] = [];
      let erroCr: string | undefined;
      while (true) {
        const { data, error } = await supabase
          .from("contas_receber")
          .select("valor,status_pagamento,data_pagamento,data_vencimento,cpf_cnpj,unidade")
          .neq("status_pagamento", "CANCELADO")
          .range(from, from + pageSize - 1);
        if (error) {
          erroCr = error.message;
          break;
        }
        const batch = (data ?? []) as CR[];
        allCr.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      if (!alive) return;
      const novosErros: Partial<Record<Fonte, string>> = {};
      if (e.error) novosErros.empresas = e.error.message;
      if (c.error) novosErros.contratos = c.error.message;
      if (t.error) novosErros.tratativas = t.error.message;
      if (n.error) novosErros.nps = n.error.message;
      if (erroCr) novosErros.cr = erroCr;
      setErros(novosErros);
      setEmpresas((e.data ?? []) as Empresa[]);
      setContratos((c.data ?? []) as Contrato[]);
      setTratativas((t.data ?? []) as Tratativa[]);
      setNps((n.data ?? []) as Nps[]);
      setCr(erroCr ? [] : allCr);
      setLidoEm(new Date());
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [permLoading, tentativa]);

  const empresasUnidade = useMemo(
    () => empresas.filter((e) => unitMatches(userUnidade, e.unidade)),
    [empresas, userUnidade],
  );
  const cnpjsUnidade = useMemo(() => new Set(empresasUnidade.map((e) => onlyDigits(e.cnpj))), [empresasUnidade]);

  // A unidade vem do próprio contrato. Antes o filtro passava por
  // empresas.pipedrive_id, mas só ~1/4 das empresas tem esse id preenchido,
  // então boa parte do MRR sumia do painel.
  const ativosUnidade = useMemo(
    () => contratos.filter((c) => c.status_contrato === "Ativo" && unitMatches(userUnidade, c.unidade)),
    [contratos, userUnidade],
  );
  const mrr = ativosUnidade.reduce((s, c) => s + Number(c.mrr_mensal ?? 0), 0);
  // Contratos ativos, e não empresas.status_financeiro: esse campo só é
  // preenchido para parte da base e subestimava muito a carteira.
  const clientesAtivos = new Set(ativosUnidade.map((c) => String(c.pipedrive_deal_id ?? c.ganho_em))).size;

  const now = new Date();
  const mesIni = new Date(now.getFullYear(), now.getMonth(), 1);
  const mesLabel = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const churnMes = tratativas.filter(
    (t) =>
      (t.status ?? "").toLowerCase() === "lost" &&
      unitMatches(userUnidade, t.unidade) &&
      ((t.stage_change_time && new Date(t.stage_change_time) >= mesIni) ||
        (t.update_time && new Date(t.update_time) >= mesIni)),
  ).length;

  const since90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const npsRespostas = nps.filter(
    (n) => unitMatches(userUnidade, n.unidade) && n.created_at && new Date(n.created_at) >= since90,
  );
  // Number(null) é 0 — sem descartar as respostas sem nota, cada pesquisa não
  // respondida entrava como zero e derrubava a média.
  const npsScores = npsRespostas
    .filter((n) => n.nps_recomendacao !== null && String(n.nps_recomendacao).trim() !== "")
    .map((n) => Number(n.nps_recomendacao))
    .filter((v) => Number.isFinite(v));
  const npsMedio = npsScores.length ? npsScores.reduce((a, b) => a + b, 0) / npsScores.length : 0;

  const crUnidade = useMemo(
    () => cr.filter((r) => unitMatches(userUnidade, r.unidade) || cnpjsUnidade.has(onlyDigits(r.cpf_cnpj))),
    [cr, userUnidade, cnpjsUnidade],
  );
  const inadimplentes = crUnidade.filter((r) => ["ATRASADO", "VENCIDO"].includes(r.status_pagamento ?? ""));
  const inadValor = inadimplentes.reduce((s, r) => s + Number(r.valor ?? 0), 0);
  const inadClientes = new Set(inadimplentes.map((r) => onlyDigits(r.cpf_cnpj))).size;
  const emRisco = empresasUnidade.filter((e) => ["EM_ATRASO", "INADIMPLENTE"].includes(e.status_financeiro ?? "")).length;

  const serie = useMemo(() => {
    const buckets: { mes: string; key: string; novos: number; mrr_acum: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        mes: `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        novos: 0,
        mrr_acum: 0,
      });
    }
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    ativosUnidade.forEach((c) => {
      if (!c.ganho_em) return;
      const k = c.ganho_em.slice(0, 7);
      const i = idx.get(k);
      if (i !== undefined) buckets[i].novos += 1;
    });
    // MRR cumulativo até o final de cada mês
    for (const b of buckets) {
      const fim = new Date(Number(b.key.split("-")[0]), Number(b.key.split("-")[1]), 1);
      b.mrr_acum = ativosUnidade
        .filter((c) => c.ganho_em && new Date(c.ganho_em) < fim)
        .reduce((s, c) => s + Number(c.mrr_mensal ?? 0), 0);
    }
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativosUnidade]);

  const topAlertas = useMemo(() => {
    const byCnpj = new Map<string, CR[]>();
    crUnidade.forEach((r) => {
      const k = onlyDigits(r.cpf_cnpj);
      if (!k) return;
      const arr = byCnpj.get(k) ?? [];
      arr.push(r);
      byCnpj.set(k, arr);
    });
    return empresasUnidade
      .map((e) => {
        const rows = byCnpj.get(onlyDigits(e.cnpj)) ?? [];
        const atraso = rows
          .filter((r) => ["ATRASADO", "VENCIDO"].includes(r.status_pagamento ?? ""))
          .reduce((s, r) => s + Number(r.valor ?? 0), 0);
        const ultimoPag = rows
          .filter((r) => r.status_pagamento === "RECEBIDO" && r.data_pagamento)
          .map((r) => r.data_pagamento as string)
          .sort()
          .pop();
        return {
          id: e.id,
          empresa: e.razao_social ?? "—",
          // Busca da Base: CNPJ (≥3 dígitos) acha o cliente exato; sem CNPJ, o nome.
          busca: onlyDigits(e.cnpj).length >= 3 ? onlyDigits(e.cnpj) : (e.razao_social ?? ""),
          status: e.status_financeiro ?? "—",
          ultimoPag: ultimoPag ?? null,
          atraso,
        };
      })
      .filter((r) => r.atraso > 0)
      .sort((a, b) => b.atraso - a.atraso)
      .slice(0, 5);
  }, [empresasUnidade, crUnidade]);

  const carregando = loading || permLoading;
  const destinoContratos = `/clientes?view=contratos&unidade=${encodeURIComponent(userUnidade ?? "")}`;
  const fontesComErro = (Object.keys(erros) as Fonte[]).filter((f) => erros[f]);
  const estado = (...fontes: Fonte[]) => (fontes.some((f) => erros[f]) ? "indisponivel" : "ok") as "indisponivel" | "ok";
  const cortes = [
    empresas.length >= TETO.empresas && `${NUM.format(TETO.empresas)} empresas`,
    contratos.length >= TETO.contratos && `${NUM.format(TETO.contratos)} contratos`,
    tratativas.length >= TETO.tratativas && `${NUM.format(TETO.tratativas)} tratativas`,
    nps.length >= TETO.nps && `${NUM.format(TETO.nps)} pesquisas`,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        titulo="Painel"
        pergunta="Como a minha unidade está este mês, e o que pede atenção?"
        descricao={`${userUnidade ?? "Sem unidade vinculada"} · ${mesLabel} · contratos, tratativas e títulos da unidade`}
        procedencia={{
          fonte: "Base única · contratos, central de tratativas, contas a receber, pesquisas",
          // Hora da leitura desta tela: as tabelas não trazem data de sincronização aqui.
          atualizadoEm: lidoEm,
          regua: "MRR = soma do MRR mensal dos contratos com status Ativo da unidade; inadimplência = títulos ATRASADO ou VENCIDO",
        }}
      />

      {carregando ? (
        <Carregando variante="kpis" />
      ) : !userUnidade ? (
        <EstadoVazio
          titulo="Seu usuário não tem unidade vinculada"
          descricao="O painel recorta tudo pela unidade do seu usuário. Peça a quem administra os acessos para vincular a sua."
        />
      ) : (
        <>
          {fontesComErro.length > 0 && (
            <EstadoErro
              titulo={`Não foi possível ler ${fontesComErro.map((f) => NOME_FONTE[f]).join(", ")}`}
              detalhe={`Os números que dependem dessa leitura aparecem como fonte indisponível. Resposta do servidor: ${fontesComErro.map((f) => erros[f]).join(" · ")}`}
              tentarNovamente={() => setTentativa((x) => x + 1)}
            />
          )}
          <p className="text-[13px] text-muted-foreground">
            Leitura de até {NUM.format(TETO.empresas)} empresas, {NUM.format(TETO.contratos)} contratos,{" "}
            {NUM.format(TETO.tratativas)} tratativas e {NUM.format(TETO.nps)} pesquisas; títulos sem teto.
            {cortes.length > 0 && ` A leitura chegou ao teto de ${cortes.join(", ")}: pode haver registros fora da conta.`}
          </p>

          <KpiGrade colunas={4}>
            <KpiCard
              rotulo="MRR atual"
              valor={fmtBRL(mrr)}
              estado={estado("contratos")}
              nota={`Soma do MRR dos contratos ativos. ${AVISO_CONTRATOS}`}
              abrir={{ href: destinoContratos, rotulo: "Abrir contratos" }}
            />
            <KpiCard
              rotulo="Contratos ativos"
              valor={NUM.format(clientesAtivos)}
              estado={estado("contratos")}
              nota={AVISO_CONTRATOS}
              abrir={{ href: destinoContratos, rotulo: "Abrir contratos" }}
            />
            <KpiCard
              rotulo="Tratativas perdidas movidas no mês"
              valor={NUM.format(churnMes)}
              estado={estado("tratativas")}
              nota="Perdidas com troca de fase ou atualização desde o dia 1"
            />
            <KpiCard
              rotulo="Nota média das pesquisas (90 dias)"
              valor={npsMedio.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              estado={erros.nps ? "indisponivel" : npsScores.length ? "ok" : "nao-apurado"}
              nota={`${NUM.format(npsScores.length)} de ${NUM.format(npsRespostas.length)} pesquisas com nota`}
            />
          </KpiGrade>

          <Secao titulo="O que pede atenção?" descricao="Títulos em atraso e clientes com situação financeira de risco">
            <KpiGrade colunas={2}>
              <KpiCard
                rotulo="Inadimplência"
                valor={fmtBRL(inadValor)}
                estado={erros.cr ? "indisponivel" : erros.empresas ? "parcial" : "ok"}
                tom={inadValor > 0 ? "perigo" : undefined}
                tomRotulo="em atraso"
                // Contas a Receber é da área Financeiro da unidade: sem ela, o card não abre.
                abrir={temArea("minha_unidade_financeiro") ? { href: "/contas-receber", rotulo: "Abrir contas a receber" } : undefined}
                nota={
                  erros.empresas && !erros.cr
                    ? "Só títulos com a unidade no próprio registro: a leitura de empresas falhou"
                    : `${NUM.format(inadClientes)} cliente(s) com fatura atrasada ou vencida`
                }
              />
              <KpiCard
                rotulo="Clientes em risco"
                valor={NUM.format(emRisco)}
                estado={estado("empresas")}
                tom={emRisco > 0 ? "atencao" : undefined}
                tomRotulo="em risco"
                nota="Situação financeira EM_ATRASO ou INADIMPLENTE. A Base de clientes abre sem esse filtro."
                abrir={{ href: "/clientes", rotulo: "Abrir a Base" }}
              />
            </KpiGrade>
          </Secao>

          <Secao
            titulo="Como o MRR dos contratos ativos hoje se formou, pelo mês de ganho?"
            descricao="MRR acumulado em R$, últimos 6 meses. Só contratos ativos hoje, pelo mês de ganho: quem saiu não entra, então a curva não é o MRR que a unidade tinha em cada mês."
          >
            {erros.contratos ? (
              <EstadoErro
                titulo="Não foi possível ler os contratos"
                detalhe={erros.contratos}
                tentarNovamente={() => setTentativa((x) => x + 1)}
              />
            ) : (
              <div className="rounded-xl border bg-card p-4">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={serie} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gradeProps} />
                    <XAxis dataKey="mes" {...eixoProps} />
                    <YAxis {...eixoProps} tickFormatter={(v: number) => `${NUM.format(Math.round(v / 1000))} mil`} width={64} />
                    <RTooltip
                      {...tooltipProps}
                      formatter={(v, _n, item) => [
                        `${fmtBRL(Number(v))} · ${NUM.format((item as { payload?: { novos?: number } })?.payload?.novos ?? 0)} contrato(s) ganho(s) no mês`,
                        "MRR acumulado",
                      ]}
                    />
                    <Line dataKey="mrr_acum" name="MRR acumulado" stroke={CORES_SERIE[0]} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Secao>

          <Secao
            titulo="Quais clientes têm mais valor em atraso?"
            descricao="Os 5 maiores valores atrasados ou vencidos; a linha abre o cliente na Base de clientes"
          >
            {erros.empresas || erros.cr ? (
              <EstadoErro
                titulo={`Não foi possível ler ${[erros.empresas && "empresas", erros.cr && "contas a receber"].filter(Boolean).join(" e ")}`}
                detalhe={[erros.empresas, erros.cr].filter(Boolean).join(" · ")}
                tentarNovamente={() => setTentativa((x) => x + 1)}
              />
            ) : topAlertas.length === 0 ? (
              <EstadoVazio titulo="Nenhum cliente com valor em atraso" />
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Situação financeira</TableHead>
                      <TableHead>Último pagamento</TableHead>
                      <TableHead className="text-right">Em atraso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topAlertas.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          <Link
                            to="/clientes"
                            search={{ q: r.busca } as never}
                            className="rounded-sm text-primary-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            {r.empresa}
                          </Link>
                        </TableCell>
                        <TableCell>{r.status}</TableCell>
                        <TableCell className="tabular-nums">{fmtData(r.ultimoPag)}</TableCell>
                        <TableCell className="text-right tabular-nums text-danger">{fmtBRL(r.atraso)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Secao>
        </>
      )}
    </div>
  );
}
