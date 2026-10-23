import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import { hoje as hojeSP } from "@/lib/monetizacao/model";
import { carregarFunilConsultoria } from "@/lib/monetizacao/consultoria-funil.functions";
import {
  ETAPAS,
  MOTIVOS,
  ORIGENS,
  ORIGENS_FUNIL,
  chaveDaFicha,
  dinheiroDe,
  empresasDoPasso,
  filtrar,
  grupoDoPasso,
  montarFunil,
  motivoDe,
  nivelDe,
  ondeAgir,
  porCliente,
  rotuloNota,
  type EmpresaFunil,
  type FunilBruto,
  type GrupoFila,
  type Origem,
  type PassoFunil,
} from "@/lib/monetizacao/consultoria-funil";
import { cn } from "@/lib/utils";
import { inputClass } from "./common";
import { GavetaFicha, type ResumoFicha } from "./consultoria-empresa";
import type { BuscaMonetizacao } from "./busca";

// Consultoria › Funil (contrato docs/design/contratos/monetizacao-consultoria-funil.md). A visão de abertura da tela:
// do que vendemos, quanto chegou à Consultoria, quanto ela auditou, quanto achou de dinheiro e quanto virou honorário.
// Pedido do CEO na call de 16/10/2026 ("quantos que a consultoria auditou... quantos tem dinheiro... quanto que ela
// monetizou... onde que está esse gelo que não me pagou?"). Régua em src/lib/monetizacao/consultoria-funil.ts.
// Desde 20/10/2026 (pedido do dono) todo número clicável abre a lista numa gaveta à direita (`passo`), e a empresa
// clicada na lista abre a ficha por cima dela (`empresa`), com "Voltar" para a lista. Antes a lista abria embaixo.

const TITULO = "Consultoria";
const PERGUNTA = "Do que vendemos, quanto já virou dinheiro, e onde está parado?";
const INT = new Intl.NumberFormat("pt-BR");
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
/** Dinheiro grande em milhões ("R$ 7,4 mi"); abaixo de R$ 1 mi, em mil. */
export function brlCurto(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1_000_000)
    return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (a >= 10_000) return `R$ ${Math.round(v / 1000).toLocaleString("pt-BR")} mil`;
  return BRL.format(Math.round(v));
}
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ddmmaa = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—";

export function origensDaBusca(busca: BuscaMonetizacao, padrao: Origem[]): Origem[] {
  const lista = (busca.origem ?? "").split(",").filter(Boolean) as Origem[];
  return lista.length ? lista : padrao;
}

