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
import type { Explicacao } from "@/lib/cockpit-ceo/explicacoes";
import { EstadoBadge, SinteticoBadge } from "./estado";
import { BotaoPerguntar } from "./visao-executiva";

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
        <p className="text-xs text-muted-foreground">
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

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

/**
 * A explicação de um gráfico ou cartão (revisão visual de 28/09/2026): o que diz; como se calcula;
 * fonte, data e período; atenção ou limite; quem decide ou é dono; a tela que resolve; e a conversa
 * com o gráfico como contexto. Os dados desenhados fecham a gaveta como tabela (a vista acessível).
 */
function ExplicacaoGrafico({ e, preview }: { e: Explicacao; preview: boolean }) {
  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <EstadoBadge estado={e.estado} />
        </div>
        <SheetTitle>{e.titulo}</SheetTitle>
        <SheetDescription>{e.periodo}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-5 text-sm">
        {e.valor && <p className="num text-3xl font-semibold">{e.valor}</p>}
        <Bloco titulo="O que diz">
          <p>{e.oQueDiz}</p>
        </Bloco>
        <Bloco titulo="Como se calcula">
          <p>{e.comoSeCalcula}</p>
        </Bloco>
        <Bloco titulo="Fonte, data e período">
          <dl className="divide-y rounded-lg border px-3">
            <Linha termo="Fonte">{e.fonte}</Linha>
            <Linha termo="Data do dado">{quando(e.dataDado)}</Linha>
            <Linha termo="Período">{e.periodo}</Linha>
          </dl>
        </Bloco>
        {e.atencao.length > 0 && (
          <Bloco titulo="Atenção ou limite">
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              {e.atencao.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Bloco>
        )}
        <Bloco titulo="Quem decide ou é dono">
          <p>{e.dono}</p>
        </Bloco>
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {e.destino && <BotaoDestino destino={e.destino} preview={preview} compacto />}
          {!preview && (
            <BotaoPerguntar
              grafico={e.id}
              rotulo="Perguntar ao Brain sobre este gráfico"
              variante="default"
            />
          )}
        </div>
        {e.dados.length > 0 && (
          <Bloco titulo="Dados desenhados">
            <table className="w-full text-xs">
              <tbody>
                {e.dados.map((d) => (
                  <tr key={d.rotulo} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">{d.rotulo}</td>
                    <td className="num py-1.5 text-right">{d.valor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Bloco>
        )}
      </div>
    </>
  );
}

export function ComposicaoIndicador({
  indicador: i,
  explicacao,
  onFechar,
  preview,
}: {
  indicador: Indicador | null;
  /** Gráfico aberto (`?grafico=`); vale quando não há indicador aberto. */
  explicacao?: Explicacao | null;
  onFechar: () => void;
  preview: boolean;
}) {
  return (
    <Sheet open={!!i || !!explicacao} onOpenChange={(open) => !open && onFechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[560px]">
        {!i && explicacao && <ExplicacaoGrafico e={explicacao} preview={preview} />}
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
                              <span
                                className="ml-1 text-xs text-primary-text"
                                title="Entra na soma"
                              >
                                ∑
                              </span>
                            )}
                            {l.observacao && (
                              <span className="block text-xs text-muted-foreground">
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

              {!preview && (
                <BotaoPerguntar
                  grafico={`indicador-${i.id}`}
                  rotulo="Perguntar ao Brain sobre este número"
                  variante="outline"
                />
              )}
              {i.destino && (
                <section className="space-y-2 border-t pt-3">
                  <h3 className="text-xs font-semibold">Tela de origem</h3>
                  <BotaoDestino destino={i.destino} preview={preview} />
                  <p className="text-xs text-muted-foreground">
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
