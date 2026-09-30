import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Carregando, EstadoSemAcesso, PageHeader } from "@/components/planning";
import { CockpitCoo } from "@/components/cockpit-coo/cockpit-coo";
import type { BuscaCoo, MudarBuscaCoo } from "@/components/cockpit-coo/cockpit-coo";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useMonetizacao } from "@/hooks/use-monetizacao";
import { carregarBaseCoo } from "@/lib/cockpit-coo/base.functions";
import type { BaseCoo } from "@/lib/cockpit-coo/base.functions";
import { carregarTemaCoo } from "@/lib/cockpit-coo/tema.functions";
import { carregarOpcoesCompromisso } from "@/lib/cockpit-coo/compromissos.functions";
import { TEMAS, ehTema, temaDoDia } from "@/lib/cockpit-coo/contrato";
import type { LeituraTema, Tema } from "@/lib/cockpit-coo/contrato";
import { lerTarefas } from "@/lib/cockpit-coo/compromissos";
import { montarOkrsTema } from "@/lib/cockpit-coo/okrs";
import { filtroValido } from "@/lib/cockpit-coo/unidades";
import { dadosSemCarga, montarMonetizacao } from "@/lib/cockpit-coo/temas/monetizacao";
import { dadosDaCarga, falhaDaCarga } from "@/lib/cockpit-coo/temas/monetizacao.carga";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";

// Cockpit do COO · Expansão (spec docs/superpowers/specs/2026-09-29-cockpit-coo-expansao-design.md).
// A área `cockpit_coo` decide se a página abre; sem ela nenhuma carga sai. Sem `?tema=`, abre no
// tema da reunião de hoje (sábado e domingo: sexta). O estado mora na URL (N7): tema, unidade e a
// gaveta aberta (`?detalhe=`).

function buscaDaUrl(s: Record<string, unknown>): BuscaCoo {
  return {
    tema: ehTema(s.tema) ? s.tema : undefined,
    unidade: typeof s.unidade === "string" || typeof s.unidade === "number" ? String(s.unidade) : undefined,
    detalhe: typeof s.detalhe === "string" && s.detalhe.length <= 80 ? s.detalhe : undefined,
  };
}

export const Route = createFileRoute("/_authenticated/cockpit-coo")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => buscaDaUrl(s),
  head: ({ match }) => {
    const t = (match.search as BuscaCoo).tema;
    return { meta: [{ title: `${t ? TEMAS[t].menu : "Cockpit do COO"} · Planning Brain` }] };
  },
  component: Pagina,
});

function Casca({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader area="cockpit_coo" titulo="Cockpit do COO" pergunta="A rede está no pacto, o que travou nesta semana e o que eu cobro de quem?" />
      {children}
    </main>
  );
}

function Pagina() {
  const perms = usePermissions();
  const busca = Route.useSearch();
  if (perms.loading)
    return (
      <Casca>
        <Carregando variante="kpis" />
      </Casca>
    );
  if (!perms.temArea("cockpit_coo"))
    return (
      <Casca>
        <EstadoSemAcesso oQueFalta="a área Cockpit do COO (a administração da plataforma concede)" />
      </Casca>
    );
  if (!busca.tema)
    return <Navigate to="/cockpit-coo" search={{ ...busca, tema: temaDoDia(hojeSaoPaulo()) }} replace />;
  return <ComTema tema={busca.tema} />;
}

