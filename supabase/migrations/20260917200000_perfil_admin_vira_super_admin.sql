-- O perfil `admin` passa a se chamar "Super admin" na tela (autorizado pelo
-- dono em 17/09/2026). Desde os níveis por área existe também o NÍVEL admin
-- (todas as unidades, só nas áreas liberadas), e dois "Admin" com sentidos
-- diferentes confundiam a tela de Usuários. Só o rótulo muda: a chave `admin`
-- continua a mesma, e nenhuma policy ou função olha o rótulo.
update ops.roles
   set label = 'Super admin',
       description = coalesce(nullif(description, ''), 'Acesso total. Único que nomeia admins e configura o sistema.')
 where key = 'admin';
