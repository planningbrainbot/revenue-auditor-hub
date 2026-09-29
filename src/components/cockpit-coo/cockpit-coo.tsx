import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarCheck, MessagesSquare, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Carregando, EstadoErro, PageHeader, StatusBadge } from "@/components/planning";
import { DefsHachura } from "@/components/cockpit-ceo/graficos";
import { TEMAS, temaDoDia } from "@/lib/cockpit-coo/contrato";
import type { AlertaCoo, LeituraTema, Tema } from "@/lib/cockpit-coo/contrato";
import type { Compromisso } from "@/lib/cockpit-coo/compromissos";
import { execucaoDoTema } from "@/lib/cockpit-coo/compromissos";
import type { OkrsTema } from "@/lib/cockpit-coo/okrs";
import { ROTULO_GRUPO, universo } from "@/lib/cockpit-coo/unidades";
import type { UnidadeCoo } from "@/lib/cockpit-coo/unidades";
import type { OpcoesCompromisso } from "@/lib/cockpit-coo/compromissos.functions";
import { BlocoOkrs, CaixaAtencao, CaixaExecucao, GraficoTema, NumerosTema } from "./blocos";
import { GavetaCoo } from "./gaveta";
import type { Detalhe } from "./gaveta";
import { VirarCompromisso } from "./virar-compromisso";

// Um tema do Cockpit do COO (arquétipo Visão geral, contrato docs/design/contratos/cockpit-coo.md):
// até 6 números; o que pede atenção (até 3, cada um vira compromisso no ClickUp); os compromissos
// do tema desde a última reunião; a evolução dos OKRs dos departamentos do tema (pedido do COO) e
// o gráfico do tema. Toda explicação fica na gaveta (`?detalhe=`), nunca em parágrafo na tela.

export interface BuscaCoo {
  tema?: Tema;
  unidade?: string;
  detalhe?: string;
}

export type MudarBuscaCoo = (parcial: Partial<BuscaCoo>) => void;

