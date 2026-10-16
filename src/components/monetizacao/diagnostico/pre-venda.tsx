// Pré-venda › Base nova (pipe 40). As mesmas quatro visões da base antiga, refeitas para o diagnóstico (sem cadência):
//   Hoje      Fila de trabalho: o que o Matheus e a Jordana fazem hoje (tarefas, parados, prazos, sem próximo passo).
//   Ritmo     Visão geral: tarefas previstas, feitas e vencidas por pessoa e por dia, e as etapas avançadas.
//   Aderência Visão geral: cada passagem de etapa confere o "para avançar" do desenho.
//   Ficha     Ficha: o card no relógio, as tarefas, os campos e os produtos.
// Régua em src/lib/monetizacao/diagnostico.ts.
import {
  CircleCheck,
  CircleX,
  Clock,
  ExternalLink,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { EstadoVazio, KpiCard, Secao, StatusBadge } from "@/components/planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  AREAS,
  CHECAGENS_DIAG,
  NOME_AREA,
  NOME_DIAG,
  NOME_PESSOA_DIAG,
  NUMERO_DIAG,
  ORDEM_DIAG,
  aderenciaDiagnostico,
  diaSP,
  diasEntre,
  hojeDiagnostico,
  nomeDoCard,
  relogioDoCard,
  ritmoDiagnostico,
  valorDoCard,
  type CardDiag,
  type EtapaDiag,
  type FiltroDiag,
  type HojePessoa,
  type ItemHoje,
  type TarefaDiag,
} from "@/lib/monetizacao/diagnostico";
import type { VisaoPreVenda } from "../busca";
import {
  BRL,
  INT,
  NumeroClicavel,
  ddmm,
  pctDiag,
  plural,
  rotuloEtapa,
  type AbrirDiag,
} from "./comum";

export const PERGUNTAS_DIAG: Record<VisaoPreVenda, string> = {
  hoje: "O que o Matheus e a Jordana fazem hoje no diagnóstico?",
  ritmo: "As tarefas do diagnóstico estão saindo no dia?",
  aderencia: "O processo do diagnóstico está sendo seguido?",
  ficha: "Onde está cada card do diagnóstico, e o que falta nele?",
};

export function PreVendaDiagnostico({
  visao,
  cards,
  etapas,
  tarefas,
  filtro,
  hoje,
  card,
  abrirCard,
  abrir,
}: {
  visao: VisaoPreVenda;
  cards: CardDiag[];
  etapas: EtapaDiag[];
  tarefas: TarefaDiag[];
  filtro: FiltroDiag;
  hoje: string;
  card?: number;
  abrirCard: (id: number | undefined) => void;
  abrir: AbrirDiag;
}) {
  if (visao === "hoje")
    return (
      <Hoje
        cards={cards}
        etapas={etapas}
        hoje={hoje}
        pessoa={filtro.pessoa}
        abrir={abrir}
        abrirCard={abrirCard}
      />
    );
  if (visao === "ritmo") return <Ritmo cards={cards} filtro={filtro} hoje={hoje} />;
  if (visao === "aderencia")
    return (
      <Aderencia
        cards={cards}
        tarefas={tarefas}
        filtro={filtro}
        abrir={abrir}
        abrirCard={abrirCard}
      />
    );
  return <Ficha cards={cards} tarefas={tarefas} hoje={hoje} card={card} abrirCard={abrirCard} />;
}

// ---------------------------------------------------------------------------- Hoje

const BLOCOS: {
  chave: keyof Omit<HojePessoa, "pessoa" | "nome">;
  titulo: string;
  icone: typeof Clock;
  tom: "perigo" | "atencao" | "info" | "neutro";
}[] = [
  { chave: "vencidas", titulo: "Tarefas vencidas", icone: OctagonAlert, tom: "perigo" },
  { chave: "hoje", titulo: "Tarefas de hoje", icone: Clock, tom: "info" },
  {
    chave: "prazo",
    titulo: "Prazo do cliente em 5 dias ou vencido",
    icone: TriangleAlert,
    tom: "atencao",
  },
  {
    chave: "parados",
    titulo: "Parados além da estagnação da etapa",
    icone: TriangleAlert,
    tom: "atencao",
  },
  { chave: "semProximo", titulo: "Sem tarefa aberta no card", icone: CircleX, tom: "neutro" },
];

