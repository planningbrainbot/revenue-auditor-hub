export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_arquitetura: {
        Row: {
          detalhes: Json
          executado_em: string | null
          id: number
          status: string
          total_falhas: number
        }
        Insert: {
          detalhes?: Json
          executado_em?: string | null
          id?: number
          status: string
          total_falhas?: number
        }
        Update: {
          detalhes?: Json
          executado_em?: string | null
          id?: number
          status?: string
          total_falhas?: number
        }
        Relationships: []
      }
      auditorias_internas: {
        Row: {
          auditoria_finalizada: boolean | null
          avaliacao_sucesso: string | null
          classificacao_apontamentos: string | null
          complexidade_fiscal: string | null
          contingencias_texto: string | null
          contingencias_valor: number | null
          data_conclusao: string | null
          data_inicio_contrato: string | null
          empresa_auditada: string | null
          equipe_designada: string | null
          fase_atual: string | null
          oportunidades_texto: string | null
          oportunidades_valor: number | null
          pipefy_card_id: string
          prazo_atual: string | null
          setor_atuacao: string | null
          status_solicitacao: string | null
          synced_at: string
          tipo_empresa: string | null
          tipo_projeto: string | null
          unidade: string | null
          update_time: string | null
        }
        Insert: {
          auditoria_finalizada?: boolean | null
          avaliacao_sucesso?: string | null
          classificacao_apontamentos?: string | null
          complexidade_fiscal?: string | null
          contingencias_texto?: string | null
          contingencias_valor?: number | null
          data_conclusao?: string | null
          data_inicio_contrato?: string | null
          empresa_auditada?: string | null
          equipe_designada?: string | null
          fase_atual?: string | null
          oportunidades_texto?: string | null
          oportunidades_valor?: number | null
          pipefy_card_id: string
          prazo_atual?: string | null
          setor_atuacao?: string | null
          status_solicitacao?: string | null
          synced_at?: string
          tipo_empresa?: string | null
          tipo_projeto?: string | null
          unidade?: string | null
          update_time?: string | null
        }
        Update: {
          auditoria_finalizada?: boolean | null
          avaliacao_sucesso?: string | null
          classificacao_apontamentos?: string | null
          complexidade_fiscal?: string | null
          contingencias_texto?: string | null
          contingencias_valor?: number | null
          data_conclusao?: string | null
          data_inicio_contrato?: string | null
          empresa_auditada?: string | null
          equipe_designada?: string | null
          fase_atual?: string | null
          oportunidades_texto?: string | null
          oportunidades_valor?: number | null
          pipefy_card_id?: string
          prazo_atual?: string | null
          setor_atuacao?: string | null
          status_solicitacao?: string | null
          synced_at?: string
          tipo_empresa?: string | null
          tipo_projeto?: string | null
          unidade?: string | null
          update_time?: string | null
        }
        Relationships: []
      }
      cac_apuracao: {
        Row: {
          confirmado_em: string | null
          confirmado_por: string | null
          created_at: string
          id: number
          mes_referencia: string
          observacao: string | null
          status: string
          total_cac: number | null
          total_parcela_1: number | null
          total_parcela_2: number | null
          unidade_id: number
          updated_at: string
        }
        Insert: {
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          id?: never
          mes_referencia: string
          observacao?: string | null
          status?: string
          total_cac?: number | null
          total_parcela_1?: number | null
          total_parcela_2?: number | null
          unidade_id: number
          updated_at?: string
        }
        Update: {
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          id?: never
          mes_referencia?: string
          observacao?: string | null
          status?: string
          total_cac?: number | null
          total_parcela_1?: number | null
          total_parcela_2?: number | null
          unidade_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cac_apuracao_unidade_id_fkey"
            columns: ["unidade_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      cac_apuracao_itens: {
        Row: {
          apuracao_id: number
          cnpj: string | null
          contrato_id: number | null
          created_at: string
          data_assinatura_contrato: string | null
          data_envio_parcela_1: string | null
          data_envio_parcela_2: string | null
          data_pagamento_parcela_1: string | null
          data_pagamento_parcela_2: string | null
          data_recebimento_cliente: string | null
          estimativa_parcela_2: string | null
          excluido_em: string | null
          excluido_por: string | null
          fonte: string | null
          id: number
          motivo_exclusao: string | null
          observacao: string | null
          prazo_parcela_1: string | null
          prazo_parcela_2: string | null
          razao_social: string
          status_match: string | null
          status_parcela_1: string | null
          status_parcela_2: string | null
          updated_at: string
          valor_cac_total: number
          valor_pago_parcela_1: number | null
          valor_pago_parcela_2: number | null
          valor_parcela_1: number
          valor_parcela_2: number
        }
        Insert: {
          apuracao_id: number
          cnpj?: string | null
          contrato_id?: number | null
          created_at?: string
          data_assinatura_contrato?: string | null
          data_envio_parcela_1?: string | null
          data_envio_parcela_2?: string | null
          data_pagamento_parcela_1?: string | null
          data_pagamento_parcela_2?: string | null
          data_recebimento_cliente?: string | null
          estimativa_parcela_2?: string | null
          excluido_em?: string | null
          excluido_por?: string | null
          fonte?: string | null
          id?: never
          motivo_exclusao?: string | null
          observacao?: string | null
          prazo_parcela_1?: string | null
          prazo_parcela_2?: string | null
          razao_social: string
          status_match?: string | null
          status_parcela_1?: string | null
          status_parcela_2?: string | null
          updated_at?: string
          valor_cac_total: number
          valor_pago_parcela_1?: number | null
          valor_pago_parcela_2?: number | null
          valor_parcela_1: number
          valor_parcela_2: number
        }
        Update: {
          apuracao_id?: number
          cnpj?: string | null
          contrato_id?: number | null
          created_at?: string
          data_assinatura_contrato?: string | null
          data_envio_parcela_1?: string | null
          data_envio_parcela_2?: string | null
          data_pagamento_parcela_1?: string | null
          data_pagamento_parcela_2?: string | null
          data_recebimento_cliente?: string | null
          estimativa_parcela_2?: string | null
          excluido_em?: string | null
          excluido_por?: string | null
          fonte?: string | null
          id?: never
          motivo_exclusao?: string | null
          observacao?: string | null
          prazo_parcela_1?: string | null
          prazo_parcela_2?: string | null
          razao_social?: string
          status_match?: string | null
          status_parcela_1?: string | null
          status_parcela_2?: string | null
          updated_at?: string
          valor_cac_total?: number
          valor_pago_parcela_1?: number | null
          valor_pago_parcela_2?: number | null
          valor_parcela_1?: number
          valor_parcela_2?: number
        }
        Relationships: [
          {
            foreignKeyName: "cac_apuracao_itens_apuracao_id_fkey"
            columns: ["apuracao_id"]
            isOneToOne: false
            referencedRelation: "cac_apuracao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cac_apuracao_itens_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cac_apuracao_itens_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "vw_grupos_completo"
            referencedColumns: ["contrato_id"]
          },
        ]
      }
      categorias_omie: {
        Row: {
          categoria_superior: string | null
          codigo: string
          descricao: string
          tipo: string | null
        }
        Insert: {
          categoria_superior?: string | null
          codigo: string
          descricao: string
          tipo?: string | null
        }
        Update: {
          categoria_superior?: string | null
          codigo?: string
          descricao?: string
          tipo?: string | null
        }
        Relationships: []
      }
      central_tratativas: {
        Row: {
          created_at: string | null
          data_churn: string | null
          empresa_id: number | null
          estagio: string | null
          id: number
          motivo: string | null
          mrr: number | null
          observacao: string | null
          pipedrive_deal_id: number | null
          pipefy_card_id: string | null
          stage_change_time: string | null
          status: string | null
          titulo: string
          unidade: string | null
          update_time: string | null
        }
        Insert: {
          created_at?: string | null
          data_churn?: string | null
          empresa_id?: number | null
          estagio?: string | null
          id?: number
          motivo?: string | null
          mrr?: number | null
          observacao?: string | null
          pipedrive_deal_id?: number | null
          pipefy_card_id?: string | null
          stage_change_time?: string | null
          status?: string | null
          titulo: string
          unidade?: string | null
          update_time?: string | null
        }
        Update: {
          created_at?: string | null
          data_churn?: string | null
          empresa_id?: number | null
          estagio?: string | null
          id?: number
          motivo?: string | null
          mrr?: number | null
          observacao?: string | null
          pipedrive_deal_id?: number | null
          pipefy_card_id?: string | null
          stage_change_time?: string | null
          status?: string | null
          titulo?: string
          unidade?: string | null
          update_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "central_tratativas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "central_tratativas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_grupos_completo"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      contas_receber: {
        Row: {
          cliente: string | null
          codigo_categoria: string | null
          codigo_omie: number | null
          cpf_cnpj: string | null
          created_at: string | null
          data_competencia: string | null
          data_pagamento: string | null
          data_vencimento: string | null
          id: number
          num_documento: string | null
          status_pagamento: string | null
          unidade: string | null
          valor: number | null
          valor_liquido: number | null
        }
        Insert: {
          cliente?: string | null
          codigo_categoria?: string | null
          codigo_omie?: number | null
          cpf_cnpj?: string | null
          created_at?: string | null
          data_competencia?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          id?: number
          num_documento?: string | null
          status_pagamento?: string | null
          unidade?: string | null
          valor?: number | null
          valor_liquido?: number | null
        }
        Update: {
          cliente?: string | null
          codigo_categoria?: string | null
          codigo_omie?: number | null
          cpf_cnpj?: string | null
          created_at?: string | null
          data_competencia?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          id?: number
          num_documento?: string | null
          status_pagamento?: string | null
          unidade?: string | null
          valor?: number | null
          valor_liquido?: number | null
        }
        Relationships: []
      }
      contatos: {
        Row: {
          cargo: string | null
          cpf: string | null
          created_at: string | null
          email: string | null
          empresa_id: number | null
          empresa_pipefy_record_id: string | null
          id: number
          nome_completo: string | null
          pipefy_record_id: string
          synced_at: string
          updated_at: string | null
          whatsapp: string | null
        }
        Insert: {
          cargo?: string | null
          cpf?: string | null
          created_at?: string | null
          email?: string | null
          empresa_id?: number | null
          empresa_pipefy_record_id?: string | null
          id?: never
          nome_completo?: string | null
          pipefy_record_id: string
          synced_at?: string
          updated_at?: string | null
          whatsapp?: string | null
        }
        Update: {
          cargo?: string | null
          cpf?: string | null
          created_at?: string | null
          email?: string | null
          empresa_id?: number | null
          empresa_pipefy_record_id?: string | null
          id?: never
          nome_completo?: string | null
          pipefy_record_id?: string
          synced_at?: string
          updated_at?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contatos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_grupos_completo"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      contrato_omie_grupos: {
        Row: {
          contrato_id: number
          cpf_cnpj: string
          criado_em: string | null
          criado_por: string | null
          id: number
          razao_social: string | null
          unidade: string | null
        }
        Insert: {
          contrato_id: number
          cpf_cnpj: string
          criado_em?: string | null
          criado_por?: string | null
          id?: number
          razao_social?: string | null
          unidade?: string | null
        }
        Update: {
          contrato_id?: number
          cpf_cnpj?: string
          criado_em?: string | null
          criado_por?: string | null
          id?: number
          razao_social?: string | null
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contrato_omie_grupos_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_omie_grupos_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "vw_grupos_completo"
            referencedColumns: ["contrato_id"]
          },
        ]
      }
      contratos: {
        Row: {
          closer: string | null
          cnpj: string | null
          created_at: string | null
          empresa_id: number | null
          entrada_contrato_assinado_em: string | null
          ganho_em: string | null
          id: number
          mrr: number | null
          mrr_mensal: number | null
          na_planilha_ana: boolean | null
          obs_reconciliacao: string | null
          origem_pipeline: string
          pipedrive_deal_id: string | null
          preco_unitario: number | null
          produto: string | null
          quantidade: number | null
          regime_tributario: string | null
          sdr: string | null
          segmento: string | null
          status_contrato: string | null
          status_reconciliacao: string | null
          subtotal_produto: number | null
          tipo: string | null
          tipo_unidade: string | null
          titulo: string | null
          unidade: string | null
          valor_total: number | null
        }
        Insert: {
          closer?: string | null
          cnpj?: string | null
          created_at?: string | null
          empresa_id?: number | null
          entrada_contrato_assinado_em?: string | null
          ganho_em?: string | null
          id?: number
          mrr?: number | null
          mrr_mensal?: number | null
          na_planilha_ana?: boolean | null
          obs_reconciliacao?: string | null
          origem_pipeline?: string
          pipedrive_deal_id?: string | null
          preco_unitario?: number | null
          produto?: string | null
          quantidade?: number | null
          regime_tributario?: string | null
          sdr?: string | null
          segmento?: string | null
          status_contrato?: string | null
          status_reconciliacao?: string | null
          subtotal_produto?: number | null
          tipo?: string | null
          tipo_unidade?: string | null
          titulo?: string | null
          unidade?: string | null
          valor_total?: number | null
        }
        Update: {
          closer?: string | null
          cnpj?: string | null
          created_at?: string | null
          empresa_id?: number | null
          entrada_contrato_assinado_em?: string | null
          ganho_em?: string | null
          id?: number
          mrr?: number | null
          mrr_mensal?: number | null
          na_planilha_ana?: boolean | null
          obs_reconciliacao?: string | null
          origem_pipeline?: string
          pipedrive_deal_id?: string | null
          preco_unitario?: number | null
          produto?: string | null
          quantidade?: number | null
          regime_tributario?: string | null
          sdr?: string | null
          segmento?: string | null
          status_contrato?: string | null
          status_reconciliacao?: string | null
          subtotal_produto?: number | null
          tipo?: string | null
          tipo_unidade?: string | null
          titulo?: string | null
          unidade?: string | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contratos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_grupos_completo"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      contratos_documentos: {
        Row: {
          cliente: string | null
          cnpj: string | null
          contrato_pai_id: number | null
          created_at: string | null
          cs_onboarding_card_id: string | null
          data_assinatura: string | null
          empresa_id: number | null
          fase_atual: string | null
          ferramenta_assinatura: string | null
          id: number
          link_documento: string | null
          org_id_pipedrive: string | null
          pipedrive_deal_id: string | null
          pipefy_card_id: string
          status: string | null
          synced_at: string
          tipo: string
          unidade: string | null
          update_time: string | null
          valor: number | null
        }
        Insert: {
          cliente?: string | null
          cnpj?: string | null
          contrato_pai_id?: number | null
          created_at?: string | null
          cs_onboarding_card_id?: string | null
          data_assinatura?: string | null
          empresa_id?: number | null
          fase_atual?: string | null
          ferramenta_assinatura?: string | null
          id?: never
          link_documento?: string | null
          org_id_pipedrive?: string | null
          pipedrive_deal_id?: string | null
          pipefy_card_id: string
          status?: string | null
          synced_at?: string
          tipo: string
          unidade?: string | null
          update_time?: string | null
          valor?: number | null
        }
        Update: {
          cliente?: string | null
          cnpj?: string | null
          contrato_pai_id?: number | null
          created_at?: string | null
          cs_onboarding_card_id?: string | null
          data_assinatura?: string | null
          empresa_id?: number | null
          fase_atual?: string | null
          ferramenta_assinatura?: string | null
          id?: never
          link_documento?: string | null
          org_id_pipedrive?: string | null
          pipedrive_deal_id?: string | null
          pipefy_card_id?: string
          status?: string | null
          synced_at?: string
          tipo?: string
          unidade?: string | null
          update_time?: string | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contratos_documentos_contrato_pai_id_fkey"
            columns: ["contrato_pai_id"]
            isOneToOne: false
            referencedRelation: "contratos_documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_documentos_cs_onboarding_card_id_fkey"
            columns: ["cs_onboarding_card_id"]
            isOneToOne: false
            referencedRelation: "cs_onboarding_cards"
            referencedColumns: ["pipefy_card_id"]
          },
          {
            foreignKeyName: "contratos_documentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_documentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_grupos_completo"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      criterios_rateio_cm: {
        Row: {
          ativo: boolean | null
          bu_direto: string | null
          created_at: string | null
          fornecedor: string
          id: number
          percentuais_custom: Json | null
          tipo_rateio: string
        }
        Insert: {
          ativo?: boolean | null
          bu_direto?: string | null
          created_at?: string | null
          fornecedor: string
          id?: number
          percentuais_custom?: Json | null
          tipo_rateio?: string
        }
        Update: {
          ativo?: boolean | null
          bu_direto?: string | null
          created_at?: string | null
          fornecedor?: string
          id?: number
          percentuais_custom?: Json | null
          tipo_rateio?: string
        }
        Relationships: []
      }
      cs_onboarding_cards: {
        Row: {
          cnpj: string | null
          concluido: boolean
          criado_em: string | null
          empresa_id: number | null
          entrou_fase_atual_em: string | null
          fase_atual: string | null
          fase_atual_ordem: number | null
          fases_history: Json | null
          org_id_pipedrive: string | null
          pipefy_card_id: string
          synced_at: string
          titulo: string | null
          unidade: string | null
          update_time: string | null
        }
        Insert: {
          cnpj?: string | null
          concluido?: boolean
          criado_em?: string | null
          empresa_id?: number | null
          entrou_fase_atual_em?: string | null
          fase_atual?: string | null
          fase_atual_ordem?: number | null
          fases_history?: Json | null
          org_id_pipedrive?: string | null
          pipefy_card_id: string
          synced_at?: string
          titulo?: string | null
          unidade?: string | null
          update_time?: string | null
        }
        Update: {
          cnpj?: string | null
          concluido?: boolean
          criado_em?: string | null
          empresa_id?: number | null
          entrou_fase_atual_em?: string | null
          fase_atual?: string | null
          fase_atual_ordem?: number | null
          fases_history?: Json | null
          org_id_pipedrive?: string | null
          pipefy_card_id?: string
          synced_at?: string
          titulo?: string | null
          unidade?: string | null
          update_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cs_onboarding_cards_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_onboarding_cards_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_grupos_completo"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      custo_operacional_mensal: {
        Row: {
          categoria: string | null
          cobranca: string | null
          despesa: string
          id: number
          mes: string
          synced_at: string
          tipo: string | null
          valor: number
        }
        Insert: {
          categoria?: string | null
          cobranca?: string | null
          despesa: string
          id?: never
          mes: string
          synced_at?: string
          tipo?: string | null
          valor?: number
        }
        Update: {
          categoria?: string | null
          cobranca?: string | null
          despesa?: string
          id?: never
          mes?: string
          synced_at?: string
          tipo?: string | null
          valor?: number
        }
        Relationships: []
      }
      despesas_cm_avulsos: {
        Row: {
          apuracao_status: string
          categoria: string | null
          codigo_omie: number | null
          created_at: string
          data_pagamento: string | null
          departamento: string
          fornecedor: string
          id: number
          importacao_lote: string | null
          importado_em: string | null
          importado_por: string | null
          mes: string
          motivo_contestacao: string | null
          observacao: string | null
          origem_apuracao: string
          rateio_bu_direto: string | null
          rateio_custom: Json | null
          rateio_regra: string
          revisado_em: string | null
          revisado_por: string | null
          status: string
          updated_at: string
          valor_pago: number | null
          valor_total: number
        }
        Insert: {
          apuracao_status?: string
          categoria?: string | null
          codigo_omie?: number | null
          created_at?: string
          data_pagamento?: string | null
          departamento: string
          fornecedor: string
          id?: number
          importacao_lote?: string | null
          importado_em?: string | null
          importado_por?: string | null
          mes: string
          motivo_contestacao?: string | null
          observacao?: string | null
          origem_apuracao?: string
          rateio_bu_direto?: string | null
          rateio_custom?: Json | null
          rateio_regra?: string
          revisado_em?: string | null
          revisado_por?: string | null
          status?: string
          updated_at?: string
          valor_pago?: number | null
          valor_total: number
        }
        Update: {
          apuracao_status?: string
          categoria?: string | null
          codigo_omie?: number | null
          created_at?: string
          data_pagamento?: string | null
          departamento?: string
          fornecedor?: string
          id?: number
          importacao_lote?: string | null
          importado_em?: string | null
          importado_por?: string | null
          mes?: string
          motivo_contestacao?: string | null
          observacao?: string | null
          origem_apuracao?: string
          rateio_bu_direto?: string | null
          rateio_custom?: Json | null
          rateio_regra?: string
          revisado_em?: string | null
          revisado_por?: string | null
          status?: string
          updated_at?: string
          valor_pago?: number | null
          valor_total?: number
        }
        Relationships: []
      }
      despesas_cm_fornecedores: {
        Row: {
          ativo: boolean
          categoria: string | null
          cenario_id: string | null
          created_at: string
          departamento: string
          funcao: string | null
          id: number
          mes_inicio: number | null
          meses_pontuais: number[] | null
          nome: string
          ordem: number
          parcelas: number | null
          rateio_bu_direto: string | null
          rateio_custom: Json | null
          rateio_regra: string
          tipo: string
          updated_at: string
          valor_base: number | null
        }
        Insert: {
          ativo?: boolean
          categoria?: string | null
          cenario_id?: string | null
          created_at?: string
          departamento: string
          funcao?: string | null
          id?: number
          mes_inicio?: number | null
          meses_pontuais?: number[] | null
          nome: string
          ordem?: number
          parcelas?: number | null
          rateio_bu_direto?: string | null
          rateio_custom?: Json | null
          rateio_regra?: string
          tipo?: string
          updated_at?: string
          valor_base?: number | null
        }
        Update: {
          ativo?: boolean
          categoria?: string | null
          cenario_id?: string | null
          created_at?: string
          departamento?: string
          funcao?: string | null
          id?: number
          mes_inicio?: number | null
          meses_pontuais?: number[] | null
          nome?: string
          ordem?: number
          parcelas?: number | null
          rateio_bu_direto?: string | null
          rateio_custom?: Json | null
          rateio_regra?: string
          tipo?: string
          updated_at?: string
          valor_base?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "despesas_cm_fornecedores_cenario_id_fkey"
            columns: ["cenario_id"]
            isOneToOne: false
            referencedRelation: "dre_sim_cenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      despesas_cm_overrides: {
        Row: {
          codigo_omie: number | null
          created_at: string
          data_pagamento: string | null
          fornecedor_id: number
          id: number
          inativo_no_mes: boolean
          mes: string
          observacao: string | null
          status: string
          updated_at: string
          valor: number | null
          valor_pago: number | null
        }
        Insert: {
          codigo_omie?: number | null
          created_at?: string
          data_pagamento?: string | null
          fornecedor_id: number
          id?: number
          inativo_no_mes?: boolean
          mes: string
          observacao?: string | null
          status?: string
          updated_at?: string
          valor?: number | null
          valor_pago?: number | null
        }
        Update: {
          codigo_omie?: number | null
          created_at?: string
          data_pagamento?: string | null
          fornecedor_id?: number
          id?: number
          inativo_no_mes?: boolean
          mes?: string
          observacao?: string | null
          status?: string
          updated_at?: string
          valor?: number | null
          valor_pago?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "despesas_cm_overrides_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "despesas_cm_fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      despesas_cm_rateio_performance: {
        Row: {
          mes: string
          pct_construcao_civil: number
          pct_consultoria: number
          pct_matriz: number
          pct_partners: number
          updated_at: string | null
          valor_total_propostas: number | null
        }
        Insert: {
          mes: string
          pct_construcao_civil?: number
          pct_consultoria?: number
          pct_matriz?: number
          pct_partners?: number
          updated_at?: string | null
          valor_total_propostas?: number | null
        }
        Update: {
          mes?: string
          pct_construcao_civil?: number
          pct_consultoria?: number
          pct_matriz?: number
          pct_partners?: number
          updated_at?: string | null
          valor_total_propostas?: number | null
        }
        Relationships: []
      }
      dfc_custom_custos: {
        Row: {
          campo: string
          label: string
          scenario_id: string
        }
        Insert: {
          campo: string
          label: string
          scenario_id: string
        }
        Update: {
          campo?: string
          label?: string
          scenario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dfc_custom_custos_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "dfc_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_global_overrides_mensal: {
        Row: {
          campo: string
          mes: string
          scenario_id: string
          valor: number
        }
        Insert: {
          campo: string
          mes: string
          scenario_id: string
          valor: number
        }
        Update: {
          campo?: string
          mes?: string
          scenario_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "dfc_global_overrides_mensal_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "dfc_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_matriz_mensal: {
        Row: {
          campo: string
          mes: string
          scenario_id: string
          valor: number
        }
        Insert: {
          campo: string
          mes: string
          scenario_id: string
          valor?: number
        }
        Update: {
          campo?: string
          mes?: string
          scenario_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "dfc_matriz_mensal_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "dfc_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_meta_midia_mensal: {
        Row: {
          mes: string
          scenario_id: string
          valor: number
        }
        Insert: {
          mes: string
          scenario_id: string
          valor: number
        }
        Update: {
          mes?: string
          scenario_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "dfc_meta_midia_mensal_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "dfc_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_scenario_premissas: {
        Row: {
          campo: string
          scenario_id: string
          valor: number
        }
        Insert: {
          campo: string
          scenario_id: string
          valor?: number
        }
        Update: {
          campo?: string
          scenario_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "dfc_scenario_premissas_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "dfc_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_scenario_units: {
        Row: {
          ativo: boolean
          cs_inicio_rampa: string | null
          mes_abertura: string
          royalty_degrau_mrr: number | null
          royalty_degrau_rate: number | null
          royalty_rate_override: number | null
          saldo_inicial_mrr: number
          scenario_id: string
          unit_id: number
        }
        Insert: {
          ativo?: boolean
          cs_inicio_rampa?: string | null
          mes_abertura: string
          royalty_degrau_mrr?: number | null
          royalty_degrau_rate?: number | null
          royalty_rate_override?: number | null
          saldo_inicial_mrr?: number
          scenario_id: string
          unit_id: number
        }
        Update: {
          ativo?: boolean
          cs_inicio_rampa?: string | null
          mes_abertura?: string
          royalty_degrau_mrr?: number | null
          royalty_degrau_rate?: number | null
          royalty_rate_override?: number | null
          saldo_inicial_mrr?: number
          scenario_id?: string
          unit_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "dfc_scenario_units_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "dfc_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dfc_scenario_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "dfc_units"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_scenarios: {
        Row: {
          cloned_from: string | null
          created_at: string
          descricao: string | null
          id: string
          mes_inicio: string
          meses_horizonte: number
          nome: string
          updated_at: string
        }
        Insert: {
          cloned_from?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          mes_inicio: string
          meses_horizonte?: number
          nome: string
          updated_at?: string
        }
        Update: {
          cloned_from?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          mes_inicio?: string
          meses_horizonte?: number
          nome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dfc_scenarios_cloned_from_fkey"
            columns: ["cloned_from"]
            isOneToOne: false
            referencedRelation: "dfc_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_tier_curves: {
        Row: {
          campo: string
          mes_desde_abertura: number
          scenario_id: string
          tier: string
          valor: number
        }
        Insert: {
          campo: string
          mes_desde_abertura: number
          scenario_id: string
          tier: string
          valor?: number
        }
        Update: {
          campo?: string
          mes_desde_abertura?: number
          scenario_id?: string
          tier?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "dfc_tier_curves_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "dfc_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_unit_overrides_mensal: {
        Row: {
          campo: string
          mes: string
          scenario_id: string
          unit_id: number
          valor: number
        }
        Insert: {
          campo: string
          mes: string
          scenario_id: string
          unit_id: number
          valor: number
        }
        Update: {
          campo?: string
          mes?: string
          scenario_id?: string
          unit_id?: number
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "dfc_unit_overrides_mensal_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "dfc_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dfc_unit_overrides_mensal_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "dfc_units"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_unit_valores: {
        Row: {
          campo: string
          scenario_id: string
          unit_id: number
          valor: number
        }
        Insert: {
          campo: string
          scenario_id: string
          unit_id: number
          valor?: number
        }
        Update: {
          campo?: string
          scenario_id?: string
          unit_id?: number
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "dfc_unit_valores_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "dfc_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dfc_unit_valores_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "dfc_units"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_units: {
        Row: {
          ativo: boolean
          id: number
          nome: string
          ordem: number
          tier: string
        }
        Insert: {
          ativo?: boolean
          id?: number
          nome: string
          ordem: number
          tier: string
        }
        Update: {
          ativo?: boolean
          id?: number
          nome?: string
          ordem?: number
          tier?: string
        }
        Relationships: []
      }
      dre_sim_categorias: {
        Row: {
          created_at: string
          grupo_dre: Database["public"]["Enums"]["grupo_dre"] | null
          id: string
          natureza: string
          nome: string
          user_id: string
        }
        Insert: {
          created_at?: string
          grupo_dre?: Database["public"]["Enums"]["grupo_dre"] | null
          id?: string
          natureza: string
          nome: string
          user_id: string
        }
        Update: {
          created_at?: string
          grupo_dre?: Database["public"]["Enums"]["grupo_dre"] | null
          id?: string
          natureza?: string
          nome?: string
          user_id?: string
        }
        Relationships: []
      }
      dre_sim_cenarios: {
        Row: {
          ano: number
          created_at: string
          id: string
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ano: number
          created_at?: string
          id?: string
          nome: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ano?: number
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dre_sim_departamentos: {
        Row: {
          created_at: string
          id: string
          nome: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          user_id?: string
        }
        Relationships: []
      }
      dre_sim_tipos_rateio: {
        Row: {
          created_at: string
          id: string
          nome: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          user_id?: string
        }
        Relationships: []
      }
      empresas: {
        Row: {
          cnpj: string | null
          created_at: string | null
          email_fiscal: string | null
          erp: string | null
          fonte_cadastro: string | null
          grupo_id: number | null
          id: number
          omie_codigo_cliente: string | null
          omie_inativo: string | null
          omie_unidade: string | null
          origem_da_base: string | null
          origem_pipeline: string
          origem_venda: string | null
          pipedrive_id: string | null
          pipefy_record_id: string | null
          razao_social: string | null
          regime_tributario: string | null
          segmento: string | null
          status_financeiro: string | null
          telefone: string | null
          tipo_unidade: string | null
          titulo: string
          uf: string | null
          unidade: string | null
        }
        Insert: {
          cnpj?: string | null
          created_at?: string | null
          email_fiscal?: string | null
          erp?: string | null
          fonte_cadastro?: string | null
          grupo_id?: number | null
          id?: number
          omie_codigo_cliente?: string | null
          omie_inativo?: string | null
          omie_unidade?: string | null
          origem_da_base?: string | null
          origem_pipeline?: string
          origem_venda?: string | null
          pipedrive_id?: string | null
          pipefy_record_id?: string | null
          razao_social?: string | null
          regime_tributario?: string | null
          segmento?: string | null
          status_financeiro?: string | null
          telefone?: string | null
          tipo_unidade?: string | null
          titulo: string
          uf?: string | null
          unidade?: string | null
        }
        Update: {
          cnpj?: string | null
          created_at?: string | null
          email_fiscal?: string | null
          erp?: string | null
          fonte_cadastro?: string | null
          grupo_id?: number | null
          id?: number
          omie_codigo_cliente?: string | null
          omie_inativo?: string | null
          omie_unidade?: string | null
          origem_da_base?: string | null
          origem_pipeline?: string
          origem_venda?: string | null
          pipedrive_id?: string | null
          pipefy_record_id?: string | null
          razao_social?: string | null
          regime_tributario?: string | null
          segmento?: string | null
          status_financeiro?: string | null
          telefone?: string | null
          tipo_unidade?: string | null
          titulo?: string
          uf?: string | null
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empresas_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresas_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "vw_grupos_completo"
            referencedColumns: ["grupo_id"]
          },
        ]
      }
      empresas_backup_20260703: {
        Row: {
          cnpj: string | null
          created_at: string | null
          email_fiscal: string | null
          erp: string | null
          fonte_cadastro: string | null
          grupo_id: number | null
          id: number | null
          omie_codigo_cliente: string | null
          omie_inativo: string | null
          omie_unidade: string | null
          origem_da_base: string | null
          origem_venda: string | null
          pipedrive_id: string | null
          pipefy_record_id: string | null
          razao_social: string | null
          regime_tributario: string | null
          segmento: string | null
          status_financeiro: string | null
          telefone: string | null
          tipo_unidade: string | null
          titulo: string | null
          uf: string | null
          unidade: string | null
        }
        Insert: {
          cnpj?: string | null
          created_at?: string | null
          email_fiscal?: string | null
          erp?: string | null
          fonte_cadastro?: string | null
          grupo_id?: number | null
          id?: number | null
          omie_codigo_cliente?: string | null
          omie_inativo?: string | null
          omie_unidade?: string | null
          origem_da_base?: string | null
          origem_venda?: string | null
          pipedrive_id?: string | null
          pipefy_record_id?: string | null
          razao_social?: string | null
          regime_tributario?: string | null
          segmento?: string | null
          status_financeiro?: string | null
          telefone?: string | null
          tipo_unidade?: string | null
          titulo?: string | null
          uf?: string | null
          unidade?: string | null
        }
        Update: {
          cnpj?: string | null
          created_at?: string | null
          email_fiscal?: string | null
          erp?: string | null
          fonte_cadastro?: string | null
          grupo_id?: number | null
          id?: number | null
          omie_codigo_cliente?: string | null
          omie_inativo?: string | null
          omie_unidade?: string | null
          origem_da_base?: string | null
          origem_venda?: string | null
          pipedrive_id?: string | null
          pipefy_record_id?: string | null
          razao_social?: string | null
          regime_tributario?: string | null
          segmento?: string | null
          status_financeiro?: string | null
          telefone?: string | null
          tipo_unidade?: string | null
          titulo?: string | null
          uf?: string | null
          unidade?: string | null
        }
        Relationships: []
      }
      grupos: {
        Row: {
          cnpj_raiz: string | null
          created_at: string | null
          descricao: string | null
          grupo_pipefy_id: string | null
          id: number
          nome: string
          segmento: string | null
        }
        Insert: {
          cnpj_raiz?: string | null
          created_at?: string | null
          descricao?: string | null
          grupo_pipefy_id?: string | null
          id?: number
          nome: string
          segmento?: string | null
        }
        Update: {
          cnpj_raiz?: string | null
          created_at?: string | null
          descricao?: string | null
          grupo_pipefy_id?: string | null
          id?: number
          nome?: string
          segmento?: string | null
        }
        Relationships: []
      }
      headcount_mensal: {
        Row: {
          admissoes: number
          created_at: string | null
          demissoes: number
          headcount: number
          id: number
          mes: string
          unidade: string
          updated_at: string | null
        }
        Insert: {
          admissoes?: number
          created_at?: string | null
          demissoes?: number
          headcount?: number
          id?: number
          mes: string
          unidade: string
          updated_at?: string | null
        }
        Update: {
          admissoes?: number
          created_at?: string | null
          demissoes?: number
          headcount?: number
          id?: number
          mes?: string
          unidade?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      integracoes_alertas: {
        Row: {
          detalhes: Json | null
          enviado_em: string
          fonte: string
        }
        Insert: {
          detalhes?: Json | null
          enviado_em?: string
          fonte: string
        }
        Update: {
          detalhes?: Json | null
          enviado_em?: string
          fonte?: string
        }
        Relationships: [
          {
            foreignKeyName: "integracoes_alertas_fonte_fkey"
            columns: ["fonte"]
            isOneToOne: true
            referencedRelation: "integracoes_config"
            referencedColumns: ["fonte"]
          },
          {
            foreignKeyName: "integracoes_alertas_fonte_fkey"
            columns: ["fonte"]
            isOneToOne: true
            referencedRelation: "v_integracoes_status"
            referencedColumns: ["fonte"]
          },
        ]
      }
      integracoes_config: {
        Row: {
          ativo: boolean
          created_at: string
          fonte: string
          intervalo_esperado_minutos: number | null
          nome_exibicao: string
          observacao: string | null
          tipo: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          fonte: string
          intervalo_esperado_minutos?: number | null
          nome_exibicao: string
          observacao?: string | null
          tipo: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          fonte?: string
          intervalo_esperado_minutos?: number | null
          nome_exibicao?: string
          observacao?: string | null
          tipo?: string
        }
        Relationships: []
      }
      investimento_bu: {
        Row: {
          bu: string
          id: number
          mes: string
          valor: number
        }
        Insert: {
          bu: string
          id?: number
          mes: string
          valor?: number
        }
        Update: {
          bu?: string
          id?: number
          mes?: string
          valor?: number
        }
        Relationships: []
      }
      notificacoes: {
        Row: {
          created_at: string
          id: number
          lida: boolean
          lida_em: string | null
          lida_por: string | null
          mensagem: string
          referencia_id: number | null
          tipo: string
          titulo: string
          unidade_id: number | null
        }
        Insert: {
          created_at?: string
          id?: never
          lida?: boolean
          lida_em?: string | null
          lida_por?: string | null
          mensagem: string
          referencia_id?: number | null
          tipo: string
          titulo: string
          unidade_id?: number | null
        }
        Update: {
          created_at?: string
          id?: never
          lida?: boolean
          lida_em?: string | null
          lida_por?: string | null
          mensagem?: string
          referencia_id?: number | null
          tipo?: string
          titulo?: string
          unidade_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_unidade_id_fkey"
            columns: ["unidade_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      nps_envio_map: {
        Row: {
          enviado_em: string
          erro: Json | null
          id: number
          nps_pesquisa_id: number | null
          pipefy_card_id: string | null
          respondido: boolean
          status: string | null
          status_atualizado_em: string | null
          telefone: string
        }
        Insert: {
          enviado_em?: string
          erro?: Json | null
          id?: number
          nps_pesquisa_id?: number | null
          pipefy_card_id?: string | null
          respondido?: boolean
          status?: string | null
          status_atualizado_em?: string | null
          telefone: string
        }
        Update: {
          enviado_em?: string
          erro?: Json | null
          id?: number
          nps_pesquisa_id?: number | null
          pipefy_card_id?: string | null
          respondido?: boolean
          status?: string | null
          status_atualizado_em?: string | null
          telefone?: string
        }
        Relationships: []
      }
      nps_mensagens_texto_livre: {
        Row: {
          id: number
          pipefy_card_id: string | null
          recebido_em: string
          telefone: string
          texto: string | null
          tipo_mensagem: string | null
        }
        Insert: {
          id?: number
          pipefy_card_id?: string | null
          recebido_em?: string
          telefone: string
          texto?: string | null
          tipo_mensagem?: string | null
        }
        Update: {
          id?: number
          pipefy_card_id?: string | null
          recebido_em?: string
          telefone?: string
          texto?: string | null
          tipo_mensagem?: string | null
        }
        Relationships: []
      }
      nps_pesquisas: {
        Row: {
          avaliacao_contabil: string | null
          avaliacao_fiscal: string | null
          avaliacao_folha_pagamento: string | null
          created_at: string | null
          data_envio: string | null
          email_pesquisa: string | null
          empresa: string | null
          empresa_id: number | null
          fase: string | null
          id: number
          nome_contato: string | null
          nps_recomendacao: string | null
          pipedrive_deal_id: string | null
          pipefy_card_id: string | null
          rodada: string | null
          segmento: string | null
          servicos_contratados: string[] | null
          synced_at: string | null
          telefone_pesquisa: string | null
          unidade: string | null
          updated_at: string | null
        }
        Insert: {
          avaliacao_contabil?: string | null
          avaliacao_fiscal?: string | null
          avaliacao_folha_pagamento?: string | null
          created_at?: string | null
          data_envio?: string | null
          email_pesquisa?: string | null
          empresa?: string | null
          empresa_id?: number | null
          fase?: string | null
          id?: number
          rodada?: string | null
          nome_contato?: string | null
          nps_recomendacao?: string | null
          pipedrive_deal_id?: string | null
          pipefy_card_id?: string | null
          segmento?: string | null
          servicos_contratados?: string[] | null
          synced_at?: string | null
          telefone_pesquisa?: string | null
          unidade?: string | null
          updated_at?: string | null
        }
        Update: {
          avaliacao_contabil?: string | null
          avaliacao_fiscal?: string | null
          avaliacao_folha_pagamento?: string | null
          created_at?: string | null
          data_envio?: string | null
          email_pesquisa?: string | null
          empresa?: string | null
          empresa_id?: number | null
          fase?: string | null
          id?: number
          nome_contato?: string | null
          nps_recomendacao?: string | null
          pipedrive_deal_id?: string | null
          pipefy_card_id?: string | null
          rodada?: string | null
          segmento?: string | null
          servicos_contratados?: string[] | null
          synced_at?: string | null
          telefone_pesquisa?: string | null
          unidade?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nps_pesquisas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nps_pesquisas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_grupos_completo"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      omie_clientes: {
        Row: {
          bairro: string | null
          cep: string | null
          cidade: string | null
          cnpj_cpf: string | null
          codigo_omie: number
          contrato_id: number | null
          email: string | null
          estado: string | null
          honorario: number | null
          inativo: boolean | null
          is_planning: boolean | null
          nome_fantasia: string | null
          pessoa_fisica: boolean | null
          razao_social: string | null
          synced_at: string | null
          telefone: string | null
          ultimo_pagamento: string | null
          unidade: string
          updated_at: string | null
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj_cpf?: string | null
          codigo_omie: number
          contrato_id?: number | null
          email?: string | null
          estado?: string | null
          honorario?: number | null
          inativo?: boolean | null
          is_planning?: boolean | null
          nome_fantasia?: string | null
          pessoa_fisica?: boolean | null
          razao_social?: string | null
          synced_at?: string | null
          telefone?: string | null
          ultimo_pagamento?: string | null
          unidade: string
          updated_at?: string | null
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj_cpf?: string | null
          codigo_omie?: number
          contrato_id?: number | null
          email?: string | null
          estado?: string | null
          honorario?: number | null
          inativo?: boolean | null
          is_planning?: boolean | null
          nome_fantasia?: string | null
          pessoa_fisica?: boolean | null
          razao_social?: string | null
          synced_at?: string | null
          telefone?: string | null
          ultimo_pagamento?: string | null
          unidade?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      omie_clientes_cadastro: {
        Row: {
          cnpj: string
          data_cadastro: string | null
          razao_social: string | null
          unidade: string | null
          updated_at: string
        }
        Insert: {
          cnpj: string
          data_cadastro?: string | null
          razao_social?: string | null
          unidade?: string | null
          updated_at?: string
        }
        Update: {
          cnpj?: string
          data_cadastro?: string | null
          razao_social?: string | null
          unidade?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      omie_credentials: {
        Row: {
          app_key: string
          app_secret: string
          ativo: boolean
          created_at: string
          id: string
          unidade: string
          updated_at: string
        }
        Insert: {
          app_key: string
          app_secret: string
          ativo?: boolean
          created_at?: string
          id?: string
          unidade: string
          updated_at?: string
        }
        Update: {
          app_key?: string
          app_secret?: string
          ativo?: boolean
          created_at?: string
          id?: string
          unidade?: string
          updated_at?: string
        }
        Relationships: []
      }
      page_validations: {
        Row: {
          created_at: string
          notes: string | null
          page_key: string
          updated_at: string
          updated_by: string | null
          validated: boolean
        }
        Insert: {
          created_at?: string
          notes?: string | null
          page_key: string
          updated_at?: string
          updated_by?: string | null
          validated?: boolean
        }
        Update: {
          created_at?: string
          notes?: string | null
          page_key?: string
          updated_at?: string
          updated_by?: string | null
          validated?: boolean
        }
        Relationships: []
      }
      partners_dfc_caixa: {
        Row: {
          a_pagar_ou_receber: number | null
          alterado_por: string | null
          apelido: string | null
          arquivo_referencia: string
          baixa_alterada_por: string | null
          baixa_incluida_por: string | null
          categoria: string | null
          categoria_de_para: string | null
          cliente_ou_fornecedor_nome_fantasia: string | null
          cliente_ou_fornecedor_razao_social: string | null
          cnpj_cpf: string | null
          conciliado: string | null
          conta_corrente: string | null
          data_de_alteracao_completa: string | null
          data_de_alteracao_da_baixa_completa: string | null
          data_de_credito_ou_pagto_completa: string | null
          data_de_emissao_completa: string | null
          data_de_inclusao_completa: string | null
          data_de_inclusao_da_baixa_completa: string | null
          data_de_pagto_ou_recbto_completa: string | null
          data_de_previsao_completa: string | null
          data_de_registro_completa: string | null
          data_de_vencimento_completa: string | null
          departamento: string | null
          desconto: number | null
          dias_em_atraso: number | null
          estrutura_4: string | null
          estrutura_dfc: string | null
          estrutura_dre: string | null
          grupo: string | null
          grupo_apuracao: string | null
          grupo_de_para: string | null
          id: number
          importado_em: string
          impostos_retidos: number | null
          incluido_por: string | null
          juros: number | null
          minha_empresa_cnpj: string | null
          minha_empresa_nome_fantasia: string | null
          minha_empresa_razao_social: string | null
          multa: number | null
          nf_cf: string | null
          no_do_contrato_de_venda: string | null
          nome_do_meu_aplicativo: string | null
          numero_do_documento: string | null
          observacao_da_conta: string | null
          observacao_do_pagto_ou_recbto: string | null
          ordem_de_servico: string | null
          pago_ou_recebido: number | null
          parcela: string | null
          projeto: string | null
          tipo: string | null
          tipo_da_conta_corrente: string | null
          tipo_do_documento: string | null
          valor_da_conta: number | null
          valor_liquido: number | null
        }
        Insert: {
          a_pagar_ou_receber?: number | null
          alterado_por?: string | null
          apelido?: string | null
          arquivo_referencia: string
          baixa_alterada_por?: string | null
          baixa_incluida_por?: string | null
          categoria?: string | null
          categoria_de_para?: string | null
          cliente_ou_fornecedor_nome_fantasia?: string | null
          cliente_ou_fornecedor_razao_social?: string | null
          cnpj_cpf?: string | null
          conciliado?: string | null
          conta_corrente?: string | null
          data_de_alteracao_completa?: string | null
          data_de_alteracao_da_baixa_completa?: string | null
          data_de_credito_ou_pagto_completa?: string | null
          data_de_emissao_completa?: string | null
          data_de_inclusao_completa?: string | null
          data_de_inclusao_da_baixa_completa?: string | null
          data_de_pagto_ou_recbto_completa?: string | null
          data_de_previsao_completa?: string | null
          data_de_registro_completa?: string | null
          data_de_vencimento_completa?: string | null
          departamento?: string | null
          desconto?: number | null
          dias_em_atraso?: number | null
          estrutura_4?: string | null
          estrutura_dfc?: string | null
          estrutura_dre?: string | null
          grupo?: string | null
          grupo_apuracao?: string | null
          grupo_de_para?: string | null
          id?: number
          importado_em?: string
          impostos_retidos?: number | null
          incluido_por?: string | null
          juros?: number | null
          minha_empresa_cnpj?: string | null
          minha_empresa_nome_fantasia?: string | null
          minha_empresa_razao_social?: string | null
          multa?: number | null
          nf_cf?: string | null
          no_do_contrato_de_venda?: string | null
          nome_do_meu_aplicativo?: string | null
          numero_do_documento?: string | null
          observacao_da_conta?: string | null
          observacao_do_pagto_ou_recbto?: string | null
          ordem_de_servico?: string | null
          pago_ou_recebido?: number | null
          parcela?: string | null
          projeto?: string | null
          tipo?: string | null
          tipo_da_conta_corrente?: string | null
          tipo_do_documento?: string | null
          valor_da_conta?: number | null
          valor_liquido?: number | null
        }
        Update: {
          a_pagar_ou_receber?: number | null
          alterado_por?: string | null
          apelido?: string | null
          arquivo_referencia?: string
          baixa_alterada_por?: string | null
          baixa_incluida_por?: string | null
          categoria?: string | null
          categoria_de_para?: string | null
          cliente_ou_fornecedor_nome_fantasia?: string | null
          cliente_ou_fornecedor_razao_social?: string | null
          cnpj_cpf?: string | null
          conciliado?: string | null
          conta_corrente?: string | null
          data_de_alteracao_completa?: string | null
          data_de_alteracao_da_baixa_completa?: string | null
          data_de_credito_ou_pagto_completa?: string | null
          data_de_emissao_completa?: string | null
          data_de_inclusao_completa?: string | null
          data_de_inclusao_da_baixa_completa?: string | null
          data_de_pagto_ou_recbto_completa?: string | null
          data_de_previsao_completa?: string | null
          data_de_registro_completa?: string | null
          data_de_vencimento_completa?: string | null
          departamento?: string | null
          desconto?: number | null
          dias_em_atraso?: number | null
          estrutura_4?: string | null
          estrutura_dfc?: string | null
          estrutura_dre?: string | null
          grupo?: string | null
          grupo_apuracao?: string | null
          grupo_de_para?: string | null
          id?: number
          importado_em?: string
          impostos_retidos?: number | null
          incluido_por?: string | null
          juros?: number | null
          minha_empresa_cnpj?: string | null
          minha_empresa_nome_fantasia?: string | null
          minha_empresa_razao_social?: string | null
          multa?: number | null
          nf_cf?: string | null
          no_do_contrato_de_venda?: string | null
          nome_do_meu_aplicativo?: string | null
          numero_do_documento?: string | null
          observacao_da_conta?: string | null
          observacao_do_pagto_ou_recbto?: string | null
          ordem_de_servico?: string | null
          pago_ou_recebido?: number | null
          parcela?: string | null
          projeto?: string | null
          tipo?: string | null
          tipo_da_conta_corrente?: string | null
          tipo_do_documento?: string | null
          valor_da_conta?: number | null
          valor_liquido?: number | null
        }
        Relationships: []
      }
      partners_dfc_caixa_competencia: {
        Row: {
          a_pagar_ou_receber: number | null
          alterado_por: string | null
          apelido: string | null
          arquivo_referencia: string
          baixa_alterada_por: string | null
          baixa_incluida_por: string | null
          categoria: string | null
          categoria_de_para: string | null
          classificacao: string | null
          cliente_ou_fornecedor_nome_fantasia: string | null
          cliente_ou_fornecedor_razao_social: string | null
          cnpj_cpf: string | null
          conciliado: string | null
          conta_corrente: string | null
          data_apuracao: string | null
          data_de_alteracao_completa: string | null
          data_de_alteracao_da_baixa_completa: string | null
          data_de_credito_ou_pagto_completa: string | null
          data_de_emissao_completa: string | null
          data_de_inclusao_completa: string | null
          data_de_inclusao_da_baixa_completa: string | null
          data_de_pagto_ou_recbto_completa: string | null
          data_de_previsao_completa: string | null
          data_de_registro_completa: string | null
          data_de_vencimento_completa: string | null
          departamento: string | null
          desconto: number | null
          dias_em_atraso: number | null
          estrutura_4: string | null
          estrutura_dfc: string | null
          estrutura_dre: string | null
          grupo: string | null
          grupo_apuracao: string | null
          grupo_de_para: string | null
          id: number
          importado_em: string
          impostos_retidos: number | null
          incluido_por: string | null
          juros: number | null
          minha_empresa_cnpj: string | null
          minha_empresa_nome_fantasia: string | null
          minha_empresa_razao_social: string | null
          multa: number | null
          nf_cf: string | null
          no_do_contrato_de_venda: string | null
          nome_do_meu_aplicativo: string | null
          numero_do_documento: string | null
          observacao_da_conta: string | null
          observacao_do_pagto_ou_recbto: string | null
          ordem_de_servico: string | null
          pago_ou_recebido: number | null
          parcela: string | null
          projeto: string | null
          tipo: string | null
          tipo_da_conta_corrente: string | null
          tipo_do_documento: string | null
          valor_da_conta: number | null
          valor_liquido: number | null
          valor_reais: number | null
        }
        Insert: {
          a_pagar_ou_receber?: number | null
          alterado_por?: string | null
          apelido?: string | null
          arquivo_referencia: string
          baixa_alterada_por?: string | null
          baixa_incluida_por?: string | null
          categoria?: string | null
          categoria_de_para?: string | null
          classificacao?: string | null
          cliente_ou_fornecedor_nome_fantasia?: string | null
          cliente_ou_fornecedor_razao_social?: string | null
          cnpj_cpf?: string | null
          conciliado?: string | null
          conta_corrente?: string | null
          data_apuracao?: string | null
          data_de_alteracao_completa?: string | null
          data_de_alteracao_da_baixa_completa?: string | null
          data_de_credito_ou_pagto_completa?: string | null
          data_de_emissao_completa?: string | null
          data_de_inclusao_completa?: string | null
          data_de_inclusao_da_baixa_completa?: string | null
          data_de_pagto_ou_recbto_completa?: string | null
          data_de_previsao_completa?: string | null
          data_de_registro_completa?: string | null
          data_de_vencimento_completa?: string | null
          departamento?: string | null
          desconto?: number | null
          dias_em_atraso?: number | null
          estrutura_4?: string | null
          estrutura_dfc?: string | null
          estrutura_dre?: string | null
          grupo?: string | null
          grupo_apuracao?: string | null
          grupo_de_para?: string | null
          id?: number
          importado_em?: string
          impostos_retidos?: number | null
          incluido_por?: string | null
          juros?: number | null
          minha_empresa_cnpj?: string | null
          minha_empresa_nome_fantasia?: string | null
          minha_empresa_razao_social?: string | null
          multa?: number | null
          nf_cf?: string | null
          no_do_contrato_de_venda?: string | null
          nome_do_meu_aplicativo?: string | null
          numero_do_documento?: string | null
          observacao_da_conta?: string | null
          observacao_do_pagto_ou_recbto?: string | null
          ordem_de_servico?: string | null
          pago_ou_recebido?: number | null
          parcela?: string | null
          projeto?: string | null
          tipo?: string | null
          tipo_da_conta_corrente?: string | null
          tipo_do_documento?: string | null
          valor_da_conta?: number | null
          valor_liquido?: number | null
          valor_reais?: number | null
        }
        Update: {
          a_pagar_ou_receber?: number | null
          alterado_por?: string | null
          apelido?: string | null
          arquivo_referencia?: string
          baixa_alterada_por?: string | null
          baixa_incluida_por?: string | null
          categoria?: string | null
          categoria_de_para?: string | null
          classificacao?: string | null
          cliente_ou_fornecedor_nome_fantasia?: string | null
          cliente_ou_fornecedor_razao_social?: string | null
          cnpj_cpf?: string | null
          conciliado?: string | null
          conta_corrente?: string | null
          data_apuracao?: string | null
          data_de_alteracao_completa?: string | null
          data_de_alteracao_da_baixa_completa?: string | null
          data_de_credito_ou_pagto_completa?: string | null
          data_de_emissao_completa?: string | null
          data_de_inclusao_completa?: string | null
          data_de_inclusao_da_baixa_completa?: string | null
          data_de_pagto_ou_recbto_completa?: string | null
          data_de_previsao_completa?: string | null
          data_de_registro_completa?: string | null
          data_de_vencimento_completa?: string | null
          departamento?: string | null
          desconto?: number | null
          dias_em_atraso?: number | null
          estrutura_4?: string | null
          estrutura_dfc?: string | null
          estrutura_dre?: string | null
          grupo?: string | null
          grupo_apuracao?: string | null
          grupo_de_para?: string | null
          id?: number
          importado_em?: string
          impostos_retidos?: number | null
          incluido_por?: string | null
          juros?: number | null
          minha_empresa_cnpj?: string | null
          minha_empresa_nome_fantasia?: string | null
          minha_empresa_razao_social?: string | null
          multa?: number | null
          nf_cf?: string | null
          no_do_contrato_de_venda?: string | null
          nome_do_meu_aplicativo?: string | null
          numero_do_documento?: string | null
          observacao_da_conta?: string | null
          observacao_do_pagto_ou_recbto?: string | null
          ordem_de_servico?: string | null
          pago_ou_recebido?: number | null
          parcela?: string | null
          projeto?: string | null
          tipo?: string | null
          tipo_da_conta_corrente?: string | null
          tipo_do_documento?: string | null
          valor_da_conta?: number | null
          valor_liquido?: number | null
          valor_reais?: number | null
        }
        Relationships: []
      }
      partners_dfc_categoria: {
        Row: {
          arquivo_referencia: string
          bloco_dfc: string | null
          bloco_dre: string | null
          categoria_de_para: string | null
          categoria_omie: string | null
          departamento: string | null
          estrutura_2: string | null
          estrutura_4: string | null
          estrutura_5: string | null
          estrutura_6: string | null
          estrutura_dfc: string | null
          estrutura_dre: string | null
          grupo_de_para: string | null
          grupo_omie: string | null
          id: number
          importado_em: string
          tipo: string | null
          tipo_fluxo_caixa: string | null
          validador: string | null
        }
        Insert: {
          arquivo_referencia: string
          bloco_dfc?: string | null
          bloco_dre?: string | null
          categoria_de_para?: string | null
          categoria_omie?: string | null
          departamento?: string | null
          estrutura_2?: string | null
          estrutura_4?: string | null
          estrutura_5?: string | null
          estrutura_6?: string | null
          estrutura_dfc?: string | null
          estrutura_dre?: string | null
          grupo_de_para?: string | null
          grupo_omie?: string | null
          id?: number
          importado_em?: string
          tipo?: string | null
          tipo_fluxo_caixa?: string | null
          validador?: string | null
        }
        Update: {
          arquivo_referencia?: string
          bloco_dfc?: string | null
          bloco_dre?: string | null
          categoria_de_para?: string | null
          categoria_omie?: string | null
          departamento?: string | null
          estrutura_2?: string | null
          estrutura_4?: string | null
          estrutura_5?: string | null
          estrutura_6?: string | null
          estrutura_dfc?: string | null
          estrutura_dre?: string | null
          grupo_de_para?: string | null
          grupo_omie?: string | null
          id?: number
          importado_em?: string
          tipo?: string | null
          tipo_fluxo_caixa?: string | null
          validador?: string | null
        }
        Relationships: []
      }
      partners_dfc_classificacao_departamento: {
        Row: {
          arquivo_referencia: string
          classificacao: string | null
          departamento: string | null
          id: number
          importado_em: string
        }
        Insert: {
          arquivo_referencia: string
          classificacao?: string | null
          departamento?: string | null
          id?: number
          importado_em?: string
        }
        Update: {
          arquivo_referencia?: string
          classificacao?: string | null
          departamento?: string | null
          id?: number
          importado_em?: string
        }
        Relationships: []
      }
      partners_dfc_cr_emissao: {
        Row: {
          a_pagar_ou_receber: number | null
          apelido: string | null
          arquivo_referencia: string
          categoria: string | null
          categoria_de_para: string | null
          cliente_ou_fornecedor_nome_fantasia: string | null
          cliente_ou_fornecedor_razao_social: string | null
          cnpj_cpf: string | null
          conciliado: string | null
          conta_corrente: string | null
          data_apuracao: string | null
          data_de_alteracao_completa: string | null
          data_de_emissao_completa: string | null
          data_de_inclusao_completa: string | null
          data_de_previsao_completa: string | null
          data_de_registro_completa: string | null
          data_de_vencimento_completa: string | null
          departamento: string | null
          desconto: number | null
          dias_em_atraso: number | null
          estrutura_4: string | null
          estrutura_dfc: string | null
          estrutura_dre: string | null
          grupo: string | null
          grupo_apuracao: string | null
          grupo_de_para: string | null
          id: number
          importado_em: string
          impostos_retidos: number | null
          incluido_por: string | null
          juros: number | null
          minha_empresa_cnpj: string | null
          minha_empresa_nome_fantasia: string | null
          minha_empresa_razao_social: string | null
          multa: number | null
          nf_cf: string | null
          nome_do_meu_aplicativo: string | null
          observacao_da_conta: string | null
          observacao_do_pagto_ou_recbto: string | null
          pago_ou_recebido: number | null
          parcela: string | null
          projeto: string | null
          situacao_do_vencimento: string | null
          tipo: string | null
          ultima_data_de_pagto_ou_recbto_completa: string | null
          valor_da_conta: number | null
          valor_liquido: number | null
          valor_reais: number | null
        }
        Insert: {
          a_pagar_ou_receber?: number | null
          apelido?: string | null
          arquivo_referencia: string
          categoria?: string | null
          categoria_de_para?: string | null
          cliente_ou_fornecedor_nome_fantasia?: string | null
          cliente_ou_fornecedor_razao_social?: string | null
          cnpj_cpf?: string | null
          conciliado?: string | null
          conta_corrente?: string | null
          data_apuracao?: string | null
          data_de_alteracao_completa?: string | null
          data_de_emissao_completa?: string | null
          data_de_inclusao_completa?: string | null
          data_de_previsao_completa?: string | null
          data_de_registro_completa?: string | null
          data_de_vencimento_completa?: string | null
          departamento?: string | null
          desconto?: number | null
          dias_em_atraso?: number | null
          estrutura_4?: string | null
          estrutura_dfc?: string | null
          estrutura_dre?: string | null
          grupo?: string | null
          grupo_apuracao?: string | null
          grupo_de_para?: string | null
          id?: number
          importado_em?: string
          impostos_retidos?: number | null
          incluido_por?: string | null
          juros?: number | null
          minha_empresa_cnpj?: string | null
          minha_empresa_nome_fantasia?: string | null
          minha_empresa_razao_social?: string | null
          multa?: number | null
          nf_cf?: string | null
          nome_do_meu_aplicativo?: string | null
          observacao_da_conta?: string | null
          observacao_do_pagto_ou_recbto?: string | null
          pago_ou_recebido?: number | null
          parcela?: string | null
          projeto?: string | null
          situacao_do_vencimento?: string | null
          tipo?: string | null
          ultima_data_de_pagto_ou_recbto_completa?: string | null
          valor_da_conta?: number | null
          valor_liquido?: number | null
          valor_reais?: number | null
        }
        Update: {
          a_pagar_ou_receber?: number | null
          apelido?: string | null
          arquivo_referencia?: string
          categoria?: string | null
          categoria_de_para?: string | null
          cliente_ou_fornecedor_nome_fantasia?: string | null
          cliente_ou_fornecedor_razao_social?: string | null
          cnpj_cpf?: string | null
          conciliado?: string | null
          conta_corrente?: string | null
          data_apuracao?: string | null
          data_de_alteracao_completa?: string | null
          data_de_emissao_completa?: string | null
          data_de_inclusao_completa?: string | null
          data_de_previsao_completa?: string | null
          data_de_registro_completa?: string | null
          data_de_vencimento_completa?: string | null
          departamento?: string | null
          desconto?: number | null
          dias_em_atraso?: number | null
          estrutura_4?: string | null
          estrutura_dfc?: string | null
          estrutura_dre?: string | null
          grupo?: string | null
          grupo_apuracao?: string | null
          grupo_de_para?: string | null
          id?: number
          importado_em?: string
          impostos_retidos?: number | null
          incluido_por?: string | null
          juros?: number | null
          minha_empresa_cnpj?: string | null
          minha_empresa_nome_fantasia?: string | null
          minha_empresa_razao_social?: string | null
          multa?: number | null
          nf_cf?: string | null
          nome_do_meu_aplicativo?: string | null
          observacao_da_conta?: string | null
          observacao_do_pagto_ou_recbto?: string | null
          pago_ou_recebido?: number | null
          parcela?: string | null
          projeto?: string | null
          situacao_do_vencimento?: string | null
          tipo?: string | null
          ultima_data_de_pagto_ou_recbto_completa?: string | null
          valor_da_conta?: number | null
          valor_liquido?: number | null
          valor_reais?: number | null
        }
        Relationships: []
      }
      partners_dfc_empresas: {
        Row: {
          apelido: string | null
          arquivo_referencia: string
          grupo_apuracao: string | null
          id: number
          importado_em: string
          minha_empresa_cnpj: string | null
          minha_empresa_nome_fantasia: string | null
          minha_empresa_razao_social: string | null
          nome_do_meu_aplicativo: string | null
        }
        Insert: {
          apelido?: string | null
          arquivo_referencia: string
          grupo_apuracao?: string | null
          id?: number
          importado_em?: string
          minha_empresa_cnpj?: string | null
          minha_empresa_nome_fantasia?: string | null
          minha_empresa_razao_social?: string | null
          nome_do_meu_aplicativo?: string | null
        }
        Update: {
          apelido?: string | null
          arquivo_referencia?: string
          grupo_apuracao?: string | null
          id?: number
          importado_em?: string
          minha_empresa_cnpj?: string | null
          minha_empresa_nome_fantasia?: string | null
          minha_empresa_razao_social?: string | null
          nome_do_meu_aplicativo?: string | null
        }
        Relationships: []
      }
      partners_dfc_saldo_mensal: {
        Row: {
          apelido: string | null
          arquivo_referencia: string
          grupo_apuracao: string | null
          id: number
          importado_em: string
          minha_empresa_nome_fantasia: string | null
          periodo: string | null
          resultado_acumulado: number | null
          saldo_inicial: number | null
        }
        Insert: {
          apelido?: string | null
          arquivo_referencia: string
          grupo_apuracao?: string | null
          id?: number
          importado_em?: string
          minha_empresa_nome_fantasia?: string | null
          periodo?: string | null
          resultado_acumulado?: number | null
          saldo_inicial?: number | null
        }
        Update: {
          apelido?: string | null
          arquivo_referencia?: string
          grupo_apuracao?: string | null
          id?: number
          importado_em?: string
          minha_empresa_nome_fantasia?: string | null
          periodo?: string | null
          resultado_acumulado?: number | null
          saldo_inicial?: number | null
        }
        Relationships: []
      }
      partners_fat_categoria: {
        Row: {
          arquivo_referencia: string
          categoria: string | null
          categoria2: string | null
          estrutura_1: string | null
          estrutura_2: string | null
          estrutura_3: string | null
          estrutura_4: string | null
          estrutura_5: string | null
          estrutura_dre_1: string | null
          estrutura_dre_2: string | null
          estrutura_dre_3: string | null
          estrutura_dre_4: string | null
          grupo: string | null
          grupo2: string | null
          id: number
          importado_em: string
          tipo: string | null
          validador: string | null
        }
        Insert: {
          arquivo_referencia: string
          categoria?: string | null
          categoria2?: string | null
          estrutura_1?: string | null
          estrutura_2?: string | null
          estrutura_3?: string | null
          estrutura_4?: string | null
          estrutura_5?: string | null
          estrutura_dre_1?: string | null
          estrutura_dre_2?: string | null
          estrutura_dre_3?: string | null
          estrutura_dre_4?: string | null
          grupo?: string | null
          grupo2?: string | null
          id?: number
          importado_em?: string
          tipo?: string | null
          validador?: string | null
        }
        Update: {
          arquivo_referencia?: string
          categoria?: string | null
          categoria2?: string | null
          estrutura_1?: string | null
          estrutura_2?: string | null
          estrutura_3?: string | null
          estrutura_4?: string | null
          estrutura_5?: string | null
          estrutura_dre_1?: string | null
          estrutura_dre_2?: string | null
          estrutura_dre_3?: string | null
          estrutura_dre_4?: string | null
          grupo?: string | null
          grupo2?: string | null
          id?: number
          importado_em?: string
          tipo?: string | null
          validador?: string | null
        }
        Relationships: []
      }
      partners_fat_empresas: {
        Row: {
          apelido: string | null
          arquivo_referencia: string
          grupo_apuracao: string | null
          id: number
          importado_em: string
          minha_empresa_cnpj: string | null
          minha_empresa_nome_fantasia: string | null
          minha_empresa_razao_social: string | null
          nome_do_meu_aplicativo: string | null
        }
        Insert: {
          apelido?: string | null
          arquivo_referencia: string
          grupo_apuracao?: string | null
          id?: number
          importado_em?: string
          minha_empresa_cnpj?: string | null
          minha_empresa_nome_fantasia?: string | null
          minha_empresa_razao_social?: string | null
          nome_do_meu_aplicativo?: string | null
        }
        Update: {
          apelido?: string | null
          arquivo_referencia?: string
          grupo_apuracao?: string | null
          id?: number
          importado_em?: string
          minha_empresa_cnpj?: string | null
          minha_empresa_nome_fantasia?: string | null
          minha_empresa_razao_social?: string | null
          nome_do_meu_aplicativo?: string | null
        }
        Relationships: []
      }
      partners_fat_faturamento: {
        Row: {
          a_pagar_ou_receber: number | null
          apelido: string | null
          arquivo_referencia: string
          ativo: string | null
          categoria: string | null
          categoria2: number | null
          cliente_ou_fornecedor_nome_fantasia: string | null
          cliente_ou_fornecedor_razao_social: string | null
          cnpj_cpf: string | null
          conciliado: string | null
          conta_corrente: string | null
          data_de_alteracao_completa: string | null
          data_de_emissao: number | null
          data_de_emissao_1: string | null
          data_de_emissao_completa: string | null
          data_de_inclusao_completa: string | null
          data_de_previsao_completa: string | null
          data_de_registro_completa: string | null
          data_de_vencimento_completa: string | null
          departamento: string | null
          desconto: number | null
          dias_em_atraso: number | null
          estrutura_1: number | null
          estrutura_2: number | null
          estrutura_3: number | null
          estrutura_4: number | null
          estrutura_dre_1: number | null
          estrutura_dre_2: number | null
          estrutura_dre_3: number | null
          estrutura_dre_4: number | null
          grupo: string | null
          grupo_apuracao: string | null
          grupo2: number | null
          id: number
          importado_em: string
          impostos_retidos: number | null
          incluido_por: string | null
          juros: number | null
          minha_empresa_nome_fantasia: string | null
          multa: number | null
          nf_cf: string | null
          nome_do_meu_aplicativo: string | null
          observacao_da_conta: string | null
          observacao_do_pagto_ou_recbto: string | null
          pago_ou_recebido: number | null
          parcela: string | null
          primeiro_faturamento: number | null
          projeto: string | null
          situacao: string | null
          situacao_do_vencimento: string | null
          tipo: string | null
          ultima_data_de_pagto_ou_recbto_completa: string | null
          ultimo_faturamento: number | null
          valor_da_conta: number | null
          valor_liquido: number | null
          vendedor: string | null
        }
        Insert: {
          a_pagar_ou_receber?: number | null
          apelido?: string | null
          arquivo_referencia: string
          ativo?: string | null
          categoria?: string | null
          categoria2?: number | null
          cliente_ou_fornecedor_nome_fantasia?: string | null
          cliente_ou_fornecedor_razao_social?: string | null
          cnpj_cpf?: string | null
          conciliado?: string | null
          conta_corrente?: string | null
          data_de_alteracao_completa?: string | null
          data_de_emissao?: number | null
          data_de_emissao_1?: string | null
          data_de_emissao_completa?: string | null
          data_de_inclusao_completa?: string | null
          data_de_previsao_completa?: string | null
          data_de_registro_completa?: string | null
          data_de_vencimento_completa?: string | null
          departamento?: string | null
          desconto?: number | null
          dias_em_atraso?: number | null
          estrutura_1?: number | null
          estrutura_2?: number | null
          estrutura_3?: number | null
          estrutura_4?: number | null
          estrutura_dre_1?: number | null
          estrutura_dre_2?: number | null
          estrutura_dre_3?: number | null
          estrutura_dre_4?: number | null
          grupo?: string | null
          grupo_apuracao?: string | null
          grupo2?: number | null
          id?: number
          importado_em?: string
          impostos_retidos?: number | null
          incluido_por?: string | null
          juros?: number | null
          minha_empresa_nome_fantasia?: string | null
          multa?: number | null
          nf_cf?: string | null
          nome_do_meu_aplicativo?: string | null
          observacao_da_conta?: string | null
          observacao_do_pagto_ou_recbto?: string | null
          pago_ou_recebido?: number | null
          parcela?: string | null
          primeiro_faturamento?: number | null
          projeto?: string | null
          situacao?: string | null
          situacao_do_vencimento?: string | null
          tipo?: string | null
          ultima_data_de_pagto_ou_recbto_completa?: string | null
          ultimo_faturamento?: number | null
          valor_da_conta?: number | null
          valor_liquido?: number | null
          vendedor?: string | null
        }
        Update: {
          a_pagar_ou_receber?: number | null
          apelido?: string | null
          arquivo_referencia?: string
          ativo?: string | null
          categoria?: string | null
          categoria2?: number | null
          cliente_ou_fornecedor_nome_fantasia?: string | null
          cliente_ou_fornecedor_razao_social?: string | null
          cnpj_cpf?: string | null
          conciliado?: string | null
          conta_corrente?: string | null
          data_de_alteracao_completa?: string | null
          data_de_emissao?: number | null
          data_de_emissao_1?: string | null
          data_de_emissao_completa?: string | null
          data_de_inclusao_completa?: string | null
          data_de_previsao_completa?: string | null
          data_de_registro_completa?: string | null
          data_de_vencimento_completa?: string | null
          departamento?: string | null
          desconto?: number | null
          dias_em_atraso?: number | null
          estrutura_1?: number | null
          estrutura_2?: number | null
          estrutura_3?: number | null
          estrutura_4?: number | null
          estrutura_dre_1?: number | null
          estrutura_dre_2?: number | null
          estrutura_dre_3?: number | null
          estrutura_dre_4?: number | null
          grupo?: string | null
          grupo_apuracao?: string | null
          grupo2?: number | null
          id?: number
          importado_em?: string
          impostos_retidos?: number | null
          incluido_por?: string | null
          juros?: number | null
          minha_empresa_nome_fantasia?: string | null
          multa?: number | null
          nf_cf?: string | null
          nome_do_meu_aplicativo?: string | null
          observacao_da_conta?: string | null
          observacao_do_pagto_ou_recbto?: string | null
          pago_ou_recebido?: number | null
          parcela?: string | null
          primeiro_faturamento?: number | null
          projeto?: string | null
          situacao?: string | null
          situacao_do_vencimento?: string | null
          tipo?: string | null
          ultima_data_de_pagto_ou_recbto_completa?: string | null
          ultimo_faturamento?: number | null
          valor_da_conta?: number | null
          valor_liquido?: number | null
          vendedor?: string | null
        }
        Relationships: []
      }
      partners_financeiro: {
        Row: {
          categoria_codigo: string | null
          categoria_percentual: number | null
          codigo_barras: string | null
          codigo_categoria: string | null
          codigo_cliente_fornecedor: number | null
          codigo_lancamento_omie: number
          codigo_projeto: number | null
          codigo_tipo_documento: string | null
          codigo_vendedor: number | null
          data_emissao: string | null
          data_entrada: string | null
          data_pagamento: string | null
          data_previsao: string | null
          data_vencimento: string | null
          departamento: string | null
          id: number
          id_conta_corrente: number | null
          id_origem: string | null
          numero_documento: string | null
          numero_documento_fiscal: string | null
          numero_parcela: string | null
          raw: Json | null
          razao_social: string | null
          status_titulo: string | null
          synced_at: string | null
          tipo: string
          unidade: string | null
          valor_documento: number | null
        }
        Insert: {
          categoria_codigo?: string | null
          categoria_percentual?: number | null
          codigo_barras?: string | null
          codigo_categoria?: string | null
          codigo_cliente_fornecedor?: number | null
          codigo_lancamento_omie: number
          codigo_projeto?: number | null
          codigo_tipo_documento?: string | null
          codigo_vendedor?: number | null
          data_emissao?: string | null
          data_entrada?: string | null
          data_pagamento?: string | null
          data_previsao?: string | null
          data_vencimento?: string | null
          departamento?: string | null
          id?: number
          id_conta_corrente?: number | null
          id_origem?: string | null
          numero_documento?: string | null
          numero_documento_fiscal?: string | null
          numero_parcela?: string | null
          raw?: Json | null
          razao_social?: string | null
          status_titulo?: string | null
          synced_at?: string | null
          tipo: string
          unidade?: string | null
          valor_documento?: number | null
        }
        Update: {
          categoria_codigo?: string | null
          categoria_percentual?: number | null
          codigo_barras?: string | null
          codigo_categoria?: string | null
          codigo_cliente_fornecedor?: number | null
          codigo_lancamento_omie?: number
          codigo_projeto?: number | null
          codigo_tipo_documento?: string | null
          codigo_vendedor?: number | null
          data_emissao?: string | null
          data_entrada?: string | null
          data_pagamento?: string | null
          data_previsao?: string | null
          data_vencimento?: string | null
          departamento?: string | null
          id?: number
          id_conta_corrente?: number | null
          id_origem?: string | null
          numero_documento?: string | null
          numero_documento_fiscal?: string | null
          numero_parcela?: string | null
          raw?: Json | null
          razao_social?: string | null
          status_titulo?: string | null
          synced_at?: string | null
          tipo?: string
          unidade?: string | null
          valor_documento?: number | null
        }
        Relationships: []
      }
      partners_financeiro_unidade_map: {
        Row: {
          created_at: string
          razao_social: string
          unidade: string
        }
        Insert: {
          created_at?: string
          razao_social: string
          unidade: string
        }
        Update: {
          created_at?: string
          razao_social?: string
          unidade?: string
        }
        Relationships: []
      }
      partners_orcamento: {
        Row: {
          categoria: string | null
          departamento: string | null
          descricao: string | null
          id: number
          mes: string
          origem: string | null
          synced_at: string | null
          tipo: string
          tipo_custo: string | null
          unidade: string | null
          valor: number
        }
        Insert: {
          categoria?: string | null
          departamento?: string | null
          descricao?: string | null
          id?: number
          mes: string
          origem?: string | null
          synced_at?: string | null
          tipo: string
          tipo_custo?: string | null
          unidade?: string | null
          valor: number
        }
        Update: {
          categoria?: string | null
          departamento?: string | null
          descricao?: string | null
          id?: number
          mes?: string
          origem?: string | null
          synced_at?: string | null
          tipo?: string
          tipo_custo?: string | null
          unidade?: string | null
          valor?: number
        }
        Relationships: []
      }
      partners_saldo_mensal: {
        Row: {
          id: number
          mes: string
          saldo_final: number
          synced_at: string
          unidade: string
        }
        Insert: {
          id?: number
          mes: string
          saldo_final: number
          synced_at?: string
          unidade?: string
        }
        Update: {
          id?: number
          mes?: string
          saldo_final?: number
          synced_at?: string
          unidade?: string
        }
        Relationships: []
      }
      pesquisa_satisfacao_comite_socios: {
        Row: {
          clareza_proximos_passos: number
          clareza_resultados: number
          comentario: string | null
          created_at: string
          frente_prioritaria: string
          id: number
          nps_recomendaria: number
          utilidade_novidades: number
        }
        Insert: {
          clareza_proximos_passos: number
          clareza_resultados: number
          comentario?: string | null
          created_at?: string
          frente_prioritaria: string
          id?: never
          nps_recomendaria: number
          utilidade_novidades: number
        }
        Update: {
          clareza_proximos_passos?: number
          clareza_resultados?: number
          comentario?: string | null
          created_at?: string
          frente_prioritaria?: string
          id?: never
          nps_recomendaria?: number
          utilidade_novidades?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          nome?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recebimentos_franquias: {
        Row: {
          categoria_omie: string | null
          cliente: string | null
          cnpj: string | null
          codigo_omie: number
          codigo_projeto: number | null
          created_at: string | null
          data_emissao: string | null
          data_pagamento: string | null
          data_vencimento: string | null
          id: number
          num_documento: string | null
          observacao: string | null
          status: string | null
          unidade: string | null
          updated_at: string | null
          valor: number | null
        }
        Insert: {
          categoria_omie?: string | null
          cliente?: string | null
          cnpj?: string | null
          codigo_omie: number
          codigo_projeto?: number | null
          created_at?: string | null
          data_emissao?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          id?: number
          num_documento?: string | null
          observacao?: string | null
          status?: string | null
          unidade?: string | null
          updated_at?: string | null
          valor?: number | null
        }
        Update: {
          categoria_omie?: string | null
          cliente?: string | null
          cnpj?: string | null
          codigo_omie?: number
          codigo_projeto?: number | null
          created_at?: string | null
          data_emissao?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          id?: number
          num_documento?: string | null
          observacao?: string | null
          status?: string | null
          unidade?: string | null
          updated_at?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      receitas_cm_fornecedores: {
        Row: {
          ativo: boolean
          categoria: string | null
          cenario_id: string | null
          created_at: string
          departamento: string | null
          funcao: string | null
          id: number
          mes_inicio: number | null
          meses_pontuais: number[] | null
          nome: string
          ordem: number | null
          parcelas: number | null
          rateio_bu_direto: string | null
          rateio_custom: Json | null
          rateio_regra: string | null
          tipo: string
          unidade: string | null
          updated_at: string
          valor_base: number
        }
        Insert: {
          ativo?: boolean
          categoria?: string | null
          cenario_id?: string | null
          created_at?: string
          departamento?: string | null
          funcao?: string | null
          id?: number
          mes_inicio?: number | null
          meses_pontuais?: number[] | null
          nome: string
          ordem?: number | null
          parcelas?: number | null
          rateio_bu_direto?: string | null
          rateio_custom?: Json | null
          rateio_regra?: string | null
          tipo?: string
          unidade?: string | null
          updated_at?: string
          valor_base?: number
        }
        Update: {
          ativo?: boolean
          categoria?: string | null
          cenario_id?: string | null
          created_at?: string
          departamento?: string | null
          funcao?: string | null
          id?: number
          mes_inicio?: number | null
          meses_pontuais?: number[] | null
          nome?: string
          ordem?: number | null
          parcelas?: number | null
          rateio_bu_direto?: string | null
          rateio_custom?: Json | null
          rateio_regra?: string | null
          tipo?: string
          unidade?: string | null
          updated_at?: string
          valor_base?: number
        }
        Relationships: [
          {
            foreignKeyName: "receitas_cm_fornecedores_cenario_id_fkey"
            columns: ["cenario_id"]
            isOneToOne: false
            referencedRelation: "dre_sim_cenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      receitas_cm_overrides: {
        Row: {
          apuracao_status: string
          codigo_omie: number | null
          created_at: string
          data_pagamento: string | null
          fornecedor_id: number
          id: number
          importacao_lote: string | null
          importado_em: string | null
          importado_por: string | null
          inativo_no_mes: boolean
          mes: string
          motivo_contestacao: string | null
          origem_apuracao: string | null
          revisado_em: string | null
          revisado_por: string | null
          status: string | null
          updated_at: string
          valor: number | null
          valor_pago: number | null
        }
        Insert: {
          apuracao_status?: string
          codigo_omie?: number | null
          created_at?: string
          data_pagamento?: string | null
          fornecedor_id: number
          id?: number
          importacao_lote?: string | null
          importado_em?: string | null
          importado_por?: string | null
          inativo_no_mes?: boolean
          mes: string
          motivo_contestacao?: string | null
          origem_apuracao?: string | null
          revisado_em?: string | null
          revisado_por?: string | null
          status?: string | null
          updated_at?: string
          valor?: number | null
          valor_pago?: number | null
        }
        Update: {
          apuracao_status?: string
          codigo_omie?: number | null
          created_at?: string
          data_pagamento?: string | null
          fornecedor_id?: number
          id?: number
          importacao_lote?: string | null
          importado_em?: string | null
          importado_por?: string | null
          inativo_no_mes?: boolean
          mes?: string
          motivo_contestacao?: string | null
          origem_apuracao?: string | null
          revisado_em?: string | null
          revisado_por?: string | null
          status?: string | null
          updated_at?: string
          valor?: number | null
          valor_pago?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "receitas_cm_overrides_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "receitas_cm_fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      repasses_unidade: {
        Row: {
          arquivo_nome: string | null
          competencia: string
          created_at: string
          created_by: string | null
          id: string
          observacao: string | null
          origem: string
          tipo: Database["public"]["Enums"]["tipo_repasse"]
          unidade: string
          updated_at: string
          valor_recebido: number
        }
        Insert: {
          arquivo_nome?: string | null
          competencia: string
          created_at?: string
          created_by?: string | null
          id?: string
          observacao?: string | null
          origem?: string
          tipo: Database["public"]["Enums"]["tipo_repasse"]
          unidade: string
          updated_at?: string
          valor_recebido?: number
        }
        Update: {
          arquivo_nome?: string | null
          competencia?: string
          created_at?: string
          created_by?: string | null
          id?: string
          observacao?: string | null
          origem?: string
          tipo?: Database["public"]["Enums"]["tipo_repasse"]
          unidade?: string
          updated_at?: string
          valor_recebido?: number
        }
        Relationships: []
      }
      roas_mensal: {
        Row: {
          cac: number | null
          cac_recebido: number | null
          cpv_medio: number | null
          created_at: string
          deals_digital: number | null
          deals_expansao: number | null
          id: number
          investimento_expansao: number | null
          investimento_real: number | null
          investimento_verba_unidades: number | null
          mes: string
          mrr_medio: number | null
          mrr_total_digital: number | null
          payback_meses_projetado: number | null
          receita_acumulada: number | null
          roas_acumulado: number | null
          roas_cac: number | null
          roas_direto: number | null
          royalties_acumulado: number | null
          royalties_mes: number | null
          updated_at: string
        }
        Insert: {
          cac?: number | null
          cac_recebido?: number | null
          cpv_medio?: number | null
          created_at?: string
          deals_digital?: number | null
          deals_expansao?: number | null
          id?: number
          investimento_expansao?: number | null
          investimento_real?: number | null
          investimento_verba_unidades?: number | null
          mes: string
          mrr_medio?: number | null
          mrr_total_digital?: number | null
          payback_meses_projetado?: number | null
          receita_acumulada?: number | null
          roas_acumulado?: number | null
          roas_cac?: number | null
          roas_direto?: number | null
          royalties_acumulado?: number | null
          royalties_mes?: number | null
          updated_at?: string
        }
        Update: {
          cac?: number | null
          cac_recebido?: number | null
          cpv_medio?: number | null
          created_at?: string
          deals_digital?: number | null
          deals_expansao?: number | null
          id?: number
          investimento_expansao?: number | null
          investimento_real?: number | null
          investimento_verba_unidades?: number | null
          mes?: string
          mrr_medio?: number | null
          mrr_total_digital?: number | null
          payback_meses_projetado?: number | null
          receita_acumulada?: number | null
          roas_acumulado?: number | null
          roas_cac?: number | null
          roas_direto?: number | null
          royalties_acumulado?: number | null
          royalties_mes?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      roas_por_unidade: {
        Row: {
          cac: number | null
          cac_recebido: number | null
          deals: number | null
          gerado_em: string | null
          id: number
          investimento_midia: number | null
          mes: string
          midia_cac: boolean | null
          mrr_medio: number | null
          paga_cac: boolean | null
          payback_meses: number | null
          roas_direto: number | null
          royalties_acumulado: number | null
          royalties_pct: number | null
          tipo_unidade: string | null
          unidade: string
          verba_recebida: number | null
        }
        Insert: {
          cac?: number | null
          cac_recebido?: number | null
          deals?: number | null
          gerado_em?: string | null
          id?: number
          investimento_midia?: number | null
          mes: string
          midia_cac?: boolean | null
          mrr_medio?: number | null
          paga_cac?: boolean | null
          payback_meses?: number | null
          roas_direto?: number | null
          royalties_acumulado?: number | null
          royalties_pct?: number | null
          tipo_unidade?: string | null
          unidade: string
          verba_recebida?: number | null
        }
        Update: {
          cac?: number | null
          cac_recebido?: number | null
          deals?: number | null
          gerado_em?: string | null
          id?: number
          investimento_midia?: number | null
          mes?: string
          midia_cac?: boolean | null
          mrr_medio?: number | null
          paga_cac?: boolean | null
          payback_meses?: number | null
          roas_direto?: number | null
          royalties_acumulado?: number | null
          royalties_pct?: number | null
          tipo_unidade?: string | null
          unidade?: string
          verba_recebida?: number | null
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          allowed: boolean
          permission_key: string
          role: string
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          permission_key: string
          role: string
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          permission_key?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          key: string
          label: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key: string
          label: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key?: string
          label?: string
        }
        Relationships: []
      }
      royalties_apuracao: {
        Row: {
          cac_valor: number | null
          confirmado_em: string | null
          confirmado_por: string | null
          created_at: string | null
          csc_base_antiga_valor: number | null
          csc_percentual_base_antiga: number | null
          csc_trafego_pago: number | null
          csc_valor_fixo: number | null
          id: number
          mes_referencia: string
          observacao: string | null
          outras_receitas: number | null
          receita_base: number | null
          receita_base_antiga: number | null
          royalties_percentual: number | null
          royalties_valor: number | null
          status: string
          total_fatura: number | null
          unidade_id: number
          updated_at: string | null
        }
        Insert: {
          cac_valor?: number | null
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string | null
          csc_base_antiga_valor?: number | null
          csc_percentual_base_antiga?: number | null
          csc_trafego_pago?: number | null
          csc_valor_fixo?: number | null
          id?: number
          mes_referencia: string
          observacao?: string | null
          outras_receitas?: number | null
          receita_base?: number | null
          receita_base_antiga?: number | null
          royalties_percentual?: number | null
          royalties_valor?: number | null
          status?: string
          total_fatura?: number | null
          unidade_id: number
          updated_at?: string | null
        }
        Update: {
          cac_valor?: number | null
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string | null
          csc_base_antiga_valor?: number | null
          csc_percentual_base_antiga?: number | null
          csc_trafego_pago?: number | null
          csc_valor_fixo?: number | null
          id?: number
          mes_referencia?: string
          observacao?: string | null
          outras_receitas?: number | null
          receita_base?: number | null
          receita_base_antiga?: number | null
          royalties_percentual?: number | null
          royalties_valor?: number | null
          status?: string
          total_fatura?: number | null
          unidade_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "royalties_apuracao_unidade_id_fkey"
            columns: ["unidade_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      royalties_apuracao_pagamentos: {
        Row: {
          apuracao_id: number
          categoria: string
          id: number
          observacao_validacao: string | null
          status_validado: string
          validado_em: string | null
          validado_por: string | null
        }
        Insert: {
          apuracao_id: number
          categoria: string
          id?: number
          observacao_validacao?: string | null
          status_validado?: string
          validado_em?: string | null
          validado_por?: string | null
        }
        Update: {
          apuracao_id?: number
          categoria?: string
          id?: number
          observacao_validacao?: string | null
          status_validado?: string
          validado_em?: string | null
          validado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "royalties_apuracao_pagamentos_apuracao_id_fkey"
            columns: ["apuracao_id"]
            isOneToOne: false
            referencedRelation: "royalties_apuracao"
            referencedColumns: ["id"]
          },
        ]
      }
      royalties_itens: {
        Row: {
          apuracao_id: number
          categoria: string
          churn_pipefy_card_id: string | null
          churn_reportado_em: string | null
          cnpj: string | null
          confirmado: boolean | null
          contrato_id: number | null
          created_at: string | null
          data_competencia_omie: string[] | null
          data_ganho: string | null
          data_pagamento_omie: string[] | null
          excluido_em: string | null
          excluido_por: string | null
          fonte: string
          id: number
          is_cac: boolean
          motivo_exclusao: string | null
          mrr_contratado: number | null
          mrr_override: number | null
          observacao: string | null
          pipedrive_deal_id_socios: string | null
          razao_social: string
          royalties_item: number | null
          royalties_percentual_override: number | null
          status_match: string | null
          valor_confirmado: number | null
          valor_omie: number | null
          venda_socios: boolean
          venda_socios_criado_em: string | null
        }
        Insert: {
          apuracao_id: number
          categoria?: string
          churn_pipefy_card_id?: string | null
          churn_reportado_em?: string | null
          cnpj?: string | null
          confirmado?: boolean | null
          contrato_id?: number | null
          created_at?: string | null
          data_competencia_omie?: string[] | null
          data_ganho?: string | null
          data_pagamento_omie?: string[] | null
          excluido_em?: string | null
          excluido_por?: string | null
          fonte?: string
          id?: number
          is_cac?: boolean
          motivo_exclusao?: string | null
          mrr_contratado?: number | null
          mrr_override?: number | null
          observacao?: string | null
          pipedrive_deal_id_socios?: string | null
          razao_social: string
          royalties_item?: number | null
          royalties_percentual_override?: number | null
          status_match?: string | null
          valor_confirmado?: number | null
          valor_omie?: number | null
          venda_socios?: boolean
          venda_socios_criado_em?: string | null
        }
        Update: {
          apuracao_id?: number
          categoria?: string
          churn_pipefy_card_id?: string | null
          churn_reportado_em?: string | null
          cnpj?: string | null
          confirmado?: boolean | null
          contrato_id?: number | null
          created_at?: string | null
          data_competencia_omie?: string[] | null
          data_ganho?: string | null
          data_pagamento_omie?: string[] | null
          excluido_em?: string | null
          excluido_por?: string | null
          fonte?: string
          id?: number
          is_cac?: boolean
          motivo_exclusao?: string | null
          mrr_contratado?: number | null
          mrr_override?: number | null
          observacao?: string | null
          pipedrive_deal_id_socios?: string | null
          razao_social?: string
          royalties_item?: number | null
          royalties_percentual_override?: number | null
          status_match?: string | null
          valor_confirmado?: number | null
          valor_omie?: number | null
          venda_socios?: boolean
          venda_socios_criado_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "royalties_itens_apuracao_id_fkey"
            columns: ["apuracao_id"]
            isOneToOne: false
            referencedRelation: "royalties_apuracao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "royalties_itens_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "royalties_itens_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "vw_grupos_completo"
            referencedColumns: ["contrato_id"]
          },
        ]
      }
      royalties_outras_receitas_itens: {
        Row: {
          apuracao_id: number
          created_at: string
          id: number
          nome: string
          observacao: string | null
          updated_at: string
          valor: number
        }
        Insert: {
          apuracao_id: number
          created_at?: string
          id?: never
          nome: string
          observacao?: string | null
          updated_at?: string
          valor?: number
        }
        Update: {
          apuracao_id?: number
          created_at?: string
          id?: never
          nome?: string
          observacao?: string | null
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "royalties_outras_receitas_itens_apuracao_id_fkey"
            columns: ["apuracao_id"]
            isOneToOne: false
            referencedRelation: "royalties_apuracao"
            referencedColumns: ["id"]
          },
        ]
      }
      socios: {
        Row: {
          area: string | null
          cargo: string | null
          cpf: string | null
          created_at: string | null
          email: string | null
          id: number
          nome_completo: string
          pipefy_id: string | null
          telefone: string | null
          unidade: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          area?: string | null
          cargo?: string | null
          cpf?: string | null
          created_at?: string | null
          email?: string | null
          id?: number
          nome_completo: string
          pipefy_id?: string | null
          telefone?: string | null
          unidade?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          area?: string | null
          cargo?: string | null
          cpf?: string | null
          created_at?: string | null
          email?: string | null
          id?: number
          nome_completo?: string
          pipefy_id?: string | null
          telefone?: string | null
          unidade?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      sqls_por_bu: {
        Row: {
          bu: string
          created_at: string
          id: number
          mes: string
          updated_at: string
          valor: number
        }
        Insert: {
          bu: string
          created_at?: string
          id?: number
          mes: string
          updated_at?: string
          valor?: number
        }
        Update: {
          bu?: string
          created_at?: string
          id?: number
          mes?: string
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          detalhes: Json | null
          duracao_segundos: number | null
          executado_em: string
          fonte: string
          id: number
          status: string
          total_registros: number | null
        }
        Insert: {
          detalhes?: Json | null
          duracao_segundos?: number | null
          executado_em?: string
          fonte: string
          id?: never
          status?: string
          total_registros?: number | null
        }
        Update: {
          detalhes?: Json | null
          duracao_segundos?: number | null
          executado_em?: string
          fonte?: string
          id?: never
          status?: string
          total_registros?: number | null
        }
        Relationships: []
      }
      unidades: {
        Row: {
          absorve_midia: boolean
          cnpj: string | null
          created_at: string | null
          csc_percentual_base_antiga: number | null
          csc_valor_fixo: number | null
          data_inauguracao: string | null
          empresa: string | null
          id: number
          id_asaas: string | null
          id_omie: string | null
          midia_cac: boolean | null
          midia_mensal: number | null
          nome_da_praca: string
          observacoes_financeiras: string | null
          paga_cac: boolean
          pipefy_id: string | null
          razao_social: string | null
          royalties_percentual: number | null
          tipo: string | null
          updated_at: string | null
        }
        Insert: {
          absorve_midia?: boolean
          cnpj?: string | null
          created_at?: string | null
          csc_percentual_base_antiga?: number | null
          csc_valor_fixo?: number | null
          data_inauguracao?: string | null
          empresa?: string | null
          id?: number
          id_asaas?: string | null
          id_omie?: string | null
          midia_cac?: boolean | null
          midia_mensal?: number | null
          nome_da_praca: string
          observacoes_financeiras?: string | null
          paga_cac?: boolean
          pipefy_id?: string | null
          razao_social?: string | null
          royalties_percentual?: number | null
          tipo?: string | null
          updated_at?: string | null
        }
        Update: {
          absorve_midia?: boolean
          cnpj?: string | null
          created_at?: string | null
          csc_percentual_base_antiga?: number | null
          csc_valor_fixo?: number | null
          data_inauguracao?: string | null
          empresa?: string | null
          id?: number
          id_asaas?: string | null
          id_omie?: string | null
          midia_cac?: boolean | null
          midia_mensal?: number | null
          nome_da_praca?: string
          observacoes_financeiras?: string | null
          paga_cac?: boolean
          pipefy_id?: string | null
          razao_social?: string | null
          royalties_percentual?: number | null
          tipo?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      vendas_servicos_unidades: {
        Row: {
          criado_em: string | null
          data_reuniao: string | null
          fase_atual: string | null
          gatilho_reajuste: string | null
          negociacao: string | null
          pipefy_card_id: string
          reuniao_aconteceu: boolean | null
          solucao: string | null
          synced_at: string
          titulo: string | null
          unidade: string | null
          valor_mensal_1_mes: number | null
          valor_teto_rampa: number | null
          venda_feita: boolean | null
        }
        Insert: {
          criado_em?: string | null
          data_reuniao?: string | null
          fase_atual?: string | null
          gatilho_reajuste?: string | null
          negociacao?: string | null
          pipefy_card_id: string
          reuniao_aconteceu?: boolean | null
          solucao?: string | null
          synced_at?: string
          titulo?: string | null
          unidade?: string | null
          valor_mensal_1_mes?: number | null
          valor_teto_rampa?: number | null
          venda_feita?: boolean | null
        }
        Update: {
          criado_em?: string | null
          data_reuniao?: string | null
          fase_atual?: string | null
          gatilho_reajuste?: string | null
          negociacao?: string | null
          pipefy_card_id?: string
          reuniao_aconteceu?: boolean | null
          solucao?: string | null
          synced_at?: string
          titulo?: string | null
          unidade?: string | null
          valor_mensal_1_mes?: number | null
          valor_teto_rampa?: number | null
          venda_feita?: boolean | null
        }
        Relationships: []
      }
    }
    Views: {
      despesas_cm: {
        Row: {
          apuracao_status: string | null
          categoria: string | null
          codigo_omie: number | null
          data_pagamento: string | null
          dpto: string | null
          fornecedor: string | null
          id: number | null
          mes: string | null
          motivo_contestacao: string | null
          observacao: string | null
          origem: string | null
          origem_apuracao: string | null
          status: string | null
          tipo_despesa: string | null
          valor_pago: number | null
          valor_total: number | null
        }
        Relationships: []
      }
      partners_dre_realizada_mensal: {
        Row: {
          arquivo_referencia: string | null
          bloco: string | null
          linha: string | null
          mes: string | null
          qtd_lancamentos: number | null
          valor: number | null
        }
        Relationships: []
      }
      v_confronto_cm: {
        Row: {
          apuracao_status: string | null
          categoria: string | null
          data_pagamento: string | null
          diferenca: number | null
          dpto: string | null
          fornecedor: string | null
          mes: string | null
          motivo_contestacao: string | null
          observacao: string | null
          origem: string | null
          origem_apuracao: string | null
          resultado: string | null
          status: string | null
          tipo_despesa: string | null
          valor_planejado: number | null
          valor_realizado: number | null
        }
        Relationships: []
      }
      v_despesas_cm_mes: {
        Row: {
          apuracao_status: string | null
          categoria: string | null
          codigo_omie: number | null
          data_pagamento: string | null
          departamento: string | null
          fornecedor: string | null
          fornecedor_id: number | null
          funcao: string | null
          inativo_no_mes: boolean | null
          mes: string | null
          motivo_contestacao: string | null
          observacao: string | null
          origem: string | null
          origem_apuracao: string | null
          override_id: number | null
          rateio_bu_direto: string | null
          rateio_custom: Json | null
          rateio_regra: string | null
          status: string | null
          tem_override: boolean | null
          tipo: string | null
          valor_base: number | null
          valor_pago: number | null
          valor_total: number | null
        }
        Relationships: []
      }
      v_funil_mensal: {
        Row: {
          contratos_ativos: number | null
          conv_faturado_to_recebido_pct: number | null
          conv_mrr_to_faturado_pct: number | null
          conv_mrr_to_recebido_pct: number | null
          faturado: number | null
          faturas_emitidas: number | null
          faturas_recebidas: number | null
          mes: string | null
          mrr_contratado: number | null
          recebido: number | null
          unidade: string | null
        }
        Relationships: []
      }
      v_integracoes_status: {
        Row: {
          ativo: boolean | null
          atrasada: boolean | null
          fonte: string | null
          intervalo_esperado_minutos: number | null
          minutos_desde_ultima_execucao: number | null
          nome_exibicao: string | null
          observacao: string | null
          tipo: string | null
          ultima_execucao: string | null
          ultimo_detalhes: Json | null
          ultimo_status: string | null
          ultimo_total_registros: number | null
        }
        Relationships: []
      }
      v_mrr_por_unidade: {
        Row: {
          mrr_total: number | null
          num_contratos: number | null
          unidade: string | null
        }
        Relationships: []
      }
      v_nps_regional: {
        Row: {
          avaliacao_fiscal: string | null
          created_at: string | null
          email_pesquisa: string | null
          empresa: string | null
          fase: string | null
          id: number | null
          nome_contato: string | null
          nps_recomendacao: string | null
          pipedrive_deal_id: string | null
          pipefy_card_id: string | null
          segmento: string | null
          telefone_pesquisa: string | null
          unidade: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_payback_simulacao: {
        Row: {
          absorve_midia: boolean | null
          cpv_medio: number | null
          deals_medio_mensal: number | null
          investimento_medio: number | null
          mrr_medio_historico: number | null
          paga_cac: boolean | null
          royalties_pct: number | null
          royalty_por_cliente: number | null
          tipo: string | null
          unidade: string | null
          verba_midia: number | null
        }
        Relationships: []
      }
      v_rateio_cm_mensal: {
        Row: {
          bu: string | null
          despesa_id: number | null
          dpto: string | null
          fornecedor: string | null
          mes: string | null
          status: string | null
          tipo_despesa: string | null
          valor_alocado: number | null
          valor_total: number | null
        }
        Relationships: []
      }
      v_reconciliacao_mensal: {
        Row: {
          a_vencer: number | null
          em_atraso: number | null
          faturado: number | null
          mes: string | null
          mrr_contratado: number | null
          num_contratos: number | null
          num_faturas: number | null
          num_recebidos: number | null
          pct_faturado_vs_mrr: number | null
          pct_recebido_vs_faturado: number | null
          recebido: number | null
          unidade: string | null
        }
        Relationships: []
      }
      v_royalties_mensais: {
        Row: {
          csc_valor: number | null
          csc_valor_fixo: number | null
          faturado: number | null
          mes: string | null
          recebido: number | null
          royalties_percentual: number | null
          royalties_valor: number | null
          total_due_matriz: number | null
          unidade: string | null
        }
        Relationships: []
      }
      vw_grupos_completo: {
        Row: {
          cnpj: string | null
          cnpj_raiz: string | null
          contrato_id: number | null
          empresa_id: number | null
          empresa_nome: string | null
          empresa_segmento: string | null
          fonte_cadastro: string | null
          ganho_em: string | null
          grupo_id: number | null
          grupo_nome: string | null
          grupo_pipefy_id: string | null
          grupo_segmento: string | null
          mrr: number | null
          pipedrive_deal_id: string | null
          pipedrive_id: string | null
          pipefy_record_id: string | null
          produto: string | null
          status_contrato: string | null
          uf: string | null
          valor_total: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      billing_esperado: {
        Args: { mes_ref: string }
        Returns: {
          clientes_ativos: number
          csc_fixo: number
          midia_mensal: number
          mrr_base: number
          paga_cac: boolean
          royalties_esp: number
          royalties_pct: number
          tem_base_antiga: boolean
          total_esperado: number
          unidade: string
        }[]
      }
      can: { Args: { _key: string }; Returns: boolean }
      clonar_despesas_cm: {
        Args: { mes_destino: string; mes_origem: string }
        Returns: {
          clonados: number
          ja_existiam: number
        }[]
      }
      current_user_unidade: { Args: never; Returns: string }
      get_socio_unidade_by_email: { Args: { _email: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      inicializar_mes_cm: {
        Args: { p_mes: string }
        Returns: {
          criados: number
          ja_existiam: number
        }[]
      }
      is_custom_role: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "admin"
        | "diretor"
        | "socio"
        | "head"
        | "auditor"
        | "socio_franqueado"
      grupo_dre:
        | "entrada"
        | "aporte"
        | "imposto_direto"
        | "custo_variavel"
        | "custo_fixo"
        | "capex"
      tipo_repasse: "royalties" | "cac"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "admin",
        "diretor",
        "socio",
        "head",
        "auditor",
        "socio_franqueado",
      ],
      grupo_dre: [
        "entrada",
        "aporte",
        "imposto_direto",
        "custo_variavel",
        "custo_fixo",
        "capex",
      ],
      tipo_repasse: ["royalties", "cac"],
    },
  },
} as const
