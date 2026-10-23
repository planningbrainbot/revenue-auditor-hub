"""Comissões do time comercial (Ops), fatia 1: prévia, revisão dos líderes e visão do vendedor.

Critérios de aceite do PRD (wiki/prds/2026-10-comissoes-v1.md): CA-01 a CA-08, CA-15 e CA-16,
mais as regras de permissão e de só inclusão. Cada teste monta contratos e apurações fictícios
dentro da transação desfeita no fim, e fixa o "hoje" do módulo para o calendário ser previsível.
"""

import json
from decimal import Decimal

import psycopg
import pytest

APP = None
ROTINAS = None


class Comissoes:
    def __init__(self, rede):
        self.rede = rede
        self.cur = rede.cur
        for t in ("linhas", "eventos"):
            self.cur.execute(f"alter table comissoes.{t} disable trigger user")
        self.cur.execute(
            "delete from comissoes.eventos; delete from comissoes.linhas; delete from comissoes.marcos;"
            "delete from comissoes.parcela_escolhida; delete from comissoes.meses; delete from comissoes.pessoas;"
            "delete from comissoes.execucoes;"
            # A semente da homologação também tem contratos e apurações fictícios: cada teste parte do zero.
            "delete from ops.royalties_itens; delete from ops.royalties_apuracao; delete from ops.contratos;"
        )
        for t in ("linhas", "eventos"):
            self.cur.execute(f"alter table comissoes.{t} enable trigger user")
        self.lider = rede._ator("view.comissoes", "manage.comissoes_revisao")
        self.financeiro = rede._ator("view.comissoes", "manage.comissoes_fechamento")
        self.vendedor = rede._ator("view.comissoes")
        self.outro = rede._ator("view.comissoes")
        self.hoje("2026-11-03")
        self._id = 880000

    def hoje(self, dia):
        self.cur.execute(
            "create or replace function comissoes.hoje() returns date language sql stable "
            f"set search_path = comissoes, pg_temp as $$ select date '{dia}' $$"
        )

    def contrato(self, unidade, mrr, ganho, closer="Closer Teste", sdr="SDR Teste", pipe="inside_sales", assinatura=None):
        self._id += 1
        self.cur.execute(
            "insert into ops.contratos (id, titulo, unidade, mrr_mensal, ganho_em, status_contrato, origem_pipeline,"
            " closer, sdr, entrada_contrato_assinado_em) values (%s, %s, %s, %s, %s, 'Ativo', %s, %s, %s, %s)",
            (self._id, f"Cliente {self._id}", unidade, mrr, ganho, pipe, closer, sdr, assinatura),
        )
        return self._id

    def apuracao(self, unidade, mes, status="confirmado"):
        self._id += 1
        self.cur.execute("select id from ops.unidades where nome_da_praca = %s", (unidade,))
        self.cur.execute(
            "insert into ops.royalties_apuracao (id, unidade_id, mes_referencia, status, cac_valor) values (%s, %s, %s, %s, 1)",
            (self._id, self.cur.fetchone()[0], mes, status),
        )
        return self._id

    def item(self, apuracao, contrato, parcela, valor=1000):
        self._id += 1
        self.cur.execute(
            "insert into ops.royalties_itens (id, apuracao_id, contrato_id, is_cac, cac_parcela, royalties_item)"
            " values (%s, %s, %s, true, %s, %s)",
            (self._id, apuracao, contrato, parcela, valor),
        )
        return self._id

    def previa(self):
        return self.rede.como_backend("select comissoes.gerar_previa()", papel=ROTINAS)[0][0]

    def chamar(self, sql, params=()):
        r = self.rede.como_backend(sql, params, papel=APP)
        return r[0][0] if r else None

    def linhas(self, contrato=None):
        self.cur.execute(
            "select l.tipo, l.papel, l.metade, l.valor, l.mes::text, p.nome, l.percentual from comissoes.linhas l"
            " join comissoes.pessoas p on p.id = l.pessoa_id"
            " where %s::int is null or l.contrato_id = %s order by l.papel, l.metade, l.id",
            (contrato, contrato),
        )
        return self.cur.fetchall()

    def vincular(self, nome, usuario):
        self.cur.execute("update comissoes.pessoas set usuario_id = %s where nome = %s", (usuario, nome))


@pytest.fixture
def com(rede):
    return Comissoes(rede)


