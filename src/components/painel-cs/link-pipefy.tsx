import { ExternalLink } from "lucide-react";

/**
 * "Ver card" no Pipefy: a tratativa e o onboarding são escritos lá (não há
 * escrita no Ops), então a linha leva direto ao card. Sem id, não há link.
 */
export function LinkPipefy({ cardId, titulo }: { cardId: string | null | undefined; titulo?: string | null }) {
  if (!cardId) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={`https://app.pipefy.com/open-cards/${encodeURIComponent(cardId)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Ver card${titulo ? ` de ${titulo}` : ""} no Pipefy (abre em nova aba)`}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm text-primary-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Ver card
      <ExternalLink className="size-4" aria-hidden />
    </a>
  );
}
