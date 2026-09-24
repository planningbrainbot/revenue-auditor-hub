import { useId } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EstadoErro, EstadoVazio } from "@/components/planning";
import { cn } from "@/lib/utils";

/**
 * Peças de estado do Planning People, em cima de `@/components/planning`
 * (contrato `docs/design/contratos/gente.md`, "Estados"). Servem às 11 telas de
 * `/gente`: cada tela separa carregando, erro (com a fonte), sem acesso (com a
 * chave) e vazio, e nenhum desses parece o outro.
 */

const NUM = new Intl.NumberFormat("pt-BR");

/**
 * A leitura falhou. Diz qual fonte e a mensagem do servidor, e deixa tentar de
 * novo sem recarregar. Erro nunca vira "sem acesso" nem tela em branco.
 */
export function ErroDaFonte({
  fonte,
  erro,
  tentar,
  className,
}: {
  /** O que não foi lido, em palavras de quem usa ("os 1:1 e feedbacks"). */
  fonte: string;
  erro?: unknown;
  tentar?: () => void;
  className?: string;
}) {
  const msg = erro instanceof Error ? erro.message : erro ? String(erro) : null;
  return (
    <EstadoErro
      titulo={`Não foi possível ler ${fonte}`}
      detalhe={msg ? `Resposta do servidor: ${msg}` : undefined}
      tentarNovamente={tentar}
      className={className}
    />
  );
}

/** Sem linha em `gente_pessoas`: não é falta de permissão nem base vazia. */
export function SemCadastroNaRede({ oQueDepende }: { oQueDepende: string }) {
  return (
    <EstadoVazio
      titulo="Seu usuário não está no cadastro de gente da rede"
      descricao={`${oQueDepende} depende de saber quem é seu gestor e quem é seu time. Peça a quem cuida do Cadastro da sua unidade para incluir você.`}
    />
  );
}

/**
 * Corte dito (contrato: "mostrando 40 de N"). Não aparece quando nada foi
 * cortado. Com `total` desconhecido (limite do servidor), diz o limite.
 */
export function AvisoCorte({
  mostrando,
  total,
  oQue,
  limiteDoServidor,
  criterio = "as linhas mais recentes",
}: {
  mostrando: number;
  total?: number;
  oQue: string;
  /** Quais linhas ficaram na tela quando o corte é local (padrão: as mais recentes). */
  criterio?: string;
  /** A consulta pede no máximo N linhas: com N devolvidas pode haver mais. */
  limiteDoServidor?: number;
}) {
  if (limiteDoServidor !== undefined) {
    if (mostrando < limiteDoServidor) return null;
    return (
      <p className="text-[13px] text-muted-foreground">
        Mostrando os <span className="num">{NUM.format(limiteDoServidor)}</span> {oQue} mais
        recentes; os anteriores não aparecem aqui.
      </p>
    );
  }
  if (total === undefined || total <= mostrando) return null;
  return (
    <p className="text-[13px] text-muted-foreground">
      Mostrando <span className="num">{NUM.format(mostrando)}</span> de{" "}
      <span className="num">{NUM.format(total)}</span> {oQue} ({criterio}).
    </p>
  );
}

/**
 * `Button` que diz por que está desabilitado (N8). É sempre o mesmo elemento,
 * habilitado ou não: desabilitado vira `aria-disabled` (sem `disabled`), então
 * continua focável e recebe ponteiro para o tooltip; o clique é bloqueado aqui.
 * O motivo vai no tooltip e num texto `sr-only` ligado por `aria-describedby`.
 * O primeiro motivo verdadeiro da lista ganha.
 * (Mesma API do `BotaoComMotivo` da Monetização.)
 */
export function BotaoComMotivo({
  motivo,
  disabled,
  onClick,
  className,
  ...props
}: ButtonProps & { motivo?: string | null | (string | null | false | undefined)[] }) {
  const idMotivo = useId();
  const primeiro = Array.isArray(motivo) ? motivo.find(Boolean) || null : motivo || null;
  const texto = disabled ? primeiro : null;
  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip open={texto ? undefined : false}>
          <TooltipTrigger asChild>
            <Button
              {...props}
              aria-disabled={disabled || undefined}
              aria-describedby={texto ? idMotivo : undefined}
              onClick={(e) => {
                if (disabled) {
                  e.preventDefault();
                  return;
                }
                onClick?.(e);
              }}
              className={cn(
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                disabled && "cursor-not-allowed opacity-50",
                className,
              )}
            />
          </TooltipTrigger>
          {texto ? <TooltipContent>{texto}</TooltipContent> : null}
        </Tooltip>
      </TooltipProvider>
      {texto ? (
        <span id={idMotivo} className="sr-only">
          {texto}
        </span>
      ) : null}
    </>
  );
}

/** Data de `timestamptz` no dia de São Paulo (o `slice(0,10)` dava o dia UTC). */
export function dataSP(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
