# -*- coding: utf-8 -*-
"""DeepSeek API：精读简历生成经历素材库、扩写检索词、写匹配理由。

没有配置 DEEPSEEK_API_KEY 时全部跳过，系统仍可用（启发式规则兜底）。
"""
import json
import os
import time
import urllib.request

THEMES = ["政策研究", "区域国别", "美国政治", "数据与量化", "项目与协调",
          "政府事务", "内容与传播", "科技与AI", "地缘与安全", "国际交流"]
TRACKS = ["A", "B", "C", "D"]


def _api_base():
    return os.environ.get("DEEPSEEK_API_BASE", "https://api.deepseek.com").rstrip("/")


def _model():
    return os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")


def available():
    return bool(os.environ.get("DEEPSEEK_API_KEY"))


def _chat(messages, temperature=0.2, timeout=60, retries=2):
    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        return None
    body = json.dumps({"model": _model(), "messages": messages,
                       "temperature": temperature}).encode("utf-8")
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(_api_base() + "/chat/completions", data=body, headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + key,
            })
            with urllib.request.urlopen(req, timeout=timeout) as r:
                d = json.loads(r.read().decode("utf-8"))
            return (d.get("choices") or [{}])[0].get("message", {}).get("content", "")
        except Exception as e:
            last = e
            time.sleep(1 + attempt)
    raise last


def _json_array(text):
    if not text:
        return None
    start, end = text.find("["), text.rfind("]")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


def _norm_keywords(raw):
    out = []
    for k in raw or []:
        if isinstance(k, dict):
            name = str(k.get("k") or "").strip()
            if not name:
                continue
            syn = [str(s) for s in (k.get("syn") or []) if str(s).strip()]
            try:
                w = int(k.get("w", 3))
            except Exception:
                w = 3
            out.append({"k": name, "syn": syn, "w": max(1, min(5, w))})
        elif isinstance(k, str) and k.strip():
            out.append({"k": k.strip(), "syn": [], "w": 3})
    return out[:7]


def _norm_event(r, i):
    if not isinstance(r, dict):
        return None
    org = str(r.get("org") or "").strip()
    title = str(r.get("title") or "").strip()
    if not org and not title:
        return None
    themes = [t for t in (r.get("themes") or []) if t in THEMES]
    tracks = [t for t in (r.get("tracks") or []) if t in TRACKS] or ["A"]
    try:
        strength = max(1, min(5, int(r.get("strength", 3))))
    except Exception:
        strength = 3
    bullets = [str(b).strip() for b in (r.get("bullets") or []) if str(b).strip()][:5]
    return {
        "id": str(r.get("id") or f"exp-{i}"),
        "type": str(r.get("type") or "实习"),
        "org": org,
        "role": str(r.get("role") or ""),
        "period": str(r.get("period") or ""),
        "title": title or org,
        "summary": str(r.get("summary") or (bullets[0] if bullets else "")),
        "bullets": bullets,
        "keywords": _norm_keywords(r.get("keywords")),
        "themes": themes,
        "tracks": tracks,
        "regions": [str(x) for x in (r.get("regions") or [])][:4],
        "competencies": [str(x) for x in (r.get("competencies") or [])][:6],
        "evidence": [str(x) for x in (r.get("evidence") or [])][:4],
        "resume_line": str(r.get("resume_line") or ""),
        "strength": strength,
    }


