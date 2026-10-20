"""Teste de integração do conector do Omie (T2) em simulação, contra o banco único e a edge publicada.

Ciclo: pedido de teste da DOC (CNPJ real de cliente da DOC, lido do Omie dela) → enviar → a edge faturamento-omie
processa → o pedido fica `simulado` com o payload montado → ConsultarOS no Omie da DOC prova que a OS não existe →
o pedido é descartado (devolvido e descartado, ou cancelamento pedido e efetivado), nunca apagado.

Só roda com a DOC em modo_omie = 'simular' (aborta em 'gravar'). No Omie só faz leitura (ListarClientesResumido e
ConsultarOS), com pausa. Nada de chave, token, CNPJ inteiro, nome ou e-mail de cliente vai para a saída.

Pré-requisitos: a API da T1b aplicada (integracoes.fat_* e ops.fat_*), as funções de passagem ops.fat_conector_*
(é por elas que a edge chama o banco, já que integracoes não é exposto no PostgREST), executáveis pelo service_role e
não pelo authenticated, e a edge publicada sem verify_jwt. `--verificar` só confere os pré-requisitos e não grava nada.

Token da Management API: SUPABASE_ACCESS_TOKEN do ambiente ou a linha SUPABASE_ACCESS_TOKEN= de
PM Work/execution/brain-financeiro-planning/.deploy.local.env (lida na hora, nunca impressa).

Uso: python3 -I scripts/faturamento/conector-simular-integracao.py [--verificar]
"""
import datetime as dt
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

REF = "npknehhyyzelmrbbxvtu"
EDGE = f"https://{REF}.supabase.co/functions/v1/faturamento-omie"
PEDRO = "5c4d0e46-fc33-4132-bcca-47c05ad001c7"  # admin do Brain (a única pessoa com papel na E1)
ENV = pathlib.Path(__file__).resolve().parents[3] / "brain-financeiro-planning" / ".deploy.local.env"
FUNCOES = {
    "integracoes": ["omie_credencial", "fat_envio_proximos", "fat_envio_resultado", "fat_status_aplicar",
                    "fat_status_enfileirar", "fat_servicos_aplicar"],
    "ops": ["fat_pedido_salvar", "fat_pedido_enviar", "fat_pedido", "fat_pedido_descartar", "fat_tesouraria_acao",
            "fat_pedido_cancelar", "fat_dono_salvar", "fat_dono_remover", "fat_config"],
}
PASSAGEM = ["fat_conector_credencial", "fat_conector_envio_proximos", "fat_conector_envio_resultado",
            "fat_conector_status_aplicar", "fat_conector_status_enfileirar", "fat_conector_servicos_aplicar"]


def token() -> str:
    t = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if t:
        return t
    for ln in ENV.read_text().splitlines():
        if ln.startswith("SUPABASE_ACCESS_TOKEN="):
            return ln.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("SUPABASE_ACCESS_TOKEN ausente")


def api(caminho: str, corpo=None, metodo="POST"):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}{caminho}", method=metodo,
                                 data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json",
                                          "User-Agent": "planning-t2-integracao/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Management API HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:600]}") from None


def sql(q: str):
    return api("/database/query", {"query": q})


def lit(v) -> str:
    return "'" + str(v).replace("'", "''") + "'"


def como_pedro(chamada: str):
    """Chama uma RPC de tela como o Pedro logado (authenticated + claims do JWT), numa transação da Management API."""
    claims = json.dumps({"sub": PEDRO, "role": "authenticated"})
    r = sql(f"set local role authenticated; select set_config('request.jwt.claims', {lit(claims)}, true); "
            f"select {chamada} as r;")
    v = r[-1]["r"] if r else None
    return json.loads(v) if isinstance(v, str) else v


def mascara(doc: str) -> str:
    return doc[:2] + "*" * (len(doc) - 6) + doc[-4:]


# ------------------------------------------------------------------------------------------------- Omie (só leitura)

