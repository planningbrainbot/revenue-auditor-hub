import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, type TomStatus } from "@/components/planning";
import { CORES_SERIE } from "@/lib/planning/grafico";
import { partesDoLink } from "@/lib/areas";
import type { ComponenteFunil, RepasseUnidade } from "@/lib/receita-repasses.functions";
import { brlOuTraco, pctOuTraco, rotuloDia } from "./moldura";

/**
 * Apurado → faturado → recebido do repasse de um mês, com o que ficou em cada
 * degrau (DATA-RULES: "apurado = cobrado"; divergir do caixa é inadimplência,
 * divergir da cobrança é problema de dado).
 *
 * Só entram unidades com a apuração fechada: rascunho ainda muda de valor, e
 * já tem card próprio em "O que pede atenção".
 */

const NOME_COMPONENTE: Record<ComponenteFunil, string> = {
  nd: "ND de royalties, CAC e outras",
  csc: "CSC",
  midia: "Mídia",
};

const NOME_CURTO: Record<ComponenteFunil, string> = { nd: "ND", csc: "CSC", midia: "Mídia" };

function seloDoTitulo(status: string | null): { tom: TomStatus; texto: string } {
  switch (status) {
    case "ATRASADO":
      return { tom: "perigo", texto: "Atrasado" };
    case "VENCE HOJE":
      return { tom: "atencao", texto: "Vence hoje" };
    case "A VENCER":
      return { tom: "info", texto: "A vencer" };
    case null:
      return { tom: "neutro", texto: "Sem título no Omie" };
    default:
      return { tom: "neutro", texto: status };
  }
}

function Degrau({ rotulo, valor, base }: { rotulo: string; valor: number; base: number }) {
  const pct = base > 0 ? (valor / base) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{rotulo}</span>
        <span className="num text-sm">
          <strong className="text-base">{brlOuTraco(valor)}</strong>
          <span className="ml-2 text-muted-foreground">{pctOuTraco(pct, 0)} do apurado</span>
        </span>
      </div>
      <div className="mt-1 h-3 w-full rounded-sm bg-muted" aria-hidden>
        <div
          className="h-full rounded-r-[4px]"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: CORES_SERIE[0] }}
        />
      </div>
    </div>
  );
}

function Queda({ valor, texto }: { valor: number; texto: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5 pl-1 text-[13px] text-muted-foreground">
      <ArrowDown className="size-3.5" aria-hidden />
      {valor >= 0.01 ? (
        <span>
          <span className="num font-medium text-foreground">{brlOuTraco(valor)}</span> {texto}
        </span>
      ) : (
        <span>nada {texto}</span>
      )}
    </div>
  );
}

