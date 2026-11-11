# -*- coding: utf-8 -*-
"""筛选、打分与岗位记录生成（自动生成的是脚手架，需人工复核）。"""
import datetime
import re

from .config import slug

DIM_TARGET = {"direction": 4, "business": 3, "sea": 2, "background": 3}

# 中英文地点别名，避免配置写「新加坡」而来源返回 Singapore
ALIASES = {
    "北京": ["beijing", "北京"],
    "上海": ["shanghai", "上海"],
    "深圳": ["shenzhen", "深圳"],
    "广州": ["guangzhou", "广州"],
    "杭州": ["hangzhou", "杭州"],
    "香港": ["hong kong", "香港"],
    "台北": ["taipei", "台北"],
    "新加坡": ["singapore", "新加坡", " sg"],
    "东京": ["tokyo", "东京"],
    "首尔": ["seoul", "首尔"],
    "吉隆坡": ["kuala lumpur", "吉隆坡", "malaysia"],
    "曼谷": ["bangkok", "曼谷", "thailand"],
    "雅加达": ["jakarta", "雅加达", "indonesia"],
    "马尼拉": ["manila", "马尼拉", "philippines"],
    "胡志明市": ["ho chi minh", "hcmc", "胡志明", "vietnam", "越南"],
    "河内": ["hanoi", "河内", "vietnam", "越南"],
    "悉尼": ["sydney", "悉尼", "australia"],
    "墨尔本": ["melbourne", "墨尔本"],
    "伦敦": ["london", "伦敦", "united kingdom", "uk"],
    "巴黎": ["paris", "巴黎", "france"],
    "柏林": ["berlin", "柏林", "germany"],
    "阿姆斯特丹": ["amsterdam", "阿姆斯特丹", "netherlands"],
    "纽约": ["new york", "nyc", "纽约"],
    "旧金山": ["san francisco", "bay area", "旧金山"],
    "西雅图": ["seattle", "西雅图"],
    "多伦多": ["toronto", "多伦多", "canada"],
    "迪拜": ["dubai", "迪拜", "uae"],
    "圣保罗": ["sao paulo", "são paulo", "圣保罗", "brazil"],
    "内罗毕": ["nairobi", "内罗毕", "kenya"],
    "其他东南亚": ["southeast asia", "东南亚", "cambodia", "myanmar"],
}


def loc_blob(c):
    return ((c.get("location") or "") + " " + (c.get("country") or "")).lower()


def loc_matches(name, blob):
    if name.lower() in blob:
        return True
    return any(a.lower() in blob for a in ALIASES.get(name, []))


def text_of(c):
    return (c.get("title", "") + " " + c.get("description", "") + " " + c.get("location", "")).lower()


def hits(text, words):
    out = []
    for w in words or []:
        if w and w.lower() in text and w not in out:
            out.append(w)
    return out


def filter_candidates(cands, cfg):
    s = cfg.get("search", {})
    kws = [k.lower() for k in s.get("keywords") or []]
    ex_t = [k.lower() for k in s.get("exclude_titles") or []]
    ex_c = [k.lower() for k in s.get("exclude_companies") or []]
    locs = s.get("locations") or []
    out, seen = [], set()
    for c in cands:
        text = text_of(c)
        title = (c.get("title") or "").lower()
        comp = (c.get("company") or "").lower()
        if not c.get("url"):
            continue
        if any(x in title for x in ex_t):
            continue
        if any(x in comp for x in ex_c):
            continue
        if kws and not any(k in text for k in kws):
            continue
        if locs and not any(loc_matches(l, loc_blob(c)) for l in locs):
            continue
        key = (c.get("url") or "").split("?")[0]
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def region_of(c, cfg):
    locs = cfg.get("search", {}).get("locations") or []
    blob = loc_blob(c)
    for name in locs:
        if loc_matches(name, blob):
            return name
    return locs[-1] if locs else "其他"


def match_experiences(text, experiences, limit=3):
    out = []
    for e in experiences:
        score = 0
        for kw in e.get("keywords") or []:
            k = (kw.get("k") or "").lower()
            if k and (k in text or any((s or "").lower() in text for s in kw.get("syn") or [])):
                score += kw.get("w", 2)
        if score:
            out.append((score, e))
    out.sort(key=lambda x: -x[0])
    return [e for _, e in out[:limit]]


def score_candidate(c, cfg, experiences):
    sc = cfg.get("scoring", {})
    w = sc.get("weights", {})
    kws = sc.get("keywords", {})
    text = text_of(c)

    dims, all_hits = {}, {}
    for dim in ("direction", "business", "sea", "background"):
        hs = hits(text, kws.get(dim) or [])
        dims[dim] = int(round(w.get(dim, 0) * min(1.0, len(hs) / DIM_TARGET[dim])))
        all_hits[dim] = hs

    locs = cfg.get("search", {}).get("locations") or []
    region = region_of(c, cfg)
    idx = locs.index(region) if region in locs else len(locs) - 1
    dims["location"] = int(round(w.get("location", 0) * max(0.2, 1 - idx * 0.2)))
    dims["duration"] = int(round(w.get("duration", 0) * 0.6))

    exp = match_experiences(text, experiences)
    dims["background"] = min(w.get("background", 0), dims["background"] + (2 if exp else 0))

    total = sum(dims.values())
    a, b = sc.get("a_threshold", 75), sc.get("b_threshold", 62)
    priority = "A" if total >= a else ("B" if total >= b else "C")

    rules = cfg.get("track_rules") or {}
    tracks = [k for k, words in rules.items() if any(str(x).lower() in text for x in words)]
    if not tracks:
        tracks = ["A"]

    sea_fit = 4 if region in ("越南", "新加坡", "其他东南亚") else 2
    if all_hits["sea"]:
        sea_fit = min(5, sea_fit + 1)
    mpa = 4 if ("政策" in text or "政府" in text or "public policy" in text) else 2
    oii = 4 if any(k in text for k in ("ai", "人工智能", "数字", "平台", "product")) else 2

    flat = []
    for d in ("direction", "business", "sea"):
        flat.extend(all_hits[d])
    tags = []
    for t in flat:
        if t not in tags:
            tags.append(t)
    return {
        "region": region, "scores": dims, "total": total, "priority": priority,
        "tracks": tracks, "tags": tags[:5], "sea_fit": sea_fit, "mpa": mpa, "oii": oii,
        "experiences": exp,
    }


