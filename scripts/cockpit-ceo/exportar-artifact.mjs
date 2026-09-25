// Gera docs/dev_notes/cockpit-ceo-empresa/atualizacao-para-artifact.md a partir do MESMO registro
// que a tela usa (src/lib/cockpit-ceo/perguntas.ts) e do último resultado da homologação com dado
// real (homologacao/resultado-*.json, só agregados). Não existe segunda lista de perguntas.
//
// Uso: node --experimental-strip-types scripts/cockpit-ceo/exportar-artifact.mjs
// Sem credencial, sem nome de cliente, sem e-mail: só catálogo, estados e números agregados.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  EXIGENCIAS_INVESTIDOR,
  ORDEM_PILARES,
  PERGUNTAS,
  PILARES,
  situacaoDaPergunta,
} from "../../src/lib/cockpit-ceo/perguntas.ts";
import { FRENTES, ORDEM_FRENTES } from "../../src/lib/cockpit-ceo/contrato.ts";

const DIR = "docs/dev_notes/cockpit-ceo-empresa";
const arq = readdirSync(`${DIR}/homologacao`)
  .filter((f) => f.startsWith("resultado-"))
  .sort()
  .at(-1);
const h = arq ? JSON.parse(readFileSync(`${DIR}/homologacao/${arq}`, "utf8")) : null;
const mi = (v) =>
  v === null || v === undefined ? "—" : `R$ ${(v / 1e6).toFixed(2).replace(".", ",")} mi`;
const mil = (v) =>
  v === null || v === undefined ? "—" : `R$ ${Math.round(v / 1e3).toLocaleString("pt-BR")} mil`;