def test_ca01_primeira_parcela_gera_a_primeira_metade_no_mes_seguinte(com):
    c = com.contrato("Maceió", 6400, "2026-10-03")
    com.item(com.apuracao("Maceió", "2026-10-01"), c, 1, 3200)
    assert com.previa()["linhas_novas"] == 2
    assert com.linhas(c) == [
        ("comissao", "closer", 1, Decimal("224.00"), "2026-11-01", "Closer Teste", Decimal("7.00")),
        ("comissao", "sdr", 1, Decimal("160.00"), "2026-11-01", "SDR Teste", Decimal("5.00")),
    ]


def test_ca02_cac_integral_gera_as_duas_metades_no_mesmo_pagamento(com):
    c = com.contrato("São Luis", 11250, "2026-10-08")
    com.item(com.apuracao("São Luis", "2026-10-01"), c, 3, 11250)
    com.previa()
    closer = [x for x in com.linhas(c) if x[1] == "closer"]
    assert [(x[2], x[3], x[4]) for x in closer] == [(1, Decimal("393.75"), "2026-11-01"), (2, Decimal("393.75"), "2026-11-01")]


def test_ca03_unidade_sem_cac_paga_as_duas_metades_quando_o_cliente_paga(com):
    c = com.contrato("Curitiba", 2400, "2026-10-10")
    com.previa()
    assert com.linhas(c) == []
    # Só o financeiro registra a data (P-03).
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        com.chamar("select comissoes.registrar_data(%s, %s, 'pagamento_cliente', '2026-10-28')", (com.lider, c))
    assert com.chamar("select comissoes.registrar_data(%s, %s, 'pagamento_cliente', '2026-10-28')", (com.financeiro, c)) == 4
    assert {(x[1], x[2], x[4]) for x in com.linhas(c)} == {
        ("closer", 1, "2026-11-01"),
        ("closer", 2, "2026-11-01"),
        ("sdr", 1, "2026-11-01"),
        ("sdr", 2, "2026-11-01"),
    }


def test_ca04_recife_primeira_metade_pela_assinatura_e_segunda_pelo_cac(com):
    c = com.contrato("Recife", 1000, "2026-10-20", assinatura="2026-10-21")
    # A entrada no estágio do Pipedrive não conta como assinatura: só a data registrada.
    com.previa()
    assert com.linhas(c) == []
    com.chamar("select comissoes.registrar_data(%s, %s, 'assinatura', '2026-10-21')", (com.financeiro, c))
    assert {(x[1], x[2], x[4]) for x in com.linhas(c)} == {("closer", 1, "2026-11-01"), ("sdr", 1, "2026-11-01")}
    com.hoje("2026-12-02")
    com.item(com.apuracao("Recife", "2026-11-01"), c, None, 400)  # parcela nula também libera a 2ª (R-06)
    com.previa()
    assert {(x[1], x[2], x[4]) for x in com.linhas(c) if x[2] == 2} == {("closer", 2, "2026-12-01"), ("sdr", 2, "2026-12-01")}


def test_ca05_regra_antiga_nao_gera_sozinha_e_o_lider_inclui(com):
    c = com.contrato("Maceió", 4300, "2026-09-20")
    com.item(com.apuracao("Maceió", "2026-10-01"), c, 2, 2150)
    com.previa()
    assert com.linhas(c) == []
    pend = com.chamar("select comissoes.revisao(%s, '2026-11-01')", (com.lider,))["pendencias"]
    assert [p["contrato_id"] for p in pend["regra_antiga"]] == [c]
    assert com.chamar("select comissoes.incluir_metade(%s, %s, 2::smallint, 'pendente da regra antiga')", (com.lider, c)) == 2


def test_ca06_o_que_chega_depois_da_liberacao_ou_do_prazo_vai_para_o_mes_seguinte(com):
    a = com.apuracao("Maceió", "2026-10-01")
    com.item(a, com.contrato("Maceió", 2000, "2026-10-02"), 1)
    com.previa()
    com.chamar("select comissoes.liberar_mes(%s, '2026-11-01')", (com.lider,))
    tarde = com.contrato("Maceió", 3000, "2026-10-05")
    com.item(a, tarde, 1)
    com.previa()
    assert {x[4] for x in com.linhas(tarde)} == {"2026-12-01"}
    # Prazo: 10/11/2026 é terça; no dia 11 o mês de novembro não aceita mais nada.
    com.hoje("2026-11-11")
    depois = com.contrato("Fortaleza", 3000, "2026-10-06")
    com.item(com.apuracao("Fortaleza", "2026-10-01"), depois, 1)
    com.previa()
    assert {x[4] for x in com.linhas(depois)} == {"2026-12-01"}


