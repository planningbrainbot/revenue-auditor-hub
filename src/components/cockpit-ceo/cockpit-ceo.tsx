import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, inputClass, Notice, Panel } from "@/components/monetizacao/common";
import { formatarNumero } from "@/lib/cockpit-ceo/contrato";
import type { Frente } from "@/lib/cockpit-ceo/contrato";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";
import { PRESETS } from "@/lib/cockpit-ceo/periodo";
import type { BuscaCockpit, Periodo, PresetPeriodo } from "@/lib/cockpit-ceo/periodo";
import { BotaoDestino, ComposicaoIndicador } from "./composicao";
import { SinteticoBadge } from "./estado";
import { Frentes } from "./frentes";
import { CartaoIndicador } from "./indicador";

// A visão executiva do Cockpit do CEO.
//
// Uma tela só, na ordem das cinco perguntas do PRD: como estamos (cartões, com plano e período
// anterior), quais decisões pedem o CEO, o que mudou, de onde vem o crescimento, o que ameaça. Os
// detalhes técnicos ficam no clique (composição) e nas frentes; auditoria de integração mora na
// tela própria de auditoria, não espalhada aqui (decisão de 22/09/2026).
//
// O componente não carrega dado: recebe o cockpit pronto. Quem decide a fonte (real ou sintética)
// é a rota, e é isso que impede a fonte sintética de vazar para a rota autenticada.

export type MudarBusca = (parcial: Partial<BuscaCockpit>) => void;

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
    <div className="flex flex-wrap items-end gap-2">
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
        <>
          <Field label="De">
            <input
              type="date"
              className={inputClass}
              value={datas.de}
              onChange={(e) => setDatas({ ...datas, de: e.target.value })}
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              className={inputClass}
              value={datas.ate}
              onChange={(e) => setDatas({ ...datas, ate: e.target.value })}
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            onClick={() => aoMudar({ periodo: "personalizado", ...datas })}
          >
            Aplicar
          </Button>
        </>
      )}
      <Field label="Perímetro">
        <select
          className={inputClass + " min-w-[220px]"}
          value={busca.perimetro}
          onChange={(e) => aoMudar({ perimetro: e.target.value })}
        >
          <option value="">Rede inteira no seu escopo</option>
          {perimetros.map((p) => (
            <option key={p.chave} value={p.chave}>
              {p.rotulo}
            </option>
          ))}
        </select>
      </Field>
      <span className="pb-2 text-xs text-muted-foreground">{periodo.rotulo}</span>
    </div>
  );
}

