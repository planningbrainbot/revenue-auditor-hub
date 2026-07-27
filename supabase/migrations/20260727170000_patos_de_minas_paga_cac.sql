-- Patos de Minas passa a fazer parte da regra de CAC (excedente mensal
-- acima de R$10 mil de MRR atribuído) definida com o usuário em 27/07/2026.
-- Sem esse flag, a unidade fica de fora da listagem de CAC
-- (listCacItensTodasUnidades filtra por paga_cac = true).

UPDATE public.unidades
SET paga_cac = true
WHERE nome_da_praca = 'Patos de Minas';
