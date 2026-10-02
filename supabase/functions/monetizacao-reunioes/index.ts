/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive, do banco e do modelo chega sem tipo. */
// Reuniões da Monetização (pipe 39): o bot de reuniões entra sozinho e o card recebe a avaliação da reunião.
// Spec: docs/superpowers/specs/2026-10-01-monetizacao-reunioes-bot-e-avaliacao.md. Pedido do Pedro em 01/10/2026.
//
// Parte A (enfileirar): card aberto numa etapa de reunião, com atividade do tipo Reunião que tem hora e link do Teams,
// vira uma linha `pedido-monet-<deal>-<início UTC>` na fila do Brain Meet (growth.reunioes_agendadas), no mesmo formato
// que a SDR IA usa. Remarcação cancela a linha anterior que o bot ainda não pegou. Só roda com MONET_BOT_ENFILEIRAR=on.
// Parte B (avaliar): quando a transcrição fica pronta, avalia pelo playbook do Caixa e posta uma nota no card; reunião
// sem gravação ganha uma nota curta com o motivo. Uma nota por reunião.
// Parte C (campo do pipe): o que a reunião avaliada ofertou com confiança alta é somado ao campo "Caixa · Produtos
// ofertados" do card, sem tirar nada. Só roda com MONET_GRAVAR_OFERTADOS=on (spec 2026-10-02-monetizacao-gravacoes-tela).
//
// Roda pelo cron (cabeçalho x-monetizacao-sync), com {"action":"rodar"}; {"dry": true} não escreve nada.
import { pipedriveApi } from "../monetizacao-crm/pipedrive.mjs";
import {
  apurar,
  lerResposta,
  mensagemUsuario,
  montarSystem,
  notaPipedrive,
  notaSemGravacao,
  transcricaoDasFalas,
  type Fala,
  type TipoReuniao,
} from "./avaliacao.ts";
import { dataSaoPaulo, eventId, motivoSemGravacao, proximaReuniao, tipoDaEtapa } from "./agenda.ts";
import { detalharOfertado, gravarOfertados } from "./ofertado.ts";
import { RUBRICA } from "./rubrica.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const ADMIN = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PD = Deno.env.get("PIPEDRIVE_TOKEN")!;
const OPENROUTER = Deno.env.get("OPENROUTER_API_KEY") || "";
const SEGREDO = Deno.env.get("MONETIZACAO_SYNC_SECRET");
const ENFILEIRAR = Deno.env.get("MONET_BOT_ENFILEIRAR") === "on";
const GRAVAR_OFERTADOS = Deno.env.get("MONET_GRAVAR_OFERTADOS") === "on";
const MODELO = Deno.env.get("MONET_AVALIACAO_MODELO") || "anthropic/claude-sonnet-5.5";
const SEM_GRAVACAO_DEPOIS_MS = 3 * 60 * 60 * 1000;
const AVALIAR_DEPOIS_MS = 30 * 60 * 1000;

type Row = Record<string, any>;
const { pd } = pipedriveApi(PD);

