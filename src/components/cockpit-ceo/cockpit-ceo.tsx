import { useEffect, useRef, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KpiCard, KpiGrade, PageHeader, Secao, StatusBadge } from "@/components/planning";
import { FRENTES, ORDEM_FRENTES, formatarNumero } from "@/lib/cockpit-ceo/contrato";
import type { Frente } from "@/lib/cockpit-ceo/contrato";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";
import { perguntasDaFrente } from "@/lib/cockpit-ceo/perguntas";
import { PRESETS } from "@/lib/cockpit-ceo/periodo";
import type { BuscaCockpit, Periodo, PresetPeriodo } from "@/lib/cockpit-ceo/periodo";
import { BotaoDestino, ComposicaoIndicador } from "./composicao";
import { SinteticoBadge } from "./estado";
import { VistaFrente } from "./frentes";
import { cartaoDoIndicador } from "./indicador";

// Cockpit do CEO no Design System v2 (contrato docs/design/contratos/cockpit-ceo.md, aprovado em
// 23/09/2026). Arquétipo Visão geral: agrega, aponta a pendência e manda para a tela dona; não
// executa nada (N10).
//
// Sem `?frente=` é a Visão executiva: seis números, até três decisões, o que ameaça, o que mudou e
// de onde vem o crescimento. Com `?frente=` é a vista daquela frente, que a lateral lista como item
// próprio: a página não desenha abas que trocam de assunto (N6).
//
// O componente não carrega dado: recebe o cockpit pronto. Quem decide a fonte (real ou sintética)
// é a rota, e é isso que impede a fonte sintética de vazar para a rota autenticada.

export type MudarBusca = (parcial: Partial<BuscaCockpit>) => void;

/** A pergunta da Visão executiva (N1). Texto aprovado no contrato de 23/09. */
export const PERGUNTA_EXECUTIVA =
  "Estamos no plano para o bilhão, o que mudou e o que é decisão minha?";

