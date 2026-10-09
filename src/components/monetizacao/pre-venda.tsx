// Tela Pré-venda da Monetização (`/monetizacao?aba=pre-venda`). Contrato docs/design/contratos/monetizacao-pre-venda.md;
// PRD aprovado em 09/10/2026 (https://claude.ai/artifact/VVsFAthHk5cSdd8yuLHSwg, slide 6). Três visões na mesma aba, com
// a visão na URL (`visao`, N7) e controle segmentado no topo:
//   Ritmo     → pre-venda-ritmo.tsx      Visão geral: "Quem está no ritmo da cadência?"
//   Aderência → pre-venda-aderencia.tsx  Visão geral: "Quem segue o script, e onde pula?"
//   Ficha     → pre-venda-ficha.tsx      Lista/Relatório com a ficha ao lado; "Reuniões" é a tela Gravações, sem reescrever.
// Nada é calculado aqui: a régua mora em src/lib/monetizacao/pre-venda.ts e o dado chega das quatro RPCs do contrato de
// dados. Acesso (decisão 4B): todos que veem a Monetização veem tudo, sem trava por closer.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import {
  classificarErroPreVenda,
  type Atrasado,
  type FichaLigacao,
  type LinhaAvaliacao,
  type LinhaRitmo,
} from "@/lib/monetizacao/pre-venda";
import {
  carregarAtrasadosPreVenda,
  carregarAvaliacaoPreVenda,
  carregarAvaliacoesPreVenda,
  carregarRitmoPreVenda,
} from "@/lib/monetizacao/pre-venda.functions";
import type { BaseMonetizacao } from "@/lib/monetizacao/types";
import type { BuscaMonetizacao, VisaoPreVenda as Visao } from "./busca";
import { VisaoGravacoes, type MudarBusca } from "./gravacoes";
import { AderenciaPreVenda } from "./pre-venda-aderencia";
import { LIMPA_VISAO, Segmentado, visaoDa, type Consulta } from "./pre-venda-comum";
import { FichaPreVenda } from "./pre-venda-ficha";
import { RitmoPreVenda } from "./pre-venda-ritmo";

export { FONTE_PRE_VENDA, visaoDa } from "./pre-venda-comum";

/** A pergunta de cada visão (o `<h1>`, N1). Ficha › Reuniões mantém a pergunta da tela Gravações. */
export const PERGUNTAS_PRE_VENDA: Record<Visao | "reunioes", string> = {
  ritmo: "Quem está no ritmo da cadência?",
  aderencia: "Quem segue o script, e onde pula?",
  ficha: "O que foi dito em cada ligação?",
  reunioes: "O que foi dito e ofertado em cada reunião do pipe 39?",
};

const VISOES: { chave: Visao; rotulo: string }[] = [
  { chave: "ritmo", rotulo: "Ritmo" },
  { chave: "aderencia", rotulo: "Aderência" },
  { chave: "ficha", rotulo: "Ficha" },
];

/** As três visões, no topo da tela (dentro do cabeçalho, acima da barra de filtros). */
export function SeletorVisaoPreVenda({
  busca,
  mudarBusca,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: MudarBusca;
}) {
  return (
    <Segmentado
      rotulo="Visões da Pré-venda"
      opcoes={VISOES}
      valor={visaoDa(busca)}
      mudar={(v) => mudarBusca({ ...LIMPA_VISAO, visao: v === "ritmo" ? undefined : v })}
    />
  );
}

export interface PeriodoPreVenda {
  de: string;
  ate: string;
  hoje: string;
}

