/* eslint-disable @typescript-eslint/no-explicit-any -- a resposta do modelo chega sem tipo. */
// Avaliação da ligação de qualificação da pré-venda contra o script v2 (09/10/2026). Os textos do script são cópia de
// monetizacao/outputs/2026-10-09-pre-venda-v2/conteudo.py (SCRIPT_ABERTURA, SCRIPT_PERGUNTAS, SCRIPT_FECHAMENTO_*); a
// régua de oportunidade é a de doc02_v2.py. Mudou o script lá? Copie aqui e troque VERSAO_REGUA.
//
// Método igual ao da avaliação de reunião (monetizacao-reunioes/avaliacao.ts), que segue a aderência do Growth: a IA
// só marca sim, parcial ou não e cita um trecho LITERAL; o código confere cada trecho (inteiro ou numa janela de 12
// palavras) e rebaixa para "não" o que não achar; o código calcula a nota. Sem API do Deno: roda também no Node.
import { confere, lerResposta, normal } from "../monetizacao-reunioes/avaliacao.ts";

export const VERSAO_REGUA = "script-v2-2026-10-09";

export type Execucao = "sim" | "parcial" | "nao";
export type Falante = "pre_venda" | "cliente";
export type Fala = { falante: Falante; texto: string; inicio_seg: number };
export type Sinal = "segue" | "nao_segue" | "sem_dado";

export const CREDITO: Readonly<Record<Execucao, number>> = { sim: 1, parcial: 0.5, nao: 0 };

// ---------------------------------------------------------------------------- o script v2

export const SCRIPT_ABERTURA =
  '"[NOME]? Aqui é o [SEU NOME], da equipe do [SÓCIO]. Te mandei um e-mail para falarmos sobre oportunidades ' +
  "financeiras. Você chegou a ver?\n\nBom, [NOME], enquanto o time do [SÓCIO] cuida da contabilidade de vocês, eu " +
  "conduzo uma frente à parte, de Inteligência Financeira. Como já conhecemos de perto os números da [EMPRESA], " +
  "queremos avaliar oportunidades financeiras que vão além da rotina contábil.\n\n[NOME], para iniciarmos uma " +
  'avaliação, vou te fazer algumas perguntas para entender o seu cenário, ok?"';
export const SCRIPT_PERGUNTAS_COMO =
  "A letra entre parênteses indica qual frente a resposta alimenta: (F) Finance, (J) Cella, (T) todas. Quando o " +
  'cliente responder só uma parte da pergunta, puxe o restante logo em seguida: "E sobre [parte que faltou]?"';
export const SCRIPT_FECHAMENTO_COMO =
  "Use a régua para decidir se há oportunidade. Não diga ao cliente qual é a frente específica: ela vai na " +
  "qualificação, para o sócio da área.";
export const SCRIPT_FECHAMENTO_SIM =
  '"Obrigado, [NOME]. Pelo que você me contou, enxergo oportunidades interessantes para a [EMPRESA]. O próximo ' +
  "passo é uma conversa com o [SÓCIO DA ÁREA], sócio líder da nossa área de Inteligência Financeira, que vai " +
  "aprofundar essa avaliação já com os números de vocês.\n\nConsigo [DIA] às [HORÁRIO 1] ou às [HORÁRIO 2]. Qual " +
  'fica melhor para vocês? Te mando o convite neste e-mail e incluo [NOME DO CONVIDADO], qual o e-mail dele?"';
export const SCRIPT_FECHAMENTO_NAO =
  '"Obrigado, [NOME]. Pelo que você me contou, hoje nenhuma das nossas frentes faz sentido para a [EMPRESA], ' +
  'porque [MOTIVO]. Se isso mudar, é só me chamar."';
export const SCRIPT_PRECO = '"Isso o sócio da área mostra com os seus números na conversa."';

export type Bloco = {
  chave: "abertura" | "perguntas" | "fechamento";
  titulo: string;
  peso: number;
  evidencias: string[];
};