export function FunilRepasse({
  unidades,
  nomeMes,
  destino,
}: {
  unidades: RepasseUnidade[];
  nomeMes: string;
  destino: string;
}) {
  const r = useMemo(() => {
    const fechadas = unidades.filter((u) => u.funil);
    const soma = (f: (u: RepasseUnidade) => number) => fechadas.reduce((s, u) => s + f(u), 0);
    const naoFaturado = fechadas
      .flatMap((u) => u.funil!.naoFaturado.map((n) => ({ unidade: u.unidade, ...n })))
      .sort((a, b) => b.valor - a.valor);
    const naoRecebido = fechadas
      .map((u) => {
        const f = u.funil!;
        const aberto = f.faturado - f.recebido;
        const atrasado = f.titulosEmAberto.some((t) => t.status === "ATRASADO");
        const semTitulo = f.titulosEmAberto.some((t) => t.status === null);
        const proximo = f.titulosEmAberto[0] ?? null;
        return {
          unidade: u.unidade,
          valor: aberto,
          vencimento: proximo?.vencimento ?? null,
          status: atrasado ? "ATRASADO" : semTitulo ? null : (proximo?.status ?? null),
        };
      })
      .filter((x) => x.valor >= 0.01)
      .sort((a, b) => b.valor - a.valor);
    return {
      fechadas: fechadas.length,
      abertas: unidades.filter((u) => !u.funil).length,
      apurado: soma((u) => u.funil!.apurado),
      faturado: soma((u) => u.funil!.faturado),
      recebido: soma((u) => u.funil!.recebido),
      acima: fechadas.flatMap((u) =>
        u.funil!.acimaDoApurado.map((x) => ({ unidade: u.unidade, ...x })),
      ),
      naoFaturado,
      naoRecebido,
    };
  }, [unidades]);

  const link = partesDoLink(destino);

  if (r.fechadas === 0) return null;

  const totalNaoFaturado = r.apurado - r.faturado;
  const totalNaoRecebido = r.faturado - r.recebido;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Do apurado ao recebido: quanto já virou dinheiro?
          </h3>
          <p className="text-[13px] text-muted-foreground">
            {r.fechadas} unidade(s) com a apuração de {nomeMes} fechada
            {r.abertas > 0 && ` · ${r.abertas} ainda aberta(s) ficam fora`} · faturado pelos títulos
            da Partners no mês seguinte, recebido pelo status do título no Omie
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to={link.to as never} search={link.search as never}>
            Abrir apuração <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>

      <Card className="p-4">
        <Degrau rotulo="Apurado" valor={r.apurado} base={r.apurado} />
        <Queda valor={totalNaoFaturado} texto="apurado e não faturado" />
        <Degrau rotulo="Faturado" valor={r.faturado} base={r.apurado} />
        <Queda valor={totalNaoRecebido} texto="faturado e não recebido" />
        <Degrau rotulo="Recebido" valor={r.recebido} base={r.apurado} />
        {r.acima.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <p className="text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">Cobrado acima do apurado</span>, fora do
              funil: títulos do mês de cobrança que passam do apurado do componente. Costuma ser
              cobrança atrasada de outra competência ou apuração reeditada depois da nota, e nos
              dois casos o apurado não bate com o cobrado.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {r.acima.map((x) => (
                <Badge
                  key={`${x.unidade}-${x.componente}`}
                  variant="outline"
                  className="font-normal"
                >
                  {x.unidade}
                  <span className="num ml-1 text-muted-foreground">
                    · {NOME_CURTO[x.componente]} {brlOuTraco(x.valor)}
                  </span>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <h4 className="text-sm font-medium">O que não foi faturado</h4>
          <p className="mb-2 text-[13px] text-muted-foreground">
            Apurado sem nota correspondente, por unidade e por trilho de cobrança.
          </p>
          {r.naoFaturado.length === 0 ? (
            <StatusBadge tom="sucesso">Tudo faturado</StatusBadge>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead>O que falta cobrar</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.naoFaturado.map((n) => (
                  <TableRow key={`${n.unidade}-${n.componente}`}>
                    <TableCell className="font-medium">{n.unidade}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {NOME_COMPONENTE[n.componente]}
                    </TableCell>
                    <TableCell className="num text-right">{brlOuTraco(n.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="num text-right">{brlOuTraco(totalNaoFaturado)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </Card>

        <Card className="p-4">
          <h4 className="text-sm font-medium">O que não foi recebido</h4>
          <p className="mb-2 text-[13px] text-muted-foreground">
            Faturado e ainda não baixado no Omie. A data é o vencimento mais próximo em aberto.
          </p>
          {r.naoRecebido.length === 0 ? (
            <StatusBadge tom="sucesso">Tudo recebido</StatusBadge>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.naoRecebido.map((n) => {
                  const selo = seloDoTitulo(n.status);
                  return (
                    <TableRow key={n.unidade}>
                      <TableCell className="font-medium">{n.unidade}</TableCell>
                      <TableCell className="num">{rotuloDia(n.vencimento) ?? "sem data"}</TableCell>
                      <TableCell>
                        <StatusBadge tom={selo.tom}>{selo.texto}</StatusBadge>
                      </TableCell>
                      <TableCell className="num text-right">{brlOuTraco(n.valor)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="num text-right">{brlOuTraco(totalNaoRecebido)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
