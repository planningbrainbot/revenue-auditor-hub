-- CS, Auditoria Interna, Reforma Tributária, NPS e Disparos de WhatsApp saem da
-- área Base de clientes e passam para a Rede, a pedido do usuário em 23/09/2026:
-- quem tem Rede abre, quem só tem Base de clientes deixa de ver.
--
-- Mover só o menu (`src/lib/areas.ts`) não bastava. `ops.can_user` concede a
-- chave a quem tem a ÁREA dona dela em `ops.area_chaves`, e os dados dessas
-- telas são lidos por essas chaves. Com o menu na Rede e as chaves em clientes,
-- quem tem só Rede veria as telas vazias, e quem tem só clientes continuaria
-- lendo os dados por baixo.
--
-- `view.painel_cs` e `view.nps` seguem também em `minha_unidade`: o sócio
-- regional continua abrindo CS e NPS da própria unidade.
--
-- `send.whatsapp` não muda. Disparar continua na área `disparos_whatsapp`, só
-- do super admin desde 17/09/2026, porque disparo custa por conversa e fala com
-- o cliente em nome da rede.

update ops.area_chaves
   set area = 'rede'
 where area = 'clientes'
   and permission_key in (
     'view.painel_cs',
     'view.auditoria_interna',
     'view.reforma_tributaria',
     'view.nps',
     'view.disparos_whatsapp'
   );