export const BLOCOS: readonly Bloco[] = [
  {
    chave: "abertura",
    titulo: "Abertura",
    peso: 1,
    evidencias: [
      'Se apresenta pelo nome como da equipe do sócio ("Aqui é o [nome], da equipe do [sócio]")',
      "Cita o e-mail que mandou sobre oportunidades financeiras",
      "Diz que, enquanto o time do sócio cuida da contabilidade, conduz uma frente à parte, de Inteligência " +
        "Financeira, para avaliar oportunidades além da rotina contábil",
      "Pede licença para fazer algumas perguntas sobre o cenário da empresa",
    ],
  },
  { chave: "perguntas", titulo: "Perguntas", peso: 3, evidencias: [] },
  {
    chave: "fechamento",
    titulo: "Fechamento",
    peso: 2,
    evidencias: [
      "Agradece e diz se enxerga oportunidade para a empresa, sem dizer qual frente",
      "Com oportunidade: diz que o próximo passo é a conversa com o sócio da área (sócio líder da Inteligência " +
        "Financeira), que vai aprofundar com os números da empresa",
      "Com oportunidade: propõe dia e dois horários e pede o e-mail de quem mais deve ir ao convite",
      "Sem oportunidade: diz por que hoje nenhuma frente faz sentido e deixa a porta aberta",
    ],
  },
];

export type Pergunta = {
  chave: "momento" | "capital" | "porte" | "teses";
  titulo: string;
  frentes: ("T" | "F" | "J")[];
  fala: string;
  criterio: string;
};

export const PERGUNTAS: readonly Pergunta[] = [
  {
    chave: "momento",
    titulo: "Momento e investimento",
    frentes: ["T", "F"],
    fala:
      '"Como estão os planos da [EMPRESA] para os próximos 12 meses? Crescer, investir, segurar caixa? Se tem ' +
      'algum investimento ou necessidade de capital de giro no radar, onde seria e mais ou menos de quanto?"',
    criterio:
      "Pergunta pelos planos dos próximos 12 meses e por investimento ou capital de giro no radar (onde e quanto)",
  },
  {
    chave: "capital",
    titulo: "Estrutura de capital",
    frentes: ["F"],
    fala:
      '"E como está a estrutura de capital da empresa hoje? Vocês têm algum financiamento ou linha de crédito? ' +
      'Com quais bancos e a que custo, mais ou menos?"',
    criterio:
      "Pergunta se a empresa tem financiamento ou linha de crédito, com quais bancos e a que custo",
  },
  {
    chave: "porte",
    titulo: "Porte e regime",
    frentes: ["J", "T"],
    fala:
      '"Só para eu calibrar: o faturamento dos últimos 12 meses ficou em torno de [FATURAMENTO]? E vocês seguem no ' +
      '[REGIME]?"',
    criterio: "Confirma o faturamento dos últimos 12 meses ou o regime tributário da empresa",
  },
  {
    chave: "teses",
    titulo: "Teses na justiça",
    frentes: ["J"],
    fala: '"A empresa tem alguma ação tributária na justiça, com outro escritório? Sabe quais teses?"',
    criterio:
      "Pergunta se a empresa tem ação tributária na justiça, com outro escritório, e quais teses",
  },
];

export type Antipadrao = {
  chave: "disse_frente" | "falou_preco" | "prometeu_economia" | "socio_indicou_sem_confirmar";
  titulo: string;
  descricao: string;
};