/** A tela sem transporte: recebe as leituras prontas (o preview de captura usa os dados de exemplo). */
export function PainelPreVenda({
  busca,
  mudarBusca,
  periodo,
  quem,
  ritmo,
  atrasados,
  avaliacoes,
  ficha,
  escopo,
  reunioes,
  atualizadoEm,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: MudarBusca;
  periodo: PeriodoPreVenda;
  /** "Pré-venda (Matheus e Heloá)" ou o nome da pessoa do filtro. */
  quem: string;
  ritmo: Consulta<LinhaRitmo[]>;
  atrasados: Consulta<Atrasado[]>;
  avaliacoes: Consulta<LinhaAvaliacao[]>;
  ficha: (deal: number) => Promise<FichaLigacao>;
  escopo: string;
  reunioes: ReactNode;
  atualizadoEm: string | null;
}) {
  const visao = visaoDa(busca);
  if (visao === "ritmo")
    return (
      <RitmoPreVenda
        ritmo={ritmo}
        atrasados={atrasados}
        periodo={periodo}
        pessoa={busca.responsavel}
        quem={quem}
      />
    );
  if (visao === "aderencia")
    return (
      <AderenciaPreVenda
        avaliacoes={avaliacoes}
        pessoa={busca.responsavel}
        quem={quem}
        abrirFicha={(patch) => mudarBusca({ ...LIMPA_VISAO, visao: "ficha", ...patch })}
      />
    );
  return (
    <FichaPreVenda
      busca={busca}
      mudarBusca={mudarBusca}
      avaliacoes={avaliacoes}
      ficha={ficha}
      escopo={escopo}
      reunioes={reunioes}
      atualizadoEm={atualizadoEm}
    />
  );
}

/** A tela como o Brain usa: lê as RPCs com a sessão da pessoa, só as da visão aberta. */
export function VisaoPreVenda({
  data,
  busca,
  mudarBusca,
  periodo,
  quem,
}: {
  data: BaseMonetizacao;
  busca: BuscaMonetizacao;
  mudarBusca: MudarBusca;
  periodo: PeriodoPreVenda;
  quem: string;
}) {
  const { user } = useAuth();
  const visao = visaoDa(busca);
  const ritmoFn = useServerFn(carregarRitmoPreVenda);
  const atrasadosFn = useServerFn(carregarAtrasadosPreVenda);
  const avaliacoesFn = useServerFn(carregarAvaliacoesPreVenda);
  const fichaFn = useServerFn(carregarAvaliacaoPreVenda);
  const intervalo = { de: periodo.de, ate: periodo.ate };
  // "Ainda não ativada" e "sem acesso" não melhoram tentando de novo.
  const repetir = (n: number, e: Error) => n < 1 && classificarErroPreVenda(e.message) === "erro";
  const comum = { staleTime: 60_000, refetchInterval: 5 * 60_000, retry: repetir } as const;
  const qRitmo = useQuery({
    queryKey: ["monetizacao-pre-venda-ritmo", user?.id, intervalo.de, intervalo.ate],
    queryFn: () => ritmoFn({ data: intervalo }),
    enabled: !!user && visao === "ritmo",
    ...comum,
  });
  const qAtrasados = useQuery({
    queryKey: ["monetizacao-pre-venda-atrasados", user?.id],
    queryFn: () => atrasadosFn(),
    enabled: !!user && visao === "ritmo",
    ...comum,
  });
  const qAvaliacoes = useQuery({
    queryKey: ["monetizacao-pre-venda-avaliacoes", user?.id, intervalo.de, intervalo.ate],
    queryFn: () => avaliacoesFn({ data: intervalo }),
    enabled: !!user && visao !== "ritmo" && busca.ficha !== "reunioes",
    ...comum,
  });
  const consulta = <T,>(q: {
    data?: T;
    error: unknown;
    isLoading: boolean;
    refetch: () => unknown;
  }): Consulta<T> => ({
    data: q.data,
    erro: (q.error as Error | null) ?? null,
    carregando: q.isLoading,
    tentarNovamente: () => void q.refetch(),
  });
  return (
    <PainelPreVenda
      busca={busca}
      mudarBusca={mudarBusca}
      periodo={periodo}
      quem={quem}
      ritmo={consulta(qRitmo)}
      atrasados={consulta(qAtrasados)}
      avaliacoes={consulta(qAvaliacoes)}
      ficha={(deal) => fichaFn({ data: { deal } })}
      escopo={user?.id ?? "anonimo"}
      reunioes={<VisaoGravacoes data={data} busca={busca} mudarBusca={mudarBusca} />}
      atualizadoEm={data.measured_at}
    />
  );
}