function useBase() {
  const { user } = useAuth();
  const fn = useServerFn(carregarBaseCoo);
  return useQuery({
    queryKey: ["cockpit-coo", "base", user?.id],
    enabled: !!user?.id,
    queryFn: () => fn(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function ComTema({ tema }: { tema: Tema }) {
  const { user } = useAuth();
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  const base = useBase();
  const hoje = base.data?.hoje ?? hojeSaoPaulo();
  const unidades = base.data?.unidades ?? [];
  const filtro = busca.unidade && (!unidades.length || filtroValido(unidades, busca.unidade)) ? busca.unidade : "";

  const temaFn = useServerFn(carregarTemaCoo);
  const doServidor = useQuery({
    queryKey: ["cockpit-coo", "tema", tema, filtro, user?.id],
    enabled: !!user?.id && tema !== "monetizacao",
    queryFn: () => temaFn({ data: { tema, unidade: filtro } }),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const [querOpcoes, setQuerOpcoes] = useState(false);
  const opcoesFn = useServerFn(carregarOpcoesCompromisso);
  const opcoes = useQuery({
    queryKey: ["cockpit-coo", "opcoes", user?.id],
    enabled: !!user?.id && querOpcoes,
    queryFn: () => opcoesFn(),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const aoMudar: MudarBuscaCoo = (parcial) =>
    navigate({
      search: (s: BuscaCoo) => ({ ...s, ...parcial, detalhe: parcial.detalhe === "" ? undefined : (parcial.detalhe ?? s.detalhe) }),
      // Abrir a gaveta empilha: o "voltar" do navegador fecha a explicação.
      replace: !parcial.detalhe,
    });

  const okrs = useMemo(
    () => (base.data?.okrs.ok ? montarOkrsTema(tema, base.data.okrs.dado, hoje) : null),
    [base.data, tema, hoje],
  );
  const compromissos = useMemo(() => compromissosDaBase(base.data), [base.data]);
  const conectado = !!base.data?.clickup.conectado;
  const motivoClickUp = conectado
    ? null
    : base.data?.clickup.ultimaRodada?.status === "erro"
      ? `A última sincronização com o ClickUp falhou: ${base.data.clickup.ultimaRodada.erro ?? "erro sem mensagem"}.`
      : "O ClickUp ainda não está conectado: o token entra em Administração › Chaves de Integração.";

  const props = {
    tema,
    busca: { ...busca, unidade: filtro },
    aoMudar,
    hoje,
    unidades,
    okrs,
    compromissos,
    clickupConectado: conectado,
    motivoClickUp,
    opcoes: opcoes.data,
    pedirOpcoes: () => setQuerOpcoes(true),
  };

  if (tema === "monetizacao") return <Monetizacao {...props} base={base.data} carregandoBase={base.isLoading} />;
  return (
    <CockpitCoo
      {...props}
      leitura={doServidor.data ?? null}
      carregando={doServidor.isLoading || base.isLoading}
      erro={doServidor.error ? (doServidor.error as Error).message : null}
    />
  );
}

/** Quinta: montada no navegador a partir da carga que a tela da Monetização já baixa. */
function Monetizacao(
  props: Omit<Parameters<typeof CockpitCoo>[0], "leitura" | "carregando" | "erro"> & {
    base: BaseCoo | undefined;
    carregandoBase: boolean;
  },
) {
  const perms = usePermissions();
  const podeLer = perms.can("view.aquario") || perms.can("view.monetizacao");
  const q = useMonetizacao();
  const leitura: LeituraTema | null = useMemo(() => {
    if (!podeLer || !props.base) return null;
    // Carga falhou: a leitura sai com o motivo em cada número, nunca com zero.
    const dados = q.data
      ? dadosDaCarga(q.data, props.hoje, { acessoNegocios: perms.can("view.aquario") || perms.can("view.monetizacao") })
      : q.error
        ? (() => {
            const f = falhaDaCarga(q.error);
            return dadosSemCarga(f.estado, f.motivo);
          })()
        : null;
    return dados ? montarMonetizacao(dados, props.base.unidades, props.busca.unidade ?? "", props.hoje) : null;
  }, [podeLer, q.data, q.error, props.base, props.busca.unidade, props.hoje, perms]);
  const { base: _b, carregandoBase, ...resto } = props;
  if (!podeLer)
    return (
      <CockpitCoo
        {...resto}
        leitura={null}
        carregando={false}
        erro="A quinta usa a carga da Monetização, que exige a chave view.aquario ou view.monetizacao."
      />
    );
  return (
    <CockpitCoo
      {...resto}
      leitura={leitura}
      carregando={q.isLoading || carregandoBase}
      erro={null}
    />
  );
}

function compromissosDaBase(b: BaseCoo | undefined) {
  if (!b?.compromissos.ok) return [];
  const agora = new Date().toISOString();
  return lerTarefas(b.compromissos.dado, agora, b.unidades);
}