def split_jd(desc):
    """把整段 JD 粗分为职责/要求，找不到标题就整体放进职责。"""
    if not desc:
        return [], []
    lines = [l.strip(" -•\t") for l in desc.split("\n") if l.strip()]
    marker = None
    for i, l in enumerate(lines):
        low = l.lower()
        if re.match(r"^(requirements?|qualifications?|任职要求|任职资格|岗位要求|要求)", low):
            marker = i
            break
    if marker is None:
        return lines[:10], []
    return lines[:marker][:10], lines[marker + 1:marker + 10]


def official_search_url(company, title):
    """平台岗位的官方核实入口：用岗位标题去公司官网搜索。"""
    from urllib.parse import quote
    q = quote(title or "")
    c = company or ""
    if "字节" in c or "抖音" in c:
        return f"https://jobs.bytedance.com/experienced/position?keywords={q}"
    if "腾讯" in c:
        return f"https://careers.tencent.com/search.html?keyword={q}"
    if "京东" in c:
        return f"https://zhaopin.jd.com/web/job/job_list?keyword={q}"
    return None


def make_record(c, cfg, sc, idx):
    from .config import today
    r = sc
    resp, req = split_jd(c.get("description", ""))
    src_type = "official" if c.get("source_type") in ("official", "government") else "platform"
    method = {"official": "官方 ATS / 官方页面", "government": "政府官方平台", "third_party": "第三方导入"}.get(
        c.get("source_type"), "自动抓取")
    exp_names = [e.get("title") for e in r["experiences"]]
    why = "关键词命中：" + ("、".join(r["tags"][:4]) if r["tags"] else "相关方向")
    if exp_names:
        why += "；与经历「" + exp_names[0] + "」相关"

    return {
        "id": (slug(c.get("company", "") + "-" + c.get("title", "")) + "-" + str(idx))[:70],
        "company": c.get("company", ""),
        "company_en": c.get("company", ""),
        "title_en": c.get("title", ""),
        "title_cn": c.get("title", ""),
        "dept": "",
        "city": c.get("location", "") or "未说明",
        "country": c.get("country", "") or "",
        "region_tier": r["region"],
        "industry": "",
        "function": "",
        "tracks": r["tracks"],
        "job_type": "实习",
        "work_mode": "未说明",
        "posted_date": c.get("posted"),
        "deadline": c.get("deadline"),
        "duration": "未说明",
        "duration_months": None,
        "days_per_week": "未说明",
        "start_window": "未说明",
        "salary": c.get("salary") or "未公开",
        "jd": {
            "summary": (c.get("description") or "")[:160],
            "responsibilities": resp,
            "requirements": req,
            "education": "未说明",
            "experience": "未说明",
            "language": "未说明",
            "skills": [],
            "attendance": "未说明",
            "duration_note": "未说明",
            "start_note": "未说明",
            "compensation": c.get("salary") or "未公开",
            "other": "自动抓取，JD 需人工复核",
        },
        "apply": {
            "url": c.get("url"),
            "jd_url": c.get("url"),
            "alt_url": None,
            "official_url": official_search_url(c.get("company"), c.get("title")),
            "materials": "在线投递，简历",
            "note": "由 jobkit 自动抓取，投递前请复核岗位仍在架",
        },
        "eligibility": {
            "status": "需核实",
            "undergrad": "未说明",
            "major": "未说明",
            "non_business": "未说明",
            "mainland_student": "未说明",
            "visa": "未说明",
            "grad_year": "未说明",
            "blockers": [],
            "notes": "自动生成，需人工确认学历/签证/语言要求",
        },
        "verification": {
            "status": "official" if src_type == "official" else "platform",
            "method": method,
            "evidence": f"{c.get('source')} 自动抓取于 {today()}",
            "checked_at": today(),
        },
        "fit": {
            "why": why,
            "experience": [f"{e.get('period','')} {e.get('org','')}：{e.get('resume_line','')}" for e in r["experiences"]],
            "gaps": [],
            "competitiveness": "待人工评估",
            "career_path": "待人工评估",
        },
        "scores": r["scores"],
        "score_total": r["total"],
        "priority": r["priority"],
        "tags": r["tags"],
        "mpa": r["mpa"],
        "oii": r["oii"],
        "sea_fit": r["sea_fit"],
    }


def build_records(cands, cfg, experiences):
    recs = []
    for i, c in enumerate(cands):
        sc = score_candidate(c, cfg, experiences)
        recs.append(make_record(c, cfg, sc, i))
    recs.sort(key=lambda x: -x["score_total"])
    return recs
