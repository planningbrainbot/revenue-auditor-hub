import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Search, CheckCircle2, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useMonetizacao, useAtualizarMonetizacao } from "@/hooks/use-monetizacao";
import { acionarMonetizacao, contaDoItemLista } from "@/lib/monetizacao/functions";
import {
  contatosBase,
  estadoSincronizacaoBase,
  validarOrigemBase,
} from "@/lib/clientes-base.functions";
import { passaRefinamento, type Refinamento } from "@/lib/clientes-base";
import {
  normal,
  oferta,
  rotuloSituacaoReceita,
  situacaoForaDeOferta,
} from "@/lib/monetizacao/model";
import { NOMES, PRODUTOS, type Conta } from "@/lib/monetizacao/types";
import {
  BotaoComMotivo,
  downloadCsv,
  FOCO_VISIVEL,
  Freshness,
  inputClass,
  number,
  podeEscrever,
} from "@/components/monetizacao/common";
import { AccountDetail } from "@/components/monetizacao/account-detail";
import { Aquario, type ExtrasAquario, type SecaoAquario } from "@/components/monetizacao/aquario";
import { ContratosClientes } from "./contratos-clientes";
import {
  BarraFiltros,
  Carregando,
  ChipFiltro,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
} from "@/components/planning";
import {
  ORIGENS_BASE,
  origemBase,
  type OrigemBase,
  type PortfolioFilters,
} from "@/lib/monetizacao/portfolio";
import { MultiSelect } from "@/components/monetizacao/multi-select";
import {
  buscaDoRecorte,
  buscaDosFiltros,
  filtrosDaBusca,
  recorteDaBusca,
  SITS_CONFIANCA,
  type BuscaClientes,
} from "./busca";
import {
  BarraConfianca,
  CartoesUnidades,
  CertezaPorSinal,
  TabelaContas,
  VisaoClientes,
} from "./regra-cliente";
import { PainelBase } from "./painel-base";
import {
  AcoesBaseProvider,
  AcoesDaConta,
  BotaoIncluirCliente,
  CelulaNps,
  DeclaradosPelaUnidade,
  MeusPedidos,
  usePermissoesPedido,
  useResumoContatos,
} from "./pedidos-unidade";
import { GRAUS_DA_META } from "@/lib/clientes/pedidos";
import { FiltrosBase } from "./filtros-base";
import {
  passaRecorte,
  perfilRecorte,
  RECORTE_VAZIO,
  temRecorte,
  type PerfilRecorte,
  type RecorteBase,
} from "@/lib/clientes/recorte";
import {
  contarFaixas,
  contarSinais,
  ehCliente,
  ehExCliente,
  FAIXA_META,
  faixaDaConta,
  foraDaBase,
  porCerteza,
  SINAL_META,
  sinalDoCliente,
  type Faixa,
} from "@/lib/clientes/regra-cliente";

// A Base em três telas (Pedro, 15/10/2026, segunda rodada): Clientes (lista, filtros e o resumo Ativos · Inativos ·
// Base Antiga · Base Nova), Confiança (graus de confiança e as correções: Validar origem, Entenda os números, Contatos)
// e Painel (a Base por unidade em gráficos). As três ficam na lateral da área Base de clientes; quem chega por outra
// área (o sócio, por Minha Unidade) vê as três aqui em cima. Contratos e churn continua aberto pelo Painel.
// Produtos e Listas moram em /clientes/produtos e /clientes/listas, para quem tem a área Monetização.
const views = [
  ["clientes", "Clientes"],
  ["confianca", "Confiança"],
  ["painel", "Painel"],
];
// Título (o item do menu) e pergunta (N1) de cada visão: contrato `clientes.md`.
const VISOES: Record<string, { titulo: string; pergunta: string }> = {
  clientes: {
    titulo: "Clientes",
    pergunta: "Quais empresas são nossas clientes hoje?",
  },
  confianca: {
    titulo: "Confiança",
    pergunta: "Quanta certeza temos de que cada empresa é cliente, e o que falta corrigir?",
  },
  painel: {
    titulo: "Painel",
    pergunta: "Como está a Base em cada unidade?",
  },
  // Atualização da base pela unidade (28/10/2026): o que o sócio pediu e o que o CS decidiu.
  pedidos: {
    titulo: "Meus pedidos",
    pergunta: "O que a unidade pediu para mudar na base, e o que o CS já decidiu?",
  },
  unidades: {
    titulo: "Contratos e churn",
    pergunta: "Quais clientes estão ativos, e quais deram churn?",
  },
};
// As partes da Confiança (`sub` na URL): os graus são a padrão; as correções, para quem gerencia a Base.
const SUBS_CONFIANCA = [
  ["", "Graus de confiança"],
  ["validar", "Validar origem"],
  ["gates", "Entenda os números"],
  ["contatos", "Contatos"],
] as const;
// Chaves antigas que links de fora ainda mandam (Cockpit, Rede, apresentação ao sócio): viram as telas novas.
const LEGADO: Record<string, { view: string; sub?: "validar" | "gates" | "contatos" }> = {
  monetizacao: { view: "confianca" },
  contratos: { view: "unidades" },
  arrumar: { view: "confianca", sub: "validar" },
  pendencias: { view: "confianca", sub: "validar" },
  gates: { view: "confianca", sub: "gates" },
  contatos: { view: "confianca", sub: "contatos" },
};
// A mensagem do servidor quando falta view.aquario, view.clientes e view.monetizacao ao mesmo
// tempo (`carregarMonetizacao`): vira EstadoSemAcesso, não erro.
const ACESSO_NEGADO = /^Seu acesso não inclui/;
const MOTIVO_ATUALIZAR_SEM_ESCOPO = "Relê a tela; disparar a carga do CRM exige escopo geral";
const FONTE_BASE = "Catálogo da Base (Pipefy + Omie, conciliados)";
// Degraus do funil de refinamento: `gate` da URL, rótulo e chave em `counts`. "Com CNPJ" (não
// "válido"): o degrau só testa se há CNPJ.
const FUNIL = [
  ["", "Bruta"],
  ["cnpj", "Com CNPJ"],
  ["contato", "Com contato"],
  ["ecd", "Com ECD registrada"],
] as const;
const precisaValidar = (a: Conta) =>
  !!(a.base?.needs_validation || a.base?.needs_source_correction);
// Motivo de trabalho da linha: o que o catálogo diz (origin_reason) ou, sem ele, o passo.
const motivoDe = (a: Conta) =>
  a.base?.origin_reason ||
  (a.base?.needs_source_correction ? "Corrigir origem no Pipefy" : "Validar origem com a unidade");