function Hoje({
  cards,
  etapas,
  hoje,
  pessoa,
  abrir,
  abrirCard,
}: {
  cards: CardDiag[];
  etapas: EtapaDiag[];
  hoje: string;
  pessoa?: number;
  abrir: AbrirDiag;
  abrirCard: (id: number) => void;
}) {
  const pessoas = hojeDiagnostico(cards, etapas, hoje).filter(
    (p) => !pessoa || p.pessoa === pessoa,
  );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {pessoas.map((p) => (
        <section
          key={p.pessoa}
          className="space-y-3 rounded-xl border bg-card p-4"
          aria-label={p.nome}
        >
          <div>
            <h2 className="text-base font-semibold text-foreground">{p.nome}</h2>
            <p className="text-[13px] text-muted-foreground">
              {p.pessoa === 24067177
                ? "Etapas 05 a 08 (concluir, apresentar e negociar) e os follow-ups do D+15 e D+40"
                : "Gestor do pipe: etapas 01 a 04 (entrada, apresentação da Jordana, pasta e cobrança das áreas)"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {BLOCOS.map((b) => {
              const itens = p[b.chave] as ItemHoje[];
              return (
                <button
                  key={b.chave}
                  type="button"
                  onClick={() =>
                    abrir(`${p.nome} · ${b.titulo}`, uniq(itens.map((i) => i.card)), (c) =>
                      itens
                        .filter((i) => i.card.id === c.id)
                        .map((i) => i.motivo)
                        .join(" · "),
                    )
                  }
                  disabled={!itens.length}
                  className="rounded-lg border px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="num block text-xl font-semibold text-foreground">
                    {INT.format(itens.length)}
                  </span>
                  <span className="block text-xs text-muted-foreground">{b.titulo}</span>
                </button>
              );
            })}
          </div>
          {BLOCOS.slice(0, 3).map((b) => {
            const itens = p[b.chave] as ItemHoje[];
            if (!itens.length) return null;
            return (
              <div key={b.chave} className="space-y-1.5">
                <StatusBadge tom={b.tom} icone={b.icone}>
                  {b.titulo}
                </StatusBadge>
                <ul className="divide-y rounded-lg border">
                  {itens.slice(0, 8).map((i, k) => (
                    <li
                      key={`${i.card.id}-${k}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]"
                    >
                      <button
                        type="button"
                        onClick={() => abrirCard(i.card.id)}
                        className="min-w-0 truncate rounded-sm text-left font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {nomeDoCard(i.card)}
                      </button>
                      <span className="min-w-0 truncate text-muted-foreground" title={i.motivo}>
                        {i.atividade
                          ? `${ddmm(i.atividade.due_date)} · ${i.motivo.replace(/^Diagnóstico · /, "")}`
                          : i.motivo}
                      </span>
                    </li>
                  ))}
                  {itens.length > 8 && (
                    <li className="px-3 py-2 text-[13px] text-muted-foreground">
                      e mais {INT.format(itens.length - 8)} no número acima
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
          {BLOCOS.every((b) => !(p[b.chave] as ItemHoje[]).length) && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <CircleCheck className="size-4 text-success" strokeWidth={1.75} aria-hidden />
              Nada pendente hoje.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
const uniq = (cs: CardDiag[]) => [...new Map(cs.map((c) => [c.id, c])).values()];

// ---------------------------------------------------------------------------- Ritmo

function Ritmo({ cards, filtro, hoje }: { cards: CardDiag[]; filtro: FiltroDiag; hoje: string }) {
  const pessoas = ritmoDiagnostico(cards, filtro, hoje);
  return (
    <div className="space-y-6">
      {pessoas.map((p) => {
        const maximo = Math.max(1, ...p.dias.map((d) => Math.max(d.previstas, d.feitas)));
        const util = p.dias.filter((d) => d.previstas || d.feitas || d.avancos);
        return (
          <Secao
            key={p.pessoa}
            titulo={`${p.nome}: as tarefas estão saindo?`}
            descricao={`${ddmm(filtro.de)} a ${ddmm(filtro.ate)} · tarefa = atividade do card no Pipedrive (da régua ou criada à mão)`}
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard
                rotulo="Previstas"
                valor={INT.format(p.previstas)}
                nota={`vencimento no período · ${INT.format(p.regua)} da régua`}
              />
              <KpiCard
                rotulo="Feitas"
                valor={INT.format(p.feitas)}
                nota="marcadas como feitas no período"
              />
              <KpiCard
                rotulo="Vencidas"
                valor={INT.format(p.vencidas)}
                nota="venceram no período e seguem abertas"
                tom={p.vencidas ? "atencao" : undefined}
              />
              <KpiCard
                rotulo="Etapas avançadas"
                valor={INT.format(p.avancos)}
                nota="cards que a pessoa moveu para a frente"
              />
            </div>
            {util.length ? (
              <div className="rounded-xl border bg-card p-4">
                <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block size-3 rounded-sm bg-chart-6" aria-hidden />
                    Previstas
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block size-3 rounded-sm bg-chart-1" aria-hidden />
                    Feitas
                  </span>
                </div>
                <div
                  className="flex h-36 items-end gap-1 overflow-x-auto"
                  role="img"
                  aria-label={`Tarefas por dia de ${p.nome}`}
                >
                  {p.dias.map((d) => (
                    <div
                      key={d.dia}
                      className="flex min-w-6 flex-1 flex-col items-center gap-1"
                      title={`${ddmm(d.dia)}: ${d.previstas} previstas, ${d.feitas} feitas, ${d.vencidas} vencidas, ${d.avancos} avanços`}
                    >
                      <div className="flex h-28 w-full items-end justify-center gap-0.5">
                        <span
                          className="w-2 rounded-t-sm bg-chart-6"
                          style={{ height: `${(d.previstas / maximo) * 100}%` }}
                        />
                        <span
                          className="w-2 rounded-t-sm bg-chart-1"
                          style={{ height: `${(d.feitas / maximo) * 100}%` }}
                        />
                      </div>
                      <span className="num text-xs text-muted-foreground">
                        {d.dia.slice(8, 10)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EstadoVazio
                titulo="Nenhuma tarefa no período"
                descricao="As tarefas nascem com a régua do pipe 40 ligada, ou quando alguém cria a atividade no card."
              />
            )}
          </Secao>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------- Aderência

function Aderencia({
  cards,
  tarefas,
  filtro,
  abrir,
  abrirCard,
}: {
  cards: CardDiag[];
  tarefas: TarefaDiag[];
  filtro: FiltroDiag;
  abrir: AbrirDiag;
  abrirCard: (id: number) => void;
}) {
  const passagens = aderenciaDiagnostico(cards, tarefas, filtro).filter(
    (p) => !filtro.pessoa || p.actor_id === filtro.pessoa,
  );
  const conferidas = passagens.filter((p) => p.ok !== null);
  const certas = conferidas.filter((p) => p.ok);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          rotulo="Aderência ao processo"
          valor={conferidas.length ? pctDiag(certas.length / conferidas.length) : "—"}
          estado={conferidas.length ? undefined : "nao-apurado"}
          nota={`${INT.format(certas.length)} de ${INT.format(conferidas.length)} passagens com o "para avançar" cumprido`}
        />
        <KpiCard
          rotulo="Passagens no período"
          valor={INT.format(passagens.length)}
          nota="card movido para a frente, ou perdido"
          abrir={
            passagens.length
              ? {
                  onClick: () =>
                    abrir("Passagens no período", uniqCards(passagens.map((p) => p.card))),
                }
              : undefined
          }
        />
        <KpiCard
          rotulo="Fora do processo"
          valor={INT.format(conferidas.length - certas.length)}
          nota="passou sem o que a etapa exige"
          tom={conferidas.length - certas.length ? "atencao" : undefined}
          abrir={
            conferidas.length - certas.length
              ? {
                  onClick: () =>
                    abrir(
                      "Passagens fora do processo",
                      uniqCards(conferidas.filter((p) => !p.ok).map((p) => p.card)),
                      (c) =>
                        conferidas
                          .filter((p) => !p.ok && p.card.id === c.id)
                          .map((p) => `${p.chave}: ${p.porque}`)
                          .join(" · "),
                    ),
                }
              : undefined
          }
        />
        <KpiCard
          rotulo="Sem como conferir"
          valor={INT.format(passagens.length - conferidas.length)}
          nota="régua desligada: sem tarefa da etapa"
        />
      </div>
      <Secao
        titulo="Em que regra o processo escapa?"
        descricao='Cada regra é o "para avançar" da etapa no desenho do processo, conferida com o dado do card de agora.'
      >
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Regra</TableHead>
                <TableHead>Dono</TableHead>
                <TableHead className="text-right">Cumpriu</TableHead>
                <TableHead className="text-right">Escapou</TableHead>
                <TableHead className="text-right">Aderência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CHECAGENS_DIAG.map((r) => {
                const daRegra = conferidas.filter((p) => p.chave === r.chave);
                const ok = daRegra.filter((p) => p.ok);
                const nao = daRegra.filter((p) => !p.ok);
                return (
                  <TableRow key={r.chave}>
                    <TableCell className="text-foreground">{r.rotulo}</TableCell>
                    <TableCell className="text-muted-foreground">{r.dono}</TableCell>
                    <TableCell className="text-right">
                      <NumeroClicavel
                        cards={ok.map((p) => p.card)}
                        titulo={`${r.rotulo} · cumpriu`}
                        abrir={abrir}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <NumeroClicavel
                        cards={nao.map((p) => p.card)}
                        titulo={`${r.rotulo} · escapou`}
                        abrir={abrir}
                        nota={(c) => nao.find((p) => p.card.id === c.id)?.porque ?? ""}
                      />
                    </TableCell>
                    <TableCell className="num text-right">
                      {daRegra.length ? pctDiag(ok.length / daRegra.length) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Secao>
      {passagens.length > 0 && (
        <Secao titulo="Passagens do período" descricao="A mais recente primeiro.">
          <ul className="divide-y rounded-xl border bg-card">
            {passagens.slice(0, 30).map((p, i) => (
              <li
                key={`${p.card.id}-${p.chave}-${i}`}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {p.ok === null ? (
                    <StatusBadge tom="neutro">sem conferir</StatusBadge>
                  ) : p.ok ? (
                    <StatusBadge tom="sucesso">cumpriu</StatusBadge>
                  ) : (
                    <StatusBadge tom="atencao">escapou</StatusBadge>
                  )}
                  <button
                    type="button"
                    onClick={() => abrirCard(p.card.id)}
                    className="truncate rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {nomeDoCard(p.card)}
                  </button>
                </span>
                <span className="text-muted-foreground">
                  {ddmm(p.dia)} · {p.chave === "perda" ? "perdido" : `saiu da ${p.chave}`} ·{" "}
                  {p.porque}
                  {p.actor_id ? ` · ${NOME_PESSOA_DIAG.get(p.actor_id) ?? "outra pessoa"}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </div>
  );
}
const uniqCards = uniq;

// ---------------------------------------------------------------------------- Ficha

function Ficha({
  cards,
  tarefas,
  hoje,
  card,
  abrirCard,
}: {
  cards: CardDiag[];
  tarefas: TarefaDiag[];
  hoje: string;
  card?: number;
  abrirCard: (id: number | undefined) => void;
}) {
  const ordenados = [...cards].sort((a, b) =>
    String(b.stage_since).localeCompare(String(a.stage_since)),
  );
  const aberto = ordenados.find((c) => c.id === card) ?? ordenados[0];
  if (!aberto) return <EstadoVazio titulo="Nenhum card no pipe 40" />;
  const r = relogioDoCard(aberto);
  const minhas = tarefas.filter((t) => t.deal_id === aberto.id);
  const passagem = new Map(aberto.moves.map((m) => [m.stage_id, m]));
  const campos: [string, boolean, string][] = [
    [
      "Regime e faturamento conferidos",
      aberto.fat_conferido != null,
      aberto.fat_conferido != null
        ? BRL.format(aberto.fat_conferido)
        : (aberto.faixa ?? "faixa da venda"),
    ],
    ["Link da pasta no OneDrive", !!aberto.link_pasta, aberto.link_pasta ?? "—"],
    ["D0 (documentação completa)", !!r.d0, ddmm(r.d0)],
    ["Prazo prometido ao cliente", !!r.prazo, ddmm(r.prazo)],
    ...AREAS.map(
      (a) =>
        [
          `Status ${NOME_AREA[a]}`,
          aberto.areas[a] === "entregue" || aberto.areas[a] === "sem_oportunidade",
          aberto.areas[a]?.replace("_", " ") ?? "vazio",
        ] as [string, boolean, string],
    ),
    [
      "Produtos com honorário",
      aberto.produtos.length > 0 && aberto.produtos.every((p) => p.total > 0),
      aberto.produtos.length ? BRL.format(valorDoCard(aberto)) : "nenhum",
    ],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <nav
        aria-label="Cards do pipe 40"
        className="max-h-[70vh] overflow-auto rounded-xl border bg-card"
      >
        <ul className="divide-y">
          {ordenados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-current={c.id === aberto.id ? "true" : undefined}
                onClick={() => abrirCard(c.id)}
                className={cn(
                  "w-full px-3 py-2 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                  c.id === aberto.id && "bg-muted",
                )}
              >
                <span className="block truncate font-medium text-foreground">{nomeDoCard(c)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {rotuloEtapa(c)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <article className="space-y-4 rounded-xl border bg-card p-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{nomeDoCard(aberto)}</h2>
            <p className="text-[13px] text-muted-foreground">
              {rotuloEtapa(aberto)} · {aberto.regime_rotulo ?? "regime não informado"} ·{" "}
              {aberto.faixa ?? "faixa não informada"} · {aberto.unidade ?? "sem unidade"}
            </p>
          </div>
          <a
            href={aberto.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-primary-text underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Abrir no Pipedrive
            <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden />
          </a>
        </header>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">O caminho no pipe</h3>
          <ol className="grid grid-cols-4 gap-1.5 md:grid-cols-8">
            {ORDEM_DIAG.map((id) => {
              const m = passagem.get(id);
              const atual = aberto.status === "open" && aberto.stage_id === id;
              return (
                <li
                  key={id}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-xs",
                    m ? "border-chart-1 bg-success-soft" : "",
                    atual && "ring-2 ring-ring",
                  )}
                >
                  <span className="block font-semibold text-foreground">{NUMERO_DIAG[id]}</span>
                  <span className="block truncate text-muted-foreground" title={NOME_DIAG[id]}>
                    {NOME_DIAG[id]}
                  </span>
                  <span className="num block text-foreground">{m ? ddmm(diaSP(m.at)) : "—"}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {r.d0 && r.prazo
              ? `Relógio: D0 em ${ddmm(r.d0)}, D+${diasEntre(r.d0, hoje)} hoje, prazo do cliente em ${ddmm(r.prazo)} (${diasEntre(hoje, r.prazo) < 0 ? `passou há ${-diasEntre(hoje, r.prazo)} dias` : `faltam ${diasEntre(hoje, r.prazo)} dias`}), prazo interno das áreas em ${ddmm(r.interno)}.`
              : "O relógio começa quando o card entra em 04 · Diagnóstico em Execução (pasta completa)."}
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              O que o processo pede no card
            </h3>
            <ul className="space-y-1.5 text-[13px]">
              {campos.map(([nome, ok, valor]) => (
                <li key={nome} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-foreground">
                    {ok ? (
                      <CircleCheck
                        className="size-4 text-success"
                        strokeWidth={1.75}
                        aria-label="preenchido"
                      />
                    ) : (
                      <CircleX
                        className="size-4 text-muted-foreground"
                        strokeWidth={1.75}
                        aria-label="falta"
                      />
                    )}
                    {nome}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground" title={valor}>
                    {valor}
                  </span>
                </li>
              ))}
            </ul>
            {aberto.produtos.length > 0 && (
              <ul className="mt-3 space-y-1 text-[13px]">
                {aberto.produtos.map((p) => (
                  <li key={p.product_id} className="flex justify-between gap-3">
                    <span className="text-foreground">{p.nome}</span>
                    <span className="num text-muted-foreground">{BRL.format(p.total)}</span>
                  </li>
                ))}
              </ul>
            )}
            {aberto.nao_vendido && (
              <p className="mt-2 text-[13px] text-muted-foreground">
                Não vendido: {aberto.nao_vendido}
              </p>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Tarefas do card</h3>
            {aberto.atividades.length ? (
              <ul className="divide-y rounded-lg border text-[13px]">
                {[...aberto.atividades]
                  .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
                  .map((a) => {
                    const vencida = !a.done && !!a.due_date && a.due_date < hoje;
                    return (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-3 px-3 py-1.5"
                      >
                        <span className="min-w-0 truncate text-foreground" title={a.subject}>
                          {a.subject.replace(/^Diagnóstico · /, "")}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                          <span className="num">{ddmm(a.due_date)}</span>
                          {a.done ? (
                            <StatusBadge tom="sucesso">feita</StatusBadge>
                          ) : vencida ? (
                            <StatusBadge tom="perigo">vencida</StatusBadge>
                          ) : (
                            <StatusBadge tom="neutro">aberta</StatusBadge>
                          )}
                          <span>
                            {a.user_id
                              ? (NOME_PESSOA_DIAG.get(a.user_id)?.split(" ")[0] ?? "outro")
                              : ""}
                          </span>
                        </span>
                      </li>
                    );
                  })}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">Nenhuma atividade no card.</p>
            )}
            {minhas.some((t) => t.status === "apagada") && (
              <p className="mt-2 text-xs text-muted-foreground">
                {plural(
                  minhas.filter((t) => t.status === "apagada").length,
                  "tarefa da régua foi apagada",
                  "tarefas da régua foram apagadas",
                )}{" "}
                quando o card saiu da etapa sem fazê-las.
              </p>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
