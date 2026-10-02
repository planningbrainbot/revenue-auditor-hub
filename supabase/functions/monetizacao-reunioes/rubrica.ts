// Rubrica da avaliação de reunião do Caixa de Oportunidade, copiada de
// monetizacao/comercial/guia-closer/avaliacao/rubrica.json (protótipo validado em 01/10/2026).
// É JSON puro dentro de um módulo, para o deploy não depender de import de .json.
// Mudou a rubrica lá? Copie aqui, mantenha "versao" igual e rode
// scripts/monetizacao/testar-avaliacao-reunioes.mjs, que confere a cópia campo a campo.

export type Execucao = "sim" | "parcial" | "nao";
export type Fase = {
  id: number;
  nome: string;
  peso: number;
  objetivo: string;
  evidencias: string[];
  antipadroes: Record<string, string>;
};
export type TipoDeReuniao = { titulo: string; blocos: Record<string, number[]>; fases: Fase[] };
export type Rubrica = {
  versao: string;
  fonte: string;
  credito: Record<Execucao, number>;
  min_caracteres_transcricao: number;
  tipos: Record<"levantamento" | "proposta", TipoDeReuniao>;
  leitura: Record<string, string>;
};

export const RUBRICA: Rubrica = {
  versao: "2026-10-01",
  fonte:
    "Guia do closer · Caixa de Oportunidade, Momentos 2 e 3 (https://claude.ai/code/artifact/5bb52c7a-ece5-4089-9a9e-298a13394b7c). Método copiado da aderência de reunião do Growth (marketing-planning, automacoes/pipedrive-snapshot/aderencia_reuniao*.py): a IA só diz sim, parcial ou não com trecho literal; o código confere o trecho e calcula a nota.",
  credito: {
    sim: 1.0,
    parcial: 0.5,
    nao: 0.0,
  },
  min_caracteres_transcricao: 2000,
  tipos: {
    levantamento: {
      titulo: "Reunião de levantamento (20 min)",
      blocos: {
        abertura: [1],
        diagnostico: [2, 3, 4],
        saida: [5, 6, 7],
      },
      fases: [
        {
          id: 1,
          nome: "Abertura do Caixa",
          peso: 1.0,
          objetivo:
            "Apresentar o Caixa de Oportunidade inteiro, em três frentes (tributária judicial, crédito a recuperar e crédito bancário mais barato), dizer o que a reunião vai fazer nos 20 minutos e deixar claro que não é proposta.",
          evidencias: [
            "Cita as três frentes do Caixa, ou o Caixa como um todo, antes de perguntar",
            "Diz que a conversa é para ver o que serve à empresa, não uma proposta",
            "Combina o tempo da reunião",
          ],
          antipadroes: {
            abre_por_produto:
              "Abre falando de um produto só (só a tese jurídica, só crédito) sem apresentar o Caixa",
            abre_pelo_juridico:
              "Abre pela ação judicial, o que o guia manda evitar (o cliente responde que já tem jurídico)",
          },
        },
        {
          id: 2,
          nome: "Diagnóstico Cella",
          peso: 1.5,
          objetivo: "Levantar o que decide a tese tributária judicial.",
          evidencias: [
            "Pergunta o faturamento dos últimos 12 meses",
            "Pergunta ou confirma o regime tributário",
            "Pergunta se já há ação ou tese tributária em andamento, com outro escritório",
          ],
          antipadroes: {
            afirma_tese_sem_perguntar:
              "Afirma que a empresa tem direito a uma tese antes de levantar faturamento, regime e ações existentes",
          },
        },
        {
          id: 3,
          nome: "Diagnóstico Consultoria",
          peso: 1.5,
          objetivo: "Levantar o que decide a recuperação administrativa de crédito.",
          evidencias: [
            "Pergunta quem apura os tributos hoje",
            "Pergunta se a empresa já fez PER/DCOMP ou revisão de crédito",
            "Pergunta sobre crédito de PIS/Cofins ou ICMS acumulado ou não compensado",
          ],
          antipadroes: {},
        },
        {
          id: 4,
          nome: "Diagnóstico Finance",
          peso: 1.5,
          objetivo: "Levantar o que decide a captação de crédito mais barato.",
          evidencias: [
            "Pergunta sobre dívida bancária, com quem e a que custo",
            "Pergunta sobre necessidade de capital de giro",
            "Pergunta sobre plano de investimento ou expansão",
            "Pergunta onde ficam a sede e o projeto (decide a linha regional, FCO só no Centro-Oeste)",
          ],
          antipadroes: {},
        },
        {
          id: 5,
          nome: "Disciplina comercial",
          peso: 1.0,
          objetivo:
            "O closer não fala de preço, honorário, êxito, prazo ou valor estimado de crédito; se perguntado, remete ao especialista.",
          evidencias: [
            "Quando o cliente pergunta de preço ou prazo, responde que o especialista mostra com os números dele na próxima reunião",
            "Não cita percentual de honorário, valor de crédito ou prazo de recebimento",
          ],
          antipadroes: {
            prometeu_condicao:
              "O closer cita preço, honorário, êxito, prazo ou valor de crédito como compromisso",
            estimou_credito: "O closer estima quanto a empresa vai recuperar ou captar",
          },
        },
        {
          id: 6,
          nome: "Critério de saída",
          peso: 2.0,
          objetivo:
            "Dizer ao cliente quais produtos seguem para a proposta e com qual especialista (Igor na Cella, Jordana na Consultoria, Dárcio na Finance), ou que nenhum segue e por quê.",
          evidencias: [
            "Resume o que ouviu e diz qual ou quais frentes fazem sentido",
            "Nomeia o especialista que vai apresentar a proposta",
          ],
          antipadroes: {
            saida_vaga: "Encerra sem dizer o que segue",
          },
        },
        {
          id: 7,
          nome: "Próximo passo marcado",
          peso: 2.0,
          objetivo: "Marcar a reunião de proposta antes de desligar, com data e hora.",
          evidencias: [
            "Propõe dia e hora para a reunião com o especialista",
            "Confirma o horário com o cliente ainda na call",
          ],
          antipadroes: {
            vamos_nos_falando: "Encerra com 'vamos nos falando' ou equivalente, sem data",
            proximo_passo_sem_data: "Combina um próximo passo sem dia e hora",
          },
        },
      ],
    },
    proposta: {
      titulo: "Reunião de proposta com o especialista",
      blocos: {
        abertura: [1],
        proposta: [2, 3],
        saida: [4, 5],
      },
      fases: [
        {
          id: 1,
          nome: "Abertura e passagem",
          peso: 1.0,
          objetivo:
            "O closer abre, resume o levantamento em cerca de 2 minutos e apresenta o especialista.",
          evidencias: [
            "O closer resume o que o cliente disse no levantamento",
            "O closer apresenta o especialista e o papel dele",
          ],
          antipadroes: {},
        },
        {
          id: 2,
          nome: "Oportunidade com os números do cliente",
          peso: 2.0,
          objetivo:
            "O especialista mostra a oportunidade com os números e a situação do cliente, não uma apresentação genérica.",
          evidencias: [
            "O especialista usa dados do cliente (faturamento, regime, dívida, apuração) para mostrar a oportunidade",
            "O especialista explica o que seria feito e o que o cliente precisa mandar",
          ],
          antipadroes: {
            apresentacao_generica:
              "Apresentação institucional ou de tese sem nenhum dado do cliente",
          },
        },
        {
          id: 3,
          nome: "Condição só pelo especialista",
          peso: 1.0,
          objetivo:
            "Preço, honorário, êxito, prazo e garantia saem da boca do especialista; o closer não promete condição.",
          evidencias: ["As condições comerciais são apresentadas pelo especialista"],
          antipadroes: {
            closer_prometeu_condicao:
              "O closer, e não o especialista, promete preço, êxito, prazo ou garantia",
          },
        },
        {
          id: 4,
          nome: "Oportunidade validada",
          peso: 2.0,
          objetivo:
            "O especialista diz se existe oportunidade de fato e que vai preparar a proposta (é o que leva o card para Em negociação).",
          evidencias: [
            "O especialista afirma que existe oportunidade, ou que não existe, e por quê",
            "O especialista diz que vai preparar a proposta ou o que falta para decidir",
          ],
          antipadroes: {
            sem_veredito: "A reunião termina sem o especialista dizer se há oportunidade",
          },
        },
        {
          id: 5,
          nome: "Próximo passo com data",
          peso: 2.0,
          objetivo: "Sair com envio da proposta, documentos a mandar e data do retorno combinados.",
          evidencias: [
            "Combina o envio da proposta ou de documentos com prazo",
            "Marca a próxima conversa com dia e hora",
          ],
          antipadroes: {
            vamos_nos_falando: "Encerra com 'vamos nos falando' ou equivalente, sem data",
            proximo_passo_sem_data: "Combina um próximo passo sem dia e hora",
          },
        },
      ],
    },
  },
  leitura: {
    ofertado:
      "Para cada produto (cella, consultoria, finance): foi apresentado ou discutido na reunião? Responda sim ou nao, com trecho literal quando sim.",
    produtos_que_seguem:
      "Lista dos produtos que, pela conversa, seguem para a proposta (cella, consultoria, finance) ou lista vazia.",
    quem_falou_mais: "closer | cliente | equilibrado",
    desfecho: "proxima_reuniao_marcada | proposta_combinada | sem_proximo_passo | cliente_encerrou",
    recomendacao:
      "Uma ou duas frases para o closer melhorar a próxima reunião, ligadas a uma fase que não foi feita ou foi parcial.",
  },
};
