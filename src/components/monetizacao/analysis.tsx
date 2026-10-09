import { useId, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  EstadoVazio,
  KpiGrade,
  Secao,
  StatusBadge,
  type TomStatus,
  useFocoDeVolta,
} from "@/components/planning";
import { abordagensPorDiaUtil, hoje, operacao } from "@/lib/monetizacao/model";
import type { Filtro } from "@/lib/monetizacao/model";
import { salvarRegistroMonetizacao } from "@/lib/monetizacao/functions";
import { NOMES, NOMES_ROTEIRO, PRE_VENDEDORES, PRODUTOS_ROTEIRO } from "@/lib/monetizacao/types";
import type {
  BaseMonetizacao,
  Metrica,
  Negocio,
  ProdutoRoteiro,
  Registro,
  RegistroValor,
} from "@/lib/monetizacao/types";
import { useAtualizarMonetizacao } from "@/hooks/use-monetizacao";
import type { Aba, OpcoesDetalhe } from "./dashboard";
import { SITUACOES } from "./busca";
import { doResponsavel } from "@/lib/monetizacao/responsavel";
import type { BuscaMonetizacao, ProdutoRoteiroUrl, Situacao } from "./busca";
import {
  BotaoComMotivo,
  date,
  FOCO_VISIVEL,
  estadoKpiEvento,
  Field,
  inputClass,
  Kpi,
  motivoSemEscopo,
  NotaApoio,
  number,
  procedenciaMonetizacao,
  SecaoCartao,
} from "./common";

type Props = {
  aba: Aba;
  data: BaseMonetizacao;
  filter: Filtro;
  openDeals: (
    title: string,
    rows: Negocio[],
    period?: { from: string; to: string },
    opcoes?: OpcoesDetalhe,
  ) => void;
  /** Estado da tela na URL (`dias`, `mes`, `sinal`, `blocos`, `totais`, `arquivados`, `situacao`): as visões passam a usar nas T3–T8. */
  busca?: BuscaMonetizacao;
  mudarBusca?: (patch: Partial<BuscaMonetizacao>) => void;
};
// Temporal e previsão, Projetado × realizado, Capacidade e alocação e Follow Day saíram do menu em 09/10/2026
// (aprovado pelo dono do produto); o link antigo abre a Operação diária com aviso (busca.ts, ABAS_APOSENTADAS).
export function Analysis(props: Props) {
  const { aba, data, filter, openDeals } = props;
  if (aba === "funil") return <Funnel data={data} filter={filter} openDeals={openDeals} />;
  if (aba === "pessoas")
    return <People data={data} filter={filter} busca={props.busca} mudarBusca={props.mudarBusca} />;
  if (aba === "roteiros")
    return <Scripts data={data} busca={props.busca} mudarBusca={props.mudarBusca} />;
  return <Distribution data={data} filter={filter} openDeals={openDeals} />;
}

type Cut = Pick<Props, "data" | "filter" | "openDeals">;
const MESES_CURTOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
/** "set/2026" a partir de "2026-09". */
const rotuloMes = (m: string) => `${MESES_CURTOS[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
/** Nome do responsável da barra: a pré-venda inteira sem filtro; o pré-vendedor pelo cadastro (a Heloá ainda sem card). */
const nomeDoDono = (data: BaseMonetizacao, owner: number | null) =>
  owner === null
    ? "Pré-venda (os dois)"
    : (PRE_VENDEDORES.find(([id]) => id === owner)?.[1] ??
      data.cards.find((c) => c.owner_id === owner)?.owner ??
      `Usuário ${owner}`);
/** Uma casa decimal, para ritmo (abordagens por dia útil). */
const DECIMAL = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const juntarNotas = (...partes: (string | undefined | false | null)[]) =>
  partes.filter(Boolean).join(" · ") || undefined;

/** Campo do plano (Configuração §5): rótulo acima, ajuda abaixo, erro no próprio campo. */
function CampoPlano({
  rotulo,
  ajuda,
  erro,
  anunciar = false,
  children,
}: {
  rotulo: string;
  ajuda?: string;
  erro?: string | null;
  /** Anuncia o erro ao leitor de tela (`role="alert"`): só um campo por erro, para não repetir. */
  anunciar?: boolean;
  children: (a11y: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const id = useId();
  const ajudaId = `${id}-ajuda`,
    erroId = `${id}-erro`;
  const descritoPor = [erro ? erroId : null, ajuda ? ajudaId : null].filter(Boolean).join(" ");
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {rotulo}
      </Label>
      {children({
        id,
        "aria-describedby": descritoPor || undefined,
        "aria-invalid": erro ? true : undefined,
      })}
      {erro && (
        <p
          id={erroId}
          role={anunciar ? "alert" : undefined}
          className="text-xs font-medium text-danger"
        >
          {erro}
        </p>
      )}
      {ajuda && (
        <p id={ajudaId} className="text-xs text-muted-foreground">
          {ajuda}
        </p>
      )}
    </div>
  );
}

/**
 * Z2 no recorte da barra (mesma régua da Operação diária): negócio sem histórico lido não tem
 * autor de movimento, então o vínculo é o dono atual; entra se foi carregado até `ate` e estava
 * aberto no período (aberto hoje, ganho a partir de `de` ou com evento no período).
 */
const semHistoricoNoRecorte = (data: BaseMonetizacao, f: Filtro) =>
  data.cards.filter((c) => {
    if (c.history_known) return false;
    if (f.product && c.route !== f.product) return false;
    if (f.owner && c.owner_id !== f.owner) return false;
    const carregado =
      c.events.loaded.map((e) => e.date).sort()[0] ?? c.created_at?.slice(0, 10) ?? "";
    if (carregado > f.to) return false;
    if (c.status === "open") return true;
    const ganhoEm = c.status === "won" ? (c.won_on ?? c.signed_on) : null;
    if (ganhoEm) return ganhoEm >= f.from;
    return Object.values(c.events).some((es) => es.some((e) => e.date >= f.from && e.date <= f.to));
  });

/** Data mais recente do evento `k` no período, pelo autor filtrado: ordena o detalhe. */
const ultimoEventoNoPeriodo = (k: Metrica, f: Filtro) => (c: Negocio) =>
  c.events[k]
    .filter((e) => e.date >= f.from && e.date <= f.to && doResponsavel(f, e.actor_id))
    .map((e) => e.date)
    .sort()
    .at(-1);

/** Número de célula que abre o detalhe (N2): link com foco visível e rótulo completo. */
function CelulaQueAbre({
  valor,
  rotulo,
  onClick,
}: {
  valor: number;
  rotulo: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${rotulo}: ${valor}, abrir negócios`}
      className={`font-semibold text-primary-text underline underline-offset-2 ${FOCO_VISIVEL}`}
      onClick={onClick}
    >
      {number(valor)}
    </button>
  );
}

