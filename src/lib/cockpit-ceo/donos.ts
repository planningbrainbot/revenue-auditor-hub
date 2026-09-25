// Quem responde por cada número e por cada regra de ameaça, para a exceção dizer a quem cobrar.
//
// Fonte: campo "Dono" de docs/dev_notes/cockpit-ceo-empresa/contratos-indicadores.md (empresa) e os
// responsáveis que as próprias decisões da Monetização já declaram em indicadores.ts. Não é
// organograma: é o dono do dado ou da régua. Mudou o dono no contrato, muda aqui.
export const DONO_DO_INDICADOR: Record<string, string> = {
  "meta-bilhao": "CEO + CFO",
  "faturamento-mes": "Controladoria / CFO",
  "faturamento-saiu": "Controladoria / CFO",
  "mrr-vendido": "Diretoria de Growth",
  "vencido-em-aberto": "Controladoria",
  "onboarding-parado": "Operações + CS",
  "contratos-ganhos": "Comercial + Departamento de Receitas",
  "oportunidades-validadas": "Comercial + Departamento de Receitas",
  "leads-trabalhados": "Comercial + Departamento de Receitas",
  "receita-prevista-aberta": "Comercial + Departamento de Receitas",
  "contas-prontas": "Departamento de Receitas + unidades",
};

/** Ameaças cujo dono não é o dono do número que elas apontam. */
const DONO_DA_AMEACA: Record<string, string> = {
  // A carga para porque os crons do Financeiro param; quem religa é o dono do Brain Financeiro.
  "financeiro-parado": "Dono do Brain Financeiro",
  "crm-parado": "Departamento de Receitas (carga da Monetização)",
};

export function donoDaAmeaca(a: { id: string; indicador?: string | null }): string {
  return (
    DONO_DA_AMEACA[a.id] ??
    (a.indicador ? DONO_DO_INDICADOR[a.indicador] : undefined) ??
    "A definir"
  );
}
