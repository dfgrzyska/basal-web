"""The bundled basal examples (basal/examples/*.jsonl of the engine) -> test/data/requests.jsonl: one /v1/systemone
request per line, {"id", "request", "gold"}, the same requests for the browser port and for basal-serve.

Simple items {"state", "question", "options", "gold"} become one question: `noul` for the yes/no file (yes first),
`score` for the score file, `choice` otherwise; the option texts are the criteria list, so the prompt shows them as
they are. Full requests (complex.jsonl) are kept as they are.

  python -I tools/make_requests.py
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = root / "test" / "data" / "examples"
out = []
for name in ("questions", "choice", "noul", "score", "complex"):
    for n, line in enumerate((src / f"{name}.jsonl").read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        x = json.loads(line)
        rid = x.get("id") or f"{name}-{n + 1:02d}"
        if "questions" in x:
            out.append({"id": rid, "request": {"state": x["state"], "questions": x["questions"]}, "gold": None})
            continue
        t = x.get("type") or ("noul" if name == "noul" else "score" if name == "score" else "choice")
        if t == "noul":
            q = {"type": "noul", "instructions": x["question"],
                 "criteria": {"true": x["options"][0], "false": x["options"][1]}}
            gold = ["true", "false"][x["gold"]] if "gold" in x else None
        else:
            q = {"type": t, "instructions": x["question"], "criteria": x["options"]}
            gold = (str(x["gold"]) if t == "score" else x["options"][x["gold"]]) if "gold" in x else None
        out.append({"id": rid, "request": {"state": x["state"], "questions": {"q": q}}, "gold": gold})
(root / "test" / "data" / "requests.jsonl").write_text(
    "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")
print(len(out), "requests,", sum(len(r["request"]["questions"]) for r in out), "questions")
