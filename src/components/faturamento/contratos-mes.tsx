import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Carregando,
  ChipFiltro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Procedencia,
  StatusBadge,
} from "@/components/planning";
import {
  useContratoDetalhe,
  useContratosMes,
  usePessoasContrato,
  useReler,
} from "@/hooks/use-faturamento";
import { desembrulhar, tipoDoErro } from "@/lib/faturamento/erros";
import {
  confirmarContratos,
  repassarContrato,
  responderContrato,
} from "@/lib/faturamento/faturamento.functions";
import {
  contagem,
  dataCompleta,
  diaMes,
  dinheiro,
  documento,
  horaSP,
} from "@/lib/faturamento/formato";
import {
  diferenca,
  faltaNaResposta,
  filtrarContratos,
  gruposPorProjeto,
  HIGIENES_MES,
  mesAnteriorCurto,
  MOTIVOS,
  numerosDoMes,
  procedenciaRecorrente,
  respostasDaLinha,
  ROTULO_RESPOSTA,
  rotuloCompetencia,
  seloDaLinha,
  selosDoMotivo,
  SITUACOES_MES,
  temFiltroContratos,
  textoAcaoContrato,
  textoDiferenca,
  textoPrazo,
  valorDigitado,
  type BuscaContratos,
  type LinhaContrato,
  type TipoResposta,
} from "@/lib/faturamento/recorrente";
import { AREA_FATURAMENTO, ErroDaArea, PaginaFaturamento } from "./moldura";

/**
 * Contratos do mês (`/faturamento/contratos`), arquétipo Fila de trabalho. Contrato
 * `docs/design/contratos/faturamento-contratos.md`: "Quais contratos do mês precisam da minha resposta?".
 *
 * O dono responde só o contrato que mudou (decisão 3 de 29/10/2026); o resto fatura sozinho. Por empresa, agrupado
 * por projeto, com o que precisa de resposta em cima. A linha abre um `Sheet` com o contrato e as respostas, sem
 * trocar de rota; mês, empresa, filtros e o contrato aberto moram na URL (N7).
 */

const TITULO = "Contratos do mês";
const PERGUNTA = "Quais contratos do mês precisam da minha resposta?";

const fichaClasse = (ativo: boolean) =>
  ativo
    ? "inline-flex h-8 items-center gap-1.5 rounded-full border border-input bg-accent px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    : "inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-sm text-muted-foreground outline-none transition-colors duration-[120ms] hover:border-input hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** A linha pode entrar no "Confirmar selecionados". */
const confirmavel = (l: LinhaContrato) =>
  l.pode_responder && l.situacao === "precisa_resposta" && !l.motivos.includes("sumiu");

