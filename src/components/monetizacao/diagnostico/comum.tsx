// O que as três telas da base nova (pipe 40) dividem: a lista de cards que abre de qualquer número (N2), os formatos e o
// aviso de que a entrada automática e as tarefas estão desligadas. Contrato docs/design/contratos/monetizacao-base-nova.md.
import { useState } from "react";
import { ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EstadoVazio } from "@/components/planning";
import {
  NUMERO_DIAG,
  NOME_DIAG,
  diaSP,
  nomeDoCard,
  relogioDoCard,
  valorDoCard,
  type CardDiag,
  type PainelDiag,
} from "@/lib/monetizacao/diagnostico";

export const INT = new Intl.NumberFormat("pt-BR");
export const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
export const pctDiag = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
export const ddmm = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—";
export const plural = (k: number, um: string, varios: string) =>
  `${INT.format(k)} ${k === 1 ? um : varios}`;

/** Abre a lista dos cards que compõem um número: título e as linhas. */
export type AbrirDiag = (titulo: string, cards: CardDiag[], nota?: (c: CardDiag) => string) => void;

/** Estado da lista aberta e o diálogo que a mostra, num gancho só para as três telas. */
export function useListaDeCards() {
  const [aberta, setAberta] = useState<{
    titulo: string;
    cards: CardDiag[];
    nota?: (c: CardDiag) => string;
  } | null>(null);
  const abrir: AbrirDiag = (titulo, cards, nota) => setAberta({ titulo, cards, nota });
  const dialogo = <ListaDeCards lista={aberta} fechar={() => setAberta(null)} />;
  return { abrir, dialogo };
}

