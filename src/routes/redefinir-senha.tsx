import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PlanningLogo } from "@/components/planning-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  readRecoveryLink,
  PASSWORD_RECOVERY_URL,
  recoveryRequestError,
} from "@/lib/password-recovery";
import { createPasswordRecoveryFlow } from "@/lib/password-recovery-flow";

export const Route = createFileRoute("/redefinir-senha")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Redefinir senha – Planning Brain" },
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [link] = useState(() => readRecoveryLink(window.location.href));
  const [status, setStatus] = useState<"ready" | "invalid" | "done">(
    link.kind === "token" || link.kind === "legacy" ? "ready" : "invalid",
  );
  const [flow] = useState(() => createPasswordRecoveryFlow(supabase.auth, link));
  const [codeMode, setCodeMode] = useState(false);
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (password.length < 6) {
      setError("Use pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (codeMode && (!email.trim() || !/^\d{6,10}$/.test(code.trim()))) {
      setError("Informe seu e-mail e o código recebido.");
      return;
    }
    setLoading(true);
    const result = await flow.save(password, codeMode ? { email, token: code } : undefined);
    setVerified(flow.isVerified());
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      if (result.expired) {
        setStatus("invalid");
        setCodeMode(false);
        window.history.replaceState(window.history.state, "", window.location.pathname);
      }
      return;
    }
    window.history.replaceState(window.history.state, "", window.location.pathname);
    setPassword("");
    setConfirmPassword("");
    setCode("");
    setStatus("done");
  }

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: PASSWORD_RECOVERY_URL,
      });
      if (sendError) {
        setError(recoveryRequestError(sendError.status));
      } else setSent(true);
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  const buttonClass =
    "w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50";
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-lg">
        <div className="flex flex-col items-center gap-3">
          <PlanningLogo className="h-10 w-auto" />
          <h1 className="text-xl font-semibold text-foreground">Redefinir senha</h1>
        </div>
        {status === "done" ? (
          <div className="mt-6 space-y-5 text-center">
            <p role="status">Sua senha foi atualizada. Você já pode acessar o Planning Brain.</p>
            <Link to="/" className={`${buttonClass} block`}>
              Entrar no painel
            </Link>
          </div>
        ) : status === "ready" || codeMode ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Escolha sua nova senha. Ela será alterada somente quando você salvar.
            </p>
            {codeMode && (
              <>
                <label className="block text-sm font-medium">
                  Email de acesso
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    disabled={verified}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium">
                  Código do e-mail
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6,10}"
                    maxLength={10}
                    required
                    disabled={verified}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
                    className={inputClass}
                  />
                </label>
              </>
            )}
            <label className="block text-sm font-medium">
              Nova senha
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium">
              Confirmar nova senha
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button type="submit" disabled={loading} className={buttonClass}>
              {loading ? "Salvando…" : "Salvar nova senha"}
            </button>
          </form>
        ) : (
          <form onSubmit={requestLink} className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              {link.kind === "missing"
                ? "Informe seu e-mail para receber um link e um código de recuperação."
                : "Não foi possível ler este link. Use o código do e-mail ou solicite um novo abaixo."}
            </p>
            {sent ? (
              <p role="status" className="text-sm">
                Se esse e-mail estiver cadastrado, enviamos um novo link e um código. Use o e-mail
                mais recente. Ambos valem por 1 hora.
              </p>
            ) : (
              <>
                <label className="block text-sm font-medium">
                  Email de acesso
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <button type="submit" disabled={loading} className={buttonClass}>
                  {loading ? "Enviando…" : "Enviar novo link"}
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Link to="/auth" className="block text-center text-sm text-primary-text">
              Voltar para o login
            </Link>
          </form>
        )}
        {status !== "done" && !verified && (
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setCodeMode(!codeMode);
              setError(null);
            }}
            className="mt-5 w-full text-center text-sm font-medium underline underline-offset-4"
          >
            {codeMode ? "Voltar para recuperação por link" : "Usar código do e-mail"}
          </button>
        )}
      </div>
    </div>
  );
}
