import { useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  EstadoVazio,
  PageHeader,
  SelecaoMultipla,
  StatusBadge,
} from "@/components/planning";
import { BotaoComMotivo } from "@/components/royalties/botao-com-motivo";
import { SeletorMes } from "@/components/receita/moldura";
import { useContextoFaturamento, usePedidosFaturamento } from "@/hooks/use-faturamento";
import {
  chipsDaBusca,
  colunaParcelas,
  filtroDaBusca,
  frasePeriodo,
  hrefPedidos,
  idsDasEmissoras,
  ORDENS,
  POR_PAGINA,
  temFiltro,
  type BuscaPedidos,
} from "@/lib/faturamento/filtro";
import {
  contagem,
  deslocarMes,
  diaEHora,
  diaSP,
  dinheiro,
  documento,
  listaNomes,
  mesCorrenteSP,
  primeiroNome,
} from "@/lib/faturamento/formato";
import {
  fraseRecorte,
  podePedir,
  procedenciaFaturamento,
  PENDENCIA,
  proximoPasso,
  rotuloSituacao,
  SITUACAO,
  tipoRecorteDoContexto,
} from "@/lib/faturamento/rotulos";
import type {
  Contexto,
  EmissoraRef,
  ListaPedidos,
  Pendencia,
  Pessoa,
  Regua,
} from "@/lib/faturamento/tipos";
import { cn } from "@/lib/utils";
import {
  AREA_FATURAMENTO,
  BotaoNovoPedido,
  ErroDaArea,
  PaginaFaturamento,
  SeloSituacao,
} from "./moldura";

/**
 * Pedidos (`/faturamento/pedidos`), arquétipo Lista/Relatório. Contrato `docs/design/contratos/faturamento.md`
 * §3: "Em que pé está cada pedido?".
 *
 * Filtros, ordem e página moram na URL (N7) e viram o `p_filtro` de `ops.fat_pedidos`, que pagina no
 * servidor e devolve os totais do recorte inteiro (contagem, soma do valor e das parcelas): a tela não soma
 * a página. É o destino de todo número de Meu faturamento. A linha abre a Ficha, que volta para cá com os
 * mesmos filtros (`volta`).
 */

const TITULO = "Pedidos";
const PERGUNTA = "Em que pé está cada pedido?";

const OPCOES_SITUACAO = [
  {
    valor: "a_faturar",
    rotulo: "A faturar",
    dica: "Aguardando OK, na fila, erro, OS criada e em conferência",
  },
  ...(Object.keys(SITUACAO) as (keyof typeof SITUACAO)[]).map((s) => ({
    valor: s,
    rotulo: rotuloSituacao(s),
  })),
];

const REGUAS: { valor: Regua | "todas"; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas as competências" },
  { valor: "competencia", rotulo: "Competência do mês" },
  { valor: "nota", rotulo: "Nota emitida no mês" },
  { valor: "pagamento", rotulo: "Pago no mês" },
  { valor: "atraso", rotulo: "Parcela em atraso hoje" },
];

