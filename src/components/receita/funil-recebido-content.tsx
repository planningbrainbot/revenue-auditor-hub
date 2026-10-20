// Funil da venda ao recebido (/unidades/funil-recebido). Todas as unidades, três
// etapas: vendas, contratos e o que a unidade recebeu dos clientes, sem royalty.
// Duas visões: a da unidade (cada uma com o próprio funil, e o mês a mês ao abrir
// uma) e o CAC adiantado × o recebido dos mesmos clientes. Números de
// `carregarFunilRecebido`.
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarraFiltros,
  Carregando,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { ErroDaConsulta, rotuloMesCurto } from "@/components/receita/moldura";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import {
  carregarFunilRecebido,
  type ClienteCac,
  type ClienteFunil,
  type FunilRecebido,
  type LinhaMes,
  type UnidadeFunil,
} from "@/lib/funil-recebido.functions";

const brl = (v: number | null | undefined) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      });
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const razao = (a: number, b: number) =>
  b > 0 ? (a / b).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";

function Barra({ valor, maximo }: { valor: number; maximo: number }) {
  const largura = maximo > 0 ? Math.max(0, Math.min(100, (valor / maximo) * 100)) : 0;
  return (
    <div className="h-2.5 w-full rounded-full bg-muted">
      <div className="h-2.5 rounded-full bg-primary" style={{ width: `${largura}%` }} />
    </div>
  );
}

type Totais = {
  vendas: number;
  mrrVendido: number;
  contratos: number;
  mrrContratado: number;
  recebido: number;
  temRecebido: boolean;
};

function totalizar(linhas: LinhaMes[]): Totais {
  const t: Totais = {
    vendas: 0,
    mrrVendido: 0,
    contratos: 0,
    mrrContratado: 0,
    recebido: 0,
    temRecebido: false,
  };
  for (const l of linhas) {
    t.vendas += l.vendas;
    t.mrrVendido += l.mrrVendido;
    t.contratos += l.contratos;
    t.mrrContratado += l.mrrContratado;
    if (l.recebido != null) {
      t.recebido += l.recebido;
      t.temRecebido = true;
    }
  }
  return t;
}

/** Por que o recebido da unidade está incompleto ou ausente. */
function avisoRecebido(u: UnidadeFunil, temRecebido: boolean): string | null {
  if (!temRecebido)
    return u.ultimaApuracao
      ? "Apuração só traz CAC: sem fonte de recebido"
      : "Sem apuração nem split: sem fonte de recebido";
  if (!u.splitDesde && u.ultimaApuracao)
    return `Recebido até ${rotuloMesCurto(u.ultimaApuracao)} (última apuração)`;
  return null;
}

