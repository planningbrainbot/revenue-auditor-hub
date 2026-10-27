// Regra pura do minuto ativo (R-01 do PRD do Uso do Brain), separada do hook
// para o teste rodar no node sem React nem Supabase.

export const JANELA_ATIVA_MS = 60_000;

export function minutoAtivo(agora: number, ultimaInteracao: number, visivel: boolean): boolean {
  return visivel && agora - ultimaInteracao < JANELA_ATIVA_MS;
}