function ListaDeCards({
  lista,
  fechar,
}: {
  lista: { titulo: string; cards: CardDiag[]; nota?: (c: CardDiag) => string } | null;
  fechar: () => void;
}) {
  return (
    <Dialog open={!!lista} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{lista?.titulo}</DialogTitle>
          <DialogDescription>
            {lista ? plural(lista.cards.length, "card", "cards") : ""} do pipe 40 · clique na
            empresa para abrir no Pipedrive
          </DialogDescription>
        </DialogHeader>
        {lista && !lista.cards.length ? (
          <EstadoVazio titulo="Nenhum card neste número" />
        ) : (
          <div className="max-h-[65vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead>Regime</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">D0</TableHead>
                  <TableHead className="text-right">Prazo</TableHead>
                  <TableHead className="text-right">Honorário</TableHead>
                  {lista?.nota && <TableHead>Por quê</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista?.cards.map((c) => {
                  const r = relogioDoCard(c);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {nomeDoCard(c)}
                          <ExternalLink
                            className="size-4 text-muted-foreground"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        </a>
                      </TableCell>
                      <TableCell>{rotuloEtapa(c)}</TableCell>
                      <TableCell>{c.regime_rotulo ?? "—"}</TableCell>
                      <TableCell>{c.unidade ?? "—"}</TableCell>
                      <TableCell className="num text-right">{ddmm(r.d0)}</TableCell>
                      <TableCell className="num text-right">{ddmm(r.prazo)}</TableCell>
                      <TableCell className="num text-right">
                        {valorDoCard(c) > 0 && c.produtos.length ? BRL.format(valorDoCard(c)) : "—"}
                      </TableCell>
                      {lista.nota && (
                        <TableCell className="text-muted-foreground">{lista.nota(c)}</TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function rotuloEtapa(
  c: Pick<CardDiag, "status" | "stage_id" | "won_time" | "lost_time">,
): string {
  if (c.status === "won") return `Ganho em ${ddmm(diaSP(c.won_time))}`;
  if (c.status === "lost") return `Perdido em ${ddmm(diaSP(c.lost_time))}`;
  return `${NUMERO_DIAG[c.stage_id] ?? "?"} · ${NOME_DIAG[c.stage_id] ?? c.stage_id}`;
}

/**
 * O que a entrada automática e as tarefas fariam, enquanto as chaves estão desligadas: as duas só ligam com o "pode
 * ativar" do Pedro (memória ativar-automacao-so-com-aviso). A prévia vem da rodada de 5 minutos.
 */
export function AvisoPrevia({ painel }: { painel: PainelDiag }) {
  const [aberto, setAberto] = useState(false);
  const sync = painel.sync;
  if (!sync) return null;
  const entradaLigada = !!sync.resumo.entrada?.ligada;
  const tarefasLigadas = !!sync.resumo.tarefas?.ligada;
  if (entradaLigada && tarefasLigadas) return null;
  const entradas = sync.previa.entradas;
  const tarefas = sync.previa.tarefas.filter((t) => t.assunto);
  return (
    <div
      role="status"
      className="rounded-lg border bg-card px-3 py-2 text-[13px] text-muted-foreground"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex min-w-0 items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0 text-info" strokeWidth={1.75} aria-hidden />
          <span>
            {!entradaLigada && (
              <>
                <span className="font-medium text-foreground">Entrada automática desligada.</span>{" "}
                {entradas.length
                  ? `Ligada, ${plural(entradas.length, "venda ganha desde", "vendas ganhas desde")} ${ddmm(sync.resumo.entrada?.desde ?? null)} ${entradas.length === 1 ? "vira card" : "viram cards"} no pipe 40 (Lucro Real e Presumido de R$ 10 mi para cima). `
                  : "Nenhuma venda nova para entrar. "}
              </>
            )}
            {!tarefasLigadas && (
              <>
                <span className="font-medium text-foreground">Tarefas por etapa desligadas.</span>{" "}
                {tarefas.length
                  ? `Ligadas, ${plural(tarefas.length, "tarefa nasceria", "tarefas nasceriam")} agora nos cards abertos. `
                  : ""}
              </>
            )}
            Ligar depende do "pode ativar" do Pedro.
          </span>
        </p>
        {entradas.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
            {entradas.length === 1 ? "Ver a venda" : `Ver as ${INT.format(entradas.length)} vendas`}
          </Button>
        )}
      </div>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Vendas que entram no pipe 40 quando a entrada for ligada</DialogTitle>
            <DialogDescription>
              Prévia da rodada de {ddmm(diaSP(sync.previa.gerada_em))}: uma por conta, no nome do
              Matheus, na etapa 01.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ganha em</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Regime</TableHead>
                  <TableHead>Faturamento declarado</TableHead>
                  <TableHead>Unidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entradas.map((e) => (
                  <TableRow key={e.venda_id}>
                    <TableCell className="num">{ddmm(e.ganho_em)}</TableCell>
                    <TableCell className="font-medium text-foreground">{e.empresa}</TableCell>
                    <TableCell>{e.regime ?? "—"}</TableCell>
                    <TableCell>{e.faixa ?? "—"}</TableCell>
                    <TableCell>{e.unidade ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Barra horizontal proporcional, com o número ao lado: o desenho de funil e de linha de tabela das três telas. */
export function Barra({
  valor,
  maximo,
  cor = "bg-chart-1",
}: {
  valor: number;
  maximo: number;
  cor?: string;
}) {
  const w = maximo > 0 ? Math.max(valor > 0 ? 3 : 0, (valor / maximo) * 100) : 0;
  return (
    <span className="relative block h-5 w-full overflow-hidden rounded-sm bg-muted" aria-hidden>
      <span className={`absolute inset-y-0 left-0 rounded-sm ${cor}`} style={{ width: `${w}%` }} />
    </span>
  );
}

/** Número clicável dentro de tabela ou texto (abre a lista); zero aparece como número, não como botão. */
export function NumeroClicavel({
  cards,
  titulo,
  abrir,
  nota,
  className,
}: {
  cards: CardDiag[];
  titulo: string;
  abrir: AbrirDiag;
  nota?: (c: CardDiag) => string;
  className?: string;
}) {
  if (!cards.length)
    return <span className={`num text-muted-foreground ${className ?? ""}`}>0</span>;
  return (
    <button
      type="button"
      onClick={() => abrir(titulo, cards, nota)}
      className={`num rounded-sm font-semibold text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring ${className ?? ""}`}
    >
      {INT.format(cards.length)}
    </button>
  );
}
