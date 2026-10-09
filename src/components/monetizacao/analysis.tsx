import { useRef, useState, type ReactNode } from "react";
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
import { NOMES, NOMES_ROTEIRO, PRODUTOS_ROTEIRO } from "@/lib/monetizacao/types";
import type {
  BaseMonetizacao,
  Metrica,
  Negocio,
  ProdutoRoteiro,
  Registro,
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
  /** Estado da tela na URL (`situacao`, `produto`): Abordagens lê e grava aqui. */
  busca?: BuscaMonetizacao;
  mudarBusca?: (patch: Partial<BuscaMonetizacao>) => void;
};
// Temporal e previsão, Projetado × realizado, Capacidade e alocação e Follow Day saíram do menu em 09/10/2026
// (aprovado pelo dono do produto); o link antigo abre a Operação diária com aviso (busca.ts, ABAS_APOSENTADAS).
// Pessoas e PDI saiu no mesmo dia (decisão 1A do PRD da Pré-venda): o formulário manual de PDI (People) e o histórico
// de PDI foram removidos; o link antigo abre a Pré-venda › Aderência. Os registros `kind = "pdi"` ficam em
// ops.monetizacao_registros, sem tela.
export function Analysis(props: Props) {
  const { aba, data, filter, openDeals } = props;
  if (aba === "funil") return <Funnel data={data} filter={filter} openDeals={openDeals} />;
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
/** Uma casa decimal, para ritmo (abordagens por dia útil). */
const DECIMAL = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const juntarNotas = (...partes: (string | undefined | false | null)[]) =>
  partes.filter(Boolean).join(" · ") || undefined;

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

/**
 * Histórico das decisões de distribuição: o que foi decidido, a regra e a foto da tabela por responsável.
 * Até 09/10/2026 servia também ao histórico de PDI, que saiu com a tela Pessoas e PDI (decisão 1A).
 */
function RecordList({
  data,
  kind,
  title,
}: {
  data: BaseMonetizacao;
  kind: "distribuicao";
  title: string;
}) {
  const registros = data.records
    .filter((r) => r.kind === kind)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const fields: Record<string, string> = {
    reason: "Decisão",
    rule: "Regra",
  };
  return (
    <SecaoCartao titulo={title}>
      <div className="space-y-3">
        {!registros.length ? (
          <EstadoVazio
            titulo="Nenhum registro ainda."
            descricao="As decisões salvas ficam disponíveis à equipe com acesso à operação geral."
          />
        ) : (
          registros.map((r) => {
            const periodo =
              typeof r.body.from === "string" && typeof r.body.to === "string"
                ? `${date(r.body.from)} a ${date(r.body.to)}`
                : null;
            return (
              <details key={r.id} className="rounded-lg border p-3">
                <summary className={`cursor-pointer text-sm font-medium ${FOCO_VISIVEL}`}>
                  {r.title}
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {[periodo && `período ${periodo}`, `atualizado em ${date(r.updated_at)}`]
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
                        <p className="whitespace-pre-wrap text-sm">{String(r.body[k])}</p>
                      </div>
                    ))}
                  {Array.isArray(r.body.rows) && <FotoDistribuicao rows={r.body.rows} />}
                </div>
              </details>
            );
          })
        )}
      </div>
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
