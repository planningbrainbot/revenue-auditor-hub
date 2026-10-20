import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";
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
  PageHeader,
  StatusBadge,
  formatarQuando,
} from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import { hoje as hojeSP } from "@/lib/monetizacao/model";
import { carregarCruzamentoConsultoria } from "@/lib/monetizacao/cruzamento-consultoria.functions";
import { carregarHandoffConsultoria } from "@/lib/monetizacao/handoff-consultoria.functions";
import {
  carregarFichaConsultoria,
  carregarIndicePlataforma,
} from "@/lib/monetizacao/consultoria-ficha.functions";
import { montarFicha, type IndicePlataforma } from "@/lib/monetizacao/consultoria-ficha";
import type { CruzamentoBruto } from "@/lib/monetizacao/cruzamento-consultoria";
import type { PainelBruto } from "@/lib/monetizacao/handoff-consultoria";
import {
  buscarEmpresas,
  doMesmoGrupo,
  indiceEmpresas,
  rotuloEtapa,
  type Empresa,
} from "@/lib/monetizacao/consultoria-empresa";
import { cn } from "@/lib/utils";
import { inputClass } from "./common";
import { Bloco, BlocosPlataforma } from "./consultoria-empresa-detalhe";
import type { BuscaMonetizacao } from "./busca";

// Consultoria › Buscar empresa (contrato docs/design/contratos/monetizacao-consultoria-empresa.md).
// Ficha com busca: nome ou CNPJ → o estado da empresa na Consultoria. Lê os mesmos RPCs das outras abas
// (o cache do react-query é o mesmo) e junta tudo por CNPJ em src/lib/monetizacao/consultoria-empresa.ts.
// Desde 16/10/2026 a ficha aberta lê também o espelho da plataforma do Pedro Siqueira (teses, gestores,
// propostas de todos os status, estoque de crédito, faturas, follow-ups e histórico), atualizado a cada 15 min.

const TITULO = "Consultoria";
const PERGUNTA = "Qual é o estado desta empresa na Consultoria?";
const INT = new Intl.NumberFormat("pt-BR");
const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const brl = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : BRL.format(Math.round(v));
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const ddmmaa = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—";
function fCnpj(c: string | null) {
  if (!c) return "sem CNPJ";
  return c.length === 14
    ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
    : c;
}

/** As três leituras do índice da busca. A gaveta da ficha usa as mesmas chaves: o cache do react-query é um só. */
function useLeiturasDaBusca() {
  const { user } = useAuth();
  const lerCruzamento = useServerFn(carregarCruzamentoConsultoria);
  const lerHandoff = useServerFn(carregarHandoffConsultoria);
  const lerIndice = useServerFn(carregarIndicePlataforma);
  const opcoes = { enabled: !!user, staleTime: 60_000, refetchInterval: 5 * 60_000, retry: 1 };
  const cruz = useQuery({
    queryKey: ["cruzamento-consultoria", user?.id],
    queryFn: () => lerCruzamento(),
    ...opcoes,
  });
  const hand = useQuery({
    queryKey: ["handoff-consultoria", user?.id],
    queryFn: () => lerHandoff(),
    ...opcoes,
  });
  const plat = useQuery({
    queryKey: ["consultoria-plataforma-indice", user?.id],
    queryFn: () => lerIndice(),
    ...opcoes,
  });
  return { cruz, hand, plat };
}

/** A empresa de uma chave da URL: a chave do índice, o CNPJ de uma filial, o negócio ou o cliente da plataforma. */
function acharNaBusca(indice: Empresa[], chave: string): Empresa | null {
  const id = chave.replace(/^(deal|cliente):/, "");
  return (
    indice.find((e) => e.chave === chave) ??
    indice.find((e) => e.cnpjs.includes(chave)) ??
    (chave.startsWith("deal:") ? indice.find((e) => e.negocios.some((n) => String(n.deal) === id)) : undefined) ??
    (chave.startsWith("cliente:")
      ? indice.find((e) => String(e.plataforma?.cliente?.id ?? "") === id)
      : undefined) ??
    null
  );
}

