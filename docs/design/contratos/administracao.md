# Contratos · Administração, entrada e rotas órfãs

**Dono de produto:** Eliezek (acessos, casca)   **Autor:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Um arquivo, uma seção por rota. Papéis, chaves, RLS, RPCs de acesso e regras de concessão (DECISIONS 15/09–23/09) **não mudam**. Levantado em `b5c44d7`.

## Moldura (arquétipo Configuração)
- `AppShell` → `PageHeader` com `pergunta` e o **efeito da mudança** na `descricao` ("mudanças valem no próximo login", "a pessoa recebe e-mail").
- Referência da casa: `/admin/permissoes` (mostra "Passa a ver / Deixa de ver / Afeta N" antes de salvar e confirma só quando há perda). As outras seguem esse padrão.
- Todo `confirm()` nativo → `AlertDialog` com o efeito (V6). Toda escrita dá `toast` de sucesso **e de erro** (hoje várias falham caladas).
- Botão desabilitado diz o motivo (N8). Busca e filtros na URL. Estados do DS.

| Rota | Pergunta (N1) | O que muda além da moldura |
|---|---|---|
| `/admin/usuarios` | Quem acessa o Brain, com qual papel? | Excluir usuário e revogar o Growth: `AlertDialog`; excluir dá `toast`; trocar papel diz quais áreas a pessoa passa a ver/deixa de ver (já calculado para permissões); erro da lista → `EstadoErro`; `return null` para não admin → `EstadoSemAcesso` |
| `/admin/niveis` | Que nível cada pessoa tem em cada área? | Vazio por busca; "ficou sem área" aparece **antes** de salvar; revogar a porta do Ops: `AlertDialog` |
| `/admin/perfis` | Quais perfis existem, e quem está em cada um? | Excluir perfil: `AlertDialog` com "{n} pessoas perdem as áreas deste perfil" (o número já existe); `violet` → `StatusBadge neutro`; texto que cita o botão "Acessos" (removido) sai; erro da lista |
| `/admin/permissoes` | Quem vê o quê, em cada área? | Já é a referência; só a moldura |
| `/admin/acessos-financeiro` | Quem acessa o Financeiro, e de quais empresas? | Revogar: `AlertDialog`; retorno em `toast` além do aviso |
| `/admin/credenciais` | Quais chaves de integração estão cadastradas? | **Remover chave (inclusive a do Asaas) e sobrescrever: `AlertDialog`** com "a integração para até uma chave nova ser salva" |
| `/admin/integracoes` | Quais integrações estão ativas, e quando rodaram? | Ativar/desativar e excluir ganham `onError` com `toast` (hoje falham caladas); excluir: `AlertDialog`; ícone `Plug` (DESIGN §7, troca em `areas.ts` fica para o Eliezek); erro das tabelas |
| `/admin/validacao` | Quais páginas estão validadas para ir à main? | A caixa grava com `toast` e trata erro; o efeito ("a faixa de validação some para todos") fica ao lado da caixa; carregando/erro/vazio |
| `/equipe` | Quem está na minha área, e com qual acesso? | "Tirar da área": `AlertDialog`; **"Nomear sócio": `AlertDialog` com o efeito**; salvar desabilitado diz "escolha ao menos uma página"; área escolhida na URL |
| `/atividade` | O que mudou no sistema, e quem mudou? | Só a moldura (já tem estados) |

## `/inicio` (fora dos cinco arquétipos)
- A pergunta já existe ("Onde você quer entrar?").
- **[fluxo]** Com um produto interno só, manda para a **primeira tela acessível** (`primeiraTelaAcessivel`, que existe em `areas.ts` e não era usada), e não sempre para `/rede-overview` ou `/painel-unidade`. Quem só tem People hoje cai no Overview da Rede sem acesso (mesmo defeito de 22/09).
- Zero produtos → `EstadoVazio` "Seu usuário ainda não tem acesso a nenhum produto. Peça a um admin." Carregando → `Carregando`. Card do Growth ou do Financeiro que falha diz "indisponível" em vez de sumir.

## Rotas órfãs (fora do menu desde 14/09; `PRODUCT.md` 5.11, decisão do Eliezek)
- `/financeiro-partners` e `/pagamentos-unidades` ficam vivas e ganham só: `PageHeader` com a pergunta, aviso "tela fora do menu desde 14/09/2026" na `descricao` (N14), `AlertDialog` e `toast` em "validar pagamento", "Grand Total" → "Total", `tone="emerald/amber"` → tons do DS. "Pagamentos" de `/pagamentos-unidades` soma títulos pelo vencimento, pagos ou não: título "Títulos por vencimento".
- Aposentar ou dar dono de menu: decisão do Eliezek.

## Achados para o Eliezek (não mexidos)
- O portão do layout confere só a área, nunca a `chave` do item; rotas órfãs não passam por portão nenhum.
- `/financeiro-partners` e `/pagamentos-unidades` não conferem permissão na página (só RLS).
