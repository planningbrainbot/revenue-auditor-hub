import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowRight,
  CheckCheck,
  CheckCircle2,
  Download,
  Fish,
  ListPlus,
  Search,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMonetizacao, useAtualizarMonetizacao } from "@/hooks/use-monetizacao";
import { acionarMonetizacao } from "@/lib/monetizacao/functions";
import {
  baseRetroativaConsultoria,
  disponibilidade,
  FAIXAS,
  faturamentoDeclarado,
  oferta,
  tetoEmReais,
  rotuloSituacaoReceita,
  situacaoForaDeOferta,
  tetoContradizFaixa,
} from "@/lib/monetizacao/model";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, Conta, Produto, Unidade } from "@/lib/monetizacao/types";
import { AccountDetail } from "./account-detail";
import { ReconAquario } from "./recon";
import { ofertaRecon, potencialRecon } from "@/lib/monetizacao/recon";
import { ListWorkspace } from "./list-workspace";
import { DirectSend } from "./direct-send";
import { ProcedenciaBase } from "./procedencia-base";
import {
  ABORDAGENS,
  EMPTY_PORTFOLIO_FILTERS,
  estadoProduto,
  filtrarCarteira,
  ORIGENS_BASE,
  origemBase,
  potencialConsultoria,
  PROCEDENCIA_EXPLICACAO,
  soNoOmie,
  situacoesIniciais,
  SITUACOES,
  SITUACOES_RECEITA_FILTRO,
} from "@/lib/monetizacao/portfolio";
import type {
  Abordagem,
  EstadoProduto,
  OrigemBase,
  PortfolioFilters,
  Situacao,
} from "@/lib/monetizacao/portfolio";
import { FieldMulti, MultiSelect } from "./multi-select";
import { EstadoVazio, KpiCard, KpiGrade, Secao, type TomKpi } from "@/components/planning";
import {
  BotaoComMotivo,
  date,
  FOCO_VISIVEL,
  downloadCsv,
  FalhaDeCarga,
  Field,
  Freshness,
  inputClass,
  Kpi,
  LoadingState,
  Notice,
  number,
  OfertaTag,
  Panel,
  SecaoCartao,
} from "./common";

type Filters = PortfolioFilters;
// Mesmo limite da validação do servidor para listas e envios (salvarListaAquario / monetizacao_save_list).
const LIMITE_LOTE = 300;
// Valor explícito de "todas as situações": vazio significa a situação padrão do produto.
const TODAS = "todas";
const emptyFilters = EMPTY_PORTFOLIO_FILTERS;
// As seções que antes eram a faixa de abas de dentro do Aquário. Elas subiram para o menu único
// da Base de clientes: a tela deixa de ter navegação própria e passa a obedecer a de cima.
export type SecaoAquario = "base" | "produtos" | "gates";

