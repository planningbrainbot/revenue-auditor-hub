import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getGrowthBrowserClient } from "@/integrations/supabase/client.growth";
import { getFinanceiroBrowserClient } from "@/integrations/supabase/client.financeiro";
import { emitirSessaoFinanceiro } from "@/lib/sessoes-irmas.functions";
import { PlanningLogo } from "@/components/planning-logo";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Acesso – Ops Board Planning Expansão" }],
  }),
  component: AuthPage,
});

// Só aparece quando o provider Azure estiver habilitado no Supabase do Ops.
// Enquanto VITE_MICROSOFT_LOGIN não for "true", a tela segue igual à de hoje.
const microsoftLoginEnabled = import.meta.env.VITE_MICROSOFT_LOGIN === "true";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "recover">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoverSent, setRecoverSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  async function handleRecoverSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });
      if (error) throw error;
      setRecoverSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  function backToLogin() {
    setMode("login");
    setError(null);
    setRecoverSent(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Login integrado: autentica também no Growth para que a sessão dele já
      // fique gravada no cookie do domínio raiz e a pessoa não precise logar
      // de novo ao abrir growth.planningbrain.com.br.
      //
      // Best-effort de propósito: se falhar (senha diferente nos dois, ou sem
      // conta no Growth), o acesso ao Ops não pode ser bloqueado por isso.
      const growth = getGrowthBrowserClient();
      if (growth) {
        const { error: gErr } = await growth.auth.signInWithPassword({ email, password });
        if (gErr) console.info("[login] Growth não autenticado:", gErr.message);
      }

      // Financial: caminho diferente do Growth de propósito. Lá a senha é a
      // mesma nos dois bancos; aqui ninguém tem senha (o cockpit nasceu sem
      // login), então o servidor emite um token de acesso único a partir da
      // identidade que ele acabou de verificar, e nós o trocamos por sessão.
      // Também best-effort: o acesso ao Ops não depende disto dar certo.
      const financeiro = getFinanceiroBrowserClient();
      if (financeiro) {
        try {
          const r = await emitirSessaoFinanceiro();
          if (r.ok) {
            const { error: fErr } = await financeiro.auth.verifyOtp({
              type: "email",
              token_hash: r.tokenHash,
            });
            if (fErr) console.info("[login] Financial não autenticado:", fErr.message);
          } else {
            console.info("[login] Financial sem sessão:", r.motivo);
          }
        } catch (e) {
          console.info("[login] Financial indisponível:", e);
        }
      }

      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  async function handleMicrosoft() {
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "openid profile email",
        redirectTo: `${window.location.origin}/`,
      },
    });
    // Em caso de sucesso o navegador é redirecionado para a Microsoft e nada
    // depois disto roda; só chegamos aqui se a chamada falhar.
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center gap-3">
          <PlanningLogo className="h-10 w-auto" />
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">Ops Board Planning Expansão</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "login" ? "Entre com suas credenciais" : "Recuperar senha"}
            </p>
          </div>
        </div>

        {mode === "login" ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-foreground">Senha</label>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode("recover");
                  }}
                  className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                >
                  Esqueceu a senha?
                </button>
              </div>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        ) : recoverSent ? (
          <div className="mt-6 space-y-4 text-center">
            <p className="text-sm text-foreground">
              Se houver uma conta com o email <span className="font-medium">{email}</span>,
              enviamos um link para redefinir a senha.
            </p>
            <button
              type="button"
              onClick={backToLogin}
              className="text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              Voltar para o login
            </button>
          </div>
        ) : (
          <form onSubmit={handleRecoverSubmit} className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Informe seu email de acesso. Vamos enviar um link para você criar uma nova senha.
            </p>
            <div>
              <label className="block text-sm font-medium text-foreground">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Enviando..." : "Enviar link de recuperação"}
            </button>
            <button
              type="button"
              onClick={backToLogin}
              className="w-full text-center text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              Voltar para o login
            </button>
          </form>
        )}

        {mode === "login" && microsoftLoginEnabled && (
          <>
            <div className="mt-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">ou</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <button
              type="button"
              onClick={handleMicrosoft}
              disabled={loading}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full border border-input bg-background px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-accent disabled:opacity-50"
            >
              <svg className="h-4 w-4" viewBox="0 0 23 23" aria-hidden="true">
                <path fill="#f35325" d="M1 1h10v10H1z" />
                <path fill="#81bc06" d="M12 1h10v10H12z" />
                <path fill="#05a6f0" d="M1 12h10v10H1z" />
                <path fill="#ffba08" d="M12 12h10v10H12z" />
              </svg>
              Entrar com Microsoft
            </button>
          </>
        )}

        {mode === "login" && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Não tem acesso? Solicite ao administrador do painel.
          </p>
        )}
      </div>
    </div>
  );
}

