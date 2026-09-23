import { useRouter } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatarNumero, formatarValor, somaDaComposicao } from "@/lib/cockpit-ceo/contrato";
import type { Destino, Indicador } from "@/lib/cockpit-ceo/contrato";
import { dataBr } from "@/lib/cockpit-ceo/periodo";
import { EstadoBadge, SinteticoBadge } from "./estado";

const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Sem data: nenhuma carga concluída";

function Linha({ termo, children }: { termo: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_1fr] gap-2 py-1 text-xs">
      <dt className="text-muted-foreground">{termo}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export const hrefDoDestino = (d: Destino) => {
  const q = new URLSearchParams(d.search).toString();
  return d.rota + (q ? "?" + q : "");
};

export function BotaoDestino({
  destino,
  preview,
  compacto = false,
}: {
  destino: Destino;
  preview: boolean;
  /** Só o botão, com a explicação no title: para listas curtas como as decisões. */
  compacto?: boolean;
}) {
  const router = useRouter();
  const href = hrefDoDestino(destino);
  if (preview && compacto)
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        title={`No preview sintético o destino não abre (exige login e dados reais): ${href}`}
      >
        {destino.rotulo}
      </Button>
    );
  if (preview)
    return (
      <div className="space-y-1">
        <Button size="sm" variant="outline" disabled>
          {destino.rotulo}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          No preview sintético o destino não abre: ele exige login e dados reais do Brain. Endereço:{" "}
          <code>{href}</code>
        </p>
      </div>
    );
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => (destino.externo ? window.location.assign(href) : router.navigate({ href }))}
    >
      {destino.rotulo}
      <ArrowUpRight className="ml-1 h-3 w-3" />
    </Button>
  );
}

export function ComposicaoIndicador({
  indicador: i,
  onFechar,
  preview,
}: {
  indicador: Indicador | null;
  onFechar: () => void;
  preview: boolean;
}) {
  return (
    <Sheet open={!!i} onOpenChange={(open) => !open && onFechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[560px]">
        {i && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <EstadoBadge estado={i.estado} />
                {i.sintetico && <SinteticoBadge />}
              </div>
              <SheetTitle>{i.titulo}</SheetTitle>
              <SheetDescription>{i.pergunta}</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              <div>
                <span className="text-3xl font-semibold tabular-nums">{formatarValor(i)}</span>
                {i.valor !== null && i.unidade !== "reais" && (
                  <span className="ml-2 text-sm text-muted-foreground">{i.unidade}</span>
                )}
              </div>
              <p className="text-sm">{i.definicao}</p>
              <dl className="divide-y rounded-lg border px-3">
                <Linha termo="Unidade de contagem">{i.unidade}</Linha>
                <Linha termo="Período">
                  {i.periodo
                    ? `${dataBr(i.periodo.de)} a ${dataBr(i.periodo.ate)}`
                    : "Fotografia de agora: o período filtrado não se aplica."}
                </Linha>
                <Linha termo="Perímetro">{i.perimetro}</Linha>
                <Linha termo="Filtros">{i.filtros.join(" · ")}</Linha>
                <Linha termo="Fonte">{i.fonte}</Linha>
                <Linha termo="Versão da regra">{i.versaoRegra}</Linha>
                <Linha termo="Data do dado">{quando(i.dataDado)}</Linha>
                <Linha termo="Apurado em">{quando(i.dataApuracao)}</Linha>
              </dl>

              {i.comparacoes.length > 0 && (
                <section>
                  <h3 className="mb-1 text-xs font-semibold">Comparações</h3>
                  <ul className="space-y-1 text-xs">
                    {i.comparacoes.map((c) => (
                      <li key={c.rotulo} className="rounded-md border px-3 py-2">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{c.rotulo}</span>
                          <span className="tabular-nums">
                            {formatarNumero(c.referencia, i.unidade)}
                          </span>
                        </span>
                        <span className="text-muted-foreground">{c.nota}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-1 text-xs font-semibold">Composição</h3>
                {i.composicao.length ? (
                  <table className="w-full text-xs">
                    <tbody>
                      {i.composicao.map((l) => (
                        <tr key={l.chave} className="border-b last:border-0">
                          <td className="py-1.5 pr-2">
                            {l.rotulo}
                            {l.soma && (
                              <span className="ml-1 text-[10px] text-primary" title="Entra na soma">
                                ∑
                              </span>
                            )}
                            {l.observacao && (
                              <span className="block text-[11px] text-muted-foreground">
                                {l.observacao}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {formatarNumero(l.valor, l.unidade ?? i.unidade)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {somaDaComposicao(i) !== null && i.composicao.some((l) => l.soma) && (
                      <tfoot>
                        <tr>
                          <td className="pt-2 font-medium">Soma das linhas ∑</td>
                          <td className="pt-2 text-right font-medium tabular-nums">
                            {formatarNumero(somaDaComposicao(i), i.unidade)}
                            {somaDaComposicao(i) === i.valor ? " ✓" : " ≠ total"}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Sem composição: o número não foi apurado para este recorte.
                  </p>
                )}
                {i.notaComposicao && (
                  <p className="mt-2 text-xs text-muted-foreground">{i.notaComposicao}</p>
                )}
              </section>

              {i.lacuna && (
                <section className="rounded-lg border border-dashed p-3 text-xs">
                  <h3 className="mb-1 font-semibold">O que falta para responder</h3>
                  <p>{i.lacuna.oQueFalta}</p>
                  <p className="mt-1">
                    <span className="text-muted-foreground">Responsável: </span>
                    {i.lacuna.responsavel}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Ação: </span>
                    {i.lacuna.acao}
                  </p>
                </section>
              )}

              {i.destino && (
                <section className="space-y-2 border-t pt-3">
                  <h3 className="text-xs font-semibold">Tela de origem</h3>
                  <BotaoDestino destino={i.destino} preview={preview} />
                  <p className="text-[11px] text-muted-foreground">
                    {i.destino.mesmoRecorte
                      ? "O destino recebe o mesmo recorte."
                      : "O destino não recebe o mesmo recorte; os totais podem diferir. "}
                    {i.destino.observacao}
                  </p>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
