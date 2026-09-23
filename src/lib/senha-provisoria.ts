/**
 * A marca de quem está com uma senha provisória, gerada pelo admin em
 * /admin/usuarios e entregue na mão (WhatsApp, ligação, presencialmente).
 *
 * Mora em `app_metadata`, e não em `user_metadata`, porque a pessoa marcada
 * não pode se desmarcar: `user_metadata` é escrita pelo próprio usuário com o
 * token dele, e a marca é justamente o que o obriga a trocar a senha que
 * trafegou por um canal que não é o e-mail. Só o service role escreve aqui.
 *
 * Como viaja dentro do JWT, o portão de `/_authenticated` lê a marca sem ida
 * ao banco — mas ela só aparece no token emitido DEPOIS da geração, que é
 * exatamente o login que a pessoa faz com a senha provisória.
 */
export const MARCA_SENHA_PROVISORIA = "senha_provisoria";

export function temSenhaProvisoria(
  user: { app_metadata?: Record<string, unknown> | null } | null | undefined,
): boolean {
  return Boolean(user?.app_metadata?.[MARCA_SENHA_PROVISORIA]);
}