class OmieLeitura:
    LEITURA = re.compile(r"^(Listar|Consultar|Status|Pesquisar)")

    def __init__(self, emissora_id: str):
        r = sql("set local role service_role; "
                f"select integracoes.omie_credencial({lit(emissora_id)}::uuid) as c;")
        c = r[-1]["c"]
        c = json.loads(c) if isinstance(c, str) else c
        self._k, self._s, self._ultimo = c["app_key"], c["app_secret"], 0.0

    def call(self, endpoint: str, metodo: str, param: dict):
        assert self.LEITURA.match(metodo), f"{metodo} não é leitura"
        espera = 1.5 - (time.time() - self._ultimo)
        if espera > 0:
            time.sleep(espera)
        corpo = json.dumps({"call": metodo, "app_key": self._k, "app_secret": self._s, "param": [param]}).encode()
        req = urllib.request.Request(f"https://app.omie.com.br/api/v1/{endpoint}/", data=corpo,
                                     headers={"Content-Type": "application/json", "User-Agent": "planning-t2-integracao/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                self._ultimo = time.time()
                return 200, json.loads(r.read())
        except urllib.error.HTTPError as e:
            self._ultimo = time.time()
            texto = e.read().decode("utf-8", "replace").replace(self._k, "«k»").replace(self._s, "«s»")[:500]
            if e.code == 403 or "MISUSE_API_PROCESS" in texto:
                raise SystemExit(f"Omie da DOC parou a leitura (HTTP {e.code}): {texto}")
            return e.code, texto


# ------------------------------------------------------------------------------------------------- etapas

def verificar() -> dict:
    faltam = []
    for schema, nomes in FUNCOES.items():
        r = sql("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                f"where n.nspname = {lit(schema)} and p.proname = any(array[{', '.join(lit(x) for x in nomes)}])")
        tem = {x["proname"] for x in r}
        faltam += [f"{schema}.{x}" for x in nomes if x not in tem]
    pas = sql("select p.proname, has_function_privilege('service_role', p.oid, 'execute') sr, "
              "has_function_privilege('authenticated', p.oid, 'execute') au, "
              "has_function_privilege('anon', p.oid, 'execute') an "
              "from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
              f"where n.nspname = 'ops' and p.proname = any(array[{', '.join(lit(x) for x in PASSAGEM)}])")
    por = {x["proname"]: x for x in pas}
    faltam += [f"ops.{x}" for x in PASSAGEM if x not in por]
    abertas = [f"ops.{x}" for x, v in por.items() if not v["sr"] or v["au"] or v["an"]]
    doc = sql("select id::text, modo_omie, ativa from organizacao.empresas_grupo where apelido = 'DOC'")[0]
    edge = [f for f in api("/functions", metodo="GET") if f["slug"] == "faturamento-omie"]
    out = {
        "faltam_funcoes": faltam,
        "passagem_com_acesso_errado": abertas,
        "doc": {"modo_omie": doc["modo_omie"], "ativa": doc["ativa"]},
        "edge": {"publicada": bool(edge), "verify_jwt": edge[0].get("verify_jwt") if edge else None},
    }
    out["pronto"] = (not faltam and not abertas and doc["modo_omie"] == "simular" and doc["ativa"]
                     and out["edge"]["publicada"] and out["edge"]["verify_jwt"] is False)
    out["doc_id"] = doc["id"]
    return out


def cnpj_real_da_doc(omie: OmieLeitura) -> str:
    st, b = omie.call("geral/clientes", "ListarClientesResumido",
                      {"pagina": 1, "registros_por_pagina": 50, "apenas_importado_api": "N"})
    if st != 200:
        raise SystemExit(f"ListarClientesResumido HTTP {st}")
    for c in b.get("clientes_cadastro_resumido") or []:
        d = re.sub(r"\D", "", c.get("cnpj_cpf") or "")
        if len(d) == 14:
            return d
    raise SystemExit("Nenhum cliente PJ na primeira página do Omie da DOC")


def chamar_edge():
    seg = sql("select decrypted_secret s from vault.decrypted_secrets where name = 'faturamento_cron_secret'")[0]["s"]
    req = urllib.request.Request(EDGE, data=json.dumps({"acao": "processar", "origem": "teste-integracao-t2"}).encode(),
                                 method="POST", headers={"Content-Type": "application/json", "x-faturamento-cron": seg})
    try:
        with urllib.request.urlopen(req, timeout=150) as r:
            return r.status, json.loads(r.read()).get("resumo", {}).get("por_status")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]


def main():
    pre = verificar()
    print(json.dumps({"pre_requisitos": {k: v for k, v in pre.items() if k != "doc_id"}}, ensure_ascii=False))
    if "--verificar" in sys.argv:
        return
    if not pre["pronto"]:
        raise SystemExit("Pré-requisitos faltando: nada foi gravado.")
    doc_id = pre["doc_id"]

    omie = OmieLeitura(doc_id)
    cnpj = cnpj_real_da_doc(omie)
    servico = sql("select id::text, codigo from receita.fat_servicos where emissora_id = "
                  f"{lit(doc_id)}::uuid and ativo and tem_tributacao and coalesce(no_omie, true) order by codigo limit 1")
    if not servico:
        raise SystemExit("A DOC não tem serviço liberado com tributação no portal")

    # O Pedro precisa ser dono na DOC para enviar direto para a fila (dono = autor). Se não for, entra só para o teste.
    criado_dono = None
    tem = sql("select id::text from receita.fat_donos where emissora_id = "
              f"{lit(doc_id)}::uuid and user_id = {lit(PEDRO)}::uuid and papel = 'dono' and ativo")
    if not tem:
        r = como_pedro(f"ops.fat_dono_salvar({lit(json.dumps({'emissora_id': doc_id, 'user_id': PEDRO, 'papel': 'dono'}))}::jsonb)")
        criado_dono = r["id"]

    venc = (dt.date.today() + dt.timedelta(days=30)).isoformat()
    dados = {
        "emissora_id": doc_id, "dono_id": PEDRO, "tomador_tipo": "pj", "tomador_documento": cnpj,
        "emails_envio": ["faturamento.teste@planning.com.br"], "projeto": "Teste do conector do Omie (T2)",
        "servico_id": servico[0]["id"], "descricao_nf": "Teste do conector do Omie em simulação: não faturar",
        "valor": 1.00, "forma": "avulso", "parcelas": 1, "primeiro_vencimento": venc, "documento": "nf",
        "meio": "boleto", "observacoes": "Pedido de teste da T2, em simulação; descartado ao fim do teste.",
        "confirmou_emissora": True,
    }
    salvo = como_pedro(f"ops.fat_pedido_salvar(null, {lit(json.dumps(dados, ensure_ascii=False))}::jsonb)")
    pid, numero = salvo["id"], salvo["numero"]
    try:
        enviado = como_pedro(f"ops.fat_pedido_enviar({lit(pid)}::uuid)")
        print(json.dumps({"pedido": numero, "tomador": mascara(cnpj), "enviado": enviado.get("status"),
                          "simulacao_emissora": enviado.get("simulacao_emissora")}, ensure_ascii=False))
        if enviado.get("status") != "na_fila_omie":
            raise SystemExit(f"Esperava na_fila_omie, veio {enviado.get('status')}")

        # A edge publicada processa (o cron a cada 2 minutos também pegaria; chamamos para não esperar).
        status = None
        for _ in range(8):
            print(json.dumps({"edge": chamar_edge()}, ensure_ascii=False))
            status = sql(f"select status, simulacao from receita.fat_pedidos where id = {lit(pid)}::uuid")[0]
            if status["status"] != "na_fila_omie":
                break
            time.sleep(20)
        envios = sql("select operacao, status, modo, erro_legivel, resposta from integracoes.omie_envios "
                     f"where origem = 'fat_pedido' and origem_id = {lit(pid)}::uuid order by created_at")
        resumo = []
        for e in envios:
            r = e["resposta"] if isinstance(e["resposta"], dict) else json.loads(e["resposta"] or "{}")
            p = r.get("param") or {}
            resumo.append({
                "operacao": e["operacao"], "status": e["status"], "modo": e["modo"], "erro": e["erro_legivel"],
                "metodo": r.get("metodo"), "leituras": r.get("leituras"), "avisos": r.get("avisos"),
                "chamadas": [c.get("metodo") for c in r.get("chamadas") or []],
                "param": ({"Cabecalho": p.get("Cabecalho"), "Email": {k: v for k, v in (p.get("Email") or {}).items() if k != "cEnviarPara"},
                           "InformacoesAdicionais": p.get("InformacoesAdicionais"), "itens": len(p.get("ServicosPrestados") or []),
                           "Parcelas": p.get("Parcelas")} if "Cabecalho" in p else
                          {"cnpj_cpf": mascara(re.sub(r"\D", "", p.get("cnpj_cpf", ""))), "campos": sorted(p)} if p else None),
                "tem_chave": "app_key" in json.dumps(r) or "app_secret" in json.dumps(r),
            })
        print(json.dumps({"situacao": status, "envios": resumo}, ensure_ascii=False, indent=1))

        st, b = omie.call("servicos/os", "ConsultarOS", {"cCodIntOS": numero})
        nao_existe = st != 200 and "não cadastrada" in str(b)
        print(json.dumps({"omie_consultar_os": {"http": st, "os_nao_existe": nao_existe}}, ensure_ascii=False))

        falhas = []
        if status["status"] != "simulado" or not status["simulacao"]:
            falhas.append(f"pedido em {status['status']} (simulacao={status['simulacao']})")
        if any(e["modo"] != "simular" or e["status"] != "simulado" for e in resumo):
            falhas.append("envio fora de simulado")
        if any(m and not re.match(r"^(Listar|Consultar|Status|Pesquisar)", m) for e in resumo for m in e["chamadas"]):
            falhas.append("chamada de escrita registrada")
        if any(e["tem_chave"] for e in resumo):
            falhas.append("chave na resposta")
        if not nao_existe:
            falhas.append("a OS existe no Omie da DOC")
        print(json.dumps({"resultado": "passou" if not falhas else "falhou", "falhas": falhas}, ensure_ascii=False))
    finally:
        # Descarta sem apagar: devolve (tesouraria) e o autor descarta; se não der, pede e efetiva o cancelamento.
        motivo = "Teste do conector do Omie (T2) em simulação: descartado ao fim do teste"
        tropecos = []

        def tenta(rotulo, chamada):
            try:
                como_pedro(chamada)
                return True
            except SystemExit as e:
                tropecos.append(f"{rotulo}: {str(e)[:200]}")
                return False

        atual = sql(f"select status from receita.fat_pedidos where id = {lit(pid)}::uuid")[0]["status"]
        if atual in ("simulado", "erro_omie", "os_criada", "em_conferencia"):
            if tenta("devolver", f"ops.fat_tesouraria_acao({lit(pid)}::uuid, 'devolver', {lit(motivo)})"):
                atual = "devolvido"
        if atual in ("rascunho", "devolvido"):
            tenta("descartar", f"ops.fat_pedido_descartar({lit(pid)}::uuid)")
        atual = sql(f"select status from receita.fat_pedidos where id = {lit(pid)}::uuid")[0]["status"]
        if atual != "cancelado":
            tenta("pedir cancelamento", f"ops.fat_pedido_cancelar({lit(pid)}::uuid, {lit(motivo)})")
            tenta("efetivar cancelamento", f"ops.fat_pedido_cancelar({lit(pid)}::uuid, {lit(motivo)})")
        final = sql(f"select status, motivo_status from receita.fat_pedidos where id = {lit(pid)}::uuid")[0]
        if criado_dono:
            tenta("remover papel de teste", f"ops.fat_dono_remover({lit(criado_dono)}::uuid)")
        print(json.dumps({"descarte": final, "papel_de_teste_removido": bool(criado_dono), "tropecos": tropecos},
                         ensure_ascii=False))

if __name__ == "__main__":
    main()
