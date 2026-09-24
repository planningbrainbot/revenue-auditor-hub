import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import {
  CockpitCeo,
  PERGUNTA_EXECUTIVA,
  type MudarBusca,
} from "@/components/cockpit-ceo/cockpit-ceo";
import { Carregando, EstadoSemAcesso, PageHeader } from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import { useMonetizacao } from "@/hooks/use-monetizacao";
import { usePermissions } from "@/hooks/use-permissions";
import {
  cargaDaEmpresa,
  clientesDaCarga,
  fonteDoBrain,
  fonteSemAcesso,
  receitaDaCarga,
  retencaoDaCarga,
} from "@/lib/cockpit-ceo/adaptador-brain";
import { carregarRetencaoCockpit } from "@/lib/cockpit-ceo/retencao.functions";
import { carregarClientesAtivosCockpit } from "@/lib/cockpit-ceo/clientes-ativos.functions";
import type { AcessoCockpit } from "@/lib/cockpit-ceo/adaptador-brain";
import { montarCockpit } from "@/lib/cockpit-ceo/indicadores";
import { carregarReceitaCockpit } from "@/lib/cockpit-ceo/receita.functions";
import { carregarCaixaCockpit } from "@/lib/cockpit-ceo/caixa.functions";
import { carregarAquisicaoCockpit } from "@/lib/cockpit-ceo/aquisicao.functions";
import { carregarOperacaoCockpit } from "@/lib/cockpit-ceo/operacao.functions";
import type { FonteCockpit } from "@/lib/cockpit-ceo/indicadores";
import { FRENTES } from "@/lib/cockpit-ceo/contrato";
import type { Frente } from "@/lib/cockpit-ceo/contrato";
import { buscaDaUrl, resolverPeriodo, validarBusca } from "@/lib/cockpit-ceo/periodo";
import type { BuscaUrl } from "@/lib/cockpit-ceo/periodo";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";

// Cockpit do CEO com dado real, somente leitura.
//
// A área `cockpit_ceo` decide se a página abre; a carga só é montada depois disso, então quem não
// tem a área não dispara consulta nenhuma. Os dados vêm da mesma carga de Base e Monetização, com
// as permissões e a RLS que já valem lá: o cockpit não abre dado novo para ninguém. Quem tem a área
// mas nenhuma chave de Base ou Monetização vê "acesso insuficiente", sem disparar a carga.
// As leituras da empresa inteira têm carga própria (faturamento e ponte; caixa e margem; Growth;
// onboarding e cadeia): o servidor confere a porta de cada uma e devolve "acesso insuficiente" por
// parte. A falha de uma não apaga as outras.
export const Route = createFileRoute("/_authenticated/cockpit-ceo")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => buscaDaUrl(s),
  // O título da aba acompanha o item da lateral e o <h1> (N1).
  head: ({ match }) => {
    const f = (match.search as BuscaUrl).frente;
    const titulo = f && f in FRENTES ? FRENTES[f as Frente].titulo : "Visão executiva";
    return { meta: [{ title: `${titulo} · Planning Brain` }] };
  },
  component: Pagina,
});

/** Casca dos estados sem cockpit montado: o mesmo cabeçalho da Visão executiva (N1, V5). */
function Casca({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader area="cockpit_ceo" titulo="Visão executiva" pergunta={PERGUNTA_EXECUTIVA} />
      {children}
    </main>
  );
}

function Pagina() {
  const perms = usePermissions();
  if (perms.loading)
    return (
      <Casca>
        <Carregando variante="kpis" />
      </Casca>
    );
  if (!perms.temArea("cockpit_ceo"))
    return (
      <Casca>
        <EstadoSemAcesso oQueFalta="a área Cockpit do CEO (a administração da plataforma concede)" />
      </Casca>
    );
  const acesso: AcessoCockpit = {
    acessoBase: perms.can("view.aquario") || perms.can("view.clientes"),
    acessoNegocios: perms.can("view.aquario") || perms.can("view.monetizacao"),
  };
  // A carga exige ao menos uma dessas chaves (carregarMonetizacao); sem elas, nem se tenta.
  return acesso.acessoBase || acesso.acessoNegocios ? <ComCarga acesso={acesso} /> : <SemCarga />;
}

/** Leituras de faturamento, uma vez por sessão de tela; sem retry automático. */
function useReceita() {
  const { user } = useAuth();
  const fn = useServerFn(carregarReceitaCockpit);
  const q = useQuery({
    // Por pessoa, como useMonetizacao: o cache não passa de um usuário para o próximo na mesma aba.
    queryKey: ["cockpit-ceo", "receita", user?.id],
    enabled: !!user?.id,
    queryFn: () => fn(),
    staleTime: 10 * 60_000,
    retry: false,
  });
  return useMemo(() => receitaDaCarga(q), [q.data, q.error, q.isLoading]);
}

/** Definições de cliente ativo; os CNPJs ficam só na memória da tela. Sem retry automático. */
function useClientesAtivos() {
  const { user } = useAuth();
  const fn = useServerFn(carregarClientesAtivosCockpit);
  const q = useQuery({
    queryKey: ["cockpit-ceo", "clientes-ativos", user?.id],
    enabled: !!user?.id,
    queryFn: () => fn(),
    staleTime: 10 * 60_000,
    retry: false,
  });
  return useMemo(() => clientesDaCarga(q), [q.data, q.error, q.isLoading]);
}

