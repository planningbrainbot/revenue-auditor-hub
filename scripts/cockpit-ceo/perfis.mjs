// Homologação de permissões do Cockpit do CEO com perfis reais, sem trocar de identidade de verdade.
//
// Para cada perfil, dentro de `begin transaction read only`: `set local role authenticated` e o JWT
// simulado com o id da pessoa (o mesmo padrão que o DECISIONS.md registra para validar RLS). Mede o
// que a RLS entrega (negócios, contas, manifesto da carteira) e as chaves que o cockpit consulta, e
// deduz o estado que a tela mostraria. Sai só o rótulo do perfil: nenhum nome, e-mail ou id.
import { mkdirSync, writeFileSync } from "node:fs";
import { consultar } from "./brain-ro.mjs";
import { PORTAS, fontesSemAcesso } from "../../src/lib/cockpit-ceo/portas.ts";

// Porta × RLS (rodada 2): para cada fonte do cockpit, a porta de portas.ts diz se a pessoa lê a
// tabela inteira. Se a porta abre (e a pessoa vê todas as unidades), a RLS tem de entregar tudo —
// senão o cockpit mostraria número incompleto como completo. Porta fechada com RLS aberta é só
// conservadorismo (acesso insuficiente a mais), registrado mas não é divergência.
const FONTES = Object.keys(PORTAS);
const contar = FONTES.map((f) => `(select count(*) from ops.${f})::int "${f}"`).join(", ");
const [totais] = await consultar(`select ${contar}`, { transacaoSomenteLeitura: true });

const UUID = /^[0-9a-f-]{36}$/;
const perfis = await consultar(
  `select 'super admin' rotulo, (select user_id::text from ops.user_roles where role='admin' order by user_id limit 1) id
   union all
   select 'sócio regional', (select user_id::text from ops.user_roles where role='socio_regional' order by user_id limit 1)
   union all
   select 'diretor (rede toda)', (select r.user_id::text from ops.user_roles r join ops.usuario_escopo e on e.user_id = r.user_id
      where r.role = 'diretor' and e.todas_unidades
        and not exists (select 1 from ops.user_roles x where x.user_id = r.user_id and x.role = 'admin') order by 1 limit 1)
   union all
   select 'financeiro (rede toda)', (select r.user_id::text from ops.user_roles r join ops.usuario_escopo e on e.user_id = r.user_id
      where r.role = 'financeiro' and e.todas_unidades
        and not exists (select 1 from ops.user_roles x where x.user_id = r.user_id and x.role = 'admin') order by 1 limit 1)
   union all
   select 'cs (rede toda)', (select r.user_id::text from ops.user_roles r join ops.usuario_escopo e on e.user_id = r.user_id
      where r.role = 'cs' and e.todas_unidades
        and not exists (select 1 from ops.user_roles x where x.user_id = r.user_id and x.role = 'admin') order by 1 limit 1)
   union all
   select 'hunter_monetizacao (rede toda)', (select r.user_id::text from ops.user_roles r join ops.usuario_escopo e on e.user_id = r.user_id
      where r.role = 'hunter_monetizacao' and e.todas_unidades
        and not exists (select 1 from ops.user_roles x where x.user_id = r.user_id and x.role = 'admin') order by 1 limit 1)
   union all
   select 'auditor (rede toda)', (select r.user_id::text from ops.user_roles r join ops.usuario_escopo e on e.user_id = r.user_id
      where r.role = 'auditor' and e.todas_unidades
        and not exists (select 1 from ops.user_roles x where x.user_id = r.user_id and x.role = 'admin') order by 1 limit 1)
   union all
   select 'conta sem papel', (select u.id::text from auth.users u
      where not exists (select 1 from ops.user_roles r where r.user_id = u.id) order by u.created_at limit 1)`,
  { transacaoSomenteLeitura: true },
);

