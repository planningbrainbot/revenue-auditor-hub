// Shared helpers for server functions. No secrets, no client.server imports —
// safe to import from any *.functions.ts or *.server.ts file.

export function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "");
}

export function monthRange(mes: string): { start: string; end: string; firstDay: string } {
  // mes: 'YYYY-MM'
  const [y, m] = mes.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startStr = fmt(start);
  return { start: startStr, end: fmt(end), firstDay: startStr };
}

/**
 * Verifica super admin ATIVO via `ops.eh_super_admin`. Lança Error na negação.
 *
 * Era `has_role(admin)`, que não olha `profiles.ativo`: um admin desativado com
 * o token ainda válido continuava passando aqui. `eh_super_admin` é a mesma
 * pergunta que a RLS faz (migration 20260925100000).
 */
export async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("eh_super_admin", { _user: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Acesso negado: necessário perfil admin.");
}
