// Painel da Base (Pedro, 15/10/2026: "dashboards lindos e sexys que vão mostrar a base por unidade e outros
// indicadores importantes, pra instagramar"). Tudo sai da regra de cliente gravada na ficha (`base.situacao`) e do
// cadastro da conta; nenhum número é recalculado aqui de outro jeito.
// Desde 21/10/2026 (Pedro: "clicar em cada gráfico e em cada filtro e conseguir auditar nominalmente o número") todo
// número abre as empresas numa gaveta à direita (`numero` na URL), e o recorte de região, porte e segmento vale aqui
// também. As barras são botões: o valor de cada uma é o tamanho da lista que ela abre (N2).
import { useMemo, type ReactNode } from "react";
import { List } from "lucide-react";
import { Cell, Label, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { KpiCard, KpiGrade, Secao } from "@/components/planning";
import { FOCO_VISIVEL, number } from "@/components/monetizacao/common";
import { CORES_SERIE, COR_NEUTRA, tooltipProps } from "@/lib/planning/grafico";
import { ehCliente, ehExCliente } from "@/lib/clientes/regra-cliente";
import {
  contasDaOpcao,
  passaRecorte,
  PORTES,
  REGIOES,
  rotuloDaOpcao,
  SEM_SEGMENTO,
  SEM_UF,
  type Faceta,
  type PerfilRecorte,
  type RecorteBase,
} from "@/lib/clientes/recorte";
import type { Conta, Negocio } from "@/lib/monetizacao/types";
import { cn } from "@/lib/utils";
import { FiltrosBase } from "./filtros-base";
import { GavetaContas, type NumeroAberto } from "./gaveta-contas";
import type { BuscaClientes } from "./busca";

/** Os quatro graus, do mais certo ao menos, num verde só (a cor diz a certeza; a ordem, o grau). */
const GRAUS = [
  { chave: "g4", rotulo: "Pagamento visto", forca: 100 },
  { chave: "g3", rotulo: "Prova de cliente", forca: 72 },
  { chave: "g2", rotulo: "Base Antiga sem prova", forca: 48 },
  { chave: "g1", rotulo: "Base Nova sem prova", forca: 28 },
] as const;
const corDoGrau = (forca: number) => `color-mix(in srgb, ${CORES_SERIE[0]} ${forca}%, transparent)`;

type Unidade = { key: string; name: string; account_keys: string[] };
/** Um número do Painel: o que a gaveta lista, e para onde o "abrir na lista" leva. */
type Numero = Omit<NumeroAberto, "ir"> & { irPara?: Partial<BuscaClientes>; irContratos?: boolean };
type Barra = { id: string; nome: string; n: number; neutra?: boolean };

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const grau = (a: Conta) => a.base?.situacao?.grau || 1;
const NOME_FACETA: Record<Faceta, string> = {
  regiao: "Região",
  uf: "Estado",
  porte: "Porte",
  segmento: "Segmento",
};

/**
 * As N maiores categorias e o resto em "Outros" (DESIGN.md §5: a 7ª série vira Outros). A conta entra uma vez em cada
 * categoria dela, e uma vez só em "Outros"; um "Outros" que já vem do cadastro cai no mesmo balde. `fim` são as
 * categorias de dado faltante, sempre depois.
 */
function agrupar(contas: Conta[], chaves: (a: Conta) => string[], n: number, fim: string[] = []) {
  const por = new Map<string, Conta[]>();
  for (const a of contas)
    for (const k of new Set(chaves(a))) {
      const l = por.get(k);
      if (l) l.push(a);
      else por.set(k, [a]);
    }
  const ordem = [...por]
    .filter(([k]) => !fim.includes(k) && k !== "Outros")
    .sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0], "pt-BR"));
  const resto = [
    ...ordem.slice(n),
    ...(por.has("Outros") ? [["Outros", por.get("Outros")!] as const] : []),
  ];
  const outros = [...new Set(resto.flatMap(([, cs]) => cs))];
  return [
    ...ordem.slice(0, n).map(([nome, cs]) => ({ nome, contas: cs, neutra: false })),
    ...(outros.length ? [{ nome: "Outros", contas: outros, neutra: true }] : []),
    ...fim.filter((k) => por.has(k)).map((k) => ({ nome: k, contas: por.get(k)!, neutra: true })),
  ];
}