async function rest(
  schema: string,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: init.method || (init.body === undefined ? "GET" : "POST"),
    headers: {
      apikey: ADMIN,
      Authorization: `Bearer ${ADMIN}`,
      "Content-Type": "application/json",
      "Accept-Profile": schema,
      "Content-Profile": schema,
      Prefer: init.prefer || "return=representation",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${schema}.${path.split("?")[0]}: ${json?.message || res.status}`);
  return json;
}

// ---------------------------------------------------------------------------- Parte A

async function enfileirar(dry: boolean) {
  const sync = (await rest("ops", "monetizacao_sync?select=stages&limit=1"))[0];
  const etapas = new Map<number, TipoReuniao>();
  for (const s of sync?.stages || []) {
    const t = tipoDaEtapa(s.name);
    if (t) etapas.set(Number(s.id), t);
  }
  if (!etapas.size) throw new Error("Nenhuma etapa de reunião no pipe 39");
  const deals: Row[] = await rest(
    "ops",
    `monetizacao_deals?select=id,payload&payload->>status=eq.open&payload->>stage_id=in.(${[...etapas.keys()].join(",")})`,
  );
  const emails = new Map<number, string | null>();
  const saida: Row[] = [];
  for (const d of deals) {
    const p = d.payload || {};
    const tipo = etapas.get(Number(p.stage_id))!;
    let atividades: Row[] = [];
    try {
      atividades = (await pd(`deals/${d.id}/activities`, { done: "0", limit: "100" })).data || [];
    } catch (e) {
      saida.push({ deal: d.id, situacao: "erro_pipedrive", erro: (e as Error).message });
      continue;
    }
    const r = proximaReuniao(atividades);
    if (!r) {
      saida.push({
        deal: d.id,
        tipo,
        situacao: "sem atividade de Reunião com hora e link do Teams",
      });
      continue;
    }
    const id = eventId(Number(d.id), r.inicio);
    const dono = Number(p.owner_id) || null;
    if (dono && !emails.has(dono)) {
      try {
        const u = (await pd(`users/${dono}`)).data;
        const email =
          String(u?.email || "")
            .trim()
            .toLowerCase() || null;
        emails.set(dono, email);
        // A tela Gravações reconhece o closer pelo e-mail do dono do card (ops.monetizacao_closers).
        if (!dry && email)
          await rest("ops", "monetizacao_closers?on_conflict=pipedrive_user_id", {
            body: {
              pipedrive_user_id: dono,
              nome: String(u?.name || p.owner || email),
              email,
              atualizado_em: new Date().toISOString(),
            },
            prefer: "resolution=merge-duplicates,return=minimal",
          }).catch(() => undefined);
      } catch {
        emails.set(dono, null);
      }
    }
    const titulo =
      `${p.org || p.title || "Card " + d.id} · Caixa de Oportunidade · ${tipo === "proposta" ? "Proposta" : "Levantamento"}`.slice(
        0,
        200,
      );
    const linha = {
      event_id: id,
      titulo,
      inicio: r.inicio,
      fim: r.fim,
      link: r.link,
      plataforma: "teams",
      participantes: [],
      status: "agendada",
      pedido_em: new Date().toISOString(),
      pedido_por_email: (dono && emails.get(dono)) || null,
      departamento: "Comercial",
      departamento_origem: "pessoa",
    };
    saida.push({
      deal: d.id,
      tipo,
      situacao: dry ? "enfileiraria" : "na_fila",
      event_id: id,
      inicio: r.inicio,
    });
    if (dry) continue;
    // Remarcação: a anterior deste card que o bot ainda não pegou sai da fila (não apaga: gravacoes tem FK).
    await rest(
      "growth",
      `reunioes_agendadas?event_id=like.pedido-monet-${d.id}-*&event_id=neq.${id}&joiner_status=is.null&inicio=gt.${encodeURIComponent(new Date().toISOString())}`,
      {
        method: "PATCH",
        body: {
          status: "cancelada",
          joiner_status: "cancelada",
          joiner_erro: "remarcada (Monetização)",
        },
        prefer: "return=minimal",
      },
    );
    await rest(
      "ops",
      `monetizacao_reunioes?event_id=like.pedido-monet-${d.id}-*&event_id=neq.${id}&status=eq.na_fila`,
      {
        method: "PATCH",
        body: { status: "cancelada", updated_at: new Date().toISOString() },
        prefer: "return=minimal",
      },
    );
    // Insere sem sobrescrever; depois atualiza só se o bot ainda não pegou a linha.
    await rest("growth", "reunioes_agendadas?on_conflict=event_id", {
      body: linha,
      prefer: "resolution=ignore-duplicates,return=minimal",
    });
    await rest("growth", `reunioes_agendadas?event_id=eq.${id}&joiner_status=is.null`, {
      method: "PATCH",
      body: {
        titulo: linha.titulo,
        fim: linha.fim,
        link: linha.link,
        pedido_por_email: linha.pedido_por_email,
        status: "agendada",
      },
      prefer: "return=minimal",
    });
    await rest("ops", "monetizacao_reunioes?on_conflict=event_id", {
      body: {
        event_id: id,
        deal_id: Number(d.id),
        tipo,
        inicio: r.inicio,
        fim: r.fim,
        link: r.link,
        closer_pipedrive_id: dono,
        atividade_id: r.atividade_id,
        status: "na_fila",
        updated_at: new Date().toISOString(),
      },
      prefer: "resolution=ignore-duplicates,return=minimal",
    });
  }
  return saida;
}

// ---------------------------------------------------------------------------- Parte B

async function falasDa(gravacao: string): Promise<Fala[]> {
  const falas: Fala[] = [];
  for (let de = 0; ; de += 1000) {
    const lote: Fala[] = await rest(
      "growth",
      `gravacoes_falas?gravacao_id=eq.${gravacao}&select=ordem,inicio_s,falante,texto&order=ordem&offset=${de}&limit=1000`,
    );
    falas.push(...lote);
    if (lote.length < 1000) return falas;
  }
}

async function chamarModelo(tipo: TipoReuniao, transcricao: string) {
  if (!OPENROUTER) throw new Error("OPENROUTER_API_KEY ausente");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER}`,
      "Content-Type": "application/json",
      "User-Agent": "planning-monetizacao-reunioes/1",
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 9000,
      reasoning: { max_tokens: 2000 },
      usage: { include: true },
      messages: [
        { role: "system", content: montarSystem(tipo) },
        { role: "user", content: mensagemUsuario(transcricao) },
      ],
    }),
    signal: AbortSignal.timeout(140000),
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
  const r = await res.json();
  const escolha = r.choices?.[0];
  if (escolha?.finish_reason !== "stop" || !escolha?.message?.content)
    throw new Error(`resposta incompleta do modelo: ${escolha?.finish_reason}`);
  return {
    resposta: lerResposta(escolha.message.content),
    custo: r.usage?.cost ?? null,
    modelo: r.model,
  };
}

