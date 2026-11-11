# -*- coding: utf-8 -*-
"""jobkit Studio：本地向导服务（简历 + 标准 → 生成岗位库）。"""
import base64
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from . import config as config_mod
from . import profile as profile_mod
from . import score as score_mod
from . import sources as sources_mod
from . import store

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDIO_HTML = os.path.join(os.path.dirname(os.path.abspath(__file__)), "studio.html")
LIBS = os.path.join(os.getcwd(), "libraries")
TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template")
JOBS = {}


def start_generate(payload):
    """后台生成，避免公网请求超时。"""
    jid = secrets.token_hex(6)
    JOBS[jid] = {"state": "running", "result": None, "error": None}

    def run():
        try:
            JOBS[jid]["result"] = generate(payload)
            JOBS[jid]["state"] = "done"
        except Exception as e:
            JOBS[jid]["error"] = f"{type(e).__name__}: {e}"
            JOBS[jid]["state"] = "error"

    threading.Thread(target=run, daemon=True).start()
    if len(JOBS) > 200:
        for k in list(JOBS)[:100]:
            JOBS.pop(k, None)
    return jid


def _slug(name):
    s = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", name or "library").strip("-")
    return s[:40] or "library"


def _toml(payload, sources=None):
    locs = payload.get("locations") or ["北京"]
    kws = payload.get("keywords")
    if kws is None:
        kws = ["实习"]
    tracks = payload.get("tracks") or [
        ("A", "国际业务与企业战略", "A 国际业务"),
        ("B", "公共政策与政府事务", "B 公共政策"),
        ("C", "数字科技与产品", "C 数字科技"),
        ("D", "交叉方向", "D 交叉"),
    ]
    src = sources if sources is not None else (payload.get("sources") or [])
    lines = [
        "[site]",
        f'title = "{payload.get("title") or "我的实习库"}"',
        f'subtitle = "{payload.get("subtitle") or "岗位库"}"',
        'brand = "assets/briefcase.png"',
        f'theme = "{payload.get("theme") or "dracula"}"',
        "",
        "[search]",
        "locations = " + json.dumps(locs, ensure_ascii=False),
        "keywords = " + json.dumps(kws, ensure_ascii=False),
        'exclude_titles = ["算法", "开发", "测试", "前端", "后端", "销售", "客服", "设计", "标注", "engineer", "developer", "talent", "people", "recruit", "social media", "content"]',
        "max_per_source = 60",
        "",
        "[scoring.weights]",
        "direction = 30\nbusiness = 25\nsea = 15\nlocation = 10\nduration = 10\nbackground = 10",
        "",
        "[scoring]",
        "a_threshold = 75\nb_threshold = 62",
        "",
        "[scoring.keywords]",
        "direction = " + json.dumps(payload.get("kw_direction") or ["战略", "strategy", "市场进入", "商业化"], ensure_ascii=False),
        "business = " + json.dumps(payload.get("kw_business") or ["业务拓展", "business development", "合作", "partnership", "运营"], ensure_ascii=False),
        "sea = " + json.dumps(payload.get("kw_sea") or ["东南亚", "southeast asia", "越南", "vietnam", "新加坡", "singapore", "出海"], ensure_ascii=False),
        "background = " + json.dumps(payload.get("kw_background") or ["研究", "research", "分析", "数据", "政策"], ensure_ascii=False),
        "",
    ]
    for key, label, short in tracks:
        lines += ["[[tracks]]", f'key = "{key}"', f'label = "{label}"', f'short = "{short}"', ""]
    lines += [
        "[track_rules]",
        'A = ["国际", "海外", "战略", "business", "strategy"]',
        'B = ["政策", "政府", "public", "policy"]',
        'C = ["ai", "数字", "产品", "platform", "product"]',
        'D = ["数据", "研究", "research"]',
        "",
    ]
    for s in src:
        lines.append("[[sources]]")
        for k, v in s.items():
            if k.startswith("_"):
                continue
            if isinstance(v, list):
                lines.append(f"{k} = " + json.dumps(v, ensure_ascii=False))
            elif isinstance(v, int):
                lines.append(f"{k} = {v}")
            else:
                lines.append(f'{k} = "{v}"')
        lines.append("")
    return "\n".join(lines)


