// Pré-venda › Ficha: "O que foi dito em cada ligação?" Arquétipo Lista/Relatório com a Ficha ao lado (no celular, em
// Sheet), como a tela Gravações. "Reuniões" é a própria tela Gravações (lista e ficha dela, sem reescrever): os
// levantamentos com o sócio, que viram o arsenal de reuniões-modelo.
import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  ExternalLink,
  OctagonAlert,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  ChipFiltro,
  EstadoErro,
  EstadoVazio,
  Procedencia,
  StatusBadge,
} from "@/components/planning";
import { cn } from "@/lib/utils";
import {
  ANTIPADROES,
  avaliadas,
  COMO_COMECA,
  duracao,
  faixa,
  falasDoTrecho,
  filtrarLigacoes,
  primeiroNome,
  ROTULO_FAIXA,
  ROTULO_ITEM,
  situacaoDaLigacao,
  TITULO_PERGUNTA,
  type BlocoAvaliado,
  type Executou,
  type FichaLigacao,
  type LinhaAvaliacao,
  type PerguntaAvaliada,
} from "@/lib/monetizacao/pre-venda";
import type { BuscaMonetizacao } from "./busca";
import { useLargo, type MudarBusca } from "./gravacoes";
import { Frentes } from "./pre-venda-aderencia";
import {
  estadoDaLeitura,
  FONTE_PRE_VENDA,
  INT,
  pct,
  Segmentado,
  SeloNota,
  SeloSituacao,
  TOM_FAIXA,
  type Consulta,
} from "./pre-venda-comum";

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
  iso ? f.format(new Date(iso)).replace(",", "") : "sem data";
const REGUA_LIGACOES = "uma ligação por card: a atendida mais longa, de 60 s ou mais";

export function FichaPreVenda({
  busca,
  mudarBusca,
  avaliacoes,
  ficha,
  escopo,
  reunioes,
  atualizadoEm,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: MudarBusca;
  avaliacoes: Consulta<LinhaAvaliacao[]>;
  ficha: (deal: number) => Promise<FichaLigacao>;
  escopo: string;
  reunioes: ReactNode;
  atualizadoEm: string | null;
}) {
  const tipo = busca.ficha === "reunioes" ? "reunioes" : "ligacoes";
  const alternar = (
    <Segmentado
      rotulo="Ligações ou reuniões"
      tamanho="sm"
      opcoes={[
        { chave: "ligacoes", rotulo: "Ligações" },
        { chave: "reunioes", rotulo: "Reuniões" },
      ]}
      valor={tipo}
      mudar={(v) =>
        mudarBusca({
          ficha: v === "reunioes" ? "reunioes" : undefined,
          ligacao: undefined,
          falta: undefined,
          antipadrao: undefined,
          reuniao: undefined,
          mes: undefined,
          gravacao: undefined,
          q: undefined,
        })
      }
    />
  );
  return (
    <div className="space-y-4">
      {alternar}
      {tipo === "reunioes" ? (
        reunioes
      ) : (
        <Ligacoes
          busca={busca}
          mudarBusca={mudarBusca}
          avaliacoes={avaliacoes}
          ficha={ficha}
          escopo={escopo}
          atualizadoEm={atualizadoEm}
        />
      )}
    </div>
  );
}

