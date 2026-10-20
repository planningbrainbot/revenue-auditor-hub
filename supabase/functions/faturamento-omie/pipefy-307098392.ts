// Gerado por scripts/faturamento/gerar-pipefy-schema.py a partir de
// PM Work/execution/portal-faturamento-prd-20261013/e1/pipefy-307098392-schema.json, com a Mudança de 20/10.
// Não edite à mão: leia o pipe de novo e rode o script.

export type CampoPipefy = {
  label: string;
  tipo: string;
  obrigatorio: boolean;
  opcoes?: string[];
  tabela?: string;
};
export type FasePipefy = {
  nome: string;
  concluida: boolean;
  pode_ir_para: string[];
  campos: Record<string, CampoPipefy>;
};

export const PIPE = {
  id: "307098392",
  uuid: "eff14c95-a9d8-45be-8e5b-9f1b16726843",
  organizacao: "301687918",
  fase_inicial: "342815179",
  lido_em: "2026-10-20",
  mudancas: [
    "20/10/2026: cnpj_cliente_1 e cpf_do_cliente deixaram de ser obrigatórios no formulário (OK do Pedro).",
    "20/10/2026: SOLICITAÇÃO ABERTA ganhou cpf_cnpj_do_cliente_conferido (checklist_vertical, obrigatório), que o portal marca ao criar o card.",
  ],
  colaboradores: {
    tabela: "1Vck_P6q",
    email: "e_mail_comercial",
  },
} as const;

export const OPCAO_CONFERIDO =
  "Conferido: o card tem o CPF (pessoa física) ou o CNPJ (pessoa jurídica) do cliente, e o número está certo";

