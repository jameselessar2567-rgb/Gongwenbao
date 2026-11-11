# -*- coding: utf-8 -*-
"""jobkit 命令行入口。"""
import argparse
import json
import os
import shutil
import subprocess
import sys

from . import check as check_mod
from . import config as config_mod
from . import profile as profile_mod
from . import score as score_mod
from . import sources as sources_mod
from . import store

TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template")

CONFIG_TEMPLATE = """# jobkit 配置：改这里就能换一套岗位标准
[site]
title = "{title}"
subtitle = "{subtitle}"
brand = "assets/briefcase.png"

[search]
# 地点按优先级排列，越靠前得分越高
locations = ["北京", "上海", "新加坡"]
# 标题/描述里至少要命中一个关键词
keywords = ["国际化", "海外", "出海", "战略", "国际业务", "市场情报", "公共事务", "本地化"]
exclude_titles = ["算法", "开发", "测试", "前端", "后端", "销售", "客服", "设计", "标注"]
max_per_source = 60

[scoring.weights]
direction = 30
business = 25
sea = 15
location = 10
duration = 10
background = 10

[scoring]
a_threshold = 75
b_threshold = 62

[scoring.keywords]
direction = ["战略", "strategy", "市场进入", "market entry", "商业化"]
business = ["业务拓展", "business development", "合作", "partnership", "运营"]
sea = ["东南亚", "southeast asia", "越南", "vietnam", "新加坡", "singapore", "出海"]
background = ["研究", "research", "分析", "数据", "政策"]

[[tracks]]
key = "A"
label = "国际业务与企业战略"
short = "A 国际业务"

[[tracks]]
key = "B"
label = "公共政策与政府事务"
short = "B 公共政策"

[[tracks]]
key = "C"
label = "数字科技与产品"
short = "C 数字科技"

[[tracks]]
key = "D"
label = "交叉方向"
short = "D 交叉"

[track_rules]
A = ["国际", "海外", "战略", "business", "strategy"]
B = ["政策", "政府", "public", "policy"]
C = ["ai", "数字", "产品", "platform", "product"]
D = ["数据", "研究", "research"]

# ---------- 岗位来源 ----------
# 取消注释即可启用；所有来源都走公开 GET 接口。
# [[sources]]
# type = "smartrecruiters"
# company = "Grab"
# queries = ["intern", "strategy"]
# country = "sg"

# [[sources]]
# type = "greenhouse"
# token = "company-board-token"

# [[sources]]
# type = "lever"
# company = "shopback-2"

# [[sources]]
# type = "mcf"
# queries = ["strategy intern", "public policy intern"]
# limit = 30

# [[sources]]
# type = "json"
# path = "imports/manual-jobs.json"

[experience]
path = "resume.pdf"
"""

SITE_DEFAULT = {
    "title": "我的实习库",
    "subtitle": "岗位库",
    "brand": "assets/briefcase.png",
    "tracks": [
        {"key": "A", "label": "核心方向", "short": "A 核心"},
        {"key": "B", "label": "公共政策", "short": "B 政策"},
        {"key": "C", "label": "数字科技", "short": "C 科技"},
        {"key": "D", "label": "交叉方向", "short": "D 交叉"},
    ],
    "stats": [
        {"type": "official", "label": "已确认开放（官方）", "sub": "另有 {platform} 个平台在架"},
        {"type": "priority", "value": "A", "label": "A 类优先岗位", "sub": "值得优先投递"},
        {"type": "region", "value": "北京", "label": "北京岗位", "sub": ""},
        {"type": "total", "label": "岗位总数", "sub": ""},
        {"type": "mpa", "label": "MPA 相关", "sub": ""},
        {"type": "oii", "label": "OII 相关", "sub": ""},
        {"type": "platform", "label": "平台在架", "sub": "待官方复核"},
    ],
}


def _cfg(args):
    path = args.config or os.path.join(os.getcwd(), "jobkit.toml")
    cfg = config_mod.load(path)
    if getattr(args, "config", None) is None:
        os.chdir(cfg["_dir"])
    return cfg


def cmd_init(args):
    target = os.path.abspath(args.dir)
    if os.path.exists(os.path.join(target, "index.html")) and not args.force:
        raise SystemExit(f"{target} 已有 index.html，加 --force 覆盖")
    os.makedirs(target, exist_ok=True)
    if not os.path.isdir(TEMPLATE_DIR):
        raise SystemExit("缺少模板目录 jobkit/template")
    for name in os.listdir(TEMPLATE_DIR):
        src = os.path.join(TEMPLATE_DIR, name)
        dst = os.path.join(target, name)
        if os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            shutil.copy2(src, dst)
    data = os.path.join(target, "data")
    os.makedirs(data, exist_ok=True)
    os.makedirs(os.path.join(target, "imports"), exist_ok=True)

    with open(os.path.join(target, "jobkit.toml"), "w", encoding="utf-8") as f:
        f.write(CONFIG_TEMPLATE.format(title=args.title, subtitle=args.subtitle))

    site = dict(SITE_DEFAULT)
    site["title"] = args.title
    site["subtitle"] = args.subtitle
    config_mod.write_json(os.path.join(data, "site.json"), site)
    config_mod.write_json(os.path.join(data, "experience.json"),
                          {"profile": {"name": ""}, "experiences": []})
    config_mod.write_json(os.path.join(data, "jobs.json"),
                          {"meta": {"last_verified": config_mod.today()}, "jobs": []})
    cfg = config_mod.load(os.path.join(target, "jobkit.toml"))
    store.bundle(cfg)
    print(f"已创建：{target}")
    print("下一步：")
    print("  1) 编辑 jobkit.toml 里的 location / keywords / sources")
    print("  2) python -m jobkit profile <你的简历.pdf> --config jobkit.toml")
    print("  3) python -m jobkit scan   --config jobkit.toml")
    print("  4) python -m jobkit score  --config jobkit.toml")
    print("  5) python -m jobkit build  --config jobkit.toml")