export function ConsultoriaEmpresa({
  busca,
  mudarBusca,
  abas,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  abas?: ReactNode;
}) {
  const { cruz, hand, plat } = useLeiturasDaBusca();
  if (!cruz.data) {
    const erro = cruz.error as Error | null;
    return (
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
        <PageHeader titulo={TITULO} pergunta={PERGUNTA} />
        {abas}
        {!erro ? (
          <Carregando variante="kpis" />
        ) : /^Seu acesso não inclui/.test(erro.message) ? (
          <EstadoSemAcesso oQueFalta="view.monetizacao com todas as unidades" />
        ) : (
          <EstadoErro
            detalhe={`Fonte: plataforma da Consultoria, contratos e PAT. ${erro.message}`}
            tentarNovamente={() => void cruz.refetch()}
          />
        )}
      </main>
    );
  }
  return (
    <PainelConsultoriaEmpresa
      cruzamento={cruz.data}
      handoff={hand.data ?? null}
      plataforma={plat.data ?? null}
      busca={busca}
      mudarBusca={mudarBusca}
      abas={abas}
    />
  );
}

/** A aba a partir dos payloads dos dois RPCs: separada da leitura para a conferência visual com dado real. */
export function PainelConsultoriaEmpresa({
  cruzamento,
  handoff,
  plataforma = null,
  busca,
  mudarBusca,
  abas,
  hoje = hojeSP(),
}: {
  cruzamento: CruzamentoBruto;
  handoff: PainelBruto | null;
  plataforma?: IndicePlataforma | null;
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  abas?: ReactNode;
  hoje?: string;
}) {
  const indice = useMemo(
    () => indiceEmpresas(cruzamento, handoff, hoje, plataforma),
    [cruzamento, handoff, hoje, plataforma],
  );
  const [texto, setTexto] = useState(busca.q ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((busca.q ?? "") !== texto.trim()) mudarBusca({ q: texto.trim() || undefined });
    }, 250);
    return () => clearTimeout(t);
  }, [texto, busca.q, mudarBusca]);
  const resultados = useMemo(() => buscarEmpresas(indice, busca.q ?? ""), [indice, busca.q]);
  // Link com o CNPJ de uma filial abre a ficha em que ela caiu pela raiz.
  const aberta = busca.empresa ? acharNaBusca(indice, busca.empresa) : null;
  const abrir = (e: Empresa) => mudarBusca({ empresa: e.chave });
  const naPlataforma = indice.filter((e) => e.plataforma).length;

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-4 md:px-6">
      <PageHeader
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao={`Busca por nome ou CNPJ em ${INT.format(indice.length)} empresas: ${INT.format(naPlataforma)} clientes na plataforma da Consultoria, os projetos e as propostas sem cadastro, o onboarding e os negócios ganhos em 2026`}
        procedencia={{
          fonte:
            "Plataforma da Consultoria (API e leitura direta, a cada 15 min) · onboarding (Pipefy) · contratos ganhos · PAT no Financeiro",
          atualizadoEm: cruzamento.frescor.consultoria ?? cruzamento.lido_em,
          regua: "uma empresa por CNPJ",
        }}
      />
      {abas}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section
          aria-label="Buscar empresa"
          className="min-w-0 space-y-3 rounded-xl border bg-card p-4"
        >
          <label className="relative block">
            <span className="sr-only">Nome ou CNPJ</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              autoFocus
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Nome ou CNPJ da empresa"
              className={cn(inputClass, "w-full pl-9")}
            />
          </label>
          {!busca.q ? (
            <p className="text-[13px] text-muted-foreground">
              Digite pelo menos 2 letras do nome ou 3 números do CNPJ. A raiz do CNPJ (8 primeiros
              números) acha o grupo inteiro.
            </p>
          ) : resultados.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nenhuma empresa com “{busca.q}” na plataforma, no onboarding nem nos negócios de 2026.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {resultados.length === 30
                  ? "30 primeiros resultados"
                  : `${INT.format(resultados.length)} ${resultados.length === 1 ? "resultado" : "resultados"}`}
              </p>
              <ul className="max-h-[32rem] space-y-1.5 overflow-auto pr-1">
                {resultados.map((e) => (
                  <li key={e.chave}>
                    <button
                      type="button"
                      onClick={() => abrir(e)}
                      aria-current={aberta?.chave === e.chave}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left outline-none transition-colors hover:border-primary-text/40 focus-visible:ring-2 focus-visible:ring-ring",
                        aberta?.chave === e.chave && "border-primary-text/60 bg-muted/40",
                      )}
                    >
                      <span className="text-sm font-semibold leading-snug">{e.nome}</span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="num">{fCnpj(e.cnpj)}</span>
                        <StatusBadge tom={e.situacao.tom} icone={false}>
                          {e.situacao.rotulo}
                        </StatusBadge>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <div className="min-w-0">
          {aberta ? (
            <Ficha
              e={aberta}
              indice={indice}
              abrir={abrir}
              porta={cruzamento.porta_financeiro}
              hoje={hoje}
            />
          ) : (
            <EstadoVazio
              titulo="Escolha uma empresa"
              descricao="Busque pelo nome ou pelo CNPJ e clique no resultado para ver a ficha: situação na Consultoria, projetos, crédito, propostas, de onde veio e o que a PAT faturou."
            />
          )}
        </div>
      </div>
    </main>
  );
}