const resultado = [];
for (const p of perfis) {
  if (!p.id || !UUID.test(p.id)) {
    resultado.push({ perfil: p.rotulo, observacao: "nenhuma conta com esse perfil" });
    continue;
  }
  const claims = JSON.stringify({ sub: p.id, role: "authenticated" }).replace(/'/g, "''");
  const [r] = await consultar(
    `set local role authenticated;
     set local request.jwt.claims to '${claims}';
     select ops.monetizacao_can('view.aquario') aquario,
            ops.monetizacao_can('view.monetizacao') monetizacao,
            ops.monetizacao_can('view.clientes') clientes,
            (select count(*) from ops.monetizacao_deals)::int negocios_visiveis,
            (select count(*) from ops.monetizacao_contas)::int contas_visiveis,
            (select jsonb_path_query_array(ops.acesso_do_usuario('${p.id}'::uuid)->'areas', '$[*]')) areas`,
    { transacaoSomenteLeitura: true },
  ).catch((e) => [{ erro: e.message.slice(0, 200) }]);
  let manifesto = null;
  if (!r.erro && (r.aquario || r.monetizacao || r.clientes)) {
    const [m] = await consultar(
      `set local role authenticated;
       set local request.jwt.claims to '${claims}';
       select (ops.base_carteira_manifesto()->>'count')::int contas_no_manifesto`,
      { transacaoSomenteLeitura: true },
    ).catch((e) => [{ erro: e.message.slice(0, 160) }]);
    manifesto = m;
  }
  // Papéis e escopo pela transação de leitura; chaves como a própria pessoa (a função recusa terceiros).
  const [chaves] = await consultar(
    `select array(select role::text from ops.user_roles where user_id = '${p.id}'::uuid) roles,
            coalesce((select todas_unidades from ops.usuario_escopo where user_id = '${p.id}'::uuid), false) todas_unidades`,
    { transacaoSomenteLeitura: true },
  );
  const [perm] = await consultar(
    `set local role authenticated;
     set local request.jwt.claims to '${claims}';
     select coalesce(ops.acesso_do_usuario('${p.id}'::uuid)->'permissions', '[]'::jsonb) permissions`,
    { transacaoSomenteLeitura: true },
  );
  chaves.permissions = perm.permissions;
  const [vistos] = await consultar(
    `set local role authenticated;
     set local request.jwt.claims to '${claims}';
     select ${contar}`,
    { transacaoSomenteLeitura: true },
  ).catch((e) => [{ erro: e.message.slice(0, 160) }]);
  const fechadas = new Set(
    fontesSemAcesso(FONTES, { roles: chaves.roles, permissions: chaves.permissions }),
  );
  const portas = Object.fromEntries(
    FONTES.map((f) => {
      const abre = !fechadas.has(f) && chaves.todas_unidades;
      const inteira = vistos[f] === totais[f];
      return [
        f,
        {
          porta: abre ? "abre" : "fecha",
          rls_ve: vistos.erro ? "erro" : `${vistos[f]}/${totais[f]}`,
          coerencia:
            abre && !inteira
              ? "DIVERGE: porta abre e a RLS não entrega tudo"
              : abre
                ? "ok"
                : inteira
                  ? "conservadora"
                  : "ok",
        },
      ];
    }),
  );
  const acessoBase = !!(r.aquario || r.clientes);
  const acessoNegocios = !!(r.aquario || r.monetizacao);
  const temArea = Array.isArray(r.areas) && r.areas.includes("cockpit_ceo");
  resultado.push({
    perfil: p.rotulo,
    chaves: { aquario: r.aquario, monetizacao: r.monetizacao, clientes: r.clientes },
    rls: { negocios_visiveis: r.negocios_visiveis, contas_visiveis: r.contas_visiveis, manifesto },
    area_cockpit_ceo: temArea,
    cockpit_mostraria: !temArea
      ? "tela de sem acesso à área (nenhuma carga)"
      : !acessoBase && !acessoNegocios
        ? "acesso insuficiente em todos os números (sem carga)"
        : {
            comerciais: r.monetizacao ? "números" : "acesso insuficiente",
            contas_prontas: !acessoBase
              ? "acesso insuficiente"
              : !acessoNegocios
                ? "acesso insuficiente (sem negócios)"
                : "números",
          },
    coerencia:
      // A premissa do cockpit: sem aquario/monetizacao a RLS não entrega negócios.
      acessoNegocios || r.negocios_visiveis === 0
        ? "ok"
        : "DIVERGE: sem as chaves de negócios, a RLS entregou negócios",
    todas_unidades: chaves.todas_unidades,
    portas,
    erro: r.erro,
  });
}

mkdirSync("docs/dev_notes/cockpit-ceo-piloto/homologacao", { recursive: true });
const arquivo = `docs/dev_notes/cockpit-ceo-piloto/homologacao/perfis-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(
  arquivo,
  JSON.stringify({ quando: new Date().toISOString(), resultado }, null, 2) + "\n",
);
console.log(JSON.stringify({ arquivo, resultado }, null, 2));