/** Coortes de retenção já agregadas no servidor. Sem retry automático. */
function useRetencao() {
  const { user } = useAuth();
  const fn = useServerFn(carregarRetencaoCockpit);
  const q = useQuery({
    queryKey: ["cockpit-ceo", "retencao", user?.id],
    enabled: !!user?.id,
    queryFn: () => fn(),
    staleTime: 10 * 60_000,
    retry: false,
  });
  return useMemo(() => retencaoDaCarga(q), [q.data, q.error, q.isLoading]);
}

/**
 * Leituras da empresa inteira (Financeiro, Growth, Ops), uma vez por sessão de tela, sem retry
 * automático e com a chave por pessoa: o cache não passa de um usuário para o próximo.
 */
function useEmpresa() {
  const { user } = useAuth();
  const caixaFn = useServerFn(carregarCaixaCockpit);
  const aquisicaoFn = useServerFn(carregarAquisicaoCockpit);
  const operacaoFn = useServerFn(carregarOperacaoCockpit);
  const opcoes = { enabled: !!user?.id, staleTime: 10 * 60_000, retry: false } as const;
  const caixa = useQuery({
    queryKey: ["cockpit-ceo", "caixa", user?.id],
    queryFn: () => caixaFn(),
    ...opcoes,
  });
  const aquisicao = useQuery({
    queryKey: ["cockpit-ceo", "aquisicao", user?.id],
    queryFn: () => aquisicaoFn(),
    ...opcoes,
  });
  const operacao = useQuery({
    queryKey: ["cockpit-ceo", "operacao", user?.id],
    queryFn: () => operacaoFn(),
    ...opcoes,
  });
  return useMemo(
    () => ({
      caixa: cargaDaEmpresa(caixa, "A carga de caixa e margem falhou."),
      aquisicao: cargaDaEmpresa(aquisicao, "A carga do Growth falhou."),
      operacao: cargaDaEmpresa(operacao, "A carga da operação falhou."),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      caixa.data,
      caixa.error,
      caixa.isLoading,
      aquisicao.data,
      aquisicao.error,
      aquisicao.isLoading,
      operacao.data,
      operacao.error,
      operacao.isLoading,
    ],
  );
}

/** Relógio por minuto: uma aba aberta precisa perceber quando a carga passa a estar parada. */
function useAgora() {
  const [agora, setAgora] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date().toISOString()), 60_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

function ComCarga({ acesso }: { acesso: AcessoCockpit }) {
  const q = useMonetizacao();
  const receita = useReceita();
  const clientesAtivos = useClientesAtivos();
  const retencao = useRetencao();
  const empresa = useEmpresa();
  const agora = useAgora();
  const hoje = hojeSaoPaulo();
  const fonte = useMemo(
    () => ({
      ...fonteDoBrain(q, acesso, hoje, agora),
      receita,
      clientesAtivos,
      retencao,
      ...empresa,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      q.data,
      q.error,
      q.isLoading,
      acesso.acessoBase,
      acesso.acessoNegocios,
      hoje,
      agora,
      receita,
      clientesAtivos,
      retencao,
      empresa,
    ],
  );
  if (fonte.monetizacao.estado === "carregando")
    return (
      <Casca>
        <Carregando variante="kpis" />
      </Casca>
    );
  return <Tela fonte={fonte} hoje={hoje} />;
}

function SemCarga() {
  const receita = useReceita();
  // Sem as chaves da Base o servidor devolve cada definição como "acesso insuficiente", sem ler fonte.
  const clientesAtivos = useClientesAtivos();
  const retencao = useRetencao();
  const empresa = useEmpresa();
  const agora = useAgora();
  const hoje = hojeSaoPaulo();
  const fonte = useMemo(
    () => ({ ...fonteSemAcesso(hoje, agora), receita, clientesAtivos, retencao, ...empresa }),
    [hoje, agora, receita, clientesAtivos, retencao, empresa],
  );
  return <Tela fonte={fonte} hoje={hoje} />;
}

function Tela({ fonte, hoje }: { fonte: FonteCockpit; hoje: string }) {
  const busca = validarBusca(Route.useSearch());
  const navigate = Route.useNavigate();
  const periodo = useMemo(
    () => resolverPeriodo({ periodo: busca.periodo, de: busca.de, ate: busca.ate }, hoje),
    [busca.periodo, busca.de, busca.ate, hoje],
  );
  const cockpit = useMemo(
    () => montarCockpit(fonte, { periodo, perimetro: busca.perimetro }),
    [fonte, periodo, busca.perimetro],
  );
  const aoMudar: MudarBusca = (parcial) =>
    navigate({
      search: (s: BuscaUrl) => buscaDaUrl({ ...s, ...parcial }),
      // Abrir um número empilha no histórico: o "voltar" do navegador fecha a composição.
      // Trocar de frente também empilha: o "voltar" do navegador desfaz a troca.
      replace: !parcial.indicador && parcial.frente === undefined,
    });
  return <CockpitCeo cockpit={cockpit} busca={busca} periodo={periodo} aoMudar={aoMudar} />;
}
