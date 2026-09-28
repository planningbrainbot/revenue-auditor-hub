import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { KpiCard, KpiGrade, Secao, StatusBadge } from "@/components/planning";
import type { Destino, Frente } from "@/lib/cockpit-ceo/contrato";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";
import { perguntasDaFrente, situacaoDaPergunta } from "@/lib/cockpit-ceo/perguntas";
import {
  CORES_COCKPIT,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { BotaoDestino } from "./composicao";
import { CartaoFrente } from "./frente-cartao";
import { Bloco } from "./graficos";
import { ClientesAtivos } from "./clientes-ativos";
import { CoortesRetencao } from "./coortes";
import {
  AquisicaoPainel,
  CadeiaPainel,
  CaixaPainel,
  FrescorPainel,
  MargemPainel,
  MetasUnidade,
  OnboardingPainel,
  PilaresPainel,
  PipelinePainel,
  PonteMensal,
  SemPainel,
} from "./empresa";
import { ExportarEvidencias } from "./exportar-evidencias";
import { cartaoDoIndicador } from "./indicador";
import { RedeUnidades } from "./rede-unidades";
import { Trajetoria } from "./trajetoria";

// A vista de uma frente do cockpit (`?frente=`), item próprio da lateral (N6). Mostra os números
// da frente, os painéis que respondem às perguntas dela e a lista de perguntas com o estado de
// cada uma (dado, implementação, homologação, decisão), a fonte, o responsável e o que falta.

function GraficoDiario({ serie }: { serie: NonNullable<Cockpit["serieDiaria"]> }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={serie} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid {...gradeProps} />
          <XAxis dataKey="label" {...eixoProps} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} {...eixoProps} />
          <Tooltip {...tooltipProps} />
          <Legend {...legendaProps} />
          <Bar
            isAnimationActive={false}
            dataKey="started"
            name="Leads trabalhados"
            fill={CORES_COCKPIT.realizado}
          />
          <Bar
            isAnimationActive={false}
            dataKey="scheduled"
            name="Reuniões marcadas"
            fill={CORES_COCKPIT.terceira}
          />
          <Bar
            isAnimationActive={false}
            dataKey="meeting"
            name="Reuniões realizadas"
            fill={CORES_COCKPIT.meta}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const DESTINO_PRODUTOS: Destino = {
  rota: "/clientes",
  search: { view: "produtos" },
  rotulo: "Abrir Produtos e listas",
  mesmoRecorte: false,
  observacao: "Produtos e listas mostra as contas por produto, sem o período do cockpit.",
};

function DemandaPorProduto({ cockpit, preview }: { cockpit: Cockpit; preview: boolean }) {
  const produtos = cockpit.porProduto.filter((l) => l.produto !== "sem_produto");
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <BotaoDestino destino={DESTINO_PRODUTOS} preview={preview} compacto />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={produtos}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
          >
            <CartesianGrid {...gradeProps} horizontal={false} vertical />
            <XAxis type="number" allowDecimals={false} {...eixoProps} />
            <YAxis type="category" dataKey="rotulo" width={96} {...eixoProps} />
            <Tooltip {...tooltipProps} />
            <Legend {...legendaProps} />
            <Bar
              isAnimationActive={false}
              dataKey="validadas"
              name="Oportunidades validadas"
              fill={CORES_COCKPIT.realizado}
            />
            <Bar
              isAnimationActive={false}
              dataKey="ganhos"
              name="Contratos ganhos"
              fill={CORES_COCKPIT.terceira}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * As perguntas da frente, uma linha cada: situação, id e texto. Resposta, fonte, responsável, o que
 * falta e os estados vão para a gaveta, que o clique na linha abre.
 */
function ListaPerguntas({
  frente,
  onAbrirGrafico,
}: {
  frente: Frente;
  onAbrirGrafico: (id: string) => void;
}) {
  const perguntas = perguntasDaFrente(frente);
  return (
    <Secao titulo="Quais perguntas esta frente responde?">
      <ul className="divide-y rounded-xl border bg-card">
        {perguntas.map((p) => {
          const s = situacaoDaPergunta(p);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onAbrirGrafico(`pergunta-${p.id}`)}
                className="flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <StatusBadge
                  tom={s === "respondida" ? "sucesso" : s === "parcial" ? "atencao" : "neutro"}
                >
                  {s === "respondida" ? "Respondida" : s === "parcial" ? "Parcial" : "Lacuna"}
                </StatusBadge>
                <span className="num shrink-0 text-muted-foreground">{p.id}</span>
                <span className="min-w-0 truncate">{p.texto}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}

/** Painel de uma frente: título de uma linha; a descrição mora na gaveta (`painel-<id>`). */
function Painel({
  id,
  titulo,
  children,
  abrir,
}: {
  id: string;
  titulo: string;
  children: ReactNode;
  abrir: (id: string) => void;
}) {
  return (
    <Bloco titulo={titulo} abrir={() => abrir(`painel-${id}`)}>
      {children}
    </Bloco>
  );
}

export function VistaFrente({
  cockpit,
  frente,
  onAbrirIndicador,
  onAbrirGrafico,
  preview,
  hoje,
}: {
  cockpit: Cockpit;
  frente: Frente;
  onAbrirIndicador: (id: string) => void;
  onAbrirGrafico: (id: string) => void;
  preview: boolean;
  hoje: string;
  irParaFrente: (f: Frente) => void;
}) {
  const numeros = cockpit.indicadores.filter((i) => i.frente === frente);
  const e = cockpit.empresa;
  const ab = onAbrirGrafico;
  return (
    <>
      <CartaoFrente cockpit={cockpit} frente={frente} abrir={() => ab(`frente-${frente}`)} />
      {numeros.length > 0 && (
        <KpiGrade colunas={numeros.length >= 4 ? 6 : 3}>
          {numeros.map((i) => (
            <KpiCard key={i.id} {...cartaoDoIndicador(i, () => onAbrirIndicador(i.id))} />
          ))}
        </KpiGrade>
      )}

      {frente === "receita" && (
        <>
          {(cockpit.trajetoria || cockpit.trajetoriaAviso) && (
            <Painel id="leituras" titulo="Quanto falta em cada leitura da meta?" abrir={ab}>
              <Trajetoria
                trajetoria={cockpit.trajetoria}
                aviso={cockpit.trajetoriaAviso}
                preview={preview}
              />
            </Painel>
          )}
          <Painel
            id="ponte-mensal"
            titulo="Como o faturamento do grupo se moveu mês a mês?"
            abrir={ab}
          >
            {e.ponte && e.ponte.dado.meses.length ? (
              <PonteMensal ponte={e.ponte.dado} />
            ) : (
              <SemPainel texto={e.ponteAviso ?? "Ponte não disponível."} />
            )}
          </Painel>
          <Painel id="previsao" titulo="Qual previsão sustenta os próximos meses?" abrir={ab}>
            <PipelinePainel empresa={e} />
          </Painel>
        </>
      )}

      {frente === "comercial" && (
        <>
          <Painel id="aquisicao" titulo="A aquisição cumpre o plano?" abrir={ab}>
            <AquisicaoPainel empresa={e} />
          </Painel>
          <Painel id="previsao" titulo="O que está em aberto no pipeline?" abrir={ab}>
            <PipelinePainel empresa={e} />
          </Painel>
        </>
      )}

      {frente === "clientes" && (cockpit.clientes || cockpit.clientesAviso) && (
        <Painel id="clientes" titulo="Quantos clientes ativos temos, em cada definição?" abrir={ab}>
          <ClientesAtivos clientes={cockpit.clientes} aviso={cockpit.clientesAviso} />
        </Painel>
      )}

      {frente === "retencao" && (
        <>
          {(cockpit.coortes || cockpit.coortesAviso) && (
            <Painel id="coortes" titulo="Quem permanece depois do ganho, por coorte?" abrir={ab}>
              <CoortesRetencao coortes={cockpit.coortes} aviso={cockpit.coortesAviso} />
            </Painel>
          )}
          <Painel id="ponte-mensal" titulo="A base existente expande ou encolhe?" abrir={ab}>
            {e.ponte && e.ponte.dado.meses.length ? (
              <PonteMensal ponte={e.ponte.dado} />
            ) : (
              <SemPainel texto={e.ponteAviso ?? "Ponte não disponível."} />
            )}
          </Painel>
        </>
      )}

      {frente === "operacao" && (
        <>
          <Painel id="onboarding" titulo="Conseguimos ativar o que vendemos?" abrir={ab}>
            <OnboardingPainel empresa={e} />
          </Painel>
          <Painel id="cadeia" titulo="A venda chega até o faturamento e fica?" abrir={ab}>
            <CadeiaPainel empresa={e} />
          </Painel>
          <Painel id="capacidade" titulo="A entrega comporta crescer?" abrir={ab}>
            <SemPainel texto="Sem fonte registrada para horas, SLA e capacidade" />
          </Painel>
        </>
      )}

      {frente === "rede" && (
        <>
          {(cockpit.rede || cockpit.trajetoriaAviso) && (
            <Painel id="rede-unidades" titulo="Quanto cada unidade fatura e repassa?" abrir={ab}>
              <RedeUnidades rede={cockpit.rede} aviso={cockpit.trajetoriaAviso} />
            </Painel>
          )}
          <Painel
            id="metas"
            titulo="Quais unidades cumprem a meta de venda do trimestre?"
            abrir={ab}
          >
            <MetasUnidade empresa={e} hoje={hoje} />
          </Painel>
        </>
      )}

      {frente === "portfolio" && (
        <>
          <Painel id="demanda" titulo="Em qual produto está a demanda da monetização?" abrir={ab}>
            <DemandaPorProduto cockpit={cockpit} preview={preview} />
          </Painel>
          {cockpit.serieDiaria && (
            <Painel id="diario" titulo="Quantos eventos comerciais por dia?" abrir={ab}>
              <GraficoDiario serie={cockpit.serieDiaria} />
            </Painel>
          )}
        </>
      )}

      {frente === "caixa" && (
        <>
          <Painel id="caixa" titulo="O faturamento vira caixa?" abrir={ab}>
            <CaixaPainel empresa={e} />
          </Painel>
          <Painel id="margem" titulo="Com que margem, e em qual grupo de empresas?" abrir={ab}>
            <MargemPainel empresa={e} />
          </Painel>
        </>
      )}

      {frente === "capital" && (
        <>
          <Painel id="frescor" titulo="As fontes estão em dia?" abrir={ab}>
            <FrescorPainel frescor={e.frescor} />
          </Painel>
          <Painel id="pilares" titulo="O que já conseguimos demonstrar?" abrir={ab}>
            <PilaresPainel />
          </Painel>
          <ExportarEvidencias cockpit={cockpit} />
        </>
      )}

      <ListaPerguntas frente={frente} onAbrirGrafico={ab} />
    </>
  );
}
