// Adaptador de servidor do Jev. É a única peça que fala com o OpenRouter.
//
// Regras deste piloto, todas verificadas em tests/cockpit-ceo-jev.test.mjs:
// - uma requisição por pedido, sem retry automático;
// - tempo limite; resposta validada contra a taxonomia; resposta fora do contrato é descartada;
// - antes de cada chamada, o ledger decide: 10 requisições no total, US$ 0,10 de custo informado,
//   e bloqueio quando uma chamada termina sem custo informado (a inferência pode ter sido cobrada);
// - a reserva é gravada ANTES da chamada, então um processo que cai no meio também bloqueia;
// - ledger guarda id opaco, exemplo, taxonomia, modelo, latência, custo e respostas; nunca o texto
//   analisado nem a chave. A chave vem do Keychain do macOS, só no servidor.
//
// Esse controle é posterior à cobrança de cada chamada: não substitui o limite de crédito da chave.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ErroJev,
  JEV_ENDPOINT,
  JEV_MODELO,
  KEYCHAIN,
  LIMITES_PILOTO,
  MENSAGENS_FALHA,
  resumirOrcamento,
  taxonomiaDo,
  validarPedido,
  validarResposta,
} from "./contrato.ts";
import type { PedidoJev, RegistroChamada, RespostaJev, ResumoOrcamento } from "./contrato.ts";

export interface LedgerJev {
  ler(): Promise<RegistroChamada[]>;
  anexar(r: RegistroChamada): Promise<void>;
  comTrava<T>(fn: () => Promise<T>): Promise<T>;
}

type Transporte = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; text: () => Promise<string> }>;

export interface DepsJev {
  obterChave: () => Promise<string | null>;
  transporte?: Transporte;
  ledger: LedgerJev;
  exemplo: string;
  timeoutMs?: number;
  limites?: { tentativas: number; custoUsd: number };
}

export interface ResultadoJev {
  estado: "ok";
  idChamada: string;
  exemplo: string;
  taxonomia: string;
  modeloSolicitado: string;
  modeloRetornado: string;
  provedor: string | null;
  idFornecedor: string | null;
  latenciaMs: number;
  custoUsd: number | null;
  tokens: { entrada: number | null; saida: number | null };
  respostas: Record<string, RespostaJev>;
  orcamento: ResumoOrcamento;
}

export interface FalhaJev {
  estado: "falha" | "bloqueado" | "sem_chave" | "desativado";
  codigo: string;
  mensagem: string;
  idChamada?: string;
  latenciaMs?: number;
  orcamento?: ResumoOrcamento;
}

// Recusas do fornecedor antes da inferência: contam como tentativa, mas não deixam custo em aberto.
// Qualquer outro desfecho sem `usage.cost` bloqueia as próximas chamadas.
const RECUSAS_SEM_INFERENCIA = new Set([400, 401, 402, 403, 404, 413, 429]);
const LIMITE_CORPO = 256_000;

const transportePadrao: Transporte = (url, init) => fetch(url, init);

