// Régua da cadência da pré-venda da Monetização (pipe 39): o que o Brain cria no card quando ele passa de
// "1 · Base elegível" para "2 · Abordagem iniciada". Régua confirmada pelo dono do produto em 09/10/2026.
//
// Único arquivo de configuração da cadência: trocar dia, turno, canal ou texto é editar só este arquivo. Ao mudar a
// régua, troque também VERSAO_REGUA: cada card guarda a versão com que começou, e a função só completa (retomada) a
// cadência criada com a versão vigente.
//
// `dia` é o dia útil contado a partir do D0 (o dia da entrada na etapa); D4 e D9 ficam sem atividade de propósito.
// `canal` é o rótulo que vai no assunto: "Caixa · D{dia} · {canal} · {manhã|tarde}".
// `tipo` é o tipo de atividade do Pipedrive (key_string); se o tipo não existir ou estiver inativo, vira "task".
// `nota` é o texto pronto que vai na nota da atividade; os campos entre colchetes ficam para o pré-vendedor preencher.

export type Turno = "manha" | "tarde";
export type TipoAtividade = "email" | "call" | "whatsapp" | "task";
export type ItemRegua = {
  dia: number;
  turno: Turno;
  canal: string;
  tipo: TipoAtividade;
  nota: string;
};

export const VERSAO_REGUA = "v2-2026-10-09";

/** Horário de cada turno em São Paulo; a função converte para UTC, que é o que a API v1 do Pipedrive espera. */
export const HORARIO: Readonly<Record<Turno, string>> = { manha: "09:00", tarde: "14:00" };

const DOIS_TOQUES = "Dois toques. Sem recado.";

