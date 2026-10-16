// Operação diária › Base nova (pipe 40). Visão geral: quadros da coorte, funil das 8 etapas, relógio do prazo prometido,
// entrega das três áreas, unidade de origem e o que falta no cadastro. Régua em src/lib/monetizacao/diagnostico.ts.
import type { ReactNode } from "react";
import { CircleCheck, Clock, OctagonAlert, TriangleAlert } from "lucide-react";
import { KpiCard, Secao, StatusBadge, type TomStatus } from "@/components/planning";
import { cn } from "@/lib/utils";
import {
  NOME_AREA,
  areasDiagnostico,
  cadastroDiagnostico,
  funilDiagnostico,
  nomeDoCard,
  quadrosDiagnostico,
  relogioDiagnostico,
  unidadesDiagnostico,
  type CardDiag,
  type EtapaDiag,
  type FiltroDiag,
  type SituacaoRelogio,
} from "@/lib/monetizacao/diagnostico";
import {
  BRL,
  Barra,
  INT,
  NumeroClicavel,
  ddmm,
  pctDiag,
  plural,
  rotuloEtapa,
  type AbrirDiag,
} from "./comum";

const SITUACAO: Record<
  SituacaoRelogio,
  { rotulo: string; tom: TomStatus; icone: typeof Clock; barra: string }
> = {
  atrasado: { rotulo: "Atrasado", tom: "perigo", icone: OctagonAlert, barra: "bg-danger" },
  em_risco: { rotulo: "Em risco", tom: "atencao", icone: TriangleAlert, barra: "bg-warning" },
  no_prazo: { rotulo: "No prazo", tom: "sucesso", icone: Clock, barra: "bg-chart-1" },
  apresentado: { rotulo: "Apresentado", tom: "info", icone: CircleCheck, barra: "bg-chart-2" },
};

