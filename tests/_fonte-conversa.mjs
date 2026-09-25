// Fonte pequena e escrita à mão para os testes da conversa: três unidades, três meses, e o grupo
// com um mês em curso. Os valores esperados nos testes saem destes números, não das funções.
import {
  montarLeituraRede,
  montarLeituraGrupo,
  extrairFaturamento,
} from "../src/lib/cockpit-ceo/receita-fontes.ts";

export const HOJE = "2026-09-24";

// Rede: Belém, Curitiba e Outra, regionais desde jan/2026. Apurações confirmadas:
//   Belém    jun 100+50  jul 110+40  ago 120+30   (nova + antiga)
//   Curitiba jun 200+0   jul 180+10  ago 150+20
//   Outra    jun 10+0    jul 10+0    ago —        → ago fica parcial na rede
const unidades = [
  { id: 1, nome: "Belém", tipo: "regional", inauguracao: "2026-01-01" },
  { id: 2, nome: "Curitiba", tipo: "regional", inauguracao: "2026-01-01" },
  { id: 3, nome: "Outra", tipo: "regional", inauguracao: "2026-01-01" },
];
const ap = (unidade_id, mes, nova, antiga) => ({
  unidade_id,
  mes: `2026-${mes}-01`,
  status: "confirmado",
  receita_base: nova,
  receita_base_antiga: antiga,
});
export const rede = montarLeituraRede({
  acesso: true,
  unidades,
  apuracoes: [
    ap(1, "06", 100, 50),
    ap(1, "07", 110, 40),
    ap(1, "08", 120, 30),
    ap(2, "06", 200, 0),
    ap(2, "07", 180, 10),
    ap(2, "08", 150, 20),
    ap(3, "06", 10, 0),
    ap(3, "07", 10, 0),
  ],
});
// Grupo: jun 1.000, jul 1.100, ago 1.250, set em curso (parcial).
const mesG = (m, receita, parcial = false) => ({ competencia: `2026-${m}-01`, receita, parcial });
const serieG = [mesG("06", 1000), mesG("07", 1100), mesG("08", 1250), mesG("09", 300, true)];
export const grupo = montarLeituraGrupo({
  acesso: true,
  faturamento: extrairFaturamento({
    definicao: "teste",
    escopo: { recortes_excluidos: [] },
    serie: serieG,
    meses: serieG.map((s) => ({
      competencia: s.competencia,
      parcial: s.parcial,
      motivo: "",
      sem_cobertura: false,
    })),
    meses_fora_da_cobertura: [],
    totais: { receita_total_escopo: 3650 },
    excluido_pelos_recortes: { receita: 0 },
    excluido_do_faturamento: { receita: 0 },
  }),
});
export const fonte = {
  sintetico: false,
  hoje: HOJE,
  agora: `${HOJE}T12:00:00.000Z`,
  acessoBase: false,
  acessoNegocios: false,
  monetizacao: { estado: "sem_acesso", erro: null, dados: null },
  receita: {
    estado: "ok",
    erro: null,
    leituras: [grupo, rede],
    ponte: null,
    frescorFinanceiro: null,
  },
};
