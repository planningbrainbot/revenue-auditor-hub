"""Teste de integração do conector do Omie (T2) e do Pipefy (T3) em simulação, contra o banco único e a edge publicada.

Ciclo: pedido de teste da DOC (CNPJ real de cliente da DOC, lido do Omie dela) → enviar → a edge faturamento-omie
processa → o pedido fica `simulado` com o payload montado → ConsultarOS no Omie da DOC prova que a OS não existe → o
card do pipe 307098392 fica `simulado`, com o createCard montado e validado e nenhuma mutation chamada → o pedido é
descartado (devolvido e descartado, ou cancelamento pedido e efetivado), nunca apagado, e os movimentos de devolução e
cancelamento do card também ficam `simulado`.

Só roda com a DOC em modo_omie = 'simular' (aborta em 'gravar'). No Omie só faz leitura (ListarClientesResumido e
ConsultarOS), com pausa. Nada de chave, token, CNPJ inteiro, nome ou e-mail de cliente vai para a saída.

Pré-requisitos: a API da T1b aplicada (integracoes.fat_* e ops.fat_*), as funções de passagem ops.fat_conector_*
(é por elas que a edge chama o banco, já que integracoes não é exposto no PostgREST), executáveis pelo service_role e
não pelo authenticated, e a edge publicada sem verify_jwt. `--verificar` só confere os pré-requisitos e não grava nada.

Token da Management API: SUPABASE_ACCESS_TOKEN do ambiente ou a linha SUPABASE_ACCESS_TOKEN= de
PM Work/execution/brain-financeiro-planning/.deploy.local.env (lida na hora, nunca impressa).

Notificações (T6), com --notificacoes: pedido de teste da DOC com a conta "Teste" (teste@planning.com.br) de dona e o
Pedro de gestor, os dois só durante o teste → enviar (Aguardando OK: e-mail ao dono) → o Pedro, gestor, devolve
(e-mail ao autor) → o Pedro descarta. Confere que as notificações ficaram `simulado` com o e-mail pronto e que nada foi
enviado. No fim, os dois papéis de teste são desativados (sem apagar).

Contratos (CA-04), com --contratos: enfileira a leitura dos contratos de todas as emissoras ativas (a não ser com
--sem-enfileirar), espera a fila esvaziar, compara os vigentes de cada emissora com o E0 (e0/levantamento.json, lido
em 15/10) e confere o caso do CA-04 com um CNPJ real (mascarado): contrato vigente na PAC, pedido pela PRJ → aviso.

Uso: python3 -I scripts/faturamento/conector-simular-integracao.py [--verificar | --notificacoes | --contratos [--sem-enfileirar]]
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
TESTE = "55c21a76-52ca-47b4-b541-54e867aacbea"  # conta "Teste" (teste@planning.com.br), dona só no teste de notificações
ENV = pathlib.Path(__file__).resolve().parents[3] / "brain-financeiro-planning" / ".deploy.local.env"
FUNCOES = {
    "integracoes": ["omie_credencial", "fat_envio_proximos", "fat_envio_resultado", "fat_status_aplicar",
                    "fat_status_enfileirar", "fat_servicos_aplicar"],
    "ops": ["fat_pedido_salvar", "fat_pedido_enviar", "fat_pedido", "fat_pedido_descartar", "fat_tesouraria_acao",
            "fat_pedido_cancelar", "fat_dono_salvar", "fat_dono_remover", "fat_config"],
}
PASSAGEM = ["fat_conector_credencial", "fat_conector_envio_proximos", "fat_conector_envio_resultado",
            "fat_conector_status_aplicar", "fat_conector_status_enfileirar", "fat_conector_servicos_aplicar",
            "fat_conector_receita_cnpj", "fat_conector_pipefy_proximos", "fat_conector_pipefy_resultado",
            "fat_conector_pipefy_contexto", "fat_conector_notificacoes_proximos",
            "fat_conector_notificacoes_resultado", "fat_conector_emissora_bloquear", "fat_conector_contratos_aplicar"]


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
    """Chama uma RPC de tela como o Pedro logado (authenticated + claims do JWT), numa transação da Management API.
    O commit também roda como authenticated, como pelo PostgREST (o gatilho adiado das parcelas é security definer
    desde 20261020180000)."""
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


def cnpj_real_da_doc(omie: OmieLeitura) -> tuple:
    st, b = omie.call("geral/clientes", "ListarClientesResumido",
                      {"pagina": 1, "registros_por_pagina": 50, "apenas_importado_api": "N"})
    if st != 200:
        raise SystemExit(f"ListarClientesResumido HTTP {st}")
    for c in b.get("clientes_cadastro_resumido") or []:
        d = re.sub(r"\D", "", c.get("cnpj_cpf") or "")
        if len(d) == 14 and (c.get("razao_social") or "").strip():
            return d, c["razao_social"].strip()
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


def envios_pipefy(pid: str):
    """Envios do Pipefy do pedido, resumidos (sem dado do cliente: só ids de campo, nomes de mutation e mensagens)."""
    linhas = sql("select operacao, status, card_id, erro_legivel, resposta, payload->>'para' para, seq "
                 f"from integracoes.pipefy_envios where origem = 'fat_pedido' and origem_id = {lit(pid)}::uuid order by seq")
    out = []
    for e in linhas:
        r = e["resposta"] if isinstance(e["resposta"], dict) else json.loads(e["resposta"] or "{}") if e["resposta"] else {}
        muts = r.get("mutacoes") or []
        item = {
            "operacao": e["operacao"], "para": e["para"], "status": e["status"], "card_id": e["card_id"],
            "erro": e["erro_legivel"], "validacao": r.get("validacao"), "caminho": r.get("caminho"),
            "registro": r.get("registro"), "leituras": r.get("leituras"),
            "faltas": [re.sub(r"[\w.+-]+@[\w.-]+", "<e-mail>", f) for f in r.get("faltas") or []],
            "avisos": [re.sub(r"[\w.+-]+@[\w.-]+", "<e-mail>", f) for f in r.get("avisos") or []],
            "mutacoes": [m.get("nome") for m in muts],
            "chamadas": [c.get("operacao") for c in r.get("chamadas") or []],
        }
        cc = next((m for m in muts if m.get("nome") == "createCard"), None)
        if cc:
            campos = cc["variables"]["input"]["fields_attributes"]
            item["createCard"] = {"pipe_id": cc["variables"]["input"]["pipe_id"], "campos": len(campos),
                                  "ids": sorted(f["field_id"] for f in campos)}
        out.append(item)
    return out


def esperar_pipefy(pid: str, minimo: int, limite_s: int = 300):
    """Espera o cron processar os envios do Pipefy do pedido (nenhum pendente nem processando)."""
    fim = time.time() + limite_s
    while True:
        r = sql("select count(*) filter (where status in ('pendente', 'processando'))::int abertos, count(*)::int total "
                f"from integracoes.pipefy_envios where origem = 'fat_pedido' and origem_id = {lit(pid)}::uuid")[0]
        if (r["total"] >= minimo and r["abertos"] == 0) or time.time() > fim:
            return r
        time.sleep(20)


def papel_de_teste(doc_id: str, user_id: str, papel: str):
    """Ativa (ou reativa) um papel de teste na DOC; devolve o id da linha se ele não estava ativo antes."""
    tem = sql("select id::text from receita.fat_donos where emissora_id = "
              f"{lit(doc_id)}::uuid and user_id = {lit(user_id)}::uuid and papel = {lit(papel)} and ativo")
    if tem:
        return None
    r = como_pedro(f"ops.fat_dono_salvar({lit(json.dumps({'emissora_id': doc_id, 'user_id': user_id, 'papel': papel}))}::jsonb)")
    return r["id"]


def notificacoes(doc_id: str):
    omie = OmieLeitura(doc_id)
    cnpj, razao = cnpj_real_da_doc(omie)
    servico = sql("select id::text from receita.fat_servicos where emissora_id = "
                  f"{lit(doc_id)}::uuid and ativo and tem_tributacao and coalesce(no_omie, true) order by codigo limit 1")
    criados = []
    pid = None
    falhas = []
    try:
        for user_id, papel in ((TESTE, "dono"), (PEDRO, "gestor")):
            c = papel_de_teste(doc_id, user_id, papel)
            if c:
                criados.append(c)
        venc = (dt.date.today() + dt.timedelta(days=30)).isoformat()
        dados = {
            "emissora_id": doc_id, "dono_id": TESTE, "tomador_tipo": "pj", "tomador_documento": cnpj, "tomador_nome": razao,
            "emails_envio": ["faturamento.teste@planning.com.br"], "projeto": "Teste das notificações (T6)",
            "servico_id": servico[0]["id"], "descricao_nf": "Teste das notificações do portal: não faturar",
            "valor": 1.00, "forma": "avulso", "parcelas": 1, "primeiro_vencimento": venc, "documento": "nf",
            "meio": "boleto", "observacoes": "Pedido de teste da T6; descartado ao fim do teste.", "confirmou_emissora": True,
        }
        salvo = como_pedro(f"ops.fat_pedido_salvar(null, {lit(json.dumps(dados, ensure_ascii=False))}::jsonb)")
        pid, numero = salvo["id"], salvo["numero"]
        enviado = como_pedro(f"ops.fat_pedido_enviar({lit(pid)}::uuid)")
        print(json.dumps({"pedido": numero, "enviado": enviado.get("status")}, ensure_ascii=False))
        if enviado.get("status") != "aguardando_ok":
            falhas.append(f"esperava aguardando_ok, veio {enviado.get('status')}")
        motivo = "Teste das notificações (T6): falta conferir o projeto"
        dev = como_pedro(f"ops.fat_pedido_devolver({lit(pid)}::uuid, {lit(motivo)})")
        print(json.dumps({"devolvido": dev.get("status")}, ensure_ascii=False))
        # O cron (2 min) processa a fila de notificações na mesma edge.
        fim = time.time() + 300
        while True:
            r = sql("select count(*) filter (where status in ('pendente', 'processando'))::int abertas, count(*)::int total "
                    f"from integracoes.notificacoes where pedido_id = {lit(pid)}::uuid")[0]
            if (r["total"] >= 2 and r["abertas"] == 0) or time.time() > fim:
                break
            time.sleep(20)
        linhas = sql("select evento, papel, status, destinatario_id::text dest, email, assunto, corpo, erro_legivel, "
                     "resposta->>'simulado' simulado, enviado_em from integracoes.notificacoes "
                     f"where pedido_id = {lit(pid)}::uuid order by created_at")
        resumo = []
        for n in linhas:
            corpo = n["corpo"] or ""
            resumo.append({
                "evento": n["evento"], "papel": n["papel"], "status": n["status"],
                "destinatario": "teste" if n["dest"] == TESTE else "pedro" if n["dest"] == PEDRO else "outro",
                "email": re.sub(r"^(.{3}).*(@.*)$", r"\1***\2", n["email"] or ""), "assunto": n["assunto"],
                "simulado": n["simulado"], "erro": n["erro_legivel"], "enviado_em": n["enviado_em"],
                "link_do_pedido": f"/faturamento/pedido/{pid}" in corpo, "tem_motivo": "falta conferir o projeto" in corpo,
                "documento_completo_no_corpo": cnpj in re.sub(r"\D", "", corpo) or cnpj in corpo,
            })
        print(json.dumps({"notificacoes": resumo}, ensure_ascii=False, indent=1))
        ok = next((x for x in resumo if x["evento"] == "ok_pendente"), None)
        dv = next((x for x in resumo if x["evento"] == "devolvido"), None)
        if not ok or ok["destinatario"] != "teste" or ok["papel"] != "dono" or ok["status"] != "simulado":
            falhas.append(f"OK pendente: {ok}")
        if not dv or dv["destinatario"] != "pedro" or dv["papel"] != "autor" or dv["status"] != "simulado" or not dv["tem_motivo"]:
            falhas.append(f"devolvido: {dv}")
        if any(x["status"] == "enviado" or x["enviado_em"] for x in resumo):
            falhas.append("e-mail enviado com FATURAMENTO_EMAIL desligado")
        if any(not x["link_do_pedido"] for x in resumo):
            falhas.append("e-mail sem o link do pedido")
        if any(x["documento_completo_no_corpo"] for x in resumo):
            falhas.append("CNPJ completo no corpo")
        if len(resumo) != 2:
            falhas.append(f"{len(resumo)} notificações (esperava 2)")
        print(json.dumps({"resultado": "passou" if not falhas else "falhou", "falhas": falhas}, ensure_ascii=False))
    finally:
        tropecos = []
        if pid:
            try:
                como_pedro(f"ops.fat_pedido_descartar({lit(pid)}::uuid)")
            except SystemExit as e:
                tropecos.append(f"descartar: {str(e)[:200]}")
            final = sql(f"select status, motivo_status from receita.fat_pedidos where id = {lit(pid)}::uuid")[0]
        else:
            final = None
        for c in criados:
            try:
                como_pedro(f"ops.fat_dono_remover({lit(c)}::uuid)")
            except SystemExit as e:
                tropecos.append(f"remover papel: {str(e)[:200]}")
        print(json.dumps({"descarte": final, "papeis_de_teste_desativados": len(criados), "tropecos": tropecos},
                         ensure_ascii=False))


E0 = pathlib.Path(__file__).resolve().parents[3] / "portal-faturamento-prd-20261013" / "e0" / "levantamento.json"
SIGLA_E0 = {"PMC_MAROX": "PMC", "MAROX_SERVICOS": "MAROX", "SP": "PAC SP", "RJ": "PRJ"}


def contratos():
    if "--sem-enfileirar" not in sys.argv:
        print(json.dumps({"enfileirar": sql("select integracoes.fat_contratos_enfileirar() r")[0]["r"]}, ensure_ascii=False))
    fim = time.time() + 1500
    while True:
        r = sql("select count(*) filter (where status in ('pendente', 'processando'))::int abertos "
                "from integracoes.omie_envios where operacao = 'sincronizar_contratos'")[0]
        if r["abertos"] == 0 or time.time() > fim:
            break
        time.sleep(30)
    linhas = sql("""
      select g.apelido, e.status, e.erro_legivel, e.resposta->>'vigentes' lidos_vigentes, e.resposta->>'sem_documento' sem_doc,
             e.resposta->>'lidos' lidos, (select count(*) from integracoes.omie_contratos_vigentes c where c.emissora_id = g.id)::int na_tabela
        from organizacao.empresas_grupo g
        left join integracoes.omie_envios e on e.operacao = 'sincronizar_contratos' and e.origem_id = g.id
       where g.ativa and g.omie_credencial_ref is not null order by g.apelido""")
    e0 = {}
    for x in json.loads(E0.read_text())["empresas"]:
        c = x.get("contratos") or {}
        if "ativos_vigentes" in c:
            e0[SIGLA_E0.get(x["sigla"], x["sigla"])] = c["ativos_vigentes"]
    tabela = [{**l, "e0_vigentes_15_10": e0.get(l["apelido"])} for l in linhas]
    print(json.dumps({"contratos": tabela}, ensure_ascii=False, indent=1))
    # CA-04 com dado real: um CNPJ com contrato vigente na PAC e nenhum na PRJ, pedido pela PRJ.
    caso = sql("""
      select c.documento from integracoes.omie_contratos_vigentes c join organizacao.empresas_grupo g on g.id = c.emissora_id
       where g.apelido = 'PAC' and length(c.documento) = 14
         and not exists (select 1 from integracoes.omie_contratos_vigentes x join organizacao.empresas_grupo h on h.id = x.emissora_id
                          where h.apelido = 'PRJ' and x.documento = c.documento)
       order by c.codigo_contrato limit 1""")
    if caso:
        doc = caso[0]["documento"]
        prj = sql("select id::text from organizacao.empresas_grupo where apelido = 'PRJ'")[0]["id"]
        r = como_pedro(f"ops.fat_tomador({lit(doc)}, {lit(prj)}::uuid)")
        aviso = r.get("contratos_outra_emissora") or []
        print(json.dumps({"ca04": {"cnpj": mascara(doc), "pedido_pela": "PRJ",
                                   "aviso": [a["emissora"]["apelido"] for a in aviso],
                                   "sem_numero_nem_valor": all(a.get("numero") is None and a.get("valor_mensal") is None for a in aviso),
                                   "passou": "PAC" in [a["emissora"]["apelido"] for a in aviso]}}, ensure_ascii=False))


def main():
    pre = verificar()
    print(json.dumps({"pre_requisitos": {k: v for k, v in pre.items() if k != "doc_id"}}, ensure_ascii=False))
    if "--verificar" in sys.argv:
        return
    if not pre["pronto"]:
        raise SystemExit("Pré-requisitos faltando: nada foi gravado.")
    doc_id = pre["doc_id"]
    if "--notificacoes" in sys.argv:
        return notificacoes(doc_id)
    if "--contratos" in sys.argv:
        return contratos()

    omie = OmieLeitura(doc_id)
    cnpj, razao = cnpj_real_da_doc(omie)
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
        "emissora_id": doc_id, "dono_id": PEDRO, "tomador_tipo": "pj", "tomador_documento": cnpj, "tomador_nome": razao,
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

        # Quem processa é a edge publicada, chamada pelo cron a cada 2 minutos. Só se ele não processar em 4 minutos
        # o teste chama a edge direto, com o mesmo cabeçalho do cron.
        status = None
        for i in range(24):
            status = sql(f"select status, simulacao from receita.fat_pedidos where id = {lit(pid)}::uuid")[0]
            if status["status"] != "na_fila_omie":
                break
            if i in (12, 18):
                print(json.dumps({"edge_direto": chamar_edge()}, ensure_ascii=False))
            time.sleep(20)
        print(json.dumps({"processado_em_s": i * 20}, ensure_ascii=False))
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

        def consultar_os():
            st, b = omie.call("servicos/os", "ConsultarOS", {"cCodIntOS": numero})
            try:
                return st, (json.loads(b).get("faultstring", "") if isinstance(b, str) else "")
            except ValueError:
                return st, str(b)

        st, fala = consultar_os()
        if "REDUNDANT" in fala:
            # A edge acabou de fazer a mesma consulta: o Omie pede para esperar. Espera o prazo e lê uma vez só.
            m = re.search(r"(\d+)\s*segundo", fala)
            time.sleep((int(m.group(1)) if m else 40) + 10)
            st, fala = consultar_os()
        nao_existe = st != 200 and "não cadastrad" in fala
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

        # Pipefy: criar_card (na entrada da fila) e o movimento do simulado, processados pela mesma edge.
        esperar_pipefy(pid, 2)
        pf = envios_pipefy(pid)
        print(json.dumps({"pipefy": pf}, ensure_ascii=False, indent=1))
        criar = next((e for e in pf if e["operacao"] == "criar_card"), None)
        if not criar or criar["status"] != "simulado":
            falhas.append(f"criar_card em {criar and criar['status']}: {criar and criar['erro']}")
        elif not (criar.get("validacao") or {}).get("ok") or (criar.get("createCard") or {}).get("pipe_id") != "307098392":
            falhas.append("createCard montado não validou contra o schema")
        if any(c for e in pf for c in e["chamadas"] if c != "Colaboradores"):
            falhas.append("chamada ao Pipefy além da leitura de Colaboradores")
        if any(e["card_id"] for e in pf):
            falhas.append("card_id gravado em simulação")
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
        # Os movimentos do card na devolução e no cancelamento também passam pela edge (simulado). O que estava
        # pendente quando o pedido foi cancelado vira `cancelado` e não acorda mais o cron.
        esperar_pipefy(pid, 3)
        pos = [e for e in envios_pipefy(pid) if e["para"] in ("devolvido", "cancelado")]
        print(json.dumps({"pipefy_descarte": [{k: e[k] for k in ("operacao", "para", "status", "erro", "caminho", "mutacoes")}
                                              for e in pos]}, ensure_ascii=False, indent=1))
        filas = sql(f"""
          select 'omie' fila, status, count(*)::int n from integracoes.omie_envios
           where origem = 'fat_pedido' and origem_id = {lit(pid)}::uuid group by status
          union all
          select 'pipefy', status, count(*)::int from integracoes.pipefy_envios
           where origem = 'fat_pedido' and origem_id = {lit(pid)}::uuid group by status
          union all
          select 'notificacoes', status, count(*)::int from integracoes.notificacoes
           where pedido_id = {lit(pid)}::uuid group by status order by 1, 2""")
        resto = sql(f"""
          select (select count(*) from integracoes.fat_omie_reservaveis r join integracoes.omie_envios e on e.id = r.id
                   where e.origem_id = {lit(pid)}::uuid)::int omie,
                 (select count(*) from integracoes.fat_pipefy_reservaveis r join integracoes.pipefy_envios e on e.id = r.id
                   where e.origem_id = {lit(pid)}::uuid)::int pipefy,
                 (select count(*) from integracoes.notificacoes where pedido_id = {lit(pid)}::uuid
                   and status in ('pendente', 'processando'))::int notificacoes,
                 integracoes.fat_tem_trabalho() tem_trabalho_no_banco""")[0]
        print(json.dumps({"filas_do_pedido": filas, "trabalho_que_acorda_o_cron": resto}, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
