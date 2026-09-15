import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Emite a sessão do Financial Brain para quem acabou de autenticar no Ops.
 *
 * Por que existe: o Financial nasceu sem login — ninguém tem senha lá. Então
 * `signInWithPassword` (o caminho usado com o Growth) não serve. Aqui o
 * servidor do Ops, que já verificou a identidade da pessoa, usa a service role
 * do Financial para gerar um token de acesso único; o navegador troca esse
 * token por uma sessão de verdade (verifyOtp) e a grava no cookie do domínio
 * raiz, como os outros dois produtos já fazem.
 *
 * SEGURANÇA — as duas travas que sustentam isto:
 *   1. O e-mail NUNCA vem do cliente. É lido das claims do token do Ops já
 *      validado pelo middleware. Sem isso, qualquer pessoa logada poderia
 *      pedir a sessão de outra.
 *   2. O usuário no Financial é criado com o e-mail já confirmado, porque a
 *      confirmação de identidade aconteceu no Ops. Nenhum e-mail é disparado.
 */

/** Prefixo das chaves de escopo do cockpit em KNOWN_PERMISSIONS. */
const PREFIXO_ESCOPO = "view.brain_financeiro_";

/**
 * Mapa chave-de-permissão -> id do escopo em `unidades_navegacao` do Financial.
 *
 * Serve a DOIS propósitos hoje, e só um deles sobrevive:
 *   (a) o caminho novo usa os VALORES como a lista completa de unidades que
 *       existem, para carimbar `tudo` no token;
 *   (b) o caminho velho usa as CHAVES para derivar escopo das permissões de
 *       papel, e só roda para quem ainda não tem linha em `produto_escopo`.
 *
 * NEO entrou em 15/09/2026. Ela existia em `unidades_navegacao` com nove telas
 * habilitadas e não estava aqui — resultado: 403 para todo mundo, inclusive
 * para os dois admins, sem ninguém perceber porque a unidade também não
 * aparecia no menu.
 */
const ESCOPOS: Record<string, string> = {
  bpo: "BPO",
  doc: "DOC",
  expansao: "EXPANSÃO",
  marox: "MAROX",
  pat: "PAT",
  pis: "PIS",
  neo: "NEO",
  negocios_estruturados: "negocios-estruturados",
  finance: "finance",
};

/** Todas as unidades que o cockpit conhece. É o que decide o carimbo `tudo`. */
const TODAS_AS_UNIDADES = Object.values(ESCOPOS);

/**
 * Resolve o que a pessoa pode no cockpit, a partir dos papéis dela no Ops.
 * Devolve `null` quando ela não tem acesso nenhum — nesse caso não emitimos
 * sessão, para não dar token a quem não deveria entrar.
 */