/**
 * Funil comercial (contrato `monetizacao-funil.md`, Lista/Relatório): duas coortes do período,
 * cada uma com a pergunta dela, e a conversão por produto com toda célula abrindo o detalhe.
 * Só apresentação: os conjuntos são os mesmos de antes (`operacao()` e os filtros da coorte).
 */
function Funnel({ data, filter, openDeals }: Cut) {
  const v = operacao(data.cards, filter);
  const scheduled = v.rows.scheduled,
    realized = scheduled.filter((c) =>
      c.events.meeting.some(
        (m) =>
          m.date <= filter.to &&
          c.events.scheduled.some(
            (s) => s.date >= filter.from && s.date <= m.date && doResponsavel(filter, s.actor_id),
          ),
      ),
    );
  const pending = scheduled.filter((c) => !realized.some((r) => r.id === c.id)),
    lost = pending.filter((c) => c.status === "lost"),
    stillOpen = pending.filter((c) => c.status === "open");
  // N11: agendada ganha sem passar por "Reunião realizada" não cai em nenhum dos três desfechos.
  const foraDosDesfechos = pending.length - lost.length - stillOpen.length;
  const validated = v.rows.validated,
    signed = validated.filter(
      (c) =>
        c.won_on &&
        c.won_on <= filter.to &&
        c.events.validated.some(
          (e) => e.date >= filter.from && e.date <= c.won_on! && doResponsavel(filter, e.actor_id),
        ),
    ),
    validatedOpen = validated.filter((c) => c.status === "open");
  const evento = estadoKpiEvento(data, semHistoricoNoRecorte(data, filter));
  const procedencia = procedenciaMonetizacao(data);
  const periodo = { from: filter.from, to: filter.to };
  const porAgendamento = ultimoEventoNoPeriodo("scheduled", filter),
    porReuniao = ultimoEventoNoPeriodo("meeting", filter),
    porValidacao = ultimoEventoNoPeriodo("validated", filter),
    porGanho = (c: Negocio) => c.won_on ?? c.signed_on;
  const abrir = (
    titulo: string,
    lista: Negocio[],
    ordenarPor: (c: Negocio) => string | null | undefined,
  ) => openDeals(titulo, lista, periodo, { ordenarPor });
  const kpi = (nota?: string) => ({
    estado: evento.estado,
    nota: juntarNotas(evento.nota, nota),
    procedencia,
  });
  // Com produto filtrado, só a linha dele (as outras seriam zero por estarem fora do recorte).
  const produtos = filter.product
    ? v.products.filter((p) => p.product === filter.product)
    : v.products;
  return (
    <div className="space-y-6">
      <Secao
        titulo="Das reuniões agendadas no período, quantas aconteceram?"
        descricao="Agendamento → reunião · mesma coorte; a realização conta até o fim do período"
      >
        <KpiGrade colunas={4}>
          <Kpi
            label="Agendadas no período"
            value={number(scheduled.length)}
            {...kpi(
              foraDosDesfechos > 0
                ? `${number(foraDosDesfechos)} fora dos três desfechos (ganhas sem reunião registrada)`
                : undefined,
            )}
            onClick={() => abrir("Coorte agendada", scheduled, porAgendamento)}
          />
          <Kpi
            label="Depois realizadas"
            value={number(realized.length)}
            {...kpi(
              scheduled.length
                ? `${number((realized.length / scheduled.length) * 100)}% desta coorte`
                : "Sem amostra",
            )}
            onClick={() => abrir("Agendadas depois realizadas", realized, porReuniao)}
          />
          <Kpi
            label="Sem realização · em aberto"
            value={number(stillOpen.length)}
            {...kpi("Ainda podem realizar")}
            onClick={() => abrir("Agendadas ainda em aberto", stillOpen, porAgendamento)}
          />
          <Kpi
            label="Sem realização · perdidas"
            value={number(lost.length)}
            {...kpi()}
            onClick={() => abrir("Agendadas perdidas sem realização", lost, porAgendamento)}
          />
        </KpiGrade>
        <NotaApoio>
          Uma oportunidade sem passagem em Reunião realizada não é automaticamente no-show. Para
          medir ausência, recuperação e motivo, é preciso registrar o resultado da atividade no CRM.
        </NotaApoio>
      </Secao>
      <Secao
        titulo="Das oportunidades validadas no período, quantas viraram contrato?"
        descricao="Oportunidade validada → assinatura · mesma coorte; o ganho conta até o fim do período"
      >
        <KpiGrade colunas={3}>
          <Kpi
            label="Validadas no período"
            value={number(validated.length)}
            {...kpi()}
            onClick={() => abrir("Coorte validada", validated, porValidacao)}
          />
          <Kpi
            label="Ganhos até o fim do período"
            value={number(signed.length)}
            {...kpi(
              validated.length
                ? `${number((signed.length / validated.length) * 100)}% · coorte ainda pode amadurecer`
                : "Sem amostra",
            )}
            onClick={() => abrir("Ganhos da coorte validada", signed, porGanho)}
          />
          <Kpi
            label="Ainda em aberto"
            value={number(validatedOpen.length)}
            {...kpi("Não entram como fracasso definitivo")}
            onClick={() => abrir("Validadas ainda em aberto", validatedOpen, porValidacao)}
          />
        </KpiGrade>
      </Secao>
      <SecaoCartao
        titulo="Como cada produto converte no período?"
        descricao="Reuniões realizadas, validadas e ganhos contam os próprios eventos no período · abertas são da coorte validada · clique no número para abrir os negócios"
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="num text-right">Reuniões realizadas</TableHead>
                <TableHead className="num text-right">Validadas</TableHead>
                <TableHead className="num text-right">Ganhos</TableHead>
                <TableHead className="num text-right">Abertas da coorte validada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {produtos.map((p) => {
                const nome = NOMES[p.product];
                const doProduto = (lista: Negocio[]) => lista.filter((c) => c.route === p.product);
                const celulas: [string, Negocio[], (c: Negocio) => string | null | undefined][] = [
                  ["Reuniões realizadas", doProduto(v.rows.meeting), porReuniao],
                  ["Validadas", doProduto(v.rows.validated), porValidacao],
                  ["Ganhos", doProduto(v.rows.signed), ultimoEventoNoPeriodo("signed", filter)],
                  ["Abertas da coorte validada", doProduto(validatedOpen), porValidacao],
                ];
                return (
                  <TableRow key={p.product}>
                    <TableCell className="font-medium">{nome}</TableCell>
                    {celulas.map(([rotulo, lista, ordem]) => (
                      <TableCell key={rotulo} className="num text-right">
                        <CelulaQueAbre
                          valor={lista.length}
                          rotulo={`${nome} · ${rotulo}`}
                          onClick={() => abrir(`${nome} · ${rotulo}`, lista, ordem)}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="mt-3">
          <NotaApoio>
            As três primeiras colunas contam seus próprios eventos no período. Use as coortes acima
            para calcular conversão sem misturar denominadores.
          </NotaApoio>
        </div>
      </SecaoCartao>
    </div>
  );
}

const CRITERIOS = [
  "Investigou faturamento e segmento",
  "Conectou a necessidade ao produto",
  "Validou oportunidade com o especialista",
  "Combinou próximo passo e prazo",
  "Preencheu produto, receita prevista e split",
];
/**
 * Pessoas e PDI (contrato `monetizacao-pessoas.md`, Ficha): avaliação da amostra do responsável
 * da barra e o histórico de PDI. Cada campo que falta diz, nele mesmo, que falta para salvar.
 */
function People({
  data,
  filter,
  busca,
  mudarBusca,
}: Pick<Props, "data" | "filter" | "busca" | "mudarBusca">) {
  const [title, setTitle] = useState(""),
    [sample, setSample] = useState(""),
    [scores, setScores] = useState<Record<string, number>>({}),
    [goal, setGoal] = useState(""),
    [action, setAction] = useState(""),
    [due, setDue] = useState(""),
    [busy, setBusy] = useState(false);
  const fn = useServerFn(salvarRegistroMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const values = Object.values(scores).filter((n) => n > 0),
    average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const dono = nomeDoDono(data, filter.owner);
  const falta = {
    responsavel:
      filter.owner === null
        ? "Escolha um pré-vendedor na barra: com a pré-venda inteira não há de quem seja o PDI."
        : null,
    title: title.trim().length < 3 ? "Falta o título (3 caracteres ou mais) para salvar." : null,
    sample: !sample.trim() ? "Falta a amostra revisada para salvar." : null,
    scores: !values.length ? "Falta dar nota a pelo menos um critério para salvar." : null,
    goal: !goal.trim() ? "Falta o objetivo para salvar." : null,
    action: !action.trim() ? "Falta a ação para salvar." : null,
    due: !due ? "Falta o prazo para salvar." : null,
  };
  const motivos = [motivoSemEscopo(data), ...Object.values(falta)];
  const limpar = () => {
    setTitle("");
    setSample("");
    setScores({});
    setGoal("");
    setAction("");
    setDue("");
  };
  const save = async () => {
    setBusy(true);
    try {
      await fn({
        data: {
          kind: "pdi",
          title: title.trim(),
          body: {
            owner_id: filter.owner,
            from: filter.from,
            to: filter.to,
            sample,
            scores,
            goal,
            action,
            due,
            status: "em_andamento",
            rubric_version: 1,
          },
        },
      });
      await invalidate();
      toast.success(`Avaliação e PDI de ${dono} registrados.`);
      limpar();
    } catch (e) {
      toast.error(`A avaliação não foi salva: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <SecaoCartao
        titulo={
          filter.owner === null
            ? "Como o hunter foi na amostra do período?"
            : `Como ${dono} foi na amostra do período?`
        }
        descricao={`Amostra de ${date(filter.from)} a ${date(filter.to)} · 5 critérios, nota 1–5`}
      >
        <div className="space-y-3">
          <NotaApoio>
            Avaliação registrada pelo gestor, com evidências. Volume de atividade e nota de
            qualidade são medidas separadas.
          </NotaApoio>
          {falta.responsavel && (
            <p className="text-xs font-medium text-muted-foreground">{falta.responsavel}</p>
          )}
          <CampoPlano rotulo="Título da avaliação / pessoa" ajuda={falta.title ?? undefined}>
            {(a11y) => (
              <input
                {...a11y}
                className={inputClass}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </CampoPlano>
          <CampoPlano rotulo="Amostra e evidências revisadas" ajuda={falta.sample ?? undefined}>
            {(a11y) => (
              <textarea
                {...a11y}
                className={`${inputClass} h-20 py-2`}
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                placeholder="IDs das oportunidades, calls ou links revisados"
              />
            )}
          </CampoPlano>
          {CRITERIOS.map((c) => (
            <CampoPlano key={c} rotulo={c}>
              {(a11y) => (
                <select
                  {...a11y}
                  className={inputClass}
                  value={scores[c] || 0}
                  onChange={(e) => setScores({ ...scores, [c]: Number(e.target.value) })}
                >
                  <option value="0">Não avaliado</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} ·{" "}
                      {n === 1
                        ? "Não demonstrado"
                        : n === 3
                          ? "Parcial"
                          : n === 5
                            ? "Consistente"
                            : "Intermediário"}
                    </option>
                  ))}
                </select>
              )}
            </CampoPlano>
          ))}
          <div>
            <p className="text-sm">
              Média da amostra: <strong className="num">{number(average)}</strong> · {values.length}{" "}
              de {CRITERIOS.length} critérios avaliados
            </p>
            {falta.scores && <p className="text-xs text-muted-foreground">{falta.scores}</p>}
          </div>
          <CampoPlano rotulo="Objetivo de desenvolvimento" ajuda={falta.goal ?? undefined}>
            {(a11y) => (
              <input
                {...a11y}
                className={inputClass}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            )}
          </CampoPlano>
          <CampoPlano
            rotulo="Ação observável para o próximo ciclo"
            ajuda={falta.action ?? undefined}
          >
            {(a11y) => (
              <textarea
                {...a11y}
                className={`${inputClass} h-20 py-2`}
                value={action}
                onChange={(e) => setAction(e.target.value)}
              />
            )}
          </CampoPlano>
          <CampoPlano rotulo="Revisar até" ajuda={falta.due ?? undefined}>
            {(a11y) => (
              <input
                {...a11y}
                type="date"
                className={inputClass}
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            )}
          </CampoPlano>
          <BotaoComMotivo onClick={save} disabled={busy || motivos.some(Boolean)} motivo={motivos}>
            {busy ? "Salvando" : "Salvar avaliação e PDI"}
          </BotaoComMotivo>
        </div>
      </SecaoCartao>
      <RecordList
        data={data}
        kind="pdi"
        title="Quais PDIs estão registrados, e em que pé?"
        arquivados={busca?.arquivados === "mostrar"}
        mudarArquivados={(mostrar) => mudarBusca?.({ arquivados: mostrar ? "mostrar" : undefined })}
      />
    </div>
  );
}

const SITUACAO_ROTEIRO: Record<Situacao, { rotulo: string; tom: TomStatus }> = {
  rascunho: { rotulo: "Rascunho", tom: "info" },
  aprovado: { rotulo: "Aprovada", tom: "sucesso" },
  arquivado: { rotulo: "Arquivada", tom: "neutro" },
};
const situacaoDoRoteiro = (r: Registro): Situacao =>
  r.body.status === "aprovado" || r.body.status === "arquivado" ? r.body.status : "rascunho";
// "caixa" (Caixa · todas as frentes, 09/10/2026): roteiro da pré-venda que vale para as três frentes.
const produtoDoRoteiro = (r: Registro): ProdutoRoteiro | "sem_produto" =>
  (PRODUTOS_ROTEIRO as readonly string[]).includes(String(r.body.product))
    ? (r.body.product as ProdutoRoteiro)
    : "sem_produto";

/**
 * Abordagens (contrato `monetizacao-roteiros.md`, Lista/Relatório com edição em `Sheet`):
 * biblioteca em tabela com filtros de produto e situação na URL; "Nova abordagem" e a linha
 * abrem o mesmo `Sheet` (formulário ou a abordagem salva, com Copiar, Aprovar e Arquivar).
 */
function Scripts({
  data,
  busca,
  mudarBusca,
}: {
  data: BaseMonetizacao;
  busca?: BuscaMonetizacao;
  mudarBusca?: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  const [product, setProduct] = useState<ProdutoRoteiro>("consultoria"),
    [segment, setSegment] = useState(""),
    [evidence, setEvidence] = useState(""),
    [text, setText] = useState(""),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false),
    [aberta, setAberta] = useState<{ modo: "nova" } | { modo: "ver"; id: string } | null>(null),
    [arquivar, setArquivar] = useState<Registro | null>(null);
  const novaRef = useRef<HTMLButtonElement>(null);
  const foco = useFocoDeVolta(novaRef);
  const abrirSheet = (
    estado: { modo: "nova" } | { modo: "ver"; id: string },
    origem?: Element | null,
  ) => {
    foco.guardar(origem);
    setAberta(estado);
  };
  const fn = useServerFn(salvarRegistroMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const motivoEscrita = motivoSemEscopo(data);
  const filtroProduto = busca?.produto,
    filtroSituacao = busca?.situacao;
  const todas = data.records
    .filter((r) => r.kind === "roteiro")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  // Sem filtro de situação, as arquivadas ficam fora; "Arquivada" no filtro mostra só elas.
  const lista = todas.filter(
    (r) =>
      (!filtroProduto || produtoDoRoteiro(r) === filtroProduto) &&
      (filtroSituacao
        ? situacaoDoRoteiro(r) === filtroSituacao
        : situacaoDoRoteiro(r) !== "arquivado"),
  );
  const nArquivadas = todas.filter((r) => situacaoDoRoteiro(r) === "arquivado").length;
  const vista = aberta?.modo === "ver" ? todas.find((r) => r.id === aberta.id) : undefined;
  const compose = () =>
    setText(
      product === "caixa"
        ? `Olá, [nome]. Sou o [seu nome], da equipe do [sócio], e cuido da Inteligência Financeira aqui na Planning.\n\nComo já estamos à frente da contabilidade da [empresa]${segment ? ", no segmento de " + segment + "," : ""} e conhecemos de perto os números de vocês, queremos avaliar oportunidades financeiras que vão além da rotina contábil.\n\n${evidence ? "Ponto para levantar: " + evidence : "Levantar o que decide cada frente (tese tributária, crédito a recuperar e crédito bancário mais barato), sem prometer resultado antes da análise."}\n\nPróximo passo: 10 minutos por telefone e, se fizer sentido, o levantamento com o sócio.`
        : product === "consultoria"
          ? `Olá, [nome]. O sócio da unidade indicou conversarmos sobre a operação ${segment ? "de " + segment : "da empresa"}. Podemos confirmar o faturamento anual, o regime tributário e os principais desafios?\n\n${evidence ? "Ponto para investigar: " + evidence : "Investigar uma necessidade concreta antes de oferecer a consultoria."}\n\nPróximo passo: combinar uma conversa com o especialista e registrar responsável e data.`
          : product === "finance"
            ? `Olá, [nome]. Já temos um contrato da empresa na Planning. Gostaria de entender se existe uma necessidade de capital de giro, investimento ou troca de dívida.\n\n${evidence || "Confirmar objetivo, volume e prazo da necessidade, sem prometer aprovação."}\n\nPróximo passo: validar o cenário com o especialista de Finance e combinar a data de retorno.`
            : `Olá, [nome]. Queremos verificar se há uma oportunidade de revisão tributária que faça sentido para a empresa.\n\n${evidence || "Confirmar cenário, documentos disponíveis e disponibilidade para avaliação técnica."}\n\nPróximo passo: avaliar com o especialista, sem prometer crédito ou resultado antes da análise.`,
    );
  const limpar = () => {
    setProduct("consultoria");
    setSegment("");
    setEvidence("");
    setText("");
    setTitle("");
  };
  const copiar = (t: string) =>
    navigator.clipboard.writeText(t).then(
      () => toast.success("Copiado."),
      () => toast.error("Não foi possível copiar; selecione o texto e copie à mão."),
    );
  const save = async () => {
    setBusy(true);
    try {
      await fn({
        data: {
          kind: "roteiro",
          title: title.trim(),
          body: { product, segment, evidence, text, status: "rascunho", version: 1 },
        },
      });
      await invalidate();
      toast.success("Abordagem salva como rascunho para revisão e uso pela equipe.");
      limpar();
      setAberta(null);
    } catch (e) {
      toast.error(`A abordagem não foi salva: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const mudarSituacao = async (r: Registro, status: Situacao, mensagem: string) => {
    setBusy(true);
    try {
      await fn({ data: { id: r.id, kind: r.kind, title: r.title, body: { ...r.body, status } } });
      await invalidate();
      toast.success(mensagem);
      if (status === "arquivado") setAberta(null);
    } catch (e) {
      toast.error(`A abordagem não foi atualizada: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const motivosSalvar = [
    motivoEscrita,
    title.trim().length < 3 && "Dê um nome à abordagem (3 caracteres ou mais).",
    !text.trim() && "Monte ou escreva o texto antes de salvar.",
  ];
  const temFiltro = !!filtroProduto || !!filtroSituacao;
  return (
    <div className="space-y-4">
      <BarraFiltros
        className="items-end"
        aoLimpar={
          temFiltro ? () => mudarBusca?.({ produto: undefined, situacao: undefined }) : undefined
        }
      >
        <Field label="Produto">
          <select
            className={inputClass}
            value={filtroProduto ?? ""}
            onChange={(e) =>
              mudarBusca?.({
                produto: (e.target.value || undefined) as ProdutoRoteiroUrl | undefined,
              })
            }
          >
            <option value="">Todos os produtos</option>
            {PRODUTOS_ROTEIRO.map((p) => (
              <option key={p} value={p}>
                {NOMES_ROTEIRO[p]}
              </option>
            ))}
            <option value="sem_produto">Sem produto</option>
          </select>
        </Field>
        <Field label="Situação">
          <select
            className={inputClass}
            value={filtroSituacao ?? ""}
            onChange={(e) =>
              mudarBusca?.({ situacao: (e.target.value || undefined) as Situacao | undefined })
            }
          >
            <option value="">Rascunho e aprovada</option>
            {SITUACOES.map((k) => (
              <option key={k} value={k}>
                {SITUACAO_ROTEIRO[k].rotulo}
              </option>
            ))}
          </select>
        </Field>
      </BarraFiltros>
      <SecaoCartao
        titulo="Qual abordagem usar para este produto e segmento?"
        descricao={`${number(lista.length)} de ${number(todas.length)} abordagens · ${number(nArquivadas)} ${nArquivadas === 1 ? "arquivada" : "arquivadas"}${filtroSituacao ? "" : " (fora da lista; filtre a situação Arquivada para vê-las)"} · clique na linha para abrir`}
        acoes={
          <Button
            ref={novaRef}
            size="sm"
            onClick={(e) => abrirSheet({ modo: "nova" }, e.currentTarget)}
          >
            <Plus />
            Nova abordagem
          </Button>
        }
      >
        {!todas.length ? (
          <EstadoVazio
            titulo="Nenhuma abordagem salva ainda."
            descricao="Monte a primeira a partir do modelo em Nova abordagem."
          />
        ) : !lista.length ? (
          <EstadoVazio titulo="Nenhuma abordagem neste filtro." total={todas.length} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Segmento</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="num text-right">Atualizada em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((r) => {
                  const sit = SITUACAO_ROTEIRO[situacaoDoRoteiro(r)];
                  const abrir = (origem?: Element | null) =>
                    abrirSheet({ modo: "ver", id: r.id }, origem);
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={(e) => abrir(e.currentTarget.querySelector("button"))}
                    >
                      <TableCell>{NOMES_ROTEIRO[produtoDoRoteiro(r)]}</TableCell>
                      <TableCell>{String(r.body.segment || "—")}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className={`text-left font-medium text-primary-text underline-offset-2 hover:underline ${FOCO_VISIVEL}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            abrir(e.currentTarget);
                          }}
                        >
                          {r.title}
                        </button>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tom={sit.tom}>{sit.rotulo}</StatusBadge>
                      </TableCell>
                      <TableCell className="num text-right">{date(r.updated_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-3">
          <NotaApoio>Modelo editável. Nada é enviado automaticamente ao cliente.</NotaApoio>
        </div>
      </SecaoCartao>

      <Sheet open={!!aberta} onOpenChange={(o) => !o && setAberta(null)}>
        <SheetContent
          className="w-full overflow-y-auto sm:max-w-xl"
          onCloseAutoFocus={foco.onCloseAutoFocus}
        >
          {aberta?.modo === "nova" ? (
            <>
              <SheetHeader>
                <SheetTitle>Nova abordagem</SheetTitle>
                <SheetDescription>
                  Monte a partir do modelo, revise o texto e salve como rascunho.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3">
                <Field label="Nome da abordagem">
                  <input
                    className={inputClass}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Produto">
                    <select
                      className={inputClass}
                      value={product}
                      onChange={(e) => setProduct(e.target.value as ProdutoRoteiro)}
                    >
                      {PRODUTOS_ROTEIRO.map((p) => (
                        <option key={p} value={p}>
                          {NOMES_ROTEIRO[p]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Segmento">
                    <input
                      className={inputClass}
                      value={segment}
                      onChange={(e) => setSegment(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Evidência / necessidade observada">
                  <textarea
                    className={`${inputClass} h-20 py-2`}
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                  />
                </Field>
                <Button variant="outline" size="sm" onClick={compose}>
                  Montar a partir do modelo
                </Button>
                <Field label="Texto para revisar">
                  <textarea
                    className={`${inputClass} h-64 py-2`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <BotaoComMotivo
                    onClick={save}
                    disabled={busy || motivosSalvar.some(Boolean)}
                    motivo={motivosSalvar}
                  >
                    {busy ? "Salvando" : "Salvar abordagem"}
                  </BotaoComMotivo>
                  <BotaoComMotivo
                    variant="outline"
                    disabled={!text}
                    motivo={text ? null : "Ainda não há texto para copiar."}
                    onClick={() => copiar(text)}
                  >
                    Copiar texto
                  </BotaoComMotivo>
                </div>
                <NotaApoio>Modelo editável. Nada é enviado automaticamente ao cliente.</NotaApoio>
              </div>
            </>
          ) : vista ? (
            <>
              <SheetHeader>
                <SheetTitle>{vista.title}</SheetTitle>
                <SheetDescription>
                  {NOMES_ROTEIRO[produtoDoRoteiro(vista)]}
                  {vista.body.segment ? ` · ${String(vista.body.segment)}` : ""} · atualizada em{" "}
                  {date(vista.updated_at)}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <StatusBadge tom={SITUACAO_ROTEIRO[situacaoDoRoteiro(vista)].tom}>
                  {SITUACAO_ROTEIRO[situacaoDoRoteiro(vista)].rotulo}
                </StatusBadge>
                {vista.body.evidence ? (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Evidência / necessidade observada
                    </span>
                    <p className="whitespace-pre-wrap text-sm">{String(vista.body.evidence)}</p>
                  </div>
                ) : null}
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Texto</span>
                  <p className="whitespace-pre-wrap rounded-lg border p-3 text-sm">
                    {String(vista.body.text || "—")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {situacaoDoRoteiro(vista) === "rascunho" && (
                    <BotaoComMotivo
                      disabled={busy || !!motivoEscrita}
                      motivo={motivoEscrita}
                      onClick={() => mudarSituacao(vista, "aprovado", "Abordagem aprovada.")}
                    >
                      Aprovar
                    </BotaoComMotivo>
                  )}
                  <BotaoComMotivo
                    variant="outline"
                    disabled={!vista.body.text}
                    motivo={vista.body.text ? null : "Esta abordagem não tem texto."}
                    onClick={() => copiar(String(vista.body.text))}
                  >
                    Copiar texto
                  </BotaoComMotivo>
                  {situacaoDoRoteiro(vista) !== "arquivado" && (
                    <BotaoComMotivo
                      variant="ghost"
                      disabled={busy || !!motivoEscrita}
                      motivo={motivoEscrita}
                      onClick={() => setArquivar(vista)}
                    >
                      Arquivar
                    </BotaoComMotivo>
                  )}
                </div>
              </div>
            </>
          ) : (
            <SheetHeader>
              <SheetTitle>Abordagem não encontrada</SheetTitle>
              <SheetDescription>Ela pode ter sido removida na última carga.</SheetDescription>
            </SheetHeader>
          )}
        </SheetContent>
      </Sheet>
      <ConfirmarArquivar
        registro={arquivar}
        oQue="a abordagem"
        feminino
        comoVer="filtrando a situação Arquivada"
        onCancelar={() => setArquivar(null)}
        onConfirmar={(r) => {
          setArquivar(null);
          void mudarSituacao(r, "arquivado", "Abordagem arquivada.");
        }}
      />
    </div>
  );
}

/**
 * Distribuição (contrato `monetizacao-distribuicao.md`, Lista/Relatório com registro de
 * decisão): uma linha por dono atual, mais abertas primeiro; toda célula abre os negócios que
 * conta. Números iguais aos de antes (`operacao()`). Desde 09/10/2026 a última coluna é o ritmo
 * realizado no mês (`abordagensPorDiaUtil`), no lugar da capacidade do plano, que saiu com a tela
 * Capacidade e alocação.
 */
function Distribution({ data, filter, openDeals }: Cut) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const fn = useServerFn(salvarRegistroMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const owners = [
    ...new Map(data.cards.filter((c) => c.owner_id).map((c) => [c.owner_id!, c.owner])).entries(),
  ];
  const produto = filter.product ? NOMES[filter.product] : "Todos os produtos";
  const today = hoje();
  const mesCorrente = today.slice(0, 7);
  const linhas = owners
    .map(([id, name]) => {
      const f = { ...filter, owner: id };
      const v = operacao(data.cards, f);
      return { id, name, f, v, ritmo: abordagensPorDiaUtil(data.cards, id, today) };
    })
    .sort((a, b) => b.v.current.length - a.v.current.length || a.name.localeCompare(b.name));
  // A foto salva com a decisão: mesmas colunas da tela, na ordem da tela.
  const rows = linhas.map(({ id, name, v, ritmo }) => ({
    id,
    name,
    open: v.current.length,
    loaded: v.rows.loaded.length,
    started: v.rows.started.length,
    validated: v.rows.validated.length,
    abordagens_por_dia_util: ritmo.ritmo,
  }));
  const semHistorico = linhas.flatMap((l) => semHistoricoNoRecorte(data, l.f));
  const evento = estadoKpiEvento(data, semHistorico);
  const motivoEscrita = motivoSemEscopo(data);
  const save = async () => {
    setBusy(true);
    try {
      await fn({
        data: {
          kind: "distribuicao",
          title: `Decisão de distribuição · ${filter.from} a ${filter.to}`,
          body: {
            from: filter.from,
            to: filter.to,
            rows,
            reason,
            rule: "Consultoria primeiro nas unidades; preservar vínculo da conta; capacidade por hunter; produto explícito",
          },
        },
      });
      await invalidate();
      setReason("");
      toast.success("Decisão de distribuição registrada; ela aparece no histórico.");
    } catch (e) {
      toast.error(`A decisão não foi registrada: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const colunas: [string, "loaded" | "started" | "validated"][] = [
    ["Carregadas", "loaded"],
    ["Trabalhadas", "started"],
    ["Validadas", "validated"],
  ];
  return (
    <div className="space-y-6">
      <SecaoCartao
        titulo="Quem está com carga demais, e quem está sem base?"
        descricao={`Uma linha por dono atual · abertas hoje ignoram o período · ${produto} · clique no número para abrir os negócios`}
      >
        {!linhas.length ? (
          <EstadoVazio titulo="Nenhum responsável com negócio aberto neste recorte." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Responsável</TableHead>
                  <TableHead className="num text-right">Abertas hoje</TableHead>
                  {colunas.map(([rotulo]) => (
                    <TableHead key={rotulo} className="num text-right">
                      {rotulo}
                    </TableHead>
                  ))}
                  <TableHead className="num text-right">Abordagens por dia útil no mês</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map(({ id, name, f, v, ritmo }) => (
                  <TableRow key={id}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="num text-right">
                      <CelulaQueAbre
                        valor={v.current.length}
                        rotulo={`${name} · Abertas hoje`}
                        onClick={() =>
                          openDeals(`${name} · Abertas hoje`, v.current, undefined, {
                            estoque: true,
                            recorte: `${name} · ${produto} · abertas hoje`,
                          })
                        }
                      />
                    </TableCell>
                    {colunas.map(([rotulo, k]) => (
                      <TableCell key={k} className="num text-right">
                        <CelulaQueAbre
                          valor={v.rows[k].length}
                          rotulo={`${name} · ${rotulo}`}
                          onClick={() =>
                            openDeals(
                              `${name} · ${rotulo}`,
                              v.rows[k],
                              { from: filter.from, to: filter.to },
                              {
                                ordenarPor: ultimoEventoNoPeriodo(k, f),
                                recorte: `${name} · ${produto} · ${date(filter.from)} a ${date(filter.to)}`,
                              },
                            )
                          }
                        />
                      </TableCell>
                    ))}
                    <TableCell
                      className="num text-right"
                      title={`${number(ritmo.abordados.length)} abordados em ${number(ritmo.uteis)} ${ritmo.uteis === 1 ? "dia útil" : "dias úteis"} de ${rotuloMes(mesCorrente)}`}
                    >
                      {ritmo.ritmo === null ? "—" : DECIMAL.format(ritmo.ritmo)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-3">
          <NotaApoio>
            {evento.nota && `Números parciais: ${evento.nota}. `}
            Carregadas, trabalhadas e validadas são movimentos do período feitos pelo responsável;
            quem fez movimento e não é dono de nenhum negócio hoje não aparece. Abordagens por dia
            útil no mês: negócios de que a pessoa é dona hoje com a primeira abordagem em{" "}
            {rotuloMes(mesCorrente)} (fuso de São Paulo), divididos pelos dias úteis do mês até
            hoje, com uma casa decimal; não usa o período da barra. &quot;—&quot; antes do primeiro
            dia útil do mês.
          </NotaApoio>
        </div>
      </SecaoCartao>
      <div className="grid gap-6 xl:grid-cols-2">
        <SecaoCartao
          titulo="Qual é a decisão de distribuição deste período?"
          descricao={`${date(filter.from)} a ${date(filter.to)} · a tabela acima é salva junto com a decisão`}
          acoes={
            <Link
              to="/clientes"
              search={{ view: "produtos" }}
              className={`text-sm font-medium text-primary-text underline underline-offset-2 ${FOCO_VISIVEL}`}
            >
              Abrir as listas em Produtos e listas →
            </Link>
          }
        >
          <div className="space-y-4">
            <NotaApoio>
              <span className="font-medium text-foreground">Regra de distribuição</span>
              <ol className="mt-1 list-inside list-decimal space-y-1">
                <li>Preservar o vínculo da empresa com a unidade.</li>
                <li>Priorizar Consultoria nas carteiras das unidades.</li>
                <li>Mostrar Finance quando o perfil também atende à regra.</li>
                <li>Validar com o sócio e conferir a capacidade do hunter.</li>
                <li>Enviar a oferta selecionada com produto e responsável explícitos.</li>
              </ol>
            </NotaApoio>
            <Field label="Decisão e motivo desta distribuição">
              <textarea
                className={`${inputClass} h-28 py-2`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: priorizar a carteira de Curitiba para Consultoria; sócio confirmou disponibilidade nesta semana."
              />
            </Field>
            <BotaoComMotivo
              onClick={save}
              disabled={busy || !!motivoEscrita || !reason.trim()}
              motivo={[motivoEscrita, !reason.trim() && "Escreva a decisão e o motivo."]}
            >
              {busy ? "Registrando" : "Registrar decisão"}
            </BotaoComMotivo>
          </div>
        </SecaoCartao>
        <RecordList data={data} kind="distribuicao" title="Histórico de decisões" />
      </div>
    </div>
  );
}

/** A tabela por responsável como estava quando a decisão foi registrada. */
function FotoDistribuicao({
  rows,
}: {
  rows: {
    id: number;
    name: string;
    open: number;
    loaded: number;
    started: number;
    validated: number;
    /** Decisões até 09/10/2026: a capacidade do plano do mês. */
    capacity?: number | null;
    /** Decisões desde 09/10/2026: abordagens por dia útil no mês corrente. */
    abordagens_por_dia_util?: number | null;
  }[];
}) {
  // Foto antiga guarda a capacidade do plano; a nova, o ritmo do mês. Mostra a coluna que a foto tem.
  const ritmo = rows.some((l) => "abordagens_por_dia_util" in l);
  return (
    <div>
      <span className="text-xs font-medium text-muted-foreground">
        Tabela no momento da decisão
      </span>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Responsável</TableHead>
              <TableHead className="num text-right">Abertas</TableHead>
              <TableHead className="num text-right">Carregadas</TableHead>
              <TableHead className="num text-right">Trabalhadas</TableHead>
              <TableHead className="num text-right">Validadas</TableHead>
              <TableHead className="num text-right">
                {ritmo ? "Abordagens por dia útil" : "Capacidade (plano)"}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.name}</TableCell>
                <TableCell className="num text-right">{number(l.open)}</TableCell>
                <TableCell className="num text-right">{number(l.loaded)}</TableCell>
                <TableCell className="num text-right">{number(l.started)}</TableCell>
                <TableCell className="num text-right">{number(l.validated)}</TableCell>
                <TableCell className="num text-right">
                  {ritmo
                    ? l.abordagens_por_dia_util == null
                      ? "—"
                      : DECIMAL.format(l.abordagens_por_dia_util)
                    : l.capacity == null
                      ? "A definir"
                      : number(l.capacity)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const SITUACAO_PDI: Record<string, { rotulo: string; tom: TomStatus }> = {
  em_andamento: { rotulo: "Em andamento", tom: "info" },
  concluido: { rotulo: "Concluído", tom: "sucesso" },
  arquivado: { rotulo: "Arquivado", tom: "neutro" },
};

/**
 * Histórico de registros (PDI e decisões de distribuição). PDI mostra de quem é e o período
 * avaliado, esconde arquivados por padrão (`?arquivados=mostrar`) e arquiva com confirmação.
 */
function RecordList({
  data,
  kind,
  title,
  arquivados = false,
  mudarArquivados,
}: {
  data: BaseMonetizacao;
  kind: "pdi" | "distribuicao";
  title: string;
  arquivados?: boolean;
  mudarArquivados?: (mostrar: boolean) => void;
}) {
  const fn = useServerFn(salvarRegistroMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const [arquivar, setArquivar] = useState<Registro | null>(null),
    [busy, setBusy] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const todos = data.records
    .filter((r) => r.kind === kind)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const nArquivados = todos.filter((r) => r.body.status === "arquivado").length;
  const records =
    kind === "pdi" && !arquivados ? todos.filter((r) => r.body.status !== "arquivado") : todos;
  const motivoEscrita = motivoSemEscopo(data);
  const changeStatus = async (r: Registro, status: string, mensagem: string) => {
    setBusy(r.id);
    try {
      await fn({ data: { id: r.id, kind: r.kind, title: r.title, body: { ...r.body, status } } });
      await invalidate();
      toast.success(mensagem);
      // O PDI arquivado some da lista: o foco que estava nele vai para "Mostrar arquivados".
      if (status === "arquivado")
        requestAnimationFrame(() => {
          if (!document.activeElement || document.activeElement === document.body)
            toggleRef.current?.focus();
        });
    } catch (e) {
      toast.error(`O registro não foi atualizado: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const fields: Record<string, string> = {
    sample: "Evidências",
    goal: "Objetivo",
    action: "Ação",
    due: "Prazo",
    reason: "Decisão",
    rule: "Regra",
  };
  const valorDoCampo = (k: string, v: RegistroValor) =>
    k === "due" && typeof v === "string" ? date(v) : String(v);
  return (
    <SecaoCartao
      titulo={title}
      acoes={
        kind === "pdi" &&
        (nArquivados > 0 || arquivados) && (
          <Button
            ref={toggleRef}
            size="sm"
            variant={arquivados ? "secondary" : "ghost"}
            aria-pressed={arquivados}
            onClick={() => mudarArquivados?.(!arquivados)}
          >
            Mostrar arquivados ({nArquivados})
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {!todos.length ? (
          <EstadoVazio
            titulo="Nenhum registro ainda."
            descricao="As avaliações, evidências e decisões salvas ficam disponíveis à equipe com acesso à operação geral."
          />
        ) : !records.length ? (
          <EstadoVazio titulo="Todos os PDIs estão arquivados." total={todos.length} />
        ) : (
          records.map((r) => {
            const situacao =
              kind === "pdi"
                ? (SITUACAO_PDI[String(r.body.status)] ?? SITUACAO_PDI.em_andamento)
                : null;
            const ownerId = typeof r.body.owner_id === "number" ? r.body.owner_id : null;
            const periodo =
              typeof r.body.from === "string" && typeof r.body.to === "string"
                ? `${date(r.body.from)} a ${date(r.body.to)}`
                : null;
            const aberto = r.body.status !== "concluido" && r.body.status !== "arquivado";
            return (
              <details key={r.id} className="rounded-lg border p-3">
                <summary className={`cursor-pointer text-sm font-medium ${FOCO_VISIVEL}`}>
                  <span className="inline-flex flex-wrap items-center gap-2 align-middle">
                    {r.title}
                    {situacao && <StatusBadge tom={situacao.tom}>{situacao.rotulo}</StatusBadge>}
                  </span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {[
                      kind === "pdi" &&
                        `PDI de ${ownerId === null ? "responsável não registrado" : nomeDoDono(data, ownerId)}`,
                      periodo && (kind === "pdi" ? `amostra de ${periodo}` : `período ${periodo}`),
                      `atualizado em ${date(r.updated_at)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </summary>
                <div className="mt-3 space-y-3">
                  {Object.entries(fields)
                    .filter(([k]) => r.body[k])
                    .map(([k, label]) => (
                      <div key={k}>
                        <span className="text-xs font-medium text-muted-foreground">{label}</span>
                        <p className="whitespace-pre-wrap text-sm">{valorDoCampo(k, r.body[k])}</p>
                      </div>
                    ))}
                  {Array.isArray(r.body.rows) && <FotoDistribuicao rows={r.body.rows} />}
                  {r.body.scores && typeof r.body.scores === "object" ? (
                    <ul className="space-y-1 text-xs">
                      {Object.entries(r.body.scores).map(([c, n]) => (
                        <li key={c}>
                          {c}: {Number(n) || "Não avaliado"}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {kind === "pdi" && r.body.status !== "arquivado" && (
                    <div className="flex flex-wrap gap-2">
                      {aberto && (
                        <BotaoComMotivo
                          size="sm"
                          variant="outline"
                          disabled={!!motivoEscrita || busy === r.id}
                          motivo={motivoEscrita}
                          onClick={() =>
                            changeStatus(r, "concluido", "PDI marcado como concluído.")
                          }
                        >
                          Marcar concluído
                        </BotaoComMotivo>
                      )}
                      <BotaoComMotivo
                        size="sm"
                        variant="ghost"
                        disabled={!!motivoEscrita || busy === r.id}
                        motivo={motivoEscrita}
                        onClick={() => setArquivar(r)}
                      >
                        Arquivar
                      </BotaoComMotivo>
                    </div>
                  )}
                </div>
              </details>
            );
          })
        )}
      </div>
      <ConfirmarArquivar
        registro={arquivar}
        oQue="o PDI"
        onCancelar={() => setArquivar(null)}
        onConfirmar={(r) => {
          setArquivar(null);
          void changeStatus(r, "arquivado", "PDI arquivado.");
        }}
      />
    </SecaoCartao>
  );
}

/** Arquivar pede confirmação (V6): o registro sai da lista padrão. */
function ConfirmarArquivar({
  registro,
  oQue,
  feminino = false,
  comoVer = "em Mostrar arquivados",
  onCancelar,
  onConfirmar,
}: {
  registro: Registro | null;
  /** "o PDI", "a abordagem". */
  oQue: string;
  /** Concordância do texto: "ela continua salva" em vez de "ele continua salvo". */
  feminino?: boolean;
  /** Como ver o arquivado depois: "filtrando a situação Arquivada". */
  comoVer?: string;
  onCancelar: () => void;
  onConfirmar: (r: Registro) => void;
}) {
  const foco = useFocoDeVolta();
  const o = feminino ? "a" : "o";
  return (
    <AlertDialog open={!!registro} onOpenChange={(aberto) => !aberto && onCancelar()}>
      <AlertDialogContent
        onOpenAutoFocus={foco.onOpenAutoFocus}
        onCloseAutoFocus={foco.onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Arquivar {registro?.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            Arquivar tira {oQue} da lista padrão; {feminino ? "ela" : "ele"} continua salv{o} e pode
            ser vist{o} {comoVer}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => registro && onConfirmar(registro)}>
            Arquivar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