export function OperacaoDiagnostico({
  cards,
  etapas,
  filtro,
  hoje,
  abrir,
  recorte,
}: {
  cards: CardDiag[];
  etapas: EtapaDiag[];
  filtro: FiltroDiag;
  hoje: string;
  abrir: AbrirDiag;
  recorte: string;
}) {
  const quadros = quadrosDiagnostico(cards, filtro, etapas);
  const funil = funilDiagnostico(cards, filtro, etapas);
  const relogio = relogioDiagnostico(cards, hoje);
  const areas = areasDiagnostico(cards, hoje);
  const unidades = unidadesDiagnostico(funil.coorte);
  const cadastro = cadastroDiagnostico(cards).filter((f) => f.cards.length);
  const topo = funil.linhas[0]?.cards.length ?? 0;
  return (
    <div className="space-y-6">
      <Secao
        titulo="Quantas vendas viraram diagnóstico, e quanto avançou?"
        descricao={`Cards que entraram no pipe 40 de ${ddmm(filtro.de)} a ${ddmm(filtro.ate)} · ${recorte}`}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {quadros.map((q) => (
            <KpiCard
              key={q.chave}
              rotulo={q.rotulo}
              valor={q.moeda ? BRL.format(q.valor) : INT.format(q.valor)}
              nota={q.nota}
              abrir={{ onClick: () => abrir(q.rotulo, q.cards) }}
            />
          ))}
        </div>
      </Secao>

      <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.2fr)]">
        <section className="rounded-xl border bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground">
              Onde o diagnóstico avança e onde trava?
            </h2>
            {funil.perdidos.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  abrir("Perdidos da coorte", funil.perdidos, (c) => c.lost_reason ?? "sem motivo")
                }
                className="shrink-0 rounded-sm text-[13px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {plural(funil.perdidos.length, "perdido", "perdidos")}
              </button>
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Cada card contado até a etapa mais adiantada a que chegou. Taxa: a etapa ÷ a de cima.
            Hoje: o pipe inteiro agora, fora da taxa.
          </p>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_3rem_minmax(0,1.2fr)_3rem_3.5rem] items-center gap-x-3 gap-y-2 text-[13px]">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Etapa
            </span>
            <span className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cards
            </span>
            <span aria-hidden />
            <span className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Hoje
            </span>
            <span className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Taxa
            </span>
            {funil.linhas.map((l) => (
              <FunilLinha key={l.chave} rotulo={l.rotulo}>
                <NumeroClicavel
                  cards={l.cards}
                  titulo={`${l.rotulo} · coorte`}
                  abrir={abrir}
                  className="text-right"
                />
                <Barra
                  valor={l.cards.length}
                  maximo={topo}
                  cor={l.chave === "ganho" ? "bg-chart-2" : "bg-chart-1"}
                />
                <NumeroClicavel
                  cards={l.hoje}
                  titulo={`${l.rotulo} · agora`}
                  abrir={abrir}
                  className="text-right font-normal"
                />
                <span className="num text-right text-muted-foreground">{pctDiag(l.taxa)}</span>
              </FunilLinha>
            ))}
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">
            Quem está dentro do prazo prometido?
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Cada card aberto com D0, pelos dias desde a pasta completa contra o prazo do cliente (30
            dias no Real, 60 no Presumido). Em risco: 5 dias ou menos.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["atrasado", "em_risco", "no_prazo", "apresentado"] as SituacaoRelogio[]).map((s) => {
              const cs = relogio.pontos.filter((p) => p.situacao === s).map((p) => p.card);
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!cs.length}
                  onClick={() => abrir(`${SITUACAO[s].rotulo} no relógio`, cs)}
                  className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                >
                  <StatusBadge tom={SITUACAO[s].tom} icone={SITUACAO[s].icone}>
                    {SITUACAO[s].rotulo}: {INT.format(cs.length)}
                  </StatusBadge>
                </button>
              );
            })}
            <button
              type="button"
              disabled={!relogio.antesDoD0.length}
              onClick={() => abrir("Antes do D0 (etapas 01 a 03)", relogio.antesDoD0)}
              className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            >
              <StatusBadge tom="neutro">
                Antes do D0: {INT.format(relogio.antesDoD0.length)}
              </StatusBadge>
            </button>
          </div>
          {relogio.pontos.length ? (
            <ul className="mt-3 space-y-2">
              {relogio.pontos.slice(0, 14).map((p) => {
                const passado = Math.min(1, Math.max(0, p.dias / Math.max(1, p.total)));
                return (
                  <li
                    key={p.card.id}
                    className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]"
                  >
                    <button
                      type="button"
                      onClick={() => abrir(nomeDoCard(p.card), [p.card])}
                      className="truncate rounded-sm text-left font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      title={rotuloEtapa(p.card)}
                    >
                      {nomeDoCard(p.card)}
                    </button>
                    <span
                      className="relative block h-5 rounded-sm bg-muted"
                      aria-label={`${p.dias} de ${p.total} dias`}
                    >
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-sm",
                          SITUACAO[p.situacao].barra,
                        )}
                        style={{ width: `${passado * 100}%` }}
                      />
                    </span>
                    <span className="num whitespace-nowrap text-muted-foreground">
                      D+{p.dias} · {p.faltam < 0 ? `passou ${-p.faltam} d` : `faltam ${p.faltam} d`}{" "}
                      · {ddmm(p.prazo)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-muted-foreground">
              Nenhum card com a pasta completa ainda. O relógio começa quando o card entra em 04 ·
              Diagnóstico em Execução.
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">
            As três áreas estão entregando?
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Cards que chegaram ao Diagnóstico em Execução, pelo status de cada área no card.
            Atrasada: pendente depois do prazo interno (D+20 no Real, D+45 no Presumido).
          </p>
          <div className="mt-3 grid grid-cols-[minmax(0,8rem)_repeat(4,minmax(0,1fr))] gap-x-3 gap-y-2 text-[13px]">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Área
            </span>
            <span className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Entregue
            </span>
            <span className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sem oport.
            </span>
            <span className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pendente
            </span>
            <span className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Atrasada
            </span>
            {areas.map((a) => (
              <FunilLinha key={a.area} rotulo={NOME_AREA[a.area]}>
                <NumeroClicavel
                  cards={a.entregue}
                  titulo={`${NOME_AREA[a.area]} · entregue`}
                  abrir={abrir}
                  className="text-right"
                />
                <NumeroClicavel
                  cards={a.semOportunidade}
                  titulo={`${NOME_AREA[a.area]} · sem oportunidade`}
                  abrir={abrir}
                  className="text-right"
                />
                <NumeroClicavel
                  cards={a.pendente}
                  titulo={`${NOME_AREA[a.area]} · pendente`}
                  abrir={abrir}
                  className="text-right"
                />
                <NumeroClicavel
                  cards={a.atrasada}
                  titulo={`${NOME_AREA[a.area]} · atrasada`}
                  abrir={abrir}
                  className="text-right text-danger"
                />
              </FunilLinha>
            ))}
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">
            De que unidade vêm, e até onde chegam?
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            A coorte do funil pela unidade de negócio da venda; cada card numa unidade só, então as
            linhas somam a coorte.
          </p>
          {unidades.length ? (
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_repeat(4,4.5rem)] gap-x-3 gap-y-2 text-[13px]">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Unidade
              </span>
              <span className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Entraram
              </span>
              <span className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Execução
              </span>
              <span className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Apresent.
              </span>
              <span className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ganhos
              </span>
              {unidades.map((u) => (
                <FunilLinha key={u.unidade} rotulo={u.unidade}>
                  <NumeroClicavel
                    cards={u.entraram}
                    titulo={`${u.unidade} · entraram`}
                    abrir={abrir}
                    className="text-right"
                  />
                  <NumeroClicavel
                    cards={u.execucao}
                    titulo={`${u.unidade} · chegaram à execução`}
                    abrir={abrir}
                    className="text-right"
                  />
                  <NumeroClicavel
                    cards={u.apresentados}
                    titulo={`${u.unidade} · apresentados`}
                    abrir={abrir}
                    className="text-right"
                  />
                  <NumeroClicavel
                    cards={u.ganhos}
                    titulo={`${u.unidade} · ganhos`}
                    abrir={abrir}
                    className="text-right"
                  />
                </FunilLinha>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-muted-foreground">Nenhum card entrou no período.</p>
          )}
        </section>
      </div>

      <Secao
        titulo="O que falta no cadastro dos cards?"
        descricao="O que o desenho do processo exige que já esteja no card, conferido na etapa em que ele está."
      >
        {cadastro.length ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {cadastro.map((f) => (
              <button
                key={f.chave}
                type="button"
                onClick={() => abrir(f.rotulo, f.cards)}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-foreground">{f.rotulo}</span>
                <StatusBadge tom="atencao">{INT.format(f.cards.length)}</StatusBadge>
              </button>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <CircleCheck className="size-4 text-success" strokeWidth={1.75} aria-hidden />
            Nenhum card com campo faltando para a etapa em que está.
          </p>
        )}
      </Secao>
    </div>
  );
}

/** Uma linha das grades de tabela: o rótulo e as células que vierem como filhos. */
function FunilLinha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <>
      <span className="truncate text-foreground" title={rotulo}>
        {rotulo}
      </span>
      {children}
    </>
  );
}