async function avaliar(dry: boolean) {
  const limite = new Date(Date.now() - AVALIAR_DEPOIS_MS).toISOString();
  const linhas: Row[] = await rest(
    "ops",
    `monetizacao_reunioes?status=in.(na_fila,gravando)&inicio=lt.${encodeURIComponent(limite)}&order=inicio&limit=5`,
  );
  const saida: Row[] = [];
  for (const m of linhas) {
    const quando = dataSaoPaulo(m.inicio);
    try {
      const fila = (
        await rest(
          "growth",
          `reunioes_agendadas?event_id=eq.${encodeURIComponent(m.event_id)}&select=joiner_status`,
        )
      )[0];
      const grav = (
        await rest(
          "growth",
          `gravacoes?event_id=eq.${encodeURIComponent(m.event_id)}&select=id&order=subida_em.desc&limit=1`,
        )
      )[0];
      const trans = grav
        ? (await rest("growth", `gravacoes_transcricao?gravacao_id=eq.${grav.id}&select=status`))[0]
        : null;
      const passou = Date.now() - Date.parse(m.inicio) > SEM_GRAVACAO_DEPOIS_MS;
      const falhou =
        ["falhou_lobby", "falhou_join", "interrompida", "cancelada"].includes(
          fila?.joiner_status,
        ) ||
        ["sem_fala", "falhou"].includes(trans?.status) ||
        (!grav && passou);
      if (trans?.status === "pronta") {
        const falas = await falasDa(grav.id);
        const transcricao = transcricaoDasFalas(falas);
        if (transcricao.length < RUBRICA.min_caracteres_transcricao) {
          saida.push({
            event_id: m.event_id,
            situacao: "sem_gravacao",
            motivo: "conversa curta demais",
          });
          if (!dry)
            await fechar(
              m,
              null,
              notaSemGravacao(m.tipo, quando, "a gravação tem conversa curta demais para avaliar"),
              "sem_gravacao",
              grav.id,
            );
          continue;
        }
        if (dry) {
          saida.push({ event_id: m.event_id, situacao: "avaliaria", falas: falas.length });
          continue;
        }
        const { resposta, custo, modelo } = await chamarModelo(m.tipo, transcricao);
        const av = apurar(m.tipo, resposta, transcricao);
        const html = notaPipedrive(av, quando, "gravação da reunião pelo bot do Brain");
        // Minuto e confiança de cada trecho do ofertado: a tela mostra, e a Parte C decide o campo do pipe por eles.
        const ofertado = detalharOfertado(av.ofertado, falas);
        await fechar(m, { ...av, ofertado, custo_usd: custo, modelo }, html, "avaliada", grav.id);
        saida.push({ event_id: m.event_id, situacao: "avaliada", nota: av.nota });
      } else if (falhou) {
        const motivo = motivoSemGravacao(fila?.joiner_status ?? null, trans?.status ?? null);
        saida.push({ event_id: m.event_id, situacao: "sem_gravacao", motivo });
        if (!dry)
          await fechar(
            m,
            null,
            notaSemGravacao(m.tipo, quando, motivo),
            "sem_gravacao",
            grav?.id ?? null,
          );
      } else {
        saida.push({
          event_id: m.event_id,
          situacao: "aguardando",
          bot: fila?.joiner_status ?? null,
          transcricao: trans?.status ?? null,
        });
        if (!dry && grav && m.status !== "gravando")
          await rest("ops", `monetizacao_reunioes?event_id=eq.${encodeURIComponent(m.event_id)}`, {
            method: "PATCH",
            body: {
              status: "gravando",
              gravacao_id: grav.id,
              updated_at: new Date().toISOString(),
            },
            prefer: "return=minimal",
          });
      }
    } catch (e) {
      saida.push({ event_id: m.event_id, situacao: "erro", erro: (e as Error).message });
      if (!dry)
        await rest("ops", `monetizacao_reunioes?event_id=eq.${encodeURIComponent(m.event_id)}`, {
          method: "PATCH",
          body: { erro: (e as Error).message.slice(0, 500), updated_at: new Date().toISOString() },
          prefer: "return=minimal",
        });
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------- Parte C

/** Reuniões avaliadas que ainda não passaram pelo campo do pipe: soma o ofertado com confiança alta. */
async function gravarOfertadosPendentes(dry: boolean) {
  if (!GRAVAR_OFERTADOS) return "desligado (MONET_GRAVAR_OFERTADOS)";
  const linhas: Row[] = await rest(
    "ops",
    "monetizacao_reunioes?status=eq.avaliada&ofertados_gravados_em=is.null&select=event_id,deal_id,ofertado,ofertados_gravados_em&order=inicio&limit=10",
  );
  const saida: Row[] = [];
  for (const m of linhas) {
    const alvo = `monetizacao_reunioes?event_id=eq.${encodeURIComponent(m.event_id)}`;
    try {
      const r = await gravarOfertados({
        ligado: true,
        dry,
        reuniao: m as { deal_id: number; ofertado: unknown; ofertados_gravados_em: string | null },
        pd,
        registrar: (patch) =>
          rest("ops", `${alvo}&ofertados_gravados_em=is.null`, {
            method: "PATCH",
            body: { ...patch, erro: null, updated_at: new Date().toISOString() },
            prefer: "return=minimal",
          }),
      });
      saida.push({ event_id: m.event_id, deal: m.deal_id, ...r });
    } catch (e) {
      saida.push({ event_id: m.event_id, situacao: "erro", erro: (e as Error).message });
      if (!dry)
        await rest("ops", alvo, {
          method: "PATCH",
          body: {
            erro: `campo do pipe: ${(e as Error).message}`.slice(0, 500),
            updated_at: new Date().toISOString(),
          },
          prefer: "return=minimal",
        });
    }
  }
  return saida;
}

/** Posta a nota no card uma vez só e fecha a reunião. A trava é a linha: só fecha quem ainda não tem nota. */
async function fechar(
  m: Row,
  avaliacao: Row | null,
  html: string,
  status: string,
  gravacao: string | null,
) {
  const atual = (
    await rest(
      "ops",
      `monetizacao_reunioes?event_id=eq.${encodeURIComponent(m.event_id)}&select=nota_pipedrive_id`,
    )
  )[0];
  if (atual?.nota_pipedrive_id) return;
  const nota = await pd("notes", {}, { deal_id: Number(m.deal_id), content: html });
  await rest("ops", `monetizacao_reunioes?event_id=eq.${encodeURIComponent(m.event_id)}`, {
    method: "PATCH",
    body: {
      status,
      gravacao_id: gravacao,
      avaliacao,
      nota: avaliacao?.nota ?? null,
      ofertado: avaliacao?.ofertado ?? null,
      nota_pipedrive_id: nota.data?.id ?? null,
      erro: null,
      updated_at: new Date().toISOString(),
    },
    prefer: "return=minimal",
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "Método inválido" }), { status: 405 });
  if (!SEGREDO || req.headers.get("x-monetizacao-sync") !== SEGREDO)
    return new Response(JSON.stringify({ error: "Sem acesso" }), { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action !== "rodar")
      return new Response(JSON.stringify({ error: "Ação inválida" }), { status: 400 });
    const dry = body.dry === true;
    const enfileiradas =
      ENFILEIRAR || dry ? await enfileirar(dry || !ENFILEIRAR) : "desligado (MONET_BOT_ENFILEIRAR)";
    const avaliadas = await avaliar(dry);
    const ofertados = await gravarOfertadosPendentes(dry);
    return new Response(JSON.stringify({ status: "ok", dry, enfileiradas, avaliadas, ofertados }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ status: "erro", error: (e as Error).message }), {
      status: 500,
    });
  }
});