export const ANTIPADROES: readonly Antipadrao[] = [
  {
    chave: "disse_frente",
    titulo: "Disse ao cliente qual é a frente específica",
    descricao:
      "O pré-vendedor diz ao cliente qual frente específica é a oportunidade dele (Finance, crédito bancário, " +
      "captação, Cella, tese tributária, ação judicial), em vez de deixar para o sócio da área",
  },
  {
    chave: "falou_preco",
    titulo: "Falou de preço, honorário, êxito ou prazo",
    descricao:
      "O pré-vendedor cita preço, honorário, percentual de êxito ou prazo, em vez de responder que o sócio da " +
      `área mostra com os números (${SCRIPT_PRECO})`,
  },
  {
    chave: "prometeu_economia",
    titulo: "Prometeu economia ou valor",
    descricao:
      "O pré-vendedor promete ou estima economia, crédito, valor a recuperar, taxa de juros ou ganho para a empresa",
  },
  {
    chave: "socio_indicou_sem_confirmar",
    titulo: "Disse que o sócio indicou ou falou com o cliente",
    descricao:
      "O pré-vendedor diz que o sócio da unidade indicou o contato ou já conversou com o cliente sobre a ligação. " +
      'Isso só vale com confirmação do sócio, que a gravação não mostra. "Da equipe do [sócio]" na abertura NÃO é ' +
      "este antipadrão",
  },
];

export type Frente = {
  frente: "finance" | "cella";
  nome: string;
  segue: string;
  nao_segue: string;
};

/** A régua do doc02_v2.py ("Régua: quando há oportunidade"). */
export const FRENTES: readonly Frente[] = [
  {
    frente: "finance",
    nome: "Finance",
    segue:
      "Fora do Simples e uma das três portas: capital de giro, troca de dívida cara ou investimento (perguntas 1 " +
      "ou 2), com valor aproximado. O corte de faturamento ainda está a confirmar com o Dárcio: não use faturamento " +
      "para dizer que não segue.",
    nao_segue:
      "Empresa grande com CFO que já acessa as linhas. Projeto fora do Centro-Oeste pedindo FCO. Nenhuma das três " +
      "portas na conversa.",
  },
  {
    frente: "cella",
    nome: "Cella",
    segue:
      "Faturamento a partir de R$ 25 milhões, fora do Simples, sem ação nas mesmas teses (perguntas 3 e 4).",
    nao_segue:
      "Teses já com outro escritório. Faturamento abaixo de R$ 25 milhões. Empresa no Simples.",
  },
];

// ---------------------------------------------------------------------------- prompt

const ROTULO_FALANTE: Record<Falante, string> = { pre_venda: "Pré-venda", cliente: "Cliente" };

/** As falas no formato que o modelo lê: "[mm:ss] Pré-venda: texto", uma por linha. */
export function transcricaoTexto(falas: readonly Fala[]): string {
  return falas
    .map((f) => {
      const s = Math.max(0, Number(f.inicio_seg) || 0);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(Math.floor(s % 60)).padStart(2, "0");
      return `[${mm}:${ss}] ${ROTULO_FALANTE[f.falante] ?? f.falante}: ${f.texto}`;
    })
    .join("\n");
}

/** O texto em que os trechos são conferidos: só as falas, sem rótulo nem minuto, normalizado. */
export function baseDaConferencia(falas: readonly Fala[]): string {
  return normal(falas.map((f) => f.texto).join(" "));
}