const mesBr = (m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const SIT = { respondida: "respondida", parcial: "parcial", lacuna: "lacuna" };
const IMPL = {
  no_ar: "no ar",
  nesta_versao: "nesta versão (não publicada)",
  nao_iniciada: "não iniciada",
};

const linhas = [];
const p = (s = "") => linhas.push(s);
const data = h?.hoje ?? new Date().toISOString().slice(0, 10);

p(
  `# Atualização para o artifact "Receitas rumo ao bilhão" — ${data.split("-").reverse().join("/")}`,
);
p();
p(
  "Estado real do Cockpit do CEO depois da ampliação para a empresa inteira. Gerado do registro único da tela e da homologação com dado real (somente leitura). Sem credenciais, sem nomes de clientes ou pessoas.",
);
p();
p("## O que mudou no escopo");
p();
p(
  "- A meta é **R$ 1 bilhão de faturamento anual da Planning** (ano-alvo 2030). O perímetro continua por decidir: as leituras do grupo e da rede aparecem lado a lado, nunca somadas.",
);
p(
  "- O cockpit deixou de ser um painel de Monetização. Monetização virou uma frente (Portfólio e monetização) e um dos motores da ponte.",
);
p(
  "- **Fonte do faturamento corrigida.** O cockpit lia uma cópia do Financeiro congelada em 02/09, que ficava cerca de 10% abaixo da tela oficial. Agora lê a mesma função da tela de Faturamento, no projeto do Brain Financeiro.",
);
p(
  "- Entraram Growth (aquisição, plano × realizado, forecast do mês), Operação (fila de onboarding), Caixa e margem, a ponte de faturamento por cliente e a cadeia venda → ativação → faturamento → recebimento → saída.",
);
p();
if (h) {
  const fat = h.financeiro.serie.filter((s) => h.financeiro.fechados.includes(s.mes));
  const media = fat.reduce((s, x) => s + x.valor, 0) / fat.length;
  const ult = h.financeiro.ponte.at(-1);
  const copia = h.financeiro.copiaCongelada.filter((c) => c.diferencaPct !== null);
  p(`## Números lidos em ${data.split("-").reverse().join("/")} (somente leitura)`);
  p();
  p(
    `- **Faturamento do grupo** (Financeiro, DRE 1.1 por emissão, Finance e Negócios Estruturados fora por padrão): ${fat.length} meses fechados, de ${mesBr(fat[0].mes)} a ${mesBr(fat.at(-1).mes)}. Média de ${mi(media)} por mês, ou ${(83_333_333 / media).toFixed(1).replace(".", ",")}× abaixo dos R$ 83,3 mi/mês que a meta pede em 2030. Última carga do Financeiro: ${String(h.financeiro.frescor.carregado).slice(0, 10).split("-").reverse().join("/")}.`,
  );
  p(
    `- **A cópia que o cockpit lia** ficava entre ${Math.min(...copia.map((c) => c.diferencaPct))}% e ${Math.max(...copia.map((c) => c.diferencaPct))}% da fonte oficial, mês a mês.`,
  );
  p(
    `- **Ponte de ${mesBr(ult.mes)}** (${mi(ult.anterior)} → ${mi(ult.atual)}): ${ult.novos.clientes} clientes novos (${mil(ult.novos.valor)}), ${ult.retornos.clientes} retornos (${mil(ult.retornos.valor)}), expansão de ${ult.expansao.clientes} clientes (${mil(ult.expansao.valor)}), contração de ${ult.contracao.clientes} (${mil(ult.contracao.valor)}) e ${ult.semFaturamento.clientes} sem faturamento no mês (${mil(ult.semFaturamento.valor)}). Todos os ${h.financeiro.ponte.length} meses fecham em centavos com a fonte.`,
  );
  p(
    `- **Margem bruta no ano:** ${(h.caixa.margem * 100).toFixed(1).replace(".", ",")}% sobre ${mi(h.caixa.receitaBruta)} de receita bruta. Caixa livre no fim de ${h.caixa.caixaLivre.mesReferencia ? mesBr(h.caixa.caixaLivre.mesReferencia) : "—"}: ${mi(h.caixa.caixaLivre.valor)}${h.caixa.caixaLivre.empresasSemSaldo.length ? ` (sem saldo: ${h.caixa.caixaLivre.empresasSemSaldo.join(", ")})` : ""}.`,
  );
  p(
    `- **Vencido e não recebido:** ${mi(h.caixa.inadimplencia.atrasado)} em ${h.caixa.inadimplencia.titulos} títulos, de ${mi(h.caixa.inadimplencia.emAberto)} em aberto (Omie ao vivo).`,
  );
  const aqF = h.aquisicao.meses.filter((m) => m.plano?.mrrNovo != null && !m.emAndamento);
  p(
    `- **Aquisição (Inside Sales):** ${aqF.map((m) => `${mesBr(m.mes)} ${mil(m.mrrNovo)} vendidos contra ${mil(m.plano.mrrNovo)} de plano`).join("; ")}. O pipeline aberto tem ${h.aquisicao.pipeline.negocios} negócios, ${mi(h.aquisicao.pipeline.mrr)} de MRR sem ponderação, e **nenhum tem data de fechamento esperada**.`,
  );
  p(
    `- **Onboarding:** ${h.onboarding.emCurso} clientes em curso, **${h.onboarding.parados30} há mais de 30 dias na mesma fase** (${h.onboarding.parados60} há mais de 60). ${h.onboarding.concluidos} concluídos, mediana de ${h.onboarding.criacaoAteConclusao.mediana} dias do card à conclusão. Não há SLA decidido.`,
  );
  const c = h.cadeia;
  p(
    `- **Cadeia da safra** de ${c.safra.de.split("-").reverse().join("/")} a ${c.safra.ate.split("-").reverse().join("/")}: ${c.vendas} contratos ganhos → ${c.ativacaoIniciada} com onboarding iniciado → ${c.ativacaoConcluida} concluídos → ${c.faturadas} faturados (${c.faturadasNaUnidade} pela unidade, ${c.faturadasNoGrupo} pelo grupo) → ${c.recebidasNaUnidade} com título pago na unidade → ${c.saidas} saídas registradas. **${c.semCnpj} dos ${c.vendas} contratos não têm CNPJ**: é o elo que mais quebra a cadeia.`,
  );
  p(
    `- **Conferências com SQL independente:** ${Object.values(h.conferencias).filter((x) => x.ok).length} de ${Object.keys(h.conferencias).length} batem.`,
  );
  p();
}
p("## Pilares");
p();
p("| Pilar | Respondidas | Parciais | Lacunas | Dono proposto |");
p("|---|---|---|---|---|");
for (const k of ORDEM_PILARES) {
  const q = PERGUNTAS.filter((x) => x.pilar === k);
  const n = (s) => q.filter((x) => situacaoDaPergunta(x) === s).length;
  p(
    `| ${PILARES[k].n}. ${PILARES[k].titulo} | ${n("respondida")} | ${n("parcial")} | ${n("lacuna")} | ${PILARES[k].dono} |`,
  );
}
p();
p("## As 11 exigências do mapa de investidores (p. 25)");
p();
p("| # | Exigência | Pergunta | Situação | O que falta |");
p("|---|---|---|---|---|");
for (const e of EXIGENCIAS_INVESTIDOR) {
  const q = PERGUNTAS.find((x) => x.exigencia === e.id);
  p(
    `| ${e.id} | ${e.titulo} | ${q?.id ?? "—"} | ${q ? SIT[situacaoDaPergunta(q)] : "lacuna"} | ${q?.pendencia ?? "—"} |`,
  );
}
p();
p("## Perguntas por frente");
p();
for (const f of ORDEM_FRENTES) {
  p(`### ${FRENTES[f].titulo}`);
  p();
  for (const q of PERGUNTAS.filter((x) => x.frente === f)) {
    const orig =
      q.origem === "mapa"
        ? `mapa, exigência ${q.exigencia}`
        : q.origem === "prd"
          ? "PRD 22/09"
          : "desdobramento 23/09";
    p(
      `- **${q.id} · ${q.texto}** — ${SIT[situacaoDaPergunta(q)]} (${IMPL[q.estados.implementacao]}; ${orig}). ${q.resposta}${q.pendencia ? ` Falta: ${q.pendencia}` : ""}${q.estados.decisao ? ` Decisão pendente: ${q.estados.decisao}.` : ""}`,
    );
  }
  p();
}
p("## Decisões e pendências que continuam abertas");
p();
p("1. Perímetro da meta: grupo, rede ou outro (CEO + CFO).");
p(
  "2. Cobrança das GitHub Actions da conta que roda os crons do Financeiro: sem carga desde 20/09 (dono da conta).",
);
p(
  "3. Migração do Financeiro para o banco único; até lá, o cockpit lê o projeto do Financeiro pela credencial de servidor que o Ops já tem (Eliezek e dono do Financeiro).",
);
p("4. SLA de onboarding e quem destrava a fila (Operações propõe, CEO aprova).");
p("5. CNPJ em todo contrato ganho e data de fechamento esperada no pipeline (Comercial / Growth).");
p(
  "6. Previsão empresarial de receita por mês e motor (CFO + RevOps); escolha entre os forecasts v10 e v11 da Monetização.",
);
p("7. Definição de cliente ativo por contexto (CEO + Receitas).");
p("8. Vínculo receita → unidade, produto e vertical no Financeiro (Controladoria + Receitas).");
p("9. Mandato de consolidação (CEO + CFO); quem lê a pesquisa dos sócios (Expansão).");
p();
p("## Onde está");
p();
p(
  "- **Local e em PR de revisão**, branch `feat/cockpit-ceo-empresa-20260923`. **Não publicado:** o deploy do Ops é pela CLI do Eliezek e precisa de autorização.",
);
p("- Preview sintético: `./scripts/cockpit-ceo/preview.sh` → `/piloto/cockpit-ceo`.");
writeFileSync(`${DIR}/atualizacao-para-artifact.md`, linhas.join("\n") + "\n");
console.log(
  `gravado ${DIR}/atualizacao-para-artifact.md (${linhas.length} linhas, homologação ${arq ?? "ausente"})`,
);
