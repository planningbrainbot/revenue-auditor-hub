import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BotaoComMotivo } from "@/components/royalties/botao-com-motivo";
import { useAcaoPedido } from "@/hooks/use-acao-pedido";
import {
  acoesDaFicha,
  alvoDaFicha,
  type AcaoExecutavel,
  type AlvoPedido,
} from "@/lib/faturamento/ficha";
import { dinheiro } from "@/lib/faturamento/formato";
import type { AcaoFicha, FichaPedido } from "@/lib/faturamento/tipos";

/**
 * As ações do ciclo de vida do pedido, as mesmas na Ficha e no `Sheet` da Fila da tesouraria (contratos
 * `faturamento-pedido.md` e `faturamento-tesouraria.md`, "Ações"). Quem pode cada uma é o banco: a tela só
 * desabilita com o motivo que ele manda (`acoes`), e a RPC da ação confere tudo de novo.
 *
 * Confirmações: Devolver e Pedir cancelamento pedem o motivo (o botão só habilita com texto, e o banco recusa
 * vazio, CA-10); Faturar e Confirmar cancelamento passam por `AlertDialog` com o efeito; Dar OK, Reenviar,
 * Conferir e Atualizar agora são um clique (RF-P05).
 */

type Pendente = {
  acao: "devolver" | "pedir_cancelamento" | "faturar" | "confirmar_cancelamento";
  alvo: AlvoPedido;
};

