import { useRef, type RefObject } from "react";

/**
 * Foco visível dos controles locais (V12): o mesmo anel do `Button`, com afastamento do fundo.
 * Nasceu na Monetização (`monetizacao/common.tsx`, que reexporta daqui).
 */
export const FOCO_VISIVEL =
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Foco de volta ao fechar `Sheet`, `Dialog` ou `AlertDialog`: volta ao controle que abriu
 * (guardado ao abrir); se ele saiu da tela (linha arquivada), vai para `reserva`.
 */
export function useFocoDeVolta(reserva?: RefObject<HTMLElement | null>) {
  const origem = useRef<HTMLElement | null>(null);
  return {
    /** Guarda quem abriu; sem argumento, o elemento com foco agora. */
    guardar: (el?: Element | null) => {
      origem.current = (el ?? document.activeElement) as HTMLElement | null;
    },
    /** Para quem abre por estado: o foco ainda está no gatilho quando o conteúdo monta. */
    onOpenAutoFocus: () => {
      if (!origem.current) origem.current = document.activeElement as HTMLElement | null;
    },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      const o = origem.current;
      origem.current = null;
      const alvo = o && o.isConnected && o !== document.body ? o : reserva?.current;
      alvo?.focus?.();
    },
  };
}