def generate(payload):
    if len(payload.get("resume_b64") or "") > 12_000_000:
        raise ValueError("简历文件过大（上限约 8MB）")
    if len(payload.get("sources") or []) > 5:
        raise ValueError("来源最多 5 个")
    name = payload.get("library") or payload.get("title") or "my-library"
    slug = _slug(name) + "-" + secrets.token_hex(2)
    target = os.path.join(LIBS, slug)
    if os.path.isdir(target):
        shutil.rmtree(target)
    os.makedirs(target, exist_ok=True)
    for item in os.listdir(TEMPLATE):
        src = os.path.join(TEMPLATE, item)
        dst = os.path.join(target, item)
        if os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            shutil.copy2(src, dst)
    data = os.path.join(target, "data")
    os.makedirs(data, exist_ok=True)
    os.makedirs(os.path.join(target, "imports"), exist_ok=True)

    # 心仪公司（可选）→ 官方招聘板；没填则用内置公司池
    from . import llm
    from . import registry as registry_mod
    from . import resolve as resolve_mod

    keywords = list(payload.get("keywords") or [])
    companies_in = [c.strip() for c in (payload.get("companies") or []) if c.strip()]
    resolution = {"found": [], "missing": [], "pool": False, "ai": llm.available()}

    if llm.available():
        expanded = llm.expand(payload.get("locations") or [], keywords, companies_in, registry_mod.all_names())
        for k in expanded.get("keywords") or []:
            if k not in keywords:
                keywords.append(k)
        for c in expanded.get("companies") or []:
            if c not in companies_in:
                companies_in.append(c)
    payload["keywords"] = keywords

    sources = []
    if companies_in:
        found, missing = resolve_mod.resolve_all(companies_in[:8])
        resolution["found"] = [{"name": f["name"], "board": f["board"]} for f in found]
        resolution["missing"] = missing
        sources = [f["source"] for f in found]

    if not sources:
        pool = registry_mod.pick(payload.get("locations") or [], 5)
        resolution["pool"] = True
        resolution["found"] = [{"name": p["name"], "board": "内置公司池"} for p in pool]
        sources = [p["source"] for p in pool]

    if not sources:
        names = "、".join(companies_in) if companies_in else "（未填公司）"
        raise ValueError(f"{names} 暂时没有可自动抓取的岗位来源")

    with open(os.path.join(target, "jobkit.toml"), "w", encoding="utf-8") as f:
        f.write(_toml(payload, sources))

    site = {
        "title": payload.get("title") or "我的实习库",
        "subtitle": payload.get("subtitle") or "岗位库",
        "brand": "assets/briefcase.png",
        "theme": payload.get("theme") or "dracula",
        "tracks": [{"key": k, "label": l, "short": s} for k, l, s in
                   (payload.get("tracks") or [("A", "国际业务与企业战略", "A 国际业务"),
                                              ("B", "公共政策与政府事务", "B 公共政策"),
                                              ("C", "数字科技与产品", "C 数字科技"),
                                              ("D", "交叉方向", "D 交叉")])],
        "stats": [
            {"type": "official", "label": "官方确认", "sub": "另有 {platform} 个平台在架"},
            {"type": "priority", "value": "A", "label": "A 类优先", "sub": ""},
            {"type": "total", "label": "岗位总数", "sub": ""},
        ] + [{"type": "region", "value": l, "label": l + "岗位", "sub": ""} for l in (payload.get("locations") or [])[:3]],
    }
    config_mod.write_json(os.path.join(data, "site.json"), site)

    exp_doc = {"profile": {"name": payload.get("name") or "", "summary": ""}, "experiences": []}
    resume_text = (payload.get("resume_text") or "").strip()
    resume_b64 = payload.get("resume_b64") or ""
    ai_text = resume_text
    try:
        if resume_b64:
            ext = payload.get("resume_ext") or ".pdf"
            fpath = os.path.join(target, "resume" + ext)
            with open(fpath, "wb") as f:
                f.write(base64.b64decode(resume_b64.split(",")[-1]))
            doc, _ = profile_mod.build(fpath, os.path.join(data, "experience.json"), payload.get("name", ""))
            exp_doc = doc
            if not ai_text:
                try:
                    ai_text = profile_mod.extract_text(fpath)
                except Exception:
                    ai_text = ""
        elif resume_text:
            exp_doc["experiences"] = [profile_mod.enrich(e) for e in profile_mod.parse_events(resume_text)]
        if llm.available() and ai_text:
            ev = llm.structure_experience(ai_text)
            if ev:
                exp_doc["experiences"] = ev
                resolution["ai_used"] = True
    except Exception as e:
        print("profile error:", e)
    resolution.setdefault("ai_used", False)
    config_mod.write_json(os.path.join(data, "experience.json"), exp_doc)
    config_mod.write_json(os.path.join(data, "jobs.json"), {"meta": {}, "jobs": []})

    cfg = config_mod.load(os.path.join(target, "jobkit.toml"))
    stats = {"sources": 0, "candidates": 0, "jobs": 0}
    try:
        rows = sources_mod.collect(cfg)
        stats["sources"] = len(rows)
        rows = score_mod.filter_candidates(rows, cfg)
        stats["candidates"] = len(rows)
        recs = score_mod.build_records(rows, cfg, exp_doc["experiences"])
        stats["jobs"] = len(recs)
        config_mod.write_json(os.path.join(data, "jobs.json"), {"meta": {}, "jobs": recs})
    except Exception as e:
        print("scan error:", e)
    store.bundle(cfg)

    # 公共部署时：只保留最近 40 个生成结果，避免磁盘无限增长
    try:
        dirs = [os.path.join(LIBS, d) for d in os.listdir(LIBS) if os.path.isdir(os.path.join(LIBS, d))]
        dirs.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        for old in dirs[40:]:
            shutil.rmtree(old, ignore_errors=True)
    except Exception:
        pass

    return {"ok": True, "slug": slug, "url": f"/libs/{urllib.parse.quote(slug)}/index.html",
            "stats": stats, "companies": resolution}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.unquote(self.path.split("?")[0])
        if path.startswith("/api/status/"):
            job = JOBS.get(path[len("/api/status/"):])
            if not job:
                return self._send(404, b'{"ok":false,"error":"job not found"}')
            return self._send(200, json.dumps(job, ensure_ascii=False).encode("utf-8"))
        if path.startswith("/assets/"):
            fp = os.path.join(TEMPLATE, "assets", os.path.basename(path))
            if os.path.isfile(fp):
                ext = os.path.splitext(fp)[1].lower()
                ctype = {".png": "image/png", ".ico": "image/x-icon",
                         ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8"}.get(ext, "application/octet-stream")
                with open(fp, "rb") as f:
                    return self._send(200, f.read(), ctype)
            return self._send(404, b"not found", "text/plain")
        if path in ("/", "/index.html", "/studio"):
            with open(STUDIO_HTML, encoding="utf-8") as f:
                body = f.read().encode("utf-8")
            return self._send(200, body, "text/html; charset=utf-8")
        if path.startswith("/libs/"):
            rel = path[len("/libs/"):].replace("..", "")
            fp = os.path.join(LIBS, rel)
            if os.path.isfile(fp):
                ext = os.path.splitext(fp)[1].lower()
                ctype = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                         ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
                         ".png": "image/png", ".ico": "image/x-icon", ".csv": "text/csv; charset=utf-8"}.get(ext, "application/octet-stream")
                with open(fp, "rb") as f:
                    return self._send(200, f.read(), ctype)
            return self._send(404, b"not found", "text/plain")
        return self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if self.path.split("?")[0] != "/api/generate":
            return self._send(404, b"not found", "text/plain")
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            res = {"ok": True, "job": start_generate(payload)}
        except Exception as e:
            res = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        body = json.dumps(res, ensure_ascii=False).encode("utf-8")
        return self._send(200, body)


def serve(port=8765, host="127.0.0.1"):
    os.makedirs(LIBS, exist_ok=True)
    port = int(os.environ.get("PORT", port))
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Studio: http://{host}:{port}/")
    print("生成结果会放在 ./libraries/<名字>/")
    httpd.serve_forever()
