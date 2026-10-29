import { useMemo, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
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
import { useCorte, useReler } from "@/hooks/use-faturamento";
import { desembrulhar, tipoDoErro } from "@/lib/faturamento/erros";
import { marcarCorteFeito } from "@/lib/faturamento/faturamento.functions";
import { contagem, dataCompleta, diaMes, dinheiro, documento } from "@/lib/faturamento/formato";
import {
  csvDoCorte,
  filtrarCorte,
  gruposPorEmpresa,
  HIGIENES_CORTE,
  INSTRUCOES,
  numerosDoCorte,
  POS_CORTE,
  procedenciaRecorrente,
  temFiltroCorte,
  textoAcaoContrato,
  textoInstrucao,
  textoPosCorte,
  textoPrazo,
  textoQuemRespondeu,
  type BuscaCorte,
  type LinhaCorte,
} from "@/lib/faturamento/recorrente";
import { AREA_FATURAMENTO, ErroDaArea, PaginaFaturamento } from "./moldura";

/**
 * Lista do corte (`/faturamento/corte`), arquétipo Fila de trabalho. Contrato
 * `docs/design/contratos/faturamento-corte.md`: "Quais contratos eu faturo neste corte, e com qual valor?".
 *
 * No primeiro ciclo a tesouraria fatura no Omie (decisão 4 de 29/10/2026): a lista diz o que faturar, com qual
 * valor, o que não faturar e o que mudar no contrato do Omie. Depois do corte, as notas lidas do Omie mostram o que
 * faltou ou saiu diferente. Dia, empresa, filtros e o contrato aberto moram na URL (N7).
 */

const TITULO = "Lista do corte";
const PERGUNTA = "Quais contratos eu faturo neste corte, e com qual valor?";

const fichaClasse = (ativo: boolean) =>
  ativo
    ? "inline-flex h-8 items-center gap-1.5 rounded-full border border-input bg-accent px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    : "inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-sm text-muted-foreground outline-none transition-colors duration-[120ms] hover:border-input hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

function baixar(nome: string, conteudo: string) {
  // BOM para o Excel abrir os acentos.
  const blob = new Blob(["﻿", conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

export function ListaDoCorte({ busca }: { busca: BuscaCorte }) {
  const navigate = useNavigate();
  const q = useCorte(busca.dia ?? null);
  const mudar = (parcial: Partial<BuscaCorte>) =>
    void navigate({
      to: "/faturamento/corte",
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
  const numeros = useMemo(() => numerosDoCorte(daEmpresa), [daEmpresa]);
  const filtradas = useMemo(() => filtrarCorte(daEmpresa, busca), [daEmpresa, busca]);
  const grupos = useMemo(() => gruposPorEmpresa(filtradas), [filtradas]);
  const aberta = d?.linhas.find((l) => l.id === busca.contrato) ?? null;

  const fonte = d
    ? `${procedenciaRecorrente(d.procedencia)} · respostas dos donos até ${textoPrazo(d.fecha_em)}`
    : procedenciaRecorrente(undefined);
  const descricao = d?.dia
    ? `Contratos recorrentes com faturamento em ${dataCompleta(d.dia)} · ${escolhida ? escolhida.apelido : "todas as empresas do seu recorte"} · contrato`
    : undefined;
  const cabecalho = (acoes?: ReactNode) => (
    <PageHeader
      area={AREA_FATURAMENTO}
      titulo={TITULO}
      pergunta={PERGUNTA}
      descricao={descricao}
      procedencia={{ fonte, atualizadoEm: d?.procedencia.notas_lidas_em }}
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
          <EstadoSemAcesso oQueFalta="Faturamento · Tesouraria" />
        ) : (
          <ErroDaArea erro={q.error} tentarNovamente={() => void q.refetch()} />
        )}
      </PaginaFaturamento>
    );

  const csv = () => {
    const nome = `corte-${d.dia ?? "sem-dia"}-${escolhida?.apelido ?? "todas"}.csv`
      .toLowerCase()
      .replace(/\s+/g, "-");
    baixar(nome, csvDoCorte(daEmpresa));
  };

  return (
    <PaginaFaturamento>
      {cabecalho(
        daEmpresa.length > 0 ? (
          <Button size="sm" variant="outline" onClick={csv}>
            <Download className="size-4" aria-hidden />
            Baixar a lista {escolhida ? `da ${escolhida.apelido}` : ""} (CSV)
          </Button>
        ) : undefined,
      )}

      <div role="group" aria-label="Dia do corte" className="flex flex-wrap items-center gap-2">
        {d.dias.map((x) => (
          <button
            key={x.dia}
            type="button"
            aria-pressed={x.dia === d.dia}
            className={fichaClasse(x.dia === d.dia)}
            onClick={() => mudar({ dia: x.dia, contrato: undefined })}
          >
            {diaMes(x.dia)} <span className="num">{x.contratos}</span>
          </button>
        ))}
      </div>
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
              {e.apelido} <span className="num">{e.contratos}</span>
            </button>
          ))}
          <button
            type="button"
            aria-pressed={!escolhida}
            className={fichaClasse(!escolhida)}
            onClick={() => mudar({ empresa: "todas", contrato: undefined })}
          >
            Todas <span className="num">{d.empresas.reduce((n, e) => n + e.contratos, 0)}</span>
          </button>
        </div>
      )}

      {d.lista_aberta && (
        <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
          Lista aberta: os donos respondem até {textoPrazo(d.fecha_em)}. Ela ainda pode mudar.
        </p>
      )}

      <KpiGrade colunas={3}>
        <KpiCard
          rotulo="Faturar como está"
          valor={numeros.como_esta.quantidade}
          unidade={numeros.como_esta.quantidade === 1 ? "contrato" : "contratos"}
          nota={dinheiro(numeros.como_esta.valor)}
          abrir={{
            onClick: () =>
              mudar({ instrucao: busca.instrucao === "como_esta" ? undefined : "como_esta" }),
            rotulo: busca.instrucao === "como_esta" ? "Tirar filtro" : "Filtrar",
          }}
        />
        <KpiCard
          rotulo="Faturar com outro valor"
          valor={numeros.outro_valor.quantidade}
          unidade={numeros.outro_valor.quantidade === 1 ? "contrato" : "contratos"}
          nota={dinheiro(numeros.outro_valor.valor)}
          abrir={{
            onClick: () =>
              mudar({ instrucao: busca.instrucao === "outro_valor" ? undefined : "outro_valor" }),
            rotulo: busca.instrucao === "outro_valor" ? "Tirar filtro" : "Filtrar",
          }}
        />
        <KpiCard
          rotulo="Não faturar"
          valor={numeros.nao_faturar.quantidade}
          unidade={numeros.nao_faturar.quantidade === 1 ? "contrato" : "contratos"}
          nota={
            numeros.nao_faturar.aguardando
              ? `mais ${contagem(numeros.nao_faturar.aguardando, "contrato")} aguardando o dono`
              : undefined
          }
          abrir={{
            onClick: () =>
              mudar({ instrucao: busca.instrucao === "nao_faturar" ? undefined : "nao_faturar" }),
            rotulo: busca.instrucao === "nao_faturar" ? "Tirar filtro" : "Filtrar",
          }}
        />
      </KpiGrade>

      <div role="group" aria-label="Depois do corte" className="flex flex-wrap items-center gap-2">
        {HIGIENES_CORTE.map((h) => {
          const n = numeros.higiene[h.valor];
          const ativo = busca.situacao === h.valor;
          return (
            <button
              key={h.valor}
              type="button"
              aria-pressed={ativo}
              onClick={() => mudar({ situacao: ativo ? undefined : h.valor })}
              className={
                ativo
                  ? "inline-flex h-8 items-center gap-2 rounded-full border border-input bg-accent px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  : "inline-flex h-8 items-center gap-2 rounded-full border bg-card px-3 text-sm text-foreground outline-none transition-colors duration-[120ms] hover:border-input focus-visible:ring-2 focus-visible:ring-ring"
              }
            >
              {h.rotulo}
              <StatusBadge
                tom={n > 0 ? POS_CORTE[h.valor].tom : "neutro"}
                icone={n > 0 ? undefined : false}
              >
                {n}
              </StatusBadge>
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <BarraFiltros
          aoLimpar={
            temFiltroCorte(busca)
              ? () => mudar({ instrucao: undefined, situacao: undefined, busca: undefined })
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
            value={busca.instrucao ?? "todas"}
            onValueChange={(v) =>
              mudar({ instrucao: v === "todas" ? undefined : (v as BuscaCorte["instrucao"]) })
            }
          >
            <SelectTrigger className="h-8 w-60" aria-label="Instrução">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as instruções</SelectItem>
              {INSTRUCOES.map((i) => (
                <SelectItem key={i.valor} value={i.valor}>
                  {i.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </BarraFiltros>
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          {busca.instrucao && (
            <ChipFiltro
              rotulo="Instrução"
              valor={INSTRUCOES.find((i) => i.valor === busca.instrucao)?.rotulo ?? busca.instrucao}
              aoRemover={() => mudar({ instrucao: undefined })}
            />
          )}
          {busca.situacao && (
            <ChipFiltro
              rotulo="Depois do corte"
              valor={POS_CORTE[busca.situacao].rotulo}
              aoRemover={() => mudar({ situacao: undefined })}
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
            {contagem(filtradas.length, "contrato")} de {daEmpresa.length}
          </span>
        </div>
      </div>

      {!d.dia || daEmpresa.length === 0 ? (
        <EstadoVazio
          titulo={
            d.dia
              ? `Nenhum contrato fatura em ${dataCompleta(d.dia)} nas suas empresas.`
              : "Nenhum corte no mês."
          }
          descricao="Os contratos de cada corte aparecem depois da leitura diária do Omie (6h)."
        />
      ) : filtradas.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum contrato encontrado"
          total={daEmpresa.length}
          acao={
            <Button
              variant="outline"
              size="sm"
              onClick={() => mudar({ instrucao: undefined, situacao: undefined, busca: undefined })}
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
                <TableHead>Cliente</TableHead>
                <TableHead>Contrato</TableHead>
                <TableHead className="num text-right">Valor do contrato</TableHead>
                <TableHead className="num text-right">Faturar</TableHead>
                <TableHead>Instrução</TableHead>
                <TableHead>Quem respondeu</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>
                  <span className="sr-only">Ação</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grupos.flatMap((g) => [
                <TableRow key={`e-${g.apelido}`} className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={8} className="text-[13px] text-muted-foreground">
                    <span className="font-semibold uppercase tracking-wider">{g.apelido}</span> ·{" "}
                    {contagem(g.linhas.length, "contrato")} ·{" "}
                    {dinheiro(g.linhas.reduce((s, l) => s + (l.valor_faturar ?? 0), 0))} a faturar
                  </TableCell>
                </TableRow>,
                ...g.linhas.map((l) => (
                  <LinhaCorteTabela
                    key={l.id}
                    l={l}
                    listaAberta={d.lista_aberta}
                    podeMarcar={d.pode_marcar}
                    abrir={() => mudar({ contrato: l.id })}
                  />
                )),
              ])}
            </TableBody>
          </Table>
        </div>
      )}

      <Procedencia fonte={fonte} atualizadoEm={d.procedencia.notas_lidas_em} />
      <SheetDaLinha
        linha={aberta}
        listaAberta={d.lista_aberta}
        aoFechar={() => mudar({ contrato: undefined })}
      />
    </PaginaFaturamento>
  );
}

function LinhaCorteTabela({
  l,
  listaAberta,
  podeMarcar,
  abrir,
}: {
  l: LinhaCorte;
  listaAberta: boolean;
  podeMarcar: boolean;
  abrir: () => void;
}) {
  const acao = textoAcaoContrato(l);
  const tomPos = l.pos_corte ? POS_CORTE[l.pos_corte].tom : "neutro";
  return (
    <TableRow
      tabIndex={0}
      className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={abrir}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && abrir()}
    >
      <TableCell className="min-w-[14rem]">
        <span className="block font-medium text-foreground">{l.cliente_nome ?? "—"}</span>
        <span className="num block text-[13px] text-muted-foreground">
          {documento(l.documento) ?? "—"}
        </span>
      </TableCell>
      <TableCell className="num">{l.numero_contrato ?? l.codigo_contrato}</TableCell>
      <TableCell className="num whitespace-nowrap text-right">
        {dinheiro(l.valor_contrato)}
      </TableCell>
      <TableCell className="num whitespace-nowrap text-right">
        {dinheiro(l.valor_faturar)}
      </TableCell>
      <TableCell className="min-w-[16rem] text-[13px]">
        <span className="block">{textoInstrucao(l)}</span>
        {acao && (
          <span className="block text-muted-foreground">
            {acao}
            {l.feito_omie ? " · feito" : ""}
          </span>
        )}
      </TableCell>
      <TableCell className="min-w-[9rem] text-[13px]">{textoQuemRespondeu(l)}</TableCell>
      <TableCell className="min-w-[10rem]">
        <StatusBadge tom={tomPos} icone={l.pos_corte ? undefined : false}>
          {textoPosCorte(l, listaAberta)}
        </StatusBadge>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        {acao && podeMarcar && <FeitoNoOmie linha={l} />}
      </TableCell>
    </TableRow>
  );
}

function FeitoNoOmie({ linha }: { linha: LinhaCorte }) {
  const reler = useReler();
  const fn = useServerFn(marcarCorteFeito);
  const feito = !!linha.feito_omie;
  const m = useMutation({
    mutationFn: async () => desembrulhar(await fn({ data: { id: linha.id, feito: !feito } })),
    onSuccess: () => {
      toast.success(feito ? "Marcação desfeita." : "Marcado como feito no Omie.");
      void reler();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "A marcação não foi feita."),
  });
  return (
    <Button
      size="sm"
      variant={feito ? "ghost" : "outline"}
      disabled={m.isPending}
      onClick={() => m.mutate()}
    >
      {feito ? "Desfazer feito" : "Feito no Omie"}
    </Button>
  );
}

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

function SheetDaLinha({
  linha,
  listaAberta,
  aoFechar,
}: {
  linha: LinhaCorte | null;
  listaAberta: boolean;
  aoFechar: () => void;
}) {
  return (
    <Sheet open={!!linha} onOpenChange={(aberto) => !aberto && aoFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {linha && (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle>{linha.cliente_nome ?? "Contrato"}</SheetTitle>
              <SheetDescription>
                {[
                  `contrato ${linha.numero_contrato ?? linha.codigo_contrato}`,
                  linha.emissora.apelido,
                  documento(linha.documento),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </SheetDescription>
              <Button asChild variant="link" size="sm" className="h-auto self-start px-0">
                <Link to="/faturamento/contratos" search={{ contrato: linha.id }}>
                  Ver a resposta do dono em Contratos do mês
                </Link>
              </Button>
            </SheetHeader>
            <Bloco titulo="O que fazer no Omie">
              <p>{textoInstrucao(linha)}</p>
              {textoAcaoContrato(linha) && (
                <p className="text-muted-foreground">{textoAcaoContrato(linha)}</p>
              )}
            </Bloco>
            <Bloco titulo="Contrato">
              <p className="num">
                {dinheiro(linha.valor_contrato)} por mês · fatura no dia{" "}
                {linha.dia_faturamento ?? "—"} · corte em {dataCompleta(linha.data_corte)}
              </p>
              <p className="text-[13px] text-muted-foreground">
                Mês anterior: {dinheiro(linha.valor_mes_anterior)}
                {linha.servico ? ` · ${linha.servico}` : ""}
              </p>
            </Bloco>
            <Bloco titulo="Resposta do dono">{textoQuemRespondeu(linha)}</Bloco>
            <Bloco titulo="Depois do corte">{textoPosCorte(linha, listaAberta)}</Bloco>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
