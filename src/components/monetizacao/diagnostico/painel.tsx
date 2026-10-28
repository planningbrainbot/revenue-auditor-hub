// Seção "Base nova" das três telas da Monetização (Operação diária, Pré-venda, Forecast): pipe 40, Onboarding |
// Diagnóstico de Oportunidades (16/10/2026). Lê só ops.monetizacao_diagnostico_painel(): não baixa a carga do pipe 39.
// Contrato docs/design/contratos/monetizacao-base-nova.md; PRD https://claude.ai/artifact/9SapRMdQ3ydy8srToQ7NSn.
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  BarraFiltros,
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  PageHeader,
  SelecaoMultipla,
} from "@/components/planning";
import { cn } from "@/lib/utils";
import { hoje as hojeSP } from "@/lib/monetizacao/model";
import {
  FONTE_DIAGNOSTICO,
  NOME_PESSOA_DIAG,
  PESSOAS_DIAG,
  filtrarCards,
  type FiltroDiag,
  type PainelDiag,
} from "@/lib/monetizacao/diagnostico";
import { carregarDiagnostico, SEM_ACESSO_DIAG } from "@/lib/monetizacao/diagnostico.functions";
import {
  periodoDaBusca,
  periodoParaBusca,
  unidadesDaBusca,
  unidadesParaBusca,
  type BuscaMonetizacao,
} from "../busca";
import { Field, inputClass } from "../common";
import { diaUtilAnterior, segundaDaSemana } from "@/lib/monetizacao/feriados";
import { SeletorVisaoPreVenda, visaoDa } from "../pre-venda";
import { Segmentado } from "../pre-venda-comum";
import { SeletorBase, SeletorSecao } from "../seletor-base";
import { AvisoPrevia, ddmm, useListaDeCards } from "./comum";
import { ForecastDiagnostico } from "./forecast";
import { OperacaoDiagnostico } from "./operacao";
import { PERGUNTAS_DIAG, PreVendaDiagnostico } from "./pre-venda";

// Pré-venda e Venda são abas da Operação diária desde 28/10/2026.
const TITULO: Record<string, string> = {
  operacao: "Operação diária",
  "pre-venda": "Operação diária",
  fechamentos: "Operação diária",
};