const at = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "Sem leitura confirmada";
export function ClientesBase() {
  const query = useMonetizacao(),
    invalidate = useAtualizarMonetizacao(),
    sync = useServerFn(acionarMonetizacao),
    perms = usePermissions();
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuth();
  const search = useSearch({ from: "/_authenticated/clientes" }),
    navigate = useNavigate({ from: "/clientes" });
  const legado = LEGADO[search.view];
  const pedida = legado
    ? legado.view
    : views.some(([v]) => v === search.view) || ["unidades", "pedidos"].includes(search.view)
      ? search.view
      : "clientes";
  // Pedidos da unidade (PRD de 28/10/2026): as ações aparecem para quem pode pedir e, desabilitadas, no "ver como".
  const permsPedido = usePermissoesPedido();
  const resumoPedidos = useResumoContatos();
  const comAcoes = !!permsPedido.data && (permsPedido.data.abrir || permsPedido.data.ver_como);
  // Confiança, Painel e Contratos e churn pedem a chave view.clientes_painel (Pedro, 22/10/2026: o time de vendas vê
  // "somente a tela de clientes"). Sem ela, qualquer link da Base abre a tela Clientes.
  const verTudo = !perms.loading && perms.can("view.clientes_painel");
  const view =
    pedida === "pedidos" ? (comAcoes ? "pedidos" : "clientes") : verTudo ? pedida : "clientes";
  // Enquanto as permissões chegam, a tela pedida não desenha: Clientes no lugar dela piscaria para quem pode ver.
  const aguardandoPermissao =
    (perms.loading && pedida !== "clientes") || (pedida === "pedidos" && permsPedido.isLoading);
  const sub = legado?.sub ?? search.sub ?? "";
  // Produtos e Listas têm página própria na Base (15/10): o link antigo abre lá, com os mesmos filtros.
  const paraMonetizacao =
    search.view === "produtos" || search.view === "listas" ? search.view : null;
  useEffect(() => {
    if (!paraMonetizacao) return;
    void navigate({
      to: paraMonetizacao === "produtos" ? "/clientes/produtos" : "/clientes/listas",
      search: search as never,
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paraMonetizacao]);
  // Toda mudança de visão ou de filtro volta à primeira página; a página só muda pelo rodapé.
  const change = (patch: Partial<BuscaClientes>) => {
    void navigate({ search: { ...search, pagina: undefined, ...patch }, replace: true });
  };
  const page = search.pagina ?? 1,
    setPage = (p: number) => change({ pagina: p > 1 ? p : undefined });
  const [detail, setDetail] = useState<Conta | null>(null),
    [validation, setValidation] = useState<Conta | null>(null);
  // Link da apresentação ao sócio (`?item=`): abre a ficha da conta daquele item quando a base chega.
  const contaDoItemFn = useServerFn(contaDoItemLista);
  const itemUrl = search.item;
  useEffect(() => {
    const contas = query.data?.accounts;
    if (!itemUrl || !contas) return;
    let vivo = true;
    contaDoItemFn({ data: { id: itemUrl } })
      .then((chave) => {
        if (!vivo) return;
        const conta = chave ? contas.find((a) => a.key === chave) : undefined;
        if (conta) setDetail(conta);
        else toast.error("A conta deste item não está na sua Base.");
      })
      .catch(() => vivo && toast.error("Não foi possível abrir a conta deste item."));
    return () => {
      vivo = false;
    };
  }, [itemUrl, query.data?.accounts, contaDoItemFn]);
  const healthFn = useServerFn(estadoSincronizacaoBase),
    contactsFn = useServerFn(contatosBase);
  const health = useQuery({
    queryKey: ["base-health", user?.id],
    queryFn: () => healthFn(),
    enabled: !!user,
    refetchInterval: 60000,
  });
  const contacts = useQuery({
    queryKey: ["base-contacts", user?.id],
    queryFn: () => contactsFn(),
    refetchInterval: 60000,
    enabled: view === "confianca" && sub === "contatos" && perms.can("view.contatos"),
    staleTime: 30000,
  });
  // Unidades do topo resolvidas (a URL aceita chave ou nome; múltipla escolha, DECISIONS 18/09).
  const unidadesUrl = search.unidade ?? [];
  const origensUrl = search.origem ?? [];
  const unidadesSelecionadas = useMemo(
    () =>
      unidadesUrl.length && query.data
        ? query.data.units.filter((u) =>
            unidadesUrl.some((v) => u.key === v || normal(u.name) === normal(v)),
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, JSON.stringify(unidadesUrl)],
  );
  // O recorte do topo sem a origem: os cartões de origem da gaveta da unidade contam sobre ele,
  // para nunca mostrar 0 numa origem que o próprio clique vai aplicar (e abrir N).
  // Não é cliente pela regra: fora de todas as telas da Base (27/10); a Confiança diz quantas ficaram de fora no recorte.
  // A ficha ainda abre por link (`?item=`).
  const [rowsSemOrigem, foraDaBaseNoTopo] = useMemo(() => {
    const data = query.data;
    if (!data) return [[] as Conta[], 0] as const;
    const unitKeys = new Set(unidadesSelecionadas.flatMap((u) => u.account_keys));
    const noTopo = data.accounts.filter((a) => {
      if (unidadesUrl.length && !unitKeys.has(a.key)) return false;
      // A busca é uma só (a da tabela saiu): nome, segmento, unidade e CNPJ.
      if (
        search.q &&
        !normal([a.name, a.segment, a.unit_label, ...(a.base?.cnpjs || [])].join(" ")).includes(
          normal(search.q),
        ) &&
        !(
          search.q.replace(/\D/g, "").length >= 3 &&
          a.base?.cnpjs.some((c) => c.includes(search.q.replace(/\D/g, "")))
        )
      )
        return false;
      return true;
    });
    const fora = noTopo.filter(foraDaBase).length;
    return [noTopo.filter((a) => !foraDaBase(a)), fora] as const;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, unidadesSelecionadas, search.q]);
  // Origem pela régua da tabela (`origemBase`, 4 valores). A antiga lia `base.origin`, com 3
  // valores e outro sentido: "A confirmar" do topo nunca casava conta sem `base`.
  const rows = useMemo(
    () =>
      origensUrl.length
        ? rowsSemOrigem.filter((a) => origensUrl.includes(origemBase(a)))
        : rowsSemOrigem,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowsSemOrigem, JSON.stringify(origensUrl)],
  );
  const counts = useMemo(
    () => ({
      raw: rows.length,
      cnpj: rows.filter((a) => passaRefinamento(a, "cnpj")).length,
      contato: rows.filter((a) => passaRefinamento(a, "contato")).length,
      ecd: rows.filter((a) => passaRefinamento(a, "ecd")).length,
    }),
    [rows],
  );
  const filtered = useMemo(
    () => rows.filter((a) => passaRefinamento(a, search.gate as Refinamento)),
    [rows, search.gate],
  );
  // Validar origem é Fila (N5): a ordem padrão é a de trabalho, por motivo e depois por unidade
  // (antes era a do catálogo). Correção no Pipefy primeiro: ela já tem a evidência e só espera o
  // espelho; depois as que pedem conversa com a unidade.
  const visible = useMemo(
    () =>
      view === "confianca" && sub === "validar"
        ? filtered
            .filter(precisaValidar)
            .sort(
              (a, b) =>
                Number(!a.base?.needs_source_correction) -
                  Number(!b.base?.needs_source_correction) ||
                motivoDe(a).localeCompare(motivoDe(b), "pt-BR") ||
                (a.unit_label || "\uffff").localeCompare(b.unit_label || "\uffff", "pt-BR") ||
                a.name.localeCompare(b.name, "pt-BR"),
            )
        : filtered,
    [filtered, view, sub],
  );
  const accountKeys = useMemo(() => new Set(filtered.map((a) => a.key)), [filtered]);
  // Regra de cliente (15/10): a Confiança conta e lista pela faixa da conta, no recorte do topo.
  const sitConfianca = (SITS_CONFIANCA as readonly string[]).includes(search.sit ?? "")
    ? (search.sit as Faixa)
    : null;
  const contagemConfianca = useMemo(() => contarFaixas(filtered), [filtered]);
  // De onde vem a certeza (27/10): os clientes do recorte por sinal; escolher um sinal filtra a lista no lugar da faixa.
  const sinalConfianca = search.sinal ?? null;
  const contagemSinais = useMemo(() => contarSinais(filtered), [filtered]);
  const linhasConfianca = useMemo(
    () =>
      (sinalConfianca
        ? filtered.filter((a) => sinalDoCliente(a) === sinalConfianca)
        : sitConfianca
          ? filtered.filter((a) => faixaDaConta(a) === sitConfianca)
          : filtered
      )
        .slice()
        .sort(porCerteza),
    [filtered, sitConfianca, sinalConfianca],
  );
  const contaPorChave = useMemo(
    () => new Map((query.data?.accounts ?? []).map((a) => [a.key, a])),
    [query.data],
  );
  // Recorte por região, porte e segmento (21/10/2026), só nas telas Clientes e Painel, onde ele aparece. O perfil de
  // cada conta sai uma vez por carga; a UF da unidade entra quando a empresa não tem a própria.
  const perfis = useMemo(() => {
    const data = query.data;
    if (!data) return new Map<string, PerfilRecorte>();
    const nomes = new Map(data.units.map((u) => [u.key, u.name]));
    return new Map(data.accounts.map((a) => [a.key, perfilRecorte(a, (k) => nomes.get(k))]));
  }, [query.data]);
  const perfil = useCallback(
    (a: Conta) => perfis.get(a.key) ?? perfilRecorte(a, () => undefined),
    [perfis],
  );
  const recorte: RecorteBase = useMemo(
    () => recorteDaBusca(search),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify([search.regiao, search.uf, search.porte, search.segmentoCliente])],
  );
  const mudarRecorte = (r: RecorteBase) => change({ ...buscaDoRecorte(r), numero: undefined });
  const rowsNoRecorte = useMemo(
    () => (temRecorte(recorte) ? rows.filter((a) => passaRecorte(perfil(a), recorte)) : rows),
    [rows, perfil, recorte],
  );
  // O que o recorte conta na tela Clientes: a lista que está à mostra (ativos, inativos, Base Antiga ou Base Nova).
  const populacaoClientes = useMemo(
    () =>
      search.sit === "ex"
        ? rows.filter(ehExCliente)
        : rows.filter(
            (a) =>
              ehCliente(a) &&
              (!search.base || (search.base === "antiga") === (a.base?.origin === "antiga")),
          ),
    [rows, search.sit, search.base],
  );
  const accountKeysSemOrigem = useMemo(
    () =>
      new Set(
        rowsSemOrigem
          .filter((a) => passaRefinamento(a, search.gate as Refinamento))
          .map((a) => a.key),
      ),
    [rowsSemOrigem, search.gate],
  );
  // Filtros da tabela da Base, lidos da URL. A assinatura segura a identidade do objeto: a
  // tabela recalcula a carteira inteira quando ele muda.
  const unidadeKeys = unidadesSelecionadas.map((u) => u.key);
  const assinaturaFiltros = JSON.stringify([
    unidadeKeys,
    search.origem,
    search.produto,
    search.situacao,
    search.abordagem,
    search.faixa,
    search.driva,
    search.segmento,
    search.regime,
    search.receita,
    search.contato,
    search.sobreposicao,
    search.distrato,
    search.consultoria,
  ]);
  const filtros = useMemo(
    () => filtrosDaBusca(search, unidadeKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assinaturaFiltros],
  );
  // Filtro na mesma visão não mexe na rolagem (antes cada filtro devolvia a página ao topo);
  // troca de visão começa do topo. `extras` grava o painel do Recon na mesma navegação.
  // O Aquário só mora aqui em Entenda os números: os números com produto, a carteira e as listas abrem na Monetização.
  const rotaDaSecao = (s: SecaoAquario) =>
    s === "listas"
      ? "/clientes/listas"
      : s === "produtos" || s === "base"
        ? "/clientes/produtos"
        : null;
  const mudarFiltros = (f: PortfolioFilters, destino?: SecaoAquario, extras?: ExtrasAquario) => {
    const rota = destino ? rotaDaSecao(destino) : null;
    void navigate({
      ...(rota ? { to: rota } : {}),
      search: {
        ...search,
        pagina: undefined,
        ...buscaDosFiltros(f),
        ...(extras ? { painel: extras.painel } : {}),
        ...(destino === "base" ? { secao: "carteira" } : {}),
        ...(destino === "gates" ? { view: "confianca", sub: "gates" } : {}),
      } as never,
      replace: true,
      resetScroll: !!destino,
    });
  };
  const irParaSecao = (s: SecaoAquario) => {
    const rota = rotaDaSecao(s);
    if (rota)
      void navigate({
        to: rota,
        search: {
          ...search,
          pagina: undefined,
          ...(s === "base" ? { secao: "carteira" } : {}),
        } as never,
      });
    else change({ view: "confianca", sub: "gates" });
  };
  const abrirLista = (id: string | null) => {
    void navigate({
      search: { ...search, pagina: undefined, lista: id ?? undefined },
      replace: true,
      resetScroll: false,
    });
  };
  const meta = VISOES[view] ?? VISOES.clientes;
  // As correções (Validar origem, Entenda os números, Contatos) são de quem gerencia a Base (manage.aquario).
  const podeArrumar = !!query.data?.permissions.manage || perms.can("manage.aquario");
  // O selo da parte Validar origem conta a mesma base do cabeçalho: depois do recorte do topo e do refinamento.
  const pendentes = filtered.filter(precisaValidar).length;
  // As três telas estão na lateral da área Base de clientes. Quem chega por outra área (o sócio, por Minha Unidade)
  // não tem essa lateral: para ele as três aparecem aqui em cima.
  const navNaPagina = !perms.loading && !perms.temArea("clientes") && verTudo;
  const nav = navNaPagina ? (
    <nav aria-label="Telas da Base" className="flex gap-1 overflow-x-auto border-b">
      {[...views, ...(comAcoes ? [["pedidos", "Meus pedidos"]] : [])].map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-current={view === key ? "page" : undefined}
          onClick={() =>
            change({
              view: key,
              sit: undefined,
              sub: undefined,
              base: undefined,
              numero: undefined,
            })
          }
          className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm ${FOCO_VISIVEL} ${view === key ? "border-primary font-semibold text-primary-text" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {label}
        </button>
      ))}
    </nav>
  ) : null;
  // A visão Contratos e churn lê as próprias fontes (empresas, Central de Tratativas): não espera
  // a carga da Monetização, e uma falha dela não tranca esta visão.
  if (aguardandoPermissao)
    return (
      <main className="mx-auto max-w-[1700px] space-y-4 p-4 md:p-6">
        <Carregando variante="kpis" />
        <Carregando variante="tabela" />
      </main>
    );
  if (view === "unidades") {
    // Contratos filtra UMA unidade, por nome. A chave da URL só vira nome quando a carga chega;
    // antes disso (ou se ela falhar) ContratosClientes usa o valor cru da URL quando ele já é o
    // nome de uma unidade regional, e a unidade resolvida entra quando a carga chega.
    const falhou = !!query.error && !query.data;
    const nomes = query.data
      ? unidadesUrl.map(
          (v) =>
            query.data!.units.find((u) => u.key === v || normal(u.name) === normal(v))?.name ?? v,
        )
      : [];
    const aviso = !unidadesUrl.length
      ? null
      : falhou
        ? "A carga da Base falhou: a unidade da URL só é aplicada se for o nome de uma unidade regional."
        : nomes.length > 1
          ? "Contratos e churn filtra uma unidade por vez: a lista abre sem filtro de unidade."
          : null;
    return (
      <main className="mx-auto max-w-[1700px] space-y-4 p-4 md:p-6">
        <PageHeader
          titulo={meta.titulo}
          pergunta={meta.pergunta}
          descricao="Cartões: clientes pela regra de cliente em cada unidade · lista: empresas de unidades regionais na base de empresas, MRR pela cascata Omie > Pipefy > Pipedrive, churn pela Central de Tratativas"
          // Defeito de dado registrado no contrato (não corrigido aqui): a leitura da Central de
          // Tratativas corta em 1.000 cards, e a contagem de churn pode estar baixa.
          procedencia={{
            fonte: "empresas, contratos e Central de Tratativas, lidos ao abrir",
            regua: "churn lido em até 1.000 cards",
          }}
        />
        {nav}
        {query.data && (
          <CartoesUnidades
            unidades={query.data.units}
            contaPorChave={contaPorChave}
            selecionada={unidadesSelecionadas.length === 1 ? unidadesSelecionadas[0].key : null}
            aoEscolher={(u) => change({ unidade: u ? [u.key] : undefined })}
          />
        )}
        {aviso && (
          <p role="status" className="text-sm text-muted-foreground">
            {aviso}
          </p>
        )}
        <ContratosClientes
          // A Base guarda a CHAVE da unidade na URL (`monetizacao_unidades.key`), e a de
          // contratos filtra por nome (`empresas.unidade`). Sem traduzir aqui, trocar de visão
          // com uma unidade filtrada zerava a lista inteira.
          unidadeParam={nomes.length === 1 ? nomes[0] : ""}
          unidadesUrl={unidadesUrl}
        />
      </main>
    );
  }
  if (!query.data) {
    const erro = query.error;
    return (
      <main className="mx-auto max-w-[1700px] space-y-4 p-4 md:p-6">
        <PageHeader titulo={meta.titulo} pergunta={meta.pergunta} />
        {nav}
        {!erro ? (
          <>
            <Carregando variante="kpis" />
            <Carregando variante="tabela" />
          </>
        ) : ACESSO_NEGADO.test(erro.message) ? (
          <EstadoSemAcesso oQueFalta="view.aquario, view.clientes ou view.monetizacao" />
        ) : (
          <EstadoErro
            detalhe={`Fonte: carga da Base de clientes. ${erro.message}`}
            tentarNovamente={() => void query.refetch()}
          />
        )}
      </main>
    );
  }
  // A carteira falhou (com o banco saturado as páginas estouram o tempo): a carga chega sem contas. Nenhuma das três
  // telas mostra zero no lugar do dado ausente (N4); diz o que houve e oferece tentar de novo.
  if (query.data.catalogo_indisponivel && !query.data.accounts.length)
    return (
      <main className="mx-auto max-w-[1700px] space-y-4 p-4 md:p-6">
        <PageHeader titulo={meta.titulo} pergunta={meta.pergunta} />
        {nav}
        <EstadoErro
          detalhe="A carteira da Base não carregou: o banco está ocupado e a leitura das contas estourou o tempo. Os números não foram zerados; tente de novo em instantes."
          tentarNovamente={() => void invalidate()}
        />
      </main>
    );
  const data = query.data,
    units = data.units.filter((u) => u.account_keys.length),
    pages = Math.max(1, Math.ceil(visible.length / 50)),
    currentPage = Math.min(page, pages);
  const contactsRows = (contacts.data || []).filter((c) =>
    c.accounts.some((k) => accountKeys.has(k)),
  );
  const exportRows = (linhas: Conta[] = visible) => {
    const records = linhas.map((a) => ({
      Empresa: a.name,
      Situacao: a.base?.situacao?.rotulo ?? "A calcular",
      Motivo_da_regra: a.base?.situacao?.motivo ?? "",
      CNPJ: a.base?.cnpjs.join(" / ") || "",
      Unidade: a.unit_label || "A confirmar",
      Origem: ORIGENS_BASE[origemBase(a)],
      Motivo: a.base?.origin_reason || "",
      Origem_no_Pipefy: a.base?.declared_origin.join(" / ") || "",
      Omie: a.base?.omie_units.join(" / ") || "",
      Contato: a.contact ? "Sim" : "Não",
      ECD: a.base?.ecd.map((e) => e.year).join(" / ") || "",
      Proximo_passo: a.base?.needs_source_correction
        ? "Corrigir origem no Pipefy"
        : a.base?.needs_validation
          ? "Validar origem com a unidade"
          : "Cadastro conferido",
    }));
    downloadCsv("base-clientes.csv", [
      [
        "Empresa",
        "Situação",
        "Motivo da regra",
        "CNPJ",
        "Unidade",
        "Origem",
        "Motivo",
        "Origem no Pipefy",
        "Omie",
        "Contato",
        "ECD",
        "Próximo passo",
      ],
      ...records.map((r) => Object.values(r)),
    ]);
  };
  // Um "Atualizar" só (o do Freshness): com escopo geral dispara a carga do CRM; sem ele, relê a
  // tela e o botão diz por quê. Antes havia dois, com efeitos diferentes.
  const refresh = async () => {
    setRefreshing(true);
    try {
      const disparou = podeEscrever(data);
      if (disparou) await sync({ data: { action: "sync" } });
      await invalidate();
      void health.refetch();
      if (sub === "contatos") void contacts.refetch();
      toast.success(disparou ? "Carga pedida" : "Tela relida");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const perimetro = unidadesSelecionadas.length
    ? unidadesSelecionadas.map((u) => u.name).join(", ")
    : "todas as unidades liberadas";
  const temFiltroTopo = !!(search.q || unidadesUrl.length || origensUrl.length || search.gate);
  const temFiltroClientes = !!(
    search.q ||
    unidadesUrl.length ||
    search.sit ||
    search.base ||
    search.nps ||
    temRecorte(recorte)
  );
  // Cobertura do NPS (P-04): clientes de grau 3 ou 4 do topo (busca e unidade) com contato do NPS de WhatsApp válido.
  const npsPorConta = resumoPedidos.data?.contas ?? {};
  const daMeta = rows.filter(
    (a) => ehCliente(a) && GRAUS_DA_META.includes(a.base?.situacao?.grau ?? 0),
  );
  const comNps = daMeta.filter((a) => !!npsPorConta[a.key]?.nps).length;
  const pedidosComCs =
    Object.values(npsPorConta).reduce((t, r) => t + r.pedidos, 0) +
    (resumoPedidos.data?.declarados.filter((p) => p.situacao === "aberto").length ?? 0);
  const contasClientes =
    search.nps === "sem" ? rowsNoRecorte.filter((a) => !npsPorConta[a.key]?.nps) : rowsNoRecorte;
  // O Painel não tem busca nem origem: só a unidade e o recorte valem nele.
  const chavesDasUnidades = new Set(unidadesSelecionadas.flatMap((u) => u.account_keys));
  const contasPainel = unidadesUrl.length
    ? data.accounts.filter((a) => chavesDasUnidades.has(a.key))
    : data.accounts;
  const contagemTudo = contarFaixas(data.accounts);
  const descricao =
    view === "clientes"
      ? `${number(contagemTudo.g4 + contagemTudo.g3 + contagemTudo.g2 + contagemTudo.g1)} clientes e ${number(contagemTudo.ex_cliente)} ex-clientes pela regra de cliente · todas as unidades liberadas · a busca diz se a empresa é cliente`
      : view === "painel"
        ? `Clientes pela regra de cliente · ${perimetro} · toque em qualquer número, barra ou filtro para ver as empresas`
        : view === "confianca"
          ? `${number(filtered.length)} empresas no recorte · ${perimetro} · cliente pela regra: ganho no Pipedrive, base de clientes do Pipefy, tag Cliente ou recebimento no Omie · o grau mede a certeza`
          : sub === "gates"
            ? `${number(filtered.length)} contas conciliadas no recorte · ${perimetro} · os recortes se sobrepõem e não somam`
            : sub === "contatos"
              ? `Pessoas vinculadas às ${number(filtered.length)} contas do recorte · ${perimetro}`
              : `${number(visible.length)} contas com origem a validar ou a corrigir no Pipefy · ${perimetro}`;
  const pagina = (
    <main className="mx-auto max-w-[1700px] space-y-4 p-4 md:p-6">
      <PageHeader
        titulo={meta.titulo}
        pergunta={meta.pergunta}
        descricao={descricao}
        procedencia={{ fonte: FONTE_BASE, atualizadoEm: data.catalog_at }}
        acoes={
          <Freshness
            data={data}
            refreshing={refreshing}
            onRefresh={refresh}
            motivoAtualizar={podeEscrever(data) ? null : MOTIVO_ATUALIZAR_SEM_ESCOPO}
          />
        }
      />
      {nav}
      {view === "pedidos" ? (
        <MeusPedidos />
      ) : view === "clientes" ? (
        <>
          <BarraFiltros>
            {/* Busca, unidade e origem existem só aqui: valem para todas as visões e a tabela da
            Base não tem controle próprio para elas. */}
            <label className="relative min-w-56 flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Buscar empresa, segmento ou CNPJ"
                className="pl-9"
                value={search.q}
                placeholder="Buscar empresa, segmento ou CNPJ"
                onChange={(e) => change({ q: e.target.value })}
              />
            </label>
            {/* Múltipla escolha (DECISIONS 18/09): as marcadas somam entre si. */}
            <div className="w-56">
              <MultiSelect
                label="Unidade"
                placeholder="Todas as unidades liberadas"
                value={unidadeKeys}
                onChange={(v) => change({ unidade: v.length ? v : undefined })}
                options={units.map((u) => ({ value: u.key, label: u.name }))}
              />
            </div>
            {/* Sempre montado (desabilitado sem filtro): sumir no clique jogava o foco no body. */}
            <BotaoComMotivo
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              disabled={!temFiltroClientes}
              motivo={temFiltroClientes ? null : "Nenhum filtro aplicado."}
              onClick={() =>
                change({
                  q: "",
                  unidade: undefined,
                  sit: undefined,
                  base: undefined,
                  nps: undefined,
                  ...buscaDoRecorte(RECORTE_VAZIO),
                })
              }
            >
              <X className="size-4" aria-hidden />
              Limpar filtros
            </BotaoComMotivo>
          </BarraFiltros>
          <FiltrosBase
            contas={populacaoClientes}
            perfil={perfil}
            recorte={recorte}
            aoMudar={mudarRecorte}
            rotulo={
              search.sit === "ex"
                ? "inativos"
                : search.base === "antiga"
                  ? "ativos da Base Antiga"
                  : search.base === "nova"
                    ? "ativos da Base Nova"
                    : "clientes ativos"
            }
          />
          <VisaoClientes
            contas={contasClientes}
            contasBusca={rows}
            extras={
              comAcoes
                ? [
                    { cabecalho: "Contato do NPS", celula: (a) => <CelulaNps conta={a} /> },
                    {
                      cabecalho: "Ações",
                      direita: true,
                      celula: (a) => <AcoesDaConta conta={a} />,
                    },
                  ]
                : undefined
            }
            acoesTabela={comAcoes ? <BotaoIncluirCliente /> : undefined}
            topo={
              comAcoes ? (
                <>
                  <KpiGrade colunas={2}>
                    <KpiCard
                      rotulo="Com contato do NPS"
                      valor={
                        resumoPedidos.data ? `${number(comNps)} de ${number(daMeta.length)}` : "…"
                      }
                      estado={
                        resumoPedidos.data
                          ? "ok"
                          : resumoPedidos.error
                            ? "indisponivel"
                            : "nao-apurado"
                      }
                      meta={{
                        valor: "80%",
                        rotulo: "meta antes da próxima rodada",
                        progresso: daMeta.length ? comNps / daMeta.length : 0,
                      }}
                      nota={`${daMeta.length ? Math.round((100 * comNps) / daMeta.length) : 0}% dos clientes com prova de cliente ou pagamento (graus 3 e 4) · ${search.nps === "sem" ? "filtro aplicado" : "ver quem está sem"}`}
                      abrir={{
                        rotulo: search.nps === "sem" ? "Tirar o filtro" : "Ver os sem contato",
                        onClick: () => change({ nps: search.nps === "sem" ? undefined : "sem" }),
                      }}
                      className={search.nps === "sem" ? "border-primary-text" : undefined}
                    />
                    <KpiCard
                      rotulo="Pedidos com o CS"
                      valor={resumoPedidos.data ? number(pedidosComCs) : "…"}
                      estado={
                        resumoPedidos.data
                          ? "ok"
                          : resumoPedidos.error
                            ? "indisponivel"
                            : "nao-apurado"
                      }
                      nota="Contatos, churn, não reconheço e clientes declarados · o CS responde em até 2 dias úteis"
                      abrir={{
                        rotulo: "Meus pedidos",
                        onClick: () => change({ view: "pedidos" }),
                      }}
                    />
                  </KpiGrade>
                  {search.nps === "sem" && (
                    <div className="flex flex-wrap gap-2">
                      <ChipFiltro
                        rotulo="Contato do NPS"
                        valor="sem contato"
                        aoRemover={() => change({ nps: undefined })}
                      />
                    </div>
                  )}
                  <DeclaradosPelaUnidade />
                </>
              ) : undefined
            }
            perfil={perfil}
            aoLimparRecorte={() => mudarRecorte(RECORTE_VAZIO)}
            busca={search.q}
            sit={search.sit === "ex" ? "ex" : "clientes"}
            base={search.base ?? null}
            aoMudar={(f) => change({ sit: f.sit, base: f.base })}
            pagina={page}
            aoMudarPagina={setPage}
            aoAbrir={setDetail}
          />
        </>
      ) : view === "painel" ? (
        <>
          <BarraFiltros>
            {/* Múltipla escolha (DECISIONS 18/09): as marcadas somam entre si. */}
            <div className="w-56">
              <MultiSelect
                label="Unidade"
                placeholder="Todas as unidades liberadas"
                value={unidadeKeys}
                onChange={(v) => change({ unidade: v.length ? v : undefined, numero: undefined })}
                options={units.map((u) => ({ value: u.key, label: u.name }))}
              />
            </div>
            <BotaoComMotivo
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              disabled={!unidadesUrl.length && !temRecorte(recorte)}
              motivo={unidadesUrl.length || temRecorte(recorte) ? null : "Nenhum filtro aplicado."}
              onClick={() =>
                change({
                  unidade: undefined,
                  numero: undefined,
                  ...buscaDoRecorte(RECORTE_VAZIO),
                })
              }
            >
              <X className="size-4" aria-hidden />
              Limpar filtros
            </BotaoComMotivo>
          </BarraFiltros>
          <PainelBase
            contas={contasPainel}
            unidades={unidadesSelecionadas.length ? unidadesSelecionadas : data.units}
            perfil={perfil}
            recorte={recorte}
            aoMudarRecorte={mudarRecorte}
            numero={search.numero ?? null}
            aoMudarNumero={(n) => change({ numero: n ?? undefined })}
            cards={data.cards}
            aoIrParaClientes={(patch) =>
              void navigate({
                search: {
                  ...search,
                  pagina: undefined,
                  numero: undefined,
                  view: "clientes",
                  sit: undefined,
                  base: undefined,
                  ...patch,
                },
                resetScroll: true,
              })
            }
            aoAbrirContratos={() => change({ view: "unidades", numero: undefined })}
          />
        </>
      ) : (
        <>
          <nav aria-label="Partes da Confiança" className="flex flex-wrap gap-2">
            {SUBS_CONFIANCA.filter(([k]) => !k || podeArrumar).map(([k, rotulo]) => (
              <button
                key={k || "graus"}
                type="button"
                aria-pressed={sub === k}
                onClick={() => change({ sub: k || undefined, sit: undefined, sinal: undefined })}
                className={`rounded-full border px-3 py-1 text-sm ${FOCO_VISIVEL} ${sub === k ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground"}`}
              >
                {rotulo}
                {k === "validar" && (
                  <span className="ml-2 rounded bg-warning-soft px-1.5 text-xs text-warning">
                    {pendentes}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {!sub ? (
            <>
              <BarraFiltros>
                {/* Busca, unidade e origem existem só aqui: valem para todas as visões e a tabela da
            Base não tem controle próprio para elas. */}
                <label className="relative min-w-56 flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    aria-label="Buscar empresa, segmento ou CNPJ"
                    className="pl-9"
                    value={search.q}
                    placeholder="Buscar empresa, segmento ou CNPJ"
                    onChange={(e) => change({ q: e.target.value })}
                  />
                </label>
                {/* Múltipla escolha (DECISIONS 18/09): as marcadas somam entre si. */}
                <div className="w-56">
                  <MultiSelect
                    label="Unidade"
                    placeholder="Todas as unidades liberadas"
                    value={unidadeKeys}
                    onChange={(v) => change({ unidade: v.length ? v : undefined })}
                    options={units.map((u) => ({ value: u.key, label: u.name }))}
                  />
                </div>
                <div className="w-56">
                  <MultiSelect
                    label="Origem da base"
                    placeholder="Todas as origens"
                    value={origensUrl}
                    onChange={(v) => change({ origem: v.length ? (v as OrigemBase[]) : undefined })}
                    options={Object.entries(ORIGENS_BASE).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </div>
                {search.gate && (
                  <ChipFiltro
                    rotulo="Refinamento"
                    valor={FUNIL.find(([g]) => g === search.gate)?.[1] ?? search.gate}
                    aoRemover={() => change({ gate: "" })}
                  />
                )}
                {/* Sempre montado (desabilitado sem filtro): sumir no clique jogava o foco no body. */}
                <BotaoComMotivo
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted-foreground"
                  disabled={!temFiltroTopo}
                  motivo={temFiltroTopo ? null : "Nenhum filtro aplicado."}
                  onClick={() => change({ q: "", unidade: undefined, origem: undefined, gate: "" })}
                >
                  <X className="size-4" aria-hidden />
                  Limpar filtros
                </BotaoComMotivo>
              </BarraFiltros>
              <section
                className="space-y-3 rounded-xl border bg-card p-4"
                aria-label="Barra de confiança"
              >
                <BarraConfianca
                  contagem={contagemConfianca}
                  selecionada={sinalConfianca ? null : sitConfianca}
                  aoEscolher={(f) => change({ sit: f ?? undefined, sinal: undefined })}
                />
                <p className="text-xs text-muted-foreground">
                  Todo verde é cliente pela regra; quanto mais escuro, mais certeza. Amarelo espera
                  o sócio confirmar e azul é ex-cliente.{" "}
                  {foraDaBaseNoTopo > 0
                    ? `${number(foraDaBaseNoTopo)} ${foraDaBaseNoTopo === 1 ? "empresa do recorte não é cliente pela regra e fica" : "empresas do recorte não são clientes pela regra e ficam"} fora da Base.`
                    : "Quem não é cliente pela regra fica fora da Base."}{" "}
                  Toque num pedaço da barra para ver as empresas.
                </p>
                <CertezaPorSinal
                  contagem={contagemSinais}
                  selecionado={sinalConfianca}
                  aoEscolher={(s) => change({ sinal: s ?? undefined, sit: undefined })}
                />
              </section>
              <TabelaContas
                titulo={
                  sinalConfianca
                    ? SINAL_META[sinalConfianca].rotulo
                    : sitConfianca
                      ? FAIXA_META[sitConfianca].rotulo
                      : "Empresas da base"
                }
                subtitulo={`${number(linhasConfianca.length)} empresas · das de mais certeza para as de menos · toque na empresa para abrir a ficha`}
                contas={linhasConfianca}
                colunas={["certeza", "unidade", "reuniao", "motivo"]}
                pagina={page}
                aoMudarPagina={setPage}
                aoAbrir={setDetail}
                acoes={
                  <Button size="sm" variant="outline" onClick={() => exportRows(linhasConfianca)}>
                    <Download className="mr-2 h-4 w-4" />
                    Exportar recorte
                  </Button>
                }
              />
            </>
          ) : (
            <>
              <BarraFiltros>
                {/* Busca, unidade e origem existem só aqui: valem para todas as visões e a tabela da
            Base não tem controle próprio para elas. */}
                <label className="relative min-w-56 flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    aria-label="Buscar empresa, segmento ou CNPJ"
                    className="pl-9"
                    value={search.q}
                    placeholder="Buscar empresa, segmento ou CNPJ"
                    onChange={(e) => change({ q: e.target.value })}
                  />
                </label>
                {/* Múltipla escolha (DECISIONS 18/09): as marcadas somam entre si. */}
                <div className="w-56">
                  <MultiSelect
                    label="Unidade"
                    placeholder="Todas as unidades liberadas"
                    value={unidadeKeys}
                    onChange={(v) => change({ unidade: v.length ? v : undefined })}
                    options={units.map((u) => ({ value: u.key, label: u.name }))}
                  />
                </div>
                <div className="w-56">
                  <MultiSelect
                    label="Origem da base"
                    placeholder="Todas as origens"
                    value={origensUrl}
                    onChange={(v) => change({ origem: v.length ? (v as OrigemBase[]) : undefined })}
                    options={Object.entries(ORIGENS_BASE).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </div>
                {search.gate && (
                  <ChipFiltro
                    rotulo="Refinamento"
                    valor={FUNIL.find(([g]) => g === search.gate)?.[1] ?? search.gate}
                    aoRemover={() => change({ gate: "" })}
                  />
                )}
                {/* Sempre montado (desabilitado sem filtro): sumir no clique jogava o foco no body. */}
                <BotaoComMotivo
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted-foreground"
                  disabled={!temFiltroTopo}
                  motivo={temFiltroTopo ? null : "Nenhum filtro aplicado."}
                  onClick={() => change({ q: "", unidade: undefined, origem: undefined, gate: "" })}
                >
                  <X className="size-4" aria-hidden />
                  Limpar filtros
                </BotaoComMotivo>
              </BarraFiltros>
              <KpiGrade colunas={4}>
                {FUNIL.map(([gate, label], index) => {
                  const ativo = search.gate === gate;
                  return (
                    <KpiCard
                      key={gate}
                      rotulo={`${index + 1} · ${label}`}
                      valor={number(counts[gate || "raw"])}
                      nota={`${
                        index === 0
                          ? "Contas conciliadas, sem multiplicar por contato"
                          : "Dentro do degrau anterior"
                      }${ativo && gate ? " · filtro aplicado" : ""}`}
                      abrir={{
                        // Clicar de novo no degrau aplicado tira o filtro (volta à base bruta).
                        rotulo: ativo && gate ? "Tirar o filtro" : "Filtrar",
                        onClick: () => change({ gate: ativo ? "" : gate }),
                      }}
                      className={ativo ? "border-primary-text" : undefined}
                    />
                  );
                })}
              </KpiGrade>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <p>
                  Funil cumulativo. Contato e ECD medem completude; não bloqueiam Consultoria. Uma
                  conta pode reunir CNPJs vinculados.
                </p>
                {/* Texto, não link: nenhuma visão lista a fila de envio ao Pipefy, e um link com total
            que o destino não mostra quebra N2. Enquanto carrega, não é "0". */}
                <p>
                  {health.isError
                    ? "Sincronização com o Pipefy indisponível"
                    : health.isPending
                      ? "Fila de envio ao Pipefy · carregando…"
                      : `${number(health.data?.pending_changes ?? 0)} alterações na fila de envio ao Pipefy`}
                </p>
                {perms.can("view.contatos") && (
                  <button
                    type="button"
                    className={`underline ${FOCO_VISIVEL}`}
                    onClick={() => change({ view: "confianca", sub: "contatos" })}
                  >
                    Ver contatos vinculados
                  </button>
                )}
              </div>
              {sub === "gates" ? (
                // Entenda os números (Arrumar a base): os números com produto, a carteira e as listas abrem na Monetização.
                <Aquario
                  embedded
                  accountKeys={accountKeys}
                  secao="gates"
                  irPara={irParaSecao}
                  accountKeysSemOrigem={accountKeysSemOrigem}
                  filtros={filtros}
                  mudarFiltros={mudarFiltros}
                  recorte={JSON.stringify([unidadeKeys, origensUrl, search.gate])}
                  painel={search.painel}
                  lista={search.lista}
                  aoAbrirLista={abrirLista}
                />
              ) : sub === "contatos" ? (
                // O número de pessoas só aparece com o dado: sem acesso ou carregando, "0 pessoas"
                // parecia recorte vazio (N4).
                !perms.can("view.contatos") ? (
                  <EstadoSemAcesso oQueFalta="view.contatos" />
                ) : contacts.isPending ? (
                  <Carregando variante="tabela" />
                ) : contacts.isError ? (
                  <EstadoErro
                    detalhe="Fonte: contatos vinculados no seu escopo."
                    tentarNovamente={() => void contacts.refetch()}
                  />
                ) : // Zero pessoas no recorte é vazio de filtro: diz quantas existem no seu escopo (N4).
                !contactsRows.length ? (
                  <EstadoVazio
                    titulo="Nenhuma pessoa vinculada às empresas deste recorte"
                    total={contacts.data?.length ? contacts.data.length : undefined}
                    descricao={
                      contacts.data?.length
                        ? undefined
                        : "Nenhum contato vinculado a empresas no seu escopo."
                    }
                  />
                ) : (
                  <section className="overflow-hidden rounded-xl border bg-card">
                    <div className="border-b p-4 text-sm font-medium">
                      <span className="num">{number(contactsRows.length)}</span> pessoas vinculadas
                      às empresas deste recorte
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {["Pessoa / cargo", "E-mail", "Telefone", "Empresa"].map((h) => (
                              <TableHead key={h}>{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {contactsRows.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell>
                                {c.name}
                                <div className="text-xs text-muted-foreground">{c.role}</div>
                              </TableCell>
                              <TableCell>{c.email || "—"}</TableCell>
                              <TableCell>{c.phone || "—"}</TableCell>
                              <TableCell>
                                {c.accounts
                                  .filter((k) => accountKeys.has(k))
                                  .map((k) => (
                                    <button
                                      key={k}
                                      type="button"
                                      className={`block text-left text-primary-text underline ${FOCO_VISIVEL}`}
                                      onClick={() =>
                                        setDetail(data.accounts.find((a) => a.key === k) || null)
                                      }
                                    >
                                      {data.accounts.find((a) => a.key === k)?.name}
                                    </button>
                                  ))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                )
              ) : (
                <section className="overflow-hidden rounded-xl border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
                    <div>
                      <h2 className="font-semibold">
                        {!sub ? "Validação da carteira por unidade" : "Empresas da base"}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {number(visible.length)} contas ·{" "}
                        {!sub
                          ? "Confira a origem, registre a evidência e acompanhe a correção."
                          : "Clique na empresa para abrir fontes, contatos e oportunidades."}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => exportRows()}>
                      <Download className="mr-2 h-4 w-4" />
                      Exportar recorte
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          {[
                            "Empresa / CNPJ",
                            "Unidade",
                            "Origem",
                            "Contato / ECD",
                            "Situação",
                            !sub ? "Validação" : "Produtos",
                          ].map((h) => (
                            <th className="px-4 py-3" key={h}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visible.slice((currentPage - 1) * 50, currentPage * 50).map((a) => (
                          <tr className="border-t hover:bg-muted/20" key={a.key}>
                            <td className="max-w-xs px-4 py-3">
                              <button
                                type="button"
                                className={`text-left font-medium hover:text-primary-text hover:underline ${FOCO_VISIVEL}`}
                                onClick={() => setDetail(a)}
                              >
                                {a.name}
                              </button>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {a.base?.cnpjs.join(" · ") || "CNPJ a refinar"}
                              </p>
                            </td>
                            <td className="max-w-[180px] px-4 py-3">
                              {a.unit_label || "A confirmar"}
                            </td>
                            <td className="px-4 py-3">
                              <Badge
                                variant={origemBase(a) === "confirmar" ? "outline" : "secondary"}
                              >
                                {ORIGENS_BASE[origemBase(a)]}
                              </Badge>
                              {!sub && (
                                <p className="mt-2 max-w-xs text-xs text-muted-foreground">
                                  {a.base?.origin_reason}
                                </p>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-xs">
                              <div>{a.contact ? "Com contato" : "Sem contato"}</div>
                              <div className="mt-1 text-muted-foreground">
                                {a.base?.ecd.length
                                  ? `ECD: ${[...new Set(a.base.ecd.map((e) => e.year))].join(", ")}`
                                  : "ECD não vinculada"}
                              </div>
                            </td>
                            <td className="max-w-[190px] px-4 py-3 text-xs">
                              {a.base?.needs_source_correction ? (
                                <span className="text-warning">Origem a corrigir no Pipefy</span>
                              ) : a.base?.source_status === "ok" ? (
                                <span className="inline-flex items-center gap-1 text-success">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Pipefy conferido
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-warning">
                                  <AlertCircle className="h-3 w-3" />
                                  {a.base?.source_status === "absent"
                                    ? "Ausente no Pipefy"
                                    : a.base?.source_status === "not_linked"
                                      ? "Sem vínculo Pipefy"
                                      : a.base?.synced_at
                                        ? "Cadastro com divergências"
                                        : "Leitura pendente"}
                                </span>
                              )}
                              <p className="mt-1 text-xs text-muted-foreground">
                                {a.base?.synced_at
                                  ? at(a.base.synced_at)
                                  : `${a.base?.omie_records || 0} registros Omie`}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              {!sub ? (
                                // Desabilitado diz o motivo (N8), em vez de um botão cinza mudo.
                                <BotaoComMotivo
                                  size="sm"
                                  variant="outline"
                                  disabled={!data.permissions.manage}
                                  motivo={data.permissions.manage ? null : "Exige manage.aquario"}
                                  onClick={() => setValidation(a)}
                                >
                                  Validar origem
                                </BotaoComMotivo>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {PRODUTOS.filter((p) => oferta(a, p).status === "elegivel").map(
                                    (p) => (
                                      <Badge key={p} variant="outline">
                                        {NOMES[p]}
                                      </Badge>
                                    ),
                                  )}
                                  {!PRODUTOS.some((p) => oferta(a, p).status === "elegivel") &&
                                    (situacaoForaDeOferta(a) ? (
                                      // Empresa fechada não é falta de dado: dizer "a qualificar" manda
                                      // o operador atrás de informação de um CNPJ que não existe mais.
                                      <span
                                        className="text-xs font-medium text-muted-foreground"
                                        title={a.situacao_receita_fonte ?? undefined}
                                      >
                                        Fora das ofertas · {rotuloSituacaoReceita(a)}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">
                                        A qualificar
                                      </span>
                                    ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!visible.length && (
                      // Vazio com total (N4): sem filtro é a fila zerada; com filtro, diz quantas
                      // pendências existem fora dele.
                      <EstadoVazio
                        className="m-4"
                        titulo={
                          !sub
                            ? temFiltroTopo
                              ? "Nenhuma conta a validar neste recorte"
                              : "Nenhuma conta com origem a validar"
                            : "Nenhuma empresa neste recorte"
                        }
                        total={
                          temFiltroTopo
                            ? !sub
                              ? data.accounts.filter(precisaValidar).length
                              : data.accounts.length
                            : undefined
                        }
                        descricao={
                          !sub && !temFiltroTopo
                            ? "Toda conta do seu escopo tem a origem confirmada ou já está com a correção na fila do Pipefy."
                            : undefined
                        }
                      />
                    )}
                  </div>
                  <footer className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                    <span>
                      Página {currentPage} de {pages} · 50 por página · {number(visible.length)}{" "}
                      contas
                    </span>
                    <div className="flex gap-2">
                      <BotaoComMotivo
                        variant="outline"
                        size="sm"
                        disabled={currentPage === 1}
                        motivo={currentPage === 1 ? "Já é a primeira página" : null}
                        onClick={() => setPage(currentPage - 1)}
                      >
                        Anterior
                      </BotaoComMotivo>
                      <BotaoComMotivo
                        variant="outline"
                        size="sm"
                        disabled={currentPage === pages}
                        motivo={currentPage === pages ? "Já é a última página" : null}
                        onClick={() => setPage(currentPage + 1)}
                      >
                        Próxima
                      </BotaoComMotivo>
                    </div>
                  </footer>
                </section>
              )}
            </>
          )}
        </>
      )}
      {view === "confianca" && (
        <details className="rounded-lg border bg-card px-4 py-3 text-xs">
          <summary className="cursor-pointer font-medium">Atualização das fontes</summary>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {(health.data?.sources || []).map((s: any) => (
              <div key={s.fonte} className="rounded border p-3">
                <strong>{s.fonte}</strong>
                <p className="mt-1">
                  {s.status} · {at(s.fim || s.inicio)} · {s.gravados}/{s.recebidos} registros
                </p>
                {s.erro && <p className="mt-1 text-destructive">{s.erro}</p>}
              </div>
            ))}
            {!health.data?.sources?.length && (
              <p>Ainda não há reconciliação concluída registrada.</p>
            )}
          </div>
        </details>
      )}
      <AccountDetail
        account={detail}
        cards={data.cards}
        close={() => {
          setDetail(null);
          if (search.item) change({ item: undefined });
        }}
      />
      <ValidarOrigem
        account={validation}
        close={() => setValidation(null)}
        done={() => {
          setValidation(null);
          void invalidate();
          void health.refetch();
        }}
      />
    </main>
  );
  return <AcoesBaseProvider contas={data.accounts}>{pagina}</AcoesBaseProvider>;
}
// Os mínimos que o botão já exigia, agora ditos no diálogo (a régua não muda).
const MIN_RESPONSAVEL = 3;
const MIN_EVIDENCIA = 10;
function ValidarOrigem({
  account,
  close,
  done,
}: {
  account: Conta | null;
  close: () => void;
  done: () => void;
}) {
  const fn = useServerFn(validarOrigemBase),
    [origin, setOrigin] = useState<"antiga" | "nova" | "">(""),
    [responsible, setResponsible] = useState(""),
    [evidence, setEvidence] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    setOrigin("");
    setResponsible("");
    setEvidence("");
  }, [account?.key]);
  const submit = async () => {
    if (!account || !origin) return;
    setSaving(true);
    try {
      const r = await fn({ data: { key: account.key, origin, responsible, evidence } });
      toast.success(
        r.status === "pending_source"
          ? "Validação registrada; correção do Pipefy na fila."
          : "Origem confirmada.",
      );
      setResponsible("");
      setEvidence("");
      done();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Validar origem da carteira</DialogTitle>
          <DialogDescription>
            {account?.name} · {account?.unit_label || "Unidade a confirmar"}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">{account?.base?.origin_reason}</p>
        <label className="space-y-1 text-xs">
          Origem confirmada
          <select
            className={inputClass}
            value={origin}
            onChange={(e) => setOrigin(e.target.value as "antiga" | "nova")}
          >
            <option value="">Selecione a origem confirmada</option>
            <option value="antiga">Base antiga</option>
            <option value="nova">Base nova</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          Responsável da unidade
          <Input
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
            placeholder="Quem confirmou a origem"
            aria-describedby="validar-min-responsavel"
          />
          <span id="validar-min-responsavel" className="block text-muted-foreground">
            Mínimo de {MIN_RESPONSAVEL} letras
          </span>
        </label>
        <label className="space-y-1 text-xs">
          Evidência da confirmação
          <textarea
            className={`${inputClass} min-h-24`}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Como e quando a unidade confirmou esta carteira"
            aria-describedby="validar-min-evidencia"
          />
          <span id="validar-min-evidencia" className="block text-muted-foreground">
            Mínimo de {MIN_EVIDENCIA} caracteres ·{" "}
            <span className="num">{evidence.trim().length}</span> escritos
          </span>
        </label>
        <p className="text-xs text-muted-foreground">
          O registro guarda seu usuário e a data. Se houver correção no Pipefy, o espelho muda após
          a confirmação da origem.
        </p>
        <BotaoComMotivo
          disabled={
            saving ||
            !origin ||
            responsible.trim().length < MIN_RESPONSAVEL ||
            evidence.trim().length < MIN_EVIDENCIA
          }
          motivo={[
            saving && "Registrando a validação",
            !origin && "Escolha a origem confirmada",
            responsible.trim().length < MIN_RESPONSAVEL &&
              `O responsável precisa de ${MIN_RESPONSAVEL}+ letras`,
            evidence.trim().length < MIN_EVIDENCIA &&
              `A evidência precisa de ${MIN_EVIDENCIA}+ caracteres`,
          ]}
          onClick={submit}
        >
          {saving ? "Registrando…" : "Registrar validação"}
        </BotaoComMotivo>
      </DialogContent>
    </Dialog>
  );
}
