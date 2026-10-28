/**
 * Registro de uso do Ops (tela /uso-brain). PRD: wiki/prds/2026-10-ops-uso-do-brain.md.
 *
 * Um minuto conta quando a aba está visível e houve clique, tecla ou rolagem
 * no último minuto: aba esquecida aberta não infla as horas. O minuto gravado
 * é o do servidor e a rota é normalizada lá (ops.registrar_uso), então daqui
 * só sai o caminho, sem query string.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { JANELA_ATIVA_MS, minutoAtivo } from "@/lib/uso-regra";

// As funções novas ainda não estão nos tipos gerados do banco.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any;

const EVENTOS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/** Registra o uso enquanto o layout autenticado estiver montado. Best-effort. */
export function useRegistrarUso(pathname: string) {
  const rota = useRef(pathname);
  rota.current = pathname;

  useEffect(() => {
    let ultimaInteracao = Date.now();
    const marcar = () => {
      ultimaInteracao = Date.now();
    };
    for (const e of EVENTOS) window.addEventListener(e, marcar, { passive: true, capture: true });

    const registrar = () => {
      if (!minutoAtivo(Date.now(), ultimaInteracao, document.visibilityState === "visible")) return;
      void db.rpc("registrar_uso", { p_rota: rota.current }).then(
        () => {},
        () => {},
      );
    };
    // O primeiro minuto conta ao abrir a tela; os seguintes, a cada 60 s.
    registrar();
    const timer = window.setInterval(registrar, JANELA_ATIVA_MS);
    return () => {
      window.clearInterval(timer);
      for (const e of EVENTOS) window.removeEventListener(e, marcar, { capture: true });
    };
  }, []);
}