export function PainelDiagnostico({
  busca,
  mudarBusca,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  const { user } = useAuth();
  const ler = useServerFn(carregarDiagnostico);
  const q = useQuery({
    queryKey: ["monetizacao-diagnostico", user?.id],
    queryFn: () => ler(),
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
  if (!q.data) {
    const erro = q.error as Error | null;
    return (
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
        <PageHeader titulo={tituloDa(busca)} pergunta={perguntaDa(busca)}>
          <Seletores busca={busca} mudarBusca={mudarBusca} />
        </PageHeader>
        {!erro ? (
          <Carregando variante="kpis" />
        ) : erro.message === SEM_ACESSO_DIAG ? (
          <EstadoSemAcesso oQueFalta="view.monetizacao" />
        ) : (
          <EstadoErro
            detalhe={`Fonte: carga do pipe 40. ${erro.message}`}
            tentarNovamente={() => void q.refetch()}
          />
        )}
      </main>
    );
  }
  return (
    <TelaDiagnostico
      busca={busca}
      mudarBusca={mudarBusca}
      painel={q.data}
      hoje={hojeSP()}
      atualizar={() => void q.refetch()}
      atualizando={q.isFetching}
    />
  );
}

const tituloDa = (b: BuscaMonetizacao) => TITULO[b.aba] ?? "Monetização";
const perguntaDa = (b: BuscaMonetizacao) =>
  b.aba === "pre-venda"
    ? PERGUNTAS_DIAG[visaoDa(b)]
    : b.aba === "fechamentos"
      ? "O que fazer hoje para o diagnóstico fechar?"
      : "O diagnóstico da base nova anda no prazo, e onde trava?";

function Seletores({
  busca,
  mudarBusca,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SeletorSecao busca={busca} mudarBusca={mudarBusca} />
      <SeletorBase busca={busca} mudarBusca={mudarBusca} />
      {busca.aba === "pre-venda" && <SeletorVisaoPreVenda busca={busca} mudarBusca={mudarBusca} />}
    </div>
  );
}

/** A tela sem transporte: recebe o painel pronto (a prévia local de captura usa dados de exemplo). */
export function TelaDiagnostico({
  busca,
  mudarBusca,
  painel,
  hoje,
  atualizar,
  atualizando,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  painel: PainelDiag;
  hoje: string;
  atualizar: () => void;
  atualizando: boolean;
}) {
  const lista = useListaDeCards();
  const aba = busca.aba;
  const visao = visaoDa(busca);
  const { from, to } = periodoDaBusca(busca);
  const [datas, setDatas] = useState({ from, to });
  useEffect(() => setDatas({ from, to }), [from, to]);
  const titulo = tituloDa(busca);
  const pergunta = perguntaDa(busca);
  const usaPeriodo =
    aba === "operacao" || (aba === "pre-venda" && (visao === "ritmo" || visao === "aderencia"));
  const unidadeIds = aba === "operacao" ? unidadesDaBusca(busca) : [];
  const regime =
    aba === "operacao" && (busca.regime === "real" || busca.regime === "presumido")
      ? busca.regime
      : undefined;
  const filtro: FiltroDiag = {
    de: from,
    ate: to,
    unidades: unidadeIds,
    regime,
    pessoa: busca.pessoa,
  };
  const seletores = <Seletores busca={busca} mudarBusca={mudarBusca} />;
  const todos = painel.cards;
  const cards = filtrarCards(todos, filtro);
  const etapas = painel.sync?.stages ?? [];

  // Unidades presentes no pipe 40, com o nome da própria venda (o rótulo "Unidade de Negócio" do Pipedrive).
  const nomes = new Map<number, string>();
  for (const c of todos)
    for (const u of c.unidade_ids) if (!nomes.has(u)) nomes.set(u, c.unidade ?? `Unidade ${u}`);
  const unidades = [...nomes.entries()]
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const rotuloUnidades = unidadeIds.length
    ? unidades
        .filter((u) => unidadeIds.includes(u.id))
        .map((u) => u.nome)
        .join(", ")
    : "todas as unidades";
  const rotuloRegime =
    regime === "real"
      ? "Lucro Real"
      : regime === "presumido"
        ? "Lucro Presumido"
        : "Real e Presumido";
  const rotuloPessoa = busca.pessoa
    ? (NOME_PESSOA_DIAG.get(busca.pessoa) ?? "pessoa")
    : "Matheus e Jordana";
  const periodo = `${ddmm(from)} a ${ddmm(to)}`;
  const descricao =
    aba === "operacao"
      ? `Pipe 40 (Onboarding | Diagnóstico de Oportunidades) · ${rotuloUnidades} · ${rotuloRegime} · ${periodo} · coorte: cards que entraram no período, cada um contado até a etapa mais adiantada`
      : aba === "pre-venda"
        ? `Pipe 40 · ${rotuloPessoa} · ${usaPeriodo ? periodo : "hoje"} · tarefa = atividade do card no Pipedrive (da régua do diagnóstico ou criada à mão)`
        : "Pipe 40 · cards abertos, fora os pausados · fila pela tarefa da régua e pelo prazo prometido · receita = honorário esperado da Jordana × probabilidade da etapa · fechamento = prazo prometido + 7 dias";

  const menosDias = (k: number) =>
    new Date(Date.parse(hoje) - k * 86400000).toISOString().slice(0, 10);
  // Ontem e Semana entraram em 22/10/2026, a pedido do Pedro, para a daily: Ontem é o dia útil anterior.
  const ontem = diaUtilAnterior(hoje);
  const presets = [
    { nome: "Ontem", from: ontem, to: ontem },
    { nome: "Semana", from: segundaDaSemana(hoje), to: hoje },
    { nome: "7 dias", from: menosDias(6), to: hoje },
    { nome: "30 dias", from: menosDias(29), to: hoje },
    { nome: "Mês", from: hoje.slice(0, 7) + "-01", to: hoje },
    { nome: "Desde 01/10", from: "2026-10-01", to: hoje },
  ];
  const presetAtivo = presets.find((p) => p.from === from && p.to === to);
  const aplicar = (de: string, ate: string) => mudarBusca(periodoParaBusca(de, ate));
  const temFiltro =
    !!busca.de || !!busca.ate || unidadeIds.length > 0 || !!regime || !!busca.pessoa;

  const filtros = aba !== "fechamentos" && (
    <BarraFiltros
      className="items-end"
      aoLimpar={
        temFiltro
          ? () =>
              mudarBusca({
                de: undefined,
                ate: undefined,
                unidade: undefined,
                regime: undefined,
                pessoa: undefined,
              })
          : undefined
      }
    >
      {usaPeriodo && (
        <>
          <div
            role="group"
            aria-label="Período"
            className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-input bg-card p-0.5"
          >
            {presets.map((p) => (
              <button
                key={p.nome}
                type="button"
                aria-pressed={presetAtivo?.nome === p.nome}
                onClick={() => aplicar(p.from, p.to)}
                className={cn(
                  "h-full rounded-md px-3 text-[13px] font-medium outline-none transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-ring",
                  presetAtivo?.nome === p.nome
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {p.nome}
              </button>
            ))}
          </div>
          <Field label="De">
            <input
              type="date"
              className={inputClass}
              value={datas.from}
              onChange={(e) => setDatas({ ...datas, from: e.target.value })}
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              className={inputClass}
              value={datas.to}
              onChange={(e) => setDatas({ ...datas, to: e.target.value })}
            />
          </Field>
          <Button size="sm" variant="outline" onClick={() => aplicar(datas.from, datas.to)}>
            Aplicar
          </Button>
        </>
      )}
      {aba === "pre-venda" && (
        <SelecaoMultipla
          rotulo="Pessoa"
          todos="Matheus e Jordana"
          plural="pessoas"
          so="Só esta"
          opcoes={PESSOAS_DIAG.map(([id, nome]) => ({ valor: String(id), rotulo: nome }))}
          valor={busca.pessoa ? [String(busca.pessoa)] : PESSOAS_DIAG.map(([id]) => String(id))}
          aoMudar={(v) => mudarBusca({ pessoa: v.length === 1 ? Number(v[0]) : undefined })}
        />
      )}
      {aba === "operacao" && unidades.length > 0 && (
        <SelecaoMultipla
          rotulo="Unidade"
          todos="Todas as unidades"
          plural="unidades"
          opcoes={unidades.map((u) => ({ valor: String(u.id), rotulo: u.nome }))}
          valor={unidadeIds.map(String)}
          aoMudar={(v) => mudarBusca({ unidade: unidadesParaBusca(v.map(Number)) })}
        />
      )}
      {aba === "operacao" && (
        <Segmentado
          rotulo="Regime"
          tamanho="sm"
          opcoes={[
            { chave: "todos", rotulo: "Real e Presumido" },
            { chave: "real", rotulo: "Real" },
            { chave: "presumido", rotulo: "Presumido" },
          ]}
          valor={regime ?? "todos"}
          mudar={(v) =>
            mudarBusca({ regime: v === "todos" ? undefined : (v as "real" | "presumido") })
          }
        />
      )}
    </BarraFiltros>
  );

  // A assinatura da Caixa de Oportunidade ao lado do Atualizar, como no cabeçalho da base antiga (20/10/2026).
  const acoes = (
    <>
      <img
        src="/brand/caixa/assinatura-horizontal.svg"
        alt="Caixa de Oportunidade"
        className="h-8 w-auto dark:brightness-0 dark:invert"
      />
      <Button variant="outline" size="sm" onClick={atualizar} disabled={atualizando}>
        <RefreshCw
          className={cn("size-4", atualizando && "animate-spin")}
          strokeWidth={1.75}
          aria-hidden
        />
        Atualizar
      </Button>
    </>
  );

  return (
    <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
      <PageHeader
        titulo={titulo}
        pergunta={pergunta}
        descricao={descricao}
        procedencia={{
          fonte: FONTE_DIAGNOSTICO,
          atualizadoEm: painel.sync?.measured_at ?? null,
          regua: "a cada 5 minutos",
        }}
        acoes={acoes}
      >
        {seletores}
        {filtros}
      </PageHeader>
      {painel.sync?.status === "error" && (
        <EstadoErro
          titulo="A última carga do pipe 40 falhou"
          detalhe={`Os números abaixo são da carga anterior (${ddmm(painel.sync.measured_at?.slice(0, 10))}). ${painel.sync.error ?? ""}`}
        />
      )}
      <AvisoPrevia painel={painel} />
      {!painel.sync?.measured_at ? (
        <EstadoVazio
          titulo="A carga do pipe 40 ainda não rodou"
          descricao="Ela roda a cada 5 minutos; a primeira aparece aqui sozinha."
        />
      ) : !todos.length ? (
        <EstadoVazio
          titulo="O pipe 40 ainda não tem card"
          descricao="Os cards nascem dos clientes que concluíram o onboarding do CS há 30 dias (Lucro Real e Presumido de R$ 10 mi para cima), quando a entrada automática for ligada, ou de quem criar o card à mão no Pipedrive."
        />
      ) : aba === "operacao" ? (
        <OperacaoDiagnostico
          cards={cards}
          etapas={etapas}
          filtro={filtro}
          hoje={hoje}
          abrir={lista.abrir}
          recorte={`${rotuloUnidades} · ${rotuloRegime}`}
        />
      ) : aba === "pre-venda" ? (
        <PreVendaDiagnostico
          visao={visao}
          cards={cards}
          etapas={etapas}
          tarefas={painel.tarefas}
          filtro={filtro}
          hoje={hoje}
          card={busca.card}
          abrirCard={(id) => mudarBusca({ visao: "ficha", card: id })}
          abrir={lista.abrir}
        />
      ) : (
        <ForecastDiagnostico
          cards={cards}
          etapas={etapas}
          hoje={hoje}
          abrir={lista.abrir}
          filtroFila={busca.fila === "consultoria" ? "hoje" : (busca.fila ?? "hoje")}
          mudarFiltroFila={(f) => mudarBusca({ fila: f === "hoje" ? undefined : f })}
        />
      )}
      {lista.dialogo}
    </main>
  );
}
