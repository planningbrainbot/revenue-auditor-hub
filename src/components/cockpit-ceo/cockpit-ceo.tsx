import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowLeft, TriangleAlert } from "lucide-react";
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
import { PageHeader } from "@/components/planning";
import { FRENTES } from "@/lib/cockpit-ceo/contrato";
import type { Frente } from "@/lib/cockpit-ceo/contrato";
import type { Cockpit } from "@/lib/cockpit-ceo/indicadores";
import { PRESETS } from "@/lib/cockpit-ceo/periodo";
import type { BuscaCockpit, Periodo, PresetPeriodo } from "@/lib/cockpit-ceo/periodo";
import { explicar } from "@/lib/cockpit-ceo/explicacoes";
import { montarLeituraExecutiva } from "@/lib/cockpit-ceo/visao-executiva";
import { ComposicaoIndicador } from "./composicao";
import { SinteticoBadge } from "./estado";
import { VistaFrente } from "./frentes";
import { DefsHachura } from "./graficos";
import { BotaoPerguntar, SaudeDasFontes, VisaoExecutivaLeitura } from "./visao-executiva";

// Cockpit do CEO no Design System v2 (contrato docs/design/contratos/cockpit-ceo.md, aprovado em
// 23/09/2026). Arquétipo Visão geral: agrega, aponta a pendência e manda para a tela dona; não
// executa nada (N10).
//
// Sem `?frente=` é a Visão executiva: desde 28/09 só gráficos com número real, e toda explicação
// na gaveta que o clique abre (`?grafico=` ou `?indicador=`). Com `?frente=` é a vista daquela frente, que a lateral lista como item
// próprio: a página não desenha abas que trocam de assunto (N6).
//
// O componente não carrega dado: recebe o cockpit pronto. Quem decide a fonte (real ou sintética)
// é a rota, e é isso que impede a fonte sintética de vazar para a rota autenticada.

export type MudarBusca = (parcial: Partial<BuscaCockpit>) => void;

/** A pergunta da Visão executiva (N1). Texto aprovado no contrato de 23/09. */
/** Universo da Visão executiva (N1): o que os quatro números medem, numa linha. */
const DESCRICAO_EXECUTIVA =
  "Empresa inteira · último mês fechado, mês corrente e fotografias de hoje · R$";

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
  const explicacao = useMemo(
    () => (busca.grafico && !aberto ? explicar(cockpit, busca.grafico) : null),
    [cockpit, busca.grafico, aberto],
  );
  // Abrir um número empilha uma entrada no histórico. Fechar pelo X desempilha a mesma entrada,
  // em vez de trocar por outra: senão o "voltar" do navegador precisaria de dois cliques.
  const empilhado = useRef(false);
  const abrir = (id: string) => {
    empilhado.current = true;
    aoMudar({ indicador: id, grafico: "" });
  };
  const abrirGrafico = (id: string) => {
    empilhado.current = true;
    aoMudar({ grafico: id, indicador: "" });
  };
  const fechar = () => {
    if (empilhado.current) {
      empilhado.current = false;
      router.history.back();
    } else aoMudar({ indicador: "", grafico: "" });
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
  const saude = useMemo(() => montarLeituraExecutiva(cockpit).saude, [cockpit]);

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="cockpit_ceo"
        titulo={frente ? FRENTES[frente].titulo : "Visão executiva"}
        pergunta={frente ? FRENTES[frente].pergunta : PERGUNTA_EXECUTIVA}
        descricao={frente ? cockpit.universo : DESCRICAO_EXECUTIVA}
        // Na Visão executiva a procedência completa sai do cabeçalho: cada número traz o nome da
        // fonte e a data, e o selo de saúde abre o frescor de todas (revisão de 24/09).
        procedencia={
          frente
            ? {
                fonte: cockpit.sintetico
                  ? "SINTÉTICO · Financeiro, Growth, Ops e Monetização"
                  : "Financeiro (Financial Brain), Growth, Ops e Monetização",
                atualizadoEm: fin?.atualizadoEm ?? null,
                regua: "faturamento por emissão; eventos pela data do evento; fuso de São Paulo",
              }
            : undefined
        }
        acoes={
          <>
            {cockpit.sintetico && <SinteticoBadge />}
            {frente ? (
              <Button variant="outline" size="sm" onClick={() => aoMudar({ frente: "" })}>
                <ArrowLeft className="size-4" aria-hidden />
                Visão executiva
              </Button>
            ) : (
              <SaudeDasFontes saude={saude} />
            )}
            {!preview && <BotaoPerguntar />}
            {topo}
          </>
        }
        // Os quatro números da Visão executiva não dependem do período nem da unidade (último mês
        // fechado, fotografias de hoje e mês corrente do Growth): o filtro fica nas frentes.
        filtros={
          frente ? (
            <Filtros
              busca={busca}
              periodo={periodo}
              perimetros={cockpit.perimetros}
              aoMudar={aoMudar}
            />
          ) : undefined
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
          onAbrirGrafico={abrirGrafico}
          preview={preview}
          hoje={cockpit.hoje}
          irParaFrente={irParaFrente}
        />
      ) : (
        <>
          <VisaoExecutivaLeitura
            cockpit={cockpit}
            abrirGrafico={abrirGrafico}
            irParaFrente={irParaFrente}
          />
          {/* Só o preview do piloto passa o Jev; fica abaixo de tudo, fora da primeira leitura. */}
          {jev?.(irParaFrente)}
        </>
      )}

      <ComposicaoIndicador
        indicador={aberto}
        explicacao={explicacao}
        onFechar={fechar}
        preview={preview}
      />
      <DefsHachura />
    </main>
  );
}
