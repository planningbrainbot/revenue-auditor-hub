import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

/**
 * Link de uma Secao ou card da Rede para a tela dona do dado ("Ver detalhe →").
 * Um só para Overview, Realizado e LTV: antes cada tela tinha a sua cópia, e
 * uma delas estava sem foco visível (V12).
 */
export function DestinoLink({
  to,
  search,
  rotulo = "Ver detalhe",
}: {
  to: string;
  search?: Record<string, unknown>;
  rotulo?: string;
}) {
  return (
    <Link
      to={to as never}
      search={search as never}
      className="inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-primary-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {rotulo} <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}
