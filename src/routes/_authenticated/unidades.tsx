import { Outlet, createFileRoute } from "@tanstack/react-router";

// Receitas Partners deixou de ser uma página com cinco abas e virou cinco
// páginas irmãs (14/09/2026). A lateral por área já separa os assuntos, então a
// aba só escondia tela dentro de tela: ninguém via "Split" sem antes abrir
// "Receitas Partners" e descobrir que havia mais coisa ali dentro.
//
// Esta rota é só o tronco do caminho /unidades/*. O conteúdo mora nas filhas.
export const Route = createFileRoute("/_authenticated/unidades")({
  component: () => <Outlet />,
});