export function Aquario({
  embedded = false,
  accountKeys,
  secao = "base",
  irPara,
  filtros,
  mudarFiltros,
  recorte,
  accountKeysSemOrigem,
}: {
  embedded?: boolean;
  accountKeys?: Set<string>;
  secao?: SecaoAquario;
  irPara?: (s: SecaoAquario) => void;
  /**
   * Filtros da tabela controlados por fora (a Base de clientes os guarda na URL). Com eles, a
   * tabela não desenha busca, unidade e origem: essas três são do topo da página.
   */
  filtros?: Filters;
  /** Grava os filtros e, com `destino`, troca de seção na mesma navegação. */
  mudarFiltros?: (f: Filters, destino?: SecaoAquario) => void;
  /** Assinatura do recorte do topo (unidade, origem, refinamento): mudou, a seleção é limpa. */
  recorte?: string;
  /**
   * Contas do recorte do topo SEM o filtro de origem: os cartões de origem da gaveta contam sobre
   * elas, porque o clique aplica a origem (contar com ela mostraria 0 e abriria N).
   */
  accountKeysSemOrigem?: Set<string>;
} = {}) {
  const q = useMonetizacao(),
    invalidate = useAtualizarMonetizacao(),
    sync = useServerFn(acionarMonetizacao);
  // `irPara` é opcional para o Aquário seguir montável fora da casca; sem ele, a seção é fixa.
  const ir = irPara ?? (() => {});
  const [unit, setUnit] = useState<Unidade | null>(null),
    [account, setAccount] = useState<Conta | null>(null);
  const [filtrosLocais, setFiltrosLocais] = useState<Filters>(emptyFilters),
    [picked, setPicked] = useState<Set<string>>(new Set());
  const filters = filtros ?? filtrosLocais;
  const controlado = !!mudarFiltros;
  // Um caminho só para gravar filtro: na URL (controlado) ou no estado local. Com `destino`, o
  // filtro e a troca de seção vão na mesma navegação (duas seguidas, a segunda apagava a primeira).
  const aplicar = (f: Filters, destino?: SecaoAquario) => {
    if (mudarFiltros) mudarFiltros(f, destino);
    else {
      setFiltrosLocais(f);
      if (destino) ir(destino);
    }
  };
  const setFilters = (f: Filters) => aplicar(f);
  // Mudar o recorte limpa a seleção: nunca enviar conta que saiu da tela (decisão de 16/09).
  useEffect(() => setPicked(new Set()), [recorte]);
  const [draft, setDraft] = useState<{
    unit: Unidade | null;
    accounts: string[];
    product: Produto;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const data = useMemo(
    () =>
      q.data &&
      (accountKeys
        ? { ...q.data, accounts: q.data.accounts.filter((a) => accountKeys.has(a.key)) }
        : q.data),
    [q.data, accountKeys],
  );
  if (!data) return <LoadingState error={q.error} retry={() => q.refetch()} />;
  const unitKeys = new Set(unit?.account_keys);
  const unitAccounts = unit ? data.accounts.filter((a) => unitKeys.has(a.key)) : data.accounts;
  const unitAccountsSemOrigem = accountKeysSemOrigem
    ? (q.data?.accounts ?? []).filter(
        (a) => accountKeysSemOrigem.has(a.key) && (!unit || unitKeys.has(a.key)),
      )
    : unitAccounts;
  const refresh = async () => {
    setRefreshing(true);
    try {
      if (data.permissions.view && data.permissions.all_units)
        await sync({ data: { action: "sync" } });
      await invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const startList = (keys: string[], forUnit: Unidade | null, product: Produto) => {
    setDraft({ unit: forUnit, accounts: keys, product });
    setUnit(null);
    ir("produtos");
    setPicked(new Set());
  };
  const cella = data.accounts.filter((a) => oferta(a, "cella").status === "elegivel"),
    // A régua do Cella não pergunta se a empresa é cliente — pede ativa, fora do Simples e
    // faturamento. Quem entrou só pelo ERP da unidade passa nela sem nunca ter sido declarado
    // cliente por ninguém, então o cartão mostra o recorte em vez de um total que engana.
    cellaSoOmie = cella.filter(soNoOmie),
    consult = data.accounts.filter((a) => oferta(a, "consultoria").status === "elegivel"),
    consultPool = data.accounts.filter(potencialConsultoria),
    consultPending = consultPool.filter((a) => oferta(a, "consultoria").status === "revisar"),
    consultBase = data.accounts.filter(baseRetroativaConsultoria),
    // Exclusão por regime e exclusão por situação cadastral são motivos diferentes; misturá-las
    // faria o cartão afirmar que centenas de empresas fechadas são do Simples.
    consultExcluded = consultBase.filter(
      (a) => oferta(a, "consultoria").status === "fora_regra" && !situacaoForaDeOferta(a),
    ),
    consultInativas = consultBase.filter((a) => situacaoForaDeOferta(a)),
    finance = data.accounts.filter((a) => oferta(a, "finance").status === "elegivel");
  const overlap = data.accounts.filter(
    (a) =>
      PRODUTOS.filter((p) => oferta(a, p).status === "elegivel").length +
        Number(ofertaRecon(a).status === "elegivel") >
      1,
  );
  // O destino de um cartão de Produtos: a tabela da Base com este recorte. A origem do topo fica
  // (os números dos cartões já a respeitam). O número do cartão e o total do destino saem do
  // mesmo objeto de filtro, para baterem (N2).
  const destino = (f: Partial<Filters>): Filters => ({
    ...emptyFilters,
    origin: filters.origin,
    ...f,
  });
  const abrirNaBase = (f: Partial<Filters>) => {
    aplicar(destino(f), "base");
    setPicked(new Set());
  };
  const content = (rows: Conta[], drawer = false) => (
    <PortfolioTable
      data={data}
      accounts={rows}
      filters={filters}
      setFilters={setFilters}
      picked={picked}
      setPicked={setPicked}
      showAccount={setAccount}
      onList={(keys) => startList(keys, unit, filters.product || "consultoria")}
      inUnit={drawer}
      unitId={unit?.id ?? null}
      controlesNoTopo={controlado}
    />
  );
  return (
    <main className={embedded ? "space-y-4" : "mx-auto max-w-[1600px] space-y-4 p-4 md:p-6"}>
      {/* Embutido na Base de clientes, o cabeçalho e o Freshness são da casca: o "Atualizar" do
          PageHeader é o do Freshness, e havia dois com efeitos diferentes. */}
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Fish className="h-6 w-6 text-primary-text" />
            <div>
              <h1 className="text-2xl font-semibold">Base de clientes</h1>
              <p className="text-xs text-muted-foreground">
                Base de clientes · carteiras e listas para os sócios
              </p>
            </div>
          </div>
          <Freshness data={data} refreshing={refreshing} onRefresh={refresh} />
        </div>
      )}
      <FalhaDeCarga data={data} />
      {!data.permissions.all_units && !data.units.length && (
        <Notice>
          Seu acesso está ativo, mas nenhuma unidade foi liberada para você. A administração precisa
          definir suas carteiras.
        </Notice>
      )}
      {secao === "produtos" && (
        <>
          <Secao
            titulo="Quantas contas cada régua de produto aceita?"
            descricao="Perfil aderente, esteja a conta disponível ou já em trabalho. Os cartões que filtram abrem a Base de clientes com o mesmo recorte, e o total de lá bate com o daqui."
          >
            <KpiGrade colunas={6} className="xl:grid-cols-5">
              <KpiCard
                rotulo="Contas na base conciliada"
                valor={number(data.accounts.length)}
                nota="Uma conta, mesmo com mais de um produto"
              />
              <KpiCard
                // N11: este número tira os "só no Omie"; o cartão do Cella, abaixo, os inclui.
                rotulo="Cella · perfil aderente (sem os só no Omie)"
                valor={number(cella.length - cellaSoOmie.length)}
                nota={
                  cellaSoOmie.length
                    ? `A partir de R$ 25 mi · fora do Simples. Fora destas, ${number(cellaSoOmie.length)} passam na régua mas só existem no Omie da unidade.`
                    : "A partir de R$ 25 mi · fora do Simples"
                }
                // Aptas sem "só no Omie" = prontas + já em trabalho (estadoProduto).
                abrir={{
                  rotulo: "Abrir na base",
                  onClick: () => abrirNaBase({ product: "cella", status: ["free", "occupied"] }),
                }}
              />
              <KpiCard
                // Não abre: nenhuma situação da tabela é exatamente a carteira retroativa inteira
                // (a "base retroativa" da tabela já tira os fora da regra), e o total não bateria.
                rotulo="Consultoria · carteira retroativa (base inteira)"
                valor={number(consultBase.length)}
                nota={`${number(consult.length)} aptas · ${number(consultExcluded.length)} por Simples/MEI · ${number(consultInativas.length)} inativas na Receita · ${number(consultPending.length)} a confirmar`}
              />
              <KpiCard
                rotulo="Finance · perfil aderente"
                valor={number(finance.length)}
                nota="Contrato Pipedrive · abaixo de R$ 25 mi · fora do Simples"
                abrir={{
                  rotulo: "Abrir na base",
                  onClick: () => abrirNaBase({ product: "finance", status: ["eligible"] }),
                }}
              />
              <KpiCard
                rotulo="Mais de um produto"
                valor={number(overlap.length)}
                nota="Contas já incluídas nos produtos ao lado"
                // Mesma fórmula do filtro de sobreposição da tabela (filtrarCarteira).
                abrir={{ rotulo: "Abrir na base", onClick: () => abrirNaBase({ overlap: true }) }}
              />
            </KpiGrade>
          </Secao>
          <Secao
            titulo="Quantas contas cada produto pode trabalhar agora?"
            descricao="O número grande são as prontas para enviar: aptas, disponíveis e fora do grupo “só no Omie”. O cartão abre a Base de clientes nessa situação. A mesma conta pode aparecer em mais de uma lista; a seleção define o produto preenchido no Pipedrive, e contato é opcional."
            acoes={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  abrirNaBase({
                    product: "consultoria",
                    origin: ["antiga"],
                    status: ["qualificar"],
                  })
                }
              >
                Conferir regime da base retroativa
              </Button>
            }
          >
            <KpiGrade colunas={4}>
              <KpiCard
                rotulo="Recon"
                valor={number(data.accounts.filter(potencialRecon).length)}
                unidade="contas no radar"
                nota={`${number(data.accounts.filter((a) => ofertaRecon(a).status === "elegivel").length)} aptas · acima de R$ 5 mi · fora de qualquer BPO · seleção e exportação no painel abaixo`}
                abrir={{
                  rotulo: "Ver no painel",
                  onClick: () => {
                    const painel = document.getElementById("painel-recon");
                    painel?.scrollIntoView({ behavior: "smooth" });
                    painel?.focus({ preventScroll: true });
                  },
                }}
              />
              {(["consultoria", "cella", "finance"] as Produto[]).map((p) => {
                const eligible = data.accounts.filter((a) => oferta(a, p).status === "elegivel");
                // O número é o total do destino: a situação "prontas" da tabela, pela mesma
                // função que a tabela usa. As aptas e disponíveis que só existem no Omie da
                // unidade ficam fora dela (grupo próprio) e são ditas na nota.
                const prontas = filtrarCarteira(
                  data.accounts,
                  destino({ product: p, status: ["free"] }),
                  data,
                );
                const livresSoOmie = eligible.filter(
                  (a) =>
                    soNoOmie(a) &&
                    disponibilidade(a, p, data.cards, undefined, data.reservations).free,
                ).length;
                return (
                  <KpiCard
                    key={p}
                    rotulo={NOMES[p]}
                    valor={number(prontas.length)}
                    unidade="prontas para enviar"
                    nota={
                      <>
                        <span className="block">
                          {p === "consultoria"
                            ? `${number(eligible.length)} aptas · ${number(consultPool.length)} retroativas aptas à análise, de ${number(consultBase.length)} na carteira retroativa (base inteira)`
                            : p === "cella"
                              ? `${number(eligible.length)} com perfil aderente (inclui só no Omie)`
                              : `${number(eligible.length)} com perfil aderente`}
                          {p === "consultoria" &&
                            consultPending.length > 0 &&
                            ` · ${number(consultPending.length)} a confirmar`}
                          {livresSoOmie > 0 &&
                            ` · ${number(livresSoOmie)} aptas e disponíveis só no Omie ficam fora das prontas`}
                        </span>
                        <span className="mt-1 block">
                          {p === "consultoria"
                            ? "Base Antiga · sem fechamento comercial · contato opcional"
                            : p === "cella"
                              ? "A partir de R$ 25 mi · fora do Simples"
                              : "Contrato ganho no Pipedrive · abaixo de R$ 25 mi"}
                        </span>
                      </>
                    }
                    abrir={{
                      rotulo: "Abrir prontas",
                      onClick: () => abrirNaBase({ product: p, status: ["free"] }),
                    }}
                  />
                );
              })}
            </KpiGrade>
          </Secao>
          <div
            id="painel-recon"
            tabIndex={-1}
            className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ReconAquario accounts={data.accounts} showAccount={setAccount} />
          </div>
        </>
      )}
      {secao === "base" && (
        <div className="space-y-4">
          <Secao
            titulo="Qual unidade você vai organizar?"
            descricao="O número grande é o cadastro da unidade e não segue os filtros; as contas abaixo dele são as do recorte. As carteiras podem compartilhar contas: não some os totais por unidade. Para a Consultoria, a falta de contato pode ser resolvida com o sócio."
          >
            <KpiGrade colunas={3}>
              {data.units.map((u) => {
                const keys = new Set(u.account_keys);
                const accounts = data.accounts.filter((a) => keys.has(a.key)),
                  c = accounts.filter((a) => oferta(a, "consultoria").status === "elegivel").length,
                  pending = accounts.filter(
                    (a) => potencialConsultoria(a) && oferta(a, "consultoria").status === "revisar",
                  ).length,
                  f = accounts.filter((a) => oferta(a, "finance").status === "elegivel").length,
                  cella_u = accounts.filter((a) => oferta(a, "cella").status === "elegivel").length,
                  antigas = accounts.filter((a) => origemBase(a) === "antiga").length,
                  novas = accounts.filter((a) => origemBase(a) === "nova").length,
                  conferir = accounts.filter((a) =>
                    ["confirmar", "divergente"].includes(origemBase(a)),
                  ).length;
                // Sem linha em monetizacao_unidade_cobertura o servidor devolve zeros: é "não
                // apurado", não uma unidade com 0 CNPJs e Omie desligado (N4, N11).
                const semCobertura = !u.cnpjs && !u.cnpjs_pipefy && !u.cnpjs_omie;
                return (
                  <KpiCard
                    key={u.key}
                    rotulo={u.name}
                    // Dois denominadores, cada um com o seu nome (N11): CNPJs do cadastro da
                    // unidade (ignora filtros) no número grande, contas do recorte na nota.
                    valor={number(u.cnpjs)}
                    unidade="CNPJs no cadastro da unidade"
                    estado={semCobertura ? "nao-apurado" : "ok"}
                    abrir={{
                      rotulo: "Abrir carteira",
                      onClick: () => {
                        // Trocar de unidade zera o recorte; reabrir a mesma preserva o trabalho.
                        if (unit?.key !== u.key) {
                          // Na Base de clientes a origem é do topo: trocar de unidade não a apaga.
                          setFilters(
                            controlado ? { ...emptyFilters, origin: filters.origin } : emptyFilters,
                          );
                          setPicked(new Set());
                        }
                        setUnit(u);
                      },
                    }}
                    nota={
                      <>
                        {/* Procedência: de onde a carteira é conhecida. As fontes se sobrepõem. */}
                        <span className="block">
                          {semCobertura
                            ? "catálogo Pipefy e cobertura do Omie não apurada"
                            : u.omie_integrado === false
                              ? `catálogo Pipefy ${number(u.cnpjs_pipefy ?? 0)} · Omie não integrado`
                              : `catálogo Pipefy ${number(u.cnpjs_pipefy ?? 0)} · Omie ${number(u.cnpjs_omie ?? 0)}`}
                        </span>
                        <BarraOrigem
                          total={accounts.length}
                          partes={[
                            { rotulo: "antigas", n: antigas, cor: "bg-primary" },
                            { rotulo: "novas", n: novas, cor: "bg-info" },
                            { rotulo: "a conferir", n: conferir, cor: "bg-muted-foreground/40" },
                          ]}
                        />
                        <span className="mt-2 block">
                          <span className="font-medium text-foreground">
                            {number(accounts.length)} contas no recorte
                          </span>{" "}
                          ·{" "}
                          <span className="text-primary-text">
                            {number(c)} aptas em Consultoria
                          </span>
                          {pending > 0 && ` (${number(pending)} a confirmar)`} · Cella{" "}
                          {number(cella_u)} · Finance {number(f)}
                        </span>
                      </>
                    }
                  />
                );
              })}
            </KpiGrade>
          </Secao>
          <ProcedenciaBase accounts={data.accounts} />
          {content(data.accounts)}
        </div>
      )}
      {/* A montagem de lista fica SEMPRE montada e só é escondida por classe: desmontá-la ao
          trocar de seção jogaria fora o rascunho em andamento, que é trabalho do operador. */}
      <div className={secao === "produtos" ? "" : "hidden"}>
        <ListWorkspace
          data={data}
          initial={draft}
          onConsume={() => setDraft(null)}
          showAccount={setAccount}
        />
      </div>
      {secao === "gates" && <Gates data={data} />}
      {secao === "base" && (
        <div className="flex justify-end">
          <Link
            to="/monetizacao"
            search={{ aba: "operacao" }}
            className={`flex items-center gap-1 text-xs font-medium text-primary-text ${FOCO_VISIVEL}`}
          >
            Acompanhar operação <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
      <Sheet open={!!unit} onOpenChange={(o) => !o && setUnit(null)}>
        <SheetContent
          className="w-full overflow-y-auto sm:max-w-[min(1180px,95vw)]"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary-text" />
              {unit?.name}
            </SheetTitle>
            <SheetDescription>
              {unitAccounts.length} contas · veja a origem da carteira e filtre o produto para
              trabalhar.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(ORIGENS_BASE).map(([key, label]) => (
                <Kpi
                  key={key}
                  label={label}
                  value={number(unitAccountsSemOrigem.filter((a) => origemBase(a) === key).length)}
                  // Na Base de clientes a origem é o filtro do topo, que fica atrás da gaveta:
                  // clicar de novo na origem aplicada tira o filtro, sem precisar fechar.
                  nota={
                    filters.origin.length === 1 && filters.origin[0] === key
                      ? "Filtro aplicado · clique para tirar"
                      : undefined
                  }
                  onClick={() => {
                    if (filters.origin.length === 1 && filters.origin[0] === key) {
                      setFilters({ ...filters, origin: [] });
                      setPicked(new Set());
                      return;
                    }
                    // Este KPI e um filtro de origem, e so isso: partia de `emptyFilters` e
                    // derrubava junto o produto que o operador tinha acabado de escolher dentro
                    // da gaveta. Agora faz o mesmo que o seletor de origem da tabela — troca uma
                    // chave e preserva o resto. A selecao continua sendo limpa porque trocar de
                    // filtro limpa selecao (decisao de 16/09), igual ao caminho do MultiSelect.
                    setFilters({ ...filters, origin: [key as OrigemBase] });
                    setPicked(new Set());
                  }}
                />
              ))}
            </div>
            {content(unitAccounts, true)}
          </div>
          {/* Dentro do SheetContent de proposito: como irmao, o fade de saida da ficha devolvia o
              clique ao overlay da gaveta e fechava a unidade junto, levando a montagem de lista. */}
          {unit && (
            <AccountDetail account={account} cards={data.cards} close={() => setAccount(null)} />
          )}
        </SheetContent>
      </Sheet>
      {!unit && (
        <AccountDetail account={account} cards={data.cards} close={() => setAccount(null)} />
      )}
    </main>
  );
}

function PortfolioTable({
  data,
  accounts,
  filters,
  setFilters,
  picked,
  setPicked,
  showAccount,
  onList,
  inUnit,
  unitId,
  controlesNoTopo = false,
}: {
  data: BaseMonetizacao;
  accounts: Conta[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  picked: Set<string>;
  setPicked: (p: Set<string>) => void;
  showAccount: (a: Conta) => void;
  onList: (keys: string[]) => void;
  inUnit: boolean;
  unitId: number | null;
  /** Busca, unidade e origem são do topo da página: a tabela não desenha controle próprio. */
  controlesNoTopo?: boolean;
}) {
  const [limit, setLimit] = useState(50);
  // Cópia da seleção no momento do envio: o resultado continua legível mesmo quando as contas
  // enviadas saem do filtro após a atualização.
  const [sending, setSending] = useState<Conta[] | null>(null);
  const product = filters.product;
  const situacaoEfetiva = filters.status.length ? filters.status : situacoesIniciais(product);
  // Mudar filtro limpa a seleção: nunca enviar conta que saiu da tela (decisão de 16/09).
  const change = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters({
      ...filters,
      [key]: value,
      ...(key === "product"
        ? { status: situacoesIniciais(value as Produto | ""), approach: [] }
        : {}),
    });
    // Busca so estreita o que ja esta na tela; mexer nela nao e trocar de recorte. Por isso ela
    // nao limpa a selecao — e, pela mesma razao, nao pode jogar fora as paginas ja abertas:
    // digitar uma letra depois de tres "Mostrar mais 50" devolvia a tabela para 50 linhas.
    if (key !== "query") {
      setPicked(new Set());
      setLimit(50);
    }
  };
  const rows = useMemo(() => filtrarCarteira(accounts, filters, data), [accounts, filters, data]);
  const semSituacao = useMemo(
    () => (product ? filtrarCarteira(accounts, filters, data, { ignorarSituacao: true }) : []),
    [accounts, filters, data, product],
  );
  const estado = (a: Conta) => (product ? estadoProduto(a, product, data) : null);
  const contagem = useMemo(() => {
    const n: Record<string, number> = {
      free: 0,
      occupied: 0,
      so_omie: 0,
      qualificar: 0,
      review: 0,
      excluded: 0,
    };
    if (!product) return n;
    for (const a of semSituacao) {
      const e = estadoProduto(a, product, data);
      n[e.situacao]++;
      if (e.perfil.status === "revisar" && e.situacao !== "review") n.review++;
    }
    return n;
  }, [semSituacao, product, data]);
  const visible = rows.slice(0, limit),
    selected = rows.filter((a) => picked.has(a.key));
  const prontas = product ? rows.filter((a) => estado(a)!.situacao === "free") : [];
  const acimaDoLimite = selected.length > LIMITE_LOTE;
  // O N do botão é o N do modal (DirectSend): aptas e disponíveis pela mesma régua, INCLUSIVE as
  // "só no Omie". Antes o botão contava sem elas e o modal enviava com elas.
  const enviaveis = product
    ? selected.filter(
        (a) =>
          oferta(a, product).status === "elegivel" &&
          disponibilidade(a, product, data.cards, undefined, data.reservations).free,
      )
    : [];
  const enviaveisSoOmie = enviaveis.filter(soNoOmie).length;
  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  const unique = (values: (string | null | undefined)[]) =>
    [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const chips: { key: Situacao; label: string; n: number; tom?: TomKpi }[] = product
    ? [
        { key: "free", label: "Prontas para enviar", n: contagem.free, tom: "sucesso" },
        { key: "qualificar", label: "A confirmar", n: contagem.qualificar, tom: "atencao" },
        { key: "so_omie", label: "Só no Omie da unidade", n: contagem.so_omie, tom: "info" },
        { key: "occupied", label: "Aptas já em trabalho", n: contagem.occupied },
        { key: "excluded", label: "Fora da regra", n: contagem.excluded },
      ]
    : [];
  const situacoes = (Object.keys(SITUACOES) as Situacao[]).filter(
    (s) => s !== "potential" || product === "consultoria",
  );
  return (
    <SecaoCartao
      titulo={`${
        inUnit
          ? "Quais contas desta unidade você vai trabalhar?"
          : product
            ? `Quais contas de ${NOMES[product]} estão prontas para trabalhar?`
            : "Quais contas atendem ao recorte?"
      } · ${number(rows.length)} de ${number(accounts.length)}`}
      descricao={
        product
          ? "Os cinco cartões dividem as contas do filtro por situação no produto; o quinto, “Fora da regra”, são as que a régua do produto não aceita. Clique num cartão para filtrar a tabela e de novo para tirar."
          : undefined
      }
      acoes={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCsv("aquario.csv", [
                [
                  "Empresa",
                  // As cinco colunas abaixo marcadas existiam só no CSV da aba "Empresas".
                  // Sem elas, exportar daqui perdia a identidade fiscal e a procedência.
                  "CNPJ",
                  "Unidade",
                  "Origem da base",
                  "Fonte da origem",
                  "Origem no Pipefy",
                  "Omie",
                  "ECD",
                  "Próximo passo",
                  "Situação na Receita",
                  "Fonte da situação",
                  "Faturamento anual",
                  "Conflito de faturamento",
                  "Faixa de faturamento estimado do grupo · Driva",
                  "Driva · consultado em",
                  "Segmento",
                  "Regime",
                  "Contato",
                  "Consultoria",
                  "Finance",
                  "Cella",
                  ...(product ? [`Situação · ${NOMES[product]}`, "Abordagem"] : []),
                ],
                ...rows.map((a) => {
                  const e = estado(a);
                  return [
                    a.name,
                    a.base?.cnpjs.join(" / ") || "",
                    a.unit_label,
                    ORIGENS_BASE[origemBase(a)],
                    a.base_origin?.reason,
                    a.base?.declared_origin.join(" / ") || "",
                    a.base?.omie_units.join(" / ") || "",
                    [...new Set(a.base?.ecd.map((x) => x.year) || [])].join(" / "),
                    a.base?.needs_source_correction
                      ? "Corrigir origem no Pipefy"
                      : a.base?.needs_validation
                        ? "Validar origem com a unidade"
                        : "Cadastro conferido",
                    rotuloSituacaoReceita(a) ?? "Sem consulta na Receita",
                    a.situacao_receita_fonte,
                    faturamentoDeclarado(a),
                    tetoContradizFaixa(a),
                    a.driva?.group_revenue_band,
                    a.driva?.queried_at,
                    a.segment,
                    a.regime,
                    a.contact ? "Sim" : "Obter com o sócio",
                    oferta(a, "consultoria").reason,
                    oferta(a, "finance").reason,
                    oferta(a, "cella").reason,
                    ...(e
                      ? [
                          ROTULO_SITUACAO[e.situacao],
                          e.abordagem
                            .map((x) =>
                              x === "enviada" && e.envio === "incerto"
                                ? "Envio incerto, conferir no Pipedrive"
                                : ABORDAGENS[x],
                            )
                            .join("; "),
                        ]
                      : []),
                  ];
                }),
              ])
            }
          >
            <Download className="mr-1 h-3 w-3" />
            Exportar filtro
          </Button>
          {product && (
            <BotaoComMotivo
              size="sm"
              variant="outline"
              disabled={!prontas.length}
              motivo={
                !prontas.length
                  ? "Nenhuma conta pronta para enviar neste filtro."
                  : `Seleciona as contas deste filtro que estão aptas e disponíveis, inclusive as que ainda não apareceram na página. Envio e lista aceitam até ${LIMITE_LOTE} por vez: acima disso, entram as ${LIMITE_LOTE} primeiras da ordem da tabela.`
              }
              onClick={() => setPicked(new Set(prontas.slice(0, LIMITE_LOTE).map((a) => a.key)))}
            >
              <CheckCheck className="mr-1 h-4 w-4" />
              {prontas.length > LIMITE_LOTE
                ? `Selecionar ${LIMITE_LOTE} de ${number(prontas.length)} prontas`
                : `Selecionar prontas (${number(prontas.length)})`}
            </BotaoComMotivo>
          )}
          <BotaoComMotivo
            size="sm"
            disabled={!data.permissions.manage || !selected.length || acimaDoLimite}
            motivo={[
              !data.permissions.manage && "Exige manage.aquario para montar lista.",
              !selected.length && "Selecione as contas para a lista.",
              acimaDoLimite &&
                `Uma lista aceita até ${LIMITE_LOTE} contas; desmarque ${selected.length - LIMITE_LOTE}.`,
            ]}
            onClick={() => onList(selected.map((a) => a.key))}
          >
            <ListPlus className="mr-1 h-4 w-4" />
            Preparar lista ({selected.length})
          </BotaoComMotivo>
          <BotaoComMotivo
            size="sm"
            disabled={
              !data.permissions.send ||
              !selected.length ||
              acimaDoLimite ||
              (!!product && !enviaveis.length)
            }
            motivo={[
              !data.permissions.send &&
                "Exige send.monetizacao: seu acesso não permite enviar ao Pipedrive.",
              !selected.length && "Selecione as contas para enviar.",
              !!product &&
                !enviaveis.length &&
                `Nenhuma das selecionadas está apta e disponível em ${NOMES[product]}.`,
              acimaDoLimite &&
                `O envio aceita até ${LIMITE_LOTE} contas por vez; desmarque ${selected.length - LIMITE_LOTE}.`,
            ]}
            onClick={() => setSending(selected)}
          >
            <Send className="mr-1 h-4 w-4" />
            Enviar ao Pipedrive ({product ? enviaveis.length : selected.length})
          </BotaoComMotivo>
        </div>
      }
    >
      {sending && (
        <DirectSend
          data={data}
          accounts={sending}
          initialProduct={product}
          unitId={
            unitId ??
            (filters.unit.length === 1
              ? (data.units.find((u) => u.key === filters.unit[0])?.id ?? null)
              : null)
          }
          close={() => setSending(null)}
          done={() => {
            setSending(null);
            setPicked(new Set());
          }}
        />
      )}
      <div className="mb-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {!inUnit && !controlesNoTopo && (
          <FieldMulti label="Unidade">
            <MultiSelect
              label="Unidade"
              placeholder="Todas as unidades"
              value={filters.unit}
              onChange={(v) => change("unit", v)}
              options={data.units.map((u) => ({ value: u.key, label: u.name }))}
            />
          </FieldMulti>
        )}
        {!controlesNoTopo && (
          <FieldMulti label="Origem da base">
            <MultiSelect
              label="Origem da base"
              placeholder="Antigas, novas e pendentes"
              value={filters.origin}
              onChange={(v) => change("origin", v as OrigemBase[])}
              options={Object.entries(ORIGENS_BASE).map(([value, label]) => ({ value, label }))}
            />
          </FieldMulti>
        )}
        {!controlesNoTopo && (
          <Field label="Buscar empresa">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                className={`${inputClass} pl-8`}
                value={filters.query}
                onChange={(e) => change("query", e.target.value)}
                placeholder="Nome ou segmento"
              />
            </div>
          </Field>
        )}
        <FieldMulti label="Faturamento anual · cadastro">
          <MultiSelect
            label="Faturamento anual · cadastro"
            placeholder="Todas as faixas"
            value={filters.band}
            onChange={(v) => change("band", v)}
            options={[
              { value: "10", label: "A partir de R$ 10 mi" },
              { value: "25", label: "A partir de R$ 25 mi" },
              { value: "50", label: "A partir de R$ 50 mi" },
              { value: "unknown", label: "Nada informado" },
              ...unique(accounts.map((a) => a.band)).map((band) => ({
                value: `exact:${band}`,
                label: band,
                group: "Faixa cadastrada",
              })),
              ...unique(
                accounts.map((a) =>
                  !a.band && a.faturamento_teto != null ? String(a.faturamento_teto) : null,
                ),
              ).map((teto) => ({
                value: `teto:${teto}`,
                label: `Até ${tetoEmReais(Number(teto))}`,
                group: "Teto pelo porte na Receita · sem faixa declarada",
              })),
            ]}
          />
        </FieldMulti>
        {accounts.some((a) => a.driva?.group_revenue_band) && (
          <FieldMulti label="Faturamento estimado · grupo Driva">
            <MultiSelect
              label="Faturamento estimado · grupo Driva"
              placeholder="Todas as estimativas"
              value={filters.drivaBand}
              onChange={(v) => change("drivaBand", v)}
              options={unique(accounts.map((a) => a.driva?.group_revenue_band)).map((band) => ({
                value: band,
                label: band,
              }))}
            />
          </FieldMulti>
        )}
        <FieldMulti label="Segmento">
          <MultiSelect
            label="Segmento"
            placeholder="Todos"
            value={filters.segment}
            onChange={(v) => change("segment", v)}
            options={[
              { value: "unknown", label: "Não informado" },
              ...unique(accounts.map((a) => a.segment)).map((s) => ({ value: s, label: s })),
            ]}
          />
        </FieldMulti>
        <FieldMulti label="Regime tributário">
          <MultiSelect
            label="Regime tributário"
            placeholder="Todos os regimes"
            value={filters.regime}
            onChange={(v) => change("regime", v)}
            options={[
              { value: "unknown", label: "Não informado" },
              ...unique(accounts.map((a) => a.regime)).map((r) => ({ value: r, label: r })),
            ]}
          />
        </FieldMulti>
        <FieldMulti label="Situação na Receita">
          <MultiSelect
            label="Situação na Receita"
            placeholder="Todas as situações cadastrais"
            value={filters.receita}
            onChange={(v) => change("receita", v)}
            options={Object.entries(SITUACOES_RECEITA_FILTRO).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </FieldMulti>
        <FieldMulti label="Contato · filtro opcional">
          <MultiSelect
            label="Contato"
            placeholder="Com e sem contato"
            value={filters.contact}
            onChange={(v) => change("contact", v)}
            options={[
              { value: "true", label: "Com contato" },
              { value: "false", label: "Obter com o sócio" },
            ]}
          />
        </FieldMulti>
        <Field label="Produto da lista">
          <select
            className={inputClass}
            value={product}
            onChange={(e) => change("product", e.target.value as Produto | "")}
          >
            <option value="">Todos os produtos</option>
            {PRODUTOS.map((p) => (
              <option key={p} value={p}>
                {NOMES[p]}
              </option>
            ))}
          </select>
        </Field>
        <FieldMulti label="Situação no produto">
          <MultiSelect
            label="Situação no produto"
            disabled={!product}
            placeholder={product ? "Todas as situações" : "Selecione um produto"}
            // A situação padrão do produto aparece marcada; desmarcar tudo significa todas.
            value={situacaoEfetiva.filter((s) => s !== TODAS)}
            onChange={(v) => change("status", v.length ? v : [TODAS])}
            options={situacoes.map((s) => ({ value: s, label: SITUACOES[s] }))}
          />
        </FieldMulti>
        {product && (
          <FieldMulti label="Abordagem no produto">
            <MultiSelect
              label="Abordagem no produto"
              placeholder="Abordadas ou não"
              value={filters.approach}
              onChange={(v) => change("approach", v as Abordagem[])}
              options={(Object.entries(ABORDAGENS) as [Abordagem, string][]).map(
                ([value, label]) => ({ value, label }),
              )}
            />
          </FieldMulti>
        )}
        <label className="flex items-center gap-2 self-end pb-2 text-xs">
          <input
            type="checkbox"
            checked={filters.overlap}
            onChange={(e) => change("overlap", e.target.checked)}
          />
          Aderentes a mais de um produto
        </label>
        <Button
          variant="ghost"
          className="self-end"
          onClick={() => {
            // Preserva o produto escolhido; limpar filtros não é trocar de lista. Busca, unidade e
            // origem do topo também ficam: têm o "Limpar" deles lá em cima.
            setFilters({
              ...emptyFilters,
              ...(controlesNoTopo
                ? { query: filters.query, unit: filters.unit, origin: filters.origin }
                : {}),
              product,
              status: situacoesIniciais(product),
            });
            setPicked(new Set());
            setLimit(50);
          }}
        >
          Limpar filtros
        </Button>
      </div>
      {product && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          {chips.map((c) => {
            const active = situacaoEfetiva.length === 1 && situacaoEfetiva[0] === c.key;
            return (
              <KpiCard
                key={c.key}
                rotulo={c.label}
                valor={number(c.n)}
                tom={c.tom}
                nota={active ? "Filtro aplicado à tabela" : undefined}
                abrir={{
                  rotulo: active ? "Tirar o filtro" : "Filtrar a tabela",
                  onClick: () => change("status", active ? situacoesIniciais(product) : [c.key]),
                }}
                className={active ? "border-primary-text" : undefined}
              />
            );
          })}
        </div>
      )}
      {product === "consultoria" && (
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
          <p className="font-medium">Regime não informado não significa empresa inapta.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A base para análise reúne contas antigas das unidades sem fechamento comercial
            identificado. Para confirmar aptidão, falta verificar se estão fora do Simples. Contato
            e faturamento não são exigidos. Você pode organizar essas contas em listas; o envio
            exige regime confirmado.
          </p>
        </div>
      )}
      <p className="mb-2 text-xs text-muted-foreground">
        {number(rows.length)} de {number(accounts.length)} contas ·{" "}
        {product
          ? "prontas para enviar primeiro, depois maior faturamento"
          : "maior faturamento primeiro"}{" "}
        · {selected.length} selecionadas
        {product && selected.length > 0 && (
          <>
            {" "}
            ({enviaveis.length} entram no envio
            {enviaveisSoOmie > 0 ? `, ${enviaveisSoOmie} delas só no Omie da unidade` : ""}
            {selected.length - enviaveis.length > 0
              ? ` · ${selected.length - enviaveis.length} ficam fora do envio e podem ir para uma lista`
              : ""}
            )
          </>
        )}
      </p>
      {product && (
        <p className="mb-3 text-xs text-muted-foreground">
          Produto selecionado: <strong>{NOMES[product]}</strong>. Os selos dos demais produtos
          mostram sobreposição, sem alterar este filtro.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="p-2">
                <input
                  aria-label="Selecionar contas desta página"
                  type="checkbox"
                  checked={!!visible.length && visible.every((a) => picked.has(a.key))}
                  onChange={(e) => {
                    const next = new Set(picked);
                    visible.forEach((a) =>
                      e.target.checked ? next.add(a.key) : next.delete(a.key),
                    );
                    setPicked(next);
                  }}
                />
              </th>
              <th className="p-2">Empresa</th>
              {product && <th className="p-2">Situação · {NOMES[product]}</th>}
              <th className="p-2">Faturamento · cadastro / Driva</th>
              <th className="p-2">Segmento / regime</th>
              <th className="p-2">Contato</th>
              <th className="p-2">Cadastro no Pipefy</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => {
              const e = estado(a);
              return (
                <tr key={a.key} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-2 align-top">
                    <input
                      aria-label={`Selecionar ${a.name}`}
                      type="checkbox"
                      checked={picked.has(a.key)}
                      onChange={() => toggle(a.key)}
                    />
                  </td>
                  <td className="min-w-52 p-2 align-top">
                    <button
                      className="text-left font-medium hover:text-primary-text hover:underline"
                      onClick={() => showAccount(a)}
                    >
                      {a.name}
                    </button>
                    {/* O CNPJ só existia na aba "Empresas". Sem ele aqui, conferir uma conta
                        contra Receita, Omie ou Pipefy obrigava a trocar de aba. */}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.base?.cnpjs.length ? a.base.cnpjs.join(" · ") : "CNPJ a refinar"}
                    </p>
                    <p className="my-1 text-xs text-muted-foreground">
                      {a.unit_label ? `${a.unit_label} · ` : ""}
                      <span title={a.base_origin?.reason}>{ORIGENS_BASE[origemBase(a)]}</span>
                      {a.situacao_receita && a.situacao_receita !== "ativa" && (
                        <span
                          className="ml-1 rounded bg-muted px-1 font-semibold"
                          title={a.situacao_receita_fonte ?? undefined}
                        >
                          {rotuloSituacaoReceita(a)}
                        </span>
                      )}
                      {a.base_origin?.commercial && " · fechamento comercial identificado"}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <OfertaTag account={a} product="consultoria" />
                      <OfertaTag account={a} product="finance" />
                      <OfertaTag account={a} product="cella" />
                    </div>
                  </td>
                  {e && (
                    <td className="min-w-56 p-2 align-top">
                      <SituacaoProduto estado={e} />
                    </td>
                  )}
                  <td className="min-w-40 p-2 align-top text-xs">
                    {faturamentoDeclarado(a)}
                    {tetoContradizFaixa(a) && (
                      <p className="mt-1 text-xs font-medium text-warning">
                        {tetoContradizFaixa(a)}
                      </p>
                    )}
                    {a.driva?.group_revenue_band && (
                      <p className="mt-1 font-medium">
                        {a.driva.group_revenue_band}
                        <span className="block text-xs font-normal text-muted-foreground">
                          Estimativa Driva · grupo econômico
                        </span>
                      </p>
                    )}
                    {a.band_conflict && <span className="block text-warning">Fontes divergem</span>}
                  </td>
                  <td className="min-w-36 p-2 align-top text-xs">
                    {a.segment || "Segmento a confirmar"}
                    <span className="block text-muted-foreground">
                      {a.regime ||
                        (a.base?.tax_evidence?.non_simples === true || a.driva?.non_simples === true
                          ? "Fora do Simples · regime específico não informado"
                          : "Regime a confirmar")}
                    </span>
                    {a.regime_source && (
                      <span className="block text-xs text-muted-foreground">
                        Regime: {a.regime_source}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {a.segment_source || "Sem fonte preenchida"}
                    </span>
                  </td>
                  <td className="min-w-32 p-2 align-top text-xs">
                    {a.contact ? "Com contato" : "Obter com o sócio"}
                    {!product && (
                      <p className="mt-1 text-muted-foreground">
                        Selecione o produto para ver situação e abordagem
                      </p>
                    )}
                  </td>
                  {/* Procedência do cadastro, que só existia na aba "Empresas": diz se o espelho
                      do Pipefy foi conferido e quando. Sem isso, a tabela afirma perfil sobre
                      cadastro que pode estar ausente, sem vínculo ou defasado. */}
                  <td className="min-w-40 p-2 align-top text-xs">
                    <EspelhoPipefy account={a} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <EstadoVazio titulo="Nenhuma conta neste filtro" total={accounts.length} />
      )}
      {rows.length > limit && (
        <Button className="mt-3" variant="outline" onClick={() => setLimit(limit + 50)}>
          Mostrar mais 50
        </Button>
      )}
    </SecaoCartao>
  );
}

// O Pipedrive devolve "AAAA-MM-DD HH:MM:SS" em UTC; sem o "Z" o navegador leria como hora local.
const quando = (v: string) =>
  date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v) ? v.replace(" ", "T") + "Z" : v);

