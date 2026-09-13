// Relato de erro de tela.
//
// Substitui o `lovable-error-reporting`, que mandava a exceção para
// `window.__lovableEvents`, um objeto que só existia dentro da prévia do
// Lovable. Em produção aquilo nunca coletou nada: o objeto não existe fora de
// lá, e a chamada virava no-op silencioso.
//
// Hoje o destino é o console do navegador, que é o que a gente realmente
// consegue ler quando alguém manda um print. Se um dia entrar um coletor de
// verdade (Sentry e afins), é aqui que ele se pluga, num lugar só.

export function reportarErro(erro: unknown, contexto: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  console.error("[erro de tela]", {
    rota: window.location.pathname,
    ...contexto,
    erro,
  });
}