function FiltroUnidade({
  unidades,
  valor,
  aoMudar,
}: {
  unidades: UnidadeCoo[];
  valor: string;
  aoMudar: MudarBuscaCoo;
}) {
  const grupos = (["rede", "propria"] as const).map((g) => ({ g, us: unidades.filter((u) => u.grupo === g) }));
  return (
    <Select value={valor || "__todas"} onValueChange={(v) => aoMudar({ unidade: v === "__todas" ? "" : v, detalhe: "" })}>
      <SelectTrigger className="h-8 w-auto min-w-[220px]" aria-label="Unidade">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__todas">Todas as unidades</SelectItem>
        <SelectItem value="rede">{ROTULO_GRUPO.rede} (todas)</SelectItem>
        <SelectItem value="propria">{ROTULO_GRUPO.propria} (todas)</SelectItem>
        {grupos.map(({ g, us }) => (
          <SelectGroup key={g}>
            <SelectLabel>{ROTULO_GRUPO[g]}</SelectLabel>
            {us.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.nome}
                {u.grupo === "rede" && !u.emOperacao ? " · em implantação" : ""}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function CockpitCoo({
  tema,
  busca,
  aoMudar,
  hoje,
  unidades,
  leitura,
  carregando,
  erro,
  okrs,
  compromissos,
  clickupConectado,
  motivoClickUp,
  opcoes,
  pedirOpcoes,
}: {
  tema: Tema;
  busca: BuscaCoo;
  aoMudar: MudarBuscaCoo;
  hoje: string;
  unidades: UnidadeCoo[];
  leitura: LeituraTema | null;
  carregando: boolean;
  erro: string | null;
  okrs: OkrsTema | null;
  compromissos: Compromisso[];
  clickupConectado: boolean;
  motivoClickUp: string | null;
  opcoes: OpcoesCompromisso | undefined;
  pedirOpcoes: () => void;
}) {
  const [alertaAberto, setAlerta] = useState<AlertaCoo | null>(null);
  const filtro = busca.unidade ?? "";
  const def = TEMAS[tema];
  const ehHoje = temaDoDia(hoje) === tema;

  const detalhe: Detalhe | null = useMemo(() => {
    const d = busca.detalhe ?? "";
    if (!d || !leitura) {
      if (d === "okrs" && okrs)
        return detalheOkrs(okrs);
      return null;
    }
    if (d.startsWith("n:")) {
      const n = leitura.numeros.find((x) => x.id === d.slice(2));
      return n ? { tipo: "numero", numero: n } : null;
    }
    if (d.startsWith("g:")) {
      const g = leitura.graficos.find((x) => x.id === d.slice(2));
      return g ? { tipo: "grafico", grafico: g } : null;
    }
    if (d === "okrs" && okrs) return detalheOkrs(okrs);
    return null;
  }, [busca.detalhe, leitura, okrs]);

  const execucao = useMemo(
    () => (clickupConectado ? execucaoDoTema(tema, compromissos, hoje) : null),
    [clickupConectado, tema, compromissos, hoje],
  );

  const fontes = leitura?.fontes ?? [];
  const maisVelha = fontes
    .map((f) => f.atualizadoEm)
    .filter((x): x is string => !!x)
    .sort()[0];

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="cockpit_coo"
        titulo={def.menu}
        pergunta={def.pergunta}
        descricao={universo(unidades, filtro)}
        procedencia={
          fontes.length
            ? {
                fonte: fontes.map((f) => f.fonte).join(", "),
                atualizadoEm: maisVelha ?? null,
                regua: "todas as unidades do cadastro; fuso de São Paulo",
              }
            : undefined
        }
        acoes={
          <>
            {ehHoje && (
              <StatusBadge tom="info" icone={CalendarCheck}>
                Reunião de hoje
              </StatusBadge>
            )}
            <Button asChild size="sm" variant="outline">
              <Link to="/cockpit-coo/perguntar" search={{ tema }}>
                <MessagesSquare className="mr-1 size-4" aria-hidden />
                Perguntar ao Brain
              </Link>
            </Button>
          </>
        }
        filtros={<FiltroUnidade unidades={unidades} valor={filtro} aoMudar={aoMudar} />}
      />

      {leitura?.avisos.map((a) => (
        <Aviso key={a}>{a}</Aviso>
      ))}

      {carregando && !leitura ? (
        <Carregando variante="kpis" />
      ) : erro && !leitura ? (
        <EstadoErro titulo="A carga do tema falhou" detalhe={erro} />
      ) : leitura ? (
        <>
          <NumerosTema numeros={leitura.numeros} abrir={(n) => aoMudar({ detalhe: `n:${n.id}` })} />
          <div className="grid gap-4 xl:grid-cols-2">
            <CaixaAtencao
              alertas={leitura.alertas}
              compromissos={compromissos}
              podeCriar={clickupConectado}
              motivoSemCriar={motivoClickUp}
              virarCompromisso={(a) => {
                pedirOpcoes();
                setAlerta(a);
              }}
            />
            <CaixaExecucao tema={tema} execucao={execucao} conectado={clickupConectado} motivo={motivoClickUp} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {leitura.graficos[0] && (
              <GraficoTema g={leitura.graficos[0]} abrir={() => aoMudar({ detalhe: `g:${leitura.graficos[0].id}` })} />
            )}
            <BlocoOkrs okrs={okrs} abrir={() => aoMudar({ detalhe: "okrs" })} />
          </div>
          {leitura.graficos.slice(1).map((g) => (
            <GraficoTema key={g.id} g={g} abrir={() => aoMudar({ detalhe: `g:${g.id}` })} />
          ))}
        </>
      ) : null}

      <GavetaCoo detalhe={detalhe} tema={tema} onFechar={() => aoMudar({ detalhe: "" })} />
      <VirarCompromisso alerta={alertaAberto} tema={tema} hoje={hoje} opcoes={opcoes} onFechar={() => setAlerta(null)} />
      <DefsHachura />
    </main>
  );
}

function detalheOkrs(okrs: OkrsTema): Detalhe {
  const def = TEMAS[okrs.tema];
  return {
    tipo: "livre",
    titulo: `OKRs de ${def.departamentos.join(", ")}`,
    estado: okrs.estado,
    explicacao: {
      oQueDiz:
        "O progresso médio das KRs de cada departamento, dia a dia, contra o esperado do ciclo (01/08 a 31/12/2026, linear). Acima da linha tracejada, o departamento está no ritmo.",
      comoCalcula:
        "Foto diária do quadro de OKRs da Expansão Nacional no ClickUp (growth.okr_snapshot), na régua da tela de OKRs: medição pelo Brain, senão pelo ponteiro Atual/Alvo, senão pelo % de ações concluídas; média simples das KRs medidas.",
      atencao: okrs.parado
        ? `A foto parou em ${okrs.ultimoDia?.split("-").reverse().join("/")}: o coletor do Growth toma um redirect e conta como sucesso. Volta quando o token do ClickUp for colado em Administração › Chaves de Integração, porque a sincronização do Ops grava a foto a cada rodada.`
        : okrs.semFoto.length
          ? `Sem KR na foto: ${okrs.semFoto.join(", ")}.`
          : undefined,
      dono: "Cada departamento é dono das suas KRs; o quadro é do COO.",
    },
    fonte: "OKRs da Expansão Nacional (ClickUp)",
    dataDado: okrs.ultimoDia,
    destino: null,
    dados: {
      colunas: ["Departamento", "Progresso", "Esperado", "No ritmo", "Atrás", "Sem medição", "Pior KR"],
      linhas: okrs.departamentos.map((d) => [
        d.nome,
        d.progresso == null ? null : `${Math.round(d.progresso * 100)}%`,
        `${Math.round(d.esperado * 100)}%`,
        d.krs.noRitmo,
        d.krs.atras,
        d.krs.semMedicao,
        d.piorKr ? `${d.piorKr.nome} (${Math.round(d.piorKr.progresso * 100)}%)` : null,
      ]),
    },
  };
}
