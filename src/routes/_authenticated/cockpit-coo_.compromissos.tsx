import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Carregando, EstadoSemAcesso, PageHeader } from "@/components/planning";
import { CompromissosPagina } from "@/components/cockpit-coo/compromissos-pagina";
import type { BuscaCompromissos, Higiene } from "@/components/cockpit-coo/compromissos-pagina";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { carregarBaseCoo } from "@/lib/cockpit-coo/base.functions";
import { carregarOpcoesCompromisso } from "@/lib/cockpit-coo/compromissos.functions";
import { carregarSugestoesCoo, decidirSugestaoCoo, triarCompromissos } from "@/lib/cockpit-coo/triagem.functions";
import type { SugestaoCoo } from "@/lib/cockpit-coo/triagem";
import { ehTema } from "@/lib/cockpit-coo/contrato";
import { lerTarefas } from "@/lib/cockpit-coo/compromissos";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";

// Tarefas e compromissos do COO (arquétipo Fila de trabalho). Filtros e a ficha aberta ficam na URL (N7).

const HIGIENES: Higiene[] = ["sem-dono", "sem-prazo", "vencidos", "parados", "sem-tema", "bloqueados"];

function buscaDaUrl(s: Record<string, unknown>): BuscaCompromissos {
  const texto = (v: unknown) => (typeof v === "string" && v.length <= 120 ? v : undefined);
  return {
    origem: s.origem === "rotina" || s.origem === "area" ? s.origem : undefined,
    area: texto(s.area),
    tema: ehTema(s.tema) ? s.tema : undefined,
    dono: texto(s.dono),
    unidade: texto(s.unidade),
    status: s.status === "concluidos" || s.status === "todos" ? s.status : undefined,
    higiene: HIGIENES.includes(s.higiene as Higiene) ? (s.higiene as Higiene) : undefined,
    tarefa: texto(s.tarefa),
  };
}

export const Route = createFileRoute("/_authenticated/cockpit-coo_/compromissos")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => buscaDaUrl(s),
  head: () => ({ meta: [{ title: "Tarefas e compromissos · Planning Brain" }] }),
  component: Pagina,
});

function Pagina() {
  const perms = usePermissions();
  if (perms.loading)
    return (
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="cockpit_coo" titulo="Tarefas e compromissos" />
        <Carregando variante="tabela" />
      </main>
    );
  if (!perms.temArea("cockpit_coo"))
    return (
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="cockpit_coo" titulo="Tarefas e compromissos" />
        <EstadoSemAcesso oQueFalta="a área Cockpit do COO (a administração da plataforma concede)" />
      </main>
    );
  return <ComAcesso />;
}

function ComAcesso() {
  const { user } = useAuth();
  const client = useQueryClient();
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  const baseFn = useServerFn(carregarBaseCoo);
  const base = useQuery({
    queryKey: ["cockpit-coo", "base", user?.id],
    enabled: !!user?.id,
    queryFn: () => baseFn(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const sugFn = useServerFn(carregarSugestoesCoo);
  const sugestoes = useQuery({
    queryKey: ["cockpit-coo", "sugestoes", user?.id],
    enabled: !!user?.id,
    queryFn: () => sugFn(),
    staleTime: 5 * 60_000,
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

  // Uma rodada de triagem por abertura da tela, só com o assistente ligado e o ClickUp conectado.
  const triarFn = useServerFn(triarCompromissos);
  const triar = useMutation({
    mutationFn: () => triarFn(),
    onSuccess: (r) => {
      if (r.triadas) client.invalidateQueries({ queryKey: ["cockpit-coo", "sugestoes"] });
    },
  });
  const triou = useRef(false);
  const conectado = !!base.data?.clickup.conectado;
  useEffect(() => {
    if (!triou.current && conectado && sugestoes.data?.ligado) {
      triou.current = true;
      triar.mutate();
    }
  }, [conectado, sugestoes.data?.ligado]); // eslint-disable-line react-hooks/exhaustive-deps

  const decidirFn = useServerFn(decidirSugestaoCoo);
  const decidir = useMutation({
    mutationFn: (v: { s: SugestaoCoo; aceitar: boolean }) => decidirFn({ data: { id: v.s.id, aceitar: v.aceitar } }),
    onSuccess: (r) => {
      (r.ok ? toast.success : toast.error)(r.mensagem);
      client.invalidateQueries({ queryKey: ["cockpit-coo"] });
    },
  });

  const compromissos = useMemo(() => {
    if (!base.data?.compromissos.ok) return [];
    const agora = new Date().toISOString();
    return lerTarefas(base.data.compromissos.dado, agora, base.data.unidades);
  }, [base.data]);

  if (base.isLoading)
    return (
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="cockpit_coo" titulo="Tarefas e compromissos" />
        <Carregando variante="tabela" />
      </main>
    );

  const ultima = base.data?.clickup.ultimaRodada ?? null;
  const motivo = conectado
    ? null
    : ultima?.status === "erro"
      ? `A última sincronização com o ClickUp falhou: ${ultima.erro ?? "erro sem mensagem"}.`
      : "O ClickUp ainda não está conectado: o token entra em Administração › Chaves de Integração.";

  return (
    <CompromissosPagina
      hoje={base.data?.hoje ?? hojeSaoPaulo()}
      compromissos={compromissos}
      sugestoes={sugestoes.data?.sugestoes ?? []}
      conectado={conectado}
      motivo={motivo}
      sincronizadoEm={ultima?.em ?? null}
      busca={busca}
      aoMudar={(p) =>
        navigate({
          search: (s: BuscaCompromissos) => ({ ...s, ...p }),
          replace: !("tarefa" in p && p.tarefa),
        })
      }
      opcoes={opcoes.data}
      pedirOpcoes={() => setQuerOpcoes(true)}
      confirmarSugestao={(s, aceitar) => decidir.mutate({ s, aceitar })}
    />
  );
}
