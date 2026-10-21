// Recorte da Base em painel visual (Pedro, 21/10/2026: "filtros muito bonitos na primeira tela, especialmente de região,
// segmento e porte"). Cada opção diz quantas empresas tem com os outros filtros já aplicados, com a barra da proporção;
// tocar marca ou desmarca, e as marcadas do mesmo filtro somam. No Painel, o ícone de lista abre as empresas do número.
// Fechado por padrão (Pedro, 21/10: "coloca só em toggle pra não ficar poluído"): fechado, sobra uma linha com o total e
// os filtros aplicados em etiquetas; a escolha de abrir fica guardada no navegador de quem usa.
import { useEffect, useId, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  List,
  MapPin,
  Ruler,
  Search,
  Shapes,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FOCO_VISIVEL, number } from "@/components/monetizacao/common";
import { normal } from "@/lib/monetizacao/model";
import {
  contarFaceta,
  passaRecorte,
  PORTES,
  REGIAO_DA_UF,
  REGIOES,
  RECORTE_VAZIO,
  rotuloDaOpcao,
  SEM_SEGMENTO,
  SEM_UF,
  temRecorte,
  type Faceta,
  type PerfilRecorte,
  type RecorteBase,
} from "@/lib/clientes/recorte";
import type { Conta } from "@/lib/monetizacao/types";
import { cn } from "@/lib/utils";
import { MedidorPorte } from "./regra-cliente";

/** Segmentos à mostra antes do "mais": os maiores, e os marcados sempre. */
const SEGMENTOS_A_MOSTRA = 8;
const ORDEM_REGIAO = [...REGIOES, SEM_UF] as string[];
const ORDEM_PORTE = PORTES.map((p) => p.chave) as string[];

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const CHAVE_ABERTO = "planning:base-recorte-aberto";
const ehDesconhecido = (v: string) => v === SEM_UF || v === SEM_SEGMENTO || v === "sem_porte";

type Auditar = (faceta: Faceta, valor: string, n: number) => void;