const sinal = (n: number) => (n > 0 ? `+${n}` : String(n));

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
  jev?: (irParaFrente: (f: Frente) => void) => ReactNode;
}) {
  const aberto = cockpit.indicadores.find((i) => i.id === busca.indicador) ?? null;
  const abrir = (id: string) => aoMudar({ indicador: id });
  const frente: Frente = busca.frente || "comercial";
  const irParaFrente = (f: Frente) => {
    aoMudar({ frente: f });
    requestAnimationFrame(() =>
      document.getElementById("frentes")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const eventos = cockpit.indicadores.filter((i) => i.periodo !== null && i.comparacoes.length);
  const avisos = [
    ...(periodo.aviso ? [periodo.aviso] : []),
    ...cockpit.avisos.filter((a) => !/sintéticos/.test(a)),
  ];

  return (
    <main className="mx-auto max-w-[1600px] space-y-3 p-4 md:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Cockpit do CEO</h1>
          <p className="text-xs text-muted-foreground">{cockpit.universo}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cockpit.sintetico && <SinteticoBadge />}
          {topo}
        </div>
      </header>

      <Filtros busca={busca} periodo={periodo} perimetros={cockpit.perimetros} aoMudar={aoMudar} />
      {avisos.map((a) => (
        <Notice key={a}>{a}</Notice>
      ))}

      <section
        className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_340px]"
        aria-label="Visão executiva"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cockpit.indicadores.map((i) => (
              <CartaoIndicador key={i.id} indicador={i} onAbrir={() => abrir(i.id)} />
            ))}
          </div>
          <Panel title="O que ameaça o resultado">
            {cockpit.ameacas.length ? (
              <ul className="grid gap-x-6 gap-y-2 md:grid-cols-2">
                {cockpit.ameacas.map((a) => (
                  <li key={a.id} className="text-xs">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => a.indicador && abrir(a.indicador)}
                    >
                      <span
                        className={`mr-1.5 inline-block h-2 w-2 rounded-full ${a.gravidade === "alta" ? "bg-red-500" : "bg-amber-500"}`}
                      />
                      <span className="font-medium">{a.titulo}</span>
                      <span className="block pl-3.5 text-muted-foreground">{a.detalhe}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhuma regra de ameaça disparou com os números disponíveis. Isso não cobre o que
                ainda não é apurado.
              </p>
            )}
          </Panel>
        </div>
        <Panel title="Decisões que pedem sua atenção">
          <ol className="space-y-3">
            {cockpit.decisoes.map((d, n) => (
              <li key={d.id} className="text-xs">
                <p className="text-sm font-medium">
                  {n + 1}. {d.titulo}
                </p>
                <p className="mt-0.5 text-muted-foreground">{d.porque}</p>
                <p className="mt-0.5">
                  <span className="text-muted-foreground">Quem decide: </span>
                  {d.responsavel}
                </p>
                {d.destino && (
                  <div className="mt-1">
                    <BotaoDestino destino={d.destino} preview={preview} compacto />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
            Decisões saem de regras fixas sobre os números acima, não de IA.
            {preview && " No preview, os destinos não abrem: exigem login e dados reais."}
          </p>
        </Panel>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Panel title="O que mudou no período">
          {eventos.length ? (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-1 text-left font-medium">Evento</th>
                  <th className="pb-1 text-right font-medium">Agora</th>
                  <th className="pb-1 text-right font-medium">Anterior</th>
                  <th className="pb-1 text-right font-medium">Variação</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((i) => {
                  const ant = i.comparacoes[0]?.referencia ?? null;
                  return (
                    <tr key={i.id} className="border-t">
                      <td className="py-1.5">
                        <button
                          type="button"
                          className="text-left hover:underline"
                          onClick={() => abrir(i.id)}
                        >
                          {i.titulo}
                        </button>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatarNumero(i.valor, i.unidade)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatarNumero(ant, i.unidade)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {i.valor !== null && ant !== null ? sinal(i.valor - ant) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-muted-foreground">Sem eventos comparáveis neste recorte.</p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Mesmo número de dias, imediatamente antes. Eventos, não coorte: não somar etapas como
            funil.
          </p>
        </Panel>

        <Panel title="De onde vem o crescimento">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-1 text-left font-medium">Produto</th>
                <th className="pb-1 text-right font-medium">Validadas</th>
                <th className="pb-1 text-right font-medium">Ganhos</th>
                <th className="pb-1 text-right font-medium">Receita prevista</th>
                <th className="pb-1 text-right font-medium">Prontas</th>
              </tr>
            </thead>
            <tbody>
              {cockpit.porProduto.map((l) => (
                <tr key={l.produto} className="border-t">
                  <td className="py-1.5">{l.rotulo}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatarNumero(l.validadas, "negócios")}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatarNumero(l.ganhos, "negócios")}
                  </td>
                  <td
                    className="py-1.5 text-right tabular-nums"
                    title={l.semReceita ? `${l.semReceita} sem valor declarado` : undefined}
                  >
                    {formatarNumero(l.receitaPrevista, "reais")}
                    {l.semReceita ? "*" : ""}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatarNumero(l.contasProntas, "contas")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Demanda por produto, não faturamento: a ponte de receita até a meta (F11) ainda não é
            apurada. * há negócio sem receita declarada. Prontas contam contas; uma conta pode estar
            em mais de um produto.
          </p>
        </Panel>
      </section>

      {jev?.(irParaFrente)}

      <Frentes
        cockpit={cockpit}
        frente={frente}
        onFrente={(f) => aoMudar({ frente: f })}
        onAbrirIndicador={abrir}
      />

      <ComposicaoIndicador
        indicador={aberto}
        onFechar={() => aoMudar({ indicador: "" })}
        preview={preview}
      />
    </main>
  );
}
