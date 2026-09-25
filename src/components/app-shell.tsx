import type { ReactNode } from "react";
import { ValidationBanner } from "@/components/validation-banner";
import { DataFreshnessBar } from "@/components/data-freshness-bar";
import { PageHeader } from "@/components/planning";

interface AppShellProps {
  title: string;
  /** A pergunta que a tela responde (N1). Com ela, `title` sobe para o eyebrow. */
  pergunta?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  headerExtra?: ReactNode;
}

// As 19 telas que usam AppShell ganham o PageHeader sem tocar nelas. A borda
// sai do PageHeader e vai para a faixa inteira, porque o conteúdo dessas telas
// já traz o próprio `px-4 py-6`: o cabeçalho acompanha só o recuo lateral, e a
// linha de frescor logo abaixo fecha a faixa de ponta a ponta.
export function AppShell({ title, pergunta, subtitle, children, headerExtra }: AppShellProps) {
  return (
    <div className="flex min-h-full flex-col">
      <ValidationBanner />
      <div className="border-b px-4 pt-6">
        <PageHeader
          titulo={title}
          pergunta={pergunta}
          descricao={subtitle}
          acoes={headerExtra}
          className="border-b-0"
        />
      </div>
      <DataFreshnessBar />
      <div className="flex-1">{children}</div>
    </div>
  );
}
