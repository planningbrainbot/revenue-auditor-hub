import { useEffect, useState } from "react";
import {
  aplicarTema,
  gravarModo,
  lerModo,
  temaPeloRelogio,
  type ModoTema,
  type Tema,
} from "@/lib/tema-compartilhado";

// Tipos antigos mantidos para não quebrar quem importa daqui. O vocabulário
// agora é o compartilhado ("escuro"/"claro"), porque a preferência viaja entre
// Ops, Growth e Financeiro — ver src/lib/tema-compartilhado.ts.
export type Theme = Tema;
export type ThemeMode = ModoTema;

export function useTheme() {
  const [mode, setMode] = useState<ModoTema>(() => lerModo());
  const [theme, setThemeState] = useState<Tema>(() =>
    mode === "auto" ? temaPeloRelogio() : mode,
  );

  // Modo automático: reavalia a cada minuto, para pegar a virada dia/noite sem
  // recarregar. Ele deixou de ser o padrão (o padrão agora é escuro, igual aos
  // outros dois produtos), mas segue disponível para quem escolher.
  useEffect(() => {
    if (mode !== "auto") {
      setThemeState(mode);
      return;
    }
    setThemeState(temaPeloRelogio());
    const id = window.setInterval(() => setThemeState(temaPeloRelogio()), 60_000);
    return () => window.clearInterval(id);
  }, [mode]);

  useEffect(() => {
    aplicarTema(theme);
  }, [theme]);

  useEffect(() => {
    gravarModo(mode);
  }, [mode]);

  return {
    theme,
    mode,
    setMode,
    // Ciclo: escuro → claro → automático → escuro...
    toggle: () => setMode((m) => (m === "escuro" ? "claro" : m === "claro" ? "auto" : "escuro")),
  };
}
