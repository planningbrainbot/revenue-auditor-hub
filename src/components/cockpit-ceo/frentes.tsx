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
import { formatarValor } from "@/lib/cockpit-ceo/contrato";
import type { Destino, Frente } from "@/lib/cockpit-ceo/contrato";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";
import { PILARES, perguntasDaFrente, situacaoDaPergunta } from "@/lib/cockpit-ceo/perguntas";
import type { EstadosPergunta, PerguntaCatalogo } from "@/lib/cockpit-ceo/perguntas";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { BotaoDestino } from "./composicao";
import { EstadoBadge } from "./estado";
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
    <Secao
      titulo="Quantos eventos comerciais da monetização aconteceram por dia?"
      descricao="Negócios do pipe de Monetização, por dia do período. Eventos, não coorte."
    >
      <div className="h-64 rounded-xl border bg-card p-4">
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
              fill={CORES_SERIE[0]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="scheduled"
              name="Reuniões marcadas"
              fill={CORES_SERIE[1]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="meeting"
              name="Reuniões realizadas"
              fill={CORES_SERIE[2]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Secao>
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
    <Secao
      titulo="Em qual produto está a demanda da monetização?"
      descricao="Negócios do pipe de Monetização no período. Demanda, não faturamento."
      acoes={<BotaoDestino destino={DESTINO_PRODUTOS} preview={preview} compacto />}
    >
      <div className="h-56 rounded-xl border bg-card p-4">
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
              fill={CORES_SERIE[0]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="ganhos"
              name="Contratos ganhos"
              fill={CORES_SERIE[1]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Secao>
  );
}

const ROTULO_DADO: Record<EstadosPergunta["dado"], string> = {
  integrado: "dado integrado",
  parcial: "dado parcial",
  sem_acesso: "dado existe, ninguém lê",
  falha_sync: "sincronização parada",
  sem_campo: "falta campo ou vínculo",
  ausente: "dado não existe",
};
const ROTULO_IMPL: Record<EstadosPergunta["implementacao"], string> = {
  no_ar: "no ar",
  nesta_versao: "nesta versão (não publicada)",
  nao_iniciada: "não implementada",
};
const ROTULO_HOMOL: Record<EstadosPergunta["homologacao"], string> = {
  conferida: "conferida com SQL",
  pendente: "homologação pendente",
  nao_se_aplica: "sem cálculo para homologar",
};
const ROTULO_ORIGEM: Record<PerguntaCatalogo["origem"], string> = {
  mapa: "Mapa de investidores",
  prd: "PRD 22/09",
  desdobramento: "Desdobramento 23/09",
};

function ListaPerguntas({
  cockpit,
  frente,
  onAbrirIndicador,
}: {
  cockpit: Cockpit;
  frente: Frente;
  onAbrirIndicador: (id: string) => void;
}) {
  const perguntas = perguntasDaFrente(frente);
  const cont = (s: string) => perguntas.filter((p) => situacaoDaPergunta(p) === s).length;
  return (
    <Secao
      titulo="Quais perguntas esta frente responde?"
      descricao={`${cont("respondida")} respondidas, ${cont("parcial")} parciais e ${cont("lacuna")} lacunas. Cada uma diz o que responde hoje, com qual fonte e o que falta.`}
    >
      <ul className="divide-y rounded-xl border bg-card">
        {perguntas.map((p) => {
          const s = situacaoDaPergunta(p);
          return (
            <li key={p.id} className="grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  <span className="num mr-2 text-muted-foreground">{p.id}</span>
                  {p.texto}
                </p>
                <p className="text-sm">{p.resposta}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="text-foreground">Fonte:</span> {p.fonte}
                </p>
                <p className="text-sm text-muted-foreground">
                  <span className="text-foreground">Responsável:</span> {p.responsavel}
                  {p.pendencia && (
                    <>
                      {" · "}
                      <span className="text-foreground">Falta:</span> {p.pendencia}
                    </>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  <span className="text-foreground">Growth:</span> {p.growth}{" "}
                  <span className="text-foreground">Ops:</span> {p.ops}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ROTULO_DADO[p.estados.dado]} · {ROTULO_IMPL[p.estados.implementacao]} ·{" "}
                  {ROTULO_HOMOL[p.estados.homologacao]} · adoção não medida
                  {p.estados.decisao ? ` · decisão pendente: ${p.estados.decisao}` : ""}
                </p>
                {p.indicadores.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {p.indicadores.map((id) => {
                      const i = cockpit.indicadores.find((x) => x.id === id);
                      if (!i) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onAbrirIndicador(id)}
                          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {i.titulo}: <strong className="num">{formatarValor(i)}</strong>
                          {i.estado !== "disponivel" && <EstadoBadge estado={i.estado} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-start gap-1.5 md:max-w-56 md:justify-end">
                <StatusBadge
                  tom={s === "respondida" ? "sucesso" : s === "parcial" ? "atencao" : "neutro"}
                >
                  {s === "respondida" ? "Respondida" : s === "parcial" ? "Parcial" : "Lacuna"}
                </StatusBadge>
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  Pilar {PILARES[p.pilar].n} · {PILARES[p.pilar].titulo}
                </span>
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {ROTULO_ORIGEM[p.origem]}
                  {p.exigencia ? ` · exigência ${p.exigencia}` : ""}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}

function Painel({
  titulo,
  descricao,
  children,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <Secao titulo={titulo} descricao={descricao} acoes={acoes}>
      {children}
    </Secao>
  );
}

export function VistaFrente({
  cockpit,
  frente,
  onAbrirIndicador,
  preview,
  hoje,
}: {
  cockpit: Cockpit;
  frente: Frente;
  onAbrirIndicador: (id: string) => void;
  preview: boolean;
  hoje: string;
  irParaFrente: (f: Frente) => void;
}) {
  const numeros = cockpit.indicadores.filter((i) => i.frente === frente);
  const e = cockpit.empresa;
  return (
    <>
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
            <Trajetoria
              trajetoria={cockpit.trajetoria}
              aviso={cockpit.trajetoriaAviso}
              preview={preview}
            />
          )}
          <Painel
            titulo="Como o faturamento do grupo se moveu mês a mês?"
            descricao="Ponte por cliente, régua de emissão. Acima de zero entrou; abaixo saiu. Cada mês fecha em centavos com o Faturamento."
          >
            {e.ponte && e.ponte.dado.meses.length ? (
              <PonteMensal ponte={e.ponte.dado} />
            ) : (
              <SemPainel texto={e.ponteAviso ?? "Ponte não disponível."} />
            )}
          </Painel>
          <Painel
            titulo="Qual previsão sustenta os próximos meses?"
            descricao="Camadas separadas, nunca somadas. Não existe previsão empresarial de faturamento: é lacuna com dono (CFO + RevOps)."
          >
            <PipelinePainel empresa={e} />
          </Painel>
        </>
      )}

      {frente === "comercial" && (
        <>
          <Painel
            titulo="A aquisição cumpre o plano?"
            descricao="Inside Sales: MRR novo vendido contra o plano do Growth, funil do último mês fechado e forecast do mês pelo modelo do Growth."
          >
            <AquisicaoPainel empresa={e} />
          </Painel>
          <Painel
            titulo="O que está em aberto no pipeline?"
            descricao="Negócios abertos do Inside Sales por mês de fechamento esperado, sem ponderação."
          >
            <PipelinePainel empresa={e} />
          </Painel>
        </>
      )}

      {frente === "clientes" && (cockpit.clientes || cockpit.clientesAviso) && (
        <ClientesAtivos clientes={cockpit.clientes} aviso={cockpit.clientesAviso} />
      )}

      {frente === "retencao" && (
        <>
          {(cockpit.coortes || cockpit.coortesAviso) && (
            <CoortesRetencao coortes={cockpit.coortes} aviso={cockpit.coortesAviso} />
          )}
          <Painel
            titulo="A base existente expande ou encolhe?"
            descricao="Da ponte do faturamento: expansão, contração e clientes sem faturamento no mês. Régua de emissão, não churn contratual."
          >
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
          <Painel
            titulo="Conseguimos ativar o que vendemos?"
            descricao="Pipe de Onboarding por fase e idade na fase atual."
          >
            <OnboardingPainel empresa={e} />
          </Painel>
          <Painel
            titulo="A venda chega até o faturamento e fica?"
            descricao="A mesma safra de contratos em cada elo, ligada só por chave: empresa, CNPJ e nome normalizado único."
          >
            <CadeiaPainel empresa={e} />
          </Painel>
          <Painel
            titulo="A entrega comporta crescer?"
            descricao="Capacidade da equipe, horas, SLA e retrabalho."
          >
            <SemPainel texto="Sem fonte: horas, SLA, retrabalho e capacidade por equipe não são registrados, e a tabela de headcount mensal está vazia. A fila de onboarding acima é o único sinal de capacidade. Dono: Operações." />
          </Painel>
        </>
      )}

      {frente === "rede" && (
        <>
          {(cockpit.rede || cockpit.trajetoriaAviso) && (
            <RedeUnidades rede={cockpit.rede} aviso={cockpit.trajetoriaAviso} />
          )}
          <Painel
            titulo="Quais unidades cumprem a meta de venda do trimestre?"
            descricao="Meta e vendido por unidade, do Growth (growth.dist_metas)."
          >
            <MetasUnidade empresa={e} hoje={hoje} />
          </Painel>
        </>
      )}

      {frente === "portfolio" && (
        <>
          <DemandaPorProduto cockpit={cockpit} preview={preview} />
          {cockpit.serieDiaria && <GraficoDiario serie={cockpit.serieDiaria} />}
          <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
            Receita realizada por vertical não é separável hoje: o Financeiro não classifica receita
            por produto, e a PARTNERS está sem carga do Omie desde jul/2026. O forecast v10 da
            Monetização (valor assinado, recorte da Caixa de Oportunidade) fica em Monetização, aba
            Forecast.
          </p>
        </>
      )}

      {frente === "caixa" && (
        <>
          <Painel
            titulo="O faturamento vira caixa?"
            descricao="Emitido × recebido, vencido ao vivo e caixa livre, pelas funções do Financeiro."
          >
            <CaixaPainel empresa={e} />
          </Painel>
          <Painel
            titulo="Com que margem, e em qual grupo de empresas?"
            descricao="Receita bruta e lucro bruto por grupo de apuração."
          >
            <MargemPainel empresa={e} />
          </Painel>
        </>
      )}

      {frente === "capital" && (
        <>
          <Painel
            titulo="As fontes estão em dia?"
            descricao="Última carga declarada por cada fonte do cockpit."
          >
            <FrescorPainel frescor={e.frescor} />
          </Painel>
          <Painel
            titulo="O que já conseguimos demonstrar?"
            descricao="Os oito pilares e as 11 exigências da p. 25 do mapa de investidores, pela situação da pergunta que responde cada uma."
          >
            <PilaresPainel />
          </Painel>
          <ExportarEvidencias cockpit={cockpit} />
        </>
      )}

      <ListaPerguntas cockpit={cockpit} frente={frente} onAbrirIndicador={onAbrirIndicador} />
    </>
  );
}
