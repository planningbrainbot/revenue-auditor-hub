export const PAGE_DEFS: { key: string; label: string }[] = [
  { key: "/", label: "Hub Executivo" },
  { key: "/painel-unidade", label: "Painel da Unidade (Sócio Franqueado)" },
  { key: "/clientes", label: "Clientes" },
  { key: "/operacao", label: "Operação" },
  { key: "/contas-receber", label: "Contas a Receber" },
  { key: "/funil-receita", label: "Funil de Receita (+ Auditorias)" },
  { key: "/unidades", label: "Receitas Partners (Regras + Royalties, Histórico & CAC)" },
  { key: "/meus-royalties", label: "Meus Royalties (Sócio Franqueado)" },
  { key: "/financeiro-partners", label: "Financeiro Partners (FCx · DRE · Receitas · Despesas)" },
  { key: "/painel-cs", label: "CS (Onboarding, Saúde da Carteira, Tratativas, NPS)" },
  { key: "/ebit-operacional", label: "EBIT Operacional (Custo x Venda de Serviços)" },
  { key: "/admin/usuarios", label: "Admin · Usuários" },
  { key: "/admin/permissoes", label: "Admin · Permissões" },
  { key: "/admin/validacao", label: "Admin · Validação de Páginas" },
];


export async function ensureAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error("Erro de autorização.");
  if (!data) throw new Error("Acesso negado: somente administradores.");
}