PROMPT = """你是职业研究顾问，帮一名学生把简历整理成「经历素材库」，用于岗位匹配和简历改写。

要求：
1. 只根据简历原文，不要编造事实或数字；原文没有的量级不要写。
2. 覆盖所有实质经历：实习、研究/助研、项目、国际经历、教育；重复或过短的合并。
3. 输出 8–14 个事件，按时间倒序。
4. 只输出 JSON 数组，不要任何解释、不要 markdown 代码块。

每个事件的字段：
- id: 短 slug
- type: 实习 / 研究 / 教育 / 国际经历 / 项目
- org: 机构全称
- role: 角色（如 研究实习生）
- period: 起止时间，格式 2025.06–2025.09
- title: 20 字内，概括做了什么（动词开头）
- summary: 两句，做了什么 + 产生了什么结果
- bullets: 3–4 条要点，尽量带数字与产出
- keywords: 4–7 个，格式 {"k":"中文关键词","syn":["同义词","english"],"w":3}；w 取 1–5，越能区分这段经历越高
- themes: 从这些里选 1–4 个：政策研究 / 区域国别 / 美国政治 / 数据与量化 / 项目与协调 / 政府事务 / 内容与传播 / 科技与AI / 地缘与安全 / 国际交流
- tracks: A 国际业务 / B 公共政策 / C 数字科技 / D 交叉（可多选）
- regions: 涉及的国家或地区
- competencies: 可迁移能力，2–4 个
- evidence: 可核查的产出或证据，0–3 条
- resume_line: 一句可直接粘进简历的中文表述
- strength: 1–5

示例元素：
{"id":"usmca-memo","type":"研究","org":"某研究中心","role":"研究助理","period":"2026.03–2026.06","title":"撰写 USMCA 对华影响内参","summary":"跟踪美墨加协定审议进程，完成 3 篇政策内参。","bullets":["每周梳理国会听证与 USTR 文件","撰写 3 篇内参，被课题组采用"],"keywords":[{"k":"贸易政策","syn":["trade policy","USMCA"],"w":4},{"k":"政策研究","syn":["policy research"],"w":3}],"themes":["政策研究","美国政治"],"tracks":["B","A"],"regions":["美国"],"competencies":["政策分析","英文写作"],"evidence":["3 篇内参"],"resume_line":"跟踪 USMCA 审议并撰写 3 篇政策内参。","strength":4}

简历原文：
"""


def structure_experience(resume_text):
    """精读简历 → 经历事件数组；失败返回 []。"""
    if not available() or not (resume_text or "").strip():
        return []
    try:
        content = _chat([{"role": "user", "content": PROMPT + resume_text[:9000]}],
                        temperature=0.2, timeout=90)
    except Exception:
        return []
    rows = _json_array(content or "")
    if not isinstance(rows, list):
        return []
    out = []
    for i, r in enumerate(rows[:14]):
        ev = _norm_event(r, i)
        if ev:
            out.append(ev)
    return out


def _json_block(text):
    if not text:
        return None
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


def expand(locations, keywords, companies, pool_names):
    """返回 {"keywords": [...], "companies": [...]}；失败返回 {}。"""
    if not available():
        return {}
    prompt = (
        "你在帮我设计一次实习岗位检索。请只输出 JSON，不要解释。\n"
        f"目标地点：{locations}\n目标关键词：{keywords}\n用户写的公司：{companies}\n"
        f"可用的公司板池：{pool_names}\n"
        "任务：1) 生成 8-14 个中英文检索关键词；2) 从公司板池里挑 4-8 个最匹配的组织名（只能从池里选）。\n"
        '输出：{"keywords": ["..."], "companies": ["..."]}'
    )
    try:
        d = _json_block(_chat([{"role": "user", "content": prompt}], timeout=45) or "")
        if not d:
            return {}
        kws = [str(x).strip() for x in (d.get("keywords") or []) if str(x).strip()]
        comps = [str(x).strip() for x in (d.get("companies") or []) if str(x).strip()]
        return {"keywords": kws[:14], "companies": comps[:8]}
    except Exception:
        return {}


def fit_reason(job_title, company, candidates, jd_text):
    """给岗位写一句匹配理由；无 key 时返回空串。"""
    if not available():
        return ""
    prompt = (
        "用一句中文（不超过 40 字）说明这个岗位与候选人经历的匹配点，不要客套。\n"
        f"岗位：{company} · {job_title}\n岗位描述：{(jd_text or '')[:800]}\n"
        f"候选人经历：{candidates}\n只输出这一句话。"
    )
    try:
        return (_chat([{"role": "user", "content": prompt}], temperature=0.3) or "").strip()[:80]
    except Exception:
        return ""