def test_prazo_e_pagamento_voltam_para_o_dia_util_anterior(com):
    # Prazo dos líderes: dia 10 ou o útil anterior. Envio ao DP: dia 11 ou o próximo útil. Pagamento: dia 20
    # ou o útil anterior (20/11/2026 é feriado nacional; 20/12/2026 é domingo).
    com.cur.execute(
        "select comissoes.prazo('2027-01-01'), comissoes.prazo('2026-11-01'), comissoes.envio_dp_em('2027-09-01'),"
        " comissoes.pagamento_em('2026-11-01'), comissoes.pagamento_em('2026-12-01'), comissoes.pagamento_em('2027-05-01')"
    )
    assert [str(d) for d in com.cur.fetchone()] == ["2027-01-08", "2026-11-10", "2027-09-13", "2026-11-19", "2026-12-18", "2027-05-20"]


def test_ca07_ajuste_do_lider_grava_linha_e_evento_e_para_no_prazo(com):
    c = com.contrato("Maceió", 6400, "2026-10-03")
    com.item(com.apuracao("Maceió", "2026-10-01"), c, 1)
    com.previa()
    com.cur.execute("select id from comissoes.linhas where contrato_id = %s and papel = 'closer'", (c,))
    linha = com.cur.fetchone()[0]
    com.hoje("2026-11-09")
    r = com.chamar("select comissoes.ajustar_linha(%s, %s, 6400::numeric, 5::numeric, 'meta não batida')", (com.lider, linha))
    assert r["mes"] == "2026-11-01"
    com.cur.execute("select valor from comissoes.linhas where tipo = 'ajuste' and origem_id = %s", (linha,))
    assert com.cur.fetchone()[0] == Decimal("-64.00")
    com.cur.execute("select antes, depois from comissoes.eventos where linha_id = %s and acao = 'ajustada'", (linha,))
    antes, depois = com.cur.fetchone()
    assert (antes["percentual"], depois["percentual"], depois["valor"]) == (7.0, 5, 160.0)
    com.cur.execute("select comissoes.total_do_mes('2026-11-01')")
    assert com.cur.fetchone()[0] == Decimal("320.00")
    # Depois do dia 10 o mês de novembro não aceita mais nada; a correção vira ajuste em dezembro (R-12).
    com.hoje("2026-11-11")
    r = com.chamar("select comissoes.ajustar_linha(%s, %s, 6400::numeric, 7::numeric, 'volta')", (com.lider, linha))
    assert r["mes"] == "2026-12-01"
    com.cur.execute("select id from comissoes.pessoas where nome = 'Closer Teste'")
    pessoa = com.cur.fetchone()[0]
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="não aceita mudança"):
        com.chamar(
            "select comissoes.lancar_bonus(%s, %s, '2026-11-01', 100::numeric, 'tarde', 'chave-bonus-2')", (com.lider, pessoa)
        )


def test_ca08_vendedor_so_ve_o_proprio_e_so_depois_de_liberado(com):
    c = com.contrato("Maceió", 6400, "2026-10-03", closer="Closer Um", sdr="SDR Um")
    outro = com.contrato("Maceió", 5000, "2026-10-04", closer="Closer Dois", sdr="SDR Um")
    a = com.apuracao("Maceió", "2026-10-01")
    com.item(a, c, 1)
    com.item(a, outro, 1)
    assert com.chamar("select comissoes.minhas_comissoes(%s)", (com.vendedor,)) == {"vinculado": False}
    com.previa()
    com.vincular("Closer Um", com.vendedor)
    r = com.chamar("select comissoes.minhas_comissoes(%s)", (com.vendedor,))
    assert r["proximo"]["situacao"] == "previa" and r["proximo"]["linhas"] == [] and r["proximo"]["total"] is None
    assert [(d["metade"], d["motivo"]) for d in r["depois"]] == [(2, "Aguardando o cliente pagar o 1º honorário")]
    com.chamar("select comissoes.liberar_mes(%s, '2026-11-01')", (com.lider,))
    r = com.chamar("select comissoes.minhas_comissoes(%s)", (com.vendedor,))
    assert r["proximo"]["total"] == 224.0
    assert {x["cliente"] for x in r["proximo"]["linhas"]} == {f"Cliente {c}"}