async function permissoesDoCockpit(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // QUEM ENTRA no cockpit vem de `public.produto_acesso`, desde 14/09/2026.
  // Antes vinha da chave `view.brain_financeiro` na matriz de papéis do Ops, o
  // que fazia o acesso a um produto depender do papel em outro — e deixava o
  // Financeiro sem lugar próprio para conceder ou tirar acesso.
  // `as any`: ver a nota em produtos.functions.ts — `produto_acesso` está no
  // schema `public` e fora dos tipos gerados, que cobrem o `ops`.
  const { data: acesso } = await (supabaseAdmin as any)
    .schema("public")
    .from("produto_acesso")
    .select("produto")
    .eq("user_id", userId)
    .eq("produto", "financeiro")
    .maybeSingle();
  if (!acesso) return null;

  // ── O QUE ela vê dentro do cockpit ──────────────────────────────────────
  //
  // A fonte é `ops.usuario_escopo` + `ops.usuario_empresas`, o modelo que o
  // dono do Ops montou em 15/09/2026 ("o PAPEL abre ÁREAS, e a PESSOA tem
  // ESCOPO"). Este arquivo era o pendente declarado no commit dele, verbatim:
  //   "sessoes-irmas.functions.ts ainda monta o escopo do cockpit lendo
  //    role_permissions em vez de ops.usuario_empresas."
  //
  // Antes vinha das chaves `view.brain_financeiro_*` da matriz de PAPÉIS, e por
  // isso não havia como dar MAROX a uma pessoa sem dar às outras sete do mesmo
  // papel. Medido antes de trocar: as oito chaves estavam marcadas para
  // exatamente dois papéis (`admin` e `financeiro`), e o papel `financeiro`
  // tinha oito pessoas — as oito recebiam as oito unidades, idênticas.
  //
  // `todas_empresas` é a flag de "vê tudo". Sem ela e sem linha em
  // `usuario_empresas` a pessoa não abre unidade nenhuma: o default fecha, e
  // isso é deliberado do modelo dele ("ausência de linha fecha, não abre").
  const db = supabaseAdmin as any;
  const [escopoRes, empresasRes] = await Promise.all([
    db.from("usuario_escopo").select("todas_empresas").eq("user_id", userId).maybeSingle(),
    db.from("usuario_empresas").select("empresa_id").eq("user_id", userId),
  ]);

  const todas = Boolean(escopoRes?.data?.todas_empresas);
  const empresaIds: string[] = ((empresasRes?.data ?? []) as { empresa_id: string }[]).map(
    (e) => e.empresa_id,
  );

  // A TRADUÇÃO empresa -> unidade acontece contra o banco do cockpit, porque é
  // lá que ela é verdade. Reescrever a regra aqui criaria uma segunda cópia
  // dela — foi assim que NEO ficou de fora por semanas.
  const unidades = await unidadesParaEmpresas(todas ? null : empresaIds);
  const todasAsUnidades = await unidadesParaEmpresas(null);

  return {
    acesso: true as const,
    escopos: unidades,
    // Carimbo: no momento desta emissão a pessoa tinha TODAS as unidades. Quem
    // responde isso é aqui, que acabou de ler a lista inteira — e não o
    // cockpit, cuja cópia da lista envelheceu e deixou NEO de fora.
    tudo: todasAsUnidades.length > 0 && todasAsUnidades.every((u) => unidades.includes(u)),
    origem: todas ? "todas-as-empresas" : "por-empresa",
  };
}

/**
 * Traduz um conjunto de empresas do grupo nas unidades de navegação do cockpit.
 *
 * `null` quer dizer "todas" e devolve a lista inteira. A regra de casamento
 * mora no banco do cockpit: `unidades_navegacao.grupos` casa com
 * `empresas.grupo_apuracao`, e `unidades_navegacao.empresas`, quando
 * preenchida, RESTRINGE ainda mais — é o caso da EXPANSÃO, que é o grupo
 * EXPANSÃO limitado à PARTNERS.
 */
async function unidadesParaEmpresas(empresaIds: string[] | null): Promise<string[]> {
  const { getFinanceiroAdmin } = await import(
    "@/integrations/supabase/client.financeiro.server"
  );
  const fin = getFinanceiroAdmin() as any;
  if (!fin) return [];

  const { data: navs } = await fin
    .from("unidades_navegacao")
    .select("id, grupos, empresas")
    .eq("ativo", true);
  const unidades = (navs ?? []) as {
    id: string;
    grupos: string[] | null;
    empresas: string[] | null;
  }[];
  if (empresaIds === null) return unidades.map((u) => u.id);
  if (empresaIds.length === 0) return [];

  const { data: emps } = await fin
    .from("empresas")
    .select("id, apelido, grupo_apuracao")
    .in("id", empresaIds);
  const minhas = (emps ?? []) as {
    id: string;
    apelido: string;
    grupo_apuracao: string | null;
  }[];

  return unidades
    .filter((u) =>
      minhas.some(
        (e) =>
          (u.grupos ?? []).includes(e.grupo_apuracao ?? "") &&
          (!u.empresas?.length || u.empresas.includes(e.apelido)),
      ),
    )
    .map((u) => u.id);
}

/**
 * Emite a sessão do GROWTH para quem acabou de autenticar no Ops.
 *
 * Por que não usa `signInWithPassword` como antes: aquilo exigia a senha ser
 * idêntica nos dois bancos, e não é — verificado em 02/09/2026, o login do
 * Growth vinha falhando em silêncio desde sempre por isso. Emitir a sessão a
 * partir da identidade já verificada no Ops elimina a exigência de paridade
 * de senha, que era a fragilidade do desenho anterior.
 *
 * Diferença deliberada em relação ao Financial: aqui NÃO criamos usuário. O
 * Growth tem base própria (28 pessoas) e autoriza por e-mail em `membros` —
 * quem não existe lá não deve passar a existir só por ter logado no Ops.
 */
