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
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FRENTES, ORDEM_FRENTES } from "@/lib/cockpit-ceo/contrato";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import type { Destino, Frente } from "@/lib/cockpit-ceo/contrato";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";
import { perguntasDaFrente, situacaoDaPergunta } from "@/lib/cockpit-ceo/perguntas";
import { mesBr } from "@/lib/cockpit-ceo/receita";
import { PRESETS } from "@/lib/cockpit-ceo/periodo";
import type { BuscaCockpit, Periodo, PresetPeriodo } from "@/lib/cockpit-ceo/periodo";
import { BotaoDestino, ComposicaoIndicador } from "./composicao";
import { SinteticoBadge } from "./estado";
import { Motores, PonteDoMes, SemPainel } from "./empresa";
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

/** Aviso de leitura (período inválido, recorte): informação, não alarme permanente (N9). */
function Aviso({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Linha de uma lista da Visão geral: selo, o que é, detalhe em uma linha e a ação à direita. */
function Linha({
  selo,
  titulo,
  detalhe,
  acao,
}: {
  selo: ReactNode;
  titulo: string;
  detalhe?: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="w-24 shrink-0">{selo}</div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{titulo}</p>
        {detalhe && <p className="text-sm text-muted-foreground">{detalhe}</p>}
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </li>
  );
}

const ORDEM_GRAVIDADE = { alta: 0, media: 1 } as const;
/** Quantas ameaças a Visão executiva lista; as demais ficam nas frentes. */
const AMEACAS_NA_VISAO = 5;

function VisaoExecutiva({
  cockpit,
  abrir,
  preview,
  jev,
  irParaFrente,
}: {
  cockpit: Cockpit;
  abrir: (id: string) => void;
  preview: boolean;
  jev?: ReactNode;
  irParaFrente: (f: Frente) => void;
}) {
  const primeira = cockpit.primeiraDobra
    .map((id) => cockpit.indicadores.find((i) => i.id === id))
    .filter((i): i is Cockpit["indicadores"][number] => !!i);
  // O cartão com cadeado não abre nem mostra nota (não vaza número): o motivo fica aqui embaixo.
  const semAcesso = primeira.filter((i) => i.estado === "acesso_insuficiente");
  const ameacas = [...cockpit.ameacas].sort(
    (a, b) =>
      ORDEM_GRAVIDADE[a.gravidade] - ORDEM_GRAVIDADE[b.gravidade] ||
      Number(a.origem === "monetizacao") - Number(b.origem === "monetizacao"),
  );
  const visiveis = ameacas.slice(0, AMEACAS_NA_VISAO);
  const e = cockpit.empresa;
  const ultimo = e.ponte?.ultimo ?? null;
  return (
    <>
      <KpiGrade colunas={6}>
        {primeira.map((i) => (
          <KpiCard key={i.id} {...cartaoDoIndicador(i, () => abrir(i.id))} />
        ))}
      </KpiGrade>
      {semAcesso.length > 0 && (
        <Aviso>
          <ul aria-label="Números sem acesso" className="space-y-1">
            {semAcesso.map((i) => (
              <li key={i.id}>
                <span className="font-medium">{i.titulo}:</span>{" "}
                {i.lacuna
                  ? `falta ${i.lacuna.oQueFalta.replace(/^./, (c) => c.toLowerCase())} Quem concede: ${i.lacuna.responsavel}.`
                  : "seu acesso não lê a fonte deste número."}
              </li>
            ))}
          </ul>
        </Aviso>
      )}

      <Secao
        titulo="O que é decisão sua?"
        descricao="Até três, por regra fixa sobre os números acima. Cada uma diz quem decide e abre a tela que resolve."
      >
        <ol aria-label="Decisões" className="divide-y rounded-xl border bg-card">
          {cockpit.decisoes.map((d) => (
            <Linha
              key={d.id}
              selo={<StatusBadge tom="info">Decisão</StatusBadge>}
              titulo={d.titulo}
              detalhe={
                <>
                  {d.porque} <span className="text-foreground">Quem decide: {d.responsavel}.</span>
                </>
              }
              acao={d.destino && <BotaoDestino destino={d.destino} preview={preview} compacto />}
            />
          ))}
        </ol>
      </Secao>

      <Secao
        titulo="O que ameaça o resultado?"
        descricao={`Regras fixas, não IA, as mais graves primeiro.${ameacas.length > visiveis.length ? ` Mais ${ameacas.length - visiveis.length} nas frentes.` : ""}`}
      >
        {visiveis.length ? (
          <ul className="divide-y rounded-xl border bg-card">
            {visiveis.map((a) => (
              <Linha
                key={a.id}
                selo={
                  <StatusBadge tom={a.gravidade === "alta" ? "perigo" : "atencao"}>
                    {a.gravidade === "alta" ? "Alta" : "Média"}
                  </StatusBadge>
                }
                titulo={a.titulo}
                detalhe={a.detalhe}
                acao={
                  a.indicador && (
                    <Button variant="outline" size="sm" onClick={() => abrir(a.indicador!)}>
                      Ver número
                      <ArrowRight className="size-4" aria-hidden />
                    </Button>
                  )
                }
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
            Nenhuma regra de ameaça disparou com os números disponíveis. Isso não cobre o que ainda
            não é apurado.
          </p>
        )}
      </Secao>

      <Secao
        titulo={
          ultimo
            ? `De onde veio a variação do faturamento em ${mesBr(ultimo.mes)}?`
            : "De onde veio a variação do faturamento?"
        }
        descricao="Ponte por cliente sobre o Faturamento do grupo (emissão). Unidade nova, monetização e aquisições ainda não têm vínculo de receita."
        acoes={
          <Button variant="outline" size="sm" onClick={() => irParaFrente("receita")}>
            Ver mês a mês
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        }
      >
        {ultimo?.fecha ? (
          <PonteDoMes mes={ultimo} />
        ) : (
          <SemPainel
            texto={
              e.ponteAviso ?? "A ponte não fecha com a fonte neste mês; o número não é mostrado."
            }
          />
        )}
      </Secao>

      <Secao
        titulo="Quais motores sustentam o crescimento?"
        descricao="Cada motor na régua dele: MRR vendido não é faturamento, e nada aqui é somado."
      >
        <Motores motores={e.motores} irParaFrente={irParaFrente} />
      </Secao>
      {preview && (
        <p className="text-xs text-muted-foreground">
          No preview, os destinos não abrem: exigem login e dados reais.
        </p>
      )}

      {jev}

      <Secao
        titulo="Para onde ir em cada frente?"
        descricao="Cada frente tem página própria, também na lateral. Respondida: dado integrado e sem decisão pendente."
      >
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ORDEM_FRENTES.map((f) => {
            const perguntas = perguntasDaFrente(f);
            const cont = (s: string) => perguntas.filter((p) => situacaoDaPergunta(p) === s).length;
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
                    {cont("respondida")} respondidas · {cont("parcial")} parciais · {cont("lacuna")}{" "}
                    lacunas
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
  // Procedência do cabeçalho: o Financeiro, fonte do faturamento da primeira dobra. Cada número e
  // cada painel declara a sua ao lado (N3); a frente Evidências e capital lista o frescor de todas.
  const fin = cockpit.empresa.frescor[0];

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="cockpit_ceo"
        titulo={frente ? FRENTES[frente].titulo : "Visão executiva"}
        pergunta={frente ? FRENTES[frente].pergunta : PERGUNTA_EXECUTIVA}
        descricao={cockpit.universo}
        procedencia={{
          fonte: cockpit.sintetico
            ? "SINTÉTICO · Financeiro, Growth, Ops e Monetização"
            : "Financeiro (Financial Brain), Growth, Ops e Monetização",
          atualizadoEm: fin?.atualizadoEm ?? null,
          regua: "faturamento por emissão; eventos pela data do evento; fuso de São Paulo",
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
        <VistaFrente
          cockpit={cockpit}
          frente={frente}
          onAbrirIndicador={abrir}
          preview={preview}
          hoje={cockpit.hoje}
          irParaFrente={irParaFrente}
        />
      ) : (
        <VisaoExecutiva
          cockpit={cockpit}
          abrir={abrir}
          preview={preview}
          jev={jev?.(irParaFrente)}
          irParaFrente={irParaFrente}
        />
      )}

      <ComposicaoIndicador indicador={aberto} onFechar={fechar} preview={preview} />
    </main>
  );
}
