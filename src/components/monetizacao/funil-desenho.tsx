// O desenho dos funis da Monetização, o mesmo nas duas bases (20/10/2026, pedido do Pedro: "a tela do pipe 40 tem que ter
// o mesmo design da tela do 39"). Só desenho: quem chama conta os cards e diz o que cada clique abre.
//   LinhaFunil     uma linha do funil do topo da Operação: ícone em rampa, cards, etapa, hoje e a taxa na passagem.
//   FunilEmPilulas uma linha por grupo (unidade), uma coluna por etapa: a pílula centrada com o número dentro, a taxa em
//                  cima e o gargalo em vermelho, o desenho do "Em que etapa cada produto trava?".
import { Fragment, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const INT = new Intl.NumberFormat("pt-BR");
const PCT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

// ---------------------------------------------------------------------------
// Funil do topo
// ---------------------------------------------------------------------------

// Rampa sequencial de uma cor (DESIGN.md §5, funil): o verde da marca em texto (`primary-text`)
// misturado ao `muted`, do claro ao escuro conforme o negócio avança. O ícone troca para a cor do
// card quando o fundo passa da metade, nos dois temas.
export function Rampa({
  passo,
  total,
  icone: Icone,
}: {
  passo: number;
  total: number;
  icone: LucideIcon;
}) {
  const pct = Math.round(22 + (78 * passo) / Math.max(1, total - 1));
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 place-items-center rounded-md",
        pct >= 55 ? "text-card" : "text-foreground",
      )}
      style={{ backgroundColor: `color-mix(in oklab, var(--primary-text) ${pct}%, var(--muted))` }}
    >
      <Icone className="size-4" strokeWidth={1.75} />
    </span>
  );
}

// ícone | cards | etapa | hoje | taxa
const GRADE =
  "grid grid-cols-[1.5rem_3rem_minmax(0,1fr)_3rem_5rem] items-center gap-x-3 sm:grid-cols-[1.5rem_3.5rem_minmax(0,1fr)_3.5rem_5.5rem]";

