import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Search } from "lucide-react";
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
} from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import { hoje as hojeSP } from "@/lib/monetizacao/model";
import { carregarCruzamentoConsultoria } from "@/lib/monetizacao/cruzamento-consultoria.functions";
import { carregarHandoffConsultoria } from "@/lib/monetizacao/handoff-consultoria.functions";
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
import type { BuscaMonetizacao } from "./busca";

// Consultoria › Buscar empresa (contrato docs/design/contratos/monetizacao-consultoria-empresa.md).
// Ficha com busca: nome ou CNPJ → o estado da empresa na Consultoria. Lê os mesmos RPCs das outras abas
// (o cache do react-query é o mesmo) e junta tudo por CNPJ em src/lib/monetizacao/consultoria-empresa.ts.

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

export function ConsultoriaEmpresa({
  busca,
  mudarBusca,
  abas,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  abas?: ReactNode;
}) {
  const { user } = useAuth();
  const lerCruzamento = useServerFn(carregarCruzamentoConsultoria);
  const lerHandoff = useServerFn(carregarHandoffConsultoria);
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
  busca,
  mudarBusca,
  abas,
  hoje = hojeSP(),
}: {
  cruzamento: CruzamentoBruto;
  handoff: PainelBruto | null;
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
  abas?: ReactNode;
  hoje?: string;
}) {
  const indice = useMemo(
    () => indiceEmpresas(cruzamento, handoff, hoje),
    [cruzamento, handoff, hoje],
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
  const aberta = busca.empresa
    ? (indice.find((e) => e.chave === busca.empresa) ??
      indice.find((e) => e.cnpjs.includes(busca.empresa!)) ??
      null)
    : null;
  const abrir = (e: Empresa) => mudarBusca({ empresa: e.chave });
  const naPlataforma = indice.filter((e) => e.plataforma).length;

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-4 md:px-6">
      <PageHeader
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao={`Busca por nome ou CNPJ em ${INT.format(indice.length)} empresas: ${INT.format(naPlataforma)} na plataforma da Consultoria, o onboarding e os negócios ganhos em 2026`}
        procedencia={{
          fonte:
            "API da plataforma da Consultoria · onboarding (Pipefy) · contratos ganhos · PAT no Financeiro",
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
            <Ficha e={aberta} indice={indice} abrir={abrir} porta={cruzamento.porta_financeiro} />
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

// ─── A ficha da empresa ──────────────────────────────────────────────────────────────────────────

function Bloco({ titulo, children, nota }: { titulo: string; children: ReactNode; nota?: string }) {
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{titulo}</h3>
        {nota && <span className="text-xs text-muted-foreground">{nota}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Ficha({
  e,
  indice,
  abrir,
  porta,
}: {
  e: Empresa;
  indice: Empresa[];
  abrir: (e: Empresa) => void;
  porta: CruzamentoBruto["porta_financeiro"];
}) {
  const c = e.plataforma?.cliente ?? null;
  const api = e.plataforma?.api ?? null;
  const faturado = e.pat?.reduce((s, m) => s + m.faturado, 0) ?? null;
  const recebido = e.pat?.reduce((s, m) => s + m.recebido, 0) ?? null;
  const abertos = c?.projetos.filter((p) => !p.encerrado && !p.entregue).length ?? 0;
  const grupo = doMesmoGrupo(indice, e);
  const meta = [
    api?.regime_tributario,
    api?.porte,
    [api?.municipio, api?.uf].filter(Boolean).join("/"),
    api?.cnae_descricao,
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
  ];
  return (
    <div className="space-y-4">
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

      <section aria-label="Números da empresa" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          rotulo="Valor identificado"
          valor={c ? brl(c.valor) : "—"}
          estado={c ? "ok" : "nao-apurado"}
          nota={c ? "soma dos projetos" : "fora da plataforma"}
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
          valor={brl(faturado)}
          estado={porta.aberta ? "ok" : "sem-acesso"}
          nota={porta.aberta ? `recebido ${brl(recebido)} · desde jan/25` : (porta.motivo ?? "")}
        />
        <KpiCard
          rotulo="Projetos"
          valor={INT.format(c?.projetos.length ?? 0)}
          estado={c ? "ok" : "nao-apurado"}
          nota={c ? `${INT.format(abertos)} em aberto` : "fora da plataforma"}
        />
      </section>

      {c && (
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

      {e.propostas.length > 0 && (
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
