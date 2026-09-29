import type { ReactNode } from "react";
import { MessagesSquare } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BotaoDestino } from "@/components/cockpit-ceo/composicao";
import { EstadoBadge, valorCurto } from "@/components/cockpit-ceo/estado";
import { formatarNumero } from "@/lib/cockpit-ceo/contrato";
import { COBERTURAS } from "@/lib/cockpit-coo/contrato";
import type { Destino, Estado, Explicacao, GraficoCoo, NumeroCoo, TabelaDados, Tema } from "@/lib/cockpit-coo/contrato";

// A gaveta do Cockpit do COO: o parágrafo que sai da tela mora aqui (mesma regra do Cockpit do
// CEO, revisão de 28/09). O que diz; como se calcula; fonte e data; que parte das unidades cobre;
// atenção; dono; a tela que resolve; e os dados desenhados em tabela, a vista acessível.

export type Detalhe =
  | { tipo: "numero"; numero: NumeroCoo }
  | { tipo: "grafico"; grafico: GraficoCoo; dados?: TabelaDados }
  | {
      tipo: "livre";
      titulo: string;
      estado: Estado;
      valor?: string;
      explicacao: Explicacao;
      fonte: string;
      dataDado: string | null;
      destino: Destino | null;
      dados?: TabelaDados;
    };

const quando = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        ...(iso.length === 10 ? {} : { hour: "2-digit", minute: "2-digit" }),
      })
    : "sem data";

function Parte({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h3>
      <div className="text-sm">{children}</div>
    </section>
  );
}

function Dados({ dados }: { dados: TabelaDados }) {
  if (!dados.linhas.length) return <p className="text-sm text-muted-foreground">Nenhuma linha.</p>;
  return (
    <div className="max-h-80 overflow-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {dados.colunas.map((c) => (
              <TableHead key={c} className="text-xs">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {dados.linhas.map((l, i) => (
            <TableRow key={i}>
              {l.map((v, j) => (
                <TableCell key={j} className="num text-xs">
                  {v === null ? "—" : typeof v === "number" ? v.toLocaleString("pt-BR") : v}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Tabela dos pontos de um gráfico, quando o tema não mandou uma própria. */
export function tabelaDoGrafico(g: GraficoCoo): TabelaDados {
  return {
    colunas: [g.tipo === "linhas" ? "Mês" : "Unidade", ...g.series.map((s) => s.rotulo)],
    linhas: g.pontos.map((p) => [
      p.rotulo,
      ...g.series.map((s) => {
        const v = p[s.chave];
        return typeof v === "number" ? formatarNumero(v, g.unidade) : v == null ? null : String(v);
      }),
    ]),
  };
}

export function GavetaCoo({
  detalhe,
  tema,
  onFechar,
}: {
  detalhe: Detalhe | null;
  tema: Tema;
  onFechar: () => void;
}) {
  const d = detalhe;
  const titulo = !d ? "" : d.tipo === "numero" ? d.numero.rotulo : d.tipo === "grafico" ? d.grafico.titulo : d.titulo;
  const estado: Estado = !d ? "disponivel" : d.tipo === "numero" ? d.numero.estado : d.tipo === "grafico" ? d.grafico.estado : d.estado;
  const explicacao = !d ? null : d.tipo === "numero" ? d.numero.explicacao : d.tipo === "grafico" ? d.grafico.explicacao : d.explicacao;
  const fonte = !d ? "" : d.tipo === "numero" ? d.numero.fonte : d.tipo === "grafico" ? d.grafico.fonte : d.fonte;
  const dataDado = !d ? null : d.tipo === "numero" ? d.numero.dataDado : d.tipo === "grafico" ? d.grafico.dataDado : d.dataDado;
  const destino = !d ? null : d.tipo === "numero" ? d.numero.destino : d.tipo === "grafico" ? d.grafico.destino : d.destino;
  const motivo = !d ? undefined : d.tipo === "numero" ? d.numero.motivo : d.tipo === "grafico" ? d.grafico.motivo : undefined;
  const dados = !d
    ? undefined
    : d.tipo === "numero"
      ? d.numero.dados
      : d.tipo === "grafico"
        ? (d.dados ?? tabelaDoGrafico(d.grafico))
        : d.dados;
  const valor =
    !d || estado === "fonte_indisponivel" || estado === "acesso_insuficiente" || estado === "nao_apurado"
      ? null
      : d.tipo === "numero"
        ? valorCurto(d.numero.valor, d.numero.unidade)
        : d.tipo === "livre"
          ? (d.valor ?? null)
          : null;
  const pergunta = encodeURIComponent(`Sobre "${titulo}" no tema ${tema}: o que explica este número?`);

  return (
    <Sheet open={!!d} onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {d && explicacao && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <EstadoBadge estado={estado} />
              </div>
              <SheetTitle>{titulo}</SheetTitle>
              <SheetDescription>
                {fonte} · {quando(dataDado)}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-5">
              {valor && <p className="num text-3xl font-semibold">{valor}</p>}
              {motivo && (
                <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">{motivo}</p>
              )}
              <Parte titulo="O que diz">{explicacao.oQueDiz}</Parte>
              <Parte titulo="Como se calcula">{explicacao.comoCalcula}</Parte>
              {d.tipo === "numero" && <Parte titulo="Que unidades cobre">{COBERTURAS[d.numero.cobertura]}</Parte>}
              {explicacao.atencao && <Parte titulo="Atenção">{explicacao.atencao}</Parte>}
              <Parte titulo="Dono">{explicacao.dono}</Parte>
              <div className="flex flex-wrap gap-2">
                {destino && <BotaoDestino destino={destino} preview={false} />}
                <Button asChild size="sm" variant="ghost">
                  <Link to="/cockpit-coo/perguntar" search={{ q: decodeURIComponent(pergunta), tema }}>
                    <MessagesSquare className="mr-1 size-4" aria-hidden />
                    Perguntar ao Brain
                  </Link>
                </Button>
              </div>
              {destino && !destino.mesmoRecorte && (
                <p className="text-xs text-muted-foreground">{destino.observacao}</p>
              )}
              {dados && (
                <Parte titulo="Os dados">
                  <Dados dados={dados} />
                </Parte>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
