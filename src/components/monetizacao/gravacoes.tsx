// Tela Gravações da Monetização (`/monetizacao?aba=gravacoes`). Contrato docs/design/contratos/monetizacao-gravacoes.md,
// spec docs/superpowers/specs/2026-10-02-monetizacao-gravacoes-tela.md. Arquétipo Lista/Relatório: barra de filtros
// com "N de M", até 4 KpiCard que filtram a lista, tabela em caixa com borda, e a Ficha ao lado (no celular, em Sheet).
// Nada é calculado aqui: a lista vem de src/lib/monetizacao/gravacoes.ts, e o que é sensível chega das RPCs já recortado
// pela trava do servidor.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Download,
  ExternalLink,
  Lock,
  Mic,
  MicOff,
  Search,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  BarraFiltros,
  Carregando,
  ChipFiltro,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Procedencia,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { motivoSemGravacao } from "../../../supabase/functions/monetizacao-reunioes/agenda.ts";
import {
  contarSituacoes,
  filtrar,
  mesesDaLista,
  minuto,
  montarReunioes,
  nomeDoArquivo,
  nomeDoFalante,
  ofertadoDaFicha,
  PRODUTOS_OFERTADOS,
  recorte,
  ROTULO_SITUACAO,
  ROTULO_TIPO,
  SITUACOES_GRAVACAO,
  transcricaoEmTexto,
  type DetalheGravacao,
  type ListaGravacoes,
  type ProdutoOfertado,
  type Reuniao,
  type SituacaoGravacao,
} from "@/lib/monetizacao/gravacoes";
import { carregarGravacao, carregarGravacoes } from "@/lib/monetizacao/gravacoes.functions";
import type { BaseMonetizacao } from "@/lib/monetizacao/types";
import type { BuscaMonetizacao } from "./busca";
import { downloadCsv } from "./common";

export const FONTE_GRAVACOES =
  "Pipedrive, pipeline 39 (histórico do card) · fila do bot de reuniões (Brain Meet) · avaliação pelo playbook do Caixa";
const REGUA_GRAVACOES =
  "data = início da reunião registrada, ou entrada do card na etapa quando não há registro";

const NOME_PRODUTO: Record<ProdutoOfertado, string> = {
  cella: "Cella",
  consultoria: "Consultoria",
  finance: "Finance",
};
const SELO: Record<SituacaoGravacao, { tom: TomStatus; icone?: LucideIcon }> = {
  na_fila: { tom: "info", icone: Clock },
  gravando: { tom: "info", icone: Mic },
  avaliada: { tom: "sucesso" },
  sem_gravacao: { tom: "neutro", icone: MicOff },
  erro: { tom: "perigo" },
  sem_registro: { tom: "atencao" },
};
const LIMITE = 100;
const INT = new Intl.NumberFormat("pt-BR");
const NOTA = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const SP = "America/Sao_Paulo";
const DIA_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: SP,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const DATA_LONGA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: SP,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const quando = (iso: string | null, f = DIA_HORA) =>
  iso ? f.format(new Date(iso.replace(" ", "T"))).replace(",", "") : "sem data";
const reunioes = (n: number) => (n === 1 ? "reunião" : "reuniões");

export type MudarBusca = (patch: Partial<BuscaMonetizacao>) => void;

