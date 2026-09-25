# Contrato · Ficha da pessoa (`/admin/usuarios/$userId`)

**Dono de produto:** Eliezek (Administração)   **Dono do código:** Eliezek   **Data:** 25/09/2026
**Estado:** aprovado ("contrato ok" do dono, Pedro Luca, em 25/09/2026). Tela publicada no mesmo dia.

## Propósito
- **Pergunta que responde (h1):** "O que {primeiro nome} acessa, e por quê?"
- **Público:** super admin.
- **Decisão ou ação que provoca:** conferir o acesso real de uma pessoa, entender de onde vem cada parte e corrigir (perfil, áreas, recorte, produtos, senha), ou desligá-la de tudo.
- **Métrica de sucesso:** responder "o que a Fulana vê?" sem abrir outra tela; zero desligamento feito por três revogações separadas.
- **Arquétipo:** Ficha.
- **Universo medido:** uma pessoa · estado atual · áreas do Ops (14 ativas), três produtos.

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Produtos | portas abertas em `public.produto_acesso`, de 3 | produto | `produto_acesso` | ao abrir | seção "Em quais produtos entra?" | sim |
| Áreas do Ops que abre | áreas em `ops.acesso_do_usuario(user).areas` | área | a mesma função do menu e da RLS (`can_user`) | ao abrir | tabela de áreas | sim |
| Nota "N páginas e ações" | `acesso_do_usuario(user).permissions` | chave | idem | ao abrir | — | — |
| Unidades que vê | `usuario_escopo.todas_unidades` ou nº de `usuario_unidades` | unidade | recorte por pessoa | ao abrir | seção de recorte | sim |
| Último acesso | `auth.users.last_sign_in_at`, relativo | — | Auth | ao abrir | — | — |

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | ficha em curso | `Carregando variante="pagina"` |
| Vazio | pessoa sem nenhuma área | `EstadoVazio` que diz o efeito ("cai em você ainda não tem acesso") e o que fazer |
| Parcial | conta desativada | faixa "Conta desativada" + tudo o que volta se reativar |
| Erro | pessoa inexistente ou falha | `EstadoErro` com a mensagem |
| Sem acesso | não é super admin | redireciona para `/` |

## Filtros na URL (N7)
Nenhum. O objeto é o `userId` do caminho.

## Permissões (N8)
- Super admin ATIVO no servidor (`exigirSuperAdmin`); cada escrita delegada ainda passa pelas funções `ops.acesso_*`.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Editar (nome, e-mail, perfis) | super admin | diálogo; não tira o próprio Super admin | `toast` |
| Senha (link ou provisória) | super admin; provisória nunca para si nem para outro super admin | diálogo com as duas opções | painel com link ou senha |
| Desativar / Reativar | super admin, nunca a si | `AlertDialog` com o efeito e motivo opcional | `toast`; log |
| Excluir | super admin, só conta que nunca entrou | `AlertDialog` | volta à lista |
| Mudar acessos no Ops | super admin | diálogo de Acessos (porta + área a área) | ficha recarrega |
| Mudar recorte | super admin | diálogo de unidades | `toast` |
| Growth | super admin | diálogo; revogar pede segundo clique | `toast` |
| Ligar cadastro do Gente | super admin, só cadastro com o mesmo e-mail e sem login | — | `toast` |

## O que NÃO entra, e por quê
- Empresas do Financeiro: editadas em `/admin/acessos-financeiro`; aqui só se leem (um lugar só, uma regra só).
- Simular a pessoa: o "ver como" simula o perfil de uma unidade, não uma pessoa.
- Página por página de quem entra por perfil: o perfil dá a área inteira.

## Para onde manda (tela dona)
- Volta: Administração › Pessoas.
- `/admin/acessos-financeiro` (empresas), `/equipe` (pedido aberto).

## Checagem
- [ ] Definição de pronto cumprida (falta captura escuro/claro: não há login de teste; ver DECISIONS 25/09)
- [x] Origem das áreas conferida contra o banco (Heloísa: People como admin da área; Italo: Belém pelo recorte e pelo cadastro de sócio)
