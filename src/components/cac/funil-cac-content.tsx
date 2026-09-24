// Funil de CAC: da venda ganha até a cobrança concluída.
//
// Por que existe: a conciliação de 18/09/2026 entre o BI de vendas e o pipe
// "Cobrança CAC" mostrou que cada sistema conhecia um pedaço do caminho, e o
// buraco vivia entre eles. Um terço dos cards estava sem o 1º honorário, e o
// pipe dizia que faltava cobrar R$ 23 mil quando faltavam R$ 170 mil.
//
// O grão é a VENDA, não o card: card sozinho esconde a venda assinada que nunca
// virou cobrança, que é o vazamento mais caro. Cards órfãos aparecem como
// etapa própria em vez de sumir. Fonte: ops.v_cac_funil (migration
// 20260918200000).
//
// DS v2 (contrato `docs/design/contratos/receita-e-repasses.md` §6): um nome só
// para cada número (N11: "Cobrado", "A cobrar"), filtros na URL (N7) e erro de
// qualquer das duas views vira `EstadoErro`, não card zerado nem lista vazia.
import { useEffect, useMemo, useState } from "react";
import { OctagonAlert } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  BarraFiltros,
  Carregando,
  ChipFiltro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
} from "@/components/planning";
import { ErroDaConsulta } from "@/components/receita/moldura";
import { CORES_SERIE } from "@/lib/planning/grafico";
import { useFiltroNaUrl, useLimparFiltrosNaUrl } from "@/lib/planning/filtro-url";
import { cn } from "@/lib/utils";

type Linha = {
  unidade_id: number;
  unidade: string;
  paga_cac: boolean;
  contrato_id: number | null;
  cliente: string | null;
  ganho_em: string | null;
  mrr_mensal: number | null;
  status_contrato: string | null;
  fase_contrato: string | null;
  data_assinatura: string | null;
  cac_card_id: string | null;
  fase_cac: string | null;
  unidade_card: string | null;
  elegivel: boolean;
  honorario: number | null;
  cobrado: number | null;
  data_cobranca_p1: string | null;
  data_cobranca_p2: string | null;
  assinado: boolean;
  churn: boolean;
  churn_origem: string | null;
  etapa: string;
  a_cobrar: number | null;
};

type Resumo = {
  unidade_id: number;
  unidade: string;
  paga_cac: boolean;
  cac_desde: string | null;
  cac_honorario_minimo_mensal: number | null;
  vendas: number;
  elegiveis: number;
  fora_da_regua: number;
  assinadas: number;
  com_card: number;
  assinadas_sem_card: number;
  card_em_outra_unidade: number;
  churn_sem_cobranca: number;
  sem_honorario: number;
  sem_cobranca: number;
  parciais: number;
  concluidas: number;
  cards_orfaos: number;
  churns: number;
  churn_cobrado: number;
  churn_a_cobrar: number;
  honorario: number;
  cobrado: number;
  a_cobrar: number;
};

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

/**
 * Valor de CAC de uma linha, para o funil descer em dinheiro e não só em
 * contagem. Depois que o card existe, vale o 1º honorário lançado nele. Antes
 * disso não há card nenhum, e o melhor proxy é o honorário mensal da venda
 * (`mrr_mensal`): nos 81 casos em que os dois existem, 68 batem no centavo e o
 * total difere 1,2%. Sem o proxy, os dois primeiros degraus apareceriam
 * zerados, que é pior que aproximado.
 */
function cacEsperado(r: Linha): number {
  return Number(r.honorario ?? r.mrr_mensal ?? 0);
}

