import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PlanningLogo } from "@/components/planning-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { readRecoveryLink } from "@/lib/password-recovery";

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
  const [status, setStatus] = useState<"checking" | "ready" | "invalid" | "done">(
    link.kind === "token" ? "ready" : link.kind === "legacy" ? "checking" : "invalid",
  );
  const verifiedUser = useRef<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (link.kind !== "legacy") {
      // Nenhuma chamada ao Auth ao abrir um link novo (inclusive em scanners).
      window.history.replaceState(window.history.state, "", window.location.pathname);
      return;
    }
    let active = true;
    // Compatibilidade com emails antigos. Nunca aceitar uma sessão de outra conta.
    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return;
        const session = data.session;
        if (!sessionError && session?.access_token === link.accessToken) {
          verifiedUser.current = session.user.id;
          setStatus("ready");
        } else setStatus("invalid");
        window.history.replaceState(window.history.state, "", window.location.pathname);
      })
      .catch(() => {
        if (active) setStatus("invalid");
      });
    return () => {
      active = false;
    };
  }, [link]);

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
    setLoading(true);
    try {
      if (!verifiedUser.current && link.kind === "token") {
        // Só a ação explícita da pessoa consome o token de uso único.
        const { data, error: tokenError } = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: link.tokenHash,
        });
        if (tokenError || !data.session || !data.user) {
          if (tokenError?.code === "otp_expired" || tokenError?.status === 403) {
            setStatus("invalid");
            setError("Este link expirou ou já foi usado. Solicite outro abaixo.");
          } else setError("Não foi possível validar o link. Tente novamente.");
          return;
        }
        verifiedUser.current = data.user.id;
      }
      const { data: current, error: userError } = await supabase.auth.getUser();
      if (userError || !verifiedUser.current || current.user?.id !== verifiedUser.current) {
        setStatus("invalid");
        setError("A sessão de recuperação não está disponível. Solicite um novo link.");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(
          updateError.code === "same_password"
            ? "Escolha uma senha diferente da anterior."
            : "Não foi possível salvar a senha. Confira os requisitos e tente novamente.",
        );
        return;
      }
      setPassword("");
      setConfirmPassword("");
      setStatus("done");
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: "https://planningbrain.com.br/redefinir-senha",
      });
      if (sendError) {
        setError(
          sendError.status === 429
            ? "Aguarde um minuto antes de solicitar outro link."
            : "Não foi possível enviar agora. Tente novamente em instantes.",
        );
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
        ) : status === "checking" ? (
          <p className="mt-6 text-center text-sm" role="status">
            Conferindo seu link…
          </p>
        ) : status === "ready" ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Escolha sua nova senha. Ela será alterada somente quando você salvar.
            </p>
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
                ? "Informe seu email para receber um link de recuperação."
                : "Este link expirou ou já foi usado. Informe seu email para receber um novo."}
            </p>
            {sent ? (
              <p role="status" className="text-sm">
                Se esse email estiver cadastrado, um novo link foi enviado. Use o email mais
                recente.
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
            <Link to="/auth" className="block text-center text-sm text-primary">
              Voltar para o login
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