export function useFunilConsultoria() {
  const { user } = useAuth();
  const ler = useServerFn(carregarFunilConsultoria);
  return useQuery({
    queryKey: ["consultoria-funil", user?.id],
    queryFn: () => ler(),
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
}

export function ConsultoriaFunil({
  busca,
  mudarBusca,
  abas,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  abas?: ReactNode;
}) {
  const q = useFunilConsultoria();
  if (!q.data) {
    const erro = q.error as Error | null;
    return (
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
        <PageHeader titulo={TITULO} pergunta={PERGUNTA} />
        {abas}
        {!erro ? (
          <Carregando variante="kpis" />
        ) : /^Seu acesso não inclui/.test(erro.message) ? (
          <EstadoSemAcesso oQueFalta="view.monetizacao ou view.consultoria, com todas as unidades" />
        ) : (
          <EstadoErro
            detalhe={`Fonte: plataforma da Consultoria, contratos ganhos e Base. ${erro.message}`}
            tentarNovamente={() => void q.refetch()}
          />
        )}
      </main>
    );
  }
  return <PainelFunil bruto={q.data} busca={busca} mudarBusca={mudarBusca} abas={abas} />;
}

export function PainelFunil({
  bruto,
  busca,
  mudarBusca,
  abas,
  hoje = hojeSP(),
}: {
  bruto: FunilBruto;
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  abas?: ReactNode;
  hoje?: string;
}) {
  const origens: Origem[] = origensDaBusca(busca, ORIGENS_FUNIL).filter((o) => o !== "outra");
  const unidade = busca.unidade ?? null;
  const porta = bruto.porta_financeiro.aberta;
  // Uma linha por cliente da plataforma: as filiais de Goiânia não repetem o dinheiro do cliente (20/10/2026).
  const universo = useMemo(
    () => porCliente(bruto.empresas).filter((e) => e.origem !== "outra"),
    [bruto.empresas],
  );
  const empresas = useMemo(() => filtrar(universo, { origens, unidade }), [universo, origens, unidade]);
  const passos = useMemo(() => montarFunil(empresas, hoje, porta), [empresas, hoje, porta]);
  const dinheiro = useMemo(() => dinheiroDe(empresas, porta), [empresas, porta]);
  const acoes = useMemo(() => ondeAgir(empresas, hoje), [empresas, hoje]);
  const unidades = useMemo(
    () =>
      [...new Set(universo.filter((e) => origens.includes(e.origem)).map((e) => e.unidade).filter(Boolean))].sort(
        (a, b) => (a as string).localeCompare(b as string, "pt-BR"),
      ) as string[],
    [universo, origens],
  );
  const passo = busca.passo ?? null;
  const lista = useMemo(
    () => (passo ? empresasDoPasso(empresas, passo, hoje) : []),
    [empresas, passo, hoje],
  );

  const alternarOrigem = (o: Origem) => {
    const nova = origens.includes(o) ? origens.filter((x) => x !== o) : [...origens, o];
    const ordem = ORIGENS_FUNIL.filter((x) => nova.includes(x));
    mudarBusca({
      origem: ordem.length === 0 || ordem.length === ORIGENS_FUNIL.length ? undefined : ordem.join(","),
      unidade: undefined,
      passo: undefined,
      empresa: undefined,
    });
  };
  const abrirPasso = (p: string | undefined) => mudarBusca({ passo: p, empresa: undefined });

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6">
      <PageHeader
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao="Cada empresa que vendemos em 2026, e cada cliente da carteira de Goiânia, segue um caminho até virar honorário. Aqui está quantas chegaram a cada degrau, quanto dinheiro tem em cada um e onde elas param."
        procedencia={{
          fonte: "Plataforma da Consultoria (a cada 15 min) · contratos ganhos no Pipedrive · Base de clientes",
          atualizadoEm: bruto.frescor.plataforma ?? bruto.lido_em,
          regua: "um cliente da plataforma por linha; fora dela, uma empresa por CNPJ",
        }}
      />
      {abas}

      <section aria-label="Filtros" className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">Mostrar:</span>
        {ORIGENS.filter((o) => o.id !== "outra").map((o) => {
          const ativo = origens.includes(o.id);
          const n = universo.filter((e) => e.origem === o.id).length;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={ativo}
              onClick={() => alternarOrigem(o.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                ativo
                  ? "border-primary-text/50 bg-primary/10 font-medium text-foreground"
                  : "text-muted-foreground hover:border-primary-text/40",
              )}
            >
              {o.rotulo} <span className="num text-muted-foreground">{INT.format(n)}</span>
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-2 text-[13px] text-muted-foreground">
          Unidade
          <select
            value={unidade ?? ""}
            onChange={(ev) =>
              mudarBusca({ unidade: ev.target.value || undefined, passo: undefined, empresa: undefined })
            }
            className={cn(inputClass, "h-8 w-auto py-0")}
          >
            <option value="">Todas</option>
            {unidades.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      </section>

      <Secao
        titulo="Dinheiro de verdade"
        descricao="O recebido e o faturado são honorário que já saiu. O garantido é o crédito que o cliente aprovou e ainda vai virar honorário. O achado e parado é crédito de diagnóstico entregue que o cliente ainda não aceitou."
      >
        <KpiGrade colunas={4}>
          <KpiCard
            rotulo="Recebido em 2026"
            valor={brlCurto(dinheiro.recebido2026)}
            estado={porta ? "ok" : "sem-acesso"}
            tom="sucesso"
            nota="honorário que entrou no caixa"
            abrir={porta ? { onClick: () => abrirPasso("8"), rotulo: "ver as empresas" } : undefined}
          />
          <KpiCard
            rotulo="Faturado em 2026"
            valor={brlCurto(dinheiro.faturado2026)}
            estado={porta ? "ok" : "sem-acesso"}
            tom="sucesso"
            nota="honorário emitido pela Consultoria"
            abrir={porta ? { onClick: () => abrirPasso("7"), rotulo: "ver as empresas" } : undefined}
          />
          <KpiCard
            rotulo="Garantido a faturar"
            valor={brlCurto(dinheiro.garantido)}
            tom="info"
            nota={`crédito aprovado × êxito, em ${INT.format(dinheiro.empresasGarantido)} empresas`}
            abrir={{ onClick: () => abrirPasso("6-garantido"), rotulo: "ver as empresas" }}
          />
          <KpiCard
            rotulo="Achado e parado"
            valor={brlCurto(dinheiro.parado)}
            tom="atencao"
            nota={`diagnóstico entregue, sem aceite, em ${INT.format(dinheiro.empresasParado)} empresas${
              dinheiro.empresasEmAnalise
                ? ` · à parte, ${brlCurto(dinheiro.emAnalise)} ainda em análise (${INT.format(dinheiro.empresasEmAnalise)})`
                : ""
            }`}
            abrir={{ onClick: () => abrirPasso("5-parado"), rotulo: "ver as empresas" }}
          />
        </KpiGrade>
      </Secao>

      <Secao
        titulo="O caminho de cada empresa"
        descricao="Cada degrau conta quem chegou até ali ou além. A porcentagem é sobre o degrau de cima. Clique num degrau ou num motivo para ver as empresas."
      >
        {empresas.length === 0 ? (
          <EstadoVazio titulo="Nenhuma empresa" descricao="Escolha ao menos uma origem acima." />
        ) : (
          <Funil passos={passos} passo={passo} escolher={(p) => abrirPasso(p)} />
        )}
      </Secao>

      <GavetaDoPasso
        passo={passo}
        empresas={lista}
        hoje={hoje}
        porta={porta}
        ficha={busca.empresa ?? null}
        fechar={() => abrirPasso(undefined)}
        abrirFicha={(chave) => mudarBusca({ empresa: chave ?? undefined })}
        irParaFila={(grupo) =>
          mudarBusca({
            visao: "fila",
            grupo,
            passo: undefined,
            empresa: undefined,
            origem: undefined,
            unidade: undefined,
          })
        }
      />

      {acoes.length > 0 && (
        <Secao titulo="Onde agir agora" descricao="O que destrava mais dinheiro, primeiro.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {acoes.map((a) => (
              <article
                key={a.id}
                className={cn(
                  "flex flex-col justify-between gap-3 rounded-xl border bg-card p-4",
                  a.tom === "perigo" && "border-danger/40",
                  a.tom === "atencao" && "border-warning/40",
                )}
              >
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{a.titulo}</p>
                  <p className="num text-2xl font-bold">
                    {INT.format(a.empresas)} {a.empresas === 1 ? "empresa" : "empresas"}
                    {a.valor ? (
                      <span className="ml-2 text-base font-semibold text-muted-foreground">
                        {brlCurto(a.valor)}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[13px] text-muted-foreground">{a.leitura}</p>
                </div>
                <button
                  type="button"
                  onClick={() => abrirPasso(a.passo)}
                  className="inline-flex items-center gap-1 self-start text-[13px] font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Ver as empresas
                  <ArrowRight className="size-3.5" aria-hidden />
                </button>
              </article>
            ))}
          </div>
        </Secao>
      )}
    </main>
  );
}

// ─── O funil desenhado ───────────────────────────────────────────────────────────────────────────

const TOM_MOTIVO = { perigo: "perigo", atencao: "atencao", neutro: "neutro", info: "info" } as const;

function Funil({
  passos,
  passo,
  escolher,
}: {
  passos: PassoFunil[];
  passo: string | null;
  escolher: (p: string) => void;
}) {
  const topo = Math.max(1, passos[0]?.empresas ?? 1);
  return (
    <ol className="space-y-1 rounded-xl border bg-card p-3 md:p-4">
      {passos.map((p, i) => {
        const largura = Math.max(2, (100 * p.empresas) / topo);
        const ativo = passo === String(p.etapa.n);
        const caixa = p.etapa.n >= 7;
        return (
          <li key={p.etapa.n}>
            <button
              type="button"
              onClick={() => escolher(String(p.etapa.n))}
              aria-pressed={ativo}
              className={cn(
                "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_9rem]",
                ativo && "bg-muted/60",
              )}
            >
              <span className="flex min-w-0 items-start gap-2">
                <span
                  className={cn(
                    "num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    caixa ? "bg-success-soft text-success" : "bg-primary/15 text-primary-text",
                  )}
                  aria-hidden
                >
                  {p.etapa.n}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{p.etapa.titulo}</span>
                  <span className="block text-xs text-muted-foreground">{p.etapa.explica}</span>
                </span>
              </span>
              <span className="order-3 col-span-2 md:order-none md:col-span-1">
                <span className="relative block h-7 w-full">
                  <span
                    className={cn(
                      "absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-md",
                      caixa ? "bg-success" : "bg-primary",
                    )}
                    style={{ width: `${largura}%` }}
                  />
                  {p.dinheiro !== null && p.dinheiro > 0 && (
                    <span className="num absolute inset-0 flex items-center justify-center text-xs font-semibold text-foreground">
                      <span className="rounded bg-card/90 px-1.5 py-0.5">{brlCurto(p.dinheiro)}</span>
                    </span>
                  )}
                </span>
              </span>
              <span className="text-right">
                <span className="num block text-xl font-bold leading-none">{INT.format(p.empresas)}</span>
                <span className="block text-xs text-muted-foreground">
                  {p.taxa === null ? "empresas" : `${p.taxa}% do degrau de cima`}
                </span>
              </span>
            </button>
            {i < passos.length - 1 && p.pararam > 0 && (
              <div className="ml-10 flex flex-wrap items-center gap-1.5 pb-2 pt-0.5 text-xs text-muted-foreground">
                <span>
                  ↳ {INT.format(p.pararam)} {p.pararam === 1 ? "parou" : "pararam"} aqui:
                </span>
                {p.parou.map((x) => {
                  const chave = `${p.etapa.n}-${x.motivo.id}`;
                  return (
                    <button
                      key={x.motivo.id}
                      type="button"
                      onClick={() => escolher(chave)}
                      aria-pressed={passo === chave}
                      title={x.motivo.leitura}
                      className={cn(
                        "rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        passo === chave && "ring-2 ring-ring",
                      )}
                    >
                      <StatusBadge tom={TOM_MOTIVO[x.motivo.tom]} icone={false}>
                        {x.motivo.rotulo} <span className="num">{INT.format(x.empresas)}</span>
                      </StatusBadge>
                    </button>
                  );
                })}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── A lista de um clique, na gaveta ─────────────────────────────────────────────────────────────

/** `curto` é o nome da lista no botão "Voltar para…" da ficha. */
function tituloDoPasso(passo: string, n: number): { titulo: string; curto: string; leitura: string | null } {
  const [e, m] = passo.split("-");
  const etapa = ETAPAS.find((x) => String(x.n) === e);
  if (m === "atrasado")
    return {
      titulo: `${INT.format(n)} paradas antes do diagnóstico, fora do prazo`,
      curto: "fora do prazo",
      leitura: "Estão na Consultoria e passaram da meta da etapa em que estão.",
    };
  if (m === "parado")
    return {
      titulo: `${INT.format(n)} com dinheiro achado e sem aceite`,
      curto: "achado e parado",
      leitura:
        "A Consultoria entregou o diagnóstico, achou crédito e o cliente ainda não disse sim a nenhuma tese. A soma do crédito achado delas é o “Achado e parado”. As que ainda estão em análise ficam no motivo “Ainda em análise”, no degrau 5.",
    };
  if (m === "garantido")
    return {
      titulo: `${INT.format(n)} com crédito aprovado a faturar`,
      curto: "garantido a faturar",
      leitura:
        "O cliente aprovou o crédito e ele está no estoque. Cada real compensado vira honorário pela alíquota de êxito: é o “Garantido a faturar”.",
    };
  if (m) {
    const motivo = (MOTIVOS[Number(e) + 1] ?? []).find((x) => x.id === m);
    return {
      titulo: `${INT.format(n)} pararam em "${etapa?.titulo}": ${motivo?.rotulo ?? m}`,
      curto: motivo?.rotulo.toLowerCase() ?? m,
      leitura: motivo?.leitura ?? null,
    };
  }
  return {
    titulo: `${INT.format(n)} chegaram a "${etapa?.titulo}" ou além`,
    curto: `"${etapa?.titulo}"`,
    leitura: etapa?.explica ? `${etapa.explica} Conta quem chegou até aqui ou foi além.` : null,
  };
}

const ROTULO_ETAPA: Record<string, string> = {
  fila_processamento: "Fila de Processamento",
  fluxo_documentos: "Fluxo de Documentos",
  operacao: "Operação",
  qualidade: "Qualidade",
  saida_entrega: "Saída / Entrega",
  pos_entrega: "Pós-entrega",
};

function ondeEsta(e: EmpresaFunil, hoje: string): string {
  const n = nivelDe(e);
  const m = motivoDe(e, hoje);
  const motivo = (MOTIVOS[n + 1] ?? []).find((x) => x.id === m)?.rotulo;
  if (n === 3 && e.etapa) {
    const atraso = (e.dias_alem ?? 0) > 0 ? ` · ${INT.format(e.dias_alem ?? 0)} dias além da meta` : "";
    return `${ROTULO_ETAPA[e.etapa] ?? e.etapa}${atraso}`;
  }
  return n === 8 ? "Recebemos" : (motivo ?? ETAPAS[n - 1].titulo);
}

function GavetaDoPasso({
  passo,
  empresas,
  hoje,
  porta,
  ficha,
  fechar,
  abrirFicha,
  irParaFila,
}: {
  passo: string | null;
  empresas: EmpresaFunil[];
  hoje: string;
  porta: boolean;
  /** A chave da ficha aberta por cima da lista (`empresa` na URL). */
  ficha: string | null;
  fechar: () => void;
  abrirFicha: (chave: string | null) => void;
  irParaFila: (grupo: GrupoFila) => void;
}) {
  const { titulo, curto, leitura } = passo
    ? tituloDoPasso(passo, empresas.length)
    : { titulo: "", curto: "", leitura: null };
  // O segundo dinheiro da lista: o garantido, o compensado (quem já usou o crédito) ou o aceito.
  const modo: ModoLista = passo?.endsWith("-garantido")
    ? "garantido"
    : passo === "6-compensou"
      ? "compensou"
      : "aceito";
  const grupo = passo ? grupoDoPasso(passo) : null;
  const ordenadas = useMemo(
    () =>
      [...empresas].sort(
        (a, b) =>
          (modo === "garantido" ? num(b.garantido) - num(a.garantido) : 0) ||
          (modo === "compensou" ? num(b.exito_estimado) - num(a.exito_estimado) : 0) ||
          num(b.aceito) + num(b.identificado) - (num(a.aceito) + num(a.identificado)) ||
          num(b.mrr) - num(a.mrr) ||
          a.nome.localeCompare(b.nome, "pt-BR"),
      ),
    [empresas, modo],
  );
  const soma = (k: "identificado" | "aceito" | "garantido" | "faturado" | "estoque_utilizado" | "exito_estimado") =>
    empresas.reduce((s, e) => s + num(e[k]), 0);
  const aberta = ficha ? (empresas.find((e) => chaveDaFicha(e) === ficha) ?? null) : null;
  // A última ficha aberta continua marcada na lista depois do "Voltar": a pessoa vê onde parou.
  const [ultima, setUltima] = useState<string | null>(null);
  useEffect(() => {
    if (ficha) setUltima(ficha);
  }, [ficha]);
  useEffect(() => setUltima(null), [passo]);
  const origem = (o: string) => ORIGENS.find((x) => x.id === o)?.curto ?? o;
  const resumo: ResumoFicha | null = aberta
    ? {
        nome: aberta.nome,
        cnpj: aberta.cnpj,
        linhas: [
          [origem(aberta.origem), aberta.unidade, aberta.closer].filter(Boolean).join(" · "),
          `No funil: ${ondeEsta(aberta, hoje)}`,
          aberta.regime ? `Regime: ${aberta.regime}` : "",
        ].filter(Boolean),
      }
    : null;
  return (
    <Sheet open={!!passo} onOpenChange={(o) => !o && fechar()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-4xl">
        {passo && (
          <>
            <SheetHeader className="pr-8">
              <SheetTitle>{titulo}</SheetTitle>
              <SheetDescription>{leitura ?? "As empresas deste número."}</SheetDescription>
            </SheetHeader>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {modo === "compensou" ? (
                <>
                  <Somado rotulo="Crédito compensado" valor={soma("estoque_utilizado")} />
                  <Somado rotulo="Honorário estimado" valor={soma("exito_estimado")} />
                </>
              ) : (
                <>
                  <Somado rotulo="Crédito achado" valor={soma("identificado")} />
                  <Somado
                    rotulo={modo === "garantido" ? "Garantido a faturar" : "Aceito pelo cliente"}
                    valor={soma(modo === "garantido" ? "garantido" : "aceito")}
                  />
                </>
              )}
              <Somado rotulo="Faturado" valor={porta ? soma("faturado") : null} />
              <div className="rounded-lg border bg-card px-3 py-2">
                <dt className="text-xs text-muted-foreground">Empresas</dt>
                <dd className="num text-lg font-semibold">{INT.format(empresas.length)}</dd>
              </div>
            </dl>
            {grupo && (
              <button
                type="button"
                onClick={() => irParaFila(grupo)}
                className="inline-flex items-center gap-1 self-start text-[13px] font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cobrar na Fila de cobrança
                <ArrowRight className="size-3.5" aria-hidden />
              </button>
            )}
            {empresas.length === 0 ? (
              <EstadoVazio titulo="Nenhuma empresa" descricao="Nenhuma empresa neste número com os filtros de agora." />
            ) : (
              <ListaDoPasso
                empresas={ordenadas}
                hoje={hoje}
                porta={porta}
                modo={modo}
                aberta={ficha ?? ultima}
                abrirFicha={(e) => abrirFicha(chaveDaFicha(e))}
              />
            )}
          </>
        )}
        <GavetaFicha
          chave={passo ? ficha : null}
          resumo={resumo}
          voltar={{ rotulo: `${curto} · ${INT.format(empresas.length)} empresas`, onClick: () => abrirFicha(null) }}
          fechar={() => abrirFicha(null)}
          abrir={(chave) => abrirFicha(chave)}
        />
      </SheetContent>
    </Sheet>
  );
}

function Somado({ rotulo, valor }: { rotulo: string; valor: number | null }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="num text-lg font-semibold">{valor === null ? "sem acesso" : brlCurto(valor)}</dd>
    </div>
  );
}

type ModoLista = "aceito" | "garantido" | "compensou";

function ListaDoPasso({
  empresas,
  hoje,
  porta,
  modo,
  aberta,
  abrirFicha,
}: {
  empresas: EmpresaFunil[];
  hoje: string;
  porta: boolean;
  modo: ModoLista;
  aberta: string | null;
  abrirFicha: (e: EmpresaFunil) => void;
}) {
  const origem = (o: string) => ORIGENS.find((x) => x.id === o)?.curto ?? o;
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Empresa</TableHead>
            <TableHead className="text-xs">Origem</TableHead>
            <TableHead className="text-xs">Onde está</TableHead>
            <TableHead className="text-right text-xs">Crédito achado</TableHead>
            <TableHead className="text-right text-xs">
              {modo === "garantido" ? "Garantido" : modo === "compensou" ? "Compensado" : "Aceito"}
            </TableHead>
            {porta && <TableHead className="text-right text-xs">Faturado</TableHead>}
            <TableHead className="text-xs">Venda / entrega</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {empresas.slice(0, 300).map((e) => {
            const chave = chaveDaFicha(e);
            return (
              <TableRow
                key={e.chave}
                onClick={chave ? () => abrirFicha(e) : undefined}
                aria-current={chave !== null && chave === aberta ? "true" : undefined}
                className={cn(chave && "cursor-pointer", chave !== null && chave === aberta && "bg-muted/60")}
              >
                <TableCell className="text-xs">
                  {chave ? (
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        abrirFicha(e);
                      }}
                      className="text-left font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {e.nome}
                    </button>
                  ) : (
                    <span className="font-medium">{e.nome}</span>
                  )}
                  <span className="block text-muted-foreground">
                    {e.cnpj ?? "sem CNPJ"}
                    {e.cnpj_fonte === "nome_exato" || e.cnpj_fonte === "nome_parecido"
                      ? " · CNPJ achado pelo nome"
                      : e.cnpj_fonte === "onboarding"
                        ? " · CNPJ do onboarding"
                        : ""}
                    {e.filiais?.length
                      ? ` · mais ${INT.format(e.filiais.length)} ${e.filiais.length === 1 ? "CNPJ" : "CNPJs"} do mesmo cliente`
                      : ""}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  {origem(e.origem)}
                  <span className="block text-muted-foreground">
                    {[e.unidade, e.closer].filter(Boolean).join(" · ") || "—"}
                  </span>
                </TableCell>
                <TableCell className="max-w-[18rem] text-xs">
                  {ondeEsta(e, hoje)}
                  {/* A nota mais recente da Consultoria (22/10/2026, pedido da Karol): o porquê sem abrir a ficha. */}
                  {e.notas?.[0] && (
                    <span
                      className="mt-1 line-clamp-2 text-muted-foreground"
                      title={e.notas
                        .map((n) => `${rotuloNota(n)}${n.em ? ` (${ddmmaa(n.em)})` : ""}: ${n.texto}`)
                        .join("\n\n")}
                    >
                      {rotuloNota(e.notas[0])}
                      {e.notas[0].em ? ` (${ddmmaa(e.notas[0].em)})` : ""}: {e.notas[0].texto}
                    </span>
                  )}
                </TableCell>
                <TableCell className="num whitespace-nowrap text-right text-xs">
                  {num(e.identificado) ? brlCurto(num(e.identificado)) : "—"}
                </TableCell>
                <TableCell className="num whitespace-nowrap text-right text-xs">
                  {modo === "garantido"
                    ? brlCurto(num(e.garantido))
                    : modo === "compensou"
                      ? brlCurto(num(e.estoque_utilizado))
                      : num(e.aceito)
                        ? brlCurto(num(e.aceito))
                        : "—"}
                </TableCell>
                {porta && (
                  <TableCell className="num whitespace-nowrap text-right text-xs">
                    {num(e.faturado) ? brlCurto(num(e.faturado)) : "—"}
                  </TableCell>
                )}
                <TableCell className="text-xs">
                  {e.ganho_em ? `venda ${ddmmaa(e.ganho_em)}` : "carteira"}
                  {e.entregue_em && (
                    <span className="block text-muted-foreground">entrega {ddmmaa(e.entregue_em)}</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {empresas.length > 300 && (
        <p className="border-t p-3 text-xs text-muted-foreground">
          Mostrando as 300 primeiras, por valor. Feche a gaveta e escolha uma unidade para ver o resto.
        </p>
      )}
    </div>
  );
}