export const emitirSessaoGrowth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string } | undefined)?.email;
    if (!email) return { ok: false as const, motivo: "sem-email" };

    const { getGrowthAdmin } = await import(
      "@/integrations/supabase/client.growth.server"
    );
    const admin = getGrowthAdmin();
    if (!admin) return { ok: false as const, motivo: "nao-configurado" };

    try {
      const { data: lista } = await admin.auth.admin.listUsers();
      const existe = lista?.users?.some(
        (u) => u.email?.toLowerCase() === email.toLowerCase(),
      );
      // Sem conta no Growth não há sessão a emitir — e isso não é erro.
      if (!existe) return { ok: false as const, motivo: "sem-conta-no-growth" };

      const r = await admin.auth.admin.generateLink({ type: "magiclink", email });
      const tokenHash = r.data?.properties?.hashed_token;
      if (r.error || !tokenHash) {
        console.warn("[growth] generateLink falhou:", r.error?.message);
        return { ok: false as const, motivo: "gerar-token" };
      }
      return { ok: true as const, tokenHash };
    } catch (err) {
      console.warn("[growth] emissão de sessão falhou:", err);
      return { ok: false as const, motivo: "excecao" };
    }
  });

/**
 * Atualiza a concessão do Financeiro no app_metadata de quem JÁ tem sessão lá.
 *
 * POR QUE PRECISOU EXISTIR (medido em 15/09/2026): `garantirSessoesIrmas` só
 * reemitia a sessão quando faltava a marca `brain.financeiro`. Com ela
 * presente, `updateUserById` nunca mais rodava — e o app_metadata ficava
 * CONGELADO no dia em que a pessoa entrou pela primeira vez. As seis pessoas
 * com sessão no cockpit estavam todas com os oito escopos de agosto, nenhuma
 * com NEO, e nada nunca ia corrigir isso.
 *
 * Isso tornava o painel de acessos inútil dos dois lados: conceder uma unidade
 * nova não chegava, e — pior — REVOGAR acesso não chegava também. A pessoa
 * continuaria entrando indefinidamente.
 *
 * NÃO REEMITE SESSÃO, de propósito. O guard do cockpit lê o app_metadata AO
 * VIVO (`supabase.auth.getUser(token)` é uma requisição ao GoTrue, não uma
 * leitura do payload do JWT), então gravar a linha já basta. Emitir sessão
 * nova a cada navegação trocaria o cookie da pessoa sem motivo.
 *
 * REVOGAÇÃO É PARTE DO CONTRATO: se `permissoesDoCockpit` devolve null, esta
 * função grava `financeiro: false` em vez de não fazer nada. Sem isso, tirar
 * alguém do produto não tiraria ninguém de lugar nenhum.
 */
/**
 * Escreve a concessão de UMA pessoa no app_metadata do cockpit.
 *
 * Função pura de propósito, e não server fn: quem chama já conferiu quem pode
 * chamar. A server fn abaixo a usa para o próprio usuário logado; o painel de
 * acessos a usa para a pessoa que acabou de ser alterada, depois de conferir a
 * chave `admin.acessos.financeiro`.
 *
 * `null` em `permissao` grava `financeiro: false`. Isso é o que faz revogação
 * ser revogação: o guard do cockpit lê o app_metadata AO VIVO, então apagar a
 * linha de `produto_acesso` sozinha não tira ninguém de lugar nenhum.
 */
export async function aplicarConcessaoNoFinanceiro(userId: string, email: string) {
  const { getFinanceiroAdmin } = await import(
    "@/integrations/supabase/client.financeiro.server"
  );
  const admin = getFinanceiroAdmin();
  if (!admin) return { ok: false as const, motivo: "nao-configurado" };

  try {
    const permissao = await permissoesDoCockpit(userId);
    const alvo = (await admin.auth.admin.listUsers()).data?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    // Sem conta do outro lado não há metadata para escrever, e criar uma aqui
    // seria dar entrada a quem talvez não deva entrar. Não é erro: é o estado
    // de quem nunca abriu o cockpit.
    if (!alvo) return { ok: false as const, motivo: "sem-conta" };

    await admin.auth.admin.updateUserById(alvo.id, {
      app_metadata: {
        brain: permissao
          ? {
              financeiro: true,
              escopos: permissao.escopos,
              tudo: permissao.tudo,
              origem: permissao.origem,
            }
          : { financeiro: false, escopos: [], tudo: false },
      },
    });
    return { ok: true as const, concedido: Boolean(permissao) };
  } catch (err) {
    console.warn("[financeiro] aplicar concessão falhou:", err);
    return { ok: false as const, motivo: "excecao" };
  }
}

