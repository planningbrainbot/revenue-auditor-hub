// Régua de tarefas da base nova (pipe 40 · Onboarding | Diagnóstico de Oportunidades). Pedido do Pedro em 16/10/2026,
// a partir da página do processo "Diagnóstico de Oportunidades e Riscos" (v1.0, 15/10/2026).
//
// Único arquivo de configuração das tarefas: trocar dia, dono ou texto é editar só este arquivo, e trocar
// VERSAO_REGUA. As tarefas de uma entrada já criada ficam na versão com que nasceram.
//
// Diferente da cadência do pipe 39 (dias úteis a partir do D0 da abordagem), aqui `dia` é dia CORRIDO a partir da
// entrada na etapa, como no relógio do processo (D+15, D+20, D+30). Se cair em fim de semana ou feriado, a tarefa vai
// para o dia útil seguinte. Na etapa 04 a entrada é o D0: o dia em que a pasta ficou completa.
//
// `quem`: "dono" é o dono do card (o Matheus, gestor do pipe 40); "jordana" é a sócia que apresenta o diagnóstico.
// `so`: a tarefa só existe no Lucro Real ou só no Presumido. `cada`: depois da primeira, uma nova a cada N dias
// enquanto o card estiver na etapa (a cobrança da pasta).
// Na nota, os campos entre colchetes que o Brain conhece são trocados na criação ([EMPRESA], [DIAS], [PRAZO
// PROMETIDO], [PRAZO INTERNO], [REGIME], [FAIXA], [LINK], [PRODUTO]); os outros ficam para quem executa.

export type Quem = "dono" | "jordana";
export type TipoAtividade = "task" | "call" | "email" | "whatsapp";
export type Regime = "real" | "presumido";
export type ItemDiagnostico = {
  chave: string;
  /** Etapa do pipe 40 (id) em que a tarefa nasce, ou "ganho" quando o card é marcado como ganho. */
  etapa: number | "ganho";
  /** Dias corridos a partir da entrada; um número por regime quando o prazo muda com ele. */
  dia: number | Readonly<Record<Regime, number>>;
  quem: Quem;
  tipo: TipoAtividade;
  titulo: string;
  nota: string;
  so?: Regime;
  cada?: number;
};

// v2 (22/10/2026): o cliente entra 30 dias depois de concluir o onboarding, e a apresentação da Jordana deixa de falar
// da implantação do BPO como se estivesse em curso.
export const VERSAO_REGUA = "diag-v2-2026-10-22";
/** Horário de toda tarefa, em São Paulo (a função converte para UTC). */
export const HORA_TAREFA = "09:00";

export const ETAPA = {
  novo: 293,
  elegivel: 294,
  coleta: 296,
  execucao: 297,
  concluido: 298,
  agendada: 299,
  apresentado: 300,
  negociacao: 301,
} as const;

/** Número da etapa no desenho do processo (01 a 08), usado no assunto da tarefa. */
export const NUMERO_ETAPA: Readonly<Record<number, string>> = {
  293: "01",
  294: "02",
  296: "03",
  297: "04",
  298: "05",
  299: "06",
  300: "07",
  301: "08",
};

/** SLA ao cliente, da pasta completa à apresentação (dias corridos), e prazo interno das três áreas. */
export const PRAZO_CLIENTE: Readonly<Record<Regime, number>> = { real: 30, presumido: 60 };
export const PRAZO_INTERNO: Readonly<Record<Regime, number>> = { real: 20, presumido: 45 };