export function FiltrosBase({
  contas,
  perfil,
  recorte,
  aoMudar,
  aoAuditar,
  rotulo = "clientes",
}: {
  /** A população que o recorte corta (clientes, ex-clientes, Base Antiga…), já com a busca e a unidade. */
  contas: readonly Conta[];
  perfil: (a: Conta) => PerfilRecorte;
  recorte: RecorteBase;
  aoMudar: (r: RecorteBase) => void;
  /** Painel: abre as empresas de uma opção na gaveta. Sem ele, as opções só filtram. */
  aoAuditar?: Auditar;
  /** O que se conta ("clientes", "ex-clientes"). */
  rotulo?: string;
}) {
  const idCorpo = useId();
  const [aberto, setAberto] = useState(false);
  // Preferência de quem usa, só neste navegador: sem acesso ao storage, abre fechado.
  useEffect(() => {
    try {
      if (localStorage.getItem(CHAVE_ABERTO) === "1") setAberto(true);
    } catch {
      /* storage bloqueado */
    }
  }, []);
  const alternarAberto = () => {
    setAberto((a) => {
      try {
        localStorage.setItem(CHAVE_ABERTO, a ? "0" : "1");
      } catch {
        /* storage bloqueado */
      }
      return !a;
    });
  };
  const marcadas =
    recorte.regiao.length + recorte.uf.length + recorte.porte.length + recorte.segmento.length;
  const contagem = useMemo(
    () => ({
      regiao: contarFaceta(contas, perfil, recorte, "regiao"),
      uf: contarFaceta(contas, perfil, recorte, "uf"),
      porte: contarFaceta(contas, perfil, recorte, "porte"),
      segmento: contarFaceta(contas, perfil, recorte, "segmento"),
    }),
    [contas, perfil, recorte],
  );
  const noRecorte = useMemo(
    () => contas.filter((a) => passaRecorte(perfil(a), recorte)).length,
    [contas, perfil, recorte],
  );

  const ordenar = (f: Faceta, valores: string[]) =>
    f === "regiao"
      ? ORDEM_REGIAO.filter((v) => valores.includes(v))
      : f === "porte"
        ? ORDEM_PORTE.filter((v) => valores.includes(v))
        : [...valores].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const alternar = (f: Faceta, v: string) => {
    const marcada = recorte[f].includes(v);
    const r: RecorteBase = {
      ...recorte,
      [f]: ordenar(f, marcada ? recorte[f].filter((x) => x !== v) : [...recorte[f], v]),
    };
    // Desmarcar uma região tira junto as UFs dela: UF escondida não pode seguir filtrando.
    if (f === "regiao" && marcada)
      r.uf = r.uf.filter((u) => (u === SEM_UF ? v !== SEM_UF : REGIAO_DA_UF[u] !== v));
    aoMudar(r);
  };

  const regioes = ORDEM_REGIAO.filter(
    (v) => v !== SEM_UF || (contagem.regiao.get(v) ?? 0) > 0 || recorte.regiao.includes(v),
  );
  const maxRegiao = Math.max(1, ...regioes.map((v) => contagem.regiao.get(v) ?? 0));
  const totalRegiao = [...contagem.regiao.values()].reduce((s, n) => s + n, 0);
  // As UFs aparecem dentro das regiões marcadas (e as já marcadas, para poder desmarcar).
  const regioesComUf = recorte.regiao.filter((r) => r !== SEM_UF);
  const ufs = [...contagem.uf.entries()]
    .filter(([uf]) => uf !== SEM_UF && regioesComUf.includes(REGIAO_DA_UF[uf]))
    .map(([uf]) => uf)
    .concat(recorte.uf.filter((u) => !contagem.uf.has(u)))
    .sort((a, b) => (contagem.uf.get(b) ?? 0) - (contagem.uf.get(a) ?? 0) || a.localeCompare(b));

  const maxPorte = Math.max(1, ...ORDEM_PORTE.map((v) => contagem.porte.get(v) ?? 0));
  const totalPorte = [...contagem.porte.values()].reduce((s, n) => s + n, 0);

  const segmentos = [...contagem.segmento.entries()]
    .concat(
      recorte.segmento
        .filter((s) => !contagem.segmento.has(s))
        .map((s): [string, number] => [s, 0]),
    )
    // "Sem segmento" vai para o fim: é falta de dado, não um segmento.
    .sort(
      (a, b) =>
        Number(a[0] === SEM_SEGMENTO) - Number(b[0] === SEM_SEGMENTO) ||
        b[1] - a[1] ||
        a[0].localeCompare(b[0], "pt-BR"),
    );
  const aMostra = segmentos.filter(
    ([s], i) => i < SEGMENTOS_A_MOSTRA || recorte.segmento.includes(s) || s === SEM_SEGMENTO,
  );
  const escondidos = segmentos.filter(([s]) => !aMostra.some(([v]) => v === s));

  return (
    <section aria-label="Recorte da Base" className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={alternarAberto}
            aria-expanded={aberto}
            aria-controls={idCorpo}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg px-2 text-[13px] font-semibold hover:bg-muted/60",
              FOCO_VISIVEL,
            )}
          >
            <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden />
            Região, porte e segmento
            {marcadas > 0 && (
              <span className="num rounded-full bg-primary/15 px-1.5 text-xs font-semibold text-primary-text">
                {marcadas}
              </span>
            )}
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform duration-[120ms]",
                aberto && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          <p className="text-[13px] text-muted-foreground">
            <span className="num font-semibold text-foreground">{number(noRecorte)}</span> {rotulo}
            {temRecorte(recorte) ? ` de ${number(contas.length)}` : ""}
            {aberto ? " · os números de cada opção já contam os outros filtros" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(["regiao", "uf", "porte", "segmento"] as Faceta[]).flatMap((f) =>
            recorte[f].map((v) => (
              <span
                key={`${f}:${v}`}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-primary/10 pl-2.5 pr-1 text-[13px] font-medium text-primary-text"
              >
                {rotuloDaOpcao(f, v)}
                <button
                  type="button"
                  onClick={() => alternar(f, v)}
                  aria-label={`Tirar ${rotuloDaOpcao(f, v)} do recorte`}
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-full hover:bg-primary/15",
                    FOCO_VISIVEL,
                  )}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            )),
          )}
          {temRecorte(recorte) && (
            <button
              type="button"
              onClick={() => aoMudar(RECORTE_VAZIO)}
              className={cn(
                "rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground hover:text-foreground",
                FOCO_VISIVEL,
              )}
            >
              Limpar recorte
            </button>
          )}
        </div>
      </header>

      {aberto && (
        <div id={idCorpo} className="divide-y border-t">
          <Grupo
            icone={MapPin}
            titulo="Região"
            dica="UF da empresa; sem ela, a da unidade que atende"
          >
            <div
              className={cn(
                "grid grid-cols-2 gap-2 sm:grid-cols-3",
                regioes.length > 5 ? "xl:grid-cols-6" : "xl:grid-cols-5",
              )}
            >
              {regioes.map((v) => (
                <Opcao
                  key={v}
                  rotulo={rotuloDaOpcao("regiao", v)}
                  n={contagem.regiao.get(v) ?? 0}
                  max={maxRegiao}
                  total={totalRegiao}
                  marcada={recorte.regiao.includes(v)}
                  neutra={ehDesconhecido(v)}
                  aoAlternar={() => alternar("regiao", v)}
                  aoAuditar={
                    aoAuditar && (() => aoAuditar("regiao", v, contagem.regiao.get(v) ?? 0))
                  }
                />
              ))}
            </div>
            {ufs.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium text-muted-foreground">Estados</span>
                {ufs.map((uf) => (
                  <Pilula
                    key={uf}
                    rotulo={uf}
                    n={contagem.uf.get(uf) ?? 0}
                    marcada={recorte.uf.includes(uf)}
                    aoAlternar={() => alternar("uf", uf)}
                    aoAuditar={aoAuditar && (() => aoAuditar("uf", uf, contagem.uf.get(uf) ?? 0))}
                  />
                ))}
              </div>
            )}
          </Grupo>

          <Grupo
            icone={Ruler}
            titulo="Porte"
            dica="Pela faixa de faturamento; sem ela, pelo porte na Receita"
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {PORTES.map((p) => (
                <Opcao
                  key={p.chave}
                  rotulo={p.rotulo}
                  dica={p.dica}
                  glifo={<MedidorPorte porte={p.chave} />}
                  n={contagem.porte.get(p.chave) ?? 0}
                  max={maxPorte}
                  total={totalPorte}
                  marcada={recorte.porte.includes(p.chave)}
                  neutra={ehDesconhecido(p.chave)}
                  aoAlternar={() => alternar("porte", p.chave)}
                  aoAuditar={
                    aoAuditar &&
                    (() => aoAuditar("porte", p.chave, contagem.porte.get(p.chave) ?? 0))
                  }
                />
              ))}
            </div>
          </Grupo>

          <Grupo
            icone={Shapes}
            titulo="Segmento"
            dica="Do cadastro; os nomes da DataStone viram o do cadastro"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {aMostra.map(([s, n]) => (
                <Pilula
                  key={s}
                  rotulo={s}
                  n={n}
                  marcada={recorte.segmento.includes(s)}
                  neutra={s === SEM_SEGMENTO}
                  aoAlternar={() => alternar("segmento", s)}
                  aoAuditar={aoAuditar && (() => aoAuditar("segmento", s, n))}
                />
              ))}
              {escondidos.length > 0 && (
                <MaisSegmentos
                  opcoes={escondidos}
                  marcadas={recorte.segmento}
                  aoAlternar={(s) => alternar("segmento", s)}
                />
              )}
            </div>
          </Grupo>
        </div>
      )}
    </section>
  );
}

