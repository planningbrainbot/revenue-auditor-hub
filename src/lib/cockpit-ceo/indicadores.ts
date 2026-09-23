// Os números da primeira fatia do Cockpit do CEO, calculados sobre Base de clientes e Monetização.
//
// Nada aqui redefine regra de negócio: elegibilidade é `oferta()`, disponibilidade e procedência
// são `estadoProduto()`/`soNoOmie()`, eventos comerciais são `operacao()`, receita prevista é
// `receitaSomada()`. O cockpit agrega, explica e aponta para a tela de origem; se uma dessas regras
// mudar, o cockpit muda junto, sem um segundo cálculo para divergir.
//
// Funções puras: o mesmo recorte e a mesma fotografia devolvem os mesmos números, que é o que
// permite o clique no número conferir com a composição.
import { LIMITE_CARGA_PARADA_MS, operacao, receitaSomada, uteis } from "../monetizacao/model.ts";
import { estadoProduto } from "../monetizacao/portfolio.ts";
import { NOMES, PRODUTOS } from "../monetizacao/types.ts";
import type { BaseMonetizacao, Conta, Metrica, Plano, Produto } from "../monetizacao/types";
import type {
  Comparacao,
  Destino,
  Estado,
  IdIndicador,
  Indicador,
  LinhaComposicao,
} from "./contrato.ts";
import { PERGUNTAS } from "./perguntas.ts";
import { dataBr, mesDoPeriodo, periodoAnterior } from "./periodo.ts";
import type { Periodo } from "./periodo.ts";

export const VERSAO_REGRA = "2026-09-22";

export interface FonteCockpit {
  /** Fonte sintética do preview. Tudo o que sai dela é marcado como tal. */
  sintetico: boolean;
  hoje: string;
  agora: string;
  /** A pessoa pode ler a Base de clientes (view.aquario ou view.clientes). */
  acessoBase: boolean;
  /**
   * A pessoa pode ler os negócios (view.aquario ou view.monetizacao, pela RLS de
   * ops.monetizacao_deals). Sem eles a disponibilidade de uma conta não pode ser conferida.
   */
  acessoNegocios: boolean;
  monetizacao: {
    /** `sem_acesso`: nenhuma chave de Base ou Monetização; a carga nem é montada. */
    estado: "ok" | "erro" | "carregando" | "sem_acesso";
    erro: string | null;
    dados: BaseMonetizacao | null;
  };
}

export interface RecorteCockpit {
  periodo: Periodo;
  /** "" = rede inteira no escopo da pessoa; senão, a chave da unidade. */
  perimetro: string;
}

export interface Decisao {
  id: string;
  titulo: string;
  porque: string;
  responsavel: string;
  destino: Destino | null;
}

export interface Ameaca {
  id: string;
  titulo: string;
  detalhe: string;
  gravidade: "alta" | "media";
  indicador: IdIndicador | null;
}

export interface LinhaProduto {
  produto: Produto | "sem_produto";
  rotulo: string;
  trabalhados: number | null;
  validadas: number | null;
  ganhos: number | null;
  receitaPrevista: number | null;
  semReceita: number | null;
  contasProntas: number | null;
}

export interface PontoDiario {
  date: string;
  label: string;
  started: number;
  scheduled: number;
  meeting: number;
}

export interface Cockpit {
  sintetico: boolean;
  universo: string;
  perimetroRotulo: string;
  perimetros: { chave: string; rotulo: string }[];
  indicadores: Indicador[];
  decisoes: Decisao[];
  ameacas: Ameaca[];
  porProduto: LinhaProduto[];
  serieDiaria: PontoDiario[] | null;
  avisos: string[];
}

const pergunta = (id: string) => PERGUNTAS.find((p) => p.id === id)?.texto ?? "";
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const FONTE_CRM =
  "Monetização · negócios do pipe de Monetização no CRM, carregados pelo Brain (eventos pelo ator e data do evento)";
const FONTE_BASE =
  "Base de clientes · catálogo conciliado do Brain com a régua de cada produto (Consultoria, Finance, Cella)";

type EstadoFonte = { estado: Estado; dataDado: string | null; nota: string | null };

const SEM_ACESSO: EstadoFonte = {
  estado: "acesso_insuficiente",
  dataDado: null,
  nota: "Seu acesso não inclui Base de clientes nem Monetização. Sem permissão não é o mesmo que nenhum registro.",
};
const parada = (f: FonteCockpit, quando: string) =>
  Date.parse(f.agora) - Date.parse(quando) > LIMITE_CARGA_PARADA_MS;

