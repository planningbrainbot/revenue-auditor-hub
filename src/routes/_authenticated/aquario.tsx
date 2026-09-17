import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_authenticated/aquario")({
  beforeLoad: () => {
    throw redirect({
      to: "/clientes",
      search: { view: "monetizacao", status: "", unidade: "", q: "", origem: "", gate: "" },
    });
  },
});