export function ContratosDoMes({ busca }: { busca: BuscaContratos }) {
  const navigate = useNavigate();
  const competencia = busca.mes ? `${busca.mes}-01` : null;
  const q = useContratosMes(competencia);
  const agora = useMemo(() => new Date(), []);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());

  const mudar = (parcial: Partial<BuscaContratos>) =>
    void navigate({
      to: "/faturamento/contratos",
      search: { ...busca, ...parcial },
      replace: true,
      resetScroll: false,
    });

  const d = q.data;
  const escolhida =
    busca.empresa && busca.empresa !== "todas"
      ? d?.empresas.find((e) => e.apelido === busca.empresa)
      : undefined;
  const daEmpresa = useMemo(
    () => (d ? d.linhas.filter((l) => !escolhida || l.emissora.id === escolhida.id) : []),
    [d, escolhida],
  );
  const numeros = useMemo(() => numerosDoMes(daEmpresa, agora), [daEmpresa, agora]);
  const filtradas = useMemo(
    () => filtrarContratos(daEmpresa, busca, agora),
    [daEmpresa, busca, agora],
  );
  const { grupos, automacao } = useMemo(() => gruposPorProjeto(filtradas), [filtradas]);
  const projetos = useMemo(
    () =>
      [...new Set(daEmpresa.map((l) => l.projeto ?? "Sem projeto"))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [daEmpresa],
  );
  const dias = useMemo(
    () =>
      [...new Set(daEmpresa.map((l) => l.dia_faturamento).filter((x): x is number => !!x))].sort(
        (a, b) => a - b,
      ),
    [daEmpresa],
  );

  const fonte = procedenciaRecorrente(d?.procedencia);
  const descricao = d
    ? `Contratos recorrentes de ${escolhida ? escolhida.apelido : "todas as suas empresas"} · competência ${rotuloCompetencia(d.competencia)} · contrato`
    : undefined;
  const cabecalho = (acoes?: ReactNode) => (
    <PageHeader
      area={AREA_FATURAMENTO}
      titulo={TITULO}
      pergunta={PERGUNTA}
      descricao={descricao}
      procedencia={{ fonte, atualizadoEm: d?.procedencia.contratos_lidos_em }}
      acoes={acoes}
    />
  );

  if (q.isPending)
    return (
      <PaginaFaturamento>
        {cabecalho()}
        <Carregando variante="tabela" />
      </PaginaFaturamento>
    );
  if (q.error || !d)
    return (
      <PaginaFaturamento>
        {cabecalho()}
        {tipoDoErro(q.error) === "sem_acesso" ? (
          <EstadoSemAcesso oQueFalta="Faturamento" />
        ) : (
          <ErroDaArea erro={q.error} tentarNovamente={() => void q.refetch()} />
        )}
      </PaginaFaturamento>
    );
  if (!d.responde_por_alguma && !d.ve_tudo)
    return (
      <PaginaFaturamento>
        {cabecalho()}
        <EstadoVazio
          titulo="Você não responde por contrato de nenhuma empresa."
          descricao="Quem cadastra os donos de cada empresa é a controladoria."
        />
      </PaginaFaturamento>
    );

  const visiveis = [...grupos.flatMap((g) => g.linhas), ...automacao];
  const selecionaveis = visiveis.filter(confirmavel);
  const marcados = selecionaveis.filter((l) => selecao.has(l.id));
  const mesAnterior = mesAnteriorCurto(d.competencia);

  return (
    <PaginaFaturamento>
      {cabecalho()}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={d.competencia.slice(0, 7)}
          onValueChange={(v) => mudar({ mes: v, contrato: undefined })}
        >
          <SelectTrigger className="h-8 w-36" aria-label="Mês">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(d.competencias.length ? d.competencias : [d.competencia]).map((c) => (
              <SelectItem key={c} value={c.slice(0, 7)}>
                {rotuloCompetencia(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {d.empresas.length > 1 && (
          <div role="group" aria-label="Empresa" className="flex flex-wrap items-center gap-2">
            {d.empresas.map((e) => (
              <button
                key={e.id}
                type="button"
                aria-pressed={busca.empresa === e.apelido}
                className={fichaClasse(busca.empresa === e.apelido)}
                onClick={() => mudar({ empresa: e.apelido, contrato: undefined })}
              >
                {e.apelido} <span className="num">{e.precisa_resposta}</span>
              </button>
            ))}
            <button
              type="button"
              aria-pressed={!escolhida}
              className={fichaClasse(!escolhida)}
              onClick={() => mudar({ empresa: "todas", contrato: undefined })}
            >
              Todas{" "}
              <span className="num">{d.empresas.reduce((n, e) => n + e.precisa_resposta, 0)}</span>
            </button>
          </div>
        )}
      </div>

      {d.procedencia.empresas_sem_leitura_hoje.length > 0 && (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          Contratos de {d.procedencia.empresas_sem_leitura_hoje.join(", ")} não foram lidos do Omie
          hoje: o que mudou depois da última leitura não aparece.
        </p>
      )}

      <KpiGrade colunas={3}>
        <KpiCard
          rotulo="Precisam de resposta"
          valor={numeros.precisa_resposta.quantidade}
          unidade={numeros.precisa_resposta.quantidade === 1 ? "contrato" : "contratos"}
          nota={dinheiro(numeros.precisa_resposta.valor)}
          abrir={{
            onClick: () =>
              mudar({
                situacao: busca.situacao === "precisa_resposta" ? undefined : "precisa_resposta",
              }),
            rotulo: busca.situacao === "precisa_resposta" ? "Tirar filtro" : "Filtrar",
          }}
        />
        <KpiCard
          rotulo="Faturam sozinhos"
          valor={numeros.fatura_sozinho.quantidade}
          unidade={numeros.fatura_sozinho.quantidade === 1 ? "contrato" : "contratos"}
          nota={dinheiro(numeros.fatura_sozinho.valor)}
          abrir={{
            onClick: () =>
              mudar({
                situacao: busca.situacao === "fatura_sozinho" ? undefined : "fatura_sozinho",
              }),
            rotulo: busca.situacao === "fatura_sozinho" ? "Tirar filtro" : "Filtrar",
          }}
        />
        <KpiCard
          rotulo="Respondidos"
          valor={numeros.respondidos.quantidade}
          unidade={numeros.respondidos.quantidade === 1 ? "contrato" : "contratos"}
          nota={`${dinheiro(numeros.respondidos.valor)} a faturar`}
          abrir={{
            onClick: () =>
              mudar({ situacao: busca.situacao === "respondidos" ? undefined : "respondidos" }),
            rotulo: busca.situacao === "respondidos" ? "Tirar filtro" : "Filtrar",
          }}
        />
      </KpiGrade>

      <div role="group" aria-label="Higiene" className="flex flex-wrap items-center gap-2">
        {HIGIENES_MES.map((h) => {
          const n = numeros.higiene[h.valor];
          const ativo = busca.higiene === h.valor;
          return (
            <button
              key={h.valor}
              type="button"
              aria-pressed={ativo}
              onClick={() => mudar({ higiene: ativo ? undefined : h.valor })}
              className={
                ativo
                  ? "inline-flex h-8 items-center gap-2 rounded-full border border-input bg-accent px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  : "inline-flex h-8 items-center gap-2 rounded-full border bg-card px-3 text-sm text-foreground outline-none transition-colors duration-[120ms] hover:border-input focus-visible:ring-2 focus-visible:ring-ring"
              }
            >
              {h.rotulo}
              <StatusBadge
                tom={n > 0 ? (h.valor === "sumiu" ? "perigo" : "atencao") : "neutro"}
                icone={n > 0 ? undefined : false}
              >
                {n}
              </StatusBadge>
            </button>
          );
        })}
      </div>

      <Filtros
        busca={busca}
        mudar={mudar}
        projetos={projetos}
        dias={dias}
        total={filtradas.length}
        totalEmpresa={daEmpresa.length}
      />

      {numeros.precisa_resposta.quantidade === 0 &&
        !temFiltroContratos(busca) &&
        daEmpresa.length > 0 && (
          <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
            Nenhum contrato precisa da sua resposta em {rotuloCompetencia(d.competencia)}.{" "}
            {contagem(
              numeros.fatura_sozinho.quantidade,
              "contrato fatura sozinho",
              "contratos faturam sozinhos",
            )}
            .
          </p>
        )}

      {marcados.length > 0 && (
        <ConfirmarSelecionados
          ids={marcados.map((l) => l.id)}
          valor={marcados.reduce((s, l) => s + (l.valor_contrato ?? 0), 0)}
          aoTerminar={() => setSelecao(new Set())}
        />
      )}

      {daEmpresa.length === 0 ? (
        <EstadoVazio
          titulo={`Nenhum contrato em ${rotuloCompetencia(d.competencia)}.`}
          descricao="Os contratos aparecem depois da leitura diária do Omie (6h). Se a empresa tem contrato e nada aparece, avise o time do Brain."
        />
      ) : filtradas.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum contrato encontrado"
          total={daEmpresa.length}
          acao={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                mudar({
                  projeto: undefined,
                  motivo: undefined,
                  situacao: undefined,
                  higiene: undefined,
                  dia: undefined,
                  busca: undefined,
                })
              }
            >
              Limpar filtros
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Selecionar os contratos que podem ser confirmados"
                    checked={
                      selecionaveis.length > 0 && marcados.length === selecionaveis.length
                        ? true
                        : marcados.length > 0
                          ? "indeterminate"
                          : false
                    }
                    disabled={selecionaveis.length === 0}
                    onCheckedChange={(v) =>
                      setSelecao(v === true ? new Set(selecionaveis.map((l) => l.id)) : new Set())
                    }
                  />
                </TableHead>
                <TableHead>Cliente</TableHead>
                {!escolhida && <TableHead>Empresa</TableHead>}
                <TableHead>Contrato</TableHead>
                <TableHead>Fatura em</TableHead>
                <TableHead className="num text-right">Mês anterior</TableHead>
                <TableHead className="num text-right">Este mês</TableHead>
                <TableHead className="num text-right">Diferença</TableHead>
                <TableHead>O que mudou</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Responder até</TableHead>
                <TableHead>
                  <span className="sr-only">Ação</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grupos.flatMap((g) => [
                <TableRow key={`g-${g.projeto}`} className="bg-muted/40 hover:bg-muted/40">
                  <TableCell
                    colSpan={escolhida ? 11 : 12}
                    className="text-[13px] text-muted-foreground"
                  >
                    <span className="font-semibold uppercase tracking-wider">{g.projeto}</span>
                    {" · "}
                    {contagem(g.linhas.length, "contrato")} · {mesAnterior}{" "}
                    {dinheiro(g.mes_anterior)} · {rotuloCompetencia(d.competencia).split("/")[0]}{" "}
                    {dinheiro(g.este_mes)}
                    {g.precisa > 0 && ` · ${g.precisa} para responder`}
                  </TableCell>
                </TableRow>,
                ...g.linhas.map((l) => (
                  <LinhaTabela
                    key={l.id}
                    l={l}
                    competencia={d.competencia}
                    mostraEmpresa={!escolhida}
                    marcado={selecao.has(l.id)}
                    marcar={(v) =>
                      setSelecao((s) => {
                        const n = new Set(s);
                        if (v) n.add(l.id);
                        else n.delete(l.id);
                        return n;
                      })
                    }
                    abrir={() => mudar({ contrato: l.id })}
                  />
                )),
              ])}
            </TableBody>
          </Table>
          {automacao.length > 0 && (
            <Collapsible className="border-t">
              <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <ChevronDown
                  className="size-4 transition-transform group-data-[state=open]:rotate-180"
                  aria-hidden
                />
                Faturados pela automação do Omie (até {diaMes(d.inicio_portal)}) ·{" "}
                {contagem(automacao.length, "contrato")} ·{" "}
                {dinheiro(automacao.reduce((s, l) => s + (l.valor_contrato ?? 0), 0))}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Table>
                  <TableBody>
                    {automacao.map((l) => (
                      <LinhaTabela
                        key={l.id}
                        l={l}
                        competencia={d.competencia}
                        mostraEmpresa={!escolhida}
                        marcado={false}
                        marcar={() => {}}
                        abrir={() => mudar({ contrato: l.id })}
                      />
                    ))}
                  </TableBody>
                </Table>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      <Procedencia fonte={fonte} atualizadoEm={d.procedencia.contratos_lidos_em} />
      <SheetDoContrato
        id={busca.contrato ?? null}
        competencia={d.competencia}
        aoFechar={() => mudar({ contrato: undefined })}
      />
    </PaginaFaturamento>
  );
}

// ------------------------------------------------------------------ linha

function LinhaTabela({
  l,
  competencia,
  mostraEmpresa,
  marcado,
  marcar,
  abrir,
}: {
  l: LinhaContrato;
  competencia: string;
  mostraEmpresa: boolean;
  marcado: boolean;
  marcar: (v: boolean) => void;
  abrir: () => void;
}) {
  const selo = seloDaLinha(l);
  const dif = diferenca(l);
  return (
    <TableRow
      tabIndex={0}
      className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={abrir}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && abrir()}
    >
      <TableCell onClick={(e) => e.stopPropagation()} className="w-10">
        {confirmavel(l) && (
          <Checkbox
            aria-label={`Selecionar ${l.cliente_nome ?? "contrato"}`}
            checked={marcado}
            onCheckedChange={(v) => marcar(v === true)}
          />
        )}
      </TableCell>
      <TableCell className="min-w-[14rem]">
        <span className="block font-medium text-foreground">{l.cliente_nome ?? "—"}</span>
        <span className="num block text-[13px] text-muted-foreground">
          {documento(l.documento) ?? "—"}
        </span>
      </TableCell>
      {mostraEmpresa && <TableCell>{l.emissora.apelido}</TableCell>}
      <TableCell className="min-w-[9rem]">
        <span className="num block">{l.numero_contrato ?? l.codigo_contrato}</span>
        <span className="block max-w-[14rem] truncate text-[13px] text-muted-foreground">
          {l.servico ?? ""}
        </span>
      </TableCell>
      <TableCell className="num whitespace-nowrap">{diaMes(l.data_corte) ?? "—"}</TableCell>
      <TableCell className="num whitespace-nowrap text-right">
        {dinheiro(l.valor_mes_anterior)}
      </TableCell>
      <TableCell className="num whitespace-nowrap text-right">
        {dinheiro(l.valor_faturar ?? l.valor_contrato)}
      </TableCell>
      <TableCell className="num whitespace-nowrap text-right text-[13px]">
        {textoDiferenca(dif)}
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap gap-1">
          {selosDoMotivo(l, competencia).map((s) => (
            <StatusBadge key={s.texto} tom={s.tom} icone={false}>
              {s.texto}
            </StatusBadge>
          ))}
        </span>
      </TableCell>
      <TableCell>
        <StatusBadge tom={selo.tom}>{selo.rotulo}</StatusBadge>
        {l.repassado_para?.nome && (
          <span className="mt-1 block text-[13px] text-muted-foreground">
            com {l.repassado_para.nome}
          </span>
        )}
      </TableCell>
      <TableCell className="num whitespace-nowrap text-[13px]">
        {l.situacao === "precisa_resposta" ? textoPrazo(l.responder_ate) : ""}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        {l.situacao === "precisa_resposta" && l.pode_responder && (
          <Button size="sm" onClick={abrir}>
            Responder
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

// ------------------------------------------------------------------ filtros

function Filtros({
  busca,
  mudar,
  projetos,
  dias,
  total,
  totalEmpresa,
}: {
  busca: BuscaContratos;
  mudar: (p: Partial<BuscaContratos>) => void;
  projetos: string[];
  dias: number[];
  total: number;
  totalEmpresa: number;
}) {
  const situacao = SITUACOES_MES.find((s) => s.valor === busca.situacao);
  const motivo = MOTIVOS.find((m) => m.valor === busca.motivo);
  const higiene = HIGIENES_MES.find((h) => h.valor === busca.higiene);
  return (
    <div className="space-y-2">
      <BarraFiltros
        aoLimpar={
          temFiltroContratos(busca)
            ? () =>
                mudar({
                  projeto: undefined,
                  motivo: undefined,
                  situacao: undefined,
                  higiene: undefined,
                  dia: undefined,
                  busca: undefined,
                })
            : undefined
        }
      >
        <label className="relative">
          <span className="sr-only">Buscar por cliente, CNPJ ou número do contrato</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            key={busca.busca ?? ""}
            defaultValue={busca.busca ?? ""}
            placeholder="Cliente, CNPJ ou contrato"
            className="h-8 w-64 pl-8"
            onKeyDown={(e) => {
              if (e.key === "Enter")
                mudar({ busca: (e.target as HTMLInputElement).value.trim() || undefined });
            }}
            onBlur={(e) => {
              const v = e.target.value.trim() || undefined;
              if (v !== busca.busca) mudar({ busca: v });
            }}
          />
        </label>
        <Select
          value={busca.projeto ?? "todos"}
          onValueChange={(v) => mudar({ projeto: v === "todos" ? undefined : v })}
        >
          <SelectTrigger className="h-8 w-56" aria-label="Projeto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os projetos</SelectItem>
            {projetos.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={busca.motivo ?? "todos"}
          onValueChange={(v) =>
            mudar({ motivo: v === "todos" ? undefined : (v as BuscaContratos["motivo"]) })
          }
        >
          <SelectTrigger className="h-8 w-48" aria-label="O que mudou">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Qualquer mudança</SelectItem>
            {MOTIVOS.map((m) => (
              <SelectItem key={m.valor} value={m.valor}>
                {m.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={busca.situacao ?? "todas"}
          onValueChange={(v) =>
            mudar({ situacao: v === "todas" ? undefined : (v as BuscaContratos["situacao"]) })
          }
        >
          <SelectTrigger className="h-8 w-56" aria-label="Situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as situações</SelectItem>
            {SITUACOES_MES.map((s) => (
              <SelectItem key={s.valor} value={s.valor}>
                {s.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={busca.dia ? String(busca.dia) : "todos"}
          onValueChange={(v) => mudar({ dia: v === "todos" ? undefined : Number(v) })}
        >
          <SelectTrigger className="h-8 w-44" aria-label="Dia de faturamento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Qualquer dia</SelectItem>
            {dias.map((x) => (
              <SelectItem key={x} value={String(x)}>
                Fatura no dia {x}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </BarraFiltros>
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        {situacao && (
          <ChipFiltro
            rotulo="Situação"
            valor={situacao.rotulo}
            aoRemover={() => mudar({ situacao: undefined })}
          />
        )}
        {higiene && (
          <ChipFiltro
            rotulo="Higiene"
            valor={higiene.rotulo}
            aoRemover={() => mudar({ higiene: undefined })}
          />
        )}
        {motivo && (
          <ChipFiltro
            rotulo="O que mudou"
            valor={motivo.rotulo}
            aoRemover={() => mudar({ motivo: undefined })}
          />
        )}
        {busca.projeto && (
          <ChipFiltro
            rotulo="Projeto"
            valor={busca.projeto}
            aoRemover={() => mudar({ projeto: undefined })}
          />
        )}
        {busca.dia && (
          <ChipFiltro
            rotulo="Dia"
            valor={`dia ${busca.dia}`}
            aoRemover={() => mudar({ dia: undefined })}
          />
        )}
        {busca.busca && (
          <ChipFiltro
            rotulo="Busca"
            valor={busca.busca}
            aoRemover={() => mudar({ busca: undefined })}
          />
        )}
        <span className="num ml-auto text-[13px] text-muted-foreground">
          {contagem(total, "contrato")} de {totalEmpresa}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ confirmar selecionados

function ConfirmarSelecionados({
  ids,
  valor,
  aoTerminar,
}: {
  ids: string[];
  valor: number;
  aoTerminar: () => void;
}) {
  const reler = useReler();
  const fn = useServerFn(confirmarContratos);
  const m = useMutation({
    mutationFn: async () => desembrulhar(await fn({ data: { ids } })),
    onSuccess: (r) => {
      toast.success(
        `${contagem(r.confirmados, "contrato confirmado", "contratos confirmados")}${
          r.recusados.length ? `; ${r.recusados.length} não: ${r.recusados[0].mensagem}` : ""
        }`,
      );
      aoTerminar();
      void reler();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "A confirmação não foi feita."),
  });
  return (
    <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2 shadow-sm">
      <span className="text-sm">
        {contagem(ids.length, "contrato selecionado", "contratos selecionados")} · {dinheiro(valor)}
      </span>
      <Button size="sm" disabled={m.isPending} onClick={() => m.mutate()}>
        {m.isPending ? "Confirmando…" : "Confirmar selecionados"}
      </Button>
      <Button size="sm" variant="ghost" onClick={aoTerminar} disabled={m.isPending}>
        Limpar seleção
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ sheet do contrato

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h3>
      <div className="text-sm text-foreground">{children}</div>
    </section>
  );
}

const TEXTO_RESPOSTA: Record<TipoResposta, (l: LinhaContrato) => string> = {
  confirmar: (l) => `Confirmado: fatura ${dinheiro(l.valor_contrato)}`,
  ajustar: (l) =>
    `Valor deste mês: ${dinheiro(l.resposta?.valor ?? null)}${l.resposta?.permanente ? " (vale para os próximos meses)" : ""}`,
  nao_faturar: () => "Não fatura este mês",
  renovar: (l) => `Renovado até ${dataCompleta(l.resposta?.vigencia) ?? "—"}`,
  encerrar: () => "Fatura este mês e encerra o contrato",
  faturar_mes: (l) => `Faturar este mês: ${dinheiro(l.resposta?.valor ?? null)}`,
  cliente_saiu: () => "Cliente saiu: não fatura e encerra o contrato",
};

function SheetDoContrato({
  id,
  competencia,
  aoFechar,
}: {
  id: string | null;
  competencia: string;
  aoFechar: () => void;
}) {
  const q = useContratoDetalhe(id, !!id);
  const c = q.data;
  return (
    <Sheet open={!!id} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {!c ? (
          <div className="pt-8">
            {q.error ? (
              tipoDoErro(q.error) === "sem_acesso" ? (
                <EstadoSemAcesso oQueFalta="Faturamento · dono desta empresa" />
              ) : (
                <ErroDaArea erro={q.error} tentarNovamente={() => void q.refetch()} />
              )
            ) : (
              <Carregando variante="tabela" linhas={4} />
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {c.cliente_nome ?? "Contrato"}{" "}
                <StatusBadge tom={seloDaLinha(c).tom}>{seloDaLinha(c).rotulo}</StatusBadge>
              </SheetTitle>
              <SheetDescription>
                {[
                  `contrato ${c.numero_contrato ?? c.codigo_contrato}`,
                  c.emissora.apelido,
                  documento(c.documento),
                  c.projeto,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </SheetDescription>
            </SheetHeader>

            {selosDoMotivo(c, competencia).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selosDoMotivo(c, competencia).map((s) => (
                  <StatusBadge key={s.texto} tom={s.tom} icone={false}>
                    {s.texto}
                  </StatusBadge>
                ))}
              </div>
            )}

            <Bloco titulo="Este mês">
              <p className="num">
                {dinheiro(c.valor_faturar ?? c.valor_contrato)} · fatura em{" "}
                {dataCompleta(c.data_corte)}
                {c.dia_faturamento ? ` (dia ${c.dia_faturamento} no Omie)` : ""}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {c.situacao === "automacao_omie"
                  ? "Sai pela automação do Omie neste mês, sem resposta do dono."
                  : `Responder até ${textoPrazo(c.responder_ate)}`}
              </p>
            </Bloco>
            <Bloco titulo="Itens do contrato">
              {c.itens.length ? (
                <ul className="space-y-1">
                  {c.itens.map((i, n) => (
                    <li key={n} className="flex justify-between gap-3">
                      <span>
                        {i.servico ?? "Serviço"}
                        {i.quantidade && i.quantidade !== 1 ? ` · ${i.quantidade}×` : ""}
                      </span>
                      <span className="num">{dinheiro(i.valor_total)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                "—"
              )}
            </Bloco>
            <Bloco titulo="Vigência">
              {dataCompleta(c.vigencia_inicial) ?? "—"} até{" "}
              {dataCompleta(c.vigencia_final) ?? "sem fim"}
              {c.dia_vencimento ? ` · vence no dia ${c.dia_vencimento}` : ""}
            </Bloco>
            <Bloco titulo="Notas dos últimos meses">
              {c.notas.length ? (
                <ul className="num space-y-1 text-[13px]">
                  {c.notas.map((n, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>
                        {n.tipo === "recibo" ? "Recibo" : "NF"} {n.numero ?? "—"} ·{" "}
                        {dataCompleta(n.emitida_em)}
                        {n.cancelada ? " · cancelada" : ""}
                      </span>
                      <span>{dinheiro(n.valor)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted-foreground">
                  Nenhuma nota deste contrato nos três meses anteriores.
                </span>
              )}
            </Bloco>
            {c.resposta && (
              <Bloco titulo="Resposta">
                <p>{TEXTO_RESPOSTA[c.resposta.tipo](c)}</p>
                <p className="text-[13px] text-muted-foreground">
                  {[
                    c.resposta.motivo,
                    c.resposta.por?.nome,
                    `${diaMes(c.resposta.em)} ${horaSP(c.resposta.em)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {textoAcaoContrato(c) && (
                  <p className="text-[13px] text-muted-foreground">
                    Tesouraria no Omie: {textoAcaoContrato(c)}
                    {c.feito_omie ? " · feito" : ""}
                  </p>
                )}
              </Bloco>
            )}
            {c.historico.length > 0 && (
              <Bloco titulo="Histórico">
                <ul className="space-y-1 text-[13px] text-muted-foreground">
                  {c.historico.map((h, i) => (
                    <li key={i}>
                      {diaMes(h.em)} {horaSP(h.em)} · {h.autor?.nome ?? "—"} · {eventoLegivel(h)}
                    </li>
                  ))}
                </ul>
              </Bloco>
            )}
            {c.pode_responder && (
              <div className="sticky bottom-0 -mx-6 space-y-3 border-t bg-surface-elevated px-6 py-3">
                <FormResposta linha={c} />
                <Repasse linha={c} />
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function eventoLegivel(h: {
  evento: string;
  diff: Record<string, string | number | boolean | null>;
}): string {
  const r =
    typeof h.diff.resposta === "string" ? (h.diff.resposta as TipoResposta | "desfazer") : null;
  if (h.evento === "contrato_respondido" && r && r !== "desfazer")
    return `respondeu: ${ROTULO_RESPOSTA[r]}`;
  if (h.evento === "contrato_resposta_desfeita") return "desfez a resposta";
  if (h.evento === "contrato_repassado") return "repassou o contrato";
  if (h.evento === "contrato_feito_omie") return "aplicou no Omie";
  if (h.evento === "contrato_feito_omie_desfeito") return "desmarcou o feito no Omie";
  return h.evento;
}

function FormResposta({ linha }: { linha: LinhaContrato }) {
  const reler = useReler();
  const fn = useServerFn(responderContrato);
  const opcoes = respostasDaLinha(linha);
  const [tipo, setTipo] = useState<TipoResposta | null>(null);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [vigencia, setVigencia] = useState("");
  const [permanente, setPermanente] = useState(false);
  const m = useMutation({
    mutationFn: async (r: TipoResposta | "desfazer") =>
      desembrulhar(
        await fn({
          data: {
            id: linha.id,
            resposta: r,
            valor: r === "ajustar" || r === "faturar_mes" ? valorDigitado(valor) : null,
            motivo: motivo.trim() || null,
            vigencia:
              r === "renovar" || (r === "faturar_mes" && vigencia) ? vigencia || null : null,
            permanente: r === "ajustar" ? permanente : false,
          },
        }),
      ),
    onSuccess: (_l, r) => {
      toast.success(r === "desfazer" ? "Resposta desfeita." : "Resposta salva.");
      setTipo(null);
      void reler();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "A resposta não foi salva."),
  });
  const falta = tipo
    ? faltaNaResposta(tipo, { valor, motivo, vigencia }, linha.data_faturamento)
    : null;
  const pedeValor = tipo === "ajustar" || tipo === "faturar_mes";
  const pedeMotivo =
    tipo === "ajustar" ||
    tipo === "nao_faturar" ||
    tipo === "faturar_mes" ||
    tipo === "cliente_saiu";
  const pedeVigencia = tipo === "renovar" || tipo === "faturar_mes";
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Resposta" className="flex flex-wrap gap-2">
        {opcoes.map((o) => (
          <Button
            key={o}
            size="sm"
            variant={tipo === o ? "default" : "outline"}
            aria-pressed={tipo === o}
            onClick={() => setTipo(tipo === o ? null : o)}
          >
            {ROTULO_RESPOSTA[o]}
          </Button>
        ))}
        {linha.resposta && (
          <Button
            size="sm"
            variant="ghost"
            disabled={m.isPending}
            onClick={() => m.mutate("desfazer")}
          >
            Desfazer a resposta
          </Button>
        )}
      </div>
      {tipo && (
        <div className="space-y-2">
          {pedeValor && (
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Valor deste mês (R$)</span>
              <Input
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder={
                  linha.valor_contrato ? String(linha.valor_contrato).replace(".", ",") : "0,00"
                }
                className="num h-8 w-48"
              />
            </label>
          )}
          {tipo === "ajustar" && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={permanente} onCheckedChange={(v) => setPermanente(v === true)} />
              Vale também para os próximos meses (a tesouraria muda o contrato no Omie)
            </label>
          )}
          {pedeVigencia && (
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">
                Nova vigência final{tipo === "faturar_mes" ? " (se o contrato foi renovado)" : ""}
              </span>
              <Input
                type="date"
                value={vigencia}
                onChange={(e) => setVigencia(e.target.value)}
                className="num h-8 w-48"
              />
            </label>
          )}
          {pedeMotivo && (
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">
                Motivo{tipo === "cliente_saiu" ? " (opcional)" : ""}
              </span>
              <Textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!!falta || m.isPending} onClick={() => m.mutate(tipo)}>
              {m.isPending ? "Salvando…" : "Salvar resposta"}
            </Button>
            {falta && <span className="text-[13px] text-muted-foreground">{falta}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Repasse({ linha }: { linha: LinhaContrato }) {
  const [aberto, setAberto] = useState(false);
  const [para, setPara] = useState<string>("");
  const pessoas = usePessoasContrato(linha.emissora.id, aberto);
  const reler = useReler();
  const fn = useServerFn(repassarContrato);
  const m = useMutation({
    mutationFn: async (destino: string | null) =>
      desembrulhar(await fn({ data: { id: linha.id, para: destino } })),
    onSuccess: (r) => {
      toast.success(
        r.repassado_para?.nome
          ? `Contrato repassado a ${r.repassado_para.nome}.`
          : "Contrato devolvido aos donos da empresa.",
      );
      setAberto(false);
      void reler();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "O repasse não foi feito."),
  });
  if (!aberto)
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        {linha.repassado_para?.nome
          ? `Repassado a ${linha.repassado_para.nome}.`
          : "Responde quem é dono da empresa."}
        <Button size="sm" variant="link" className="h-auto px-0" onClick={() => setAberto(true)}>
          Repassar a outro sócio
        </Button>
        {linha.repassado_para && (
          <Button
            size="sm"
            variant="link"
            className="h-auto px-0"
            disabled={m.isPending}
            onClick={() => m.mutate(null)}
          >
            Devolver aos donos da empresa
          </Button>
        )}
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={para} onValueChange={setPara}>
        <SelectTrigger className="h-8 w-64" aria-label="Repassar para">
          <SelectValue placeholder={pessoas.isPending ? "Carregando…" : "Escolha a pessoa"} />
        </SelectTrigger>
        <SelectContent>
          {(pessoas.data ?? []).map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" disabled={!para || m.isPending} onClick={() => m.mutate(para)}>
        Repassar
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAberto(false)}>
        Voltar
      </Button>
      <span className="w-full text-[13px] text-muted-foreground">
        Só aparece quem já tem acesso ao Faturamento. O repasse vale para os próximos meses.
      </span>
    </div>
  );
}