export const REGUA: readonly ItemDiagnostico[] = [
  // 01 · Novo Cliente — dono: Matheus. Para avançar: regime e faturamento conferidos.
  {
    chave: "01-conferir",
    etapa: ETAPA.novo,
    dia: 0,
    quem: "dono",
    tipo: "task",
    titulo: "Conferir regime e faturamento",
    nota:
      "Confira com o cliente, ou no contrato, o regime e o faturamento anual da [EMPRESA]. O formulário da venda diz " +
      "[REGIME], faixa de [FAIXA].\n\n" +
      'Preencha "Diagnóstico · Faturamento conferido".\n' +
      "Entra: Lucro Real, ou Lucro Presumido acima de R$ 20 milhões por ano.\n" +
      'Fora do perfil: marque Perdido com o motivo "Fora do escopo".\n' +
      "Dentro: mova para 02 · Cliente Elegível para Diagnóstico.",
  },
  // 02 · Cliente Elegível — até 2 dias depois da venda. Para avançar: Jordana apresentada, SLA confirmado, checklist.
  {
    chave: "02-apresentar",
    etapa: ETAPA.elegivel,
    dia: 0,
    quem: "dono",
    tipo: "whatsapp",
    titulo: "Apresentar a Jordana ao cliente",
    nota:
      "Olá, [NOME]! Aqui é o Matheus, da Planning.\n\n" +
      "Agora que a implantação do BPO terminou, a [EMPRESA] vai receber um Diagnóstico de Oportunidades e Riscos: uma " +
      "análise única do que dá para recuperar, economizar ou captar.\n\n" +
      "Quem conduz é a Jordana Vieira, sócia responsável pelo diagnóstico. [FOTO E CURRÍCULO CURTO DA JORDANA]\n\n" +
      "O prazo é de [DIAS] dias a partir da documentação completa. Ainda hoje te mando a lista do que precisamos.",
  },
  {
    chave: "02-sla",
    etapa: ETAPA.elegivel,
    dia: 0,
    quem: "dono",
    tipo: "call",
    titulo: "Alinhar o SLA com o cliente",
    nota:
      "Ligue e confirme três coisas. Registre as respostas numa nota do card.\n" +
      "1. O cliente entendeu que o prazo de [DIAS] dias começa quando a documentação estiver completa.\n" +
      "2. Quem manda os documentos e por qual canal.\n" +
      "3. Quem precisa estar na apresentação (o decisor).",
  },
  {
    chave: "02-checklist",
    etapa: ETAPA.elegivel,
    dia: 0,
    quem: "dono",
    tipo: "email",
    titulo: "Enviar o checklist de documentos",
    nota:
      "Assunto: [EMPRESA] · documentos para o diagnóstico\n\n" +
      "[NOME], segue a lista do que precisamos para o diagnóstico:\n[CHECKLIST DO REGIME, NO GUIA DO DIAGNÓSTICO]\n\n" +
      "Pode mandar por aqui ou por WhatsApp. Assim que a lista estiver completa, o prazo de [DIAS] dias começa a " +
      "contar e eu te aviso a data da apresentação.",
  },
  // 03 · Coleta de Documentos — até a pasta completa. Para avançar: pasta completa, link no card, cadastro.
  {
    chave: "03-pasta",
    etapa: ETAPA.coleta,
    dia: 0,
    quem: "dono",
    tipo: "task",
    titulo: "Organizar a pasta no OneDrive e colar o link no card",
    nota:
      'Crie a pasta "[EMPRESA] · Diagnóstico" com a subpasta Resultados, suba o que o cliente mandou e cole o link ' +
      'em "Diagnóstico · Link da pasta (OneDrive)".',
  },
  {
    chave: "03-plataforma",
    etapa: ETAPA.coleta,
    dia: 0,
    quem: "dono",
    tipo: "task",
    titulo: "Cadastrar o cliente na plataforma da Consultoria",
    nota:
      "Cadastre a [EMPRESA] na plataforma da Consultoria com a origem e a sub-origem da venda (estão na nota fixada " +
      "deste card). A análise da Consultoria começa por esse cadastro.",
  },
  {
    chave: "03-cobrar",
    etapa: ETAPA.coleta,
    dia: 7,
    cada: 7,
    quem: "dono",
    tipo: "whatsapp",
    titulo: "Cobrar as pendências do cliente",
    nota:
      "Oi, [NOME]! Para o diagnóstico da [EMPRESA] começar, ainda falta: [ITENS QUE FALTAM]. Assim que chegar, o " +
      "prazo de [DIAS] dias começa a contar.",
  },
  // 04 · Diagnóstico em Execução — a entrada é o D0. Para avançar: as três áreas com status entregue ou sem oportunidade.
  {
    chave: "04-largada",
    etapa: ETAPA.execucao,
    dia: 0,
    quem: "dono",
    tipo: "task",
    titulo: "Largada: mandar pasta e prazo às três áreas",
    nota:
      "Mande para Consultoria, Finance e Teses Jurídicas, pelo canal de cada uma:\n\n" +
      "Diagnóstico · [EMPRESA] · largada\n" +
      "Regime: [REGIME] · faturamento: [FAIXA]\n" +
      "Pasta: [LINK]\n" +
      "Prazo interno: [PRAZO INTERNO]\n" +
      "Prazo do cliente: [PRAZO PROMETIDO]\n" +
      'Entrega: resumo de uma página na pasta Resultados, ou "sem oportunidade".\n\n' +
      "Deixe os três status do card em Pendente.",
  },
  {
    chave: "04-followup-15",
    etapa: ETAPA.execucao,
    dia: 15,
    quem: "jordana",
    tipo: "call",
    titulo: "Follow-up com o cliente (D+15)",
    nota:
      "[NOME], aqui é a Jordana, da Planning. Estou ligando para contar que o diagnóstico da [EMPRESA] está andando " +
      "dentro do prazo.\n\n" +
      "A apresentação fica para até [PRAZO PROMETIDO]. Quem precisa participar? Que dia funciona melhor para você?",
  },
  {
    chave: "04-aviso-3-dias",
    etapa: ETAPA.execucao,
    dia: { real: 17, presumido: 42 },
    quem: "dono",
    tipo: "task",
    titulo: "Avisar as áreas: prazo interno em 3 dias",
    nota:
      "Mande para as áreas que ainda estão Pendente no card:\n\n" +
      "Diagnóstico · [EMPRESA]: o prazo interno vence em [PRAZO INTERNO], daqui a 3 dias. Entrega: resumo de uma " +
      'página na pasta Resultados ([LINK]), ou "sem oportunidade".',
  },
  {
    chave: "04-conferir",
    etapa: ETAPA.execucao,
    dia: { real: 20, presumido: 45 },
    quem: "dono",
    tipo: "task",
    titulo: "Conferir a entrega das três áreas",
    nota:
      "Hoje é o prazo interno. Confira a pasta Resultados e atualize os três status do card (Entregue ou Sem " +
      "oportunidade). Com os três resolvidos, mova para 05 · Diagnóstico Concluído. Área atrasada: cobre o líder e " +
      "avise a Jordana.",
  },
  {
    chave: "04-followup-40",
    etapa: ETAPA.execucao,
    dia: 40,
    so: "presumido",
    quem: "jordana",
    tipo: "call",
    titulo: "Follow-up com o cliente (D+40)",
    nota:
      "[NOME], o diagnóstico da [EMPRESA] entra na reta final. Vamos deixar a apresentação marcada até [PRAZO " +
      "PROMETIDO]? Confirmo quem participa.",
  },
  // 05 · Diagnóstico Concluído — dona: Jordana. Para avançar: material único pronto e produtos adicionados ao card.
  {
    chave: "05-ler",
    etapa: ETAPA.concluido,
    dia: 0,
    quem: "jordana",
    tipo: "task",
    titulo: "Ler as três análises e decidir o que levar",
    nota: "Leia os resumos da pasta Resultados ([LINK]) e decida o que entra na apresentação: um, dois ou os três negócios.",
  },
  {
    chave: "05-material",
    etapa: ETAPA.concluido,
    dia: 2,
    quem: "jordana",
    tipo: "task",
    titulo: "Montar o material único",
    nota: "Monte um material só para a [EMPRESA], com o que foi analisado, os riscos e as oportunidades escolhidas.",
  },
  {
    chave: "05-produtos",
    etapa: ETAPA.concluido,
    dia: 2,
    quem: "jordana",
    tipo: "task",
    titulo: "Adicionar os produtos com o honorário esperado",
    nota:
      "Adicione ao card cada produto que vai apresentar (Diagnóstico · Consultoria, Finance, Teses Jurídicas), com o " +
      "honorário que espera fechar como preço. O valor do card passa a ser a soma.",
  },
  // 06 · Apresentação Agendada — até D+30 (Real) ou D+60 (Presumido). Para avançar: reunião realizada.
  {
    chave: "06-agendar",
    etapa: ETAPA.agendada,
    dia: 0,
    quem: "jordana",
    tipo: "email",
    titulo: "Agendar a apresentação (até [PRAZO PROMETIDO])",
    nota:
      "Assunto: Diagnóstico de Oportunidades e Riscos · [EMPRESA]\n\n" +
      "Confirmado para [DATA, HORA], com [PARTICIPANTES]. São 45 minutos: o que analisamos, os riscos, as " +
      "oportunidades por área e o que recomendamos.\n\nLink: [LINK DA REUNIÃO]",
  },
  // 07 · Diagnóstico Apresentado — no dia da apresentação. Para avançar: propostas enviadas.
  {
    chave: "07-propostas",
    etapa: ETAPA.apresentado,
    dia: 0,
    quem: "jordana",
    tipo: "email",
    titulo: "Enviar as propostas",
    nota:
      "[NOME], como combinamos, seguem as propostas do diagnóstico: [PRODUTOS]. Cada uma traz o honorário e o prazo. " +
      "Fico à disposição para ajustar o que precisar.",
  },
  // 08 · Negociação — até a decisão. Para avançar: ganho ou perdido (venda parcial tira o produto e registra o motivo).
  {
    chave: "08-decisao-2",
    etapa: ETAPA.negociacao,
    dia: 2,
    quem: "jordana",
    tipo: "whatsapp",
    titulo: "Follow-up da decisão (D+2)",
    nota:
      "Oi, [NOME]! Conseguiu avaliar as propostas do diagnóstico? Se fizer sentido, começamos por [PRODUTO DE MAIOR " +
      "ENCAIXE] e deixamos o resto para depois.",
  },
  {
    chave: "08-decisao-5",
    etapa: ETAPA.negociacao,
    dia: 5,
    quem: "jordana",
    tipo: "call",
    titulo: "Follow-up da decisão (D+5)",
    nota: "Ligue para o decisor e pergunte o que falta para decidir. Registre a resposta numa nota do card.",
  },
  {
    chave: "08-decisao-10",
    etapa: ETAPA.negociacao,
    dia: 10,
    quem: "jordana",
    tipo: "call",
    titulo: "Follow-up da decisão (D+10)",
    nota:
      "Último follow-up da régua. Sem decisão, combine uma data com o cliente ou feche o card:\n" +
      'Venda parcial: tire do card o produto não vendido, escreva qual e o motivo em "Diagnóstico · Produto não ' +
      'vendido e motivo" e marque Ganho.\nNenhuma venda: Perdido, com motivo.',
  },
  // Ganho — uma tarefa por produto vendido: cada um segue para a área que executa.
  {
    chave: "ganho",
    etapa: "ganho",
    dia: 0,
    quem: "dono",
    tipo: "task",
    titulo: "Passar [PRODUTO] para a área que executa",
    nota:
      "A [EMPRESA] fechou [PRODUTO]. Avise o líder da área, mande o link da pasta ([LINK]) e a proposta aceita, e " +
      "confirme quem vai tocar.",
  },
];
