// Funil da Rede (/unidades/funil-rede). Contrato em
// docs/design/contratos/unidades-funil-rede.md. Três visões da mesma base, só
// unidades com split ativo: o funil da venda ao royalty, o gap entre o royalty
// que eu deveria ter recebido e o que recebi, e a conciliação de MRR cliente a
// cliente que explica o gap. Os números saem de `carregarFunilRede`.
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  carregarFunilRede,
  type CategoriaConc,
  type ClienteConc,
  type FunilRede,
  type LinhaFunil,
  type LinhaGap,
} from "@/lib/funil-rede.functions";

const brl = (v: number | null | undefined) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      });
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const data = (d: string | null) =>
  d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("pt-BR") : "—";

const CANAIS = ["Hunter", "Inside Sales", "Sem venda registrada"] as const;

const TOM_CATEGORIA: Record<CategoriaConc, TomStatus> = {
  "Churn não baixado no Pipedrive": "perigo",
  "Venda duplicada (provável)": "perigo",
  "Sem faturamento": "perigo",
  "Parou de faturar": "atencao",
  "Venda recente, ainda não faturou": "info",
  "Fatura menos que o MRR": "atencao",
  "Fatura mais que o MRR": "info",
  "OK (±20%)": "sucesso",
  "Mesmo cliente, CNPJ não casou": "atencao",
  "Cliente a mais no Omie": "neutro",
  "Omie da unidade ainda não cobre o mês": "neutro",
};
const ORDEM_CATEGORIA = Object.keys(TOM_CATEGORIA) as CategoriaConc[];

function somar<T>(linhas: T[], campos: (keyof T)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of campos) out[c as string] = linhas.reduce((a, l) => a + Number(l[c] ?? 0), 0);
  return out;
}

/** Barra horizontal proporcional: o "desenho" do funil e do gap. */
function Barra({
  valor,
  maximo,
  tom = "primario",
}: {
  valor: number;
  maximo: number;
  tom?: "primario" | "perigo" | "neutro";
}) {
  const largura = maximo > 0 ? Math.max(0, Math.min(100, (valor / maximo) * 100)) : 0;
  const cor =
    tom === "perigo"
      ? "bg-destructive"
      : tom === "neutro"
        ? "bg-muted-foreground/40"
        : "bg-primary";
  return (
    <div className="h-2.5 w-full rounded-full bg-muted">
      <div className={`h-2.5 rounded-full ${cor}`} style={{ width: `${largura}%` }} />
    </div>
  );
}

