// Login e cadastro de gente são duas identidades. Sem `gente_pessoas.user_id`
// a pessoa entra no Ops e 1:1 e feedback barram em silêncio, porque
// `minha_pessoa_id()` volta nulo. O cadastro liga quem já tem login
// (`criarPessoa`); isto aqui liga pelo outro lado, quando o login nasce depois
// do cadastro. Chamar com o cliente de service role, depois de criar a conta.
//
// Quando NÃO liga sozinho (revisão de 25/09/2026): cadastro criado à mão no
// People (`origem = 'manual'`) cuja unidade não está no recorte da conta nova.
// Quem cadastra no People define o gestor; ligar sem olhar deixava um sócio
// cadastrar o e-mail de alguém da Matriz antes de a conta existir e virar
// gestor dela, lendo 1:1 e PDI. Nesse caso a ficha da pessoa mostra o cadastro
// solto e o super admin liga com um clique, vendo de quem é.
export async function vincularCadastroDeGente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adm: any,
  userId: string,
  email: string,
  recorte: { todas: boolean; unidades: number[] },
): Promise<void> {
  const { data: cadastro, error: eBusca } = await adm
    .from("gente_pessoas")
    .select("id, origem, unidade_id")
    // Igualdade exata: com `ilike` o `_` do e-mail é curinga.
    .eq("email", email.trim().toLowerCase())
    .is("user_id", null)
    .maybeSingle();
  if (eBusca) {
    console.error("[vincularCadastroDeGente] busca falhou:", eBusca);
    return;
  }
  if (!cadastro) return;
  const confiavel =
    cadastro.origem !== "manual" ||
    (!recorte.todas && cadastro.unidade_id != null && recorte.unidades.includes(cadastro.unidade_id));
  if (!confiavel) return;
  const { error } = await adm
    .from("gente_pessoas")
    .update({ user_id: userId })
    .eq("id", cadastro.id)
    .is("user_id", null);
  if (error) console.error("[vincularCadastroDeGente] falhou:", error);
}