def cmd_scan(args):
    cfg = _cfg(args)
    rows = sources_mod.collect(cfg)
    rows = score_mod.filter_candidates(rows, cfg)
    rows = rows[: args.limit or 9999]
    config_mod.write_json(os.path.join(config_mod.data_dir(cfg), "candidates.json"), rows)
    print(f"命中 {len(rows)} 条，已写入 data/candidates.json")
    for r in rows[:20]:
        print(f"  {r.get('company','')[:20]:20} {r.get('title','')[:50]:50} {r.get('location','')[:16]}")


def cmd_score(args):
    cfg = _cfg(args)
    d = config_mod.data_dir(cfg)
    cands = config_mod.read_json(os.path.join(d, "candidates.json"), [])
    if not cands:
        raise SystemExit("没有候选岗位，先运行 jobkit scan")
    if args.limit:
        cands = cands[: args.limit]
    exp_doc = config_mod.read_json(os.path.join(d, "experience.json"), {})
    experiences = exp_doc.get("experiences") or []
    recs = score_mod.build_records(cands, cfg, experiences)
    jobs_doc = config_mod.read_json(os.path.join(d, "jobs.json"), {"meta": {}, "jobs": []})
    jobs_doc["jobs"] = recs
    jobs_doc.setdefault("meta", {})["last_verified"] = config_mod.today()
    config_mod.write_json(os.path.join(d, "jobs.json"), jobs_doc)
    print(f"已评分 {len(recs)} 条：A {sum(1 for r in recs if r['priority']=='A')} / "
          f"B {sum(1 for r in recs if r['priority']=='B')} / C {sum(1 for r in recs if r['priority']=='C')}")
    store.bundle(cfg)
    print("已生成 data/jobs.js，打开 index.html 查看")


def cmd_build(args):
    cfg = _cfg(args)
    b = store.bundle(cfg)
    print(f"build 完成：{len(b['jobs'])} 个岗位")


def cmd_check(args):
    cfg = _cfg(args)
    check_mod.run(cfg)
    store.bundle(cfg)


def cmd_profile(args):
    cfg = _cfg(args)
    d = config_mod.data_dir(cfg)
    doc, prompt = profile_mod.build(args.resume, os.path.join(d, "experience.json"), args.name or "")
    print(f"抽到 {len(doc['experiences'])} 个事件 → data/experience.json")
    print(f"精修提示词 → {os.path.relpath(prompt, cfg['_dir'])}（交给大模型可得到高质量关键词与主题）")
    store.bundle(cfg)


def cmd_stats(args):
    cfg = _cfg(args)
    b = store.bundle(cfg, write=False)
    jobs = b["jobs"]
    from collections import Counter
    print("岗位总数：", len(jobs))
    print("优先级：", dict(Counter(j.get("priority") for j in jobs)))
    print("地点：", dict(Counter(j.get("region_tier") for j in jobs)))
    print("数据状态：", dict(Counter((j.get("verification") or {}).get("status") for j in jobs)))


def cmd_studio(args):
    from . import studio
    studio.serve(args.port or 8765, args.host or "127.0.0.1")


def cmd_serve(args):
    cfg = _cfg(args)
    port = args.port or 8000
    print(f"http://127.0.0.1:{port}/index.html")
    subprocess.call([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=cfg["_dir"])


def main(argv=None):
    ap = argparse.ArgumentParser(prog="jobkit", description="岗位标准 + 简历 → 岗位库网页")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init", help="创建新岗位库")
    p.add_argument("dir")
    p.add_argument("--title", default="我的实习库")
    p.add_argument("--subtitle", default="岗位库")
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_init)

    for name, fn, help_text in [
        ("scan", cmd_scan, "抓取岗位来源并筛选"),
        ("score", cmd_score, "按配置打分并生成岗位库"),
        ("build", cmd_build, "重新生成 jobs.js / csv"),
        ("check", cmd_check, "核查岗位是否仍在架"),
        ("stats", cmd_stats, "输出统计"),
        ("serve", cmd_serve, "本地预览"),
    ]:
        sp = sub.add_parser(name, help=help_text)
        sp.add_argument("--config", default=None)
        if name == "scan":
            sp.add_argument("--limit", type=int)
        if name == "score":
            sp.add_argument("--limit", type=int)
        if name == "serve":
            sp.add_argument("--port", type=int)
        sp.set_defaults(fn=fn)

    pp = sub.add_parser("profile", help="解析简历生成经历素材库脚手架")
    pp.add_argument("resume")
    pp.add_argument("--config", default=None)
    pp.add_argument("--name", default="")
    pp.set_defaults(fn=cmd_profile)

    st = sub.add_parser("studio", help="打开引导式生成界面")
    st.add_argument("--port", type=int, default=8765)
    st.add_argument("--host", default="127.0.0.1")
    st.set_defaults(fn=cmd_studio, config=None)

    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