export function FunilRedeContent() {
  const buscar = useServerFn(carregarFunilRede);
  const [base, setBase] = useState<FunilRede | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  const [visao, setVisao] = useFiltroNaUrl("visao", "funil");
  const [unidade, setUnidade] = useFiltroNaUrl("unidade", "todas");
  const [canal, setCanal] = useFiltroNaUrl("canal", "todos");
  const [situacao, setSituacao] = useFiltroNaUrl("situacao", "recebido");
  const [de, setDe] = useFiltroNaUrl("de", "");
  const [ate, setAte] = useFiltroNaUrl("ate", "");
  const [categoria, setCategoria] = useFiltroNaUrl("categoria", "todas");
  // Safra (mês da venda) × fato (mês em que cada etapa aconteceu).
  const [regua, setRegua] = useFiltroNaUrl("regua", "safra");
  // Meses que a venda tem para começar a faturar antes de virar gap.
  const [carencia, setCarencia] = useFiltroNaUrl("carencia", "1");
  const limpar = useLimparFiltrosNaUrl([
    "unidade",
    "canal",
    "situacao",
    "de",
    "ate",
    "categoria",
    "regua",
    "carencia",
  ]);

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

  const meses = useMemo(() => {
    const s = new Set<string>();
    for (const l of base?.funil ?? []) s.add(l.mes);
    for (const l of base?.funilSafra ?? []) s.add(l.mes);
    for (const l of base?.gap ?? []) s.add(l.mes);
    return [...s].sort();
  }, [base]);
  const deEf = meses.includes(de) ? de : meses[0];
  const ateEf = meses.includes(ate) ? ate : meses[meses.length - 1];
  const noPeriodo = (m: string) => (!deEf || m >= deEf) && (!ateEf || m <= ateEf);
  const passa = (l: { unidade: string; canal: string; mes?: string }) =>
    (unidade === "todas" || l.unidade === unidade) &&
    (canal === "todos" || l.canal === canal) &&
    (!l.mes || noPeriodo(l.mes));

  if (erro) {
    return (
      <div className="px-4 py-6 md:px-6">
        <ErroDaConsulta
          erro={erro}
          chaves="view.royalties_split"
          titulo="Não foi possível montar o funil da rede"
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
          titulo="Nenhuma unidade com split ativo"
          descricao="A unidade entra aqui sozinha quando unidades.split_ativo_desde for preenchida."
        />
      </div>
    );
  }

  const temFiltro =
    unidade !== "todas" ||
    canal !== "todos" ||
    situacao !== "recebido" ||
    de !== "" ||
    ate !== "" ||
    categoria !== "todas" ||
    regua !== "safra" ||
    carencia !== "1";

  return (
    <div className="space-y-6 px-4 py-6 md:px-6">
      <Tabs value={visao} onValueChange={setVisao}>
        <TabsList>
          <TabsTrigger value="funil">Funil</TabsTrigger>
          <TabsTrigger value="gap">Gap de royalty</TabsTrigger>
          <TabsTrigger value="conciliacao">Conciliação de MRR</TabsTrigger>
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
        <Select value={canal} onValueChange={setCanal}>
          <SelectTrigger className="w-[210px]" aria-label="Canal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Hunter + Inside Sales</SelectItem>
            {CANAIS.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {visao !== "conciliacao" && meses.length > 0 && (
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
        {visao === "funil" && (
          <Select value={regua} onValueChange={setRegua}>
            <SelectTrigger className="w-[200px]" aria-label="Régua do período">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="safra">Safra (mês da venda)</SelectItem>
              <SelectItem value="fato">Fato (mês do evento)</SelectItem>
            </SelectContent>
          </Select>
        )}
        {visao === "gap" && (
          <Select value={carencia} onValueChange={setCarencia}>
            <SelectTrigger className="w-[230px]" aria-label="Carência da venda">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Sem carência</SelectItem>
              <SelectItem value="1">Carência de 1 mês após a venda</SelectItem>
              <SelectItem value="2">Carência de 2 meses após a venda</SelectItem>
            </SelectContent>
          </Select>
        )}
        {visao === "funil" && (
          <Select value={situacao} onValueChange={setSituacao}>
            <SelectTrigger className="w-[160px]" aria-label="Situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recebido">Recebido</SelectItem>
              <SelectItem value="a_receber">A receber</SelectItem>
            </SelectContent>
          </Select>
        )}
        {visao === "conciliacao" && (
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger className="w-[280px]" aria-label="Categoria">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as categorias</SelectItem>
              {ORDEM_CATEGORIA.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </BarraFiltros>

      <p className="text-[13px] text-muted-foreground">
        {base.unidades
          .map((u) => `${u.nome} desde ${data(u.splitDesde)} (${u.percentual}%)`)
          .join(" · ")}
      </p>

      {visao === "funil" && (
        <VisaoFunil
          linhas={(regua === "fato" ? base.funil : base.funilSafra).filter(passa)}
          aReceber={situacao === "a_receber"}
          canal={canal}
          safra={regua !== "fato"}
        />
      )}
      {visao === "gap" && (
        <VisaoGap
          linhas={base.gap.filter(passa)}
          carencia={Number(carencia) || 0}
          irParaConciliacao={() => setVisao("conciliacao")}
        />
      )}
      {visao === "conciliacao" && (
        <VisaoConciliacao
          clientes={base.conciliacao.filter((c) => passa(c))}
          categoria={categoria}
          setCategoria={setCategoria}
          mesReferencia={base.mesReferencia}
        />
      )}

      {base.splitsSemTitulo.length > 0 && (
        <p className="max-w-3xl text-xs text-muted-foreground">
          Fora destes números: split do Asaas sem título no Omie,{" "}
          {base.splitsSemTitulo
            .map(
              (o) =>
                `${o.unidade} ${brl(o.creditado)} creditado${o.aCreditar ? ` e ${brl(o.aCreditar)} a creditar` : ""}`,
            )
            .join("; ")}
          . Aparece no Split do Asaas.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- funil

function VisaoFunil({
  linhas,
  aReceber,
  canal,
  safra,
}: {
  linhas: LinhaFunil[];
  aReceber: boolean;
  canal: string;
  safra: boolean;
}) {
  const t = somar(linhas, [
    "vendas",
    "mrrVendido",
    "contratos",
    "mrrContratado",
    "titulos",
    "faturado",
    "recebido",
    "aReceber",
    "atrasado",
    "royaltyRecebido",
    "royaltyAReceber",
    "royaltyPerdido",
    "cliVendidos",
    "cliContrato",
    "cliFaturado",
    "cliPago",
    "cliRoyalty",
    "cliRoyaltyAReceber",
  ]);
  // Conversão: na safra, clientes que passaram da etapa anterior para esta (os
  // mesmos clientes). No fato não existe conversão, só a razão de valores.
  type Etapa = { rotulo: string; valor: number; nota: string; conv?: string; convNota?: string };
  const etapas: Etapa[] = [
    {
      rotulo: "1. Vendas",
      valor: t.mrrVendido,
      nota: safra
        ? `${t.cliVendidos} clientes · ${t.vendas} vendas`
        : `${t.vendas} vendas · MRR vendido`,
      conv: safra ? `${t.cliVendidos} clientes` : undefined,
    },
    {
      rotulo: "2. Contratos",
      valor: t.mrrContratado,
      nota: safra
        ? `${t.cliContrato} clientes · MRR contratado`
        : `${t.contratos} contratos · MRR contratado`,
      conv: safra ? pct(t.cliContrato, t.cliVendidos) : pct(t.mrrContratado, t.mrrVendido),
      convNota: safra ? `${t.cliContrato} de ${t.cliVendidos} clientes` : "do MRR vendido",
    },
    {
      rotulo: "3. Faturado",
      valor: t.faturado,
      nota: safra
        ? `${t.cliFaturado} clientes · ${t.titulos} boletos`
        : `${t.titulos} boletos no Omie`,
      conv: safra ? pct(t.cliFaturado, t.cliContrato) : undefined,
      convNota: safra
        ? `${t.cliFaturado} de ${t.cliContrato} clientes`
        : "outra régua: boletos × MRR",
    },
    aReceber
      ? {
          rotulo: "4. A receber",
          valor: t.aReceber,
          nota: `dos quais ${brl(t.atrasado)} em atraso`,
          conv: pct(t.aReceber, t.faturado),
          convNota: "do faturado",
        }
      : {
          rotulo: "4. Recebido",
          valor: t.recebido,
          nota: safra
            ? `${t.cliPago} clientes pagaram`
            : `${pct(t.recebido, t.faturado)} do faturado`,
          conv: safra ? pct(t.cliPago, t.cliFaturado) : pct(t.recebido, t.faturado),
          convNota: safra
            ? `${t.cliPago} de ${t.cliFaturado} clientes · ${pct(t.recebido, t.faturado)} do valor`
            : "do faturado",
        },
    aReceber
      ? {
          rotulo: "5. Royalty a receber",
          valor: t.royaltyAReceber,
          nota: "split armado, ainda não creditado",
          conv: safra ? pct(t.cliRoyaltyAReceber, t.cliFaturado) : undefined,
          convNota: safra
            ? `${t.cliRoyaltyAReceber} de ${t.cliFaturado} clientes com split armado`
            : undefined,
        }
      : {
          rotulo: "5. Royalty recebido",
          valor: t.royaltyRecebido,
          nota: `${pct(t.royaltyRecebido, t.recebido)} do recebido`,
          conv: safra ? pct(t.cliRoyalty, t.cliPago) : pct(t.royaltyRecebido, t.recebido),
          convNota: safra ? `${t.cliRoyalty} de ${t.cliPago} clientes que pagaram` : "do recebido",
        },
  ];
  const maximo = Math.max(...etapas.map((e) => e.valor), 1);
  const ponta = safra ? pct(t.cliRoyalty, t.cliVendidos) : null;

  const porMes = useMemo(() => {
    const m = new Map<string, LinhaFunil[]>();
    for (const l of linhas) m.set(l.mes, [...(m.get(l.mes) ?? []), l]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [linhas]);

  if (linhas.length === 0)
    return (
      <EstadoVazio
        titulo="Nada neste recorte"
        descricao="Troque a unidade, o canal ou o período."
      />
    );

  return (
    <>
      <Secao
        titulo="Da venda ao royalty, quanto passou em cada etapa?"
        descricao={
          safra
            ? "Safra: cada cliente fica no mês da primeira venda e leva junto contrato, boletos e royalty de qualquer mês depois. A conversão conta os mesmos clientes de uma etapa para a outra. Safra recente ainda está amadurecendo: a venda leva em média 39 dias até o primeiro boleto."
            : "Fato: cada etapa conta o que aconteceu no mês, não os mesmos clientes; a razão entre etapas não é conversão. Faturado, recebido e royalty pelo vencimento do boleto; só a partir da data do split de cada unidade."
        }
      >
        <KpiGrade colunas={6}>
          {etapas.map((e) => (
            <KpiCard key={e.rotulo} rotulo={e.rotulo} valor={brl(e.valor)} nota={e.nota} />
          ))}
          <KpiCard
            rotulo="Pago sem reter royalty"
            valor={brl(t.royaltyPerdido)}
            tom={t.royaltyPerdido > 0 ? "perigo" : undefined}
            tomRotulo={t.royaltyPerdido > 0 ? "royalty perdido" : undefined}
            nota="boleto pago sem split"
          />
        </KpiGrade>
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="grid grid-cols-[140px_1fr_110px_190px] gap-3 text-xs text-muted-foreground">
            <span>Etapa</span>
            <span />
            <span className="text-right">Valor</span>
            <span className="text-right">
              {safra ? "Conversão (clientes)" : "÷ etapa anterior"}
            </span>
          </div>
          {etapas.map((e) => (
            <div
              key={e.rotulo}
              className="grid grid-cols-[140px_1fr_110px_190px] items-center gap-3 text-[13px]"
            >
              <span className="text-muted-foreground">{e.rotulo}</span>
              <Barra valor={e.valor} maximo={maximo} />
              <span className="num text-right font-medium">{brl(e.valor)}</span>
              <span className="text-right">
                <span className="num font-semibold">{e.conv ?? "—"}</span>
                {e.convNota && (
                  <span className="block text-xs text-muted-foreground">{e.convNota}</span>
                )}
              </span>
            </div>
          ))}
          {ponta && (
            <p className="border-t pt-3 text-[13px]">
              <span className="num font-semibold">{ponta}</span>{" "}
              <span className="text-muted-foreground">
                dos clientes vendidos já geraram royalty ({t.cliRoyalty} de {t.cliVendidos}).
              </span>
            </p>
          )}
        </div>
        {canal === "Hunter" && (
          <p className="text-xs text-muted-foreground">
            A venda do pipe Sócios não tem data de assinatura; no Hunter, contrato é o primeiro
            boleto do cliente no Omie.
          </p>
        )}
      </Secao>

      <Secao
        titulo={safra ? "Safra a safra" : "Mês a mês"}
        descricao={
          safra
            ? "Cada linha é o mês da venda. As colunas de % são conversão de clientes sobre a etapa anterior."
            : "Mesmas etapas por mês em que aconteceram (boletos pelo vencimento)."
        }
      >
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{safra ? "Safra" : "Mês"}</TableHead>
                <TableHead className="text-right">{safra ? "Clientes" : "Vendas"}</TableHead>
                <TableHead className="text-right">MRR vendido</TableHead>
                <TableHead className="text-right">Contratos</TableHead>
                <TableHead className="text-right">Faturado</TableHead>
                <TableHead className="text-right">{aReceber ? "A receber" : "Recebido"}</TableHead>
                <TableHead className="text-right">
                  {aReceber ? "Royalty a receber" : "Royalty recebido"}
                </TableHead>
                <TableHead className="text-right">Pago sem royalty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porMes.map(([mes, ls]) => {
                const s = somar(ls, [
                  "vendas",
                  "mrrVendido",
                  "contratos",
                  "faturado",
                  "recebido",
                  "aReceber",
                  "royaltyRecebido",
                  "royaltyAReceber",
                  "royaltyPerdido",
                  "cliVendidos",
                  "cliContrato",
                  "cliFaturado",
                  "cliPago",
                  "cliRoyalty",
                ]);
                const sub = (txt: string) => (
                  <span className="block text-xs text-muted-foreground">{txt}</span>
                );
                return (
                  <TableRow key={mes}>
                    <TableCell>{rotuloMesCurto(mes)}</TableCell>
                    <TableCell className="num text-right">
                      {safra ? s.cliVendidos : s.vendas}
                    </TableCell>
                    <TableCell className="num text-right">{brl(s.mrrVendido)}</TableCell>
                    <TableCell className="num text-right">
                      {safra ? s.cliContrato : s.contratos}
                      {safra && sub(pct(s.cliContrato, s.cliVendidos))}
                    </TableCell>
                    <TableCell className="num text-right">
                      {brl(s.faturado)}
                      {safra && sub(`${pct(s.cliFaturado, s.cliContrato)} · ${s.cliFaturado} cli.`)}
                    </TableCell>
                    <TableCell className="num text-right">
                      {brl(aReceber ? s.aReceber : s.recebido)}
                      {safra &&
                        !aReceber &&
                        sub(`${pct(s.cliPago, s.cliFaturado)} · ${s.cliPago} cli.`)}
                    </TableCell>
                    <TableCell className="num text-right">
                      {brl(aReceber ? s.royaltyAReceber : s.royaltyRecebido)}
                      {safra &&
                        !aReceber &&
                        sub(`${pct(s.cliRoyalty, s.cliPago)} · ${s.cliRoyalty} cli.`)}
                    </TableCell>
                    <TableCell
                      className={`num text-right ${s.royaltyPerdido > 0 ? "text-danger" : "text-muted-foreground"}`}
                    >
                      {s.royaltyPerdido > 0 ? brl(s.royaltyPerdido) : "—"}
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

// ---------------------------------------------------------------- gap

type LinhaGapAjustada = LinhaGap & { emImplantacao: number };

function VisaoGap({
  linhas: brutas,
  carencia,
  irParaConciliacao,
}: {
  linhas: LinhaGap[];
  carencia: number;
  irParaConciliacao: () => void;
}) {
  // Carência: a venda leva em média 39 dias até o primeiro boleto. Nos meses
  // dentro da carência, o que faltou de contrato, faturamento ou cadastro não é
  // gap ainda, é implantação. Inadimplência, split e recebido seguem iguais.
  const linhas: LinhaGapAjustada[] = useMemo(
    () =>
      brutas.map((l) =>
        l.idade >= 0 && l.idade < carencia
          ? {
              ...l,
              emImplantacao: l.gapCadastro + l.gapContrato + l.gapFaturamento,
              gapCadastro: 0,
              gapContrato: 0,
              gapFaturamento: 0,
            }
          : { ...l, emImplantacao: 0 },
      ),
    [brutas, carencia],
  );
  const CAMPOS: (keyof LinhaGapAjustada)[] = [
    "potencial",
    "emImplantacao",
    "gapCadastro",
    "gapContrato",
    "gapFaturamento",
    "gapInadimplencia",
    "gapSplit",
    "noPrazo",
    "royaltyRecebido",
    "royaltyACreditar",
    "extra",
    "taxa",
  ];
  const t = somar(linhas, CAMPOS);
  const recebido = t.royaltyRecebido + t.royaltyACreditar;
  const gaps = [
    { rotulo: "Cadastro (churn não baixado, venda duplicada)", valor: t.gapCadastro, conc: true },
    { rotulo: "Contrato (vendido e não operando)", valor: t.gapContrato },
    { rotulo: "Faturamento (faturou menos que o MRR)", valor: t.gapFaturamento, conc: true },
    { rotulo: "Inadimplência (vencido e não pago)", valor: t.gapInadimplencia },
    { rotulo: "Split (pago sem reter royalty)", valor: t.gapSplit },
  ];
  const maior = [...gaps].sort((a, b) => b.valor - a.valor)[0];
  const maximo = Math.max(t.potencial, 1);

  const porUnidade = useMemo(() => {
    const m = new Map<string, LinhaGapAjustada[]>();
    for (const l of linhas) m.set(l.unidade, [...(m.get(l.unidade) ?? []), l]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [linhas]);

  if (linhas.length === 0) {
    return (
      <EstadoVazio
        titulo="Sem mês inteiro com split neste recorte"
        descricao="O gap só conta meses em que o split ficou ativo o mês todo."
      />
    );
  }

  return (
    <>
      <Secao
        titulo="Quanto eu deveria ter recebido de royalty, e onde ficou a diferença?"
        descricao="Potencial = MRR das vendas ativas × % de royalty da unidade, só em meses inteiros com split. Cada gap é a parte do potencial que parou numa etapa. O mês corrente ainda está aberto."
      >
        <KpiGrade>
          <KpiCard
            rotulo="Royalty potencial"
            valor={brl(t.potencial)}
            nota="MRR vendido ativo × %"
          />
          <KpiCard
            rotulo="Recebido + a creditar"
            valor={brl(recebido)}
            nota={`${pct(recebido, t.potencial)} do potencial`}
          />
          <KpiCard
            rotulo="Maior gap"
            valor={brl(maior.valor)}
            tom={maior.valor > 0 ? "perigo" : undefined}
            nota={maior.rotulo}
            abrir={maior.conc ? { onClick: irParaConciliacao, rotulo: "Ver clientes" } : undefined}
          />
          <KpiCard rotulo="A vencer (no prazo)" valor={brl(t.noPrazo)} nota="ainda não é gap" />
        </KpiGrade>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <LinhaCascata rotulo="Royalty potencial" valor={t.potencial} maximo={maximo} />
          {gaps.map((gp) => (
            <LinhaCascata
              key={gp.rotulo}
              rotulo={`− ${gp.rotulo}`}
              valor={gp.valor}
              maximo={maximo}
              tom="perigo"
              acao={gp.conc && gp.valor > 0 ? irParaConciliacao : undefined}
            />
          ))}
          {carencia > 0 && (
            <LinhaCascata
              rotulo={`− Em implantação (carência de ${carencia} ${carencia === 1 ? "mês" : "meses"} da venda)`}
              valor={t.emImplantacao}
              maximo={maximo}
              tom="neutro"
            />
          )}
          <LinhaCascata
            rotulo="− A vencer (no prazo)"
            valor={t.noPrazo}
            maximo={maximo}
            tom="neutro"
          />
          <LinhaCascata
            rotulo="− Taxa do gateway (o split incide sobre o líquido)"
            valor={t.taxa}
            maximo={maximo}
            tom="neutro"
          />
          <LinhaCascata
            rotulo="+ Extra (faturou acima do MRR ou sem venda)"
            valor={t.extra}
            maximo={maximo}
            tom="neutro"
          />
          <LinhaCascata
            rotulo="= Royalty recebido + a creditar"
            valor={recebido}
            maximo={maximo}
            destaque
          />
        </div>
      </Secao>

      <Secao titulo="Por unidade" descricao="O mesmo cálculo, unidade a unidade.">
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-right">Potencial</TableHead>
                <TableHead className="text-right">Cadastro</TableHead>
                <TableHead className="text-right">Contrato</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">Inadimplência</TableHead>
                <TableHead className="text-right">Split</TableHead>
                <TableHead className="text-right">Implantação</TableHead>
                <TableHead className="text-right">A vencer</TableHead>
                <TableHead className="text-right">Recebido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porUnidade.map(([un, ls]) => {
                const s = somar(ls, CAMPOS);
                return (
                  <TableRow key={un}>
                    <TableCell className="font-medium">{un}</TableCell>
                    <TableCell className="num text-right">{brl(s.potencial)}</TableCell>
                    <TableCell className="num text-right">{brl(s.gapCadastro)}</TableCell>
                    <TableCell className="num text-right">{brl(s.gapContrato)}</TableCell>
                    <TableCell className="num text-right">{brl(s.gapFaturamento)}</TableCell>
                    <TableCell className="num text-right">{brl(s.gapInadimplencia)}</TableCell>
                    <TableCell className={`num text-right ${s.gapSplit > 0 ? "text-danger" : ""}`}>
                      {brl(s.gapSplit)}
                    </TableCell>
                    <TableCell className="num text-right text-muted-foreground">
                      {brl(s.emImplantacao)}
                    </TableCell>
                    <TableCell className="num text-right text-muted-foreground">
                      {brl(s.noPrazo)}
                    </TableCell>
                    <TableCell className="num text-right font-medium">
                      {brl(s.royaltyRecebido + s.royaltyACreditar)}
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

function LinhaCascata({
  rotulo,
  valor,
  maximo,
  tom,
  destaque,
  acao,
}: {
  rotulo: string;
  valor: number;
  maximo: number;
  tom?: "perigo" | "neutro";
  destaque?: boolean;
  acao?: () => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,320px)_1fr_110px] items-center gap-3 text-[13px]">
      {acao ? (
        <button
          type="button"
          onClick={acao}
          className="text-left text-muted-foreground underline-offset-2 hover:underline"
        >
          {rotulo}
        </button>
      ) : (
        <span className={destaque ? "font-medium" : "text-muted-foreground"}>{rotulo}</span>
      )}
      <Barra valor={valor} maximo={maximo} tom={tom} />
      <span className={`num text-right ${destaque ? "font-semibold" : ""}`}>{brl(valor)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- conciliação

function VisaoConciliacao({
  clientes,
  categoria,
  setCategoria,
  mesReferencia,
}: {
  clientes: ClienteConc[];
  categoria: string;
  setCategoria: (v: string) => void;
  mesReferencia: string;
}) {
  const resumo = useMemo(() => {
    const m = new Map<CategoriaConc, { n: number; mrr: number; fat: number }>();
    for (const c of clientes) {
      const r = m.get(c.categoria) ?? { n: 0, mrr: 0, fat: 0 };
      r.n += 1;
      r.mrr += c.mrrPipedrive;
      r.fat += c.faturadoRef;
      m.set(c.categoria, r);
    }
    return ORDEM_CATEGORIA.filter((c) => m.has(c)).map((c) => ({ categoria: c, ...m.get(c)! }));
  }, [clientes]);
  const totMrr = resumo.reduce((a, r) => a + r.mrr, 0);
  const totFat = resumo.reduce((a, r) => a + r.fat, 0);
  const lista = clientes
    .filter((c) => categoria === "todas" || c.categoria === categoria)
    .sort(
      (a, b) =>
        ORDEM_CATEGORIA.indexOf(a.categoria) - ORDEM_CATEGORIA.indexOf(b.categoria) ||
        Math.abs(b.faturadoRef - b.mrrPipedrive) - Math.abs(a.faturadoRef - a.mrrPipedrive),
    );

  if (clientes.length === 0) return <EstadoVazio titulo="Nenhum cliente neste recorte" />;

  return (
    <>
      <Secao
        titulo={`Por que o MRR do Pipedrive não bate com o faturado de ${rotuloMesCurto(mesReferencia)}?`}
        descricao={`Cliente a cliente: MRR das vendas ativas (Pipedrive) contra o faturado no Omie com vencimento em ${rotuloMesCurto(mesReferencia)}, último mês fechado. Tolerância de 20%. Contratos e boletos que dividem CNPJ são um cliente só.`}
      >
        <KpiGrade>
          <KpiCard
            rotulo="MRR ativo no Pipedrive"
            valor={brl(totMrr)}
            nota={`${clientes.filter((c) => c.contratos > 0).length} clientes com venda ativa`}
          />
          <KpiCard
            rotulo={`Faturado em ${rotuloMesCurto(mesReferencia)}`}
            valor={brl(totFat)}
            nota={`${pct(totFat, totMrr)} do MRR`}
          />
          <KpiCard
            rotulo="Diferença"
            valor={brl(totFat - totMrr)}
            tom={totFat < totMrr * 0.8 ? "atencao" : undefined}
            nota="faturado − MRR"
          />
        </KpiGrade>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Clientes</TableHead>
                <TableHead className="text-right">MRR Pipedrive</TableHead>
                <TableHead className="text-right">Faturado</TableHead>
                <TableHead className="text-right">Diferença</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resumo.map((r) => (
                <TableRow
                  key={r.categoria}
                  className="cursor-pointer"
                  onClick={() => setCategoria(r.categoria === categoria ? "todas" : r.categoria)}
                >
                  <TableCell>
                    <StatusBadge tom={TOM_CATEGORIA[r.categoria]}>{r.categoria}</StatusBadge>
                  </TableCell>
                  <TableCell className="num text-right">{r.n}</TableCell>
                  <TableCell className="num text-right">{brl(r.mrr)}</TableCell>
                  <TableCell className="num text-right">{brl(r.fat)}</TableCell>
                  <TableCell className="num text-right">{brl(r.fat - r.mrr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Secao>

      <Secao
        titulo="Cliente a cliente"
        descricao={`${lista.length} clientes${categoria !== "todas" ? ` em "${categoria}"` : ""}. Clique numa categoria acima para filtrar. Antes de baixar churn ou cancelar venda, conferir o cliente: o vínculo por nome é heurístico.`}
      >
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">MRR Pipedrive</TableHead>
                <TableHead className="text-right">MRR Pipefy</TableHead>
                <TableHead className="text-right">
                  Faturado {rotuloMesCurto(mesReferencia)}
                </TableHead>
                <TableHead className="text-right">Média 3 meses</TableHead>
                <TableHead>Último boleto</TableHead>
                <TableHead>Por quê</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((c) => (
                <TableRow key={c.chave}>
                  <TableCell className="max-w-[280px]">
                    <div className="truncate font-medium">{c.cliente}</div>
                    <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span>{c.unidade}</span>
                      <span>{c.canal}</span>
                      {c.contratos > 1 && <span>{c.contratos} contratos</span>}
                      {c.deals.length > 0 && (
                        <span className="font-mono">deal {c.deals.join(", ")}</span>
                      )}
                      {c.ganhoEm && <span>ganho {data(c.ganhoEm)}</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tom={TOM_CATEGORIA[c.categoria]}>{c.categoria}</StatusBadge>
                  </TableCell>
                  <TableCell className="num text-right">
                    {c.contratos ? brl(c.mrrPipedrive) : "—"}
                  </TableCell>
                  <TableCell className="num text-right text-muted-foreground">
                    {brl(c.mrrPipefy)}
                  </TableCell>
                  <TableCell className="num text-right">{brl(c.faturadoRef)}</TableCell>
                  <TableCell className="num text-right text-muted-foreground">
                    {brl(c.faturadoMedia3)}
                  </TableCell>
                  <TableCell className="num whitespace-nowrap text-xs">
                    {data(c.ultimoVencimento)}
                  </TableCell>
                  <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                    {[
                      (c.churnEm || c.motivoChurn) &&
                        `Churn na Central de Tratativas${c.churnEm ? ` em ${data(c.churnEm)}` : ""}${c.motivoChurn ? `: ${c.motivoChurn}` : ""}`,
                      c.fasesPipefy.length ? `Pipefy: ${c.fasesPipefy.join(", ")}` : null,
                      c.observacao,
                      c.atrasado > 0 ? `${brl(c.atrasado)} em atraso` : null,
                      c.vinculo && c.vinculo !== "cnpj" ? `vínculo: ${c.vinculo}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Secao>
    </>
  );
}
