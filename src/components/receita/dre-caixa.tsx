import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { cn } from "@/lib/utils";
import {
  MolduraReceita,
  SeletorMes,
  brlOuTraco,
  rotuloMes,
  useMesNaUrl,
} from "@/components/receita/moldura";
import {
  carregarDreCaixa,
  type Conferencia,
  type DreCaixa,
  type LinhaDre,
} from "@/lib/dre-caixa.functions";

// DRE e Caixa da Partners. Contrato: docs/design/contratos/dre-caixa.md.
// Tudo vem pronto do retrato `ops.dre_caixa`; a tela só escolhe o mês e compara com o anterior.
// Na DRE despesa é negativa: variação > 0 sempre melhora o resultado, < 0 sempre piora.

const brlSinal = (v: number) => (v > 0 ? "+" : "") + brlOuTraco(v);
const corVariacao = (v: number) =>
  Math.abs(v) < 1 ? "text-muted-foreground" : v > 0 ? "text-success" : "text-danger";

export function DreCaixaPagina() {
  const fn = useServerFn(carregarDreCaixa);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dre-caixa"],
    queryFn: () => fn(),
    staleTime: 5 * 60_000,
  });
  const meses = data?.payload.meses ?? [];
  // Padrão: o último mês que não está em andamento.
  const padrao =
    [...meses].reverse().find((m) => !(data?.payload.situacao[m] ?? "").includes("andamento")) ??
    meses[meses.length - 1];
  const [mesUrl, definirMes] = useMesNaUrl(padrao);
  const mes = meses.includes(mesUrl) ? mesUrl : padrao;

  return (
    <MolduraReceita
      titulo="DRE e Caixa"
      pergunta="Por que o resultado do mês é diferente do caixa, e o que mudou de um mês para o outro?"
      descricao="Planning Partners · competência da Partners · DRE pelas réguas de 15/10/2026, caixa pelo extrato de conta corrente do Omie."
      procedencia={
        data
          ? {
              fonte: "Omie da Partners, apuração do Ops e planilha Financeiro - Planning Partners",
              atualizadoEm: data.gravadoEm,
            }
          : undefined
      }
      filtros={
        mes ? (
          <SeletorMes
            mes={mes}
            aoMudar={definirMes}
            minimo={meses[0]}
            maximo={meses[meses.length - 1]}
          />
        ) : undefined
      }
    >
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5 p-4 md:p-6">
        {isLoading ? (
          <Carregando variante="pagina" />
        ) : error ? (
          <EstadoErro detalhe={(error as Error).message} tentarNovamente={() => refetch()} />
        ) : !data || !mes ? (
          <EstadoVazio
            titulo="O retrato da DRE ainda não foi gerado"
            descricao="Ele é gravado por tools/dre_caixa_payload.py depois de montar as abas DRE e FCX."
          />
        ) : (
          <Conteudo D={data.payload} mes={mes} />
        )}
      </div>
    </MolduraReceita>
  );
}

function Conteudo({ D, mes }: { D: DreCaixa; mes: string }) {
  const i = D.meses.indexOf(mes);
  const ant = i > 0 ? D.meses[i - 1] : null;
  const linha = (pref: string, nivel?: number) =>
    D.dre.find((l) => l.k.startsWith(pref) && (nivel === undefined || l.nivel === nivel));
  const periodo = linha("(=) RESULTADO DO PERÍODO", 0);
  const semInv = linha("(=) RESULTADO DO PERÍODO SEM O INVESTIDOR");
  const ponte = D.ponte[mes];
  const fi = D.fcx.meses.indexOf(mes);
  const caixaSemInv = D.fcx.resumo.find((l) => l.k.startsWith("(=) Resultado do mês sem o investidor"));
  const situacao = D.situacao[mes] ?? "";
  const fechado = situacao.startsWith("fechado");

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge tom={fechado ? "sucesso" : "atencao"}>
          {fechado ? "Mês fechado" : "Mês provisório"}
        </StatusBadge>
        {!fechado && (
          <span className="text-muted-foreground">{situacao.replace(/^provisório:\s*/, "")}</span>
        )}
      </div>

      <KpiGrade colunas={4}>
        <KpiCard
          rotulo="Resultado da DRE"
          valor={brlOuTraco(periodo?.v[i])}
          nota="EBIT + não operacional"
          tom={(periodo?.v[i] ?? 0) >= 0 ? "sucesso" : "perigo"}
        />
        <KpiCard
          rotulo="Resultado do caixa"
          valor={brlOuTraco(ponte?.resultado_caixa)}
          nota="entradas − saídas do extrato"
          tom={(ponte?.resultado_caixa ?? 0) >= 0 ? "sucesso" : "perigo"}
        />
        <KpiCard
          rotulo="Diferença DRE × caixa"
          valor={ponte ? brlSinal(ponte.resultado_caixa - ponte.resultado_dre) : "—"}
          nota="explicada degrau a degrau abaixo"
        />
        <KpiCard
          rotulo="Resultado sem o investidor"
          valor={brlOuTraco(semInv?.v[i])}
          nota={`DRE · caixa ${brlOuTraco(fi >= 0 ? caixaSemInv?.v[fi] : undefined)}`}
          tom={(semInv?.v[i] ?? 0) >= 0 ? "sucesso" : "perigo"}
        />
      </KpiGrade>

      {ponte && <PonteCaixa ponte={ponte} />}
      {ant && <PonteEbit D={D} i={i} ant={ant} mes={mes} />}
      <Conferencias itens={D.conferencias[mes] ?? []} mes={mes} />
      <TabelaDre D={D} i={i} ant={ant} />
      <Notas notas={D.notas} />
    </>
  );
}

