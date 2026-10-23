# Contrato · Acessos do Financeiro (`/admin/acessos-financeiro`)

**Dono de produto:** Pedro Luca. **Operação:** Ana Carvalhais (controladoria). **Código:** Pedro Luca. **Data:** 23/10/2026 (só o convite; o resto da tela é de 15/09 e 24/09).

## Propósito
Quem acessa o Brain Financeiro, e de quais unidades. A Ana administra sem ser admin do Ops.

## Mudança de 23/10/2026: convidar pessoa nova
- Botão **Convidar pessoa nova** ao lado de "+ Dar acesso a quem já tem conta…".
- Abre o mesmo painel de unidades, com **Nome** e **E-mail** no topo. O botão Convidar fica desabilitado sem nome, sem e-mail ou sem unidade.
- Avisos enquanto digita (o servidor confere de novo):
  - já entra no Financeiro → bloqueia, manda para "Editar unidades";
  - já tem conta no Planning Brain → avisa que só libera o Financeiro;
  - e-mail de fora do grupo → avisa para conferir.
- O convite sempre vai por e-mail, com o link de definir senha (1 hora; depois, "Esqueci minha senha").
- Sucesso: toast e aviso na tela ("Conta criada para …, só com o Financeiro. O convite saiu por e-mail."). E-mail que não saiu: aviso amarelo com a saída ("Esqueci minha senha").
- Erro: toast e aviso vermelho com a mensagem do servidor; nada fica gravado pela metade.

## Permissões (N8)
`admin.acessos.financeiro` pela `ops.can`, na rota e em cada server function. A conta criada não recebe papel nem a porta do Ops.

## O que NÃO entra
Escolher papel do Ops, reativar conta desativada, mostrar o link de senha na tela.