export const CAMPOS_INICIO: Record<string, CampoPipefy> = {
  coordena_o_respons_vel: {
    label: "Coordenação responsável:",
    tipo: "connector",
    obrigatorio: false,
    tabela: "1Vck_P6q",
  },
  respons_vel_pela_solicita_o_1: {
    label: "Responsável pela solicitação",
    tipo: "connector",
    obrigatorio: true,
    tabela: "1Vck_P6q",
  },
  empresa_de_faturamento: {
    label: "Empresa Planning que irá faturar",
    tipo: "select",
    obrigatorio: true,
    opcoes: [
      "PGE - PLANNING GESTAO EMPRESARIAL LTDA 23.632.609/0001-89",
      "PCC - PLANNING CONSULTORIA CONTABIL LTDA 23.527.887/0001-76",
      "BPO - PLANNING BPO CONTABIL LTDA 44.275.738/0001-37",
      "PAC - PLANNING AUDITORES E CONTADORES LTDA 24.296.850/0001-47",
      "PMC - Marox - PLANNING MAROX CONSULTORIA LTDA 30.459.798/0001-03",
      "MAROX - MAROX SERVICOS LTDA 55.950.467/0001-94",
      "PAT - PLANNING ASSESSORIA DE TRIBUTOS LTDA 40.949.469/0001-96",
      "ROIT - ROIT PLANNING CONTABILIDADE LTDA 48.790.748/0001-61",
      "DOC - DOC ASSESSORIA SOCIETARIA 49.726.267/0001-50",
      "PAI - PLANNING AUDITORES INDEPENDENTES S/S LTDA 22.929.096/0001-00",
      "PIS - PLANNING INTELIGENCIA TRIBUTARIA LTDA 40.417.435/0001-50",
      "PRJ - PLANNING AUDITORES E CONTADORES RJ S/S LTDA 55.909.495/0001-68",
      "PLANNING PARTNERS 58.565.726/0001-51",
      "PLANNING AGRO 59.073.211/0001-05",
      "PMN - PLANNING MEU NEGOCIO LTDA 35.754.187/0001-01",
      "PAC - SP - PLANNING AUDITORES E CONTADORES SP S/S LTDA 59.639.455/0001-02",
      "PLANNING NEO SERVICES LTDA - 66.532.907/0001-00",
      "CONCILIADOR CONTÁBIL LTDA - 63.279.474/0001-34",
    ],
  },
  raz_o_social_do_cliente: {
    label: "Nome do cliente",
    tipo: "short_text",
    obrigatorio: true,
  },
  o_cliente_pessoa_f_sica_ou_jur_dica: {
    label: "O cliente é pessoa física ou jurídica?",
    tipo: "radio_horizontal",
    obrigatorio: true,
    opcoes: ["Pessoa jurídica (CNPJ)", "Pessoa física (CPF)"],
  },
  cnpj_cliente_1: {
    label: "CNPJ do cliente",
    tipo: "cnpj",
    obrigatorio: false,
  },
  cpf_do_cliente: {
    label: "CPF do cliente",
    tipo: "cpf",
    obrigatorio: false,
  },
  e_mail_para_envio: {
    label: "E-mail para envio",
    tipo: "email",
    obrigatorio: true,
  },
  vig_ncia_inicial: {
    label: "Vigência inicial",
    tipo: "date",
    obrigatorio: true,
  },
  vig_ncia_final: {
    label: "Vigência final",
    tipo: "date",
    obrigatorio: true,
  },
  nome_do_projeto: {
    label: "Nome do projeto",
    tipo: "short_text",
    obrigatorio: true,
  },
  qual_o_servi_o: {
    label: "Qual o serviço",
    tipo: "short_text",
    obrigatorio: true,
  },
  copy_of_valor_folha: {
    label: "Valor",
    tipo: "currency",
    obrigatorio: true,
  },
  departamento: {
    label: "Departamento",
    tipo: "select",
    obrigatorio: false,
    opcoes: [
      "Facilities",
      "Financeiro",
      "Comercial",
      "Gente e Gestão",
      "Marketing",
      "Sucesso do Cliente",
      "Gestão de Risco",
      "Tecnologia",
      "Implantação",
      "Jurídico",
      "Operação",
      "Contábil",
      "Fiscal",
      "Sócios",
      "Folha",
      "Negócios Estruturados",
      "Expansão",
      "Finance",
      "Controladoria",
    ],
  },
  tipo_de_emiss_o_de_documento: {
    label: "Tipo de faturamento: nota fiscal ou recibo?",
    tipo: "radio_horizontal",
    obrigatorio: true,
    opcoes: ["Nota Fiscal", "Recibo"],
  },
  tipo_de_faturamento: {
    label: "Tipo de faturamento: avulso ou recorrente?",
    tipo: "select",
    obrigatorio: true,
    opcoes: ["Avulso", "Recorrente "],
  },
  condi_es_de_pagamento_vista_ou_parcelado: {
    label: "Condições de pagamento: à vista ou parcelado?",
    tipo: "radio_horizontal",
    obrigatorio: true,
    opcoes: ["À vista", "Parcelado"],
  },
  n_mero_de_parcelas: {
    label: "Número de parcelas",
    tipo: "number",
    obrigatorio: true,
  },
  tipo_de_recebimento: {
    label: "Condições de pagamento: boleto ou pix?",
    tipo: "radio_horizontal",
    obrigatorio: true,
    opcoes: ["Boleto", "Pix"],
  },
  vencimento: {
    label: "Vencimento",
    tipo: "date",
    obrigatorio: true,
  },
  compet_ncia_do_servi_o: {
    label: "Competência",
    tipo: "radio_vertical",
    obrigatorio: false,
    opcoes: ["Mês anterior ao faturamento", "Mês do faturamento", "Outro"],
  },
  particularidades: {
    label: "Observações",
    tipo: "long_text",
    obrigatorio: true,
  },
  cnpj: {
    label: "CNPJ empresa de faturamento",
    tipo: "cnpj",
    obrigatorio: false,
  },
  endere_o: {
    label: "Endereço:",
    tipo: "short_text",
    obrigatorio: false,
  },
  munic_pio: {
    label: "Município:",
    tipo: "short_text",
    obrigatorio: false,
  },
  tipo_do_regime_tribut_rio: {
    label: "Tipo do regime tributário:",
    tipo: "radio_horizontal",
    obrigatorio: false,
    opcoes: ["Optante", "Não optante"],
  },
  valores_condi_es_de_pagamento: {
    label: "Valores/Condições de Pagamento:",
    tipo: "long_text",
    obrigatorio: false,
  },
  vig_ncia_do_contrato: {
    label: "Vigência do contrato:",
    tipo: "radio_horizontal",
    obrigatorio: false,
    opcoes: [
      "12 meses",
      "24 meses",
      "36 meses",
      "Avulso (apenas 1 faturamento, não possuí vigencia)",
    ],
  },
  tipo_de_servi_o_categoria: {
    label: "Tipo de serviço/Categoria:",
    tipo: "checklist_vertical",
    obrigatorio: false,
    opcoes: [
      "BPO Contábil",
      "BPO Fiscal",
      "BPO Financeiro",
      "BPO Folha",
      "Desenvolvimento",
      "Outros",
    ],
  },
  copy_of_valor_fiscal: {
    label: "Valor (Contábil):",
    tipo: "currency",
    obrigatorio: false,
  },
  copy_of_valor_financeiro: {
    label: "Valor (Fiscal):",
    tipo: "currency",
    obrigatorio: false,
  },
  valor_financeiro: {
    label: "Valor (Financeiro):",
    tipo: "currency",
    obrigatorio: false,
  },
  copy_of_valor_cont_bil: {
    label: "Valor (Folha):",
    tipo: "currency",
    obrigatorio: false,
  },
  data_do_primeiro_faturamento: {
    label: "Data do primeiro faturamento:",
    tipo: "date",
    obrigatorio: false,
  },
  dia_de_vencimento: {
    label: "Dia de vencimento:",
    tipo: "number",
    obrigatorio: false,
  },
  contato_financeiro: {
    label: "Contato financeiro:",
    tipo: "phone",
    obrigatorio: false,
  },
  possui_honor_rio_de_encerramento: {
    label: "Possui honorário de encerramento?",
    tipo: "select",
    obrigatorio: false,
    opcoes: ["Em 12x", "No final do ano em 2 PCL", "Diluído proporcional", "Outro"],
  },
  tipo_de_reajuste: {
    label: "Tipo de reajuste",
    tipo: "select",
    obrigatorio: false,
    opcoes: ["IPCA ", "IGPM", "Outro"],
  },
  contrato_assinado: {
    label: "Contrato assinado:",
    tipo: "attachment",
    obrigatorio: false,
  },
  h_repasse_de_indica_o_para_comiss_o: {
    label: "Há repasse de indicação para comissão?",
    tipo: "radio_horizontal",
    obrigatorio: false,
    opcoes: ["Sim", "Não"],
  },
  nome_da_pessoa_indica_o: {
    label: "Nome da pessoa (indicação)",
    tipo: "short_text",
    obrigatorio: false,
  },
  de_repasse_indica_o: {
    label: "% de repasse (indicação)",
    tipo: "number",
    obrigatorio: false,
  },
  dados_banc_rios_indica_o: {
    label: "Dados bancários (indicação)",
    tipo: "long_text",
    obrigatorio: false,
  },
};

