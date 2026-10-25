"""Answer-assembly fixtures from the basal engine itself: for every request of the format-2 test vectors, fixed
pseudo-random readouts (softmax over the codes of each prompt) go through basal's own functions (to_items, the
calibration, multi / tool / act answers) with CALIBRATION.llamacpp.json; test/assembly.test.mjs feeds the same
readouts to decide() and compares every answer.

  <basal-env>/python -I tools/make_assembly_fixtures.py    (needs the basal package, v2.0.0)
"""
import asyncio
import json
import math
import random
from pathlib import Path

import torch
from basal.server import (act_answer, multi_answer, stored_fallback, temper, temperature, to_items)
from basal.tools import answer as tool_answer
from basal.tools import set_answer as tool_set_answer

root = Path(__file__).resolve().parent.parent
cal = json.loads((root / "calibration" / "CALIBRATION.llamacpp.json").read_text(encoding="utf-8"))
SEEDS = 6
vectors = [json.loads(line) for line in (root / "test" / "data" / "format2_vectors.jsonl").read_text(encoding="utf-8").splitlines() if line]


def canonical(q_type, perms, outs):
    """basal.server.Server.canonical without the server."""
    canon = []
    for perm, p_pos in zip(perms, outs):
        c = [0.0] * len(perm)
        for k, j in enumerate(perm):
            c[j] = p_pos[k]
        canon.append(c)
    p = torch.tensor([sum(x) / len(canon) for x in zip(*canon)])
    return temper(p, temperature(cal, q_type, len(p))).tolist()


out = []
rng = random.Random(2)
for v in [v for _ in range(SEEDS) for v in vectors]:  # several random readouts per request: more answer branches
    req = v["request"]
    qs = to_items(req["state"], req["questions"], 255, force_lang=req.get("lang"))
    for q in qs:
        stored_fallback(cal, q)
    readouts, per_q = [], []
    for q in qs:
        brs = []
        for _ in q["branches"]:
            k = len(_[1])
            z = [rng.gauss(0, 2.5) for _ in range(k)]
            m = max(z)
            e = [math.exp(x - m) for x in z]
            p = [x / sum(e) for x in e]
            readouts.append(p)
            brs.append(([list(range(k))], [p]))
        per_q.append(brs)
    answers = {}
    for q, brs in zip(qs, per_q):  # basal.server.Server.assemble, per question
        if q["type"] == "multi" or q.get("multi"):
            ans = multi_answer(q, [canonical("noul", perms, o)[0] for perms, o in brs])
            answers[q["name"]] = tool_set_answer(q, ans) if q["type"] == "tool" else ans
            continue
        perms, o = brs[0]
        pl = canonical(q.get("base", q["type"]), perms, o)
        probs = {k: float(x) for k, x in zip(q["keys"], pl)}
        conf = float(max(pl))
        if q["type"] == "act":
            ans = act_answer(q, probs, conf, cal)
        elif q["type"] == "tool":
            ans = tool_answer(q, probs, conf, cal)
        elif q["type"] == "noul":
            ans = {"type": "noul", "noul": probs["true"], "probabilities": probs, "confidence": conf}
        elif q["type"] == "score":
            ans = {"type": "score", "score": float(sum(i * x for i, x in enumerate(pl))),
                   "legend": dict(zip(q["keys"], q["options"])), "probabilities": probs, "confidence": conf}
        else:
            ans = {"type": "choice", "choice": max(probs, key=probs.get), "probabilities": probs, "confidence": conf}
        answers[q["name"]] = ans
    out.append({"id": v["id"], "readouts": readouts, "answers": answers})
for n, x in enumerate(out):
    x["case"] = f"{x['id']}#{n // len(vectors)}"

dst = root / "test" / "data" / "assembly_fixtures.json"
dst.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print(len(out), "requests,", sum(len(x["readouts"]) for x in out), "readouts ->", dst)