export function PainelBase({
  contas,
  unidades,
  perfil,
  recorte,
  aoMudarRecorte,
  numero,
  aoMudarNumero,
  cards,
  aoIrParaClientes,
  aoAbrirContratos,
}: {
  /** Todas as contas do escopo, já com o filtro de unidade; o recorte é aplicado aqui. */
  contas: Conta[];
  unidades: Unidade[];
  perfil: (a: Conta) => PerfilRecorte;
  recorte: RecorteBase;
  aoMudarRecorte: (r: RecorteBase) => void;
  numero: string | null;
  aoMudarNumero: (n: string | null) => void;
  cards: Negocio[];
  aoIrParaClientes: (patch: Partial<BuscaClientes>) => void;
  aoAbrirContratos: () => void;
}) {
  const clientesSemRecorte = useMemo(() => contas.filter(ehCliente), [contas]);
  const dados = useMemo(() => {
    const numeros = new Map<string, Numero>();
    const noRecorte = contas.filter((a) => passaRecorte(perfil(a), recorte));
    const clientes = noRecorte.filter(ehCliente);
    const ex = noRecorte.filter(ehExCliente);
    const visto = clientes.filter((a) => grau(a) === 4);
    const antigas = clientes.filter((a) => a.base?.origin === "antiga");
    const novas = clientes.filter((a) => a.base?.origin !== "antiga");
    numeros.set("kpi:clientes", {
      titulo: "Clientes ativos",
      descricao: "Clientes pela regra de cliente, no recorte do Painel.",
      contas: clientes,
      irPara: {},
    });
    numeros.set("kpi:g4", {
      titulo: "Com pagamento visto",
      descricao: "Grau 4: recebimento, contrato ativo no Omie ou faturamento recente do grupo.",
      contas: visto,
    });
    numeros.set("origem:antiga", {
      titulo: "Base Antiga",
      descricao: "Clientes ativos com origem Base Antiga no Pipefy.",
      contas: antigas,
      irPara: { base: "antiga" },
    });
    numeros.set("origem:nova", {
      titulo: "Base Nova ou a confirmar",
      descricao: "Clientes ativos com origem Base Nova, ou ainda sem origem confirmada.",
      contas: novas,
      irPara: { base: "nova" },
    });
    numeros.set("kpi:ex", {
      titulo: "Inativos",
      descricao: "Ex-clientes: distrato concluído na Central de Tratativas.",
      contas: ex,
      irPara: { sit: "ex" },
      irContratos: true,
    });

    // Clientes por unidade, empilhados por grau. A conta de duas unidades conta nas duas (como no cadastro).
    const porChave = new Map(clientes.map((a) => [a.key, a]));
    const porUnidade = unidades
      .map((u) => {
        const doGrau: Record<string, Conta[]> = { g4: [], g3: [], g2: [], g1: [] };
        const todas: Conta[] = [];
        for (const k of u.account_keys) {
          const a = porChave.get(k);
          if (!a) continue;
          doGrau[`g${grau(a)}`].push(a);
          todas.push(a);
        }
        numeros.set(`unidade:${u.key}`, {
          titulo: `Clientes de ${u.name}`,
          descricao: "Clientes pela regra de cliente atendidos pela unidade.",
          contas: todas,
          irPara: { unidade: [u.key] },
        });
        for (const g of GRAUS)
          numeros.set(`unidade:${u.key}:${g.chave}`, {
            titulo: `${u.name} · ${g.rotulo}`,
            descricao: `Clientes de ${u.name} no grau ${g.chave.slice(1)} de certeza.`,
            contas: doGrau[g.chave],
            irPara: { unidade: [u.key] },
          });
        return {
          key: u.key,
          nome: u.name,
          total: todas.length,
          graus: GRAUS.map((g) => doGrau[g.chave].length),
        };
      })
      .filter((l) => l.total > 0)
      .sort((a, b) => b.total - a.total);
    for (const g of GRAUS)
      numeros.set(`grau:${g.chave}`, {
        titulo: g.rotulo,
        descricao: `Clientes no grau ${g.chave.slice(1)} de certeza, em todas as unidades do recorte.`,
        contas: clientes.filter((a) => `g${grau(a)}` === g.chave),
      });

    // Cada gráfico de barras: o grupo vira número na gaveta com o mesmo id da barra.
    const barras = (
      tipo: string,
      grupos: { nome: string; contas: Conta[]; neutra: boolean }[],
      titulo: (nome: string) => string,
      descricao: (nome: string) => string,
      irPara?: (nome: string) => Partial<BuscaClientes> | undefined,
    ): Barra[] =>
      grupos.map((g) => {
        const id = `${tipo}:${g.nome}`;
        numeros.set(id, {
          titulo: titulo(g.nome),
          descricao: descricao(g.nome),
          contas: g.contas,
          irPara: irPara?.(g.nome),
        });
        return { id, nome: g.nome, n: g.contas.length, neutra: g.neutra };
      });
    const regioes = barras(
      "regiao",
      [...REGIOES, SEM_UF]
        .map((r) => ({
          nome: r,
          contas: clientes.filter((a) => perfil(a).regiao === r),
          neutra: r === SEM_UF,
        }))
        .filter((g) => g.contas.length),
      (r) => `Clientes · ${rotuloDaOpcao("regiao", r)}`,
      (r) =>
        r === SEM_UF
          ? "Clientes sem UF da empresa e sem unidade com praça conhecida."
          : `Clientes com UF no ${r}: a da empresa ou, sem ela, a da unidade que atende.`,
      (r) => ({ regiao: [r], uf: undefined }),
    );
    const portes = barras(
      "porte",
      PORTES.map((p) => ({
        nome: p.chave as string,
        contas: clientes.filter((a) => perfil(a).porte === p.chave),
        neutra: p.chave === "sem_porte",
      })).filter((g) => g.contas.length),
      (p) => `Clientes · ${rotuloDaOpcao("porte", p)}`,
      (p) => {
        const x = PORTES.find((y) => y.chave === p);
        return `${x?.rotulo}: ${x?.dica}. Pela faixa de faturamento; sem ela, pelo porte na Receita.`;
      },
      (p) => ({ porte: [p as never] }),
    );
    const segmentos = barras(
      "segmento",
      agrupar(clientes, (a) => [perfil(a).segmento], 7, [SEM_SEGMENTO]),
      (s) => `Clientes · ${s}`,
      (s) =>
        s === "Outros"
          ? 'Os segmentos menores e o "Outros" do cadastro.'
          : s === SEM_SEGMENTO
            ? 'Clientes sem segmento no cadastro (vazio ou "Não informado").'
            : `Clientes do segmento ${s} (os nomes da DataStone viram o do cadastro).`,
      (s) => (s === "Outros" ? undefined : { segmentoCliente: [s] }),
    );
    const regimes = barras(
      "regime",
      agrupar(clientes, (a) => [a.regime?.trim() || "Regime a confirmar"], 5, [
        "Regime a confirmar",
      ]),
      (r) => `Clientes · ${r}`,
      (r) =>
        r === "Outros"
          ? "Os regimes menores do cadastro."
          : r === "Regime a confirmar"
            ? "Clientes sem regime tributário no cadastro."
            : `Clientes com regime ${r} no cadastro.`,
    );
    const semFaixa = clientes.filter((a) => !a.band?.trim());
    numeros.set("faixa:sem", {
      titulo: "Clientes sem faixa de faturamento",
      descricao: "Sem faixa declarada nem estimada; o porte, quando há, vem da Receita.",
      contas: semFaixa,
    });
    const faixas = barras(
      "faixa",
      agrupar(
        clientes.filter((a) => a.band?.trim()),
        (a) => [a.band!.trim()],
        6,
      ),
      (f) => `Clientes · ${f}`,
      (f) =>
        f === "Outros"
          ? "As faixas menores."
          : `Faixa de faturamento anual declarada ou estimada: ${f}.`,
    );
    const quemFatura = barras(
      "fatura",
      agrupar(clientes, (a) => a.base?.prova?.faturado_por ?? [], 6),
      (e) => `Faturados por ${e}`,
      (e) =>
        e === "Outros"
          ? "Clientes faturados em 2026 por empresas do grupo fora das seis maiores. A empresa faturada por mais de uma entra uma vez."
          : `Clientes que ${e} faturou em 2026 (Financial Brain). A empresa faturada por mais de uma conta em cada barra dela.`,
    );
    return {
      numeros,
      clientes: clientes.length,
      visto: visto.length,
      antigas: antigas.length,
      novas: novas.length,
      ex: ex.length,
      porUnidade,
      regioes,
      portes,
      segmentos,
      regimes,
      faixas,
      semFaixa: semFaixa.length,
      quemFatura,
    };
  }, [contas, unidades, perfil, recorte]);

  // O número aberto: os do Painel saem do mapa; os do recorte ("filtro:faceta:valor") contam com os outros filtros.
  const aberto: NumeroAberto | null = useMemo(() => {
    if (!numero) return null;
    const [tipo, faceta, ...resto] = numero.split(":");
    const n: Numero | undefined =
      tipo === "filtro" && faceta in NOME_FACETA
        ? {
            titulo: `${NOME_FACETA[faceta as Faceta]} · ${rotuloDaOpcao(faceta as Faceta, resto.join(":"))}`,
            descricao:
              "Clientes desta opção do recorte, com os outros filtros aplicados (o número do filtro).",
            contas: contasDaOpcao(
              clientesSemRecorte,
              perfil,
              recorte,
              faceta as Faceta,
              resto.join(":"),
            ),
          }
        : dados.numeros.get(numero);
    if (!n) return null;
    return {
      titulo: n.titulo,
      descricao: n.descricao,
      contas: n.contas,
      ir: n.irContratos
        ? { rotulo: "Contratos, MRR e churn por unidade", onClick: aoAbrirContratos }
        : n.irPara
          ? { rotulo: "Abrir na lista de Clientes", onClick: () => aoIrParaClientes(n.irPara!) }
          : undefined,
    };
  }, [numero, dados, clientesSemRecorte, perfil, recorte, aoAbrirContratos, aoIrParaClientes]);

  const abrir = (id: string) => aoMudarNumero(id);
  const rotuloDaBarra = (tipo: string, nome: string) =>
    tipo === "regiao" || tipo === "porte" ? rotuloDaOpcao(tipo, nome) : nome;

  return (
    <div className="space-y-6">
      <FiltrosBase
        contas={clientesSemRecorte}
        perfil={perfil}
        recorte={recorte}
        aoMudar={aoMudarRecorte}
        aoAuditar={(f, v) => abrir(`filtro:${f}:${v}`)}
      />

      <KpiGrade colunas={4}>
        <KpiCard
          rotulo="Clientes ativos"
          valor={number(dados.clientes)}
          nota="Clientes pela regra de cliente · ver as empresas"
          abrir={{ rotulo: "Ver as empresas", onClick: () => abrir("kpi:clientes") }}
        />
        <KpiCard
          rotulo="Com pagamento visto"
          valor={`${pct(dados.visto, dados.clientes)}%`}
          nota={`${number(dados.visto)} com recebimento, contrato ativo ou faturamento recente`}
          abrir={{ rotulo: "Ver as empresas", onClick: () => abrir("kpi:g4") }}
        />
        <KpiCard
          rotulo="Base Antiga"
          valor={number(dados.antigas)}
          nota={`${pct(dados.antigas, dados.clientes)}% dos clientes · ${number(dados.novas)} na Base Nova ou a confirmar`}
          abrir={{ rotulo: "Ver as empresas", onClick: () => abrir("origem:antiga") }}
        />
        <KpiCard
          rotulo="Inativos"
          valor={number(dados.ex)}
          nota="Distrato concluído na Central de Tratativas"
          abrir={{ rotulo: "Ver as empresas", onClick: () => abrir("kpi:ex") }}
        />
      </KpiGrade>

      <Secao
        titulo="Clientes por unidade"
        descricao="Cada barra é uma unidade; o verde mais escuro é o grau mais certo. Toque num pedaço da barra, no nome ou no total para ver as empresas."
        acoes={
          <button
            type="button"
            onClick={aoAbrirContratos}
            className={`text-sm font-medium text-primary-text underline underline-offset-2 ${FOCO_VISIVEL}`}
          >
            Contratos, MRR e churn por unidade →
          </button>
        }
      >
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Graus">
            {GRAUS.map((g) => (
              <li key={g.chave}>
                <button
                  type="button"
                  onClick={() => abrir(`grau:${g.chave}`)}
                  className={`inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground ${FOCO_VISIVEL}`}
                >
                  <span className="size-3 rounded-sm" style={{ background: corDoGrau(g.forca) }} />
                  {g.rotulo}
                </button>
              </li>
            ))}
          </ul>
          {dados.porUnidade.length ? (
            <div className="space-y-1">
              {dados.porUnidade.map((u) => {
                const max = dados.porUnidade[0].total;
                return (
                  <div
                    key={u.key}
                    className="grid grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_1fr_4rem]"
                  >
                    <button
                      type="button"
                      onClick={() => abrir(`unidade:${u.key}`)}
                      className={`truncate rounded py-1 text-left text-[13px] hover:text-primary-text hover:underline ${FOCO_VISIVEL}`}
                    >
                      {u.nome}
                    </button>
                    <div
                      className="flex h-6 overflow-hidden rounded"
                      style={{ width: `${(u.total / max) * 100}%` }}
                    >
                      {GRAUS.map((g, i) =>
                        u.graus[i] ? (
                          <button
                            key={g.chave}
                            type="button"
                            onClick={() => abrir(`unidade:${u.key}:${g.chave}`)}
                            aria-label={`${u.nome} · ${g.rotulo}: ${number(u.graus[i])} clientes`}
                            title={`${g.rotulo}: ${number(u.graus[i])}`}
                            className={`h-full min-w-1 transition-opacity duration-[120ms] hover:opacity-80 ${FOCO_VISIVEL}`}
                            style={{
                              flexGrow: u.graus[i],
                              flexBasis: 0,
                              background: corDoGrau(g.forca),
                            }}
                          />
                        ) : null,
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => abrir(`unidade:${u.key}`)}
                      aria-label={`${u.nome}: ${number(u.total)} clientes`}
                      className={`num rounded text-right text-[13px] font-semibold hover:text-primary-text hover:underline ${FOCO_VISIVEL}`}
                    >
                      {number(u.total)}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum cliente neste recorte.</p>
          )}
        </div>
      </Secao>

      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao titulo="Região" descricao="UF da empresa; sem ela, a UF da unidade que atende">
          <Barras
            barras={dados.regioes}
            cor={CORES_SERIE[1]}
            abrir={abrir}
            rotulo={(n) => rotuloDaBarra("regiao", n)}
          />
        </Cartao>
        <Cartao
          titulo="Porte"
          descricao="Pela faixa de faturamento; sem ela, pelo porte na Receita (micro até R$ 500 mil, pequena até R$ 4,8 mi, média até R$ 78 mi)"
        >
          <Barras
            barras={dados.portes}
            cor={CORES_SERIE[0]}
            abrir={abrir}
            rotulo={(n) => rotuloDaBarra("porte", n)}
          />
        </Cartao>
        <Cartao
          titulo="Base Antiga × Base Nova"
          descricao="Origem dos clientes ativos no Pipefy · toque na fatia"
        >
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={[
                  { nome: "Base Antiga", valor: dados.antigas, id: "origem:antiga" },
                  { nome: "Base Nova ou a confirmar", valor: dados.novas, id: "origem:nova" },
                ]}
                dataKey="valor"
                nameKey="nome"
                innerRadius={62}
                outerRadius={96}
                paddingAngle={2}
                stroke="var(--card)"
                cursor="pointer"
                onClick={(d: { payload?: { id: string } }) => d.payload && abrir(d.payload.id)}
              >
                <Cell fill={CORES_SERIE[0]} />
                <Cell fill={CORES_SERIE[1]} />
                <Label
                  value={`${pct(dados.antigas, dados.clientes)}% Base Antiga`}
                  position="center"
                  fill="var(--foreground)"
                  fontSize={14}
                  fontWeight={600}
                />
              </Pie>
              <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [number(v), n]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap justify-center gap-2">
            {(
              [
                ["origem:antiga", "Base Antiga", dados.antigas, CORES_SERIE[0]],
                ["origem:nova", "Base Nova ou a confirmar", dados.novas, CORES_SERIE[1]],
              ] as const
            ).map(([id, nome, n, cor]) => (
              <button
                key={id}
                type="button"
                onClick={() => abrir(id)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[13px] hover:bg-muted/50 ${FOCO_VISIVEL}`}
              >
                <span className="size-2.5 rounded-full" style={{ background: cor }} aria-hidden />
                {nome}
                <span className="num font-semibold">{number(n)}</span>
              </button>
            ))}
          </div>
        </Cartao>
        <Cartao titulo="Regime tributário" descricao="Clientes ativos pelo regime do cadastro">
          <Barras barras={dados.regimes} cor={CORES_SERIE[2]} abrir={abrir} />
        </Cartao>
        <Cartao titulo="Segmentos" descricao="Os maiores segmentos entre os clientes ativos">
          <Barras barras={dados.segmentos} cor={CORES_SERIE[1]} abrir={abrir} />
        </Cartao>
        <Cartao
          titulo="Faixa de faturamento"
          descricao={
            <>
              Faturamento anual declarado ou estimado
              {dados.semFaixa > 0 && (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => abrir("faixa:sem")}
                    className={`num rounded underline underline-offset-2 hover:text-foreground ${FOCO_VISIVEL}`}
                  >
                    {number(dados.semFaixa)} sem faixa
                  </button>
                </>
              )}
            </>
          }
        >
          <Barras barras={dados.faixas} cor={CORES_SERIE[3]} abrir={abrir} />
        </Cartao>
        <Cartao
          titulo="Quem fatura os clientes"
          descricao="Empresas do grupo que faturaram clientes da Base em 2026 (Financial Brain)"
        >
          {dados.quemFatura.length ? (
            <Barras
              barras={dados.quemFatura}
              cor={CORES_SERIE[4]}
              abrir={abrir}
              total={dados.clientes}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Faturamento do grupo ainda não lido.</p>
          )}
        </Cartao>
      </div>

      <GavetaContas
        numero={aberto}
        fechar={() => aoMudarNumero(null)}
        perfil={perfil}
        cards={cards}
      />
    </div>
  );
}

function Cartao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <p className="text-xs text-muted-foreground">{descricao}</p>
      </div>
      {children}
    </section>
  );
}

/** Barras horizontais em que cada linha é um botão: nome, barra e número abrem as empresas da linha. */
function Barras({
  barras,
  cor,
  abrir,
  rotulo = (n) => n,
  total = barras.reduce((s, b) => s + b.n, 0),
}: {
  barras: Barra[];
  cor: string;
  abrir: (id: string) => void;
  rotulo?: (nome: string) => string;
  /** Base do %: a soma das barras, ou os clientes quando a mesma conta entra em mais de uma barra. */
  total?: number;
}) {
  if (!barras.length)
    return <p className="text-sm text-muted-foreground">Nenhum cliente neste recorte.</p>;
  const max = Math.max(1, ...barras.map((b) => b.n));
  return (
    <ul className="space-y-0.5">
      {barras.map((b) => (
        <li key={b.id}>
          <button
            type="button"
            onClick={() => abrir(b.id)}
            aria-label={`${rotulo(b.nome)}: ${number(b.n)} clientes · ver as empresas`}
            className={cn(
              "group grid w-full grid-cols-[minmax(0,13rem)_1fr_auto] items-center gap-3 rounded-md px-1.5 py-1 text-left hover:bg-muted/50",
              FOCO_VISIVEL,
            )}
          >
            <span className={cn("truncate text-[13px]", b.neutra && "text-muted-foreground")}>
              {rotulo(b.nome)}
            </span>
            <span className="h-5 overflow-hidden rounded bg-muted/50">
              <span
                className="block h-full rounded transition-opacity duration-[120ms] group-hover:opacity-80"
                style={{ width: `${(b.n / max) * 100}%`, background: b.neutra ? COR_NEUTRA : cor }}
              />
            </span>
            <span className="flex items-center gap-1.5">
              <span className="num text-[13px] font-semibold">{number(b.n)}</span>
              <span className="num w-9 text-right text-xs text-muted-foreground">
                {pct(b.n, total)}%
              </span>
              <List
                className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden
              />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