export function FunilRecebidoContent() {
  const buscar = useServerFn(carregarFunilRecebido);
  const [base, setBase] = useState<FunilRecebido | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  const [visao, setVisao] = useFiltroNaUrl("visao", "unidades");
  const [unidade, setUnidade] = useFiltroNaUrl("unidade", "todas");
  const [de, setDe] = useFiltroNaUrl("de", "");
  const [ate, setAte] = useFiltroNaUrl("ate", "");
  const limpar = useLimparFiltrosNaUrl(["unidade", "de", "ate"]);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    buscar()
      .then((r) => vivo && setBase(r))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : String(e)));
    return () => {
      vivo = false;
    };
  }, [buscar, tentativa]);

  const meses = useMemo(() => [...new Set((base?.meses ?? []).map((l) => l.mes))].sort(), [base]);
  const deEf = meses.includes(de) ? de : meses[0];
  const ateEf = meses.includes(ate) ? ate : meses[meses.length - 1];
  const noPeriodo = (m: string) => (!deEf || m >= deEf) && (!ateEf || m <= ateEf);

  if (erro) {
    return (
      <div className="px-4 py-6 md:px-6">
        <ErroDaConsulta
          erro={erro}
          chaves="view.royalties_split"
          titulo="Não foi possível montar o funil"
          tentarNovamente={() => setTentativa((n) => n + 1)}
        />
      </div>
    );
  }
  if (!base) return <Carregando variante="pagina" className="px-4 py-6 md:px-6" />;
  if (base.unidades.length === 0) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EstadoVazio
          titulo="Nenhuma unidade com venda ou recebido"
          descricao={`Nada desde ${rotuloMesCurto(base.inicio)}.`}
        />
      </div>
    );
  }

  const temFiltro = unidade !== "todas" || de !== "" || ate !== "";
  const linhas = base.meses.filter(
    (l) => (unidade === "todas" || l.unidade === unidade) && noPeriodo(l.mes),
  );

  return (
    <div className="space-y-6 px-4 py-6 md:px-6">
      <Tabs value={visao} onValueChange={setVisao}>
        <TabsList>
          <TabsTrigger value="unidades">Funil por unidade</TabsTrigger>
          <TabsTrigger value="cac">CAC × recebido</TabsTrigger>
        </TabsList>
      </Tabs>

      <BarraFiltros aoLimpar={temFiltro ? limpar : undefined}>
        <Select value={unidade} onValueChange={setUnidade}>
          <SelectTrigger className="w-[190px]" aria-label="Unidade">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as unidades</SelectItem>
            {base.unidades.map((u) => (
              <SelectItem key={u.nome} value={u.nome}>
                {u.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {visao === "unidades" && meses.length > 0 && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span>De</span>
            <Select value={deEf} onValueChange={(v) => setDe(v === meses[0] ? "" : v)}>
              <SelectTrigger className="w-[105px]" aria-label="Mês inicial">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {meses.map((m) => (
                  <SelectItem key={m} value={m}>
                    {rotuloMesCurto(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>até</span>
            <Select
              value={ateEf}
              onValueChange={(v) => setAte(v === meses[meses.length - 1] ? "" : v)}
            >
              <SelectTrigger className="w-[105px]" aria-label="Mês final">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {meses.map((m) => (
                  <SelectItem key={m} value={m}>
                    {rotuloMesCurto(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </BarraFiltros>

      {visao === "unidades" && (
        <VisaoUnidades
          base={base}
          linhas={linhas}
          unidade={unidade}
          abrirUnidade={setUnidade}
          noPeriodo={noPeriodo}
        />
      )}
      {visao === "cac" && (
        <VisaoCac
          clientes={base.cac.filter((c) => unidade === "todas" || c.unidade === unidade)}
          unidades={base.unidades}
          meses={base.meses}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- unidades

function VisaoUnidades({
  base,
  linhas,
  unidade,
  abrirUnidade,
  noPeriodo,
}: {
  base: FunilRecebido;
  linhas: LinhaMes[];
  unidade: string;
  abrirUnidade: (u: string) => void;
  noPeriodo: (mes: string) => boolean;
}) {
  const t = totalizar(linhas);
  const porUnidade = base.unidades
    .filter((u) => unidade === "todas" || u.nome === unidade)
    .map((u) => ({ u, t: totalizar(linhas.filter((l) => l.unidade === u.nome)) }))
    .sort((a, b) => b.t.recebido - a.t.recebido || b.t.vendas - a.t.vendas);
  const maxVendas = Math.max(...porUnidade.map((p) => p.t.vendas), 1);
  const sel = unidade === "todas" ? null : base.unidades.find((u) => u.nome === unidade);

  if (linhas.length === 0)
    return <EstadoVazio titulo="Nada neste recorte" descricao="Troque a unidade ou o período." />;

  return (
    <>
      <Secao
        titulo="Quanto cada unidade vendeu, contratou e já recebeu?"
        descricao="Fluxo do mês: cada etapa conta o que aconteceu no mês, não os mesmos clientes. O recebido inclui clientes vendidos antes do período e fica sem a base antiga (carteira de antes da rede). Sem split, o recebido vem das apurações de royalties; com split, depois da última apuração, dos boletos pagos no Omie da unidade."
      >
        <KpiGrade colunas={3}>
          <KpiCard
            rotulo="1. Vendas"
            valor={String(t.vendas)}
            nota={`${brl(t.mrrVendido)} de MRR vendido`}
          />
          <KpiCard
            rotulo="2. Contratos"
            valor={String(t.contratos)}
            nota={`${brl(t.mrrContratado)} de MRR · ${pct(t.contratos, t.vendas)} das vendas`}
          />
          <KpiCard
            rotulo="3. Recebido pela unidade"
            valor={t.temRecebido ? brl(t.recebido) : "—"}
            nota={
              sel
                ? `${sel.clientesPagaram} clientes pagaram${sel.baseAntiga ? ` · base antiga ${brl(sel.baseAntiga)} fora` : ""}`
                : "pago pelos clientes, sem royalty"
            }
          />
        </KpiGrade>
      </Secao>

      {!sel && (
        <Secao titulo="Visão da unidade" descricao="Clique numa unidade para ver o mês a mês dela.">
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="w-[160px]">Vendas</TableHead>
                  <TableHead className="text-right">Vendas</TableHead>
                  <TableHead className="text-right">MRR vendido</TableHead>
                  <TableHead className="text-right">Contratos</TableHead>
                  <TableHead className="text-right">% das vendas</TableHead>
                  <TableHead className="text-right">MRR contratado</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead>Observação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porUnidade.map(({ u, t: tu }) => {
                  const aviso = avisoRecebido(u, tu.temRecebido);
                  return (
                    <TableRow
                      key={u.nome}
                      className="cursor-pointer"
                      onClick={() => abrirUnidade(u.nome)}
                    >
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() => abrirUnidade(u.nome)}
                        >
                          {u.nome}
                        </button>
                        <span className="block text-xs text-muted-foreground">
                          {[u.splitDesde ? "split" : null, u.pagaCac ? "paga CAC" : null]
                            .filter(Boolean)
                            .join(" · ") || u.tipo}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Barra valor={tu.vendas} maximo={maxVendas} />
                      </TableCell>
                      <TableCell className="num text-right">{tu.vendas}</TableCell>
                      <TableCell className="num text-right">{brl(tu.mrrVendido)}</TableCell>
                      <TableCell className="num text-right">{tu.contratos}</TableCell>
                      <TableCell className="num text-right">
                        {pct(tu.contratos, tu.vendas)}
                      </TableCell>
                      <TableCell className="num text-right">{brl(tu.mrrContratado)}</TableCell>
                      <TableCell className="num text-right font-medium">
                        {tu.temRecebido ? brl(tu.recebido) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{aviso ?? ""}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Secao>
      )}

      {sel && <MesAMes unidade={sel} linhas={linhas} />}

      <ListaClientes
        clientes={base.clientes.filter((c) => unidade === "todas" || c.unidade === unidade)}
        noPeriodo={noPeriodo}
        mostrarUnidade={unidade === "todas"}
      />
    </>
  );
}

function MesAMes({ unidade, linhas }: { unidade: UnidadeFunil; linhas: LinhaMes[] }) {
  const aviso = avisoRecebido(
    unidade,
    linhas.some((l) => l.recebido != null),
  );
  return (
    <Secao titulo={`${unidade.nome}, mês a mês`} descricao={aviso ?? undefined}>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead>
              <TableHead className="text-right">Vendas</TableHead>
              <TableHead className="text-right">MRR vendido</TableHead>
              <TableHead className="text-right">Contratos</TableHead>
              <TableHead className="text-right">MRR contratado</TableHead>
              <TableHead className="text-right">Recebido</TableHead>
              <TableHead className="text-right">Clientes que pagaram</TableHead>
              <TableHead>Fonte do recebido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.mes}>
                <TableCell>{rotuloMesCurto(l.mes)}</TableCell>
                <TableCell className="num text-right">{l.vendas}</TableCell>
                <TableCell className="num text-right">{brl(l.mrrVendido)}</TableCell>
                <TableCell className="num text-right">{l.contratos}</TableCell>
                <TableCell className="num text-right">{brl(l.mrrContratado)}</TableCell>
                <TableCell className="num text-right font-medium">{brl(l.recebido)}</TableCell>
                <TableCell className="num text-right">
                  {l.recebido != null ? l.clientesPagaram : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {l.fonte === "apuracao"
                    ? "Apuração de royalties"
                    : l.fonte === "split"
                      ? "Omie da unidade (split)"
                      : "sem fonte"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Secao>
  );
}

// ---------------------------------------------------------------- clientes

type Situacao = "sem_contrato" | "sem_recebido" | "recebendo" | "so_recebido";
const SITUACOES: Record<Situacao, { rotulo: string; tom: TomStatus }> = {
  sem_contrato: { rotulo: "vendido, sem contrato", tom: "atencao" },
  sem_recebido: { rotulo: "contrato, ainda sem recebido", tom: "perigo" },
  recebendo: { rotulo: "recebendo", tom: "sucesso" },
  so_recebido: { rotulo: "recebido, sem venda no período", tom: "neutro" },
};

/** Os clientes que formam os três números do recorte. */
function ListaClientes({
  clientes,
  noPeriodo,
  mostrarUnidade,
}: {
  clientes: ClienteFunil[];
  noPeriodo: (mes: string) => boolean;
  mostrarUnidade: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState<"todas" | Situacao>("todas");

  const linhas = useMemo(
    () =>
      clientes
        .map((c) => {
          const vendas = c.vendas.filter((v) => noPeriodo(v.mes));
          const contratos = c.contratos.filter((v) => noPeriodo(v.mes));
          const mesesRec = Object.keys(c.recebido).filter(noPeriodo).sort();
          const recebido = mesesRec.reduce((a, m) => a + c.recebido[m], 0);
          if (!vendas.length && !contratos.length && !mesesRec.length) return null;
          const temContrato = contratos.length > 0 || c.contratos.length > 0;
          const sit: Situacao =
            recebido > 0
              ? vendas.length || contratos.length
                ? "recebendo"
                : "so_recebido"
              : temContrato
                ? "sem_recebido"
                : "sem_contrato";
          return {
            c,
            venda: vendas[0]?.mes ?? null,
            mrrVendido: vendas.reduce((a, v) => a + v.mrr, 0),
            contrato: contratos[0]?.mes ?? null,
            mrrContratado: contratos.reduce((a, v) => a + v.mrr, 0),
            recebido,
            mesesRec: mesesRec.length,
            sit,
          };
        })
        .filter((l): l is NonNullable<typeof l> => l !== null),
    [clientes, noPeriodo],
  );

  const termo = busca.trim().toLowerCase();
  const visiveis = linhas.filter(
    (l) =>
      (situacao === "todas" || l.sit === situacao) &&
      (!termo ||
        l.c.cliente.toLowerCase().includes(termo) ||
        (l.c.cnpj ?? "").includes(termo.replace(/\D/g, "") || "\u0000")),
  );
  const contagem = (s: Situacao) => linhas.filter((l) => l.sit === s).length;

  return (
    <Secao
      titulo="Quais clientes compõem esses números?"
      descricao="Cada cliente com a venda, o contrato e o recebido dentro do período. Venda e recebido do mesmo cliente se juntam pelo CNPJ e, sem CNPJ, pelo nome dentro da unidade; cliente com nome diferente na venda e no Omie pode aparecer em duas linhas."
    >
      <BarraFiltros>
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente ou CNPJ"
          aria-label="Buscar cliente"
          className="w-[240px]"
        />
        <Select value={situacao} onValueChange={(v) => setSituacao(v as typeof situacao)}>
          <SelectTrigger className="w-[260px]" aria-label="Situação do cliente">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as situações ({linhas.length})</SelectItem>
            {(Object.keys(SITUACOES) as Situacao[]).map((s) => (
              <SelectItem key={s} value={s}>
                {SITUACOES[s].rotulo} ({contagem(s)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </BarraFiltros>
      {visiveis.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum cliente neste recorte"
          descricao="Troque a busca ou a situação."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {mostrarUnidade && <TableHead>Unidade</TableHead>}
                <TableHead>Cliente</TableHead>
                <TableHead>Venda</TableHead>
                <TableHead className="text-right">MRR vendido</TableHead>
                <TableHead>Contrato</TableHead>
                <TableHead className="text-right">MRR contratado</TableHead>
                <TableHead className="text-right">Recebido</TableHead>
                <TableHead className="text-right">Meses pagos</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((l, i) => (
                <TableRow key={`${l.c.unidade}|${l.c.cnpj}|${l.c.cliente}|${i}`}>
                  {mostrarUnidade && <TableCell>{l.c.unidade}</TableCell>}
                  <TableCell>
                    {l.c.cliente}
                    {l.c.cnpj && (
                      <span className="block text-xs text-muted-foreground">{l.c.cnpj}</span>
                    )}
                  </TableCell>
                  <TableCell>{l.venda ? rotuloMesCurto(l.venda) : "—"}</TableCell>
                  <TableCell className="num text-right">
                    {l.venda ? brl(l.mrrVendido) : "—"}
                  </TableCell>
                  <TableCell>{l.contrato ? rotuloMesCurto(l.contrato) : "—"}</TableCell>
                  <TableCell className="num text-right">
                    {l.contrato ? brl(l.mrrContratado) : "—"}
                  </TableCell>
                  <TableCell className="num text-right font-medium">
                    {l.mesesRec ? brl(l.recebido) : "—"}
                  </TableCell>
                  <TableCell className="num text-right">{l.mesesRec || "—"}</TableCell>
                  <TableCell>
                    <StatusBadge tom={SITUACOES[l.sit].tom}>{SITUACOES[l.sit].rotulo}</StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Secao>
  );
}

// ---------------------------------------------------------------- CAC

function VisaoCac({
  clientes,
  unidades,
  meses,
}: {
  clientes: ClienteCac[];
  unidades: UnidadeFunil[];
  meses: LinhaMes[];
}) {
  const porUnidade = useMemo(() => {
    const m = new Map<
      string,
      { clientes: number; cac: number; adiantado: number; recebido: number; pagaram: number }
    >();
    for (const c of clientes) {
      const s = m.get(c.unidade) ?? { clientes: 0, cac: 0, adiantado: 0, recebido: 0, pagaram: 0 };
      s.clientes += 1;
      s.cac += c.cacTotal;
      s.adiantado += c.cacAdiantado;
      s.recebido += c.recebido;
      if (c.recebido > 0) s.pagaram += 1;
      m.set(c.unidade, s);
    }
    return [...m.entries()].sort((a, b) => b[1].cac - a[1].cac);
  }, [clientes]);

  if (clientes.length === 0)
    return (
      <EstadoVazio
        titulo="Nenhum CAC cobrado neste recorte"
        descricao="O CAC aparece quando entra na apuração da unidade."
      />
    );

  const semFonte = new Set(
    unidades
      .filter((u) => !meses.some((l) => l.unidade === u.nome && l.recebido != null))
      .map((u) => u.nome),
  );
  const comFonte = clientes.filter((c) => !semFonte.has(c.unidade));
  const cacComFonte = comFonte.reduce((a, c) => a + c.cacTotal, 0);
  const recComFonte = comFonte.reduce((a, c) => a + c.recebido, 0);
  const cacTotal = clientes.reduce((a, c) => a + c.cacTotal, 0);
  const adiantado = clientes.reduce((a, c) => a + c.cacAdiantado, 0);
  const ordenados = [...clientes].sort(
    (a, b) => a.unidade.localeCompare(b.unidade) || b.cacTotal - a.cacTotal,
  );

  return (
    <>
      <Secao
        titulo="Quanto a unidade já pagou de CAC e quanto recebeu desses clientes?"
        descricao="CAC cobrado é o que entrou na apuração da unidade (parcela 1 é o adiantamento na assinatura, 2 depois do 1º honorário, integral numa linha só). O recebido é o que esses mesmos clientes já pagaram à unidade, casado por CNPJ e, sem CNPJ, pelo nome. Cobertura 1,0 = a unidade já recebeu desses clientes o mesmo que pagou de CAC."
      >
        <KpiGrade colunas={4}>
          <KpiCard
            rotulo="CAC cobrado"
            valor={brl(cacTotal)}
            nota={`${clientes.length} clientes`}
          />
          <KpiCard
            rotulo="Dos quais adiantado"
            valor={brl(adiantado)}
            nota="parcela 1, na assinatura"
          />
          <KpiCard
            rotulo="Recebido desses clientes"
            valor={brl(recComFonte)}
            nota={semFonte.size ? `sem ${[...semFonte].join(", ")} (sem fonte)` : "pago à unidade"}
          />
          <KpiCard
            rotulo="Cobertura"
            valor={razao(recComFonte, cacComFonte)}
            tom={cacComFonte > 0 && recComFonte < cacComFonte ? "atencao" : "sucesso"}
            tomRotulo={recComFonte < cacComFonte ? "abaixo do CAC" : "cobre o CAC"}
            nota="recebido ÷ CAC, nas unidades com fonte"
          />
        </KpiGrade>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-right">Clientes com CAC</TableHead>
                <TableHead className="text-right">CAC cobrado</TableHead>
                <TableHead className="text-right">Adiantado</TableHead>
                <TableHead className="text-right">Recebido desses clientes</TableHead>
                <TableHead className="text-right">Já pagaram</TableHead>
                <TableHead className="text-right">Cobertura</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porUnidade.map(([un, s]) => (
                <TableRow key={un}>
                  <TableCell className="font-medium">{un}</TableCell>
                  <TableCell className="num text-right">{s.clientes}</TableCell>
                  <TableCell className="num text-right">{brl(s.cac)}</TableCell>
                  <TableCell className="num text-right">{brl(s.adiantado)}</TableCell>
                  <TableCell className="num text-right">
                    {semFonte.has(un) ? "sem fonte" : brl(s.recebido)}
                  </TableCell>
                  <TableCell className="num text-right">
                    {semFonte.has(un) ? "—" : `${s.pagaram} de ${s.clientes}`}
                  </TableCell>
                  <TableCell className="num text-right font-semibold">
                    {semFonte.has(un) ? "—" : razao(s.recebido, s.cac)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Secao>

      <Secao titulo="Cliente a cliente">
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>1º CAC</TableHead>
                <TableHead className="text-right">Adiantado</TableHead>
                <TableHead className="text-right">2ª parcela</TableHead>
                <TableHead className="text-right">Integral</TableHead>
                <TableHead className="text-right">Sem parcela</TableHead>
                <TableHead className="text-right">CAC total</TableHead>
                <TableHead className="text-right">Recebido</TableHead>
                <TableHead className="text-right">Cobertura</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenados.map((c) => {
                const sem = semFonte.has(c.unidade);
                return (
                  <TableRow key={`${c.unidade}|${c.cnpj}|${c.cliente}`}>
                    <TableCell>{c.unidade}</TableCell>
                    <TableCell>
                      {c.cliente}
                      {c.cnpj && (
                        <span className="block text-xs text-muted-foreground">{c.cnpj}</span>
                      )}
                    </TableCell>
                    <TableCell>{rotuloMesCurto(c.primeiroCac)}</TableCell>
                    <TableCell className="num text-right">{brl(c.cacAdiantado || null)}</TableCell>
                    <TableCell className="num text-right">{brl(c.cacSegunda || null)}</TableCell>
                    <TableCell className="num text-right">{brl(c.cacIntegral || null)}</TableCell>
                    <TableCell className="num text-right">{brl(c.cacSemParcela || null)}</TableCell>
                    <TableCell className="num text-right font-medium">{brl(c.cacTotal)}</TableCell>
                    <TableCell className="num text-right">{sem ? "—" : brl(c.recebido)}</TableCell>
                    <TableCell className="num text-right">
                      {sem ? "—" : razao(c.recebido, c.cacTotal)}
                    </TableCell>
                    <TableCell>
                      {sem ? (
                        <StatusBadge tom="neutro">sem fonte</StatusBadge>
                      ) : c.recebido === 0 ? (
                        <StatusBadge tom="perigo">ainda não pagou</StatusBadge>
                      ) : c.recebido >= c.cacTotal ? (
                        <StatusBadge tom="sucesso">cobre o CAC</StatusBadge>
                      ) : (
                        <StatusBadge tom="atencao">pagando</StatusBadge>
                      )}
                      {!sem && c.casouPor === "nome" && (
                        <span className="block text-xs text-muted-foreground">
                          casado pelo nome
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Secao>
    </>
  );
}