export function montarSystem(): string {
  const blocos = BLOCOS.filter((b) => b.chave !== "perguntas")
    .map(
      (b) =>
        `### ${b.titulo} (chave "${b.chave}")\nEvidências esperadas:\n${b.evidencias.map((e) => `  - ${e}`).join("\n")}`,
    )
    .join("\n\n");
  const perguntas = PERGUNTAS.map(
    (p, i) =>
      `${i + 1}. ${p.titulo} (chave "${p.chave}", frentes ${p.frentes.join(", ")})\n   Fala do script: ${p.fala}\n   Conta como feita: ${p.criterio}`,
  ).join("\n");
  const antipadroes = ANTIPADROES.map((a) => `- "${a.chave}": ${a.descricao}`).join("\n");
  const frentes = FRENTES.map(
    (f) => `- "${f.frente}" (${f.nome}). Segue quando: ${f.segue} Não segue quando: ${f.nao_segue}`,
  ).join("\n");
  return `Você é o gerente comercial da pré-venda do Caixa de Oportunidade da Planning (Departamento de Receitas). O
pré-vendedor liga para um cliente de contabilidade da rede, apresenta-se como "da equipe do [sócio]" da unidade e faz
uma ligação de qualificação de cerca de 10 minutos, lendo o SCRIPT abaixo literalmente. Se houver oportunidade, a
ligação termina com a conversa com o sócio da área de Inteligência Financeira marcada.

Você recebe a TRANSCRIÇÃO da ligação, separada em "Pré-venda" (quem ligou) e "Cliente" (quem atendeu). A separação
foi feita por IA e pode errar: identifique o pré-vendedor pelo conteúdo quando a etiqueta não bater.

Você faz DUAS coisas e NÃO dá nota:
A. Aderência: verificar se o pré-vendedor executou cada parte do script.
B. Qualificação: escrever, para o sócio da área, o que o cliente disse.

REGRAS CRÍTICAS:
1. Retorne APENAS JSON válido, sem markdown, sem texto antes ou depois.
2. Abertura e fechamento: "executou" é "sim" | "parcial" | "nao".
   - "sim": a maioria das evidências esperadas aparece. Não exija o texto palavra por palavra.
   - "parcial": a parte aconteceu de forma claramente incompleta.
   - "nao": a parte não aconteceu.
3. Toda parte "sim" ou "parcial", toda pergunta "feita": true, todo antipadrão e todo sinal de frente diferente de
   "sem_dado" EXIGEM "trecho": um trecho LITERAL da transcrição, copiado caractere por caractere, de 40 a 300
   caracteres, sem o minuto e sem o nome do falante. Não parafraseie e não junte falas. Se não consegue copiar um
   trecho que prove, a resposta é "nao", false, nenhum antipadrão ou "sem_dado".
4. Pergunta "feita": o pré-vendedor fez a pergunta (ou a maior parte dela), com essas ou outras palavras. Resposta que
   o cliente deu sem ser perguntado não conta como pergunta feita. O trecho é a fala do pré-vendedor.
5. Antipadrão é exceção. Na dúvida, não marque. O trecho é a fala do pré-vendedor que mostra o antipadrão.
6. Qualificação: escreva só o que o cliente disse na ligação. Dado inventado é pior que dado ausente. O que não foi
   dito fica de fora do resumo, e a frente sem resposta que decida fica "sem_dado".
7. Português do Brasil, frases curtas e diretas, sem emoji, sem travessão.

SCRIPT V2 (leitura literal)

1 · Abertura
${SCRIPT_ABERTURA}

2 · Perguntas
${SCRIPT_PERGUNTAS_COMO}
${PERGUNTAS.map((p) => `${p.titulo}: ${p.fala} (${p.frentes.join(", ")})`).join("\n")}

3 · Fechamento
${SCRIPT_FECHAMENTO_COMO}
Quando há oportunidade: ${SCRIPT_FECHAMENTO_SIM}
Quando não há: ${SCRIPT_FECHAMENTO_NAO}
Se o cliente perguntar preço, honorário, êxito ou prazo: ${SCRIPT_PRECO}

A. ADERÊNCIA

${blocos}

### Perguntas (uma a uma)
${perguntas}

### Antipadrões (use estas chaves)
${antipadroes}

B. QUALIFICAÇÃO PARA O SÓCIO DA ÁREA
- "resumo": o que o cliente respondeu em cada pergunta que foi feita (planos e investimento, crédito e bancos,
  faturamento e regime, ações na justiça), em 2 a 6 frases curtas, com os números que ele disse.
- "frentes": o sinal de cada frente pela régua abaixo: "segue", "nao_segue" ou "sem_dado", com o porquê em uma frase
  e o trecho literal do CLIENTE que sustenta o sinal (vazio quando "sem_dado").
${frentes}
- "quem_decide": quem decide na empresa, se o cliente disse; senão "não dito na ligação".
- "proximo_passo": o que ficou combinado (data e hora da conversa com o sócio, retorno, nada); senão "nenhum".

SCHEMA EXATO:
{
  "blocos": {
    "abertura": {"executou": "sim"|"parcial"|"nao", "trecho": "<literal ou vazio>", "nota_curta": "<uma frase>"},
    "fechamento": {"executou": "sim"|"parcial"|"nao", "trecho": "<literal ou vazio>", "nota_curta": "<uma frase>"}
  },
  "perguntas": {
    "momento": {"feita": true|false, "trecho": "<literal ou vazio>"},
    "capital": {"feita": true|false, "trecho": "<literal ou vazio>"},
    "porte": {"feita": true|false, "trecho": "<literal ou vazio>"},
    "teses": {"feita": true|false, "trecho": "<literal ou vazio>"}
  },
  "antipadroes": [{"chave": "disse_frente"|"falou_preco"|"prometeu_economia"|"socio_indicou_sem_confirmar",
                   "trecho": "<literal>"}],
  "qualificacao": {
    "resumo": "<texto>",
    "frentes": [{"frente": "finance", "sinal": "segue"|"nao_segue"|"sem_dado", "porque": "<uma frase>",
                 "trecho": "<literal ou vazio>"},
                {"frente": "cella", "sinal": "segue"|"nao_segue"|"sem_dado", "porque": "<uma frase>",
                 "trecho": "<literal ou vazio>"}],
    "quem_decide": "<texto>",
    "proximo_passo": "<texto>"
  }
}`;
}

