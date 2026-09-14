import { Clock, Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";

// A preferência vale nos três produtos (ver lib/tema-compartilhado.ts), e o
// rótulo diz isso: senão a pessoa acha que mudou só esta tela.
const LABELS: Record<string, string> = {
  auto: "Automático, pelo horário — clique para o tema escuro. Vale em Ops, Growth e Financeiro",
  claro: "Tema claro — clique para automático. Vale em Ops, Growth e Financeiro",
  escuro: "Tema escuro — clique para o tema claro. Vale em Ops, Growth e Financeiro",
};

export function ThemeToggle() {
  const { mode, theme, toggle } = useTheme();
  const Icon = mode === "auto" ? Clock : theme === "escuro" ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={LABELS[mode]}
      title={LABELS[mode]}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-accent"
    >
      <Icon size={16} />
    </button>
  );
}
