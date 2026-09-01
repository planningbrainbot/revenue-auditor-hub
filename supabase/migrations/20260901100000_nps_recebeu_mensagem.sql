-- Pergunta nova no "Registrar resposta colhida por telefone": o cliente
-- confirma ter recebido a mensagem de WhatsApp da pesquisa? É a única forma
-- de checar entrega de verdade quando a Meta suprime o status de callback
-- (ver [[project_n8n_nps_whatsapp]] — sent/delivered não confiável hoje).
alter table public.nps_pesquisas
  add column if not exists recebeu_mensagem text
    check (recebeu_mensagem in ('sim', 'nao', 'nao_lembra'));
