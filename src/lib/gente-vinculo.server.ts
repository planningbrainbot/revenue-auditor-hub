// Login e cadastro de gente são duas identidades. Sem `gente_pessoas.user_id`
// a pessoa entra no Ops e 1:1 e feedback barram em silêncio, porque
// `minha_pessoa_id()` volta nulo. O cadastro liga quem já tem login
// (`criarPessoa`); isto aqui liga pelo outro lado, quando o login nasce depois
// do cadastro. Chamar com o cliente de service role, depois de criar a conta.
export async function vincularCadastroDeGente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adm: any,
  userId: string,
  email: string,
): Promise<void> {
  const { error } = await adm
    .from("gente_pessoas")
    .update({ user_id: userId })
    .ilike("email", email.trim())
    .is("user_id", null);
  if (error) console.error("[vincularCadastroDeGente] falhou:", error);
}
