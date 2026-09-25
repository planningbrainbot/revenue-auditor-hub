import { createFileRoute, redirect } from "@tanstack/react-router";

// "Níveis de acesso" saiu em 24/09/2026. Abria o mesmo diálogo que Pessoas, sem
// a porta do Ops (dava para dar área a quem não entra) e sem caminho para o
// recorte. O nível de cada pessoa em cada área agora está na ficha dela, junto
// com a origem de cada acesso, e a lista de quem administra cada área está em
// Perfis e áreas.
export const Route = createFileRoute("/_authenticated/admin/niveis")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/usuarios", replace: true });
  },
});