function Secao({ titulo, sub, children }: { titulo: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 md:p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
        {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </Card>
  );
}

function Abrir({ aberto }: { aberto: boolean }) {
  const I = aberto ? ChevronDown : ChevronRight;
  return <I className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

// ---------------------------------------------------------------- ponte DRE -> caixa

function PonteCaixa({ ponte }: { ponte: DreCaixa["ponte"][string] }) {
  const [aberto, setAberto] = useState<string | null>(null);
  return (
    <Secao
      titulo="Por que o caixa é diferente da DRE?"
      sub="Do resultado da DRE ao resultado do caixa, um degrau por motivo. Efeito positivo: o caixa ficou melhor que a DRE."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Degrau</th>
              <th className="py-2 text-right font-medium">Na DRE</th>
              <th className="py-2 text-right font-medium">No caixa</th>
              <th className="py-2 text-right font-medium">Efeito</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b font-semibold">
              <td className="py-2">Resultado da DRE</td>
              <td />
              <td />
              <td className="py-2 text-right">{brlOuTraco(ponte.resultado_dre)}</td>
            </tr>
            {ponte.degraus.map((d) => (
              <FragmentoDegrau
                key={d.id}
                d={d}
                aberto={aberto === d.id}
                alternar={() => setAberto(aberto === d.id ? null : d.id)}
              />
            ))}
            <tr className="font-semibold">
              <td className="py-2">Resultado do caixa</td>
              <td />
              <td />
              <td className="py-2 text-right">{brlOuTraco(ponte.resultado_caixa)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

function FragmentoDegrau({
  d,
  aberto,
  alternar,
}: {
  d: DreCaixa["ponte"][string]["degraus"][number];
  aberto: boolean;
  alternar: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer border-b hover:bg-muted/50" onClick={alternar}>
        <td className="py-2">
          <span className="flex items-center gap-1.5">
            <Abrir aberto={aberto} />
            {d.rotulo}
          </span>
        </td>
        <td className="py-2 text-right">{brlOuTraco(d.dre)}</td>
        <td className="py-2 text-right">{brlOuTraco(d.caixa)}</td>
        <td className={cn("py-2 text-right font-medium", corVariacao(d.efeito))}>
          {brlSinal(d.efeito)}
        </td>
      </tr>
      {aberto && (
        <tr className="border-b bg-muted/30">
          <td colSpan={4} className="px-6 py-2 text-xs text-muted-foreground">
            {d.explica}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------- ponte do EBIT

function PonteEbit({ D, i, ant, mes }: { D: DreCaixa; i: number; ant: string; mes: string }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const ebit = D.dre.find((l) => l.k.startsWith("(=) RESULTADO OPERACIONAL"));
  const contas = useMemo(() => {
    const filhos = new Map<string, LinhaDre[]>();
    let atual = "";
    for (const l of D.dre) {
      if (l.nivel === 2) atual = l.k;
      else if (l.nivel === 3 && atual) filhos.set(atual, [...(filhos.get(atual) ?? []), l]);
      else if (l.nivel < 2) atual = "";
    }
    return D.dre
      .filter((l) => l.nivel === 2 && l.ebit && !l.conferencia && !l.pct)
      .map((l) => ({ l, d: l.v[i] - l.v[i - 1], filhos: filhos.get(l.k) ?? [] }))
      .filter((x) => Math.abs(x.d) >= 1)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  }, [D, i]);
  const top = contas.slice(0, 12);
  const totalEbit = (ebit?.v[i] ?? 0) - (ebit?.v[i - 1] ?? 0);
  const demais = totalEbit - top.reduce((s, x) => s + x.d, 0);

  return (
    <Secao
      titulo={`O que mudou de ${rotuloMes(ant).toLowerCase()} para ${rotuloMes(mes).toLowerCase()}?`}
      sub="As 12 contas que mais mexeram no EBIT. Verde melhora o resultado (mais receita ou menos despesa), vermelho piora. Clique para abrir por fornecedor ou unidade."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Conta</th>
              <th className="py-2 text-right font-medium">{rotuloMes(ant)}</th>
              <th className="py-2 text-right font-medium">{rotuloMes(mes)}</th>
              <th className="py-2 text-right font-medium">Variação</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b font-semibold">
              <td className="py-2">EBIT de {rotuloMes(ant).toLowerCase()}</td>
              <td />
              <td />
              <td className="py-2 text-right">{brlOuTraco(ebit?.v[i - 1])}</td>
            </tr>
            {top.map(({ l, d, filhos }) => {
              const ab = aberto === l.k;
              const subs = filhos
                .map((f) => ({ f, d: f.v[i] - f.v[i - 1] }))
                .filter((x) => Math.abs(x.d) >= 1)
                .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
                .slice(0, 10);
              return (
                <FragmentoConta
                  key={l.k}
                  l={l}
                  d={d}
                  i={i}
                  aberto={ab}
                  podeAbrir={subs.length > 0}
                  alternar={() => setAberto(ab ? null : l.k)}
                  subs={subs}
                />
              );
            })}
            {Math.abs(demais) >= 1 && (
              <tr className="border-b">
                <td className="py-2 pl-6 text-muted-foreground">Demais contas</td>
                <td />
                <td />
                <td className={cn("py-2 text-right", corVariacao(demais))}>{brlSinal(demais)}</td>
              </tr>
            )}
            <tr className="border-b font-semibold">
              <td className="py-2">EBIT de {rotuloMes(mes).toLowerCase()}</td>
              <td />
              <td />
              <td className="py-2 text-right">{brlOuTraco(ebit?.v[i])}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-2">Variação do EBIT</td>
              <td />
              <td />
              <td className={cn("py-2 text-right", corVariacao(totalEbit))}>{brlSinal(totalEbit)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

function FragmentoConta({
  l,
  d,
  i,
  aberto,
  podeAbrir,
  alternar,
  subs,
}: {
  l: LinhaDre;
  d: number;
  i: number;
  aberto: boolean;
  podeAbrir: boolean;
  alternar: () => void;
  subs: { f: LinhaDre; d: number }[];
}) {
  return (
    <>
      <tr
        className={cn("border-b", podeAbrir && "cursor-pointer hover:bg-muted/50")}
        onClick={podeAbrir ? alternar : undefined}
      >
        <td className="py-2">
          <span className="flex items-center gap-1.5">
            {podeAbrir ? <Abrir aberto={aberto} /> : <span className="w-4" />}
            <span>
              {l.k}
              <span className="ml-2 text-xs text-muted-foreground">{l.grupo || l.bloco}</span>
            </span>
          </span>
        </td>
        <td className="py-2 text-right">{brlOuTraco(l.v[i - 1])}</td>
        <td className="py-2 text-right">{brlOuTraco(l.v[i])}</td>
        <td className={cn("py-2 text-right font-medium", corVariacao(d))}>{brlSinal(d)}</td>
      </tr>
      {aberto &&
        subs.map(({ f, d: df }) => (
          <tr key={f.k} className="border-b bg-muted/30 text-xs">
            <td className="py-1.5 pl-10 text-muted-foreground">{f.k}</td>
            <td className="py-1.5 text-right">{brlOuTraco(f.v[i - 1])}</td>
            <td className="py-1.5 text-right">{brlOuTraco(f.v[i])}</td>
            <td className={cn("py-1.5 text-right", corVariacao(df))}>{brlSinal(df)}</td>
          </tr>
        ))}
    </>
  );
}

// ---------------------------------------------------------------- conferências

const TOM: Record<Conferencia["tom"], TomStatus> = {
  perigo: "perigo",
  atencao: "atencao",
  info: "info",
};

function Conferencias({ itens, mes }: { itens: Conferencia[]; mes: string }) {
  const [aberto, setAberto] = useState<number | null>(null);
  const ordenados = [...itens].sort(
    (a, b) => ["perigo", "atencao", "info"].indexOf(a.tom) - ["perigo", "atencao", "info"].indexOf(b.tom),
  );
  return (
    <Secao
      titulo="O que falta conferir neste mês?"
      sub={`Pendências e lançamentos fora do lugar em ${rotuloMes(mes).toLowerCase()}. Clique para ver a lista.`}
    >
      {ordenados.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada pendente neste mês.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {ordenados.map((c, n) => (
            <li key={n} className="py-2">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 text-left text-sm"
                onClick={() => setAberto(aberto === n ? null : n)}
              >
                <span className="flex items-center gap-2">
                  <Abrir aberto={aberto === n} />
                  <StatusBadge tom={TOM[c.tom]}>
                    {c.tom === "info" ? "Informativo" : c.tom === "perigo" ? "Falta" : "Conferir"}
                  </StatusBadge>
                  {c.titulo}
                </span>
                <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {Math.abs(c.valor) >= 1 ? brlOuTraco(c.valor) : `${c.itens.length} itens`}
                </span>
              </button>
              {aberto === n && (
                <div className="mt-2 pl-6">
                  {c.dono && <p className="mb-1 text-xs text-muted-foreground">Quem resolve: {c.dono}</p>}
                  <table className="w-full text-xs tabular-nums">
                    <tbody>
                      {c.itens.map((it, k) => (
                        <tr key={k} className="border-t">
                          <td className="py-1">{it.nome}</td>
                          <td className="py-1 text-muted-foreground">{it.obs}</td>
                          <td className="py-1 text-right">{Math.abs(it.valor) >= 1 ? brlOuTraco(it.valor) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

// ---------------------------------------------------------------- DRE do mês

function TabelaDre({ D, i, ant }: { D: DreCaixa; i: number; ant: string | null }) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (k: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // Linhas visíveis: blocos e grupos sempre; contas sob o grupo ou bloco aberto; fornecedores
  // sob a conta aberta.
  const visiveis: { l: LinhaDre; temFilho: boolean; chave: string }[] = [];
  let paiConta = "";
  let paiGrupo = "";
  for (let n = 0; n < D.dre.length; n++) {
    const l = D.dre[n];
    const prox = D.dre[n + 1];
    const temFilho = !!prox && prox.nivel > l.nivel && !l.conferencia;
    if (l.nivel <= 1) {
      paiGrupo = `${l.bloco}|${l.k}`;
      paiConta = "";
      visiveis.push({ l, temFilho, chave: paiGrupo });
    } else if (l.nivel === 2) {
      paiConta = `${paiGrupo}|${l.k}`;
      if (abertos.has(paiGrupo)) visiveis.push({ l, temFilho, chave: paiConta });
    } else if (abertos.has(paiGrupo) && abertos.has(paiConta)) {
      visiveis.push({ l, temFilho: false, chave: `${paiConta}|${l.k}` });
    }
  }

  return (
    <Secao
      titulo="DRE do mês"
      sub="Clique no bloco ou no grupo para abrir as contas, e na conta para abrir fornecedores ou unidades."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Linha</th>
              {ant && <th className="py-2 text-right font-medium">{rotuloMes(ant)}</th>}
              <th className="py-2 text-right font-medium">{rotuloMes(D.meses[i])}</th>
              {ant && <th className="py-2 text-right font-medium">Variação</th>}
              <th className="py-2 text-right font-medium">Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map(({ l, temFilho, chave }) => {
              const d = ant ? l.v[i] - l.v[i - 1] : 0;
              const fmt = (v: number | undefined) =>
                l.pct ? (v === undefined ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`) : brlOuTraco(v);
              return (
                <tr
                  key={chave}
                  className={cn(
                    "border-b",
                    temFilho && "cursor-pointer hover:bg-muted/50",
                    l.nivel === 0 && "font-semibold",
                    l.nivel === 1 && "font-medium",
                    l.nivel === 3 && "text-xs text-muted-foreground",
                    l.conferencia && "italic text-muted-foreground",
                  )}
                  onClick={temFilho ? () => alternar(chave) : undefined}
                >
                  <td className="py-1.5" style={{ paddingLeft: `${l.nivel * 14}px` }}>
                    <span className="flex items-center gap-1.5">
                      {temFilho ? <Abrir aberto={abertos.has(chave)} /> : <span className="w-4" />}
                      {l.k}
                    </span>
                  </td>
                  {ant && <td className="py-1.5 text-right">{fmt(l.v[i - 1])}</td>}
                  <td className="py-1.5 text-right">{fmt(l.v[i])}</td>
                  {ant && (
                    <td className={cn("py-1.5 text-right", !l.pct && !l.conferencia && corVariacao(d))}>
                      {l.pct || l.conferencia ? "" : brlSinal(d)}
                    </td>
                  )}
                  <td className="py-1.5 text-right">{l.pct ? "" : brlOuTraco(l.acc)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

function Notas({ notas }: { notas: string[] }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Card className="p-4 md:p-5">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-sm font-medium"
        onClick={() => setAberto(!aberto)}
      >
        <Abrir aberto={aberto} />
        Como a DRE é montada
      </button>
      {aberto && (
        <ul className="mt-3 list-disc space-y-1 pl-8 text-sm text-muted-foreground">
          {notas.map((n, k) => (
            <li key={k}>{n}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
