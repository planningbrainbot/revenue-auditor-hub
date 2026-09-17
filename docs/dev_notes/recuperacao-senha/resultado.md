# Recuperação de senha e e-mail — 17/09/2026

## Pedido e diagnóstico

O usuário relatou “expirado ou inválido” **ao abrir** o link de “Esqueceu a senha?”. A configuração em produção do Supabase unificado já usava Resend, remetente `noreply@planningbrain.com.br`, link próprio com `TokenHash` no fragmento e validade de 3.600 segundos. Não se confirmou uma configuração de validade incorreta nem consumo por scanner.

Antes da alteração, os testes com conta sintética passaram tanto com link administrativo quanto com token emitido pelo botão “Esqueceu a senha?” em produção. Portanto, sem o e-mail específico que apresentou o erro, a causa daquele incidente permanece não confirmada. Não declarar que o SMTP ou a expiração foram a causa.

A revisão identificou fragilidades concretas: o leitor recusava separadores HTML/fragmentos inteiros codificados; removia imediatamente o token da URL (um recarregamento perdia o link); links legados dependiam de uma corrida entre a detecção automática do SDK e a leitura da sessão; e qualquer link ilegível recebia a mensagem genérica de expirado. O e-mail não tinha alternativa ao botão.

## Implementação

- Leitor aceita o fragmento original, codificação única de encaminhamento, entidades HTML e formato por query já suportado; continua exigindo tipo `recovery`.
- Detecção automática de sessão desabilitada somente na rota de recuperação. Links legados completos são confirmados explicitamente ao salvar a senha.
- Fragmento permanece até concluir a alteração; não é enviado ao servidor HTTP. A página usa `no-referrer` e não registra o token. Após sucesso/expiração confirmada, a URL é limpa.
- Verificação de token/código ocorre somente ao salvar; identidade conferida antes de atualizar a senha. Duplo clique é bloqueado. Uma senha recusada pode ser corrigida sem reutilizar o OTP.
- E-mail do Supabase inclui **link e código**, ambos do mesmo pedido e de uso único. A tela oferece “Usar código do e-mail”, mesmo sem link legível. Validade continua em 1 hora.
- Layout usa logo PNG própria, cores do design system, hierarquia de texto, CTA destacado, preheader, tabelas/estilos inline e fallback de fonte para clientes de e-mail. O mesmo layout atende aos envios administrativos.
- O template do Supabase é gerado por `node scripts/auth/generate-recovery-template.mjs`; `--check` detecta divergência. Publicar código no Vercel **não atualiza sozinho** o template hospedado: aplicar `mailer_templates_recovery_content` e assunto no projeto unificado após publicar a tela.

## Validação

- 18 testes automatizados: isolamento do token, encaminhamento, tipo do OTP, sessão de outra conta, link/código/legado, erro de rede, expiração, senha repetida, duplo clique e template.
- Navegador local: link real de conta sintética, dois recarregamentos, nenhuma verificação antes de salvar, alteração e login com senha nova. Também passou recuperação real por código.
- Prévia de e-mail conferida em 800 e 375 px, sem rolagem horizontal. Isso não equivale a homologação em todos os clientes Outlook/Gmail.
- Build Vite/Nitro aprovado. ESLint dos arquivos de funcionalidade aprovado. TypeScript do repositório tem erros preexistentes fora dos arquivos alterados.
- Nenhuma senha de usuário real alterada. Envio de teste somente ao simulador oficial `delivered+…@resend.dev`. Nenhuma mensagem reenviada a colaboradores.

## Fontes técnicas

- [Supabase — templates e riscos de prefetch](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Resend — destinatários de simulação](https://resend.dev/)
