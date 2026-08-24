import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, digits } from "@/lib/server-utils";
import {
  MOTIVOS_CHURN,
  PIPEFY_FASE_PERDIDO,
  PIPEFY_PIPE_TRATATIVAS,
  type MotivoChurn,
} from "@/lib/royalties.functions";

// Marcar churn na tela de Clientes é liberado por permissão (não só admin) —
// mesmo padrão de manage.repasses: checa direto via can(), sem has_role.
async function assertCanMarcarChurn(supabase: any) {
  const { data, error } = await supabase.rpc("can", { _key: "manage.clientes_churn" });
  if (error) throw new Error("Erro de autorização.");
  if (!data) throw new Error("Acesso negado: você não pode marcar churn.");
}

// ============ atualizarCliente ============
// Corrige razão social e/ou CNPJ de um cliente direto na tela de Clientes.
// empresas é alimentado pelo sync automático (pipedrive_sync / enriquecimento
// de CNPJ) — uma edição manual aqui pode ser sobrescrita se o mesmo registro
// for resincronizado depois. Ainda assim é útil pra corrigir na hora.
export const atualizarCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: number; razao_social?: string; cnpj?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const patch: { razao_social?: string; cnpj?: string } = {};
    if (data.razao_social !== undefined) {
      const nome = data.razao_social.trim();
      if (!nome) throw new Error("Razão social não pode ficar em branco.");
      patch.razao_social = nome;
    }
    if (data.cnpj !== undefined) {
      const cnpj = digits(data.cnpj);
      if (cnpj.length !== 14) throw new Error("CNPJ inválido — precisa ter 14 dígitos.");
      patch.cnpj = cnpj;
    }
    if (Object.keys(patch).length === 0) throw new Error("Nada para atualizar.");

    const { error } = await supabase.from("empresas").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, ...patch };
  });

// ============ marcarChurnCliente ============
// Mesmo mecanismo do "Marcar churn" da apuração de royalties: cria um card no
// pipe Pipefy "Tratativas" já na fase "Perdido", vinculado ao deal do
// Pipedrive. O card sincroniza de volta pra central_tratativas via
// sync_pipefy_tratativas.py (roda a cada 15min), e é isso que clientes.tsx
// usa pra marcar o cliente como churn — não existe coluna de churn em
// empresas, então a UI reflete o card assim que o próximo sync rodar.
export const marcarChurnCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      pipedrive_id: string;
      razao_social: string;
      unidade: string;
      mrr: number;
      motivo: string;
      observacao?: string;
      data_churn: string;
    }) => d,
  )
  .handler(async ({ data, context }): Promise<{ ok: true; pipefy_card_id: string }> => {
    const { supabase } = context;
    await assertCanMarcarChurn(supabase);

    if (!MOTIVOS_CHURN.includes(data.motivo as MotivoChurn)) {
      throw new Error("Selecione um motivo de churn válido.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.data_churn)) throw new Error("Data do churn inválida.");
    if (!data.pipedrive_id) {
      throw new Error("Cliente sem Pipedrive ID — não é possível vincular o churn.");
    }

    const pipefyToken = process.env.PIPEFY_TOKEN;
    if (!pipefyToken) throw new Error("PIPEFY_TOKEN não configurado no servidor.");

    const mutation = `
      mutation($fields: [FieldValueInput!]) {
        createCard(input: {
          pipe_id: "${PIPEFY_PIPE_TRATATIVAS}"
          phase_id: "${PIPEFY_FASE_PERDIDO}"
          title: ${JSON.stringify(data.razao_social || "—")}
          fields_attributes: $fields
        }) { card { id } }
      }
    `;
    const fields = [
      { field_id: "unidade_de_neg_cio", field_value: [data.unidade] },
      { field_id: "mrr_r", field_value: [String(data.mrr ?? 0)] },
      { field_id: "categoria_do_churn", field_value: [data.motivo] },
      { field_id: "data_do_churn", field_value: [data.data_churn] },
      { field_id: "id_deal_pipedrive", field_value: [String(data.pipedrive_id)] },
    ];
    if (data.observacao?.trim()) {
      fields.push({ field_id: "motivo_do_churn", field_value: [data.observacao.trim()] });
    }

    const resp = await fetch("https://api.pipefy.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${pipefyToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: mutation, variables: { fields } }),
    });
    const body = await resp.json();
    if (body.errors) throw new Error(`Pipefy: ${body.errors[0]?.message ?? "erro desconhecido"}`);
    const cardId: string = body.data.createCard.card.id;

    return { ok: true, pipefy_card_id: cardId };
  });