/** Os diálogos de confirmação, controlados por quem chama. */
export function DialogosDoPedido({
  pendente,
  aoFechar,
  executar,
  executando,
}: {
  pendente: Pendente | null;
  aoFechar: () => void;
  executar: (acao: AcaoExecutavel, alvo: AlvoPedido, motivo?: string) => void;
  executando: boolean;
}) {
  if (!pendente) return null;
  const { acao, alvo } = pendente;
  if (acao === "devolver" || acao === "pedir_cancelamento")
    return (
      <DialogMotivo
        key={`${acao}-${alvo.id}`}
        titulo={
          acao === "devolver"
            ? `Devolver ${alvo.numero}?`
            : `Pedir o cancelamento de ${alvo.numero}?`
        }
        descricao={
          acao === "devolver" ? (
            <>
              O pedido volta para quem o escreveu, com o motivo, e aparece na linha do tempo.
              {alvo.osCodigo ? (
                <>
                  {" "}
                  A OS {alvo.osCodigo} continua no Omie da {alvo.apelido}; quando o pedido for
                  reenviado, o portal altera essa mesma OS em vez de criar outra.
                </>
              ) : null}
            </>
          ) : (
            "A tesouraria cancela no Omie e confirma aqui. O pedido não é apagado."
          )
        }
        rotulo={acao === "devolver" ? "Devolver" : "Pedir cancelamento"}
        executando={executando}
        aoFechar={aoFechar}
        aoConfirmar={(motivo) => executar(acao, alvo, motivo)}
      />
    );
  const faturar = acao === "faturar";
  const parcelas = alvo.parcelas && alvo.parcelas > 1 ? `${alvo.parcelas} parcelas` : "à vista";
  return (
    <AlertDialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {faturar
              ? alvo.simulacao
                ? `Faturar ${alvo.numero} em simulação?`
                : `Faturar ${alvo.numero}?`
              : `Confirmar o cancelamento de ${alvo.numero}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {faturar
              ? alvo.simulacao
                ? `Nada é emitido no Omie da ${alvo.apelido}; fica registrado o que seria feito.`
                : `O Omie da ${alvo.apelido} emite a nota de ${dinheiro(alvo.valor)} para ${alvo.cliente ?? "o cliente"}, ${parcelas}. Pelo portal não dá para desfazer.`
              : `Confirma que a nota e os títulos de ${alvo.numero} foram cancelados no Omie da ${alvo.apelido}? O pedido vira Cancelado e não é apagado.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction disabled={executando} onClick={() => executar(acao, alvo)}>
            {faturar
              ? alvo.simulacao
                ? "Faturar em simulação"
                : "Faturar"
              : "Confirmar cancelamento"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Motivo obrigatório: o botão só habilita com texto (CA-10). */
function DialogMotivo({
  titulo,
  descricao,
  rotulo,
  executando,
  aoFechar,
  aoConfirmar,
}: {
  titulo: string;
  descricao: ReactNode;
  rotulo: string;
  executando: boolean;
  aoFechar: () => void;
  aoConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const vazio = motivo.trim() === "";
  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="fat-motivo">Motivo</Label>
          <Textarea
            id="fat-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Ex.: falta o e-mail do financeiro do cliente."
          />
          <p className="text-[13px] text-muted-foreground">
            Obrigatório. Quem recebe o pedido lê este texto.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Voltar
          </Button>
          {vazio ? (
            <BotaoComMotivo rotulo={rotulo} motivo="Escreva o motivo primeiro." />
          ) : (
            <Button disabled={executando} onClick={() => aoConfirmar(motivo.trim())}>
              {executando ? "Enviando…" : rotulo}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PRECISA_DIALOGO = new Set<AcaoFicha>([
  "devolver",
  "pedir_cancelamento",
  "faturar",
  "confirmar_cancelamento",
]);

/**
 * Os botões da Ficha (ou do `Sheet` da fila): uma ação `default` por situação, as outras `outline`; quem vê
 * o pedido e não tem o papel vê o botão desabilitado com o motivo (N8). "Corrigir" e "Continuar editando"
 * abrem o formulário com o pedido.
 */
export function BotoesDoPedido({
  ficha,
  aoConcluir,
  tamanho = "sm",
}: {
  ficha: FichaPedido;
  aoConcluir?: (acao: AcaoExecutavel) => void;
  tamanho?: "sm" | "default";
}) {
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const acao = useAcaoPedido((a) => {
    setPendente(null);
    aoConcluir?.(a);
  });
  const alvo = alvoDaFicha(ficha);
  const botoes = acoesDaFicha(ficha);
  const emCurso = acao.isPending ? acao.variables?.acao : null;

  const executar = (a: AcaoExecutavel, al: AlvoPedido, motivo?: string) =>
    acao.mutate({ acao: a, alvo: al, motivo });

  if (!botoes.length) return null;
  return (
    <>
      {botoes.map((b) => {
        const variante = b.principal ? "default" : "outline";
        if (!b.pode)
          return (
            <BotaoComMotivo
              key={b.chave}
              rotulo={b.rotulo}
              motivo={b.motivo ?? ""}
              variant={variante}
              size={tamanho}
            />
          );
        if (b.chave === "editar")
          return (
            <Button key={b.chave} asChild variant={variante} size={tamanho}>
              <Link to="/faturamento/novo" search={{ pedido: ficha.pedido.id }}>
                {b.rotulo}
              </Link>
            </Button>
          );
        if (b.chave === "descartar" || b.chave === "enviar") return null;
        const ocupado = emCurso === b.chave;
        return (
          <Button
            key={b.chave}
            variant={variante}
            size={tamanho}
            disabled={acao.isPending}
            title={
              b.chave === "reenviar"
                ? "Reenviar não duplica: o Omie reconhece o pedido pelo número."
                : undefined
            }
            onClick={() =>
              PRECISA_DIALOGO.has(b.chave)
                ? setPendente({ acao: b.chave as Pendente["acao"], alvo })
                : executar(b.chave as AcaoExecutavel, alvo)
            }
          >
            {ocupado ? (b.chave === "faturar" ? "Faturando…" : "Enviando…") : b.rotulo}
          </Button>
        );
      })}
      <DialogosDoPedido
        pendente={pendente}
        aoFechar={() => setPendente(null)}
        executar={executar}
        executando={acao.isPending}
      />
    </>
  );
}