export function PedidosFaturamento({ busca }: { busca: BuscaPedidos }) {
  const navigate = useNavigate();
  const contexto = useContextoFaturamento();
  const ctx = contexto.data;

  const refs: EmissoraRef[] = useMemo(
    () => (ctx?.emissoras ?? []).map((e) => ({ id: e.id, apelido: e.apelido })),
    [ctx],
  );
  const { filtro, desconhecidas } = useMemo(() => filtroDaBusca(busca, refs), [busca, refs]);
  const { ids } = idsDasEmissoras(busca.emissora, refs);
  const foraDoRecorte = !!busca.emissora && ids.length === 0 && desconhecidas.length > 0;
  const lista = usePedidosFaturamento(filtro, !!ctx && !foraDoRecorte);

  /** Troca de filtro volta para a página 1; o resto fica. */
  const mudar = (parcial: Partial<BuscaPedidos>, manterPagina = false) =>
    void navigate({
      to: "/faturamento/pedidos",
      search: { ...busca, ...parcial, ...(manterPagina ? {} : { pagina: undefined }) },
      replace: true,
      resetScroll: false,
    });
  const limpar = () =>
    void navigate({
      to: "/faturamento/pedidos",
      search: busca.ordem ? { ordem: busca.ordem } : {},
      replace: true,
    });

  const tipo = ctx ? tipoRecorteDoContexto(ctx) : "pessoal";
  const apelidos = ids.length
    ? refs.filter((e) => ids.includes(e.id)).map((e) => e.apelido)
    : refs.map((e) => e.apelido);
  const donos = useMemo(() => donosDoContexto(ctx), [ctx]);
  const nomeDoDono = (id: string) => donos.find((d) => d.id === id)?.nome ?? null;

  const cabecalho = (
    <PageHeader
      area={AREA_FATURAMENTO}
      titulo={TITULO}
      pergunta={PERGUNTA}
      descricao={
        ctx ? (
          <>
            {fraseRecorte(tipo, apelidos)} · {frasePeriodo(busca) ?? "todas as competências"} ·
            pedido
          </>
        ) : undefined
      }
      procedencia={procedenciaFaturamento(ctx)}
      acoes={<BotaoNovoPedido contexto={ctx} emissora={busca.emissora} />}
    />
  );

  if (contexto.isPending)
    return (
      <PaginaFaturamento>
        {cabecalho}
        <Carregando variante="tabela" />
      </PaginaFaturamento>
    );
  if (contexto.error || !ctx)
    return (
      <PaginaFaturamento>
        {cabecalho}
        <ErroDaArea erro={contexto.error} tentarNovamente={() => void contexto.refetch()} />
      </PaginaFaturamento>
    );

  const dados = lista.data;
  const chips = chipsDaBusca(busca, nomeDoDono);

  return (
    <PaginaFaturamento>
      {cabecalho}
      <Filtros
        busca={busca}
        refs={refs}
        donos={tipo === "pessoal" ? [] : donos}
        mudar={mudar}
        limpar={temFiltro(busca) ? limpar : undefined}
      />

      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        {chips.map((c) => (
          <ChipFiltro
            key={c.chave}
            rotulo={c.rotulo}
            valor={c.valor}
            aoRemover={() => mudar(Object.fromEntries(c.remove.map((k) => [k, undefined])))}
          />
        ))}
        {dados && (
          <span className="num ml-auto text-[13px] text-muted-foreground">
            {contagem(dados.total, "pedido")} de {dados.total_recorte}
          </span>
        )}
      </div>

      {foraDoRecorte ? (
        <EstadoVazio
          titulo={`${listaNomes(desconhecidas)} não ${desconhecidas.length === 1 ? "está" : "estão"} no seu recorte.`}
          descricao="O link pede uma empresa em que você não pede, não aprova nem confere faturamento."
          acao={
            <Button variant="outline" size="sm" onClick={() => mudar({ emissora: undefined })}>
              Ver todas as minhas empresas
            </Button>
          }
        />
      ) : lista.isPending ? (
        <Carregando variante="tabela" />
      ) : lista.error || !dados ? (
        <ErroDaArea erro={lista.error} tentarNovamente={() => void lista.refetch()} />
      ) : dados.total_recorte === 0 ? (
        <EstadoVazio
          titulo="Nenhum pedido ainda."
          descricao={podePedir(ctx) ? "O pedido aparece aqui assim que for salvo." : undefined}
          acao={
            podePedir(ctx) ? (
              <BotaoNovoPedido contexto={ctx} emissora={busca.emissora} />
            ) : undefined
          }
        />
      ) : dados.total === 0 ? (
        <EstadoVazio
          titulo="Nenhum pedido encontrado"
          total={dados.total_recorte}
          acao={
            <Button variant="outline" size="sm" onClick={limpar}>
              Limpar filtros
            </Button>
          }
        />
      ) : dados.itens.length === 0 ? (
        <EstadoVazio
          titulo="Esta página não tem mais pedidos."
          descricao={`São ${contagem(dados.total, "pedido")} com esses filtros.`}
          acao={
            <Button variant="outline" size="sm" onClick={() => mudar({ pagina: undefined })}>
              Ir para a primeira página
            </Button>
          }
        />
      ) : (
        <TabelaPedidos
          dados={dados}
          busca={busca}
          mostraEmpresa={refs.length > 1 && ids.length !== 1}
          mostraDono={tipo !== "pessoal"}
          atualizando={lista.isFetching}
          irParaPagina={(p) => mudar({ pagina: p > 1 ? p : undefined }, true)}
        />
      )}
    </PaginaFaturamento>
  );
}

