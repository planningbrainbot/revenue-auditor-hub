import { createFileRoute, redirect } from "@tanstack/react-router";

// O cadastro de perfis mudou para /admin/permissoes em 24/09/2026: as duas
// telas editavam o mesmo objeto e mostravam as mesmas contagens. Fica o
// endereço antigo apontando para lá, para favorito e link colado não darem 404.
export const Route = createFileRoute("/_authenticated/admin/perfis")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/permissoes", replace: true });
  },
});
