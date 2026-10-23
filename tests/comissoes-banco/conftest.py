"""Testes de banco das Comissões (PRD wiki/prds/2026-10-comissoes-v1.md), contra a migration do Ops.

Rodam no Supabase de HOMOLOGAÇÃO do sistema novo (bgkfbegutlajchwwovgm), numa transação desfeita no fim:
nada fica gravado. A réplica mínima do schema ops (replica_homologacao.sql, a mesma do planning-broker)
aborta se rodar fora da homologação. ops.areas e ops.area_chaves não existem lá e são criados aqui.

Como rodar (precisa de Python com pytest e psycopg):
    TEST_DB_URL=<postgres da homologação> pytest tests/comissoes-banco -q
"""
import os
import uuid
from pathlib import Path
import psycopg, pytest

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[1]
URL = os.environ.get("TEST_DB_URL")


class Rede:
    def __init__(self, cur):
        self.cur = cur
        self.estranho = self._ator()

    def _ator(self, *chaves):
        u = str(uuid.uuid4())
        for c in chaves:
            self.cur.execute("insert into ops.replica_chaves values (%s, %s)", (u, c))
        return u

    def como_backend(self, sql, params=(), papel=None):
        self.cur.execute("savepoint sp")
        try:
            self.cur.execute(sql, params)
            r = self.cur.fetchall() if self.cur.description else None
            self.cur.execute("release savepoint sp")
            return r
        except Exception:
            self.cur.execute("rollback to savepoint sp")
            raise


@pytest.fixture
def rede():
    if not URL:
        pytest.skip("TEST_DB_URL ausente")
    with psycopg.connect(URL, autocommit=False) as conn:
        cur = conn.cursor()
        cur.execute((AQUI / "replica_homologacao.sql").read_text())
        cur.execute("drop schema if exists comissoes cascade")
        cur.execute("""
          create table if not exists ops.areas (slug text primary key, nome text, descricao text, escopo text, ordem int, ativa boolean);
          create table if not exists ops.area_chaves (area text, permission_key text, primary key (area, permission_key));
        """)
        cur.execute((RAIZ / "supabase/migrations/20261023120000_comissoes_base.sql").read_text())
        yield Rede(cur)
        conn.rollback()
