"""Reference answers from basal-serve for test/data/requests.jsonl (step 5 of the port: the browser must agree).

  basal-serve --model <basal-2.0-mini-GGUF folder> --mode ollama --ollama-model basal-2.0-mini:q5_k_m \
              --calibration <folder>/CALIBRATION.llamacpp.json --port 8765
  python -I tools/reference.py http://127.0.0.1:8765 test/data/reference.ollama.jsonl
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

url, dst = sys.argv[1].rstrip("/"), Path(sys.argv[2])
root = Path(__file__).resolve().parent.parent
rows = [json.loads(line) for line in (root / "test" / "data" / "requests.jsonl").read_text(encoding="utf-8").splitlines()]
model = json.load(urllib.request.urlopen(url + "/v1/models"))["models"][0]
out = []
for r in rows:
    req = urllib.request.Request(url + "/v1/systemone", data=json.dumps(r["request"]).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    try:
        res = json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        res = {"error": e.read().decode()}
    res["wall_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    out.append({"id": r["id"], **res})
    print(r["id"], res.get("error") or {k: a.get(a["type"]) for k, a in res["answers"].items()})
dst.write_text(json.dumps({"server": model, "rows": out}, ensure_ascii=False, indent=1), encoding="utf-8")
print("wrote", dst)