function estadoComercial(f: FonteCockpit): EstadoFonte {
  const m = f.monetizacao;
  if (m.estado === "sem_acesso") return SEM_ACESSO;
  if (m.estado === "carregando")
    return { estado: "fonte_indisponivel", dataDado: null, nota: "Carga em andamento." };
  if (m.estado === "erro" || !m.dados)
    return {
      estado: "fonte_indisponivel",
      dataDado: null,
      nota: m.erro ?? "A carga de Monetização falhou.",
    };
  const d = m.dados;
  if (!d.permissions.view)
    return {
      estado: "acesso_insuficiente",
      dataDado: null,
      nota: "Seu acesso não inclui Monetização (view.monetizacao). Sem permissão não é o mesmo que nenhum negócio.",
    };
  if (!d.measured_at)
    return {
      estado: "fonte_indisponivel",
      dataDado: null,
      nota: "O CRM ainda não teve uma carga de indicadores concluída.",
    };
  // Mesmo limite da barra de frescor da Monetização: carga com mais de 30 minutos está parada.
  if (d.sync_error || parada(f, d.measured_at))
    return {
      estado: "parcial",
      dataDado: d.measured_at,
      nota: `Indicadores comerciais parados desde ${dataHora(d.measured_at)}${d.sync_error ? "; a última atualização falhou" : ""}. O número vale até essa data.`,
    };
  return { estado: "disponivel", dataDado: d.measured_at, nota: null };
}

function estadoBase(f: FonteCockpit): EstadoFonte {
  const m = f.monetizacao;
  if (m.estado === "sem_acesso") return SEM_ACESSO;
  if (m.estado !== "ok" || !m.dados)
    return {
      estado: "fonte_indisponivel",
      dataDado: null,
      nota:
        m.estado === "carregando" ? "Carga em andamento." : (m.erro ?? "A carga da Base falhou."),
    };
  if (!f.acessoBase)
    return {
      estado: "acesso_insuficiente",
      dataDado: null,
      nota: "Seu acesso não inclui a Base de clientes. Sem permissão não é o mesmo que nenhuma conta.",
    };
  if (!m.dados.catalog_at)
    return {
      estado: "fonte_indisponivel",
      dataDado: null,
      nota: "Catálogo da base sem carga concluída.",
    };
  if (!f.acessoNegocios)
    return {
      estado: "acesso_insuficiente",
      dataDado: null,
      nota: "A disponibilidade de uma conta depende dos negócios do CRM, que seu acesso não lê (view.aquario ou view.monetizacao). Sem eles toda conta apta pareceria livre.",
    };
  if (parada(f, m.dados.catalog_at))
    return {
      estado: "parcial",
      dataDado: m.dados.catalog_at,
      nota: `Catálogo da base parado desde ${dataHora(m.dados.catalog_at)}. O número vale até essa data.`,
    };
  return { estado: "disponivel", dataDado: m.dados.catalog_at, nota: null };
}

const temNumero = (e: Estado) => e === "disponivel" || e === "parcial";