export const FASES: Record<string, FasePipefy> = {
  "342815180": {
    nome: "SOLICITAÇÃO ABERTA",
    concluida: false,
    pode_ir_para: ["342815181", "342815669", "342866194", "342815182", "342815683"],
    campos: {
      a_demanda_possui_todas_as_informa_es_necess_rias: {
        label: "A demanda possui todas as informações necessárias",
        tipo: "radio_horizontal",
        obrigatorio: false,
        opcoes: ["Sim", "Não"],
      },
      quais_informa_es_est_o_faltando_na_solicita_o: {
        label: "Quais informações estão faltando na solicitação:",
        tipo: "long_text",
        obrigatorio: false,
      },
      conex_o_de_database: {
        label: "Responsável pelo ticket:",
        tipo: "connector",
        obrigatorio: true,
        tabela: "1Vck_P6q",
      },
      cpf_cnpj_do_cliente_conferido: {
        label: "CPF/CNPJ do cliente conferido",
        tipo: "checklist_vertical",
        obrigatorio: true,
        opcoes: [
          "Conferido: o card tem o CPF (pessoa física) ou o CNPJ (pessoa jurídica) do cliente, e o número está certo",
        ],
      },
    },
  },
  "342815181": {
    nome: "VALIDAÇÃO DE DADOS",
    concluida: false,
    pode_ir_para: ["342815180", "342815669"],
    campos: {},
  },
  "342815669": {
    nome: "APROVADO PARA FATURAMENTO",
    concluida: false,
    pode_ir_para: ["342866194", "342815181"],
    campos: {
      status_do_faturamento: {
        label: "Status do faturamento:",
        tipo: "radio_horizontal",
        obrigatorio: true,
        opcoes: ["Faturado", "Previsto"],
      },
      data: {
        label: "Data:",
        tipo: "date",
        obrigatorio: false,
      },
      observa_o: {
        label: "Observação:",
        tipo: "long_text",
        obrigatorio: false,
      },
    },
  },
  "342866194": {
    nome: "FATURAMENTO REALIZADO",
    concluida: false,
    pode_ir_para: ["342815669", "342815182"],
    campos: {
      upload_do_e_mail: {
        label: "Upload do e-mail",
        tipo: "attachment",
        obrigatorio: true,
      },
    },
  },
  "342815182": {
    nome: "FINALIZADO",
    concluida: true,
    pode_ir_para: ["342815181", "342815683", "342815669", "342866194"],
    campos: {},
  },
  "342815683": {
    nome: "ARQUIVADO",
    concluida: true,
    pode_ir_para: ["342815182"],
    campos: {},
  },
};