// ─── A ficha numa gaveta ─────────────────────────────────────────────────────────────────────────

/** O que a lista de origem já sabe da empresa: o cabeçalho da gaveta quando ela não está no índice da busca. */
export interface ResumoFicha {
  nome: string;
  cnpj: string | null;
  linhas: string[];
}

/**
 * A ficha da empresa numa gaveta à direita (pedido do dono em 20/10/2026). Abre por cima da gaveta de uma lista (Funil,
 * Handoff) ou sozinha (Fila de cobrança); `voltar` devolve à lista sem perder o recorte. A chave fica na URL
 * (`empresa`), então o link reabre a mesma ficha. Quem chama a coloca DENTRO do SheetContent da lista: como irmã, o
 * clique fora da ficha caía no fundo da lista e fechava as duas.
 */
export function GavetaFicha({
  chave,
  resumo = null,
  voltar,
  fechar,
  abrir,
}: {
  chave: string | null;
  resumo?: ResumoFicha | null;
  voltar?: { rotulo: string; onClick: () => void };
  fechar: () => void;
  abrir: (chave: string) => void;
}) {
  return (
    <Sheet open={!!chave} onOpenChange={(o) => !o && fechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader className="space-y-1 pr-8">
          {voltar && (
            <button
              type="button"
              onClick={voltar.onClick}
              className="inline-flex max-w-full items-center gap-1.5 self-start rounded-md py-1 text-[13px] font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">Voltar para {voltar.rotulo}</span>
            </button>
          )}
          <SheetTitle className="sr-only">{resumo?.nome ?? "Ficha da empresa"}</SheetTitle>
          <SheetDescription className="sr-only">O estado da empresa na Consultoria</SheetDescription>
        </SheetHeader>
        {chave && (
          <div className="mt-3">
            <FichaDaChave chave={chave} resumo={resumo} abrir={abrir} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FichaDaChave({
  chave,
  resumo,
  abrir,
  hoje = hojeSP(),
}: {
  chave: string;
  resumo: ResumoFicha | null;
  abrir: (chave: string) => void;
  hoje?: string;
}) {
  const { cruz, hand, plat } = useLeiturasDaBusca();
  const indice = useMemo(
    () => (cruz.data ? indiceEmpresas(cruz.data, hand.data ?? null, hoje, plat.data ?? null) : []),
    [cruz.data, hand.data, plat.data, hoje],
  );
  if (!cruz.data) {
    const erro = cruz.error as Error | null;
    return erro ? (
      <EstadoErro
        detalhe={`Fonte: plataforma da Consultoria, contratos e PAT. ${erro.message}`}
        tentarNovamente={() => void cruz.refetch()}
      />
    ) : (
      <Carregando variante="kpis" />
    );
  }
  const e = acharNaBusca(indice, chave);
  if (e)
    return (
      <Ficha
        e={e}
        indice={indice}
        abrir={(g) => abrir(g.chave)}
        porta={cruz.data.porta_financeiro}
        hoje={hoje}
      />
    );
  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-xl font-semibold leading-tight">{resumo?.nome ?? chave}</h2>
        <p className="num text-sm text-muted-foreground">{fCnpj(resumo?.cnpj ?? null)}</p>
        {resumo?.linhas.map((l) => (
          <p key={l} className="text-[13px] text-muted-foreground">
            {l}
          </p>
        ))}
      </section>
      <EstadoVazio
        titulo="Ainda não está na Consultoria"
        descricao="Não tem cadastro, projeto, proposta nem tese na plataforma do Pedro Siqueira, nem onboarding ou negócio de 2026 com este CNPJ."
      />
    </div>
  );
}

// ─── A ficha da empresa ──────────────────────────────────────────────────────────────────────────

function Ficha({
  e,
  indice,
  abrir,
  porta,
  hoje,
}: {
  e: Empresa;
  indice: Empresa[];
  abrir: (e: Empresa) => void;
  porta: CruzamentoBruto["porta_financeiro"];
  hoje: string;
}) {
  const c = e.plataforma?.cliente ?? null;
  const api = e.plataforma?.api ?? null;
  const { user } = useAuth();
  const lerFicha = useServerFn(carregarFichaConsultoria);
  // O espelho da plataforma: só quando a empresa tem algo lá (cliente, projeto, proposta ou tese).
  const temPlataforma =
    !!c || e.propostas.length > 0 || e.semCadastro.projetos.length > 0 || e.semCadastro.teses > 0;
  const detalhe = useQuery({
    queryKey: ["consultoria-ficha", user?.id, e.chave],
    queryFn: () =>
      lerFicha({
        data: { clienteIds: c ? [String(c.id)] : [], cnpjs: e.cnpjs, nomes: e.nomes },
      }),
    enabled: !!user && temPlataforma,
    staleTime: 60_000,
    retry: 1,
  });
  const f = useMemo(() => (detalhe.data ? montarFicha(detalhe.data, hoje) : null), [detalhe.data, hoje]);
  // Com o espelho lido, os números saem dele, como os blocos abaixo; sem ele, da API. Em aberto = não baixado.
  const valorIdentificado = f?.projetos.length
    ? f.projetos.reduce((s, p) => s + p.valor, 0)
    : c
      ? c.valor
      : null;
  const nProjetos = f ? f.projetos.length : (c?.projetos.length ?? 0);
  const nAbertos = f
    ? f.projetos.filter((p) => !p.baixado).length
    : (c?.projetos.filter((p) => !p.encerrado && !p.entregue).length ?? 0);
  const comProjetos = !!c || nProjetos > 0;
  const faturado = e.pat?.reduce((s, m) => s + m.faturado, 0) ?? null;
  const recebido = e.pat?.reduce((s, m) => s + m.recebido, 0) ?? null;
  const grupo = doMesmoGrupo(indice, e);
  const cad = f?.cadastro ?? null;
  const meta = [
    api?.regime_tributario,
    api?.porte,
    [api?.municipio, api?.uf].filter(Boolean).join("/"),
    api?.cnae_descricao,
    cad?.natureza,
    cad?.capital ? `capital ${brl(cad.capital)}` : null,
    cad?.situacao && cad.situacao !== "ATIVA" ? `Receita: ${cad.situacao}` : null,
    cad?.grupo ? `grupo ${cad.grupo}` : null,
  ].filter(Boolean);
  const origem = [
    ...new Set(
      e.negocios.map((n) =>
        n.maquina
          ? "Máquina de vendas (Inside Sales)"
          : n.origem === "socios"
            ? "Pipe Sócios"
            : (n.origem ?? "negócio"),
      ),
    ),
    ...(api?.parceiro ? [`Parceiro na plataforma: ${api.parceiro}`] : []),
    ...[...new Set((f?.projetos ?? []).map((p) => p.canal).filter(Boolean))].map(
      (x) => `Canal: ${x}`,
    ),
    ...(f?.origem?.parceiro && f.origem.parceiro !== api?.parceiro
      ? [`Origem na Consultoria: ${f.origem.parceiro}`]
      : []),
  ];
  // A grade dos números segue a largura da ficha, não a da tela: na gaveta ela tem metade da largura da aba.
  return (
    <div className="@container space-y-4">
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-xl font-semibold leading-tight">{e.nome}</h2>
            <p className="num text-sm text-muted-foreground">{fCnpj(e.cnpj)}</p>
            {e.cnpjs.length > 1 && (
              <p className="text-xs text-muted-foreground">
                Também nesta ficha, pela raiz do CNPJ:{" "}
                <span className="num">
                  {e.cnpjs
                    .filter((x) => x !== e.cnpj)
                    .map(fCnpj)
                    .join(", ")}
                </span>
              </p>
            )}
            {meta.length > 0 && (
              <p className="text-[13px] text-muted-foreground">{meta.join(" · ")}</p>
            )}
          </div>
          <div className="shrink-0 space-y-1 sm:text-right">
            <StatusBadge tom={e.situacao.tom}>{e.situacao.rotulo}</StatusBadge>
            <p className="text-xs text-muted-foreground">{e.situacao.detalhe}</p>
          </div>
        </div>
        {origem.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {origem.map((o) => (
              <StatusBadge key={o} tom="neutro" icone={false}>
                {o}
              </StatusBadge>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Números da empresa" className="grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-4">
        <KpiCard
          rotulo="Valor identificado"
          valor={valorIdentificado === null ? "—" : brl(valorIdentificado)}
          estado={valorIdentificado === null ? "nao-apurado" : "ok"}
          nota={
            valorIdentificado === null
              ? "fora da plataforma"
              : "teses dos projetos, fora as declinadas e as baixadas"
          }
        />
        <KpiCard
          rotulo="Crédito recuperado"
          valor={api ? brl(num(api.credito_recuperado)) : "—"}
          estado={api ? "ok" : "nao-apurado"}
          nota={
            api
              ? `aprovado ${brl(num(api.credito_aprovado))} · saldo ${brl(num(api.credito_saldo))}`
              : "fora da plataforma"
          }
        />
        <KpiCard
          rotulo="Faturado pela PAT"
          valor={e.cnpj ? brl(faturado) : "—"}
          estado={!porta.aberta ? "sem-acesso" : e.cnpj ? "ok" : "nao-apurado"}
          nota={
            !porta.aberta
              ? (porta.motivo ?? "")
              : e.cnpj
                ? `recebido ${brl(recebido)} · desde jan/25`
                : "sem CNPJ para casar"
          }
        />
        <KpiCard
          rotulo="Projetos"
          valor={INT.format(nProjetos)}
          estado={comProjetos ? "ok" : "nao-apurado"}
          nota={comProjetos ? `${INT.format(nAbertos)} em aberto` : "fora da plataforma"}
        />
      </section>

      {temPlataforma && (
        <p className="text-xs text-muted-foreground">
          {detalhe.isLoading
            ? "Lendo a plataforma da Consultoria…"
            : detalhe.error
              ? `A leitura completa da plataforma falhou (${(detalhe.error as Error).message}). Abaixo, só o que a API manda.`
              : `Plataforma da Consultoria lida direto · atualizado ${formatarQuando(f?.sincronizadoEm) ?? "sem data"} · a cada 15 min`}
        </p>
      )}

      {f && <BlocosPlataforma f={f} semCnpj={!e.cnpjs.length} />}

      {!f && c && (
        <Bloco
          titulo="Na Consultoria"
          nota={`cadastrada em ${ddmmaa(c.cadastrado)}${api?.credito_ultima_recuperacao_em ? ` · última recuperação ${ddmmaa(api.credito_ultima_recuperacao_em)}` : ""}`}
        >
          {c.projetos.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Projeto</TableHead>
                    <TableHead className="text-xs">Etapa</TableHead>
                    <TableHead className="text-xs">Na etapa desde</TableHead>
                    <TableHead className="text-xs">Cadastro</TableHead>
                    <TableHead className="text-xs">Entrega</TableHead>
                    <TableHead className="text-right text-xs">Valor identificado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.projetos.map((p) => (
                    <TableRow key={p.chave}>
                      <TableCell className="text-xs">{p.produto ?? "sem produto"}</TableCell>
                      <TableCell className="text-xs">
                        {p.encerrado ? "Encerrado" : (p.etapaDescricao ?? rotuloEtapa(p.etapa))}
                      </TableCell>
                      <TableCell className="text-xs">{ddmmaa(p.naEtapaDesde)}</TableCell>
                      <TableCell className="text-xs">{ddmmaa(p.cadastrado)}</TableCell>
                      <TableCell className="text-xs">{ddmmaa(p.entregue)}</TableCell>
                      <TableCell className="num text-right text-xs">
                        {p.valor ? brl(p.valor) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Cadastrada na plataforma, ainda sem projeto.
            </p>
          )}
        </Bloco>
      )}

      {!f && e.propostas.length > 0 && (
        <Bloco titulo="Propostas">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Produto</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-right text-xs">Êxito</TableHead>
                  <TableHead className="text-right text-xs">Valor</TableHead>
                  <TableHead className="text-xs">Envio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {e.propostas.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs">{p.produto ?? "—"}</TableCell>
                    <TableCell className="text-xs">{p.status ?? "—"}</TableCell>
                    <TableCell className="num text-right text-xs">
                      {p.exito === null ? "—" : `${p.exito.toLocaleString("pt-BR")}%`}
                    </TableCell>
                    <TableCell className="num text-right text-xs">{brl(p.valorTotal)}</TableCell>
                    <TableCell className="text-xs">{ddmmaa(p.envio)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Bloco>
      )}

      {(e.negocios.length > 0 || e.onboarding.length > 0) && (
        <Bloco titulo="De onde veio">
          <ul className="space-y-2 text-sm">
            {e.negocios.map((n) => (
              <li
                key={n.deal}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 last:border-b-0"
              >
                <a
                  href={`https://grupoplanning.pipedrive.com/deal/${n.deal}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary-text hover:underline"
                >
                  Negócio {n.deal}: {n.titulo}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
                <span className="text-xs text-muted-foreground">
                  ganho em {ddmmaa(n.ganho)} · {n.maquina ? "Inside Sales" : (n.origem ?? "—")} ·{" "}
                  {n.unidade ?? "sem unidade"}
                  {n.closer ? ` · ${n.closer}` : ""}
                </span>
              </li>
            ))}
            {e.onboarding.map((o) => (
              <li
                key={o.card}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 last:border-b-0"
              >
                <a
                  href={`https://app.pipefy.com/open-cards/${o.card}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary-text hover:underline"
                >
                  Onboarding: {o.titulo}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
                <span className="text-xs text-muted-foreground">
                  {o.fase ?? "—"} · venda {ddmmaa(o.venda_em)} · kickoff {ddmmaa(o.kickoff_em)}
                  {o.encaminhado ? ` · encaminhado: ${o.encaminhado}` : ""}
                  {o.faixa ? ` · ${o.faixa}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Bloco>
      )}

      <Bloco titulo="PAT mês a mês" nota="faturado por competência, recebido pela data de crédito">
        {!porta.aberta ? (
          <EstadoSemAcesso oQueFalta="acesso ao Brain Financeiro com todas as empresas" />
        ) : !e.pat?.length ? (
          <p className="text-sm text-muted-foreground">
            A PAT não faturou nem recebeu desta empresa desde jan/25.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Mês</TableHead>
                  <TableHead className="text-right text-xs">Faturado</TableHead>
                  <TableHead className="text-right text-xs">Recebido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {e.pat.map((m) => (
                  <TableRow key={m.mes}>
                    <TableCell className="text-xs">{rotuloMes(m.mes)}</TableCell>
                    <TableCell className="num text-right text-xs">{brl(m.faturado)}</TableCell>
                    <TableCell className="num text-right text-xs">{brl(m.recebido)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Bloco>

      {grupo.length > 0 && (
        <Bloco
          titulo="Mesmo grupo"
          nota="mesma raiz de CNPJ ou mesmo grupo econômico na plataforma"
        >
          <ul className="flex flex-wrap gap-2">
            {grupo.slice(0, 20).map((g) => (
              <li key={g.chave}>
                <button
                  type="button"
                  onClick={() => abrir(g)}
                  className="rounded-lg border px-3 py-1.5 text-left text-xs outline-none hover:border-primary-text/40 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block font-semibold">{g.nome}</span>
                  <span className="text-muted-foreground">{g.situacao.rotulo}</span>
                </button>
              </li>
            ))}
          </ul>
        </Bloco>
      )}
    </div>
  );
}
