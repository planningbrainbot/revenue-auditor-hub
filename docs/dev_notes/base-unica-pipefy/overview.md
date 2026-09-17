---
task: base-unica-pipefy
status: doing
updated: 2026-09-16
---

# PRD — Base única de empresas e sincronização com Pipefy

## Resultado de produto

O módulo Clientes será a entrada única para consultar a base de empresas, seus contatos, negócios e oportunidades de monetização. A antiga rota Aquário será uma visão/atalho dessa mesma base, sem cadastro ou total independente. O operador verá o refinamento Bruta → com CNPJ → com contato → com ECD registrada e uma fila por unidade para confirmar a origem das empresas. Campos cadastrais compartilhados terão o Pipefy como fonte oficial: uma correção autorizada será gravada na origem, relida e refletida no Supabase, com estado de sincronização visível.

## Instruções que governam esta entrega

Origem: cinco atividades do print e instrução de 16/09/2026 para executar com PRD e SDD. Estas instruções substituem regras anteriores incompatíveis.

1. Refinar os vínculos de ECD já autorizados, por CNPJ e exercício, preservando fonte e data. Existência de ECD não equivale a receita positiva ou a oportunidade confirmada.
2. Unificar Clientes e Aquário; distinguir empresa, contato e negócio. Mais de um contato, contrato ou negócio não multiplica a empresa.
3. Registros do Omie de unidades diferentes de Curitiba são Base Nova, com ou sem pagamento. Curitiba contém as duas origens e exige evidência específica.
4. Registro anteriormente Antigo que tenha vínculo elegível com Omie/Pipedrive deve ser corrigido para Novo, incluindo o Pipefy quando possuir cadastro nele. Não mascarar a divergência apenas no painel.
5. Empresa sem vínculo com Omie/Pipedrive entra na lista da unidade responsável para confirmar Antiga/Nova. Ausência de vínculo, contato ou pagamento não comprova origem antiga.
6. O refinamento de completude não modifica o perfil dos produtos. Consultoria continua sem exigência de contato, faturamento mínimo ou ECD, mas exige origem antiga confirmada e fora do Simples/MEI.

## Pontos de regra aguardando resposta

- **Pipedrive:** presença em qualquer cadastro/negócio ou somente contrato ganho comercial? Pergunta enviada antes da implementação. Preparar os dois cenários; não executar reclassificação dependente até a resposta.
- **Curitiba:** usar origem já confirmada no Pipefy, conta Omie de origem ou validação da unidade? Pergunta enviada. Casos não comprovados ficam pendentes; pagamento não decide.

## Estado atual e falhas confirmadas

- `ops.empresas`/`ops.contatos` são o cadastro operacional; `ops.omie_clientes` contém pré e pós Planning, CPFs, inativos e registros sem atualização recente.
- `ops.monetizacao_contas` consolida identidades comerciais com vínculos `empresa_ids`/`org_ids`; `monetizacao_detalhes` guarda evidências e enriquecimentos. Reutilizar os IDs existentes e preservar listas/envios.
- A aba legada Base Antiga lista Omie sem aplicar os filtros descritos na legenda. A Base Nova não filtra `origem_da_base`.
- O refresh de Monetização não recalcula unidade/evidência de unidade; aliases e códigos podem aparecer como conflito.
- Funções Pipefy implantadas não bastam para provar entrega de eventos. Webhooks, agendas, resultado e reconciliação precisam ser verificados.
- Auditoria Interna falha com parsing de data; Tratativas/NPS apresentam atraso nos logs. A função Omie possui cobertura incompleta e pode anunciar sucesso parcial como completo.

Os volumes de produção, exemplos individuais, chaves e relatórios de extração ficam fora do repositório público.

## Modelo de autoridade e identidade

| Informação | Autoridade | Tratamento |
|---|---|---|
| Cadastro compartilhado, unidade da carteira, origem confirmada | Pipefy | Supabase espelha após leitura confirmada; nunca sobrescrever silenciosamente apenas o espelho |
| Presença e cadastro Omie | Omie | Evidência identificada por conta Omie + código + CNPJ; unidade financeira não substitui automaticamente a carteira |
| Negócio, etapa, proprietário, produto e ganho | Pipedrive | Vínculo ao cadastro por IDs/CNPJ comprovados; negócio não é empresa |
| Regime e receita estimada Driva | Evidência Driva | Fonte/data próprias; estimativa de grupo não vira faturamento declarado do estabelecimento |
| ECD | Metadados já existentes no Brain | CNPJ/exercício/registro; sem copiar escrituração bruta ou material fiscal de outras frentes |
| Classificação calculada pela regra nova | Regra versionada + evidências | Proposta auditável; publicar correção no Pipefy e confirmar o espelho antes de declarar sincronizado |

Uma empresa preserva seus identificadores de origem. CPF é documento de pessoa, não CNPJ de empresa. CNPJ inválido ou vínculo ambíguo permanece em refinamento. Não unir por razão social parecida nem agrupar automaticamente por raiz de CNPJ. Grupos/contas comerciais existentes preservam seus vínculos explícitos; contagens informam o denominador (empresa, CNPJ, contato ou negócio).

## Experiência alvo

- `/clientes`: base única, filtros persistidos por unidade, origem, produto, situação de refinamento e sincronização.
- Visões Empresas, Contatos, Negócios, Monetização e Pendências da unidade sobre as mesmas identidades.
- `/aquario`: compatibilidade para abrir Clientes na visão Monetização; sem segundo item independente no menu.
- Ficha da empresa: unidade responsável, origem e motivo, fontes com data, contatos vinculados, negócios, ECD por exercício e perfil por produto. Divergência mostra campo/fonte/estado de resolução.
- Funil cumulativo com contagem e lista clicável em cada degrau; permissões e filtros idênticos entre numerador e lista. Campos vazios aparecem como pendência, não como exclusão comercial.
- Lista por unidade para validação, com exportação, confirmação autenticada, responsável/data/evidência e propagação ao Pipefy. Não enviar mensagens a sócios sem autorização específica.