def test_vendedor_nao_le_revisao_nem_muda_nada(com):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        com.chamar("select comissoes.revisao(%s, '2026-11-01')", (com.vendedor,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        com.chamar("select comissoes.liberar_mes(%s, '2026-11-01')", (com.vendedor,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        com.chamar("select comissoes.marcar_pago(%s, '2026-11-01')", (com.lider,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        com.chamar("select comissoes.minhas_comissoes(%s)", (com.rede.estranho,))


def test_ca15_parcela_a_definir_unidades_sem_cac_e_patos_abaixo_do_minimo(com):
    a = com.apuracao("Maceió", "2026-10-01")
    sem = com.contrato("Maceió", 2000, "2026-10-02")
    item = com.item(a, sem, None)
    matriz = com.contrato("Matriz", 9000, "2026-10-12")
    patos = com.contrato("Patos de Minas", 8000, "2026-10-12")
    com.previa()
    assert com.linhas(sem) == []
    pend = com.chamar("select comissoes.revisao(%s, '2026-11-01')", (com.lider,))["pendencias"]
    assert [p["item_id"] for p in pend["sem_parcela"]] == [item]
    assert {p["contrato_id"] for p in pend["aguardando_data"]} >= {matriz, patos}
    assert com.chamar("select comissoes.escolher_parcela(%s, %s, 3::smallint)", (com.lider, item)) == 4
    for c, regra in ((matriz, "sem_cac"), (patos, "sem_cac")):
        com.cur.execute("select comissoes.regra_do_contrato(%s)", (c,))
        assert com.cur.fetchone()[0] == regra


def test_ca16_rotina_nao_desfaz_exclusao_do_lider_e_e_idempotente(com):
    c = com.contrato("Maceió", 6400, "2026-10-03")
    com.item(com.apuracao("Maceió", "2026-10-01"), c, 1)
    com.previa()
    com.cur.execute("select id from comissoes.linhas where contrato_id = %s and papel = 'sdr'", (c,))
    linha = com.cur.fetchone()[0]
    com.chamar("select comissoes.excluir_linha(%s, %s, 'SDR não participou')", (com.lider, linha))
    assert com.previa()["linhas_novas"] == 0
    assert len(com.linhas(c)) == 2
    com.cur.execute("select comissoes.total_do_mes('2026-11-01')")
    assert com.cur.fetchone()[0] == Decimal("224.00")


def test_segunda_metade_segue_a_pessoa_e_o_percentual_da_primeira(com):
    c = com.contrato("Maceió", 6400, "2026-10-03", closer="Closer Original")
    com.item(com.apuracao("Maceió", "2026-10-01"), c, 1)
    com.previa()
    com.cur.execute("select id from comissoes.linhas where contrato_id = %s and papel = 'closer'", (c,))
    com.chamar("select comissoes.ajustar_linha(%s, %s, 6400::numeric, 10::numeric, 'acordo')", (com.lider, com.cur.fetchone()[0]))
    com.cur.execute("update ops.contratos set closer = 'Closer Novo' where id = %s", (c,))
    com.hoje("2026-12-02")
    com.item(com.apuracao("Maceió", "2026-11-01"), c, 2)
    com.previa()
    segunda = [x for x in com.linhas(c) if x[0] == "comissao" and x[1] == "closer" and x[2] == 2]
    assert [(x[5], x[6], x[3]) for x in segunda] == [("Closer Original", Decimal("10.00"), Decimal("320.00"))]


def test_bonus_liberar_pagar_reabrir_e_exportar(com):
    c = com.contrato("Maceió", 6400, "2026-10-03")
    com.item(com.apuracao("Maceió", "2026-10-01"), c, 1)
    com.previa()
    com.cur.execute("select id from comissoes.pessoas where nome = 'Closer Teste'")
    pessoa = com.cur.fetchone()[0]
    bonus = "select comissoes.lancar_bonus(%s, %s, '2026-11-01', 300::numeric, 'meta individual', 'chave-bonus-1')"
    # Pedido repetido com a mesma chave lança um bônus só.
    assert com.chamar(bonus, (com.lider, pessoa)) == com.chamar(bonus, (com.lider, pessoa))
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
        com.chamar("select comissoes.marcar_pago(%s, '2026-11-01')", (com.financeiro,))
    com.chamar("select comissoes.liberar_mes(%s, '2026-11-01')", (com.lider,))
    com.chamar("select comissoes.reabrir_mes(%s, '2026-11-01', 'faltou um bônus')", (com.financeiro,))
    com.chamar("select comissoes.liberar_mes(%s, '2026-11-01')", (com.lider,))
    com.chamar("select comissoes.marcar_pago(%s, '2026-11-01')", (com.financeiro,))
    r = com.chamar("select comissoes.exportar_mes(%s, '2026-11-01')", (com.financeiro,))
    assert (r["situacao"], r["total"]) == ("pago", 684.0)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        com.chamar("select comissoes.exportar_mes(%s, '2026-11-01')", (com.lider,))


def test_linhas_e_eventos_sao_so_inclusao(com):
    c = com.contrato("Maceió", 6400, "2026-10-03")
    com.item(com.apuracao("Maceió", "2026-10-01"), c, 1)
    com.previa()
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="só inclusão"):
        com.rede.como_backend("update comissoes.linhas set valor = 0", papel="postgres")
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="só inclusão"):
        com.rede.como_backend("delete from comissoes.eventos", papel="postgres")
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match="só inclusão"):
        com.rede.como_backend("truncate comissoes.linhas cascade", papel="postgres")


def test_vinculo_so_com_quem_tem_a_chave(com):
    com.contrato("Maceió", 6400, "2026-10-03", closer="Closer Vinculo")
    com.cur.execute("select comissoes.pessoa_de('Closer Vinculo')")
    pessoa = com.cur.fetchone()[0]
    # Na convivência, app.usuarios_com lê o login do Supabase Auth.
    com.cur.execute("insert into auth.users (id, email) values (%s, 'vendedor@teste.invalid')", (com.vendedor,))
    with pytest.raises(psycopg.errors.InvalidParameterValue):
        com.chamar("select comissoes.vincular_pessoa(%s, %s, %s)", (com.lider, pessoa, com.rede.estranho))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        com.chamar("select comissoes.vincular_pessoa(%s, %s, %s)", (com.vendedor, pessoa, com.vendedor))
    com.chamar("select comissoes.vincular_pessoa(%s, %s, %s)", (com.lider, pessoa, com.vendedor))
    com.cur.execute("select acao, depois from comissoes.eventos where pessoa_id = %s", (pessoa,))
    assert com.cur.fetchall() == [("vinculo", {"usuario": com.vendedor})]
    assert json.dumps(com.chamar("select comissoes.meu_perfil(%s)", (com.vendedor,))["pessoa"]) == '"Closer Vinculo"'


def test_pessoa_trocada_segue_a_primeira_e_aparece_na_revisao(com):
    c = com.contrato("Maceió", 6400, "2026-10-03", closer="Closer Antigo")
    com.item(com.apuracao("Maceió", "2026-10-01"), c, 1)
    com.previa()
    com.vincular("Closer Antigo", com.vendedor)
    com.cur.execute("update ops.contratos set closer = 'Closer Novo' where id = %s", (c,))
    com.cur.execute("select comissoes.pessoa_de('Closer Novo')")
    com.vincular("Closer Novo", com.outro)
    pend = com.chamar("select comissoes.revisao(%s, '2026-11-01')", (com.lider,))["pendencias"]
    assert [(p["na_linha"], p["no_pipedrive"]) for p in pend["pessoa_trocada"]] == [("Closer Antigo", "Closer Novo")]
    # A 2ª metade estimada continua com quem recebeu a 1ª, e não aparece para a pessoa nova.
    antigo = com.chamar("select comissoes.minhas_comissoes(%s)", (com.vendedor,))["depois"]
    novo = com.chamar("select comissoes.minhas_comissoes(%s)", (com.outro,))["depois"]
    assert [d["metade"] for d in antigo] == [2] and novo == []


def test_ca14_trava_da_previa(com):
    from conftest import URL
    c = com.contrato("Maceió", 6400, "2026-10-03")
    com.item(com.apuracao("Maceió", "2026-10-01"), c, 1)
    assert com.previa()["linhas_novas"] == 2
    with psycopg.connect(URL, autocommit=True) as outra:
        assert outra.execute("select pg_try_advisory_xact_lock(hashtext('comissoes.gerar_previa'))").fetchone() == (False,)
    assert com.previa()["linhas_novas"] == 0


def test_porta_ops_so_para_quem_deve(com):
    com.cur.execute("""select has_function_privilege('authenticated', 'ops.comissoes_minhas()', 'execute'),
                              has_function_privilege('anon', 'ops.comissoes_minhas()', 'execute'),
                              has_function_privilege('authenticated', 'ops.comissoes_gerar_previa()', 'execute'),
                              has_function_privilege('service_role', 'ops.comissoes_gerar_previa()', 'execute'),
                              has_function_privilege('authenticated', 'comissoes.minhas_comissoes(uuid)', 'execute'),
                              has_table_privilege('authenticated', 'comissoes.linhas', 'select'),
                              has_schema_privilege('authenticated', 'comissoes', 'usage')""")
    assert com.cur.fetchone() == (True, False, False, True, False, False, False)
    com.cur.execute("select count(*) from ops.area_chaves where area = 'receita' and permission_key = 'view.comissoes'")
    assert com.cur.fetchone()[0] == 0
