import type { ReactNode } from "react";
import { Lock, OctagonAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { GradeCirculos } from "./grafismos";

/**
 * Os estados de tela que não são "dado pronto" (N4): carregando, vazio, erro
 * e sem acesso. Cada um tem cara própria, porque vazio, zero e "você não pode
 * ver" pareciam iguais em 82 telas e a pessoa concluía errado.
 */

const NUM = new Intl.NumberFormat("pt-BR");

/**
 * Nada para mostrar. Com `total`, diz que o vazio é do filtro e quanto existe
 * fora dele: "nenhum resultado" sem o total parece base vazia.
 */
export function EstadoVazio({
  titulo,
  descricao,
  total,
  acao,
  className,
}: {
  titulo: string;
  descricao?: ReactNode;
  total?: number;
  acao?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative isolate flex flex-col items-center overflow-hidden rounded-xl border border-dashed bg-card px-6 py-12 text-center",
        className,
      )}
    >
      <GradeCirculos esmaecer="radial" className="-z-10 text-muted-foreground" />
      <AneisConcentricos />
      <p className="mt-4 text-base font-semibold text-foreground">{titulo}</p>
      {total !== undefined && (
        <p className="mt-1 text-sm text-muted-foreground">
          Nenhum resultado com esses filtros. <span className="num">{NUM.format(total)}</span> no
          total.
        </p>
      )}
      {descricao && <div className="mt-1 max-w-md text-sm text-muted-foreground">{descricao}</div>}
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  );
}

// Anel grosso com dois círculos finos dentro: os círculos concêntricos do
// manual, no neutro, para o vazio não parecer erro nem sucesso.
function AneisConcentricos() {
  return (
    <svg viewBox="0 0 64 64" className="size-16 text-muted-foreground" fill="none" aria-hidden>
      <circle cx="32" cy="32" r="29" stroke="currentColor" strokeWidth="3" opacity="0.45" />
      <circle cx="32" cy="32" r="20" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <circle cx="32" cy="32" r="12" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <circle cx="32" cy="32" r="3" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** A busca falhou. Diz o que falhou e deixa tentar de novo sem recarregar. */
export function EstadoErro({
  titulo = "Não foi possível carregar estes dados",
  detalhe,
  tentarNovamente,
  className,
}: {
  titulo?: string;
  detalhe?: ReactNode;
  tentarNovamente?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-xl border border-danger/40 bg-danger-soft p-5 sm:flex-row sm:items-center",
        className,
      )}
    >
      <OctagonAlert className="size-5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold text-foreground">{titulo}</p>
        {detalhe && <div className="text-[13px] text-muted-foreground">{detalhe}</div>}
      </div>
      {tentarNovamente && (
        <Button type="button" variant="outline" size="sm" onClick={tentarNovamente}>
          <RotateCw className="size-4" aria-hidden />
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

/**
 * Sem permissão (N8). Diz qual permissão falta, para a pessoa saber o que
 * pedir, em vez de uma tela em branco que parece base vazia.
 */
export function EstadoSemAcesso({
  oQueFalta,
  className,
}: {
  oQueFalta: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-xl border border-dashed bg-card p-5 sm:flex-row sm:items-center",
        className,
      )}
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-input text-muted-foreground">
        <Lock className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold text-foreground">Você não tem acesso a este bloco</p>
        <p className="text-[13px] text-muted-foreground">
          Falta a permissão <span className="font-medium text-foreground">{oQueFalta}</span>. Peça
          a quem administra os acessos da sua área.
        </p>
      </div>
    </div>
  );
}

/**
 * Esqueleto no formato do que vai chegar. Nunca "0" nem "Carregando…" solto:
 * o formato diz o que está vindo e a página não pula quando o dado chega.
 */
export function Carregando({
  variante,
  linhas = 6,
  className,
}: {
  variante: "kpis" | "tabela" | "grafico" | "pagina";
  linhas?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn("space-y-4", className)}>
      <span className="sr-only">Carregando…</span>
      {variante === "pagina" && <EsqueletoCabecalho />}
      {(variante === "kpis" || variante === "pagina") && <EsqueletoKpis />}
      {variante === "grafico" && <EsqueletoGrafico />}
      {(variante === "tabela" || variante === "pagina") && <EsqueletoTabela linhas={linhas} />}
    </div>
  );
}

function EsqueletoCabecalho() {
  return (
    <div className="space-y-2.5 border-b pb-5" aria-hidden>
      <div className="flex items-center gap-2">
        <Skeleton className="size-6 rounded-full" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="h-7 w-2/3 max-w-xl" />
      <Skeleton className="h-4 w-1/3 max-w-sm" />
    </div>
  );
}

function EsqueletoKpis() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

function EsqueletoGrafico() {
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4" aria-hidden>
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function EsqueletoTabela({ linhas }: { linhas: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card" aria-hidden>
      <div className="flex gap-6 border-b px-4 py-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="ml-auto h-3 w-16" />
      </div>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="flex items-center gap-6 border-b px-4 py-3 last:border-b-0">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