export const mensagemUsuario = (transcricao: string) =>
  "TRANSCRIÇÃO DA LIGAÇÃO (separada por falante):\n\n" +
  transcricao +
  "\n\nRetorne apenas o JSON conforme o schema. Trecho é cópia LITERAL da transcrição.";

export { lerResposta };

// ---------------------------------------------------------------------------- apuração

export type BlocoApurado = {
  chave: Bloco["chave"];
  titulo: string;
  peso: number;
  executou: Execucao;
  /** A IA marcou sim ou parcial, mas o trecho não foi achado na transcrição. */
  rebaixado: boolean;
  trecho: string | null;
  nota_curta: string;
};
export type PerguntaApurada = {
  chave: Pergunta["chave"];
  titulo: string;
  frentes: Pergunta["frentes"];
  feita: boolean;
  rebaixada: boolean;
  trecho: string | null;
};
export type AntipadraoApurado = { chave: Antipadrao["chave"]; titulo: string; trecho: string };
export type FrenteApurada = {
  frente: Frente["frente"];
  sinal: Sinal;
  porque: string;
  trecho: string | null;
};
export type Avaliacao = {
  blocos: BlocoApurado[];
  perguntas: PerguntaApurada[];
  antipadroes: AntipadraoApurado[];
  qualificacao: {
    resumo: string;
    frentes: FrenteApurada[];
    quem_decide: string;
    proximo_passo: string;
  };
  oportunidade: "sim" | "nao" | "sem_dado";
};

const EXECUCOES: readonly Execucao[] = ["sim", "parcial", "nao"];
const SINAIS: readonly Sinal[] = ["segue", "nao_segue", "sem_dado"];
const texto = (v: unknown, max = 1500) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const umaCasa = (x: number) => Math.round(x * 10) / 10;

/** Bloco "perguntas": ≥ 3 de 4 = sim, 1 ou 2 = parcial, 0 = não (contrato da tela). */
export function execucaoDasPerguntas(feitas: number): Execucao {
  return feitas >= 3 ? "sim" : feitas >= 1 ? "parcial" : "nao";
}

/**
 * Nota = 100 × (abertura×1 + (perguntas feitas ÷ 4)×3 + fechamento×2) ÷ 6, com sim = 1, parcial = 0,5 e não = 0.
 * Uma casa decimal. Antipadrão não desconta.
 */
export function calcularNota(abertura: Execucao, feitas: number, fechamento: Execucao): number {
  const n = Math.max(0, Math.min(PERGUNTAS.length, feitas));
  return umaCasa(
    (100 * (CREDITO[abertura] * 1 + (n / PERGUNTAS.length) * 3 + CREDITO[fechamento] * 2)) / 6,
  );
}

