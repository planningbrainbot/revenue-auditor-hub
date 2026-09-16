import { createFileRoute } from "@tanstack/react-router";
import { Aquario } from "@/components/monetizacao/aquario";
export const Route = createFileRoute("/_authenticated/aquario")({ component: Aquario });
