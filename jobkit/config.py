# -*- coding: utf-8 -*-
"""配置加载：jobkit.toml -> dict（带默认值与校验）。"""
import os
import re
import sys

try:
    import tomllib
except ImportError:  # pragma: no cover
    tomllib = None

DEFAULTS = {
    "site": {
        "title": "我的实习库",
        "subtitle": "岗位库",
        "brand": "assets/briefcase.png",
        "language": "zh",
    },
    "search": {
        "keywords": [],
        "exclude_titles": ["算法", "开发", "测试", "前端", "后端", "销售", "客服", "设计", "标注"],
        "exclude_companies": [],
        "locations": [],
        "interns_only": True,
        "max_per_source": 60,
    },
    "scoring": {
        "weights": {"direction": 30, "business": 25, "sea": 15, "location": 10, "duration": 10, "background": 10},
        "a_threshold": 75,
        "b_threshold": 62,
        "keywords": {"direction": [], "business": [], "sea": [], "background": []},
        "region_bonus": {},
    },
    "tracks": [
        {"key": "A", "label": "核心方向", "short": "A 核心"},
        {"key": "B", "label": "公共政策", "short": "B 政策"},
        {"key": "C", "label": "数字科技", "short": "C 科技"},
        {"key": "D", "label": "交叉方向", "short": "D 交叉"},
    ],
    "track_rules": {},
    "sources": [],
    "experience": {"path": "resume.pdf"},
}


def _merge(base, extra):
    out = dict(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load(path):
    if not os.path.exists(path):
        raise SystemExit(f"找不到配置文件：{path}")
    if tomllib is None:
        raise SystemExit("需要 Python 3.11+ 才能解析 TOML")
    with open(path, "rb") as f:
        raw = tomllib.load(f)
    cfg = _merge(DEFAULTS, raw)
    cfg["_path"] = os.path.abspath(path)
    cfg["_dir"] = os.path.dirname(cfg["_path"])
    return cfg


def data_dir(cfg):
    d = os.path.join(cfg["_dir"], "data")
    os.makedirs(d, exist_ok=True)
    return d


def slug(text, fallback="job"):
    s = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", (text or "").lower()).strip("-")
    return s[:60] or fallback


def today():
    import datetime
    return datetime.date.today().isoformat()


def write_json(path, obj):
    import json
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def read_json(path, default=None):
    import json
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)
