// Contexto mínimo de uma leitura do cockpit: o cliente do Supabase com a sessão da pessoa (RLS) e o
// id dela. É o que o middleware `requireSupabaseAuth` entrega à tela e o que o servidor da conversa
// monta a partir do mesmo token; nenhuma leitura recebe credencial de serviço por aqui.
export interface ContextoCockpit {
  supabase: unknown;
  userId: string;
}