/** A resposta do modelo, conferida contra a transcrição. Tudo o que não tem trecho achado cai. */
export function apurar(
  resposta: any,
  falas: readonly Fala[],
): { avaliacao: Avaliacao; nota: number } {
  const base = baseDaConferencia(falas);
  const r = resposta && typeof resposta === "object" ? resposta : {};
  const parte = (chave: "abertura" | "fechamento"): BlocoApurado => {
    const b = BLOCOS.find((x) => x.chave === chave)!;
    const x = (r.blocos || {})[chave] || {};
    const ex: Execucao = EXECUCOES.includes(x.executou) ? x.executou : "nao";
    const ok = ex === "nao" || confere(x.trecho, base);
    return {
      chave,
      titulo: b.titulo,
      peso: b.peso,
      executou: ok ? ex : "nao",
      rebaixado: !ok,
      trecho: ok && ex !== "nao" ? texto(x.trecho, 400) || null : null,
      nota_curta: ok
        ? texto(x.nota_curta, 300)
        : "A IA citou um trecho que não está na transcrição.",
    };
  };
  const perguntas: PerguntaApurada[] = PERGUNTAS.map((p) => {
    const x = (r.perguntas || {})[p.chave] || {};
    const disse = x.feita === true;
    const ok = disse && confere(x.trecho, base);
    return {
      chave: p.chave,
      titulo: p.titulo,
      frentes: [...p.frentes],
      feita: ok,
      rebaixada: disse && !ok,
      trecho: ok ? texto(x.trecho, 400) : null,
    };
  });
  const feitas = perguntas.filter((p) => p.feita).length;
  const abertura = parte("abertura");
  const fechamento = parte("fechamento");
  const blocoPerguntas: BlocoApurado = {
    chave: "perguntas",
    titulo: "Perguntas",
    peso: 3,
    executou: execucaoDasPerguntas(feitas),
    rebaixado: false,
    trecho: null,
    nota_curta: `${feitas} de ${PERGUNTAS.length}`,
  };
  const vistos = new Set<string>();
  const antipadroes: AntipadraoApurado[] = [];
  for (const a of Array.isArray(r.antipadroes) ? r.antipadroes : []) {
    const def = ANTIPADROES.find((x) => x.chave === a?.chave);
    if (!def || vistos.has(def.chave) || !confere(a?.trecho, base)) continue;
    vistos.add(def.chave);
    antipadroes.push({ chave: def.chave, titulo: def.titulo, trecho: texto(a.trecho, 400) });
  }
  const q = r.qualificacao && typeof r.qualificacao === "object" ? r.qualificacao : {};
  const frentes: FrenteApurada[] = FRENTES.map((f) => {
    const x =
      (Array.isArray(q.frentes) ? q.frentes : []).find((y: any) => y?.frente === f.frente) || {};
    const sinal: Sinal = SINAIS.includes(x.sinal) ? x.sinal : "sem_dado";
    if (sinal !== "sem_dado" && !confere(x.trecho, base))
      return {
        frente: f.frente,
        sinal: "sem_dado",
        porque: `A IA marcou "${sinal === "segue" ? "segue" : "não segue"}", mas o trecho citado não está na transcrição.`,
        trecho: null,
      };
    return {
      frente: f.frente,
      sinal,
      porque: texto(x.porque, 400) || (sinal === "sem_dado" ? "O cliente não deu o dado." : ""),
      trecho: sinal === "sem_dado" ? null : texto(x.trecho, 400),
    };
  });
  const oportunidade = frentes.some((f) => f.sinal === "segue")
    ? "sim"
    : frentes.every((f) => f.sinal === "nao_segue")
      ? "nao"
      : "sem_dado";
  return {
    avaliacao: {
      blocos: [abertura, blocoPerguntas, fechamento],
      perguntas,
      antipadroes,
      qualificacao: {
        resumo: texto(q.resumo, 1500),
        frentes,
        quem_decide: texto(q.quem_decide, 300) || "não dito na ligação",
        proximo_passo: texto(q.proximo_passo, 300) || "nenhum",
      },
      oportunidade,
    },
    nota: calcularNota(abertura.executou, feitas, fechamento.executou),
  };
}