function Ligacoes({
  busca,
  mudarBusca,
  avaliacoes,
  ficha,
  escopo,
  atualizadoEm,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: MudarBusca;
  avaliacoes: Consulta<LinhaAvaliacao[]>;
  ficha: (deal: number) => Promise<FichaLigacao>;
  escopo: string;
  atualizadoEm: string | null;
}) {
  const largo = useLargo();
  const estado = estadoDaLeitura({
    consultas: [avaliacoes],
    fonte: "ligações avaliadas da pré-venda",
    variante: "tabela",
  });
  if (estado) return estado;
  const todas = avaliacoes.data!;
  const daPessoa = filtrarLigacoes(todas, { pessoa: busca.responsavel });
  const linhas = filtrarLigacoes(todas, {
    pessoa: busca.responsavel,
    falta: busca.falta,
    antipadrao: busca.antipadrao,
  });
  const aberta =
    linhas.find((l) => l.deal_id === busca.ligacao) ??
    todas.find((l) => l.deal_id === busca.ligacao) ??
    (largo ? (linhas[0] ?? null) : null);

  if (!todas.length)
    return <EstadoVazio titulo="Nenhuma ligação avaliada ainda" descricao={COMO_COMECA} />;

  const nAvaliadas = avaliadas(linhas).length;
  const temRecorte = !!(busca.falta || busca.antipadrao);
  const abrir = (l: LinhaAvaliacao) => mudarBusca({ ligacao: l.deal_id });
  const conteudoFicha = aberta ? (
    <FichaDaLigacao key={aberta.deal_id} linha={aberta} ficha={ficha} escopo={escopo} />
  ) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {busca.falta && (
          <ChipFiltro
            rotulo="Faltou"
            valor={ROTULO_ITEM[busca.falta]}
            aoRemover={() => mudarBusca({ falta: undefined })}
          />
        )}
        {busca.antipadrao && (
          <ChipFiltro
            rotulo="Antipadrão"
            valor={ANTIPADROES[busca.antipadrao] ?? busca.antipadrao}
            aoRemover={() => mudarBusca({ antipadrao: undefined })}
          />
        )}
        <span className="num ml-auto text-[13px] text-muted-foreground">
          <span className="font-semibold text-foreground">{INT.format(linhas.length)}</span>
          {temRecorte ? ` de ${INT.format(avaliadas(daPessoa).length)} avaliadas` : ` ligações`}
          {!temRecorte && linhas.length !== nAvaliadas && ` · ${INT.format(nAvaliadas)} avaliadas`}
        </span>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(440px,1fr)]">
        <section className="min-w-0" aria-label="Ligações do recorte">
          {!linhas.length ? (
            <EstadoVazio titulo="Nenhuma ligação neste recorte" total={todas.length} />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Data</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="hidden md:table-cell">Pessoa</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Duração</TableHead>
                    <TableHead className="text-right">Nota</TableHead>
                    <TableHead className="hidden lg:table-cell">Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((l) => {
                    const sel = aberta?.deal_id === l.deal_id;
                    return (
                      <TableRow
                        key={l.deal_id}
                        tabIndex={0}
                        aria-selected={sel}
                        onClick={() => abrir(l)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            abrir(l);
                          }
                        }}
                        className={cn(
                          "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          sel && "bg-muted",
                        )}
                      >
                        <TableCell className="num text-[13px]">{quando(l.inicio)}</TableCell>
                        <TableCell className="min-w-0">
                          <span className="block font-medium text-foreground">{l.empresa}</span>
                          <span className="block text-xs text-muted-foreground md:hidden">
                            {primeiroNome(l.pessoa)} · {duracao(l.duracao_seg)}
                          </span>
                        </TableCell>
                        <TableCell className="hidden text-[13px] md:table-cell">
                          {primeiroNome(l.pessoa)}
                        </TableCell>
                        <TableCell className="num hidden text-right text-[13px] sm:table-cell">
                          {duracao(l.duracao_seg)}
                        </TableCell>
                        <TableCell className="text-right">
                          {l.status === "avaliada" ? (
                            <SeloNota nota={l.nota} />
                          ) : (
                            <span className="lg:hidden">
                              <SeloSituacao status={l.status} />
                            </span>
                          )}
                          {l.status !== "avaliada" && (
                            <span className="hidden text-muted-foreground lg:inline">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <SeloSituacao status={l.status} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {largo && (
          <aside
            aria-label="Ficha da ligação"
            className="rounded-xl border bg-card p-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto"
          >
            {conteudoFicha ?? (
              <p className="text-sm text-muted-foreground">Escolha uma ligação na lista.</p>
            )}
          </aside>
        )}
      </div>

      {!largo && (
        <Sheet open={!!aberta} onOpenChange={(o) => !o && mudarBusca({ ligacao: undefined })}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
            <SheetHeader className="sr-only">
              <SheetTitle>Ficha da ligação</SheetTitle>
              <SheetDescription>{aberta?.empresa}</SheetDescription>
            </SheetHeader>
            {conteudoFicha}
          </SheetContent>
        </Sheet>
      )}

      <Procedencia fonte={FONTE_PRE_VENDA} atualizadoEm={atualizadoEm} regua={REGUA_LIGACOES} />
    </div>
  );
}

// ── A ficha de uma ligação ──────────────────────────────────────────────────────────────────────────────────────

const MARCA: Record<Executou, { icone: LucideIcon; cor: string; fundo: string; palavra: string }> =
  {
    sim: { icone: CircleCheck, cor: "text-success", fundo: "bg-success-soft", palavra: "fez" },
    parcial: {
      icone: CircleDashed,
      cor: "text-warning",
      fundo: "bg-warning-soft",
      palavra: "fez em parte",
    },
    nao: { icone: CircleX, cor: "text-danger", fundo: "bg-danger-soft", palavra: "não fez" },
  };
const NOME_FRENTE: Record<string, string> = {
  finance: "Finance",
  cella: "Cella",
  consultoria: "Consultoria",
};
const SINAL: Record<
  string,
  { tom: "sucesso" | "neutro" | "atencao"; palavra: string; icone?: LucideIcon }
> = {
  segue: { tom: "sucesso", palavra: "segue" },
  nao_segue: { tom: "neutro", palavra: "não segue" },
  sem_dado: { tom: "neutro", palavra: "sem dado", icone: CircleDashed },
};

const OPORTUNIDADE: Record<"sim" | "nao" | "sem_dado", string> = {
  sim: "sim",
  nao: "não",
  sem_dado: "sem dado",
};

type Escolha = { tipo: "bloco"; chave: string } | { tipo: "pergunta"; chave: string };

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

function FichaDaLigacao({
  linha,
  ficha,
  escopo,
}: {
  linha: LinhaAvaliacao;
  ficha: (deal: number) => Promise<FichaLigacao>;
  escopo: string;
}) {
  const q = useQuery({
    queryKey: ["monetizacao-pre-venda-avaliacao", escopo, linha.deal_id],
    queryFn: () => ficha(linha.deal_id),
    staleTime: 60_000,
    retry: 1,
  });
  const d = q.data;
  const av = d?.avaliacao ?? null;
  const [escolha, setEscolha] = useState<Escolha | null>(null);
  const transcricao = useRef<HTMLDetailsElement>(null);
  const falasRef = useRef<HTMLOListElement>(null);

  const blocos = av?.blocos ?? [];
  const perguntas = av?.perguntas ?? [];
  const padrao: Escolha | null = blocos.length
    ? { tipo: "bloco", chave: (blocos.find((b) => b.executou !== "sim") ?? blocos[0]).chave }
    : null;
  const atual = escolha ?? padrao;
  const blocoAtual =
    atual?.tipo === "bloco" ? blocos.find((b) => b.chave === atual.chave) : undefined;
  const perguntaAtual =
    atual?.tipo === "pergunta" ? perguntas.find((p) => p.chave === atual.chave) : undefined;
  const trecho = blocoAtual?.trecho ?? perguntaAtual?.trecho ?? null;
  const marcadas = new Set(falasDoTrecho(d?.transcricao ?? [], trecho));
  const verNaTranscricao = () => {
    if (transcricao.current) transcricao.current.open = true;
    const i = [...marcadas][0];
    requestAnimationFrame(() =>
      falasRef.current
        ?.querySelector<HTMLElement>(`[data-i="${i}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  };
  const nota = d?.nota ?? linha.nota;
  const situacao = situacaoDaLigacao(d?.status ?? linha.status);

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Ligação de qualificação · {quando(linha.inicio, DATA_LONGA)}
        </p>
        <h2 className="text-base font-semibold leading-snug text-foreground">{linha.empresa}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="num text-[13px] text-muted-foreground">
            card {linha.deal_id} · {linha.pessoa} · {duracao(linha.duracao_seg)}
          </p>
          {(d?.url ?? null) && (
            <Button asChild variant="outline" size="sm" className="ml-auto">
              <a href={d!.url!} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden /> Abrir o card
              </a>
            </Button>
          )}
        </div>
      </header>

      {q.isLoading && <Carregando variante="tabela" linhas={3} />}
      {q.error && (
        <EstadoErro detalhe={(q.error as Error).message} tentarNovamente={() => void q.refetch()} />
      )}

      {d?.mp3_url ? (
        // O link é público da Api4Com (listener). `preload="none"`: nada baixa até a pessoa apertar o play.
        <audio controls preload="none" src={d.mp3_url} className="h-10 w-full">
          <a href={d.mp3_url}>Ouvir a ligação</a>
        </audio>
      ) : (
        d && <p className="text-[13px] text-muted-foreground">Sem áudio desta ligação.</p>
      )}

      {situacao !== "avaliada" && d && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-[13px] text-muted-foreground">
          {situacao === "erro" ? (
            <OctagonAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          ) : (
            <Clock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          )}
          <span>
            {situacao === "na_fila"
              ? "Na fila: a transcrição e a nota saem alguns minutos depois que o áudio chega ao card."
              : situacao === "avaliando"
                ? "Transcrita: a nota sai em seguida."
                : `A avaliação falhou${d.erro ? `: ${d.erro}` : ""}. A função tenta de novo na próxima rodada.`}
          </span>
        </div>
      )}

      {av && nota !== null && (
        <>
          <Placar nota={nota} regua={d?.regua_versao ?? null} notasEm={d?.notas_em ?? null} />

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              A trilha do script
            </p>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Blocos do script">
              {blocos.map((b, i) => (
                <PassoDaTrilha
                  key={b.chave}
                  n={i + 1}
                  bloco={b}
                  perguntas={perguntas}
                  ativo={atual?.tipo === "bloco" && atual.chave === b.chave}
                  escolher={() => setEscolha({ tipo: "bloco", chave: b.chave })}
                />
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="As 4 perguntas">
              {perguntas.map((p, i) => (
                <ChipPergunta
                  key={p.chave}
                  n={i + 1}
                  pergunta={p}
                  ativo={atual?.tipo === "pergunta" && atual.chave === p.chave}
                  escolher={() => setEscolha({ tipo: "pergunta", chave: p.chave })}
                />
              ))}
            </div>
            <TrechoEscolhido
              bloco={blocoAtual}
              pergunta={perguntaAtual}
              perguntas={perguntas}
              temNaTranscricao={marcadas.size > 0}
              verNaTranscricao={verNaTranscricao}
            />
          </div>

          {av.antipadroes.length > 0 && (
            <Bloco titulo="O que não podia ter sido dito">
              <ul className="space-y-2">
                {av.antipadroes.map((a) => (
                  <li
                    key={a.chave}
                    className="rounded-lg border border-danger/40 bg-danger-soft p-3"
                  >
                    <p className="flex items-center gap-2 text-sm font-medium text-danger">
                      <OctagonAlert className="size-4 shrink-0" aria-hidden />
                      {a.titulo}
                    </p>
                    {a.trecho && (
                      <blockquote className="mt-1 border-l-2 border-danger/50 pl-2 text-[13px] italic text-foreground">
                        “{a.trecho}”
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Alerta; não desconta a nota.</p>
            </Bloco>
          )}

          {av.qualificacao && (
            <Bloco titulo="O que levar ao sócio da área">
              {av.qualificacao.resumo && (
                <p className="text-sm text-foreground">{av.qualificacao.resumo}</p>
              )}
              {av.qualificacao.frentes.length > 0 && (
                <ul className="divide-y rounded-lg border text-[13px]">
                  {av.qualificacao.frentes.map((f) => {
                    const s = SINAL[f.sinal] ?? { tom: "neutro" as const, palavra: f.sinal };
                    return (
                      <li
                        key={f.frente}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2"
                      >
                        <span className="w-24 shrink-0 font-medium text-foreground">
                          {NOME_FRENTE[f.frente] ?? f.frente}
                        </span>
                        <StatusBadge tom={s.tom} icone={s.icone}>
                          {s.palavra}
                        </StatusBadge>
                        {f.porque && (
                          <span className="min-w-0 flex-1 text-muted-foreground">{f.porque}</span>
                        )}
                        {f.trecho && (
                          <blockquote className="w-full border-l-2 border-input pl-2 italic text-foreground">
                            “{f.trecho}”
                          </blockquote>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-[13px]">
                {av.oportunidade && (
                  <>
                    <dt className="text-muted-foreground">Oportunidade</dt>
                    <dd>
                      <StatusBadge
                        tom={av.oportunidade === "sim" ? "sucesso" : "neutro"}
                        icone={av.oportunidade === "sem_dado" ? CircleDashed : undefined}
                      >
                        {OPORTUNIDADE[av.oportunidade]}
                      </StatusBadge>
                    </dd>
                  </>
                )}
                {av.qualificacao.quem_decide && (
                  <>
                    <dt className="text-muted-foreground">Quem decide</dt>
                    <dd className="text-foreground">{av.qualificacao.quem_decide}</dd>
                  </>
                )}
                {av.qualificacao.proximo_passo && (
                  <>
                    <dt className="text-muted-foreground">Próximo passo</dt>
                    <dd className="text-foreground">{av.qualificacao.proximo_passo}</dd>
                  </>
                )}
              </dl>
            </Bloco>
          )}
        </>
      )}

      {d && d.transcricao.length > 0 && (
        <details ref={transcricao} className="group border-t pt-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="text-muted-foreground transition-transform group-open:rotate-90"
              >
                ›
              </span>
              O que foi dito
              <span className="num font-normal text-muted-foreground">
                · {INT.format(d.transcricao.length)} falas
              </span>
            </span>
          </summary>
          <ol ref={falasRef} className="mt-3 divide-y rounded-lg border text-[13px]">
            {d.transcricao.map((f, i) => (
              <li
                key={i}
                data-i={i}
                className={cn(
                  "grid grid-cols-[3rem_minmax(0,1fr)] gap-2 px-3 py-2",
                  marcadas.has(i) && "bg-muted",
                )}
              >
                <span className="num text-muted-foreground">{duracao(f.inicio_seg)}</span>
                <span>
                  <span className="font-medium text-foreground">
                    {f.falante === "pre_venda"
                      ? primeiroNome(linha.pessoa)
                      : f.falante === "cliente"
                        ? "Cliente"
                        : f.falante || "Falante"}
                  </span>
                  <span className="block text-foreground">{f.texto}</span>
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** A nota em % grande, o selo da faixa e uma barra que se lê de longe. */
function Placar({
  nota,
  regua,
  notasEm,
}: {
  nota: number;
  regua: string | null;
  notasEm: string | null;
}) {
  const f = faixa(nota);
  const barra = { bom: "bg-success", atencao: "bg-warning", critico: "bg-danger" }[f];
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="num text-[30px] font-bold leading-9 tracking-tight text-foreground">
          {pct(nota)}
        </span>
        <StatusBadge tom={TOM_FAIXA[f].tom} icone={TOM_FAIXA[f].icone}>
          {ROTULO_FAIXA[f]}
        </StatusBadge>
        <span className="text-[13px] text-muted-foreground">de aderência ao script</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(nota)}
        aria-label="Aderência ao script"
      >
        <div
          className={cn("h-full rounded-full", barra)}
          style={{ width: `${Math.min(100, nota)}%` }}
        />
      </div>
      {(regua || notasEm) && (
        <p className="text-xs text-muted-foreground">
          {[regua && `régua ${regua}`, notasEm && `notas no card em ${quando(notasEm, DATA_LONGA)}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

function PassoDaTrilha({
  n,
  bloco,
  perguntas,
  ativo,
  escolher,
}: {
  n: number;
  bloco: BlocoAvaliado;
  perguntas: PerguntaAvaliada[];
  ativo: boolean;
  escolher: () => void;
}) {
  const m = MARCA[bloco.executou];
  const I = m.icone;
  const feitas = perguntas.filter((p) => p.feita).length;
  // Rebaixado (acréscimo de 09/10): a IA marcou sim ou parcial, mas o trecho não está na transcrição, e virou "não".
  const rebaixado =
    bloco.chave === "perguntas" ? perguntas.some((p) => p.rebaixada) : bloco.rebaixado;
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={escolher}
      className={cn(
        "flex min-w-0 flex-col items-start gap-1 rounded-lg border p-2.5 text-left outline-none transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-ring",
        ativo ? "border-foreground" : "hover:border-input",
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full",
            m.fundo,
            m.cor,
          )}
        >
          <I className="size-4" strokeWidth={2} aria-hidden />
          <span className="sr-only">{m.palavra}</span>
        </span>
        <span className="num text-xs text-muted-foreground">peso {INT.format(bloco.peso)}</span>
      </span>
      <span className="text-[13px] font-semibold leading-tight text-foreground">
        {n} · {bloco.titulo}
      </span>
      <span className="num text-xs text-muted-foreground">
        {bloco.chave === "perguntas" ? `${feitas} de ${perguntas.length || 4}` : m.palavra}
      </span>
      {rebaixado && (
        <span className="inline-flex items-center gap-1 text-xs text-warning">
          <SearchX className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {bloco.chave === "perguntas" ? "pergunta sem trecho" : "citado, sem trecho"}
        </span>
      )}
    </button>
  );
}

function ChipPergunta({
  n,
  pergunta,
  ativo,
  escolher,
}: {
  n: number;
  pergunta: PerguntaAvaliada;
  ativo: boolean;
  escolher: () => void;
}) {
  const I = pergunta.feita ? CircleCheck : CircleX;
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={escolher}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-full border px-2.5 py-1 text-left text-[13px] outline-none transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-ring",
        ativo ? "border-foreground" : "hover:border-input",
        !pergunta.feita && "bg-danger-soft",
      )}
    >
      <I
        className={cn("size-4 shrink-0", pergunta.feita ? "text-success" : "text-danger")}
        strokeWidth={2}
        aria-hidden
      />
      <span className="sr-only">{pergunta.feita ? "feita" : "não feita"}: </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        P{n} · {TITULO_PERGUNTA[pergunta.chave] ?? pergunta.titulo}
      </span>
      {pergunta.rebaixada && (
        <SearchX
          className="size-4 shrink-0 text-warning"
          strokeWidth={2}
          role="img"
          aria-label="citada pela IA, mas o trecho não está na transcrição"
        />
      )}
      <Frentes letras={pergunta.frentes} />
    </button>
  );
}

function TrechoEscolhido({
  bloco,
  pergunta,
  perguntas,
  temNaTranscricao,
  verNaTranscricao,
}: {
  bloco?: BlocoAvaliado;
  pergunta?: PerguntaAvaliada;
  perguntas: PerguntaAvaliada[];
  temNaTranscricao: boolean;
  verNaTranscricao: () => void;
}) {
  if (!bloco && !pergunta) return null;
  const trecho = bloco?.trecho ?? pergunta?.trecho ?? null;
  const faltaram = perguntas
    .filter((p) => !p.feita)
    .map((p) => TITULO_PERGUNTA[p.chave] ?? p.titulo);
  const nota = bloco
    ? bloco.chave === "perguntas"
      ? faltaram.length
        ? `Faltou: ${faltaram.join(", ")}.`
        : "As 4 perguntas foram feitas."
      : bloco.nota_curta
    : pergunta && !pergunta.feita
      ? "Não foi feita nesta ligação."
      : null;
  const rebaixadas = bloco
    ? bloco.chave === "perguntas"
      ? perguntas.filter((p) => p.rebaixada).map((p) => TITULO_PERGUNTA[p.chave] ?? p.titulo)
      : bloco.rebaixado
        ? [bloco.titulo]
        : []
    : pergunta?.rebaixada
      ? [TITULO_PERGUNTA[pergunta.chave] ?? pergunta.titulo]
      : [];
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3" aria-live="polite">
      {rebaixadas.length > 0 && (
        <p className="flex items-start gap-1.5 text-[13px] text-foreground">
          <SearchX className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={2} aria-hidden />
          <span>
            {bloco?.chave === "perguntas" && `${rebaixadas.join(", ")}: `}
            citado pela IA, mas o trecho não está na transcrição. Conta como não feito.
          </span>
        </p>
      )}
      {trecho && (
        <blockquote className="border-l-2 border-input pl-2 text-sm italic text-foreground">
          “{trecho}”
        </blockquote>
      )}
      {nota && <p className="text-[13px] text-muted-foreground">{nota}</p>}
      {trecho && temNaTranscricao && (
        <Button variant="link" size="sm" className="h-auto p-0" onClick={verNaTranscricao}>
          Ver na transcrição
        </Button>
      )}
    </div>
  );
}
