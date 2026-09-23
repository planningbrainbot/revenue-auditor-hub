import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { reportarErro } from "../lib/error-reporting";
import { SCRIPT_TEMA_COMPARTILHADO } from "../lib/tema-compartilhado";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="num text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Erro 404
        </p>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O endereço não existe ou a tela mudou de lugar. Confira o link ou volte ao início.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-120 ease-planning hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportarErro(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div role="alert" className="max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-danger">
          Erro ao carregar
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
          Esta tela não carregou
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo falhou do nosso lado e o erro já foi registrado. Tente de novo ou volte ao início.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-120 ease-planning hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Tentar de novo
          </button>
          <a
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors duration-120 ease-planning hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Voltar ao início
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Planning Brain" },
      { name: "description", content: "Gestão a vista dos principais indicadores da rede" },
      { name: "author", content: "Planning" },
      { property: "og:title", content: "Planning Brain" },
      { property: "og:description", content: "Gestão a vista dos principais indicadores da rede" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Planning Brain" },
      { name: "twitter:description", content: "Gestão a vista dos principais indicadores da rede" },
      { property: "og:image", content: "https://planningbrain.com.br/brand/planning-logo-dark.png" },
      { name: "twitter:image", content: "https://planningbrain.com.br/brand/planning-logo-dark.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;500;600;700;900&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: SCRIPT_TEMA_COMPARTILHADO,
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      {/* 45 arquivos chamam toast(); sem isto montado, salvar, enviar ao CRM ou
          emitir fatura não dava retorno nenhum a quem clicou. */}
      <Toaster />
    </QueryClientProvider>
  );
}