/** Donos das empresas em que eu peço (o banco só manda a lista ali), sem repetição, por nome. */
function donosDoContexto(ctx: Contexto | undefined): Pessoa[] {
  const porId = new Map<string, Pessoa>();
  for (const e of ctx?.emissoras ?? []) for (const d of e.donos ?? []) porId.set(d.id, d);
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// ------------------------------------------------------------------ filtros

function Filtros({
  busca,
  refs,
  donos,
  mudar,
  limpar,
}: {
  busca: BuscaPedidos;
  refs: EmissoraRef[];
  donos: Pessoa[];
  mudar: (parcial: Partial<BuscaPedidos>) => void;
  limpar?: () => void;
}) {
  const situacoes = busca.situacao ? busca.situacao.split(",") : [];
  const empresas = busca.emissora ? busca.emissora.split(",") : [];
  const reguaMes = busca.regua && busca.regua !== "atraso";

  return (
    // "BarraFiltros fixa" (contrato §3): gruda logo abaixo do cabeçalho da casca ao rolar a tabela.
    <div className="sticky top-[var(--app-header-h)] z-10 -mx-1 bg-background px-1 py-1">
      <BarraFiltros aoLimpar={limpar}>
        <label className="relative">
          <span className="sr-only">Buscar por número, cliente, documento ou projeto</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            key={busca.busca ?? ""}
            defaultValue={busca.busca ?? ""}
            placeholder="Número, cliente, documento ou projeto"
            className="h-8 w-72 pl-8"
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

        <SelecaoMultipla
          rotulo="Situação"
          opcoes={OPCOES_SITUACAO}
          valor={situacoes}
          aoMudar={(v) => mudar({ situacao: v.length ? v.join(",") : undefined })}
          todos="Todas, menos canceladas"
          plural="situações"
        />

        <Select
          value={busca.pendencia ?? "todas"}
          onValueChange={(v) => mudar({ pendencia: v === "todas" ? undefined : (v as Pendencia) })}
        >
          <SelectTrigger className="h-8 w-48" aria-label="Pendência">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Qualquer pendência</SelectItem>
            {(Object.keys(PENDENCIA) as Pendencia[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PENDENCIA[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {refs.length > 1 && (
          <SelecaoMultipla
            rotulo="Empresa"
            opcoes={refs.map((e) => ({ valor: e.apelido, rotulo: e.apelido }))}
            valor={empresas}
            aoMudar={(v) => mudar({ emissora: v.length ? v.join(",") : undefined })}
            todos="Todas as empresas"
            plural="empresas"
          />
        )}

        {donos.length > 0 && (
          <Select
            value={busca.dono ?? "todos"}
            onValueChange={(v) => mudar({ dono: v === "todos" ? undefined : v })}
          >
            <SelectTrigger className="h-8 w-44" aria-label="Dono da receita">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os donos</SelectItem>
              {donos.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={busca.regua ?? "todas"}
          onValueChange={(v) => {
            if (v === "todas") return mudar({ regua: undefined, mes: undefined });
            if (v === "atraso") return mudar({ regua: "atraso", mes: undefined });
            mudar({ regua: v as Regua, mes: busca.mes ?? mesCorrenteSP() });
          }}
        >
          <SelectTrigger className="h-8 w-52" aria-label="Período e régua da data">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REGUAS.map((r) => (
              <SelectItem key={r.valor} value={r.valor}>
                {r.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {reguaMes && busca.mes && (
          <SeletorMes
            mes={busca.mes}
            // Competência pode ser futura (pedido de novembro feito em outubro); nota e pagamento, não.
            maximo={
              busca.regua === "competencia" ? deslocarMes(mesCorrenteSP(), 12) : mesCorrenteSP()
            }
            aoMudar={(m) => mudar({ mes: m })}
          />
        )}

        <Select
          value={busca.ordem ?? "atualizado"}
          onValueChange={(v) =>
            mudar({ ordem: v === "atualizado" ? undefined : (v as BuscaPedidos["ordem"]) })
          }
        >
          <SelectTrigger className="h-8 w-56" aria-label="Ordem">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDENS.map((o) => (
              <SelectItem key={o.valor} value={o.valor}>
                {o.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </BarraFiltros>
    </div>
  );
}

// ------------------------------------------------------------------ tabela

function TabelaPedidos({
  dados,
  busca,
  mostraEmpresa,
  mostraDono,
  atualizando,
  irParaPagina,
}: {
  dados: ListaPedidos;
  busca: BuscaPedidos;
  mostraEmpresa: boolean;
  mostraDono: boolean;
  atualizando: boolean;
  irParaPagina: (p: number) => void;
}) {
  const navigate = useNavigate();
  const hoje = diaSP(new Date()) as string;
  const extra = colunaParcelas(busca);
  const volta = hrefPedidos(busca);
  const paginas = Math.max(1, Math.ceil(dados.total / Math.max(1, dados.por_pagina || POR_PAGINA)));
  const pagina = dados.pagina;

  const abrir = (id: string) =>
    void navigate({ to: "/faturamento/pedido/$id", params: { id }, search: { volta } });

  return (
    <div className="overflow-hidden rounded-xl border bg-card" aria-busy={atualizando}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pedido</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Projeto</TableHead>
            {mostraEmpresa && <TableHead>Empresa</TableHead>}
            {mostraDono && <TableHead>Dono</TableHead>}
            <TableHead className="num text-right">Valor</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Próximo passo</TableHead>
            <TableHead>Atualizado</TableHead>
            {extra && (
              <TableHead className="num text-right">
                {extra === "pago_no_mes" ? "Pago no mês" : "Em atraso"}
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {dados.itens.map((p) => {
            const passo = proximoPasso(p.proximo_passo, hoje);
            return (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => abrir(p.id)}>
                <TableCell className="whitespace-nowrap font-medium">
                  <Link
                    to="/faturamento/pedido/$id"
                    params={{ id: p.id }}
                    search={{ volta }}
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary-text underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {p.numero}
                  </Link>
                </TableCell>
                <TableCell className="min-w-[12rem]">
                  <span className="block text-foreground">{p.tomador.nome ?? "—"}</span>
                  {p.tomador.documento && (
                    <span className="num block text-[13px] text-muted-foreground">
                      {documento(p.tomador.documento)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="min-w-[10rem]">{p.projeto ?? "—"}</TableCell>
                {mostraEmpresa && <TableCell>{p.emissora.apelido}</TableCell>}
                {mostraDono && <TableCell>{primeiroNome(p.dono?.nome) || "—"}</TableCell>}
                <TableCell className="num whitespace-nowrap text-right">
                  {dinheiro(p.valor)}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1">
                    <SeloSituacao situacao={p.status} />
                    {/* Depois de simulado o pedido segue simulado (API.md §0.5): o dado diz, não um alarme. */}
                    {p.simulacao && p.status !== "simulado" && (
                      <StatusBadge tom="info" icone={false}>
                        em simulação
                      </StatusBadge>
                    )}
                  </span>
                </TableCell>
                <TableCell
                  className={cn(
                    "min-w-[12rem]",
                    passo.voce ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {passo.texto}
                </TableCell>
                <TableCell className="num whitespace-nowrap text-muted-foreground">
                  {diaEHora(p.atualizado_em) ?? "—"}
                </TableCell>
                {extra && (
                  <TableCell className="num whitespace-nowrap text-right">
                    {dinheiro(extra === "pago_no_mes" ? p.pago_no_mes : p.em_atraso)}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-[13px] text-muted-foreground">
        <span className="num">
          <span className="font-medium text-foreground">{contagem(dados.total, "pedido")}</span> ·{" "}
          {dinheiro(dados.soma)}
          {extra && (
            <>
              {" "}
              · {extra === "pago_no_mes" ? "pago no mês" : "em atraso"}{" "}
              <span className="font-medium text-foreground">{dinheiro(dados.soma_parcelas)}</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-3">
          <span className="num">
            Página {pagina} de {paginas}
          </span>
          {pagina <= 1 ? (
            <BotaoComMotivo
              rotulo="Anterior"
              motivo="Já é a primeira página"
              variant="outline"
              size="sm"
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => irParaPagina(pagina - 1)}>
              Anterior
            </Button>
          )}
          {pagina >= paginas ? (
            <BotaoComMotivo
              rotulo="Próxima"
              motivo="Já é a última página"
              variant="outline"
              size="sm"
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => irParaPagina(pagina + 1)}>
              Próxima
            </Button>
          )}
        </span>
      </footer>
    </div>
  );
}