export async function decidirJev(
  pedido: PedidoJev,
  deps: DepsJev,
): Promise<ResultadoJev | FalhaJev> {
  try {
    validarPedido(pedido);
  } catch (e) {
    return { estado: "falha", codigo: "pedido_invalido", mensagem: (e as Error).message };
  }
  const limites = deps.limites ?? LIMITES_PILOTO;
  const transporte = deps.transporte ?? transportePadrao;
  return deps.ledger.comTrava(async () => {
    const antes = resumirOrcamento(await deps.ledger.ler(), limites);
    if (antes.bloqueado)
      return {
        estado: "bloqueado",
        codigo: "orcamento_do_piloto",
        mensagem: antes.motivo ?? "Chamadas bloqueadas pelo orçamento do piloto.",
        orcamento: antes,
      } satisfies FalhaJev;
    const chave = await deps.obterChave();
    if (!chave)
      return {
        estado: "sem_chave",
        codigo: "sem_chave",
        mensagem: `Chave OpenRouter não encontrada no Keychain (serviço ${KEYCHAIN.servico}). Nenhuma chamada foi feita.`,
        orcamento: antes,
      } satisfies FalhaJev;

    const base = {
      id: randomUUID(),
      em: new Date().toISOString(),
      exemplo: deps.exemplo,
      taxonomia: taxonomiaDo(pedido),
    };
    await deps.ledger.anexar({ ...base, estado: "reservada" });

    const inicio = performance.now();
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), deps.timeoutMs ?? 20_000);
    let desfecho: RegistroChamada;
    let resultado: Omit<ResultadoJev, "orcamento"> | null = null;
    try {
      const resp = await transporte(JEV_ENDPOINT, {
        method: "POST",
        headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
        body: JSON.stringify(pedido),
        signal: controle.signal,
      });
      const texto = await resp.text();
      const latenciaMs = Math.round(performance.now() - inicio);
      if (resp.status !== 200) {
        // O corpo de erro não é repassado: pode trazer eco do pedido ou da credencial.
        desfecho = {
          ...base,
          estado: "falha",
          codigo: `openrouter_http_${resp.status}`,
          latenciaMs,
          custoUsd: null,
          custoDesconhecido: !RECUSAS_SEM_INFERENCIA.has(resp.status),
        };
      } else {
        if (texto.length > LIMITE_CORPO)
          throw new ErroJev("resposta_invalida", "Resposta grande demais.");
        if (texto.includes(chave))
          throw new ErroJev("resposta_invalida", "A resposta ecoou a credencial.");
        let corpo: unknown;
        try {
          corpo = JSON.parse(texto);
        } catch {
          throw new ErroJev("resposta_invalida", "Resposta não é JSON.");
        }
        const v = validarResposta(corpo, pedido.questions);
        desfecho = {
          ...base,
          estado: "ok",
          modelo: v.modelo,
          provedor: v.provedor,
          idFornecedor: v.idFornecedor,
          latenciaMs,
          custoUsd: v.custoUsd,
          custoDesconhecido: v.custoUsd === null,
          tokens: v.tokens,
          respostas: v.respostas,
        };
        resultado = {
          estado: "ok",
          idChamada: base.id,
          exemplo: base.exemplo,
          taxonomia: base.taxonomia,
          modeloSolicitado: JEV_MODELO,
          modeloRetornado: v.modelo,
          provedor: v.provedor,
          idFornecedor: v.idFornecedor,
          latenciaMs,
          custoUsd: v.custoUsd,
          tokens: v.tokens,
          respostas: v.respostas,
        };
      }
    } catch (e) {
      const erro = e as Error & { codigo?: string };
      desfecho = {
        ...base,
        estado: "falha",
        codigo:
          erro.name === "AbortError" || controle.signal.aborted
            ? "tempo_esgotado"
            : erro instanceof ErroJev
              ? erro.codigo
              : "conexao_falhou",
        latenciaMs: Math.round(performance.now() - inicio),
        custoUsd: null,
        custoDesconhecido: true,
      };
    } finally {
      clearTimeout(relogio);
    }
    await deps.ledger.anexar(desfecho);
    const orcamento = resumirOrcamento(await deps.ledger.ler(), limites);
    if (resultado) {
      const saida: ResultadoJev = { ...resultado, orcamento };
      if (JSON.stringify(saida).includes(chave))
        return {
          estado: "falha",
          codigo: "resposta_invalida",
          mensagem: MENSAGENS_FALHA.resposta_invalida,
          orcamento,
        } satisfies FalhaJev;
      return saida;
    }
    const codigo = desfecho.codigo ?? "conexao_falhou";
    return {
      estado: "falha",
      codigo,
      mensagem: MENSAGENS_FALHA[codigo] ?? `O fornecedor recusou a chamada (${codigo}).`,
      idChamada: base.id,
      latenciaMs: desfecho.latenciaMs ?? undefined,
      orcamento,
    } satisfies FalhaJev;
  });
}

// ── Ledgers ──────────────────────────────────────────────────────────────
function fila() {
  let cauda: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const vez = cauda.then(fn, fn);
    cauda = vez.catch(() => undefined);
    return vez;
  };
}

export function criarLedgerMemoria(): LedgerJev {
  const registros: RegistroChamada[] = [];
  const emFila = fila();
  return {
    ler: async () => registros.map((r) => ({ ...r })),
    anexar: async (r) => void registros.push({ ...r }),
    comTrava: emFila,
  };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** JSONL append-only, com trava por arquivo: o script e o servidor do preview não disputam o orçamento. */
export function criarLedgerArquivo(caminho: string): LedgerJev {
  const trava = caminho + ".trava";
  const emFila = fila();
  return {
    async ler() {
      try {
        const texto = await readFile(caminho, "utf8");
        return texto
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as RegistroChamada);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw e;
      }
    },
    async anexar(r) {
      await mkdir(dirname(caminho), { recursive: true });
      await appendFile(caminho, JSON.stringify(r) + "\n", "utf8");
    },
    comTrava: (fn) =>
      emFila(async () => {
        await mkdir(dirname(caminho), { recursive: true });
        for (let i = 0; ; i++) {
          try {
            const h = await open(trava, "wx");
            await h.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
            await h.close();
            break;
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
            // Trava de um processo que morreu: mais velha que o tempo máximo de uma chamada.
            const s = await stat(trava).catch(() => null);
            if (s && Date.now() - s.mtimeMs > 90_000) await rm(trava, { force: true });
            if (i > 600) throw new Error("Ledger do Jev travado por outro processo.");
            await esperar(100);
          }
        }
        try {
          return await fn();
        } finally {
          await rm(trava, { force: true });
        }
      }),
  };
}

// ── Credencial ───────────────────────────────────────────────────────────
/** Lê a chave do Keychain do macOS. O valor não passa por variável de ambiente, arquivo ou log. */
export function obterChaveKeychain(): Promise<string | null> {
  return new Promise((resolve) =>
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-a", KEYCHAIN.conta, "-s", KEYCHAIN.servico, "-w"],
      { timeout: 5_000 },
      (erro, stdout) => {
        const chave = String(stdout ?? "").trim();
        resolve(!erro && /^sk-or-[A-Za-z0-9_-]{16,}$/.test(chave) ? chave : null);
      },
    ),
  );
}
