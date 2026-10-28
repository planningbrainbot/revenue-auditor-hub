import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BotaoComMotivo } from "@/components/royalties/botao-com-motivo";
import { diaSP } from "@/lib/faturamento/formato";
import { linhasIntegracao } from "@/lib/faturamento/ficha";
import type { FichaPedido } from "@/lib/faturamento/tipos";
import { cn } from "@/lib/utils";

/**
 * "Onde está no Omie?": uma linha por etapa do envio, em português, a mesma na Ficha e no `Sheet`
 * da Fila da tesouraria (contratos `faturamento-pedido.md` e `faturamento-tesouraria.md`).
 *
 * "Abrir no Omie" virou "Copiar número da OS": o conector não devolve um link estável da OS no Omie (só o da
 * nota), e um link montado à mão quebraria. Divergência registrada nos dois contratos (decisão do coordenador
 * de 20/10/2026).
 *
 * A linha do card do Pipefy (e o "Reenviar o card") saiu na call de 27/10/2026: o portal não usa mais o Pipefy.
 */
export function LinhasDoOmie({
  ficha,
  compacto = false,
  falhaEm = null,
}: {
  ficha: FichaPedido;
  compacto?: boolean;
  /** A última leitura que falhou na empresa (`fat_contexto`), para "a leitura seguinte falhou às {hora}". */
  falhaEm?: string | null;
}) {
  const hoje = diaSP(new Date()) as string;
  const linhas = linhasIntegracao(ficha, hoje, falhaEm);
  const os = ficha.pedido.omie.os_codigo;
  const simulado = ficha.pedido.simulacao || ficha.pedido.status === "simulado";

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(String(os));
      toast.success(
        `Número da OS copiado: ${os}. Busque por ele no Omie da ${ficha.pedido.emissora.apelido}.`,
      );
    } catch {
      toast.message(`OS ${os} no Omie da ${ficha.pedido.emissora.apelido}.`);
    }
  };

  return (
    <ul className={cn("divide-y rounded-xl border bg-card", compacto && "text-[13px]")}>
      {linhas.map((l) => (
        <li
          key={l.chave}
          className={cn(
            "flex flex-wrap items-start justify-between gap-3",
            compacto ? "px-3 py-2" : "px-4 py-3",
          )}
        >
          <div className="min-w-0 space-y-0.5">
            <p className="text-[13px] text-muted-foreground">{l.titulo}</p>
            <p
              className={cn(
                compacto ? "text-[13px]" : "text-sm",
                l.erro ? "text-danger" : "text-foreground",
              )}
            >
              {l.texto}
            </p>
          </div>
          {l.chave === "os" &&
            (os ? (
              <Button variant="outline" size="sm" onClick={copiar}>
                <Copy className="size-4" aria-hidden />
                Copiar número da OS
              </Button>
            ) : (
              <BotaoComMotivo
                rotulo="Copiar número da OS"
                motivo={simulado ? "Em simulação não há OS no Omie" : "Ainda não há OS no Omie"}
                variant="outline"
                size="sm"
              />
            ))}
          {l.link && (
            <Button asChild variant="outline" size="sm">
              <a href={l.link.href} target="_blank" rel="noreferrer">
                {l.link.rotulo}
                <ExternalLink className="size-4" aria-hidden />
              </a>
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
