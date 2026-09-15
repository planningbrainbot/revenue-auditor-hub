import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/rede")({
  beforeLoad: () => {
    throw redirect({ to: "/unidades" });
  },
  component: () => null,
});