const ROTULO_SITUACAO: Record<EstadoProduto["situacao"], string> = {
  free: "Apta · pronta para enviar",
  occupied: "Apta · já em trabalho ou reservada",
  so_omie: "Apta pela régua · só no Omie da unidade",
  qualificar: "A confirmar",
  review: "A confirmar",
  excluded: "Fora da regra",
};

// Leitura do espelho do Pipefy, trazida da aba "Empresas" para a tabela da carteira. Traz hora
// porque a defasagem desta fonte se mede em horas, não em dias — `date` sozinho esconderia isso.
const leituraEm = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "Sem leitura confirmada";

function EspelhoPipefy({ account: a }: { account: Conta }) {
  const b = a.base;
  const conferido = !b?.needs_source_correction && b?.source_status === "ok";
  const texto = b?.needs_source_correction
    ? "Origem a corrigir no Pipefy"
    : b?.source_status === "ok"
      ? "Pipefy conferido"
      : b?.source_status === "absent"
        ? "Ausente no Pipefy"
        : b?.source_status === "not_linked"
          ? "Sem vínculo Pipefy"
          : b?.synced_at
            ? "Cadastro com divergências"
            : "Leitura pendente";
  const Icone = conferido ? CheckCircle2 : AlertCircle;
  return (
    <>
      <span
        className={`inline-flex items-center gap-1 ${conferido ? "text-success" : "text-warning"}`}
      >
        <Icone className="h-3 w-3 shrink-0" />
        {texto}
      </span>
      <p className="mt-1 text-xs text-muted-foreground">
        {b?.synced_at ? leituraEm(b.synced_at) : `${b?.omie_records || 0} registros Omie`}
      </p>
    </>
  );
}

