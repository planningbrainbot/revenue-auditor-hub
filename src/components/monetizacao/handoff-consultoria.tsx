import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarraFiltros,
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  PageHeader,
  StatusBadge,
} from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import { hoje as hojeSP } from "@/lib/monetizacao/model";
import { carregarHandoffConsultoria } from "@/lib/monetizacao/handoff-consultoria.functions";
import {
  INICIO_PADRAO,
  montarPainel,
  type Cliente,
  type EtapaFunil,
  type Painel,
  type PainelBruto,
} from "@/lib/monetizacao/handoff-consultoria";
import {
  CORES_SERIE,
  COR_NEUTRA,
  eixoProps,
  gradeProps,
  RAIO_BARRA,
  tooltipProps,
} from "@/lib/planning/grafico";
import { cn } from "@/lib/utils";
import { Field, inputClass } from "./common";
import type { BuscaMonetizacao } from "./busca";

// Handoff Consultoria (contrato docs/design/contratos/monetizacao-handoff-consultoria.md).
// Visão geral: números grandes e palavras-chave; toda explicação mora na gaveta (`?grafico=`),
// como no Cockpit do CEO desde 28/09. A conta inteira é de src/lib/monetizacao/handoff-consultoria.ts.

const TITULO = "Handoff Consultoria";
const PERGUNTA = "Quanto a Consultoria deve à Expansão pelos clientes do onboarding?";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—");
const INT = new Intl.NumberFormat("pt-BR");
const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const brl = (v: number | null) => (v === null ? "—" : BRL.format(Math.round(v)));
/** "R$ 44,1 mil" para os números grandes; abaixo de mil, o valor inteiro. */
const brlCurto = (v: number | null) =>
  v === null
    ? "—"
    : Math.abs(v) < 1000
      ? BRL.format(Math.round(v))
      : `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
/** Eixo com passos redondos (1, 2, 2,5 ou 5 × 10ⁿ) e o topo no primeiro passo acima do máximo. */
function escalaLimpa(max: number, passos = 4) {
  if (!(max > 0)) return { domain: [0, 1] as [number, number], ticks: [0, 1] };
  const bruto = max / passos;
  const p = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / p;
  const passo = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  const topo = Math.ceil(max / passo) * passo;
  return {
    domain: [0, topo] as [number, number],
    ticks: Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo),
  };
}
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "sem registro";
const faixaCurta = (f: string) =>
  f
    .replace(/^\[ANTIGO\]\s*/i, "antigo · ")
    .replace(/Entre /g, "")
    .replace(/ milhões/g, " mi")
    .replace(/ milhão/g, " mi")
    .replace(/ mil$/, " mil")
    .replace(/ até /, " a ")
    .replace(/ e R\$ /, " a R$ ");

export function HandoffConsultoria({
  busca,
  mudarBusca,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  const { user } = useAuth();
  const ler = useServerFn(carregarHandoffConsultoria);
  const q = useQuery({
    queryKey: ["handoff-consultoria", user?.id],
    queryFn: () => ler(),
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  if (!q.data) {
    const erro = q.error as Error | null;
    return (
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
        <PageHeader titulo={TITULO} pergunta={PERGUNTA} />
        {!erro ? (
          <Carregando variante="kpis" />
        ) : /^Seu acesso não inclui/.test(erro.message) ? (
          <EstadoSemAcesso oQueFalta="view.monetizacao" />
        ) : (
          <EstadoErro
            detalhe={`Fonte: onboarding, plataforma da Consultoria e PAT. ${erro.message}`}
            tentarNovamente={() => void q.refetch()}
          />
        )}
      </main>
    );
  }
  return <PainelHandoffConsultoria bruto={q.data} busca={busca} mudarBusca={mudarBusca} />;
}

/** A tela a partir do payload do RPC: separada da leitura para a conferência visual com dado real. */
export function PainelHandoffConsultoria({
  bruto,
  busca,
  mudarBusca,
  hoje = hojeSP(),
}: {
  bruto: PainelBruto;
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  hoje?: string;
}) {
  const de = busca.de ?? INICIO_PADRAO;
  const ate = busca.ate ?? hoje;
  const [datas, setDatas] = useState({ de, ate });
  useEffect(() => setDatas({ de, ate }), [de, ate]);

  const p = montarPainel(bruto, { de: busca.de, ate: busca.ate, unidade: busca.unidade }, hoje);
  const abrir = (id: string) => mudarBusca({ grafico: id });
  const temFiltro = !!(busca.de || busca.ate || busca.unidade);
  const aplicar = () =>
    datas.de <= datas.ate &&
    mudarBusca({
      de: datas.de === INICIO_PADRAO ? undefined : datas.de,
      ate: datas.ate === hoje ? undefined : datas.ate,
    });

  const filtros = (
    <BarraFiltros
      className="items-end"
      aoLimpar={
        temFiltro
          ? () => mudarBusca({ de: undefined, ate: undefined, unidade: undefined })
          : undefined
      }
    >
      <Field label="De">
        <input
          type="date"
          className={inputClass}
          value={datas.de}
          onChange={(e) => setDatas({ ...datas, de: e.target.value })}
        />
      </Field>
      <Field label="Até">
        <input
          type="date"
          className={inputClass}
          value={datas.ate}
          onChange={(e) => setDatas({ ...datas, ate: e.target.value })}
        />
      </Field>
      <Button size="sm" variant="outline" onClick={aplicar} disabled={datas.de > datas.ate}>
        Aplicar
      </Button>
      <Field label="Unidade">
        <select
          className={inputClass}
          value={busca.unidade ?? ""}
          onChange={(e) => mudarBusca({ unidade: e.target.value || undefined })}
        >
          <option value="">Todas as unidades</option>
          {p.unidades.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </Field>
    </BarraFiltros>
  );

  const regra = p.regras;
  const acoes = (
    <button
      type="button"
      onClick={() => abrir("regra")}
      className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <StatusBadge tom={regra.proposta ? "atencao" : "neutro"}>
        {regra.proposta ? "Regra proposta" : "Regra"} · Expansão {pct(regra.expansao)} · unidade{" "}
        {pct(regra.unidade)}
      </StatusBadge>
    </button>
  );
  const procedencia = {
    fonte: "Pipefy 307173656 · plataforma da Consultoria · PAT no Financeiro",
    atualizadoEm: p.frescor.onboarding ?? p.lidoEm,
    regua: "dinheiro do mês da chegada em diante",
  };
  const semPorta = !p.porta.aberta;

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-4 md:px-6">
      <PageHeader
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao={`Onboarding Cliente da Expansão · ${ddmm(p.de)}/${p.de.slice(2, 4)} a ${ddmm(p.ate)}/${p.ate.slice(2, 4)} · ${busca.unidade ?? "todas as unidades"} · cliente (CNPJ)`}
        procedencia={procedencia}
        acoes={acoes}
      >
        {filtros}
      </PageHeader>

      {p.todos.length === 0 ? (
        <EstadoVazio
          titulo={
            busca.unidade
              ? "Nenhum cliente desta unidade no onboarding"
              : "O espelho do onboarding ainda não rodou"
          }
          descricao={
            busca.unidade
              ? undefined
              : "A sincronização do Pipefy roda a cada 30 minutos. Os números aparecem depois da primeira rodada."
          }
          total={busca.unidade ? bruto.clientes.length : undefined}
        />
      ) : (
        <>
          <section
            aria-label="Números do período"
            className="grid grid-cols-2 gap-3 lg:grid-cols-5"
          >
            <KpiCard
              rotulo="Chegaram"
              valor={INT.format(p.chegaram.length)}
              nota={`de ${INT.format(p.todos.length)} no onboarding`}
              abrir={{ onClick: () => abrir("chegaram"), rotulo: "Ver clientes" }}
            />
            <KpiCard
              rotulo="Trabalhados"
              valor={INT.format(p.trabalhados.length)}
              estado={p.atencao.plataformaSemStatus ? "parcial" : "ok"}
              nota={
                p.atencao.plataformaSemStatus
                  ? "sem status da plataforma"
                  : `de ${INT.format(p.chegaram.length)} que chegaram`
              }
              abrir={{ onClick: () => abrir("trabalhados"), rotulo: "Ver clientes" }}
            />
            <KpiCard
              rotulo="Recuperado"
              valor={brlCurto(p.dinheiro.recuperado)}
              estado={semPorta ? "sem-acesso" : p.regras.fee === null ? "nao-apurado" : "ok"}
              nota={`estimado pelo fee de ${pct(p.regras.fee)}`}
              abrir={{ onClick: () => abrir("recuperado") }}
            />
            <KpiCard
              rotulo="Receita Consultoria"
              valor={brlCurto(p.dinheiro.recebido)}
              estado={semPorta ? "sem-acesso" : "ok"}
              nota="recebido pela PAT"
              abrir={{ onClick: () => abrir("receita") }}
            />
            <KpiCard
              rotulo="A repassar à Expansão"
              valor={brlCurto(p.dinheiro.expansao)}
              estado={semPorta ? "sem-acesso" : p.regras.expansao === null ? "nao-apurado" : "ok"}
              nota={
                p.dinheiro.fora
                  ? `${brlCurto(p.dinheiro.fora)} fora da regra`
                  : `${pct(p.regras.expansao)} do recebido`
              }
              abrir={{ onClick: () => abrir("repassar"), rotulo: "Ver a conta" }}
              className="col-span-2 border-primary-text/40 lg:col-span-1"
            />
          </section>
          {semPorta && (
            <p className="text-[13px] text-muted-foreground">Valores em R$: {p.porta.motivo}</p>
          )}

          <Atencao p={p} abrir={abrir} />

          <div className="grid gap-3 xl:grid-cols-2">
            <GraficoClientes p={p} abrir={abrir} />
            <GraficoDinheiro p={p} abrir={abrir} semPorta={semPorta} />
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <Funil etapas={p.funil} p={p} abrir={abrir} />
            <Faixas p={p} abrir={abrir} />
          </div>

          <TabelaRepasse p={p} abrir={abrir} semPorta={semPorta} />
        </>
      )}

      <Gaveta id={busca.grafico ?? null} p={p} fechar={() => mudarBusca({ grafico: undefined })} />
    </main>
  );
}

// ─── O que pede atenção ──────────────────────────────────────────────────────────────────────────

function Atencao({ p, abrir }: { p: Painel; abrir: (id: string) => void }) {
  const itens: {
    id: string;
    tom: "perigo" | "atencao" | "info";
    texto: ReactNode;
    acao: string;
  }[] = [];
  if (p.atencao.encaminhadosFora.length)
    itens.push({
      id: "encaminhados-fora",
      tom: "perigo",
      texto: (
        <>
          <b className="font-semibold">
            {INT.format(p.atencao.encaminhadosFora.length)} encaminhados
          </b>{" "}
          <span className="text-muted-foreground">fora da plataforma</span>
        </>
      ),
      acao: "Ver lista",
    });
  if (p.atencao.semCnpj.length)
    itens.push({
      id: "sem-cnpj",
      tom: "atencao",
      texto: (
        <>
          <b className="font-semibold">{INT.format(p.atencao.semCnpj.length)} sem CNPJ</b>{" "}
          <span className="text-muted-foreground">no onboarding</span>
        </>
      ),
      acao: "Ver lista",
    });
  if (p.atencao.plataformaSemStatus)
    itens.push({
      id: "plataforma",
      tom: "info",
      texto: (
        <>
          <b className="font-semibold">Plataforma sem status</b>{" "}
          <span className="text-muted-foreground">trabalho, a recuperar, recuperado</span>
        </>
      ),
      acao: "O que falta",
    });
  if (!itens.length) return null;
  return (
    <section aria-labelledby="hc-atencao" className="rounded-xl border bg-card">
      <h2 id="hc-atencao" className="border-b px-4 py-3 text-base font-semibold">
        O que pede atenção
      </h2>
      <ul>
        {itens.slice(0, 3).map((i) => (
          <li key={i.id} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
            <StatusBadge tom={i.tom} className="shrink-0">
              {i.tom === "info" ? "fonte" : i.tom === "perigo" ? "agir" : "cadastro"}
            </StatusBadge>
            <span className="min-w-0 flex-1 text-sm">{i.texto}</span>
            <Button size="sm" variant="outline" onClick={() => abrir(i.id)}>
              {i.acao} →
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Mês a mês: duas escalas, dois painéis (nunca eixo duplo) ────────────────────────────────────

function Painel2({
  titulo,
  children,
  legenda,
}: {
  titulo: string;
  legenda: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{titulo}</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legenda}
        </div>
      </div>
      <div className="mt-3 h-64">{children}</div>
    </section>
  );
}
const Chave = ({ cor, texto }: { cor: string; texto: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: cor }} />
    {texto}
  </span>
);
// Recharts entrega no clique o ponto com `payload`; o tipo dele varia por versão.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mesDoClique = (d: any): string | undefined => d?.payload?.mes ?? d?.mes;

// Rótulo no topo da barra numa linha só: o do Recharts quebra o texto na largura da barra (24 px).
const rotuloTopo =
  (formatar: (v: number) => string, negrito = false) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (props: any) => {
    const texto = formatar(Number(props.value));
    if (!texto) return null;
    return (
      <text
        x={Number(props.x) + Number(props.width) / 2}
        y={Number(props.y) - 6}
        textAnchor="middle"
        className={cn("fill-foreground text-xs", negrito && "font-semibold")}
      >
        {texto}
      </text>
    );
  };

function GraficoClientes({ p, abrir }: { p: Painel; abrir: (id: string) => void }) {
  const dados = p.porMes.map((m) => ({
    mes: m.mes,
    rotulo: rotuloMes(m.mes),
    carga: m.cargaInicial,
    novos: m.chegaram.length - m.cargaInicial,
    chegaram: m.chegaram.length,
    encaminhados: m.encaminhados.length,
    trabalhados: m.trabalhados.length,
  }));
  const escala = escalaLimpa(
    Math.max(...dados.map((d) => Math.max(d.chegaram, d.encaminhados, d.trabalhados))),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clique = (d: any) => {
    const mes = mesDoClique(d);
    if (mes) abrir(`mes-${mes}`);
  };
  return (
    <Painel2
      titulo="Clientes por mês"
      legenda={
        <>
          <Chave cor={CORES_SERIE[0]} texto="Chegaram" />
          <Chave cor={COR_NEUTRA} texto="Chegaram · carga inicial" />
          <Chave cor={CORES_SERIE[1]} texto="Encaminhados" />
          <Chave cor={CORES_SERIE[2]} texto="Trabalhados" />
        </>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 18, right: 8, left: -12, bottom: 0 }} barGap={2}>
          <CartesianGrid {...gradeProps} />
          <XAxis dataKey="rotulo" {...eixoProps} />
          <YAxis allowDecimals={false} domain={escala.domain} ticks={escala.ticks} {...eixoProps} />
          <Tooltip
            {...tooltipProps}
            formatter={(v: number, nome: string) => [INT.format(v), nome]}
          />
          <Bar
            dataKey="carga"
            name="Chegaram · carga inicial"
            stackId="c"
            fill={COR_NEUTRA}
            maxBarSize={24}
            isAnimationActive={false}
            onClick={clique}
            cursor="pointer"
          />
          <Bar
            dataKey="novos"
            name="Chegaram"
            stackId="c"
            fill={CORES_SERIE[0]}
            radius={RAIO_BARRA}
            maxBarSize={24}
            isAnimationActive={false}
            onClick={clique}
            cursor="pointer"
          >
            <LabelList
              dataKey="chegaram"
              content={rotuloTopo((v: number) => (v ? INT.format(v) : ""), true)}
            />
          </Bar>
          <Bar
            dataKey="encaminhados"
            name="Encaminhados"
            fill={CORES_SERIE[1]}
            radius={RAIO_BARRA}
            maxBarSize={24}
            isAnimationActive={false}
            onClick={clique}
            cursor="pointer"
          >
            <LabelList
              dataKey="encaminhados"
              content={rotuloTopo((v: number) => (v ? INT.format(v) : ""))}
            />
          </Bar>
          <Bar
            dataKey="trabalhados"
            name="Trabalhados"
            fill={CORES_SERIE[2]}
            radius={RAIO_BARRA}
            maxBarSize={24}
            isAnimationActive={false}
            onClick={clique}
            cursor="pointer"
          >
            <LabelList
              dataKey="trabalhados"
              content={rotuloTopo((v: number) => (v ? INT.format(v) : ""))}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Painel2>
  );
}

function GraficoDinheiro({
  p,
  abrir,
  semPorta,
}: {
  p: Painel;
  abrir: (id: string) => void;
  semPorta: boolean;
}) {
  if (semPorta)
    return (
      <Painel2 titulo="Dinheiro por mês" legenda={null}>
        <EstadoSemAcesso oQueFalta="acesso ao Brain Financeiro com todas as empresas" />
      </Painel2>
    );
  const dados = p.porMes.map((m) => ({
    mes: m.mes,
    rotulo: rotuloMes(m.mes),
    recuperado: m.recuperado ?? 0,
    recebido: m.recebido ?? 0,
    repassar: m.expansao ?? 0,
  }));
  const escala = escalaLimpa(
    Math.max(...dados.map((d) => Math.max(d.recuperado, d.recebido, d.repassar))),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clique = (d: any) => {
    const mes = mesDoClique(d);
    if (mes) abrir(`mes-${mes}`);
  };
  // Só o número em mil (o eixo diz a unidade): "32,8 mil" não cabe acima de barras de 24 px no celular.
  const rotulo = (v: number) =>
    v ? (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "";
  return (
    <Painel2
      titulo="Dinheiro por mês · R$ mil"
      legenda={
        <>
          <Chave cor={CORES_SERIE[2]} texto="Recuperado (est.)" />
          <Chave cor={CORES_SERIE[1]} texto="Recebido pela PAT" />
          <Chave cor={CORES_SERIE[0]} texto="A repassar" />
        </>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 18, right: 8, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid {...gradeProps} />
          <XAxis dataKey="rotulo" {...eixoProps} />
          <YAxis
            {...eixoProps}
            domain={escala.domain}
            ticks={escala.ticks}
            tickFormatter={(v: number) => (v ? `${(v / 1000).toLocaleString("pt-BR")} mil` : "0")}
          />
          <Tooltip {...tooltipProps} formatter={(v: number, nome: string) => [brl(v), nome]} />
          <Bar
            dataKey="recuperado"
            name="Recuperado (estimado)"
            fill={CORES_SERIE[2]}
            radius={RAIO_BARRA}
            maxBarSize={24}
            isAnimationActive={false}
            onClick={clique}
            cursor="pointer"
          >
            <LabelList dataKey="recuperado" content={rotuloTopo(rotulo)} />
          </Bar>
          <Bar
            dataKey="recebido"
            name="Recebido pela PAT"
            fill={CORES_SERIE[1]}
            radius={RAIO_BARRA}
            maxBarSize={24}
            isAnimationActive={false}
            onClick={clique}
            cursor="pointer"
          >
            <LabelList dataKey="recebido" content={rotuloTopo(rotulo)} />
          </Bar>
          <Bar
            dataKey="repassar"
            name="A repassar à Expansão"
            fill={CORES_SERIE[0]}
            radius={RAIO_BARRA}
            maxBarSize={24}
            isAnimationActive={false}
            onClick={clique}
            cursor="pointer"
            minPointSize={2}
          >
            <LabelList dataKey="repassar" content={rotuloTopo(rotulo, true)} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Painel2>
  );
}

// ─── Funil cumulativo e faixa declarada ──────────────────────────────────────────────────────────

function Funil({
  etapas,
  p,
  abrir,
}: {
  etapas: EtapaFunil[];
  p: Painel;
  abrir: (id: string) => void;
}) {
  const max = Math.max(1, etapas[0]?.clientes.length ?? 0);
  return (
    <section className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Do onboarding ao repasse</h2>
        <button
          type="button"
          onClick={() => abrir("funil")}
          className="rounded-sm text-[13px] text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Como se conta
        </button>
      </div>
      <div className="mt-3 grid gap-1.5">
        {etapas.map((e) => {
          const w = (e.clientes.length / max) * 100;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => abrir(`funil-${e.id}`)}
              className="group grid grid-cols-[112px_minmax(0,1fr)_44px] sm:grid-cols-[132px_minmax(0,1fr)_48px] items-center gap-3 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-sm">{e.rotulo}</span>
              <span className="relative h-7 rounded bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded bg-[var(--chart-1)] transition-opacity group-hover:opacity-85"
                  style={{ width: `${Math.max(w, e.clientes.length ? 1 : 0)}%` }}
                />
                <span
                  className={cn(
                    "num absolute top-1/2 -translate-y-1/2 text-sm font-semibold",
                    w > 14 ? "left-2 text-[var(--viz-rotulo)]" : "text-foreground",
                  )}
                  style={w > 14 ? undefined : { left: `calc(${w}% + 8px)` }}
                >
                  {INT.format(e.clientes.length)}
                </span>
              </span>
              <span className="num text-right text-xs text-muted-foreground">
                {e.taxa === null ? "" : `${e.taxa}%`}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-auto flex flex-wrap gap-x-5 gap-y-1 border-t border-dashed pt-3 text-[13px] text-muted-foreground">
        <span>
          Recuperado{" "}
          <b className="num font-semibold text-foreground">{brlCurto(p.dinheiro.recuperado)}</b>
        </span>
        <span>
          Recebido{" "}
          <b className="num font-semibold text-foreground">{brlCurto(p.dinheiro.recebido)}</b>
        </span>
        <span>
          A repassar{" "}
          <b className="num font-semibold text-foreground">{brlCurto(p.dinheiro.expansao)}</b>
        </span>
      </div>
    </section>
  );
}

function Faixas({ p, abrir }: { p: Painel; abrir: (id: string) => void }) {
  const max = Math.max(1, ...p.faixas.map((f) => f.noOnboarding.length));
  return (
    <section className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Faixa de faturamento declarada</h2>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <Chave cor={CORES_SERIE[0]} texto="Chegaram" />
          <Chave cor="var(--muted)" texto="No onboarding" />
        </div>
      </div>
      <div className="mt-3 grid gap-1">
        {p.faixas.map((f) => (
          <button
            key={f.faixa}
            type="button"
            onClick={() => abrir(`faixa-${f.ordem}`)}
            className="group grid grid-cols-[112px_minmax(0,1fr)_64px] sm:grid-cols-[172px_minmax(0,1fr)_72px] items-center gap-3 rounded-md py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate text-xs text-muted-foreground" title={f.faixa}>
              {faixaCurta(f.faixa)}
            </span>
            <span className="relative h-4">
              <span
                className="absolute inset-y-0 left-0 rounded-r bg-muted"
                style={{ width: `${(f.noOnboarding.length / max) * 100}%` }}
              />
              <span
                className="absolute inset-y-0 left-0 rounded-r bg-[var(--chart-1)] group-hover:opacity-85"
                style={{ width: `${(f.chegaram.length / max) * 100}%` }}
              />
            </span>
            <span className="num text-right text-xs">
              <b className="font-semibold">{INT.format(f.chegaram.length)}</b>{" "}
              <span className="text-muted-foreground">de {INT.format(f.noOnboarding.length)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ─── A repassar por mês ──────────────────────────────────────────────────────────────────────────

function TabelaRepasse({
  p,
  abrir,
  semPorta,
}: {
  p: Painel;
  abrir: (id: string) => void;
  semPorta: boolean;
}) {
  const r = p.regras;
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">A repassar por mês</h2>
        <button
          type="button"
          onClick={() => abrir("regra")}
          className="rounded-sm text-[13px] text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Regra
        </button>
      </div>
      {semPorta ? (
        <EstadoSemAcesso
          className="mt-3"
          oQueFalta="acesso ao Brain Financeiro com todas as empresas"
        />
      ) : (
        <div className="mt-2 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Chegaram</TableHead>
                <TableHead className="text-right">Recebido pela PAT</TableHead>
                <TableHead className="text-right">Fora da regra</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">Expansão {pct(r.expansao)}</TableHead>
                <TableHead className="text-right">dos quais unidade {pct(r.unidade)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.porMes.map((m) => (
                <TableRow
                  key={m.mes}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => abrir(`mes-${m.mes}`)}
                  onKeyDown={(e) =>
                    (e.key === "Enter" || e.key === " ") &&
                    (e.preventDefault(), abrir(`mes-${m.mes}`))
                  }
                >
                  <TableCell>{rotuloMes(m.mes)}</TableCell>
                  <TableCell className="num text-right">{INT.format(m.chegaram.length)}</TableCell>
                  <TableCell className="num text-right">{brl(m.recebido)}</TableCell>
                  <TableCell className="num text-right text-muted-foreground">
                    {m.fora ? brl(m.fora) : "—"}
                  </TableCell>
                  <TableCell className="num text-right">{brl(m.base)}</TableCell>
                  <TableCell className="num text-right font-semibold text-primary-text">
                    {brl(m.expansao)}
                  </TableCell>
                  <TableCell className="num text-right">{brl(m.unidade)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="num text-right">{INT.format(p.chegaram.length)}</TableCell>
                <TableCell className="num text-right">{brl(p.dinheiro.recebido)}</TableCell>
                <TableCell className="num text-right">
                  {p.dinheiro.fora ? brl(p.dinheiro.fora) : "—"}
                </TableCell>
                <TableCell className="num text-right">{brl(p.dinheiro.base)}</TableCell>
                <TableCell className="num text-right text-primary-text">
                  {brl(p.dinheiro.expansao)}
                </TableCell>
                <TableCell className="num text-right">{brl(p.dinheiro.unidade)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </section>
  );
}

// ─── Gaveta: a explicação e os registros de cada número (N2, N3) ─────────────────────────────────

type ConteudoGaveta = {
  titulo: string;
  valor?: string;
  oQueDiz: ReactNode;
  comoCalcula: ReactNode;
  atencao?: ReactNode;
  clientes?: Cliente[];
  extra?: ReactNode;
};

function situacao(c: Cliente) {
  if (c.jaPagavaPat)
    return (
      <StatusBadge tom="atencao" icone={false}>
        já pagava a PAT
      </StatusBadge>
    );
  if (c.naBase)
    return (
      <StatusBadge tom="sucesso" icone={false}>
        na base do repasse
      </StatusBadge>
    );
  if (c.trabalhado)
    return (
      <StatusBadge tom="info" icone={false}>
        trabalhado
      </StatusBadge>
    );
  if (c.chegada)
    return (
      <StatusBadge tom="neutro" icone={false}>
        na plataforma
      </StatusBadge>
    );
  if (c.encaminhado)
    return (
      <StatusBadge tom="perigo" icone={false}>
        encaminhado, fora
      </StatusBadge>
    );
  return (
    <StatusBadge tom="neutro" icone={false}>
      no onboarding
    </StatusBadge>
  );
}

function ListaClientes({ clientes, meses }: { clientes: Cliente[]; meses?: string[] }) {
  if (!clientes.length)
    return <p className="text-sm text-muted-foreground">Nenhum cliente neste recorte.</p>;
  const recebido = (c: Cliente) =>
    meses ? meses.reduce((s, m) => s + (c.porMes[m]?.recebido ?? 0), 0) : c.recebido;
  const ordem = [...clientes].sort(
    (a, b) =>
      recebido(b) - recebido(a) ||
      (b.chegada ?? "").localeCompare(a.chegada ?? "") ||
      a.titulo.localeCompare(b.titulo),
  );
  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Cliente</TableHead>
            <TableHead className="text-xs">Unidade</TableHead>
            <TableHead className="text-xs">Chegou</TableHead>
            <TableHead className="text-right text-xs">Recebido</TableHead>
            <TableHead className="text-xs">Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordem.map((c) => (
            <TableRow key={c.chave}>
              <TableCell className="text-xs">
                <a
                  href={`https://app.pipefy.com/open-cards/${c.card}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary-text hover:underline"
                >
                  {c.titulo}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
                <span className="block text-muted-foreground">{faixaCurta(c.faixa)}</span>
              </TableCell>
              <TableCell className="text-xs">{c.unidade}</TableCell>
              <TableCell className="text-xs">
                {ddmm(c.chegada)}
                {c.cargaInicial && (
                  <span className="block text-muted-foreground">carga inicial</span>
                )}
              </TableCell>
              <TableCell className="num text-right text-xs">
                {recebido(c) ? brl(recebido(c)) : "—"}
              </TableCell>
              <TableCell className="text-xs">{situacao(c)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function conteudo(id: string, p: Painel): ConteudoGaveta | null {
  const r = p.regras;
  const regraTexto = `Base = o que a PAT recebeu desses clientes, do mês da chegada em diante${r.excluiPrevio ? ", sem os clientes que a PAT já faturava antes da chegada" : ""}. Repasse à Expansão = base × ${pct(r.expansao)}; dentro dele, a unidade que vendeu fica com ${pct(r.unidade)} da base.`;
  if (id === "chegaram")
    return {
      titulo: "Chegaram à Consultoria",
      valor: INT.format(p.chegaram.length),
      oQueDiz:
        "Clientes do onboarding da Expansão cadastrados na plataforma da Consultoria no período.",
      comoCalcula:
        "O CNPJ do card (pelo contrato, pela Data Base de empresas ou pelo negócio do Pipedrive) encontrado na plataforma, pelo CNPJ ou pela raiz. O mês é o dia do cadastro. O cadastro de 26/07 é a carga inicial da plataforma; desde 24/08 ele acontece no dia do kickoff.",
      clientes: p.chegaram,
    };
  if (id === "trabalhados" || id === "funil-trabalhados")
    return {
      titulo: "Trabalhados",
      valor: INT.format(id === "trabalhados" ? p.trabalhados.length : p.funil[2].clientes.length),
      oQueDiz: "Clientes que já têm sinal de trabalho da Consultoria.",
      comoCalcula:
        "Proposta da Consultoria casada pelo CNPJ, valor a recuperar informado pela plataforma ou receita da PAT depois da chegada.",
      atencao: p.atencao.plataformaSemStatus
        ? "Parcial: a plataforma ainda não envia o status do trabalho nem o valor a recuperar."
        : undefined,
      clientes: id === "trabalhados" ? p.trabalhados : p.funil[2].clientes,
    };
  if (id === "recuperado")
    return {
      titulo: "Recuperado (estimado)",
      valor: brl(p.dinheiro.recuperado),
      oQueDiz:
        "Crédito recuperado para o cliente, estimado pelo que a PAT faturou de créditos tributários.",
      comoCalcula: `Créditos tributários faturados pela PAT (competência) do mês da chegada em diante ÷ fee de ${pct(r.fee)}.`,
      atencao: "O fee está em aberto no forecast. O valor real virá da plataforma da Consultoria.",
      clientes: p.todos.filter((c) => c.creditos > 0),
    };
  if (id === "receita" || id === "funil-receita")
    return {
      titulo: "Receita da Consultoria",
      valor: brl(p.dinheiro.recebido),
      oQueDiz: "O que a PAT recebeu desses clientes depois da chegada.",
      comoCalcula:
        "Títulos da PAT recebidos no caixa (valor pago, líquido de retenções), pela data de crédito, do mês da chegada em diante. O cliente do lançamento é casado pelo cadastro do Omie.",
      clientes: id === "receita" ? p.todos.filter((c) => c.recebido > 0) : p.funil[3].clientes,
    };
  if (id === "repassar" || id === "regra" || id === "funil-repasse")
    return {
      titulo: "A repassar à Expansão",
      valor: brl(p.dinheiro.expansao),
      oQueDiz: `${pct(r.expansao)} do que a PAT recebe dos clientes que chegaram pelo onboarding.`,
      comoCalcula: regraTexto,
      atencao: r.proposta
        ? "Regra proposta em 02/10, aguardando confirmação. Ela mora na tabela ops.handoff_consultoria_regras e muda sem código."
        : undefined,
      extra: (
        <div className="space-y-2">
          <ul className="space-y-1 text-[13px]">
            {r.lista.map((x) => (
              <li key={x.chave} className="flex items-start gap-2">
                <StatusBadge
                  tom={x.situacao === "proposta" ? "atencao" : "sucesso"}
                  icone={false}
                  className="shrink-0"
                >
                  {x.situacao}
                </StatusBadge>
                <span className="text-muted-foreground">{x.origem}</span>
              </li>
            ))}
          </ul>
          {p.porUnidade.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Unidade</TableHead>
                  <TableHead className="text-right text-xs">Base</TableHead>
                  <TableHead className="text-right text-xs">Expansão</TableHead>
                  <TableHead className="text-right text-xs">Unidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.porUnidade.map((u) => (
                  <TableRow key={u.unidade}>
                    <TableCell className="text-xs">{u.unidade}</TableCell>
                    <TableCell className="num text-right text-xs">{brl(u.base)}</TableCell>
                    <TableCell className="num text-right text-xs">{brl(u.expansao)}</TableCell>
                    <TableCell className="num text-right text-xs">{brl(u.unidade_)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ),
      clientes: p.todos.filter((c) => c.recebido > 0),
    };
  if (id === "encaminhados-fora")
    return {
      titulo: "Encaminhados fora da plataforma",
      valor: INT.format(p.atencao.encaminhadosFora.length),
      oQueDiz:
        "Kickoff com “Será encaminhado para Consultoria Tributária? Sim” e o CNPJ ainda não cadastrado na plataforma.",
      comoCalcula:
        "Campo da fase de kickoff do onboarding (existe desde 16/09) contra o cadastro da plataforma, pelo CNPJ ou pela raiz.",
      atencao:
        "O pipe “Enviar para Consultoria Tributária” recebe um card quando o cliente vai para Setup técnico com Sim; quem cadastra é a Consultoria.",
      clientes: p.atencao.encaminhadosFora,
    };
  if (id === "sem-cnpj")
    return {
      titulo: "Sem CNPJ",
      valor: INT.format(p.atencao.semCnpj.length),
      oQueDiz: "Cards sem nenhum caminho até o CNPJ: não dá para saber se chegaram à Consultoria.",
      comoCalcula:
        "Sem card de contrato com CNPJ, sem empresa da Data Base com CNPJ e sem CNPJ no negócio ou na organização do Pipedrive.",
      atencao: "Ligar o card ao contrato ou à empresa no Pipefy resolve na próxima sincronização.",
      clientes: p.atencao.semCnpj,
    };
  if (id === "plataforma")
    return {
      titulo: "O que falta da plataforma",
      oQueDiz: "A API da Consultoria ainda não envia o que fecha a conta por cliente.",
      comoCalcula:
        "Faltam o status do trabalho, o valor a recuperar apurado e o valor efetivamente recuperado, com as datas. As colunas já existem no Brain e enchem sozinhas quando a API mandar.",
    };
  if (id === "funil")
    return {
      titulo: "Do onboarding ao repasse",
      oQueDiz: "O pipe inteiro, a mesma coorte em todas as etapas: cada etapa é parte da de cima.",
      comoCalcula:
        "Taxa = etapa ÷ etapa de cima. As contagens só descem. O funil não segue o período; segue a unidade.",
    };
  if (id.startsWith("funil-")) {
    const e = p.funil.find((x) => `funil-${x.id}` === id);
    if (!e) return null;
    return {
      titulo: e.rotulo,
      valor: INT.format(e.clientes.length),
      oQueDiz: "Clientes do onboarding nesta etapa ou além.",
      comoCalcula:
        e.taxa === null
          ? "Todos os clientes do pipe de onboarding."
          : `${e.taxa}% da etapa de cima.`,
      clientes: e.clientes,
    };
  }
  if (id.startsWith("faixa-")) {
    const f = p.faixas.find((x) => `faixa-${x.ordem}` === id);
    if (!f) return null;
    return {
      titulo: `Faixa ${faixaCurta(f.faixa)}`,
      valor: `${INT.format(f.chegaram.length)} de ${INT.format(f.noOnboarding.length)}`,
      oQueDiz:
        "Clientes desta faixa que chegaram à Consultoria no período, de todos os desta faixa no onboarding.",
      comoCalcula:
        "Faixa declarada no campo “Faturamento anual” do negócio ganho do Pipedrive; sem ele, o mesmo rótulo no card de onboarding. Nunca a estimativa da DataStone.",
      clientes: f.noOnboarding,
    };
  }
  if (id.startsWith("mes-")) {
    const m = p.porMes.find((x) => `mes-${x.mes}` === id);
    if (!m) return null;
    const mesmos = new Set([
      ...m.chegaram,
      ...m.encaminhados,
      ...m.trabalhados,
      ...p.todos.filter((c) => (c.porMes[m.mes]?.recebido ?? 0) > 0),
    ]);
    return {
      titulo: rotuloMes(m.mes),
      valor: brl(m.expansao),
      oQueDiz: "O mês: quem chegou, foi encaminhado ou trabalhado, e o dinheiro recebido.",
      comoCalcula: `Chegaram ${m.chegaram.length}${m.cargaInicial ? ` (${m.cargaInicial} da carga inicial)` : ""} · encaminhados ${m.encaminhados.length} · trabalhados ${m.trabalhados.length} · recebido ${brl(m.recebido)} · fora da regra ${brl(m.fora)} · a repassar ${brl(m.expansao)}.`,
      clientes: [...mesmos],
    };
  }
  return null;
}

function Gaveta({ id, p, fechar }: { id: string | null; p: Painel; fechar: () => void }) {
  const c = id ? conteudo(id, p) : null;
  const meses = id?.startsWith("mes-") ? [id.slice(4)] : undefined;
  return (
    <Sheet open={!!c} onOpenChange={(v) => (!v ? fechar() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {c && (
          <>
            <SheetHeader>
              <SheetTitle>{c.titulo}</SheetTitle>
              <SheetDescription>
                Pipefy 307173656 · plataforma da Consultoria · PAT no Financeiro · lido em{" "}
                {quando(p.lidoEm)}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-5">
              {c.valor && <p className="num text-3xl font-semibold">{c.valor}</p>}
              <Parte titulo="O que diz">{c.oQueDiz}</Parte>
              <Parte titulo="Como se calcula">{c.comoCalcula}</Parte>
              {c.atencao && <Parte titulo="Atenção">{c.atencao}</Parte>}
              <Parte titulo="Fonte e frescor">
                Onboarding {quando(p.frescor.onboarding)} · plataforma{" "}
                {quando(p.frescor.consultoria)} · Financeiro{" "}
                {quando(p.frescor.financeiro_carregado_em)}
              </Parte>
              <Parte titulo="Dono">Pedro Luca (Monetização)</Parte>
              {c.extra}
              {c.clientes && (
                <Parte titulo={`Os clientes (${INT.format(c.clientes.length)})`}>
                  <ListaClientes clientes={c.clientes} meses={meses} />
                </Parte>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Parte({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h3>
      <div className="text-sm">{children}</div>
    </section>
  );
}
