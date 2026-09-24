import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Search, CheckCircle2, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { acionarMonetizacao } from "@/lib/monetizacao/functions";
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
import { Aquario, type SecaoAquario } from "@/components/monetizacao/aquario";
import { ContratosClientes } from "./contratos-clientes";
import {
  BarraFiltros,
  Carregando,
  ChipFiltro,
  EstadoErro,
  EstadoSemAcesso,
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
import { buscaDosFiltros, filtrosDaBusca, type BuscaClientes } from "./busca";

// UM menu só. Antes eram duas faixas empilhadas: estas seis abas mais as cinco do Aquário por
// dentro. As do Aquário subiram para cá ("Base de clientes", "Produtos e listas", "Entenda os
// números") e a tela de baixo perdeu a navegação própria.
// "Empresas" saiu porque foi promovida: busca por CNPJ, coluna de CNPJ, espelho do Pipefy e as
// colunas do CSV agora vivem na tabela da carteira. "Negócios" morreu — era um recorte pior do
// que /monetizacao?aba=operacao já mostra. "Contatos" saiu da faixa e segue alcançável pelo link
// no rodapé do funil: o dado é único no produto, o lugar é que estava errado.
const views = [
  ["monetizacao", "Base de clientes"],
  ["produtos", "Produtos e listas"],
  ["pendencias", "Validar origem"],
  ["contratos", "Contratos e churn"],
  ["gates", "Entenda os números"],
];
// Título (o item do menu interno) e pergunta (N1) de cada visão: contrato `clientes.md`.
const VISOES: Record<string, { titulo: string; pergunta: string }> = {
  monetizacao: {
    titulo: "Base de clientes",
    pergunta:
      "Quais contas desta unidade atendem ao recorte, e quais estão prontas para trabalhar?",
  },
  produtos: {
    titulo: "Produtos e listas",
    pergunta: "Quantas contas cada produto pode trabalhar agora, e em que lista elas estão?",
  },
  pendencias: {
    titulo: "Validar origem",
    pergunta: "Quais contas ainda precisam ter a origem confirmada?",
  },
  contratos: {
    titulo: "Contratos e churn",
    pergunta: "Quais clientes estão ativos, e quais deram churn?",
  },
  gates: { titulo: "Entenda os números", pergunta: "De onde vem cada número da base?" },
  contatos: {
    titulo: "Contatos",
    pergunta: "Quem são as pessoas das empresas deste recorte?",
  },
};
// A mensagem do servidor quando falta view.aquario, view.clientes e view.monetizacao ao mesmo
// tempo (`carregarMonetizacao`): vira EstadoSemAcesso, não erro.
const ACESSO_NEGADO = /^Seu acesso não inclui/;
const MOTIVO_ATUALIZAR_SEM_ESCOPO = "Relê a tela; disparar a carga do CRM exige escopo geral";
const FONTE_BASE = "Catálogo da Base (Pipefy + Omie, conciliados)";
// As três views que o Aquário atende, e a seção que cada uma pede.
const SECOES_AQUARIO: Record<string, SecaoAquario> = {
  monetizacao: "base",
  produtos: "produtos",
  gates: "gates",
};
const VIEW_DA_SECAO: Record<SecaoAquario, string> = {
  base: "monetizacao",
  produtos: "produtos",
  gates: "gates",
};
// Fora da faixa, mas endereçável: o link no rodapé do funil leva aqui. Sem isso a view cairia
// no fallback e os contatos ficariam inalcançáveis.
const viewsOcultas = ["contatos"];
// Degraus do funil de refinamento: `gate` da URL, rótulo e chave em `counts`. "Com CNPJ" (não
// "válido"): o degrau só testa se há CNPJ.
const FUNIL = [
  ["", "Bruta"],
  ["cnpj", "Com CNPJ"],
  ["contato", "Com contato"],
  ["ecd", "Com ECD registrada"],
] as const;
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
  const view =
    views.some(([v]) => v === search.view) || viewsOcultas.includes(search.view)
      ? search.view
      : "monetizacao";
  const change = (patch: Partial<BuscaClientes>) => {
    setPage(1);
    void navigate({ search: { ...search, ...patch }, replace: true });
  };
  const [page, setPage] = useState(1),
    [detail, setDetail] = useState<Conta | null>(null),
    [validation, setValidation] = useState<Conta | null>(null);
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
    enabled: view === "contatos" && perms.can("view.contatos"),
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
  const rowsSemOrigem = useMemo(() => {
    const data = query.data;
    if (!data) return [];
    const unitKeys = new Set(unidadesSelecionadas.flatMap((u) => u.account_keys));
    return data.accounts.filter((a) => {
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
  const visible =
    view === "pendencias"
      ? filtered.filter((a) => a.base?.needs_validation || a.base?.needs_source_correction)
      : filtered;
  const accountKeys = useMemo(() => new Set(filtered.map((a) => a.key)), [filtered]);
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
  ]);
  const filtros = useMemo(
    () => filtrosDaBusca(search, unidadeKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assinaturaFiltros],
  );
  const mudarFiltros = (f: PortfolioFilters, destino?: SecaoAquario) => {
    setPage(1);
    void navigate({
      search: {
        ...search,
        ...buscaDosFiltros(f),
        ...(destino ? { view: VIEW_DA_SECAO[destino] } : {}),
      },
      replace: true,
    });
  };
  const meta = VISOES[view] ?? VISOES.monetizacao;
  const pendentes = rows.filter(
    (a) => a.base?.needs_validation || a.base?.needs_source_correction,
  ).length;
  const nav = (
    <nav aria-label="Visões da base" className="flex gap-1 overflow-x-auto border-b">
      {views.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-current={view === key ? "page" : undefined}
          onClick={() => change({ view: key })}
          className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm ${FOCO_VISIVEL} ${view === key ? "border-primary font-semibold text-primary-text" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {label}
          {key === "pendencias" && query.data && (
            <span className="ml-2 rounded bg-warning-soft px-1.5 text-xs text-warning">
              {pendentes}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
  // A visão Contratos e churn lê as próprias fontes (empresas, Central de Tratativas): não espera
  // a carga da Monetização, e uma falha dela não tranca esta visão.
  if (view === "contratos") {
    // Contratos filtra UMA unidade, por nome. A chave da URL só vira nome quando a carga chega;
    // antes disso a visão abre sem unidade e sincroniza depois (useEffect em ContratosClientes).
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
        ? "A unidade da URL não pôde ser resolvida (a carga da Base falhou): a lista abre sem filtro de unidade."
        : nomes.length > 1
          ? "Contratos e churn filtra uma unidade por vez: a lista abre sem filtro de unidade."
          : null;
    return (
      <main className="mx-auto max-w-[1700px] space-y-4 p-4 md:p-6">
        <PageHeader
          titulo={meta.titulo}
          pergunta={meta.pergunta}
          descricao="Clientes com contrato na base de empresas · churn pela Central de Tratativas"
        />
        {nav}
        {aviso && (
          <p role="status" className="text-sm text-muted-foreground">
            {aviso}
          </p>
        )}
        <ContratosClientes
          statusParam={search.status}
          // A Base guarda a CHAVE da unidade na URL (`monetizacao_unidades.key`), e a de
          // contratos filtra por nome (`empresas.unidade`). Sem traduzir aqui, trocar de visão
          // com uma unidade filtrada zerava a lista inteira.
          unidadeParam={nomes.length === 1 ? nomes[0] : ""}
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
  const data = query.data,
    units = data.units.filter((u) => u.account_keys.length),
    pages = Math.max(1, Math.ceil(visible.length / 50)),
    currentPage = Math.min(page, pages);
  const contactsRows = (contacts.data || []).filter((c) =>
    c.accounts.some((k) => accountKeys.has(k)),
  );
  const exportRows = () => {
    const records = visible.map((a) => ({
      Empresa: a.name,
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
      if (view === "contatos") void contacts.refetch();
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
  const descricao =
    view === "produtos"
      ? `${number(filtered.length)} contas conciliadas no recorte · ${perimetro} · Consultoria, Cella, Finance e Recon, cada um pela própria régua · a mesma conta pode estar em mais de um produto`
      : view === "pendencias"
        ? `${number(visible.length)} contas com origem a validar ou a corrigir no Pipefy · ${perimetro}`
        : view === "gates"
          ? `${number(filtered.length)} contas conciliadas no recorte · ${perimetro} · os recortes se sobrepõem e não somam`
          : view === "contatos"
            ? `Pessoas vinculadas às ${number(filtered.length)} contas do recorte · ${perimetro}`
            : `${number(filtered.length)} contas conciliadas no recorte · ${perimetro} · catálogo Pipefy + Omie · uma conta pode reunir CNPJs vinculados`;
  return (
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
              options={Object.entries(ORIGENS_BASE).map(([value, label]) => ({ value, label }))}
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
            Funil cumulativo. Contato e ECD medem completude; não bloqueiam Consultoria. Uma conta
            pode reunir CNPJs vinculados.
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
              onClick={() => change({ view: "contatos" })}
            >
              Ver contatos vinculados
            </button>
          )}
        </div>
        {SECOES_AQUARIO[view] ? (
          // Mesma posição no JSX para as tres seções: o Aquario NAO desmonta ao trocar de
          // entrada do menu, entao filtro, seleção e rascunho de lista sobrevivem à navegação.
          <Aquario
            embedded
            accountKeys={accountKeys}
            secao={SECOES_AQUARIO[view]}
            irPara={(s) => change({ view: VIEW_DA_SECAO[s] })}
            accountKeysSemOrigem={accountKeysSemOrigem}
            filtros={filtros}
            mudarFiltros={mudarFiltros}
            recorte={JSON.stringify([unidadeKeys, origensUrl, search.gate])}
          />
        ) : view === "contatos" ? (
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
          ) : (
            <section className="overflow-hidden rounded-xl border bg-card">
              <div className="border-b p-4 text-sm font-medium">
                {number(contactsRows.length)} pessoas vinculadas às empresas deste recorte
              </div>
              {
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                      <tr>
                        {["Pessoa / cargo", "E-mail", "Telefone", "Empresa"].map((h) => (
                          <th key={h} className="p-3">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contactsRows.map((c) => (
                        <tr key={c.id} className="border-t">
                          <td className="p-3">
                            {c.name}
                            <div className="text-xs text-muted-foreground">{c.role}</div>
                          </td>
                          <td className="p-3">{c.email || "—"}</td>
                          <td className="p-3">{c.phone || "—"}</td>
                          <td className="p-3">
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
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
            </section>
          )
        ) : (
          <section className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
              <div>
                <h2 className="font-semibold">
                  {view === "pendencias" ? "Validação da carteira por unidade" : "Empresas da base"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {number(visible.length)} contas ·{" "}
                  {view === "pendencias"
                    ? "Confira a origem, registre a evidência e acompanhe a correção."
                    : "Clique na empresa para abrir fontes, contatos e oportunidades."}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={exportRows}>
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
                      view === "pendencias" ? "Validação" : "Produtos",
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
                          className="text-left font-medium hover:text-primary-text hover:underline"
                          onClick={() => setDetail(a)}
                        >
                          {a.name}
                        </button>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {a.base?.cnpjs.join(" · ") || "CNPJ a refinar"}
                        </p>
                      </td>
                      <td className="max-w-[180px] px-4 py-3">{a.unit_label || "A confirmar"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={origemBase(a) === "confirmar" ? "outline" : "secondary"}>
                          {ORIGENS_BASE[origemBase(a)]}
                        </Badge>
                        {view === "pendencias" && (
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
                        {view === "pendencias" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!data.permissions.manage}
                            onClick={() => setValidation(a)}
                          >
                            Validar origem
                          </Button>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {PRODUTOS.filter((p) => oferta(a, p).status === "elegivel").map((p) => (
                              <Badge key={p} variant="outline">
                                {NOMES[p]}
                              </Badge>
                            ))}
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
                                <span className="text-xs text-muted-foreground">A qualificar</span>
                              ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  Nenhuma empresa neste recorte. Limpe os filtros para revisar a base.
                </p>
              )}
            </div>
            <footer className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
              <span>
                Página {currentPage} de {pages} · 50 por página
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Próxima
                </Button>
              </div>
            </footer>
          </section>
        )}
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
      </>
      <AccountDetail account={detail} cards={data.cards} close={() => setDetail(null)} />
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
}
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
          />
        </label>
        <label className="space-y-1 text-xs">
          Evidência da confirmação
          <textarea
            className={`${inputClass} min-h-24`}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Como e quando a unidade confirmou esta carteira"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          O registro guarda seu usuário e a data. Se houver correção no Pipefy, o espelho muda após
          a confirmação da origem.
        </p>
        <Button
          disabled={
            saving || !origin || responsible.trim().length < 3 || evidence.trim().length < 10
          }
          onClick={submit}
        >
          {saving ? "Registrando…" : "Registrar validação"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