function Grupo({
  icone: Icone,
  titulo,
  dica,
  children,
}: {
  icone: ComponentType<{ className?: string }>;
  titulo: string;
  dica: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 px-4 py-3 lg:grid-cols-[11rem_1fr] lg:gap-6">
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary-text">
          <Icone className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold">{titulo}</h3>
          <p className="text-xs text-muted-foreground">{dica}</p>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

/** Uma opção em cartão: nome, número, % do filtro e a barra contra a maior opção. */
function Opcao({
  rotulo,
  dica,
  glifo,
  n,
  max,
  total,
  marcada,
  neutra,
  aoAlternar,
  aoAuditar,
}: {
  rotulo: string;
  dica?: string;
  glifo?: ReactNode;
  n: number;
  max: number;
  total: number;
  marcada: boolean;
  neutra?: boolean;
  aoAlternar: () => void;
  aoAuditar?: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-pressed={marcada}
        onClick={aoAlternar}
        title={dica ? `${rotulo}: ${dica}` : undefined}
        className={cn(
          "flex w-full flex-col gap-1.5 rounded-xl border bg-background p-2.5 text-left transition-colors duration-[120ms]",
          marcada
            ? "border-primary bg-primary/10 ring-1 ring-primary"
            : "hover:border-muted-foreground/50 hover:bg-muted/40",
          !n && !marcada && "opacity-55",
          FOCO_VISIVEL,
        )}
      >
        <span className="flex min-h-5 items-center gap-2 pr-6">
          {glifo}
          <span
            className={cn("truncate text-[13px] font-semibold", neutra && "text-muted-foreground")}
          >
            {rotulo}
          </span>
          {marcada && <Check className="ml-auto size-4 shrink-0 text-primary-text" aria-hidden />}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="num text-lg font-semibold leading-none">{number(n)}</span>
          <span className="num text-xs text-muted-foreground">{pct(n, total)}%</span>
        </span>
        {dica && <span className="truncate text-xs text-muted-foreground">{dica}</span>}
        <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className={cn(
              "block h-full rounded-full",
              neutra ? "bg-muted-foreground/40" : marcada ? "bg-primary" : "bg-primary/60",
            )}
            style={{ width: `${(n / max) * 100}%` }}
          />
        </span>
      </button>
      {aoAuditar && n > 0 && (
        <button
          type="button"
          onClick={aoAuditar}
          aria-label={`Ver as ${number(n)} empresas de ${rotulo}`}
          title={`Ver as ${number(n)} empresas`}
          className={cn(
            "absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
            FOCO_VISIVEL,
          )}
        >
          <List className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Uma opção em pílula (UF, segmento): nome e número; no Painel, o ícone de lista ao lado. */
function Pilula({
  rotulo,
  n,
  marcada,
  neutra,
  aoAlternar,
  aoAuditar,
}: {
  rotulo: string;
  n: number;
  marcada: boolean;
  neutra?: boolean;
  aoAlternar: () => void;
  aoAuditar?: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center overflow-hidden rounded-full border transition-colors duration-[120ms]",
        marcada ? "border-primary bg-primary/10" : "bg-background hover:bg-muted/40",
        !n && !marcada && "opacity-55",
      )}
    >
      <button
        type="button"
        aria-pressed={marcada}
        onClick={aoAlternar}
        className={cn(
          "inline-flex h-full items-center gap-1.5 pl-3 text-[13px]",
          aoAuditar && n > 0 ? "pr-1.5" : "pr-3",
          marcada ? "font-semibold text-primary-text" : neutra && "text-muted-foreground",
          FOCO_VISIVEL,
        )}
      >
        {marcada && <Check className="size-3.5" aria-hidden />}
        {rotulo}
        <span
          className={cn("num text-xs", marcada ? "text-primary-text" : "text-muted-foreground")}
        >
          {number(n)}
        </span>
      </button>
      {aoAuditar && n > 0 && (
        <button
          type="button"
          onClick={aoAuditar}
          aria-label={`Ver as ${number(n)} empresas de ${rotulo}`}
          title={`Ver as ${number(n)} empresas`}
          className={cn(
            "grid h-full place-items-center border-l px-2 text-muted-foreground hover:bg-muted hover:text-foreground",
            FOCO_VISIVEL,
          )}
        >
          <List className="size-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}

/** Os segmentos menores, num menu com busca e o número de cada um. */
function MaisSegmentos({
  opcoes,
  marcadas,
  aoAlternar,
}: {
  opcoes: [string, number][];
  marcadas: string[];
  aoAlternar: (s: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const visiveis = busca ? opcoes.filter(([s]) => normal(s).includes(normal(busca))) : opcoes;
  return (
    <Popover onOpenChange={(o) => !o && setBusca("")}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-full border border-dashed px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground",
            FOCO_VISIVEL,
          )}
        >
          Mais {opcoes.length} segmentos
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="relative border-b p-2">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar segmento"
            aria-label="Buscar segmento"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" aria-label="Segmentos">
          {visiveis.map(([s, n]) => {
            const id = `seg-${normal(s).replace(/\W+/g, "-")}`;
            return (
              <li
                key={s}
                className="flex min-h-9 items-center gap-3 rounded-md px-2.5 hover:bg-muted"
              >
                <Checkbox
                  id={id}
                  checked={marcadas.includes(s)}
                  onCheckedChange={() => aoAlternar(s)}
                />
                <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate py-2 text-sm">
                  {s}
                </label>
                <span className="num text-xs text-muted-foreground">{number(n)}</span>
              </li>
            );
          })}
          {!visiveis.length && (
            <li className="px-2.5 py-4 text-center text-sm text-muted-foreground">
              Nenhum segmento com "{busca}".
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