const ETAPAS: { chave: string; rotulo: string; acao: boolean }[] = [
  { chave: "fora_da_regua", rotulo: "Fora da régua de CAC", acao: false },
  { chave: "sem_contrato", rotulo: "Venda sem contrato aberto", acao: false },
  { chave: "contrato_em_andamento", rotulo: "Contrato em andamento", acao: false },
  { chave: "assinado_sem_card", rotulo: "Assinado, sem card de CAC", acao: true },
  { chave: "card_sem_honorario", rotulo: "Card sem 1º honorário", acao: true },
  { chave: "card_sem_cobranca", rotulo: "Card sem cobrança lançada", acao: false },
  { chave: "cobranca_parcial", rotulo: "Cobrança parcial", acao: false },
  { chave: "cobranca_concluida", rotulo: "Cobrança concluída", acao: false },
  { chave: "card_sem_venda", rotulo: "Card sem venda no Ops", acao: true },
  { chave: "card_em_outra_unidade", rotulo: "Card aberto na unidade errada", acao: true },
  { chave: "churn_sem_cobranca", rotulo: "Churn antes de abrir cobrança", acao: false },
];
const ROTULO = new Map(ETAPAS.map((e) => [e.chave, e.rotulo]));
const EXIGE_ACAO = new Set(ETAPAS.filter((e) => e.acao).map((e) => e.chave));