export const sincronizarConcessaoFinanceiro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string } | undefined)?.email;
    if (!email) return { ok: false as const, motivo: "sem-email" };

    return aplicarConcessaoNoFinanceiro(context.userId, email);
  });

export const emitirSessaoFinanceiro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string } | undefined)?.email;
    if (!email) {
      // Sem e-mail na claim não há como identificar a pessoa do outro lado.
      return { ok: false as const, motivo: "sem-email" };
    }

    // A concessão é decidida AQUI, no Ops, e viaja no token. Sem acesso, não
    // emitimos sessão nenhuma — dar token a quem não pode entrar seria só
    // empurrar a checagem para depois.
    const permissao = await permissoesDoCockpit(context.userId);
    if (!permissao) return { ok: false as const, motivo: "sem-permissao" };

    const { getFinanceiroAdmin } = await import(
      "@/integrations/supabase/client.financeiro.server"
    );
    const admin = getFinanceiroAdmin();
    if (!admin) return { ok: false as const, motivo: "nao-configurado" };

    try {
      // Garante o usuário ANTES de gerar o token. `generateLink` cria sozinho
      // quando não existe, mas cria com e-mail NÃO confirmado — e depender do
      // verifyOtp para confirmar depois é frágil. Aqui a confirmação é
      // explícita: a identidade já foi verificada no Ops, então o e-mail é
      // confiável por construção.
      const criado = await admin.auth.admin.createUser({ email, email_confirm: true });
      const jaExistia =
        criado.error && /already|exists|registered/i.test(criado.error.message);

      if (criado.error && !jaExistia) {
        console.warn("[financeiro] criar usuário falhou:", criado.error.message);
        return { ok: false as const, motivo: "criar-usuario" };
      }

      // Usuário anterior pode ter sido criado sem confirmação (por um
      // generateLink de antes desta correção) — normaliza.
      if (jaExistia) {
        const { data: lista } = await admin.auth.admin.listUsers();
        const existente = lista?.users?.find(
          (u) => u.email?.toLowerCase() === email.toLowerCase(),
        );
        if (existente && !existente.email_confirmed_at) {
          await admin.auth.admin.updateUserById(existente.id, { email_confirm: true });
        }
      }

      // Grava a concessão no app_metadata ANTES de gerar o token, para que ela
      // já vá dentro do JWT. app_metadata (e não user_metadata) porque só o
      // service role escreve nele — o usuário não consegue alterar a própria
      // permissão pelo cliente.
      const alvo = (await admin.auth.admin.listUsers()).data?.users?.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase(),
      );
      if (alvo) {
        await admin.auth.admin.updateUserById(alvo.id, {
          app_metadata: {
            brain: {
              financeiro: true,
              escopos: permissao.escopos,
              // `tudo` decidido aqui, e não contado no cockpit contra uma lista
              // local. A lista de lá envelhece: NEO existia com nove telas e
              // ficou de fora dela, então dava 403 para quem tinha acesso a
              // tudo. Quem concede é quem sabe quantas unidades existem.
              tudo: permissao.tudo,
            },
          },
        });
      }

      const r = await admin.auth.admin.generateLink({ type: "magiclink", email });
      const tokenHash = r.data?.properties?.hashed_token;
      if (r.error || !tokenHash) {
        console.warn("[financeiro] generateLink falhou:", r.error?.message);
        return { ok: false as const, motivo: "gerar-token" };
      }

      return { ok: true as const, tokenHash };
    } catch (err) {
      // Best-effort de propósito: o acesso ao Ops não pode cair porque o
      // Financial está fora do ar.
      console.warn("[financeiro] emissão de sessão falhou:", err);
      return { ok: false as const, motivo: "excecao" };
    }
  });
