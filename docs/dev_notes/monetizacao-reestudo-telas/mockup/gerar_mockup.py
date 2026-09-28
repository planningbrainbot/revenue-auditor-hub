#!/usr/bin/env python3
"""Remede o pipe 39 e monta o mockup do reestudo da Monetização com dado real.

    SUPABASE_ACCESS_TOKEN=... PIPEDRIVE_API_TOKEN=... \
      python3 gerar_mockup.py /caminho/fora/do/repo/monetizacao-reestudo.html

Só lê. No banco, a Management API do Supabase com "read_only": true; no Pipedrive, só GET.
O HTML gerado tem nome de empresa e motivo de perda de cada negócio: por isso ele é gravado
fora do repositório (regra de 16/09, "Dados individuais e evidências permanecem privados,
fora do Git"). O script se recusa a gravar dentro do repositório.

Variáveis: SUPABASE_ACCESS_TOKEN (PAT com acesso ao projeto), PIPEDRIVE_API_TOKEN (conta Ops
Planning), SUPABASE_REF (padrão npknehhyyzelmrbbxvtu, o Brain unificado).
"""
import concurrent.futures as cf
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

REF = os.environ.get("SUPABASE_REF", "npknehhyyzelmrbbxvtu")
PRODUTO = "0646513ee16829605c0af8b15b415ebf05beb6c5"
MARCOS = ["started", "scheduled", "meeting", "validated", "signed"]
ETAPAS = {274, 276, 275, 277, 287, 279, 278, 288}
INICIO = "2026-06-30"
AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[3]


def sql(query):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": query, "read_only": True}).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"],
            "Content-Type": "application/json",
            "User-Agent": "monetizacao-reestudo/1.0",
        },
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req, timeout=120).read())


def pipedrive(path, **params):
    url = f"https://api.pipedrive.com/{path}?{urllib.parse.urlencode(params)}"
    for tentativa in range(5):
        req = urllib.request.Request(
            url,
            headers={"x-api-token": os.environ["PIPEDRIVE_API_TOKEN"], "User-Agent": "monetizacao-reestudo/1.0"},
        )
        try:
            return json.loads(urllib.request.urlopen(req, timeout=60).read())
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(2 + 2 * tentativa)
    raise RuntimeError("Pipedrive: limite de requisições")


def quando(s):
    return datetime.fromisoformat(str(s).replace("Z", "").replace("T", " ")[:19])


def grupo(motivo):
    t = (motivo or "").lower()
    if not t:
        return "Sem motivo"
    if re.search(r"duplicad|outro card|em prospec|pela frente|já está com contrato|feito (abordagem|prospec)|volta à fila|rota consultoria|não dá para decidir|prospectado pelo", t):
        return "Remanejado ou duplicado"
    if re.search(r"fora de perfil|fora do perfil|não tem perfil|sem oportunidades|não tem cnpj|baixa em cnpj|simples", t):
        return "Fora de perfil"
    if "sem interesse" in t or "sem contrato" in t:
        return "Sem interesse"
    if "tentativa" in t:
        return "Contato esgotado"
    if "concorrente" in t or "parceiro" in t:
        return "Concorrente ou parceiro"
    if "budget" in t:
        return "Sem orçamento"
    return "Outros"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    saida = Path(sys.argv[1]).resolve()
    if RAIZ in saida.parents:
        sys.exit("Grave fora do repositório: o HTML tem dado individual.")

    medido = sql("select measured_at from ops.monetizacao_sync")[0]["measured_at"]
    snapshot = {r["id"]: r["payload"] for r in sql("select id, payload from ops.monetizacao_deals")}
    plano = sql("select payload from ops.monetizacao_planos order by month desc limit 1")[0]["payload"]
    linhas = sql("select r->>'label' rotulo, r->'values' v from ops.monetizacao_forecasts, jsonb_array_elements(payload->'rows') r")
    v10 = {x["rotulo"]: x["v"] for x in linhas}

    with cf.ThreadPoolExecutor(5) as ex:
        pd = {d["id"]: d for d in ex.map(lambda i: pipedrive(f"v1/deals/{i}")["data"], snapshot)}

    agora = quando(medido).replace(tzinfo=None)
    deals = []
    for c in snapshot.values():
        if c["created_at"][:10] < INICIO:
            continue
        mv, stays = c["moves"], []
        for k, m in enumerate(mv):
            if m["stage_id"] not in ETAPAS:
                continue
            if k + 1 < len(mv):
                fim, atual = quando(mv[k + 1]["at"]), 0
            elif c["status"] == "won":
                fim, atual = quando(pd[c["id"]]["won_time"]), 0
            elif c["status"] == "lost":
                fim, atual = quando(pd[c["id"]]["lost_time"]), 0
            else:
                fim, atual = agora, 1
            stays.append([m["stage_id"], round((fim - quando(m["at"])).total_seconds() / 86400, 2), atual])
        ev = [c["events"][k][0]["date"] if c["events"][k] else None for k in MARCOS]
        tem = [True] + [bool(e) for e in ev]
        ultimo = max(i for i, x in enumerate(tem) if x)
        datas = [c["created_at"][:10]] + ([c["last_activity_date"]] if c["last_activity_date"] else [])
        datas += [e["date"] for v in c["events"].values() for e in v] + [m["date"] for m in mv]
        deals.append({
            "id": c["id"], "t": re.sub(r"\s*\[(?:CO|HU|AQ):[a-f0-9-]+\]", "", c["title"]), "p": c["route"],
            "st": c["status"], "sg": c["stage_id"], "c": c["created_at"][:10], "w": c["won_on"], "l": c["lost_on"],
            "lc": grupo(c["lost_reason"]) if c["status"] == "lost" else None, "lr": c["lost_reason"],
            "f": ultimo, "e": ev, "s": stays, "na": c["next_activity"], "lm": max(datas),
        })

    dados = {
        "deals": deals,
        "v10": {
            "meses": ["set/26", "out/26", "nov/26", "dez/26"],
            "contratos": v10["Contratos assinados · total"][:4],
            "set": {
                "started": {"total": v10["Ofertas trabalhadas · total"][0], "cella": v10["Cella · ofertas trabalhadas no mês"][0],
                            "consultoria": v10["Consultoria · ofertas trabalhadas no mês"][0], "finance": v10["Finance · ofertas trabalhadas no mês"][0]},
                "meeting": {"total": v10["Reuniões realizadas"][0]},
                "validated": {"total": v10["OPORTUNIDADES validadas"][0]},
                "signed": {"total": v10["Contratos assinados · total"][0], "cella": v10["Contratos · Cella"][0],
                           "consultoria": v10["Contratos · Consultoria"][0], "finance": v10["Contratos · Finance"][0]},
            },
        },
        "plan": {**plano, "mes": plano["month"], "salvo_em": "15/09/2026"},
        "meta": {"medido": agora.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("America/Sao_Paulo")).strftime("%d/%m/%Y %Hh%M"), "corte": agora.strftime("%Y-%m-%d"), "inicio": INICIO},
    }
    modelo = (AQUI / "modelo.html").read_text()
    saida.write_text(modelo.replace("__DADOS__", json.dumps(dados, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")))
    print(f"{len(deals)} negócios · gravado em {saida}")


if __name__ == "__main__":
    main()