/** Seta curva da etapa de cima para a de baixo: a taxa é a etapa ÷ a de cima. */
function Conector() {
  return (
    <svg
      viewBox="0 0 9 18"
      className="h-[18px] w-[9px] shrink-0 overflow-visible text-muted-foreground"
      aria-hidden
    >
      <path
        d="M1 1 Q7.5 1 7.5 6 L7.5 11 Q7.5 16.5 1.5 16.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M4 14 L1.5 16.5 L4 19"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Cabeçalho das colunas do funil do topo. */
export function CabecalhoFunil() {
  return (
    <div
      className={cn(
        GRADE,
        "h-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
      )}
    >
      <span className="col-span-2 text-right">Cards</span>
      <span>Etapa</span>
      <span className="text-right">Hoje</span>
      <span className="text-right">Taxa</span>
    </div>
  );
}

export function LinhaFunil({
  icone,
  passo,
  total,
  contagem,
  nome,
  rotulo,
  abrir,
  extra,
  hoje,
  taxa,
}: {
  icone: LucideIcon;
  passo: number;
  total: number;
  contagem: number;
  nome: string;
  /** O que a linha abre, dito ao leitor de tela. */
  rotulo: string;
  abrir: () => void;
  /** O que vem depois do nome ("+N de abordagem anterior", "inclui …"); botão aqui dentro leva `relative z-10`. */
  extra?: ReactNode;
  /** Quantos estão na etapa agora; ausente = a etapa não tem coluna Hoje. */
  hoje?: { n: number; abrir: () => void };
  /** Etapa ÷ a de cima; `undefined` na primeira linha, `null` quando a de cima é zero. */
  taxa?: number | null;
}) {
  return (
    <div className={cn(GRADE, "h-10")}>
      {/* A linha inteira abre a coorte (botão esticado); os botões do `extra` ficam por cima. */}
      <div className="relative col-span-3 grid grid-cols-subgrid items-center rounded-md transition-colors duration-[120ms] ease-out hover:bg-muted/60">
        <button
          type="button"
          onClick={abrir}
          aria-label={`${rotulo}: ${INT.format(contagem)}`}
          className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Rampa passo={passo} total={total} icone={icone} />
        <span className="num text-right text-base font-semibold text-foreground">
          {INT.format(contagem)}
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5 text-sm text-foreground">
          <span className="truncate">{nome}</span>
          {extra}
        </span>
      </div>
      {hoje ? (
        <button
          type="button"
          onClick={hoje.abrir}
          className="num rounded-md text-right text-sm text-muted-foreground outline-none transition-colors duration-[120ms] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {INT.format(hoje.n)}
        </button>
      ) : (
        <span />
      )}
      {/* a taxa pertence à passagem entre esta linha e a de cima: sobe meia linha */}
      <span className="relative self-stretch">
        {taxa !== undefined && (
          <span className="absolute inset-y-0 right-0 flex -translate-y-1/2 items-center gap-1.5">
            <Conector />
            <span className="num w-12 text-right text-[13px] font-semibold text-foreground">
              {taxa === null ? "—" : PCT.format(taxa)}
            </span>
          </span>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funil em pílulas, uma linha por grupo
// ---------------------------------------------------------------------------

/** Uma célula: quantos chegaram à etapa e o que o clique abre. `null` = etapa que o pipe não tem. */
export type CelulaPilula = { contagem: number; titulo: string; abrir: () => void } | null;

export type LinhaPilula = {
  chave: string;
  nome: string;
  /** Linha que não é grupo de verdade ("Sem unidade"): o nome sai apagado. */
  apagada?: boolean;
  celulas: CelulaPilula[];
};

/**
 * A passagem que mais perde numa linha: a menor taxa entre colunas vizinhas a partir de `desde` (a saída da fila é
 * ritmo, não conversão) e só quando a coluna da esquerda tem 3 cards ou mais, para um card não virar gargalo.
 */
function gargaloDaLinha(celulas: CelulaPilula[], desde = 2): number {
  let pior = -1;
  let menor = Infinity;
  celulas.forEach((c, i) => {
    const antes = celulas[i - 1];
    if (i < desde || !c || !antes || antes.contagem < 3) return;
    const t = c.contagem / antes.contagem;
    if (t < menor) {
      menor = t;
      pior = i;
    }
  });
  return pior;
}

/**
 * Funil por grupo no desenho do lado a lado (20/10/2026, pedido do Pedro: o "Em que unidade a base avança?" estava
 * "muito ruim de ler"; "mais próximo do funil da dobra de baixo"). Cada linha é um funil deitado: a pílula é centrada
 * e mede contra a primeira coluna da própria linha, o número fica dentro, a taxa da passagem fica em cima e a passagem
 * que mais perde ganha o vermelho. Zero sai apagado e não abre nada. A linha do Total fecha a grade, em cinza.
 */
export function FunilEmPilulas({
  colunas,
  linhas,
  total,
  cor,
  corTotal,
  rotuloLinhas,
  gargaloDesde = 2,
}: {
  colunas: { chave: string; nome: string }[];
  linhas: LinhaPilula[];
  /** A linha do Total, que soma as outras; sai quando há uma linha só. */
  total?: LinhaPilula;
  cor: string;
  corTotal: string;
  /** Cabeçalho da coluna dos nomes ("Unidade"). */
  rotuloLinhas: string;
  /** Primeira coluna que pode ser gargalo (no pipe 39 a saída da fila é ritmo, então começa na Qualificação). */
  gargaloDesde?: number;
}) {
  const todas = [
    ...linhas.map((l) => ({ ...l, ehTotal: false })),
    ...(total && linhas.length > 1 ? [{ ...total, ehTotal: true }] : []),
  ];
  return (
    <div className="overflow-x-auto px-3 pb-4 pt-3">
      <div
        className="grid gap-x-3"
        style={{
          gridTemplateColumns: `10rem repeat(${colunas.length}, minmax(0, 1fr))`,
          minWidth: `${10 + colunas.length * 6.5}rem`,
        }}
      >
        <div className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {rotuloLinhas}
        </div>
        {colunas.map((c) => (
          <div
            key={c.chave}
            className="pb-2 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {c.nome}
          </div>
        ))}
        {todas.map((l) => {
          const topo = l.celulas[0]?.contagem || 1;
          const gargalo = gargaloDaLinha(l.celulas, gargaloDesde);
          const corDaLinha = l.ehTotal ? corTotal : cor;
          const borda = l.ehTotal ? "mt-1 border-t-2" : "border-t";
          return (
            <Fragment key={l.chave}>
              <div
                className={cn(
                  "flex min-h-14 min-w-0 items-center pr-2 text-sm",
                  borda,
                  l.ehTotal
                    ? "font-bold text-foreground"
                    : l.apagada
                      ? "font-semibold text-muted-foreground"
                      : "font-semibold text-foreground",
                )}
                title={l.nome}
              >
                <span className="truncate">{l.nome}</span>
              </div>
              {l.celulas.map((c, i) => {
                if (!c)
                  return (
                    <div
                      key={colunas[i].chave}
                      className={cn("flex min-h-14 items-center justify-center", borda)}
                    >
                      <span className="num text-sm text-muted-foreground">—</span>
                    </div>
                  );
                const antes = l.celulas[i - 1];
                const taxa = antes && antes.contagem > 0 ? c.contagem / antes.contagem : null;
                const frac = c.contagem ? Math.max(0.1, Math.min(1, c.contagem / topo)) : 0;
                const ehGargalo = gargalo === i;
                return (
                  <div
                    key={colunas[i].chave}
                    className={cn("flex min-h-14 flex-col items-center justify-center py-1", borda)}
                  >
                    <span
                      className={cn(
                        "num text-xs leading-none",
                        ehGargalo ? "font-semibold text-danger" : "text-muted-foreground",
                      )}
                    >
                      {i === 0 || taxa === null ? " " : PCT.format(taxa)}
                      {ehGargalo && " · gargalo"}
                    </span>
                    <button
                      type="button"
                      disabled={!c.contagem}
                      onClick={c.abrir}
                      aria-label={`${c.titulo}: ${INT.format(c.contagem)} cards`}
                      className="group relative mt-1 flex h-7 w-full items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                    >
                      {/* Zero não tem pílula: o gargalo em zero fica só na taxa vermelha. */}
                      {c.contagem > 0 && (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute inset-y-0 rounded-md transition-[filter] duration-150 group-hover:brightness-95",
                            ehGargalo && "ring-2 ring-danger",
                          )}
                          style={{
                            left: `${(1 - frac) * 50}%`,
                            width: `${frac * 100}%`,
                            backgroundColor: `color-mix(in oklab, ${corDaLinha} ${Math.max(28, 72 - i * 5)}%, var(--card))`,
                          }}
                        />
                      )}
                      <span
                        className={cn(
                          "num relative text-sm font-semibold",
                          c.contagem ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {INT.format(c.contagem)}
                      </span>
                    </button>
                  </div>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
