// "Perguntar ao Brain" do Cockpit do COO: a parte pura.
//
// O modelo só alcança três ferramentas fechadas (ler um tema, ler os OKRs de um tema, ler os
// compromissos), que devolvem o MESMO dado da tela, já montado e no recorte pedido. Não há SQL
// livre nem ferramenta genérica. Todo número do texto final precisa existir num resultado da
// rodada (com a tolerância do arredondamento): frase com número sem origem sai inteira, e o
// descarte é mostrado. A conferência é a do Cockpit do CEO (`lerNumeros`).
import { lerNumeros } from "../cockpit-ceo/conversa/conferir.ts";
import type { LeituraTema, NumeroCoo } from "./contrato.ts";
import type { OkrsTema } from "./okrs.ts";
import { ordenarFila, ROTULO_TIPO } from "./compromissos.ts";
import type { Compromisso } from "./compromissos.ts";
import { TEMAS } from "./contrato.ts";

/** A leitura de um tema do jeito que o modelo recebe: sem explicação longa, com estado e motivo. */
export function resumoDaLeitura(l: LeituraTema) {
  const num = (n: NumeroCoo) => ({
    id: n.id,
    rotulo: n.rotulo,
    valor: n.valor,
    unidade: n.unidade,
    estado: n.estado,
    ...(n.motivo ? { motivo: n.motivo } : {}),
    ...(n.nota ? { nota: n.nota } : {}),
    ...(n.meta ? { meta: n.meta.valor, metaRotulo: n.meta.rotulo } : {}),
    ...(n.delta ? { delta: n.delta.valor, deltaRotulo: n.delta.rotulo } : {}),
    cobre: n.cobertura,
    fonte: n.fonte,
    dataDado: n.dataDado,
  });
  return {
    tema: TEMAS[l.tema].menu,
    universo: l.universo,
    numeros: l.numeros.map(num),
    alertas: l.alertas.map((a) => ({ titulo: a.titulo, gravidade: a.gravidade, regra: a.limiar })),
    graficos: l.graficos.map((g) => ({
      titulo: g.titulo,
      estado: g.estado,
      unidade: g.unidade,
      series: g.series.map((s) => s.rotulo),
      pontos: g.pontos.slice(0, 20),
    })),
    avisos: l.avisos,
  };
}

export function resumoDosOkrs(o: OkrsTema) {
  return {
    tema: TEMAS[o.tema].menu,
    estado: o.estado,
    ultimaFoto: o.ultimoDia,
    fotoParada: o.parado,
    departamentos: o.departamentos.map((d) => ({
      departamento: d.nome,
      progressoPct: d.progresso == null ? null : Math.round(d.progresso * 1000) / 10,
      esperadoPct: Math.round(d.esperado * 1000) / 10,
      krs: d.krs,
      piorKr: d.piorKr ? { nome: d.piorKr.nome, progressoPct: Math.round(d.piorKr.progresso * 1000) / 10 } : null,
    })),
  };
}

/** Até 40 linhas, na ordem de trabalho (vencidas primeiro): o modelo recebe o que importa. */
export function resumoDosCompromissos(cs: Compromisso[]) {
  return ordenarFila(cs).slice(0, 40).map((c) => ({
    nome: c.nome,
    origem: c.origemTarefa === "rotina" ? "compromisso da rotina" : `tarefa da área ${c.departamento ?? "sem pasta"}`,
    tipo: ROTULO_TIPO[c.tipo],
    kr: c.pai,
    dono: c.dono?.nome ?? null,
    prazo: c.prazo?.slice(0, 10) ?? null,
    tema: c.tema ? TEMAS[c.tema].titulo : null,
    unidade: c.unidade,
    situacao: c.concluida ? "concluído" : c.vencido ? `vencido há ${c.diasVencido} dias` : "aberto",
    adiamentos: c.adiamentos,
  }));
}

/** Todo número que aparece em qualquer resultado (valores, textos e rótulos). */
export function numerosDosResultados(resultados: unknown[]): number[] {
  const out: number[] = [];
  const visitar = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "string") for (const n of lerNumeros(v)) out.push(n.valor);
    else if (Array.isArray(v)) {
      out.push(v.length);
      v.forEach(visitar);
    } else if (v && typeof v === "object") Object.values(v).forEach(visitar);
  };
  resultados.forEach(visitar);
  return out;
}

const ehAno = (valor: number) => Number.isInteger(valor) && valor >= 2000 && valor <= 2100;

function frases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9"“])/u)
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Confere o texto do modelo: frase com número que não está nos resultados sai inteira. Percentual
 * aceita também a fração (45% ↔ 0,45), porque o dado guarda progresso de 0 a 1.
 */
export function conferirResposta(texto: string, resultados: unknown[], pergunta: string): { texto: string; descartadas: string[] } {
  const permitidos = [...numerosDosResultados(resultados), ...lerNumeros(pergunta).map((n) => n.valor)];
  const confere = (n: ReturnType<typeof lerNumeros>[number]) =>
    ehAno(n.valor) ||
    permitidos.some(
      (p) =>
        Math.abs(Math.abs(p) - Math.abs(n.valor)) <= n.tolerancia + 1e-9 ||
        (n.percentual && Math.abs(Math.abs(p) * 100 - Math.abs(n.valor)) <= n.tolerancia + 1e-9),
    );
  const mantidas: string[] = [];
  const descartadas: string[] = [];
  for (const f of frases(texto)) (lerNumeros(f).every(confere) ? mantidas : descartadas).push(f);
  return { texto: mantidas.join(" "), descartadas };
}

export const INSTRUCOES_COO = (hoje: string) => `Você responde ao COO da Expansão da Planning (rede de unidades de contabilidade) dentro do Cockpit do COO. Hoje é ${hoje} (fuso de São Paulo).
Regras:
- Use SÓ as ferramentas para obter números. Nunca invente, estime ou arredonde para um número que não veio de uma ferramenta.
- Número que não está disponível: diga que não há dado e o motivo que a ferramenta devolveu (estado e motivo).
- Diga sempre de onde vem o número (fonte e data) quando citar um.
- Responda em português, em até 6 frases curtas, direto ao ponto, sem listas longas.
- Se a pergunta pedir ação, aponte quem é o dono e sugira virar compromisso no ClickUp; você não grava nada.
- Os temas da semana: segunda Growth, terça Financeiro e Operações, quarta CS e RH, quinta Monetização, sexta Estratégico.`;