## Contrato de sincronização

- Webhook autenticado solicita releitura do registro no Pipefy; o payload recebido não é autoridade para sobrescrever campos.
- Processamento idempotente por fonte/registro/revisão; eventos repetidos, atrasados ou fora de ordem não duplicam nem restauram estado antigo.
- Reconciliação periódica cobre eventos perdidos e compara campos compartilhados. Atraso ou falha fica visível; não prometer consistência instantânea entre serviços.
- Meta operacional: evento refletido em até cinco minutos em condições normais; discrepância detectada e sinalizada na reconciliação. Nenhuma falha recebe rótulo de sucesso.
- Escrita iniciada no Brain usa fila de alterações com valor anterior, regra/ator, estado e releitura confirmatória. Timeout de criação não causa POST cego repetido.
- Exclusões são reconciliadas sem apagar histórico de contatos, contratos, listas ou envios.
- Não criar uma segunda rotina concorrente sem inventariar/desativar de forma controlada a antiga.

## Critérios de aceite

| ID | Cenário obrigatório |
|---|---|
| AC01 | Clientes e a visão de Monetização usam a mesma identidade/fonte e reconciliam totais sob os mesmos filtros |
| AC02 | Dois contatos e três negócios da mesma empresa contam uma empresa, dois contatos e três negócios |
| AC03 | Omie fora de Curitiba classifica como Nova independentemente de pagamento |
| AC04 | Curitiba respeita a regra confirmada; sem evidência suficiente fica pendente |
| AC05 | Vínculo Pipedrive aplica a decisão confirmada e documenta a mudança de origem |
| AC06 | Sem Omie/Pipedrive gera pendência com unidade responsável; unidade desconhecida tem fila própria |
| AC07 | Funil é cumulativo e cada número abre exatamente os registros que o compõem |
| AC08 | ECD só consta quando há metadado correspondente ao CNPJ/exercício; não fabricar receita nem vínculo por nome |
| AC09 | Aliases/códigos conhecidos da mesma unidade não geram conflito; discordância real conserva evidência |
| AC10 | Alteração no Pipefy chega ao Supabase e à interface; evento repetido não duplica |
| AC11 | Falha/reordenação de eventos preserva estado correto e erro visível; reconciliação recupera evento perdido |
| AC12 | Correção originada no Brain aparece no Pipefy e volta confirmada ao espelho; erro não simula sucesso |
| AC13 | RLS mantém isolamento por unidade e acesso a contatos; nenhum segredo ou dado individual entra no Git/cliente web |
| AC14 | Listas e envios existentes sobrevivem; produtos, reservas e idempotência do CRM continuam válidos |
| AC15 | Auditoria Interna processa datas válidas e identifica as inválidas sem erro silencioso; monitor distingue parcial/erro/atraso |

## Arquitetura e limites

Reutilizar as tabelas e permissões existentes; antes de criar estrutura nova, verificar o schema de produção e as migrations. Adicionar apenas vínculos de origem, evidências, estado de sincronização e filas ausentes. Não introduzir cópia independente chamada nova base de clientes. A importação amplia a cobertura por etapas e conserva uma prévia mensurável e reversível das mudanças.

Enriquecimento externo em massa não está implícito: aproveitar as evidências já obtidas. Acessar somente dados Planning autorizados; não ler nem transportar escrituração bruta de contribuintes de outra frente. Não criar negócios de teste no CRM nem enviar convites, e-mails ou mensagens.

## Sequência SDD

| Documento | Entrega | Dependência |
|---|---|---|
| task01_contratos.md | Modelo, precedência, cenários e inventário de produtores/consumidores | — |
| task02_sincronizacao.md | Pipefy autoritativo, eventos/reconciliação, erros e propagação | task01 |
| task03_base_origem_ecd.md | Identidade única, Omie, origem, ECD e pendências | task01; decisões pendentes |
| task04_interface.md | Clientes único, visões, filtros, funil e ficha | task02, task03 |
| task05_publicacao.md | Migração/reconciliação, testes integrados, revisão e publicação | task02–04 |
| summary.md | Evidências reais de execução e itens pendentes | preenchimento contínuo |

## Primeiro espelhamento: preservar evidência histórica

A prévia confirmou que existem campos vazios no Pipefy preenchidos no Brain. A carga inicial não pode apagar silenciosamente esses valores nem trocar um CNPJ/vínculo Pipedrive conflitante. O snapshot técnico registra o valor remoto; o cadastro preserva a informação anterior e assume estado pendente. A interface informa quais campos precisam ser reconciliados. Repetir o evento não apaga a pendência. Depois de corrigir a origem e reler, o espelho converge e sai da pendência. A decisão de preencher o Pipefy com evidências conferidas foi solicitada ao usuário; nenhum preenchimento em massa foi executado.

## Publicação e reversibilidade

Branch isolada a partir da main Planning atual. Backups privados do recorte alterado, migrações aditivas e prévia das correções por regra. Publicar código sem dados/chaves. Aplicar alterações de origem por lotes auditáveis, com verificação no Pipefy e no banco. Preservar rotas antigas como redirecionamentos e histórico. Conclusão exige domínio publicado, build/testes, reconciliação de contagens e teste do caminho real; não basta código compilando.