export function FunilCacContent() {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [erroResumo, setErroResumo] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [resumo, setResumo] = useState<Resumo[]>([]);
  const [unidade, setUnidade] = useFiltroNaUrl("unidade", "todas");
  const [etapaFiltro, setEtapaFiltro] = useFiltroNaUrl("etapa", "todas");
  const [soChurn, setSoChurn] = useFiltroNaUrl("churn", false);
  const limparFiltros = useLimparFiltrosNaUrl(["unidade", "etapa", "churn"]);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    (async () => {
      const [l, s] = await Promise.all([
        (supabase as any).from("v_cac_funil").select("*"),
        (supabase as any).from("v_cac_funil_resumo").select("*"),
      ]);
      if (!vivo) return;
      setErro(l.error ? l.error.message : null);
      setErroResumo(s.error ? s.error.message : null);
      setLinhas((l.data ?? []) as Linha[]);
      setResumo((s.data ?? []) as Resumo[]);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, [tentativa]);

  const tentarDeNovo = () => setTentativa((n) => n + 1);

  // Sem o resumo, as unidades do seletor vêm das linhas: o filtro continua
  // servindo ao funil e à lista de vendas.
  const unidades = useMemo(
    () => [...new Set((erroResumo ? linhas : resumo).map((r) => r.unidade))].sort(),
    [resumo, linhas, erroResumo],
  );

  const daUnidade = useMemo(
    () => linhas.filter((r) => unidade === "todas" || r.unidade === unidade),
    [linhas, unidade],
  );
  const filtradas = useMemo(
    () => daUnidade
      .filter((r) => (etapaFiltro === "todas" || r.etapa === etapaFiltro) && (!soChurn || r.churn))
      .sort((a, b) => Number(b.a_cobrar ?? 0) - Number(a.a_cobrar ?? 0)
        || (b.ganho_em ?? "").localeCompare(a.ganho_em ?? "")),
    [daUnidade, etapaFiltro, soChurn],
  );
  const resumoFiltrado = useMemo(
    () => resumo.filter((r) => unidade === "todas" || r.unidade === unidade),
    [resumo, unidade],
  );

  const soma = (f: (r: Resumo) => number) =>
    resumoFiltrado.reduce((a, r) => a + Number(f(r) ?? 0), 0);
  const honorario = soma((r) => r.honorario);
  const cobrado = soma((r) => r.cobrado);
  const semCard = soma((r) => r.assinadas_sem_card);
  // Churn sai do "a cobrar": cliente que saiu antes do 1º fee não vai pagar
  // CAC nenhum. Somado junto, o número prometia à matriz dinheiro que não vem.
  const churns = soma((r) => r.churns);
  const churnACobrar = soma((r) => r.churn_a_cobrar);
  const churnCobrado = soma((r) => r.churn_cobrado);
  const aCobrar = soma((r) => r.a_cobrar) - churnACobrar;

  // O funil anda em cima das vendas ELEGÍVEIS: unidade que cobra CAC e venda
  // depois de `cac_desde`. Sem esse recorte, São Bernardo (não cobra) e as
  // vendas de Patos anteriores a agosto entravam como buraco, e o degrau
  // "assinado sem card" acusava 15 falhas onde existem 3.
  const funil = useMemo(() => {
    const vendas = daUnidade.filter((r) => r.contrato_id != null && r.elegivel);
    const assinadas = vendas.filter((r) => r.assinado);
    const comCard = vendas.filter(
      (r) => r.cac_card_id != null && r.etapa !== "card_em_outra_unidade",
    );
    const cobradas = comCard.filter((r) => Number(r.cobrado ?? 0) > 0);
    const passo = (rotulo: string, rs: Linha[], valor?: number) => ({
      rotulo,
      n: rs.length,
      valor: valor ?? rs.reduce((a, r) => a + cacEsperado(r), 0),
    });
    return [
      passo("Vendas elegíveis a CAC", vendas),
      passo("Contrato assinado", assinadas),
      passo("Card de cobrança aberto", comCard),
      // N11: este degrau deixa de fora o card aberto em outra unidade, então não
      // é o mesmo "Cobrado" do card do topo.
      passo(
        "Cobrado (unidade do card)",
        cobradas,
        cobradas.reduce((a, r) => a + Number(r.cobrado ?? 0), 0),
      ),
    ];
  }, [daUnidade]);

  // Regra do negócio: contrato assinado numa unidade que cobra CAC tem que ter
  // card de cobrança. Zero é o estado correto, então a exceção vem nomeada, não
  // só contada.
  const faltando = useMemo(
    () => daUnidade
      .filter((r) => r.etapa === "assinado_sem_card" || r.etapa === "card_em_outra_unidade")
      .sort((a, b) => cacEsperado(b) - cacEsperado(a)),
    [daUnidade],
  );

  const porEtapa = useMemo(() => {
    const m = new Map<string, { n: number; valor: number }>();
    for (const r of daUnidade) {
      const at = m.get(r.etapa) ?? { n: 0, valor: 0 };
      at.n += 1;
      at.valor += Number(r.a_cobrar ?? 0);
      m.set(r.etapa, at);
    }
    return ETAPAS.filter((e) => m.has(e.chave)).map((e) => ({ ...e, ...m.get(e.chave)! }));
  }, [daUnidade]);

  if (loading) {
    return <Carregando variante="pagina" className="px-4 py-6 md:px-6" />;
  }

  if (erro) {
    return (
      <div className="px-4 py-6 md:px-6">
        <ErroDaConsulta
          erro={erro}
          chaves="view.unidades_rede"
          titulo="Não foi possível ler o funil de CAC"
          tentarNovamente={tentarDeNovo}
        />
      </div>
    );
  }

  if (linhas.length === 0) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EstadoVazio
          titulo="Nenhuma venda elegível a CAC no recorte"
          descricao="A unidade entra aqui quando paga CAC ou quando abre o primeiro card no pipe de cobrança."
        />
      </div>
    );
  }

  const base = funil[0]?.n || 1;
  const temFiltro = unidade !== "todas" || etapaFiltro !== "todas" || soChurn;

  return (
    <div className="space-y-6 px-4 py-6 md:px-6">
      <BarraFiltros aoLimpar={temFiltro ? limparFiltros : undefined}>
        <Select value={unidade} onValueChange={setUnidade}>
          <SelectTrigger className="w-[200px]" aria-label="Unidade"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as unidades</SelectItem>
            {unidades.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={etapaFiltro} onValueChange={setEtapaFiltro}>
          <SelectTrigger className="w-[280px]" aria-label="Etapa"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as etapas</SelectItem>
            {ETAPAS.map((e) => (
              <SelectItem key={e.chave} value={e.chave}>{e.rotulo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {soChurn && (
          <ChipFiltro rotulo="Vendas" valor="só churn" aoRemover={() => setSoChurn(false)} />
        )}
        <span className="num text-[13px] text-muted-foreground">
          {filtradas.length} de {linhas.length} vendas
        </span>
      </BarraFiltros>

      <Secao
        titulo="Quanto já foi cobrado e quanto falta?"
        descricao="Somado dos cards de cobrança das unidades do recorte. Churn antes do 1º fee sai do “A cobrar”."
      >
        {erroResumo ? (
          <ErroDaConsulta
            erro={erroResumo}
            chaves="view.unidades_rede"
            titulo="Não foi possível ler o resumo por unidade; os totais e a tabela por unidade ficam sem dado"
            tentarNovamente={tentarDeNovo}
          />
        ) : (
          <KpiGrade>
            <KpiCard rotulo="Honorário apurado nos cards" valor={fmtBRL(honorario)} />
            <KpiCard rotulo="Cobrado" valor={fmtBRL(cobrado)} nota="o que entrou nos cards de cobrança" />
            <KpiCard
              rotulo="A cobrar"
              valor={fmtBRL(aCobrar)}
              nota={churnACobrar > 0 ? `sem ${fmtBRL(churnACobrar)} de churn` : undefined}
            />
            <KpiCard
              rotulo="Assinadas sem card de CAC"
              valor={semCard}
              tom={semCard > 0 ? "perigo" : undefined}
              tomRotulo={semCard > 0 ? "cobrança não aberta" : undefined}
              abrir={
                semCard > 0
                  ? { onClick: () => setEtapaFiltro("assinado_sem_card"), rotulo: "Ver vendas" }
                  : undefined
              }
            />
            <KpiCard
              rotulo="Churn antes do 1º fee"
              valor={churns}
              tom={churns > 0 ? "perigo" : undefined}
              nota={
                <>
                  {fmtBRL(churnACobrar)} que não entram
                  {churnCobrado > 0 ? ` · ${fmtBRL(churnCobrado)} já cobrados` : ""}
                </>
              }
              abrir={{
                onClick: () => setSoChurn(!soChurn),
                rotulo: soChurn ? "Mostrar todas" : "Ver só churn",
              }}
            />
          </KpiGrade>
        )}
      </Secao>

      {faltando.length > 0 && (
        <Secao
          titulo="Qual contrato assinado está sem cobrança aberta?"
          descricao="Assinou numa unidade que cobra CAC, então o card deveria existir. Enquanto não existir, a cobrança não entra em lugar nenhum."
          acoes={<StatusBadge tom="perigo">{faltando.length} sem cobrança</StatusBadge>}
        >
          <ul className="space-y-1.5 rounded-xl border bg-card p-4 text-sm">
            {faltando.map((r) => (
              <li key={`${r.contrato_id}`} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.cliente}</span>
                <span className="num text-muted-foreground">
                  {r.unidade} · ganho em {fmtData(r.ganho_em)} · {fmtBRL(cacEsperado(r))}
                </span>
                {r.etapa === "card_em_outra_unidade" && (
                  <StatusBadge tom="perigo">card está em {r.unidade_card}</StatusBadge>
                )}
                {r.churn && <StatusBadge tom="perigo">churn</StatusBadge>}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      <Secao
        titulo="Onde a venda deixa de virar cobrança?"
        descricao="Vendas elegíveis a CAC, degrau a degrau; em cada linha, quantas e quanto se perdeu desde o degrau anterior."
      >
        <div className="rounded-xl border bg-card p-4">
          <div className="space-y-2">
            {funil.map((e, i) => {
              const pct = Math.round((e.n / base) * 100);
              const perdaN = i > 0 ? funil[i - 1].n - e.n : 0;
              const perdaValor = i > 0 ? funil[i - 1].valor - e.valor : 0;
              return (
                <div key={e.rotulo} className="flex items-center gap-3">
                  <div className="w-52 shrink-0 text-xs text-muted-foreground">{e.rotulo}</div>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full"
                      style={{ width: `${Math.max(pct, 2)}%`, background: CORES_SERIE[0] }}
                    />
                  </div>
                  <div className="num w-24 shrink-0 text-right text-xs">
                    <span className="font-medium">{e.n}</span>
                    <span className="text-muted-foreground"> · {pct}%</span>
                  </div>
                  <div className="num w-32 shrink-0 text-right text-xs font-medium">
                    {fmtBRL(e.valor)}
                  </div>
                  <div className="num w-36 shrink-0 text-right text-xs text-muted-foreground">
                    {perdaN > 0 || perdaValor > 0.5
                      ? `−${perdaN} · −${fmtBRL(perdaValor)}`
                      : ""}
                  </div>
                </div>
              );
            })}
          </div>
          {!erroResumo && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">Do que já tem card aberto</div>
              <div className="num flex flex-wrap gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground">Cobrado: </span>
                  <span className="font-semibold">{fmtBRL(cobrado)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">A cobrar: </span>
                  <span className="font-semibold">{fmtBRL(aCobrar)}</span>
                </div>
                {churnACobrar > 0 && (
                  <div className="text-muted-foreground">
                    {fmtBRL(churnACobrar)} em churn, fora da conta
                  </div>
                )}
              </div>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Nos degraus antes do card não existe honorário lançado, e o valor é o
            honorário mensal da venda. No último, é o que entrou de verdade, só dos
            cards abertos na unidade da venda. Vendas fora da régua de CAC ficam fora
            do funil e aparecem na lista: unidade que não cobra, venda anterior ao
            início da cobrança na unidade ou honorário mensal abaixo do piso que a
            unidade negociou.
          </p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filtrar vendas por etapa">
            {porEtapa.map((e) => {
              const ativa = etapaFiltro === e.chave;
              const acao = EXIGE_ACAO.has(e.chave);
              return (
                <button
                  key={e.chave}
                  type="button"
                  aria-pressed={ativa}
                  onClick={() => setEtapaFiltro(ativa ? "todas" : e.chave)}
                  className={cn(
                    "num inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors duration-[120ms] ease-out hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    ativa ? "border-foreground bg-muted text-foreground" : "text-muted-foreground",
                  )}
                >
                  {acao && <OctagonAlert className="size-3.5 text-danger" aria-label="pede ação" />}
                  {e.rotulo}: {e.n}
                  {e.valor > 0 ? ` · ${fmtBRL(e.valor)}` : ""}
                </button>
              );
            })}
          </div>
        </div>
      </Secao>

      {!erroResumo && (
        <Secao titulo="Qual unidade tem mais CAC a cobrar?" descricao="Ordenado pelo que falta cobrar.">
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Vendas</TableHead>
                  <TableHead className="text-right">Elegíveis</TableHead>
                  <TableHead className="text-right">Assinadas</TableHead>
                  <TableHead className="text-right">Com card</TableHead>
                  <TableHead className="text-right">Assinadas sem card</TableHead>
                  <TableHead className="text-right">Card na unidade errada</TableHead>
                  <TableHead className="text-right">Churn</TableHead>
                  <TableHead className="text-right">Honorário</TableHead>
                  <TableHead className="text-right">Cobrado</TableHead>
                  <TableHead className="text-right">A cobrar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resumoFiltrado
                  .slice()
                  .sort((a, b) => Number(b.a_cobrar) - Number(a.a_cobrar))
                  .map((r) => (
                    <TableRow key={r.unidade_id}>
                      <TableCell>
                        <span className="font-medium">{r.unidade}</span>
                        {!r.paga_cac && (
                          <StatusBadge tom="neutro" className="ml-2">não cobra CAC</StatusBadge>
                        )}
                        {r.paga_cac && r.cac_desde && r.cac_desde > "2026-02-01" && (
                          <StatusBadge tom="info" icone={false} className="ml-2">
                            CAC desde {fmtData(r.cac_desde)}
                          </StatusBadge>
                        )}
                        {r.cac_honorario_minimo_mensal != null && (
                          <StatusBadge tom="info" icone={false} className="ml-2">
                            só acima de {fmtBRL(r.cac_honorario_minimo_mensal)}/mês
                          </StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="num text-right">{r.vendas}</TableCell>
                      <TableCell className="num text-right">
                        {r.elegiveis}
                        {r.fora_da_regua > 0 && (
                          <span className="text-muted-foreground"> (+{r.fora_da_regua} fora)</span>
                        )}
                      </TableCell>
                      <TableCell className="num text-right">{r.assinadas}</TableCell>
                      <TableCell className="num text-right">{r.com_card}</TableCell>
                      <TableCell className="num text-right">
                        {r.assinadas_sem_card > 0 ? (
                          <StatusBadge tom="perigo">{r.assinadas_sem_card}</StatusBadge>
                        ) : (
                          r.assinadas_sem_card
                        )}
                      </TableCell>
                      <TableCell className="num text-right">
                        {r.card_em_outra_unidade > 0 ? (
                          <StatusBadge tom="perigo">{r.card_em_outra_unidade}</StatusBadge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="num text-right">
                        {r.churns > 0 ? (
                          <StatusBadge tom="perigo">
                            {r.churns} · {fmtBRL(r.churn_a_cobrar)}
                          </StatusBadge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="num text-right">{fmtBRL(r.honorario)}</TableCell>
                      <TableCell className="num text-right">{fmtBRL(r.cobrado)}</TableCell>
                      <TableCell className="num text-right font-medium">
                        {fmtBRL(Number(r.a_cobrar) - Number(r.churn_a_cobrar))}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </Secao>
      )}

      <Secao
        titulo={`Quais vendas${etapaFiltro !== "todas" ? ` estão em “${ROTULO.get(etapaFiltro) ?? etapaFiltro}”` : " compõem o funil"}?`}
        descricao="Ordenado pelo que falta cobrar."
      >
        {filtradas.length === 0 ? (
          <EstadoVazio titulo="Nenhuma venda neste recorte" total={linhas.length} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="max-h-[560px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Ganho</TableHead>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Fase da cobrança</TableHead>
                    <TableHead className="text-right">Honorário</TableHead>
                    <TableHead className="text-right">Cobrado</TableHead>
                    <TableHead className="text-right">A cobrar</TableHead>
                    <TableHead>Etapa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map((r) => (
                    <TableRow key={`${r.contrato_id ?? "orfao"}-${r.cac_card_id ?? r.cliente}`}>
                      <TableCell className="max-w-[260px] truncate" title={r.cliente ?? ""}>
                        {r.cliente ?? "—"}
                      </TableCell>
                      <TableCell>{r.unidade}</TableCell>
                      <TableCell className="num whitespace-nowrap">{fmtData(r.ganho_em)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.fase_contrato ?? "sem card de contrato"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.fase_cac ?? "—"}
                        {r.etapa === "card_em_outra_unidade" && ` (em ${r.unidade_card})`}
                      </TableCell>
                      <TableCell className="num text-right">{fmtBRL(r.honorario)}</TableCell>
                      <TableCell className="num text-right">{fmtBRL(r.cobrado)}</TableCell>
                      <TableCell className="num text-right">
                        {Number(r.a_cobrar ?? 0) > 0 ? fmtBRL(r.a_cobrar) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge tom={EXIGE_ACAO.has(r.etapa) ? "perigo" : "neutro"}>
                            {ROTULO.get(r.etapa) ?? r.etapa}
                          </StatusBadge>
                          {r.churn && (
                            <span title={`Churn visto em: ${r.churn_origem ?? "—"}`}>
                              <StatusBadge tom="perigo">churn</StatusBadge>
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </Secao>
    </div>
  );
}