function SituacaoProduto({ estado: e }: { estado: EstadoProduto }) {
  // "Só no Omie" não é um terceiro veredito da régua — a régua aprovou. É de onde a empresa
  // veio, e por isso tem cor própria (azul), nem o verde do pronto nem o âmbar do pendente.
  const perfil =
    e.situacao === "so_omie"
      ? {
          label: "Apta · só no Omie da unidade",
          tone: "bg-info/15 text-info",
        }
      : e.perfil.status === "elegivel"
        ? {
            label: "Apta · validada",
            tone: "bg-success/15 text-success",
          }
        : e.perfil.status === "revisar"
          ? { label: "A confirmar", tone: "bg-warning/15 text-warning" }
          : { label: "Fora da regra", tone: "bg-muted text-muted-foreground" };
  const lista = e.listas[0];
  return (
    <div className="space-y-1 text-xs">
      <span
        className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${perfil.tone}`}
        title={e.situacao === "so_omie" ? PROCEDENCIA_EXPLICACAO.omie : e.perfil.reason}
      >
        {perfil.label}
      </span>
      {e.situacao === "so_omie" ? (
        <p className="text-muted-foreground">
          Entrou pelo ERP da unidade, que também cadastra fornecedor. A unidade precisa dizer se é
          cliente antes de virar lista.
        </p>
      ) : e.perfil.status === "elegivel" ? (
        e.livre ? (
          <p className="font-medium text-success">Pronta para enviar</p>
        ) : (
          <p className="text-muted-foreground">{e.motivoDisponibilidade}</p>
        )
      ) : (
        <p className="line-clamp-2 text-muted-foreground" title={e.perfil.reason}>
          {e.perfil.reason}
        </p>
      )}
      {e.aberto && (
        <a
          href={e.aberto.url}
          target="_blank"
          rel="noreferrer"
          className="block font-medium text-primary-text hover:underline"
        >
          No Pipedrive · {e.aberto.stage} · {e.aberto.owner}
        </a>
      )}
      {e.envio && !e.aberto && (
        <p className="font-medium">
          {e.envio === "incerto"
            ? "Envio incerto · conferir no Pipedrive antes de reenviar"
            : "Envio registrado · negócio ainda não sincronizado do Pipedrive"}
        </p>
      )}
      {e.encerrado && (
        <a
          href={e.encerrado.url}
          target="_blank"
          rel="noreferrer"
          className="block text-muted-foreground hover:underline"
        >
          {e.encerrado.status === "won"
            ? `Abordada antes · ganho${e.encerrado.won_on ? ` em ${quando(e.encerrado.won_on)}` : ""}`
            : `Abordada antes · perdido${e.encerrado.lost_reason ? ` · ${e.encerrado.lost_reason}` : ""}${e.encerrado.updated_at ? ` · atualizado em ${quando(e.encerrado.updated_at)}` : ""}`}
        </a>
      )}
      {e.semProduto && (
        <a
          href={e.semProduto.url}
          target="_blank"
          rel="noreferrer"
          className="block text-warning hover:underline"
        >
          Negócio sem produto no Pipedrive · {e.semProduto.stage} ·{" "}
          {e.semProduto.status === "open"
            ? "aberto"
            : e.semProduto.status === "won"
              ? "ganho"
              : "perdido"}
        </a>
      )}
      {lista && (
        <p className="text-muted-foreground">
          Em lista: {lista.lista.nome}
          {lista.validada ? " · validada pelo sócio" : ""}
          {e.listas.length > 1 ? ` +${e.listas.length - 1}` : ""}
        </p>
      )}
      {e.abordagem.includes("nunca") && (
        <p className="text-muted-foreground">Sem negócio, envio ou lista neste produto</p>
      )}
    </div>
  );
}

function Gates({ data }: { data: BaseMonetizacao }) {
  const rows = [
    [
      "Contas na base conciliada",
      data.accounts.length,
      "União das fontes reconciliadas. Não equivale automaticamente a clientes ativos pagantes.",
    ],
    [
      "Com vínculo de Matriz",
      data.accounts.filter((a) => a.matrix).length,
      "Vínculo identificado na reconciliação; não inferido pela ausência de unidade.",
    ],
    [
      "Expansão · contratos comerciais",
      data.accounts.filter((a) => a.new_commercial).length,
      "Origem comercial identificada no cadastro.",
    ],
    [
      "Expansão comercial · faixa a partir de R$ 25 mi",
      data.accounts.filter(
        (a) => a.new_commercial && (FAIXAS[a.band || ""]?.[0] ?? -1) >= 25 && !a.band_conflict,
      ).length,
      "Faixa conhecida e sem divergência; é um recorte do número anterior.",
    ],
    [
      "Base retroativa declarada",
      data.accounts.filter((a) => a.old_base).length,
      "Origem Base Antiga declarada. Outras contas das unidades exigem confirmação do sócio.",
    ],
    [
      "Com resumo ECD vinculado",
      data.accounts.filter((a) => a.ecd).length,
      "Cobertura de evidência contábil; não acrescenta clientes ao total.",
    ],
    [
      "Consultoria · base antiga sem fechamento comercial",
      data.accounts.filter(baseRetroativaConsultoria).length,
      "Origem conferida nos registros vinculados. Exclui conflitos e fechamentos comerciais identificados.",
    ],
    [
      "Consultoria · fora do Simples comprovado",
      data.accounts.filter((a) => oferta(a, "consultoria").status === "elegivel").length,
      "Base apta. Não exige contato, faturamento mínimo, Lucro Real ou segmento específico.",
    ],
    [
      "Consultoria · excluídas por Simples/MEI",
      data.accounts.filter(
        (a) =>
          baseRetroativaConsultoria(a) &&
          oferta(a, "consultoria").status === "fora_regra" &&
          !situacaoForaDeOferta(a),
      ).length,
      "Pertencem à carteira retroativa, mas o regime conhecido não atende à regra de Consultoria.",
    ],
    [
      "Consultoria · fora por situação na Receita",
      data.accounts.filter((a) => baseRetroativaConsultoria(a) && situacaoForaDeOferta(a)).length,
      "Baixadas, inaptas ou suspensas na consulta em lote. Saem das ofertas e formam a lista separada de empresas inativas; o regime delas não foi avaliado.",
    ],
    [
      "Consultoria · regime a confirmar",
      data.accounts.filter(
        (a) => baseRetroativaConsultoria(a) && oferta(a, "consultoria").status === "revisar",
      ).length,
      "Não entram na base apta até comprovar que estão fora do Simples.",
    ],
  ];
  return (
    <div className="space-y-4">
      <Panel title="De onde vem a base">
        <Notice>
          Os recortes de origem podem se sobrepor. Cada linha explica seu próprio conjunto; não some
          Matriz, comercial e retroativos como se fossem grupos exclusivos.
        </Notice>
        <table className="mt-3 w-full text-left text-sm">
          <tbody>
            {rows.map(([label, n, why]) => (
              <tr key={String(label)} className="border-b last:border-0">
                <th className="py-3 pr-4 font-medium">{label}</th>
                <td className="pr-4 text-right font-semibold tabular-nums">
                  {number(n as number)}
                </td>
                <td className="text-xs text-muted-foreground">{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Da conta à oportunidade disponível">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="py-2">Gate</th>
                {PRODUTOS.map((p) => (
                  <th key={p}>{NOMES[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                "Perfil aderente",
                "Dados a confirmar",
                "Fora do perfil",
                "Aderente, já no CRM / carga no mês",
                "Aderente e disponível",
              ].map((label, index) => (
                <tr className="border-t" key={label}>
                  <th className="py-3 font-normal">{label}</th>
                  {PRODUTOS.map((p) => {
                    const n = data.accounts.filter((a) => {
                      const s = oferta(a, p).status,
                        free = disponibilidade(a, p, data.cards, undefined, data.reservations).free;
                      return index === 0
                        ? s === "elegivel"
                        : index === 1
                          ? s === "revisar"
                          : index === 2
                            ? s === "fora_regra"
                            : index === 3
                              ? s === "elegivel" && !free
                              : s === "elegivel" && free;
                    }).length;
                    return (
                      <td key={p} className="font-semibold tabular-nums">
                        {number(n)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          A disponibilidade é por empresa + produto. Uma oportunidade de Cella não ocupa
          automaticamente Finance. Todas exigem validação antes do envio; listas salvas e reservas
          de envio são conferidas novamente no botão de enviar.
        </p>
      </Panel>
    </div>
  );
}

/**
 * Composição da origem da carteira em barra, com os valores escritos ao lado (não só no
 * `title`): comprimento compara, a palavra diz quanto. Só `span`, porque mora dentro do botão
 * do KpiCard.
 */
function BarraOrigem({
  total,
  partes,
}: {
  total: number;
  partes: { rotulo: string; n: number; cor: string }[];
}) {
  return (
    <span className="mt-2 block">
      <span aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {partes.map((p) =>
          p.n > 0 ? (
            <span
              key={p.rotulo}
              className={`block ${p.cor}`}
              style={{ width: `${Math.max(2, (p.n / Math.max(1, total)) * 100)}%` }}
            />
          ) : null,
        )}
      </span>
      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {partes.map((p) => (
          <span key={p.rotulo} className="inline-flex items-center gap-1">
            <span aria-hidden className={`inline-block size-2 rounded-full ${p.cor}`} />
            <span className="num">{number(p.n)}</span> {p.rotulo}
          </span>
        ))}
      </span>
    </span>
  );
}