export function montarCockpit(fonte: FonteCockpit, recorte: RecorteCockpit): Cockpit {
  const avisos: string[] = [];
  if (fonte.sintetico)
    avisos.push("Dados sintéticos do piloto: nenhum número desta tela descreve o negócio real.");
  const dados = fonte.monetizacao.estado === "ok" ? fonte.monetizacao.dados : null;
  if (fonte.monetizacao.estado === "erro" && fonte.monetizacao.erro)
    avisos.push(fonte.monetizacao.erro);

  // ── Perímetro ──────────────────────────────────────────────────────────
  const unidades = dados?.units ?? [];
  let unidade = recorte.perimetro ? unidades.find((u) => u.key === recorte.perimetro) : undefined;
  if (recorte.perimetro && !unidade && dados) {
    avisos.push("Unidade não encontrada no seu escopo; mostrando a rede inteira.");
    unidade = undefined;
  }
  const perimetroRotulo = unidade ? unidade.name : "Rede inteira no seu escopo";
  const chavesDaUnidade = new Set(unidade?.account_keys ?? []);
  const contas: Conta[] = dados
    ? unidade
      ? dados.accounts.filter((a) => chavesDaUnidade.has(a.key))
      : dados.accounts
    : [];
  const chavesComUnidade = new Set(unidades.flatMap((u) => u.account_keys));
  const orgsDaBase = new Set((dados?.accounts ?? []).flatMap((a) => a.orgs));
  const orgsComUnidade = new Set(
    (dados?.accounts ?? []).filter((a) => chavesComUnidade.has(a.key)).flatMap((a) => a.orgs),
  );
  const orgsDoPerimetro = new Set(contas.flatMap((a) => a.orgs));
  const todos = dados?.cards ?? [];
  const negocios = unidade
    ? todos.filter((c) => c.org_id !== null && orgsDoPerimetro.has(c.org_id))
    : todos;
  // O que um recorte por unidade não alcança: negócio sem conta e negócio de conta sem unidade.
  const semConta = todos.filter((c) => c.org_id === null || !orgsDaBase.has(c.org_id));
  const semUnidade = todos.filter(
    (c) => c.org_id !== null && orgsDaBase.has(c.org_id) && !orgsComUnidade.has(c.org_id),
  );
  const foraDoRecorte = (sc: number, su: number, verbo: string) => {
    const partes = [
      sc ? plural(sc, "negócio sem conta vinculada", "negócios sem conta vinculada") : null,
      su ? plural(su, "negócio de conta sem unidade", "negócios de contas sem unidade") : null,
    ].filter(Boolean);
    return partes.length
      ? `${partes.join(" e ")} ${verbo} e ficaram fora do recorte por unidade.`
      : null;
  };

  const p = recorte.periodo;
  const filtros = [
    `Período: ${p.rotulo}`,
    `Perímetro: ${perimetroRotulo}`,
    "Todos os responsáveis",
    "Todos os produtos",
  ];
  const comercial = estadoComercial(fonte);
  const base = estadoBase(fonte);
  const sintetico = fonte.sintetico;
  const comum = {
    versaoRegra: VERSAO_REGRA,
    perimetro: perimetroRotulo,
    filtros,
    dataApuracao: fonte.agora,
    sintetico,
  };

  // ── Eventos comerciais ────────────────────────────────────────────────
  const filtro = { from: p.de, to: p.ate, owner: null, product: "" as const };
  const anterior = periodoAnterior(p);
  const op = temNumero(comercial.estado) ? operacao(negocios, filtro) : null;
  const opAnterior = temNumero(comercial.estado)
    ? operacao(negocios, { ...filtro, from: anterior.de, to: anterior.ate })
    : null;
  const opSemConta = unidade && temNumero(comercial.estado) ? operacao(semConta, filtro) : null;
  const opSemUnidade = unidade && temNumero(comercial.estado) ? operacao(semUnidade, filtro) : null;
  const mes = mesDoPeriodo(p);
  const planosDoMes: Plano[] = mes ? (dados?.plans ?? []).filter((pl) => pl.month === mes.mes) : [];

  const destinoOperacao: Destino = {
    rota: "/monetizacao",
    search: { aba: "operacao" },
    rotulo: "Abrir Operação diária (Monetização)",
    mesmoRecorte: false,
    observacao:
      "A Operação abre no mês corrente e com o responsável padrão dela. Ajuste período e responsável lá para conferir este número; o cockpit conta a frente inteira.",
  };

  function comparacaoAnterior(m: Metrica): Comparacao {
    return {
      rotulo: `Período anterior (${dataBr(anterior.de)} a ${dataBr(anterior.ate)})`,
      referencia: opAnterior ? opAnterior.rows[m].length : null,
      estado: comercial.estado,
      nota: "Mesmo número de dias, imediatamente antes. Comparação de eventos, não de coorte.",
    };
  }

  function comparacaoPlano(
    rotulo: string,
    valorDoPlano: (pl: Plano) => number,
    unidadeDoPlano: string,
    ritmo: { rotulo: string; nota: string },
  ): Comparacao[] {
    if (unidade)
      return [
        {
          rotulo,
          referencia: null,
          estado: "nao_apurado",
          nota: "O plano de Monetização é por responsável, não por unidade.",
        },
      ];
    if (!mes)
      return [
        {
          rotulo,
          referencia: null,
          estado: "nao_apurado",
          nota: "O plano é mensal: escolha um período dentro de um mês para comparar.",
        },
      ];
    if (!planosDoMes.length)
      return [
        {
          rotulo,
          referencia: null,
          estado: "nao_apurado",
          nota: `Nenhum plano cadastrado para ${mes.mes.slice(5, 7)}/${mes.mes.slice(0, 4)}.`,
        },
      ];
    const total = planosDoMes.reduce((s, pl) => s + (valorDoPlano(pl) || 0), 0);
    const saida: Comparacao[] = [
      {
        rotulo,
        referencia: total,
        estado: "disponivel",
        nota: `Soma do plano cadastrado para o mês (${plural(planosDoMes.length, "responsável", "responsáveis")}). O realizado conta a frente inteira. ${unidadeDoPlano}`,
      },
    ];
    if (!mes.completo) {
      const fimDoMes = new Date(
        Date.UTC(Number(mes.mes.slice(0, 4)), Number(mes.mes.slice(5, 7)), 0),
      )
        .toISOString()
        .slice(0, 10);
      const esperado = (total * uteis(p.de, p.ate)) / Math.max(1, uteis(p.de, fimDoMes));
      saida.push({
        rotulo: ritmo.rotulo,
        referencia: Math.round(esperado * 10) / 10,
        estado: "disponivel",
        nota: ritmo.nota,
      });
    }
    return saida;
  }

  function indicadorDeEvento(
    id: IdIndicador,
    m: Metrica,
    titulo: string,
    definicao: string,
    idPergunta: string,
    plano: Comparacao[],
  ): Indicador {
    const valor = op ? op.rows[m].length : null;
    const composicao: LinhaComposicao[] = op
      ? [...PRODUTOS, "sem_produto" as const].map((prod) => ({
          chave: "produto:" + prod,
          rotulo: NOMES[prod],
          valor: op.rows[m].filter((c) => c.route === prod).length,
          soma: true,
        }))
      : [];
    const notas: string[] = [];
    if (comercial.nota) notas.push(comercial.nota);
    if (opSemConta && opSemUnidade) {
      const fora = foraDoRecorte(
        opSemConta.rows[m].length,
        opSemUnidade.rows[m].length,
        "tiveram este evento no período",
      );
      if (fora) notas.push(fora);
    }
    notas.push("Cada negócio conta uma vez; o produto é o atual do negócio.");
    return {
      ...comum,
      id,
      frente: "comercial",
      pergunta: pergunta(idPergunta),
      titulo,
      definicao,
      unidade: "negócios",
      periodo: { de: p.de, ate: p.ate },
      fonte: FONTE_CRM,
      dataDado: comercial.dataDado,
      estado: comercial.estado,
      valor,
      comparacoes: temNumero(comercial.estado) ? [comparacaoAnterior(m), ...plano] : [],
      composicao,
      notaComposicao: notas.join(" "),
      destino: destinoOperacao,
      lacuna:
        comercial.estado === "acesso_insuficiente"
          ? {
              oQueFalta: "Permissão de leitura de Monetização.",
              responsavel: "Administração do Brain",
              acao: "Conceder a área Monetização, se couber ao papel.",
            }
          : null,
    };
  }

  const contratos = indicadorDeEvento(
    "contratos-ganhos",
    "signed",
    "Contratos ganhos no CRM",
    "Negócios do pipe de Monetização marcados como ganhos no período (data do ganho no fuso de São Paulo). Ganho no CRM não é contrato assinado nem receita recebida.",
    "E1",
    comparacaoPlano("Meta do mês", (pl) => pl.target_contracts, "Meta de contratos.", {
      rotulo: "Ritmo esperado da meta",
      nota: "Meta do mês proporcional aos dias úteis decorridos. É conta sobre a meta, não previsão.",
    }),
  );
  const validadas = indicadorDeEvento(
    "oportunidades-validadas",
    "validated",
    "Oportunidades validadas",
    "Negócios que entraram pela primeira vez em Negociação ou etapa superior no período. Reciclado não valida.",
    "E3",
    [],
  );
  const trabalhados = indicadorDeEvento(
    "leads-trabalhados",
    "started",
    "Leads trabalhados",
    "Negócios com primeiro trabalho registrado no período, atribuído ao ator do evento.",
    "E2",
    comparacaoPlano("Capacidade do mês", (pl) => pl.capacity, "Capacidade de leads.", {
      rotulo: "Ritmo esperado da capacidade",
      nota: "Capacidade do mês proporcional aos dias úteis decorridos. É conta sobre o plano, não previsão.",
    }),
  );

  // ── Receita prevista declarada no CRM ─────────────────────────────────
  const abertoValidado = (c: (typeof todos)[number]) => c.status === "open" && !!c.validated_at;
  const abertosValidados = negocios.filter(abertoValidado);
  const soma = temNumero(comercial.estado) ? receitaSomada(abertosValidados) : null;
  const porProdutoReceita = (prod: Produto | "sem_produto") =>
    receitaSomada(abertosValidados.filter((c) => c.route === prod));
  const receitaEstado: Estado = !soma
    ? comercial.estado
    : soma.known === 0 && soma.missing > 0
      ? "nao_apurado"
      : soma.missing > 0
        ? "parcial"
        : comercial.estado;
  const receitaComposicao: LinhaComposicao[] = soma
    ? [
        ...[...PRODUTOS, "sem_produto" as const].flatMap((prod) => {
          const r = porProdutoReceita(prod);
          if (!r.known && !r.missing) return [];
          return [
            r.known
              ? {
                  chave: "produto:" + prod,
                  rotulo: `${NOMES[prod]} · declarado`,
                  valor: r.total,
                  soma: true,
                  observacao: r.missing
                    ? `${plural(r.missing, "negócio", "negócios")} sem valor`
                    : undefined,
                }
              : {
                  chave: "produto:" + prod,
                  rotulo: `${NOMES[prod]} · sem valor declarado`,
                  valor: null,
                  observacao: `${plural(r.missing, "negócio", "negócios")} sem valor`,
                },
          ];
        }),
        { chave: "partners", rotulo: "Parcela Partners declarada", valor: soma.partners },
        { chave: "unidade", rotulo: "Parcela da unidade declarada", valor: soma.unit },
        {
          chave: "conhecidos",
          rotulo: "Negócios com valor declarado",
          valor: soma.known,
          unidade: "negócios",
        },
        {
          chave: "faltante",
          rotulo: "Negócios sem valor ou com moeda divergente",
          valor: soma.missing,
          unidade: "negócios",
        },
      ]
    : [];
  const receita: Indicador = {
    ...comum,
    id: "receita-prevista-aberta",
    frente: "receita",
    pergunta: pergunta("R4"),
    titulo: "Receita prevista em oportunidades abertas",
    definicao:
      "Soma do campo de receita prevista total do CRM nos negócios abertos que já tiveram oportunidade validada. É valor declarado pelo comercial: não é faturamento, não é recebimento e não entra na conta da meta sem conciliação.",
    unidade: "reais",
    periodo: null,
    fonte: FONTE_CRM,
    dataDado: comercial.dataDado,
    estado: receitaEstado,
    valor: soma && !(soma.known === 0 && soma.missing > 0) ? soma.total : null,
    comparacoes: [],
    composicao: receitaComposicao,
    notaComposicao: [
      comercial.nota,
      unidade && soma
        ? foraDoRecorte(
            semConta.filter(abertoValidado).length,
            semUnidade.filter(abertoValidado).length,
            "estão abertos e validados",
          )
        : null,
      "Fotografia de agora: o período filtrado não se aplica. Nulo não vira zero; moedas diferentes não são somadas.",
      "Pipeline, capacidade e contratos firmes podem conter os mesmos negócios: não somar com outras previsões.",
    ]
      .filter(Boolean)
      .join(" "),
    destino: {
      rota: "/monetizacao",
      search: { aba: "temporal" },
      rotulo: "Abrir Temporal e previsão",
      mesmoRecorte: false,
      observacao: "A tela de origem aplica o filtro de responsável dela; confira o recorte lá.",
    },
    lacuna:
      receitaEstado === "parcial" || receitaEstado === "nao_apurado"
        ? {
            oQueFalta: "Receita prevista preenchida em todos os negócios validados.",
            responsavel: "Comercial (closer do negócio)",
            acao: "Preencher os três campos monetários do CRM.",
          }
        : null,
  };

  // ── Base: contas prontas para trabalhar ───────────────────────────────
  const baseComNumero = temNumero(base.estado) && dados;
  const estados = baseComNumero
    ? contas.map((a) => ({
        a,
        e: Object.fromEntries(
          PRODUTOS.map((prod) => [prod, estadoProduto(a, prod, dados!)]),
        ) as Record<Produto, ReturnType<typeof estadoProduto>>,
      }))
    : [];
  const prontasPor = (prod: Produto) => estados.filter((x) => x.e[prod].situacao === "free").length;
  const qtdProntas = (x: (typeof estados)[number]) =>
    PRODUTOS.filter((prod) => x.e[prod].situacao === "free").length;
  const unicas = estados.filter((x) => qtdProntas(x) > 0).length;
  const sobrepostas = estados.filter((x) => qtdProntas(x) > 1).length;
  // `so_omie` já é a situação de quem a régua aprova e só entrou pelo ERP (soNoOmie).
  const soOmie = estados.filter((x) =>
    PRODUTOS.some((prod) => x.e[prod].situacao === "so_omie"),
  ).length;
  const ocupadas = estados.filter(
    (x) => qtdProntas(x) === 0 && PRODUTOS.some((prod) => x.e[prod].situacao === "occupied"),
  ).length;
  const somaProdutos = PRODUTOS.reduce((s, prod) => s + prontasPor(prod), 0);
  const prontas: Indicador = {
    ...comum,
    id: "contas-prontas",
    frente: "clientes",
    pergunta: pergunta("C2"),
    titulo: "Contas prontas para trabalhar",
    definicao:
      "Contas únicas aptas pela régua de ao menos um produto e livres agora (sem negócio aberto, reserva ou carga no mês). Contas, não clientes ativos: a régua do produto não pergunta se a empresa é cliente.",
    unidade: "contas",
    periodo: null,
    fonte: FONTE_BASE,
    dataDado: base.dataDado,
    estado: base.estado,
    valor: baseComNumero ? unicas : null,
    comparacoes: [],
    composicao: baseComNumero
      ? [
          ...PRODUTOS.map((prod) => ({
            chave: "produto:" + prod,
            rotulo: `${NOMES[prod]} · prontas`,
            valor: prontasPor(prod),
          })),
          {
            chave: "um_produto",
            rotulo: "Contas prontas em um produto",
            valor: unicas - sobrepostas,
            soma: true,
          },
          {
            chave: "varios_produtos",
            rotulo: "Contas prontas em dois ou mais produtos",
            valor: sobrepostas,
            soma: true,
          },
          { chave: "sobreposicao", rotulo: "Sobreposição (contam uma vez)", valor: sobrepostas },
          {
            chave: "so_omie",
            rotulo: "Aptas pela régua, só no cadastro do Omie (fora da conta)",
            valor: soOmie,
            observacao: "O ERP da unidade também cadastra fornecedores.",
          },
          {
            chave: "ocupadas",
            rotulo: "Aptas já em trabalho ou reservadas (fora da conta)",
            valor: ocupadas,
          },
        ]
      : [],
    notaComposicao: [
      base.nota,
      baseComNumero && somaProdutos !== unicas
        ? `A soma por produto (${somaProdutos}) é maior que as contas únicas (${unicas}) porque ${plural(sobrepostas, "conta aparece", "contas aparecem")} em mais de um produto.`
        : baseComNumero
          ? "Nenhuma conta aparece em mais de um produto neste recorte."
          : null,
      "Fotografia de agora: o período filtrado não se aplica e não há histórico de disponibilidade. Recon tem régua própria e fica fora desta conta.",
    ]
      .filter(Boolean)
      .join(" "),
    destino: {
      rota: "/clientes",
      search: unidade ? { view: "monetizacao", unidade: unidade.key } : { view: "monetizacao" },
      rotulo: "Abrir Base de clientes",
      mesmoRecorte: false,
      observacao:
        'A Base recebe a unidade; o produto e a situação "Prontas para enviar" se escolhem lá, com a mesma régua.',
    },
    lacuna:
      base.estado === "acesso_insuficiente"
        ? {
            oQueFalta: "Permissão de leitura da Base de clientes.",
            responsavel: "Administração do Brain",
            acao: "Conceder a área Base de clientes, se couber ao papel.",
          }
        : null,
  };

  // ── Meta de R$ 1 bi ───────────────────────────────────────────────────
  const meta: Indicador = {
    ...comum,
    id: "meta-bilhao",
    frente: "receita",
    pergunta: pergunta("R1"),
    titulo: "Faturamento anual × meta de R$ 1 bi",
    definicao:
      "Faturamento anual a terceiros das entidades do perímetro aprovado, comparado à meta de R$ 1 bilhão por ano. Não é valuation, volume transacionado, faturamento da rede nem receita Partners.",
    unidade: "reais",
    periodo: null,
    perimetro: "Perímetro da meta ainda não definido",
    fonte: "Nenhuma fonte homologada de faturamento consolidado",
    dataDado: null,
    estado: "nao_apurado",
    valor: null,
    comparacoes: [
      {
        rotulo: "Meta anual",
        referencia: 1_000_000_000,
        estado: "disponivel",
        nota: "Meta informada pelo CEO. Ano-alvo não definido: não há data para o gap.",
      },
    ],
    composicao: [],
    notaComposicao:
      "Sem perímetro e sem faturamento conciliado não existe gap calculável. Os valores que circularam em documentos anteriores são fotografias históricas e não entram aqui.",
    destino: {
      rota: "/financeiro",
      search: {},
      externo: true,
      rotulo: "Abrir Brain Financeiro",
      mesmoRecorte: false,
      observacao:
        "O Financeiro mostra DRE e caixa por empresa do grupo; não é o faturamento do perímetro da meta.",
    },
    lacuna: {
      oQueFalta: "Perímetro, ano-alvo e faturamento de 12 meses conciliado.",
      responsavel: "CEO + CFO",
      acao: "Definir perímetro e ano-alvo; homologar a fonte de faturamento (F02, F11).",
    },
  };

  const indicadores = [meta, contratos, validadas, trabalhados, receita, prontas];

  // ── De onde vem o crescimento: por produto ────────────────────────────
  const porProduto: LinhaProduto[] = [...PRODUTOS, "sem_produto" as const].map((prod) => {
    const r = soma ? porProdutoReceita(prod) : null;
    return {
      produto: prod,
      rotulo: NOMES[prod],
      trabalhados: op ? op.rows.started.filter((c) => c.route === prod).length : null,
      validadas: op ? op.rows.validated.filter((c) => c.route === prod).length : null,
      ganhos: op ? op.rows.signed.filter((c) => c.route === prod).length : null,
      // Sem negócio aberto validado no produto é zero de verdade; traço só quando há negócio sem valor.
      receitaPrevista: !r ? null : r.known ? r.total : r.missing ? null : 0,
      semReceita: r ? r.missing : null,
      contasProntas: prod === "sem_produto" || !baseComNumero ? null : prontasPor(prod),
    };
  });

  // ── Ameaças: regras determinísticas sobre os mesmos números ───────────
  const ameacas: Ameaca[] = [];
  if (comercial.estado === "parcial")
    ameacas.push({
      id: "crm-parado",
      titulo: "Indicadores comerciais desatualizados",
      detalhe: comercial.nota ?? "",
      gravidade: "alta",
      indicador: "contratos-ganhos",
    });
  const ritmo = contratos.comparacoes.find((c) => c.rotulo === "Ritmo esperado da meta");
  if (
    comercial.estado === "disponivel" &&
    ritmo?.referencia != null &&
    contratos.valor != null &&
    contratos.valor < ritmo.referencia
  )
    ameacas.push({
      id: "ritmo-contratos",
      titulo: "Contratos ganhos abaixo do ritmo da meta",
      detalhe: `${contratos.valor} ganhos contra ${String(ritmo.referencia).replace(".", ",")} esperados até ${dataBr(p.ate)} pela meta do mês.`,
      gravidade: "alta",
      indicador: "contratos-ganhos",
    });
  const planoAtual = (dados?.plans ?? []).filter((pl) => pl.month === fonte.hoje.slice(0, 7));
  const semAlocacao =
    planoAtual.length > 0 &&
    planoAtual.every((pl) => PRODUTOS.every((prod) => !(pl.allocation?.[prod] > 0)));
  if (semAlocacao)
    ameacas.push({
      id: "plano-sem-alocacao",
      titulo: "Plano do mês sem alocação por produto",
      detalhe:
        "A capacidade está cadastrada, mas nenhum lead foi alocado a Cella, Consultoria ou Finance: não há previsão por produto.",
      gravidade: "media",
      indicador: "leads-trabalhados",
    });
  if (soma && soma.missing > 0)
    ameacas.push({
      id: "receita-incompleta",
      titulo: "Receita prevista incompleta",
      detalhe: `${plural(soma.missing, "negócio validado aberto está", "negócios validados abertos estão")} sem receita prevista declarada ou com moeda divergente.`,
      gravidade: "media",
      indicador: "receita-prevista-aberta",
    });
  const validAnterior = validadas.comparacoes[0]?.referencia;
  if (validadas.valor != null && validAnterior != null && validadas.valor < validAnterior)
    ameacas.push({
      id: "validadas-em-queda",
      titulo: "Menos oportunidades validadas que no período anterior",
      detalhe: `${validadas.valor} no período contra ${validAnterior} no período anterior de mesma duração.`,
      gravidade: "media",
      indicador: "oportunidades-validadas",
    });
  if (soOmie > 0)
    ameacas.push({
      id: "aptas-so-omie",
      titulo: "Potencial que pode ser fornecedor",
      detalhe: `${plural(soOmie, "conta passa", "contas passam")} na régua de algum produto, mas só existe no cadastro do Omie da unidade, que também registra fornecedores. Ficam fora das prontas.`,
      gravidade: "media",
      indicador: "contas-prontas",
    });

  // ── Decisões: no máximo três, por regra fixa ──────────────────────────
  const decisoes: Decisao[] = [
    {
      id: "perimetro-meta",
      titulo: "Definir perímetro e ano-alvo da meta de R$ 1 bi",
      porque:
        "Sem eles não existe gap para a meta, e o cockpit não pode dizer se estamos no plano.",
      responsavel: "CEO + CFO",
      destino: null,
    },
  ];
  if (semAlocacao)
    decisoes.push({
      id: "alocar-plano",
      titulo: "Alocar o plano do mês por produto",
      porque: "Capacidade e meta existem, mas a alocação está zerada em todos os produtos.",
      responsavel: "CEO (alocação) + Comercial",
      destino: {
        rota: "/monetizacao",
        search: { aba: "capacidade" },
        rotulo: "Abrir Capacidade e alocação",
        mesmoRecorte: false,
        observacao: "O plano é editado na tela de origem.",
      },
    });
  else if (mes && !unidade && !planosDoMes.length && temNumero(comercial.estado))
    decisoes.push({
      id: "cadastrar-plano",
      titulo: "Cadastrar o plano do mês",
      porque: "Sem plano não há meta para comparar o realizado.",
      responsavel: "Comercial + Departamento de Receitas",
      destino: {
        rota: "/monetizacao",
        search: { aba: "capacidade" },
        rotulo: "Abrir Capacidade e alocação",
        mesmoRecorte: false,
        observacao: "O plano é editado na tela de origem.",
      },
    });
  decisoes.push(
    soOmie > 0
      ? {
          id: "contas-so-omie",
          titulo: "Decidir como qualificar contas que só existem no Omie",
          porque: `${plural(soOmie, "conta apta pela régua pode", "contas aptas pela régua podem")} ser fornecedor; hoje ficam fora das prontas até alguém confirmar.`,
          responsavel: "Departamento de Receitas + unidades",
          destino: {
            rota: "/clientes",
            search: { view: "monetizacao" },
            rotulo: "Abrir Base de clientes",
            mesmoRecorte: false,
            observacao: 'Na Base, filtre a situação "só no cadastro do Omie" em cada produto.',
          },
        }
      : {
          id: "cliente-ativo",
          titulo: "Definir o que é cliente ativo",
          porque:
            'Sem essa definição, "quantos clientes temos" não tem resposta, e penetração por vertical não tem denominador.',
          responsavel: "CEO + Departamento de Receitas",
          destino: null,
        },
  );

  // ── Universo medido ────────────────────────────────────────────────────
  const partes = [perimetroRotulo, p.rotulo];
  if (dados && baseComNumero)
    partes.push(`${plural(contas.length, "conta conciliada", "contas conciliadas")}`);
  if (op) partes.push(`${plural(negocios.length, "negócio", "negócios")} do pipe de Monetização`);
  partes.push("Financeiro fora deste recorte");

  return {
    sintetico,
    universo: partes.join(" · "),
    perimetroRotulo,
    perimetros: unidades
      .filter((u) => u.account_keys.length > 0)
      .map((u) => ({ chave: u.key, rotulo: u.name }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")),
    indicadores,
    decisoes: decisoes.slice(0, 3),
    ameacas,
    porProduto,
    serieDiaria: op
      ? op.series.map((s) => ({
          date: s.date,
          label: s.label,
          started: s.started,
          scheduled: s.scheduled,
          meeting: s.meeting,
        }))
      : null,
    avisos,
  };
}