export const REGUA: readonly ItemRegua[] = [
  {
    dia: 0,
    turno: "manha",
    canal: "E-mail de apresentação",
    tipo: "email",
    nota:
      "Assunto: Oportunidades financeiras para a [EMPRESA] | equipe do [SÓCIO]\n\n" +
      "Boa tarde, [NOME]! Tudo bem?\n\n" +
      "Sou o [SEU NOME], da equipe do [SÓCIO], e cuido da Inteligência Financeira aqui na Planning.\n\n" +
      "Como já estamos à frente da contabilidade da [EMPRESA] e conhecemos de perto os números de vocês, " +
      "queremos contribuir também em outras frentes, avaliando oportunidades financeiras que vão além da rotina " +
      "contábil.\n\n" +
      "Consegue 10 minutos por telefone hoje? Quero te contar o que pensamos para a [EMPRESA].",
  },
  {
    dia: 0,
    turno: "tarde",
    canal: "Ligação",
    tipo: "call",
    nota: "Dois toques pelo ramal. Se atender, siga o script de ligação. Sem recado.",
  },
  {
    dia: 1,
    turno: "manha",
    canal: "Ligação",
    tipo: "call",
    nota: "Primeiro a ligação, pelo ramal. Sem atender, mande o WhatsApp logo em seguida.",
  },
  {
    dia: 1,
    turno: "manha",
    canal: "WhatsApp mensagem-base",
    tipo: "whatsapp",
    nota:
      "Bom dia, [NOME]! Sou o [SEU NOME], da equipe do [SÓCIO], e cuido da Inteligência Financeira aqui na " +
      "Planning.\n\n" +
      "Como já estamos à frente da contabilidade da [EMPRESA] e conhecemos de perto os números de vocês, " +
      "queremos avaliar oportunidades financeiras que vão além da rotina contábil. Te mandei um e-mail ontem com " +
      "o resumo.\n\n" +
      "Consegue 10 minutos por telefone hoje, às [HORÁRIO 1] ou às [HORÁRIO 2]?\n\n" +
      '(Versão B: antes da pergunta, acrescente "Olhando os números da [EMPRESA], vi [MOTIVO DO DOSSIÊ].")',
  },
  { dia: 1, turno: "tarde", canal: "Ligação", tipo: "call", nota: DOIS_TOQUES },
  { dia: 2, turno: "manha", canal: "Ligação", tipo: "call", nota: DOIS_TOQUES },
  {
    dia: 2,
    turno: "tarde",
    canal: "WhatsApp retomada",
    tipo: "whatsapp",
    nota:
      "[NOME], retomando minha mensagem: olhando a [EMPRESA], vi [MOTIVO DO DOSSIÊ] e acho que valem os 10 " +
      "minutos.\n" +
      "Consegue amanhã às [HORÁRIO]?",
  },
  {
    dia: 3,
    turno: "manha",
    canal: "WhatsApp aos sócios da unidade",
    tipo: "whatsapp",
    nota:
      "[SÓCIO], tentei falar com o [NOME], da [EMPRESA], desde [DIA DO D0] por e-mail, WhatsApp e ligação, e " +
      "ainda não tive retorno.\n" +
      "Vi [MOTIVO DO DOSSIÊ].\n" +
      "Você consegue dar um toque nele avisando que vou procurar e que valem os 10 minutos?\n" +
      "A unidade fica com 40% da nossa parte no que fechar.",
  },
  { dia: 3, turno: "tarde", canal: "Ligação", tipo: "call", nota: DOIS_TOQUES },
  { dia: 5, turno: "manha", canal: "Ligação", tipo: "call", nota: DOIS_TOQUES },
  {
    dia: 5,
    turno: "tarde",
    canal: "WhatsApp",
    tipo: "whatsapp",
    nota:
      'Se o sócio confirmou que falou: "[NOME], o [SÓCIO] comentou contigo sobre essa conversa? São 10 minutos ' +
      'por telefone para eu te contar o que pensamos para a [EMPRESA]. Pode ser [DIA] às [HORÁRIO]?"\n' +
      'Se não confirmou: "[NOME], sigo tentando falar contigo sobre as oportunidades financeiras da [EMPRESA]. ' +
      'Pode ser [DIA] às [HORÁRIO]? Se for melhor resolver por aqui mesmo, me diz."\n' +
      "Nunca diga que o sócio indicou ou falou se ele não confirmou.",
  },
  { dia: 6, turno: "manha", canal: "Ligação", tipo: "call", nota: DOIS_TOQUES },
  {
    dia: 6,
    turno: "manha",
    canal: "E-mail de reforço",
    tipo: "email",
    nota:
      "Assunto: [EMPRESA] · seguimos à disposição\n\n" +
      "[NOME], bom dia.\n\n" +
      "Reforçando o contato dos últimos dias. Como já cuidamos da contabilidade da [EMPRESA], conseguimos olhar, " +
      "junto com o [SÓCIO], oportunidades financeiras que vão além da rotina contábil.\n\n" +
      "São 10 minutos por telefone. Me diz o melhor horário e eu ligo.\n\n" +
      "[ASSINATURA]",
  },
  {
    dia: 6,
    turno: "tarde",
    canal: "WhatsApp",
    tipo: "whatsapp",
    nota:
      "[NOME], te mandei um e-mail hoje cedo com o resumo.\n" +
      "Se fizer sentido, te ligo amanhã às [HORÁRIO].",
  },
  { dia: 7, turno: "manha", canal: "Ligação", tipo: "call", nota: DOIS_TOQUES },
  {
    dia: 7,
    turno: "tarde",
    canal: "WhatsApp direto",
    tipo: "whatsapp",
    nota:
      "[NOME], vou ser direto.\n" +
      "Se não for o momento, sem problema, é só me dizer que eu encerro por aqui.\n" +
      "Se ainda fizer sentido, me dá 10 minutos esta semana. Você escolhe o horário.",
  },
  { dia: 8, turno: "manha", canal: "Ligação", tipo: "call", nota: DOIS_TOQUES },
  {
    dia: 8,
    turno: "tarde",
    canal: "WhatsApp de encerramento",
    tipo: "whatsapp",
    nota:
      "[NOME], não quero tomar seu tempo.\n" +
      "Sigo à disposição: quando fizer sentido olhar as oportunidades financeiras da [EMPRESA], é só me chamar " +
      "por aqui.",
  },
  {
    dia: 10,
    turno: "manha",
    canal: "Descartar se não respondeu",
    tipo: "task",
    nota:
      'Sem resposta e cadência executada inteira: marque perdido com o motivo "Tentativa de contato esgotada". ' +
      "Respondeu depois do D8: o card segue para 3 · Qualificação normalmente.",
  },
];