function Filtros({
  busca,
  periodo,
  perimetros,
  aoMudar,
}: {
  busca: BuscaCockpit;
  periodo: Periodo;
  perimetros: Cockpit["perimetros"];
  aoMudar: MudarBusca;
}) {
  const [datas, setDatas] = useState({ de: periodo.de, ate: periodo.ate });
  useEffect(() => setDatas({ de: periodo.de, ate: periodo.ate }), [periodo.de, periodo.ate]);
  return (
    <>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Período">
        {(Object.keys(PRESETS) as PresetPeriodo[]).map((p) => (
          <Button
            key={p}
            size="sm"
            variant={periodo.preset === p ? "default" : "outline"}
            aria-pressed={periodo.preset === p}
            onClick={() =>
              p === "personalizado"
                ? aoMudar({ periodo: p, de: periodo.de, ate: periodo.ate })
                : aoMudar({ periodo: p, de: "", ate: "" })
            }
          >
            {PRESETS[p]}
          </Button>
        ))}
      </div>
      {periodo.preset === "personalizado" && (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="cockpit-de" className="text-xs text-muted-foreground">
            De
          </Label>
          <Input
            id="cockpit-de"
            type="date"
            className="h-8 w-auto"
            value={datas.de}
            onChange={(e) => setDatas({ ...datas, de: e.target.value })}
          />
          <Label htmlFor="cockpit-ate" className="text-xs text-muted-foreground">
            Até
          </Label>
          <Input
            id="cockpit-ate"
            type="date"
            className="h-8 w-auto"
            value={datas.ate}
            onChange={(e) => setDatas({ ...datas, ate: e.target.value })}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => aoMudar({ periodo: "personalizado", ...datas })}
          >
            Aplicar
          </Button>
        </div>
      )}
      <Select
        value={busca.perimetro || "__rede"}
        onValueChange={(v) => aoMudar({ perimetro: v === "__rede" ? "" : v })}
      >
        <SelectTrigger className="h-8 w-auto min-w-[220px]" aria-label="Perímetro">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__rede">Rede inteira no seu escopo</SelectItem>
          {perimetros.map((p) => (
            <SelectItem key={p.chave} value={p.chave}>
              {p.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">{periodo.rotulo}</span>
    </>
  );
}

const sinal = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Aviso de leitura (período inválido, recorte): informação, não alarme permanente (N9). */
function Aviso({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function VisaoExecutiva({
  cockpit,
  abrir,
  preview,
  jev,
}: {
  cockpit: Cockpit;
  abrir: (id: string) => void;
  preview: boolean;
  jev?: ReactNode;
}) {
  const eventos = cockpit.indicadores.filter((i) => i.periodo !== null && i.comparacoes.length);
  // O cartão com cadeado não abre nem mostra nota (não vaza número): o motivo fica aqui embaixo.
  const semAcesso = cockpit.indicadores.filter((i) => i.estado === "acesso_insuficiente");
  return (
    <>
      <KpiGrade colunas={6}>
        {cockpit.indicadores.map((i) => (
          <KpiCard key={i.id} {...cartaoDoIndicador(i, () => abrir(i.id))} />
        ))}
      </KpiGrade>
      {semAcesso.length > 0 && (
        <ul aria-label="Números sem acesso" className="space-y-1 text-sm text-muted-foreground">
          {semAcesso.map((i) => (
            <li key={i.id}>
              <span className="font-medium text-foreground">{i.titulo}:</span>{" "}
              {i.lacuna
                ? `falta ${i.lacuna.oQueFalta.replace(/^./, (c) => c.toLowerCase())} Quem concede: ${i.lacuna.responsavel}.`
                : "seu acesso não lê a fonte deste número."}
            </li>
          ))}
        </ul>
      )}

      <Secao
        titulo="O que pede atenção?"
        descricao="Decisões saem de regras fixas sobre os números acima, não de IA."
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <ol className="space-y-4" aria-label="Decisões">
            {cockpit.decisoes.map((d, n) => (
              <li key={d.id} className="space-y-1">
                <p className="font-semibold">
                  {n + 1}. {d.titulo}
                </p>
                <p className="text-sm text-muted-foreground">{d.porque}</p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Quem decide: </span>
                  {d.responsavel}
                </p>
                {d.destino && <BotaoDestino destino={d.destino} preview={preview} compacto />}
              </li>
            ))}
          </ol>
          <div className="space-y-2">
            <p className="text-sm font-semibold">O que ameaça o resultado</p>
            {cockpit.ameacas.length ? (
              <ul className="space-y-3">
                {cockpit.ameacas.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="space-y-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                      disabled={!a.indicador}
                      onClick={() => a.indicador && abrir(a.indicador)}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge tom={a.gravidade === "alta" ? "perigo" : "atencao"}>
                          {a.gravidade === "alta" ? "Alta" : "Média"}
                        </StatusBadge>
                        <span className="text-sm font-medium">{a.titulo}</span>
                      </span>
                      <span className="block text-sm text-muted-foreground">{a.detalhe}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma regra de ameaça disparou com os números disponíveis. Isso não cobre o que
                ainda não é apurado.
              </p>
            )}
          </div>
        </div>
        {preview && (
          <p className="mt-4 text-xs text-muted-foreground">
            No preview, os destinos não abrem: exigem login e dados reais.
          </p>
        )}
      </Secao>

      <div className="grid gap-6 lg:grid-cols-2">
        <Secao
          titulo="O que mudou no período?"
          descricao="Mesmo número de dias, imediatamente antes. Eventos, não coorte: não somar etapas como funil."
        >
          {eventos.length ? (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 text-left font-medium">Evento</th>
                  <th className="pb-2 text-right font-medium">Agora</th>
                  <th className="pb-2 text-right font-medium">Anterior</th>
                  <th className="pb-2 text-right font-medium">Variação</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((i) => {
                  const ant = i.comparacoes[0]?.referencia ?? null;
                  return (
                    <tr key={i.id} className="border-t">
                      <td className="py-2">
                        <button
                          type="button"
                          className="rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => abrir(i.id)}
                        >
                          {i.titulo}
                        </button>
                      </td>
                      <td className="num py-2 text-right">{formatarNumero(i.valor, i.unidade)}</td>
                      <td className="num py-2 text-right">{formatarNumero(ant, i.unidade)}</td>
                      <td className="num py-2 text-right">
                        {i.valor !== null && ant !== null ? sinal(i.valor - ant) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">Sem eventos comparáveis neste recorte.</p>
          )}
        </Secao>

        <Secao
          titulo="De onde vem o crescimento?"
          descricao="Demanda por produto, não faturamento: a ponte de receita até a meta ainda não é apurada."
        >
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 text-left font-medium">Produto</th>
                <th className="pb-2 text-right font-medium">Validadas</th>
                <th className="pb-2 text-right font-medium">Ganhos</th>
                <th className="pb-2 text-right font-medium">Receita prevista</th>
                <th className="pb-2 text-right font-medium">Prontas</th>
              </tr>
            </thead>
            <tbody>
              {cockpit.porProduto.map((l) => (
                <tr key={l.produto} className="border-t">
                  <td className="py-2">{l.rotulo}</td>
                  <td className="num py-2 text-right">{formatarNumero(l.validadas, "negócios")}</td>
                  <td className="num py-2 text-right">{formatarNumero(l.ganhos, "negócios")}</td>
                  <td
                    className="num py-2 text-right"
                    title={l.semReceita ? `${l.semReceita} sem valor declarado` : undefined}
                  >
                    {formatarNumero(l.receitaPrevista, "reais")}
                    {l.semReceita ? "*" : ""}
                  </td>
                  <td className="num py-2 text-right">
                    {formatarNumero(l.contasProntas, "contas")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            * há negócio sem receita declarada. Prontas contam contas; uma conta pode estar em mais
            de um produto.
          </p>
        </Secao>
      </div>

      {jev}

      <Secao
        titulo="Para onde ir em cada frente?"
        descricao="Cada frente tem página própria, também na lateral. O número diz quantas perguntas já têm cálculo implementado."
      >
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ORDEM_FRENTES.map((f) => {
            const perguntas = perguntasDaFrente(f);
            const comNumero = perguntas.filter(
              (p) => p.cobertura === "implementada_nao_homologada",
            ).length;
            return (
              <li key={f}>
                <Link
                  to="."
                  search={
                    ((s: Record<string, unknown>) => ({
                      ...s,
                      frente: f,
                      indicador: undefined,
                    })) as never
                  }
                  className="group flex h-full flex-col gap-1 rounded-xl border bg-card p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center justify-between gap-2 font-semibold">
                    {FRENTES[f].titulo}
                    <ArrowRight
                      className="size-4 text-muted-foreground group-hover:text-primary-text"
                      aria-hidden
                    />
                  </span>
                  <span className="text-sm text-muted-foreground">{FRENTES[f].pergunta}</span>
                  <span className="num mt-auto pt-1 text-xs text-muted-foreground">
                    {comNumero} de {perguntas.length} perguntas com cálculo
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Secao>
    </>
  );
}

export function CockpitCeo({
  cockpit,
  busca,
  periodo,
  aoMudar,
  preview = false,
  topo,
  jev,
}: {
  cockpit: Cockpit;
  busca: BuscaCockpit;
  periodo: Periodo & { aviso?: string | null };
  aoMudar: MudarBusca;
  /** Preview sintético: destinos não navegam (exigem login e dados reais). */
  preview?: boolean;
  topo?: ReactNode;
  /** Só o preview do piloto passa: em produção o Jev fica desligado (contrato, "Ações"). */
  jev?: (irParaFrente: (f: Frente) => void) => ReactNode;
}) {
  const router = useRouter();
  const aberto = cockpit.indicadores.find((i) => i.id === busca.indicador) ?? null;
  // Abrir um número empilha uma entrada no histórico. Fechar pelo X desempilha a mesma entrada,
  // em vez de trocar por outra: senão o "voltar" do navegador precisaria de dois cliques.
  const empilhado = useRef(false);
  const abrir = (id: string) => {
    empilhado.current = true;
    aoMudar({ indicador: id });
  };
  const fechar = () => {
    if (empilhado.current) {
      empilhado.current = false;
      router.history.back();
    } else aoMudar({ indicador: "" });
  };
  const frente: Frente | null = busca.frente || null;
  const irParaFrente = (f: Frente) => {
    aoMudar({ frente: f });
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };
  const avisos = [
    ...(periodo.aviso ? [periodo.aviso] : []),
    ...cockpit.avisos.filter((a) => !/sintéticos/.test(a)),
  ];
  // Procedência do cabeçalho: a carga que alimenta os números da primeira dobra. Cada número e cada
  // painel de frente declara a sua ao lado (N3).
  const base = cockpit.indicadores.find((i) => i.id === "contratos-ganhos");

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="cockpit_ceo"
        titulo={frente ? FRENTES[frente].titulo : "Visão executiva"}
        pergunta={frente ? FRENTES[frente].pergunta : PERGUNTA_EXECUTIVA}
        descricao={cockpit.universo}
        procedencia={{
          fonte: cockpit.sintetico
            ? "SINTÉTICO · Monetização e Base de clientes"
            : "Monetização e Base de clientes (carga do Brain)",
          atualizadoEm: base?.dataDado ?? null,
          regua: "eventos pela data do evento, fuso de São Paulo",
        }}
        acoes={
          <>
            {cockpit.sintetico && <SinteticoBadge />}
            {frente && (
              <Button variant="outline" size="sm" onClick={() => aoMudar({ frente: "" })}>
                <ArrowLeft className="size-4" aria-hidden />
                Visão executiva
              </Button>
            )}
            {topo}
          </>
        }
        filtros={
          <Filtros
            busca={busca}
            periodo={periodo}
            perimetros={cockpit.perimetros}
            aoMudar={aoMudar}
          />
        }
      />
      {avisos.map((a) => (
        <Aviso key={a}>{a}</Aviso>
      ))}

      {frente ? (
        <VistaFrente cockpit={cockpit} frente={frente} onAbrirIndicador={abrir} preview={preview} />
      ) : (
        <VisaoExecutiva
          cockpit={cockpit}
          abrir={abrir}
          preview={preview}
          jev={jev?.(irParaFrente)}
        />
      )}

      <ComposicaoIndicador indicador={aberto} onFechar={fechar} preview={preview} />
    </main>
  );
}