/** A aba como o Brain usa: lê a lista e a ficha pelas RPCs, com a sessão da pessoa. */
export function VisaoGravacoes({
  data,
  busca,
  mudarBusca,
}: {
  data: BaseMonetizacao;
  busca: BuscaMonetizacao;
  mudarBusca: MudarBusca;
}) {
  const { user } = useAuth();
  const listaFn = useServerFn(carregarGravacoes);
  const detalheFn = useServerFn(carregarGravacao);
  const q = useQuery({
    queryKey: ["monetizacao-gravacoes", user?.id],
    queryFn: () => listaFn(),
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
  return (
    <PainelGravacoes
      data={data}
      busca={busca}
      mudarBusca={mudarBusca}
      escopo={user?.id ?? "anonimo"}
      lista={{
        data: q.data,
        erro: q.error as Error | null,
        carregando: q.isLoading,
        tentarNovamente: () => void q.refetch(),
      }}
      detalhe={(event_id) => detalheFn({ data: { event_id } })}
    />
  );
}

export type EstadoLista = {
  data?: ListaGravacoes;
  erro: Error | null;
  carregando: boolean;
  tentarNovamente: () => void;
};

/** A tela em si, sem transporte: recebe a lista e o leitor da ficha (o preview de captura usa dado local). */
export function PainelGravacoes({
  data,
  busca,
  mudarBusca,
  lista,
  detalhe,
  escopo,
}: {
  data: BaseMonetizacao;
  busca: BuscaMonetizacao;
  mudarBusca: MudarBusca;
  lista: EstadoLista;
  detalhe: (eventId: string) => Promise<DetalheGravacao>;
  escopo: string;
}) {
  const largo = useLargo();
  const [limite, setLimite] = useState(LIMITE);
  const filtro = { mes: busca.mes, gravacao: busca.gravacao, q: busca.q };
  useEffect(() => setLimite(LIMITE), [busca.mes, busca.gravacao, busca.q]);

  const todas = useMemo(
    () =>
      lista.data
        ? montarReunioes({ cards: data.cards, stages: data.stages, lista: lista.data })
        : [],
    [data.cards, data.stages, lista.data],
  );
  const doRecorte = recorte(todas, filtro);
  const linhas = filtrar(todas, filtro);
  const n = contarSituacoes(doRecorte);
  const meses = mesesDaLista(todas);
  const aberta =
    todas.find((r) => r.chave === busca.reuniao) ?? (largo ? (linhas[0] ?? null) : null);

  if (lista.carregando) return <Carregando variante="tabela" />;
  if (lista.erro || !lista.data)
    return (
      <EstadoErro
        detalhe={`Fonte: gravações da Monetização. ${lista.erro?.message ?? ""}`}
        tentarNovamente={lista.tentarNovamente}
      />
    );

  const { admin, closers } = lista.data;
  const nomeCloser =
    data.cards.find((c) => c.owner_id !== null && closers.includes(c.owner_id))?.owner ?? null;
  const escopoTexto = admin
    ? "Você vê todas as reuniões do pipe 39, como admin da Monetização."
    : closers.length
      ? `Você vê só as reuniões dos seus cards${nomeCloser ? ` (${nomeCloser})` : ""}.`
      : null;

  if (!todas.length)
    return (
      <EstadoVazio
        titulo={
          escopoTexto ? "Nenhuma reunião no seu acesso" : "As gravações são do closer e do admin"
        }
        descricao={
          escopoTexto
            ? "Quando um card seu chegar à reunião, ela aparece aqui."
            : "Você vê a Monetização, mas não é closer de nenhum card do pipe 39 (pelo e-mail do Pipedrive) nem admin da área. Quem precisa ver todas as reuniões pede o nível de admin da Monetização."
        }
      />
    );

  const temFiltro = !!(busca.mes || busca.gravacao || busca.q);
  const abrirFicha = (r: Reuniao) => mudarBusca({ reuniao: r.chave });
  const exportarLista = () =>
    downloadCsv(`gravacoes-monetizacao${busca.mes ? `-${busca.mes}` : ""}.csv`, [
      [
        "Data (Brasília)",
        "Origem",
        "Empresa",
        "Card",
        "Tipo",
        "Closer",
        "Etapa de hoje",
        "Gravação",
        "Nota",
        "Ofertado (lido da gravação)",
      ],
      ...linhas.map((r) => [
        quando(r.data, DATA_LONGA),
        r.origem === "registrada" ? "reunião registrada" : "histórico do card",
        r.empresa,
        r.deal_id,
        ROTULO_TIPO[r.tipo],
        r.closer,
        r.etapa,
        ROTULO_SITUACAO[r.situacao],
        r.nota === null ? "" : NOTA.format(r.nota),
        r.ofertado.map((p) => NOME_PRODUTO[p]).join(", "),
      ]),
    ]);

  const ficha = aberta ? (
    <FichaReuniao key={aberta.chave} r={aberta} data={data} detalhe={detalhe} escopo={escopo} />
  ) : null;

  return (
    <div className="space-y-4">
      <BarraFiltros
        aoLimpar={
          temFiltro
            ? () => mudarBusca({ mes: undefined, gravacao: undefined, q: undefined })
            : undefined
        }
      >
        <Select
          value={busca.mes ?? "todos"}
          onValueChange={(v) => mudarBusca({ mes: v === "todos" ? undefined : v })}
        >
          <SelectTrigger className="h-8 w-40" aria-label="Mês da reunião">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os meses</SelectItem>
            {meses.map((m) => (
              <SelectItem key={m} value={m}>
                {rotuloMes(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={busca.gravacao ?? "todas"}
          onValueChange={(v) =>
            mudarBusca({ gravacao: v === "todas" ? undefined : (v as SituacaoGravacao) })
          }
        >
          <SelectTrigger className="h-8 w-56" aria-label="Situação da gravação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as situações</SelectItem>
            {SITUACOES_GRAVACAO.map((s) => (
              <SelectItem key={s} value={s}>
                {ROTULO_SITUACAO[s]} ({INT.format(n[s])})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="relative">
          <span className="sr-only">Buscar empresa, card ou closer</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            key={busca.q ?? ""}
            defaultValue={busca.q ?? ""}
            placeholder="Empresa, card ou closer"
            className="h-8 w-56 pl-8"
            onKeyDown={(e) => {
              if (e.key === "Enter")
                mudarBusca({ q: (e.target as HTMLInputElement).value.trim() || undefined });
            }}
            onBlur={(e) => {
              const v = e.target.value.trim() || undefined;
              if (v !== busca.q) mudarBusca({ q: v });
            }}
          />
        </label>
        {busca.mes && (
          <ChipFiltro
            rotulo="Mês"
            valor={rotuloMes(busca.mes)}
            aoRemover={() => mudarBusca({ mes: undefined })}
          />
        )}
        {busca.gravacao && (
          <ChipFiltro
            rotulo="Gravação"
            valor={ROTULO_SITUACAO[busca.gravacao]}
            aoRemover={() => mudarBusca({ gravacao: undefined })}
          />
        )}
        {busca.q && (
          <ChipFiltro
            rotulo="Busca"
            valor={busca.q}
            aoRemover={() => mudarBusca({ q: undefined })}
          />
        )}
        <span className="num ml-auto text-[13px] text-muted-foreground">
          <span className="font-semibold text-foreground">{INT.format(linhas.length)}</span> de{" "}
          {INT.format(todas.length)} {reunioes(todas.length)}
        </span>
      </BarraFiltros>

      {escopoTexto && (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Lock className="size-4 shrink-0" aria-hidden />
          {escopoTexto}
        </p>
      )}

      <KpiGrade colunas={4}>
        <KpiCard
          rotulo="Avaliadas"
          valor={INT.format(n.avaliada)}
          unidade={`de ${INT.format(doRecorte.length)} ${reunioes(doRecorte.length)}`}
          nota="transcrição pronta e nota no card"
          abrir={{ onClick: () => mudarBusca({ gravacao: "avaliada" }), rotulo: "Filtrar a lista" }}
        />
        <KpiCard
          rotulo="Na fila do bot"
          valor={INT.format(n.na_fila)}
          unidade={reunioes(n.na_fila)}
          nota="o bot entra na hora marcada"
          abrir={{ onClick: () => mudarBusca({ gravacao: "na_fila" }), rotulo: "Filtrar a lista" }}
        />
        <KpiCard
          rotulo="Sem registro no card"
          valor={INT.format(n.sem_registro)}
          unidade={reunioes(n.sem_registro)}
          nota="falta a atividade de Reunião com o link"
          tom={n.sem_registro > 0 ? "atencao" : undefined}
          tomRotulo={n.sem_registro > 0 ? "registrar no card" : undefined}
          abrir={{
            onClick: () => mudarBusca({ gravacao: "sem_registro" }),
            rotulo: "Filtrar a lista",
          }}
        />
        <KpiCard
          rotulo="Sem gravação"
          valor={INT.format(n.sem_gravacao)}
          unidade={reunioes(n.sem_gravacao)}
          nota="a reunião aconteceu sem o bot"
          abrir={{
            onClick: () => mudarBusca({ gravacao: "sem_gravacao" }),
            rotulo: "Filtrar a lista",
          }}
        />
      </KpiGrade>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(400px,1fr)]">
        <section className="min-w-0 space-y-3" aria-labelledby="lista-gravacoes">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="space-y-0.5">
              <h2 id="lista-gravacoes" className="text-base font-semibold text-foreground">
                Quais reuniões estão neste recorte?
              </h2>
              <p className="text-[13px] text-muted-foreground">
                A mais recente primeiro. Clique numa linha para ver a ficha.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={exportarLista} disabled={!linhas.length}>
              <Download aria-hidden /> Exportar lista
            </Button>
          </div>
          {!linhas.length ? (
            <EstadoVazio titulo="Nenhuma reunião neste recorte" total={todas.length} />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Data</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="hidden md:table-cell">Tipo</TableHead>
                    <TableHead className="hidden lg:table-cell">Etapa de hoje</TableHead>
                    <TableHead>Gravação</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Nota</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.slice(0, limite).map((r) => {
                    const sel = aberta?.chave === r.chave;
                    return (
                      <TableRow
                        key={r.chave}
                        tabIndex={0}
                        aria-selected={sel}
                        onClick={() => abrirFicha(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            abrirFicha(r);
                          }
                        }}
                        className={cn(
                          "cursor-pointer align-top outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          sel && "bg-muted",
                        )}
                      >
                        <TableCell className="num text-[13px]">
                          {quando(r.data)}
                          {r.origem === "historico" && (
                            <span
                              className="block text-xs text-muted-foreground"
                              title="Sem reunião registrada: data de entrada do card na etapa"
                            >
                              pelo histórico
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="min-w-0">
                          <span className="block font-medium text-foreground">{r.empresa}</span>
                          <span className="num block text-xs text-muted-foreground">
                            card {r.deal_id} · {r.closer}
                            <span className="md:hidden"> · {ROTULO_TIPO[r.tipo]}</span>
                          </span>
                        </TableCell>
                        <TableCell className="hidden text-[13px] md:table-cell">
                          {ROTULO_TIPO[r.tipo]}
                        </TableCell>
                        <TableCell className="hidden text-[13px] lg:table-cell">
                          {r.etapa}
                        </TableCell>
                        <TableCell>
                          <Selo situacao={r.situacao} />
                        </TableCell>
                        <TableCell className="num hidden text-right sm:table-cell">
                          {r.nota === null ? "—" : NOTA.format(r.nota)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {linhas.length > limite && (
                <div className="flex items-center justify-between border-t px-3 py-2 text-[13px] text-muted-foreground">
                  <span className="num">
                    Mostrando {INT.format(limite)} de {INT.format(linhas.length)}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setLimite((x) => x + LIMITE)}>
                    Mostrar mais {LIMITE}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>

        {largo && (
          <aside
            aria-label="Ficha da reunião"
            className="rounded-xl border bg-card p-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto"
          >
            {ficha ?? (
              <p className="text-sm text-muted-foreground">Escolha uma reunião na lista.</p>
            )}
          </aside>
        )}
      </div>

      {!largo && (
        <Sheet open={!!aberta} onOpenChange={(o) => !o && mudarBusca({ reuniao: undefined })}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
            <SheetHeader className="sr-only">
              <SheetTitle>Ficha da reunião</SheetTitle>
              <SheetDescription>{aberta?.empresa}</SheetDescription>
            </SheetHeader>
            {ficha}
          </SheetContent>
        </Sheet>
      )}

      <Procedencia
        fonte={FONTE_GRAVACOES}
        atualizadoEm={data.measured_at}
        regua={REGUA_GRAVACOES}
      />
    </div>
  );
}

function Selo({ situacao }: { situacao: SituacaoGravacao }) {
  const s = SELO[situacao];
  return (
    <StatusBadge tom={s.tom} icone={s.icone}>
      {ROTULO_SITUACAO[situacao]}
    </StatusBadge>
  );
}

/** Largura em que a ficha cabe ao lado da lista (xl); abaixo dela, a ficha abre num Sheet. */
function useLargo() {
  const [largo, setLargo] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1280px)");
    const mudar = () => setLargo(mql.matches);
    mudar();
    mql.addEventListener("change", mudar);
    return () => mql.removeEventListener("change", mudar);
  }, []);
  return largo;
}

function Bloco({
  titulo,
  acoes,
  children,
}: {
  titulo: string;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
        {acoes}
      </div>
      {children}
    </section>
  );
}

/** A ficha de uma reunião: situação, avaliação, ofertado e transcrição (essas três só depois da checagem do servidor). */
function FichaReuniao({
  r,
  data,
  detalhe,
  escopo,
}: {
  r: Reuniao;
  data: BaseMonetizacao;
  detalhe: (eventId: string) => Promise<DetalheGravacao>;
  escopo: string;
}) {
  const registrada = r.origem === "registrada";
  const q = useQuery({
    queryKey: ["monetizacao-gravacao", escopo, r.chave],
    queryFn: () => detalhe(r.chave),
    enabled: registrada,
    staleTime: 60_000,
    retry: 1,
  });
  const d = q.data;
  const card = data.cards.find((c) => c.id === r.deal_id);
  const noCampo = (card?.offered ?? []).map((p) => NOME_PRODUTO[p as ProdutoOfertado] ?? p);
  const falasRef = useRef<HTMLOListElement>(null);
  const irPara = (ordem: number) =>
    falasRef.current
      ?.querySelector<HTMLElement>(`[data-ordem="${ordem}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });

  const ofertado = d && d.transcricao === "pronta" ? ofertadoDaFicha(d) : null;
  const marcas = new Map<number, ProdutoOfertado[]>();
  if (ofertado && d)
    for (const p of PRODUTOS_OFERTADOS) {
      const o = ofertado[p];
      if (o.apresentado !== "sim" || o.inicio_s === null) continue;
      const fala = d.falas.find((f) => Number(f.inicio_s) === Number(o.inicio_s));
      if (fala) marcas.set(fala.ordem, [...(marcas.get(fala.ordem) ?? []), p]);
    }

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Reunião de {ROTULO_TIPO[r.tipo].toLowerCase()} · {quando(r.data, DATA_LONGA)}
        </p>
        <h2 className="text-base font-semibold leading-snug text-foreground">{r.empresa}</h2>
        <p className="num text-[13px] text-muted-foreground">
          card {r.deal_id} · closer {r.closer} · etapa de hoje: {r.etapa}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Selo situacao={r.situacao} />
          {r.nota !== null && (
            <span className="num text-[13px] font-medium text-foreground">
              nota {NOTA.format(r.nota)}/10
            </span>
          )}
          {r.url && (
            <Button asChild variant="outline" size="sm" className="ml-auto">
              <a href={r.url} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden /> Abrir o card
              </a>
            </Button>
          )}
        </div>
      </header>

      <p className="text-sm text-foreground">{explicacao(r, d)}</p>

      {registrada && q.isLoading && <Carregando variante="tabela" linhas={3} />}
      {registrada && q.error && (
        <EstadoErro detalhe={(q.error as Error).message} tentarNovamente={() => void q.refetch()} />
      )}

      {d?.avaliacao && (
        <Bloco titulo="Como a reunião foi avaliada?">
          <p className="num text-[13px] text-muted-foreground">
            <span className="text-2xl font-bold text-foreground">
              {d.avaliacao.nota === null ? "—" : NOTA.format(d.avaliacao.nota)}
            </span>{" "}
            /10 ·{" "}
            {Object.entries(d.avaliacao.blocos)
              .map(([b, v]) => `${ROTULO_BLOCO[b] ?? b} ${v === null ? "—" : NOTA.format(v)}`)
              .join(" · ")}
          </p>
          <ul className="space-y-1.5 text-[13px]">
            {d.avaliacao.fases.map((f) => {
              const I = MARCA_FASE[f.executou];
              return (
                <li key={f.id} className="flex gap-2">
                  <I.icone className={cn("mt-0.5 size-4 shrink-0", I.cor)} aria-hidden />
                  <span>
                    <span className="sr-only">{I.palavra}: </span>
                    <span className="font-medium text-foreground">{f.nome}</span>
                    {f.nota_curta && (
                      <span className="text-muted-foreground"> · {f.nota_curta}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {d.avaliacao.recomendacao && (
            <p className="text-[13px] text-foreground">
              <span className="font-medium">Para a próxima:</span> {d.avaliacao.recomendacao}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            A mesma avaliação foi ao card como nota
            {d.nota_pipedrive_id ? ` (nota ${d.nota_pipedrive_id})` : ""}; rubrica de{" "}
            {d.avaliacao.versao_rubrica}. Trecho que não está na transcrição não conta.
          </p>
        </Bloco>
      )}

      <Bloco titulo="O que foi ofertado?">
        {ofertado ? (
          <ul className="divide-y rounded-lg border text-[13px]">
            {PRODUTOS_OFERTADOS.map((p) => {
              const o = ofertado[p];
              return (
                <li key={p} className="space-y-1 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium text-foreground">{NOME_PRODUTO[p]}</span>
                    {o.apresentado === "sim" ? (
                      <span className="num text-muted-foreground">
                        apresentado
                        {o.inicio_s !== null && (
                          <>
                            {" · "}
                            <button
                              type="button"
                              onClick={() => {
                                const f = d?.falas.find((x) => Number(x.inicio_s) === o.inicio_s);
                                if (f) irPara(f.ordem);
                              }}
                              className="text-primary-text underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {minuto(o.inicio_s)}
                            </button>
                          </>
                        )}
                        {" · "}confiança{" "}
                        {o.confianca === "alta"
                          ? "alta"
                          : o.confianca === "media"
                            ? "média"
                            : "não localizada"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">não apareceu</span>
                    )}
                  </div>
                  {o.apresentado === "sim" && o.evidencia && (
                    <blockquote className="border-l-2 border-input pl-2 italic text-muted-foreground">
                      “{o.evidencia}”
                    </blockquote>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {registrada && d?.transcricao !== "pronta"
              ? "Sai da transcrição, quando ela ficar pronta."
              : "Sem gravação, só o que o card diz."}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Campo “Caixa · Produtos ofertados” no card hoje:{" "}
          {noCampo.length ? noCampo.join(", ") : "vazio"}.
          {d?.ofertados_gravados_em &&
            (d.ofertados_gravados?.length
              ? ` Esta reunião somou ${d.ofertados_gravados.map((p) => NOME_PRODUTO[p]).join(", ")} em ${quando(d.ofertados_gravados_em, DATA_LONGA)}.`
              : ` Conferido em ${quando(d.ofertados_gravados_em, DATA_LONGA)}: nada a somar.`)}
        </p>
      </Bloco>

      {d && d.transcricao === "pronta" && (
        <Bloco
          titulo="O que foi dito?"
          acoes={
            <Button
              variant="outline"
              size="sm"
              disabled={!d.falas.length}
              onClick={() => baixarTexto(nomeDoArquivo(r), transcricaoEmTexto(r, d))}
            >
              <Download aria-hidden /> Exportar .txt
            </Button>
          }
        >
          <p className="num text-xs text-muted-foreground">
            {INT.format(d.falas.length)} falas
            {d.duracao_s ? ` · ${minuto(d.duracao_s)} de gravação` : ""} · transcrição automática,
            separada por falante
          </p>
          <ol
            ref={falasRef}
            className="max-h-[28rem] divide-y overflow-y-auto rounded-lg border text-[13px]"
          >
            {d.falas.map((f) => {
              const m = marcas.get(f.ordem);
              return (
                <li
                  key={f.ordem}
                  data-ordem={f.ordem}
                  className={cn(
                    "grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 px-3 py-2",
                    m && "bg-muted",
                  )}
                >
                  <span className="num text-muted-foreground">{minuto(f.inicio_s)}</span>
                  <span>
                    <span className="font-medium text-foreground">
                      {nomeDoFalante(f.falante, d.nomes)}
                    </span>
                    {m && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ofertado: {m.map((p) => NOME_PRODUTO[p]).join(", ")}
                      </span>
                    )}
                    <span className="block text-foreground">{f.texto}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </Bloco>
      )}
    </div>
  );
}

const ROTULO_BLOCO: Record<string, string> = {
  abertura: "Abertura",
  diagnostico: "Diagnóstico",
  saida: "Saída",
  proposta: "Proposta",
};
const MARCA_FASE: Record<
  "sim" | "parcial" | "nao",
  { icone: LucideIcon; cor: string; palavra: string }
> = {
  sim: { icone: CircleCheck, cor: "text-success", palavra: "fez" },
  parcial: { icone: CircleDashed, cor: "text-warning", palavra: "fez em parte" },
  nao: { icone: CircleX, cor: "text-danger", palavra: "não fez" },
};

/** Uma frase do que aconteceu com a gravação desta reunião. */
function explicacao(r: Reuniao, d: DetalheGravacao | undefined): string {
  switch (r.situacao) {
    case "sem_registro":
      return `O card está em ${r.etapa} e não tem atividade de Reunião com hora e link do Teams. Registre a reunião no card para o bot entrar e a nota de avaliação chegar depois.`;
    case "na_fila":
      return `O bot entra em ${quando(r.data, DATA_LONGA)}. Alguém precisa admitir “Planning - Assistente de Reuniao” no lobby do Teams; o bot grava até 2 reuniões ao mesmo tempo.`;
    case "gravando":
      return "A gravação chegou. A transcrição fica pronta 40 a 50 minutos depois do fim, e a nota vai ao card em seguida.";
    case "avaliada":
      return "Transcrita e avaliada pelo playbook do Caixa. Confira antes de usar: a avaliação é automática.";
    case "erro":
      return `A última leitura falhou${r.banco?.erro ? `: ${r.banco.erro}` : ""}. A função tenta de novo a cada 5 minutos.`;
    case "sem_gravacao":
      if (r.origem === "historico")
        return "Nenhuma gravação: a reunião não foi registrada no card com o link do Teams, então o bot não foi chamado. O bot automático começou em 02/10/2026.";
      return `Sem gravação: ${motivoSemGravacao(d?.bot ?? r.banco?.bot ?? null, d?.transcricao ?? r.banco?.transcricao ?? null)}.`;
  }
}

function baixarTexto(nome: string, texto: string) {
  const url = URL.createObjectURL(new Blob([texto], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
