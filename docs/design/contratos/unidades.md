# Contrato · Regras da Rede (`/unidades`)

**Dono de produto:** Eliezek (Receita e Repasses)   **Dono do código:** Eliezek   **Data:** 01/10/2026
**Estado:** escopo aprovado pelo dono no chat ("pode seguir sua proposta", 01/10/2026) e publicação autorizada depois de validar localmente ("pode publicar", 01/10/2026).

## Propósito
- **Pergunta que responde (h1):** "Qual é a regra de repasse de cada unidade?" (sem mudança)
- **Público:** quem tem `view.unidades_rede` lê; quem tem `manage.unidades_rede` (área Administração, hoje só o papel `admin`) cria e edita.
- **Decisão ou ação que provoca:** cadastrar unidade nova pela tela, sem SQL, e fechar as lacunas de cadastro das existentes (opção do Pipedrive, vínculo com o Pipefy, CNPJ, royalties, cliente no Omie, faturamento do CSC).
- **Métrica de sucesso:** nenhuma unidade nova entra por SQL; nenhuma regional com "pendências" além das que dependem de fora (Omie).
- **Arquétipo:** Configuração (lista com busca + edição em `Dialog` + `toast`).
- **Universo medido:** todas as linhas de `ops.unidades` (15 em 01/10/2026) · regra vigente hoje · unidade de contagem: unidade.

## Números
Sem número novo. Os quatro `KpiCard` de antes ficam como estavam. A coluna "Cadastro" (só para quem cadastra) mostra a contagem de pendências da linha, pela mesma função `pendenciasDaUnidade()` que o diálogo usa, então a linha e o diálogo nunca discordam.

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | leitura das unidades | `Carregando` (como antes) |
| Vazio por filtro | busca/status sem resultado | `EstadoVazio total={n}` (como antes) |
| Erro | falha ao ler `ops.unidades` | `ErroDaConsulta` (como antes) |
| Pipefy indisponível | falha em `listarBasePipefyUnidades` no diálogo de unidade nova | erro abaixo do campo; o formulário segue preenchível à mão |
| Sem leitura do CSC | sem `view.csc_faturamento` ou falha na leitura | a pendência "fora do faturamento do CSC" não é afirmada (null, nunca falso) |
| Sem a chave de cadastro | sem `manage.unidades_rede` | "Nova unidade" desabilitado com o motivo no tooltip (N8); a coluna Cadastro e o "Editar" não aparecem |

## Filtros na URL (N7)
Sem mudança: `q` e `status`. O diálogo aberto não vai para a URL.

## Permissões (N8)
- Área que abre a tela: `receita` (`view.unidades_rede`), sem mudança.
- Chave de escrita: `manage.unidades_rede`, na área **admin**, não na receita. A receita é dada a head, auditor, socio e cs, e "quem tem a área tem todas as ações dela" entregaria a eles o percentual de royalties.
- Criar o registro de CSC pede também `edit.csc_faturamento` (já existente, área receita).
- A RLS de `ops.unidades` pede a mesma chave (migration `20261001220000_unidades_cadastro.sql`). DELETE não tem policy.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Nova unidade | `manage.unidades_rede` | formulário; pode partir de um registro da base de Unidades do Pipefy que ainda não está ligado a unidade | `toast` "X cadastrada."; lista recarrega |
| Editar | `manage.unidades_rede` | formulário com as pendências ao vivo | `toast` "X atualizada."; lista recarrega |
| Incluir em Emitir faturas | `manage.unidades_rede` + `edit.csc_faturamento`, regional, fora de `csc_unidades`, com cliente no Omie e CSC fixo | caixa no formulário; sigla e e-mails | se falhar, a unidade fica salva e um `toast` de erro diz que o CSC não entrou |

Toda gravação deixa linha em `ops.acessos_log` (`unidade_criar`, `unidade_editar` com antes/depois dos campos que mudaram, `csc_unidade_criar`).

## O que NÃO entra, e por quê
- **Apagar unidade:** unidade é referenciada por texto em contratos, empresas e apurações; apagar a linha deixaria tudo órfão sem erro.
- **Criar o cliente no Omie da Partners:** é outro sistema e outra conta; a tela pede o código e mostra a pendência.
- **Dar acesso ao sócio:** acesso é `/admin/usuarios` (escopo por pessoa); cadastro de unidade não concede nada.
- **Editar o CSC de quem já está em `csc_unidades`:** valor, serviço e regra de vencimento das unidades antigas não são assunto desta tela.
- **Sobrescrever unidade existente com o Pipefy:** a base do Pipefy diverge do Ops (6% contra 8% de royalties em Patos de Minas); a importação só existe para unidade nova.
- **Lista ao vivo das opções do Pipedrive:** o app não tem token do Pipedrive; o campo é o número da opção, com ajuda.

## Para onde manda (tela dona)
- Faturas do CSC: Apuração de Royalties › Emitir faturas.
- Acesso dos sócios: `/admin/usuarios`.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida (falta captura escuro/claro: não há login de teste)
- [x] RLS conferida no banco com usuário simulado: admin cria e edita; CS é recusado no INSERT e não altera linha no UPDATE; nome repetido é recusado
