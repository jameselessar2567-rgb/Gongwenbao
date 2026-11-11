# -*- coding: utf-8 -*-
"""简历解析：抽取文本 + 启发式拆事件 + 生成给大模型的精修提示词。"""
import os
import re
import sys

from .config import write_json, slug


def extract_text(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        lib = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools", "_libs")
        if os.path.isdir(lib) and lib not in sys.path:
            sys.path.insert(0, lib)
        try:
            from pypdf import PdfReader
        except ImportError:
            raise SystemExit("解析 PDF 需要 pypdf：python tools/get_pypdf.py 或 pip install pypdf")
        return "\n".join((p.extract_text() or "") for p in PdfReader(path).pages)
    if ext == ".docx":
        try:
            import docx
        except ImportError:
            raise SystemExit("解析 DOCX 需要 python-docx")
        return "\n".join(p.text for p in docx.Document(path).paragraphs)
    return open(path, encoding="utf-8", errors="ignore").read()


PERIOD = re.compile(
    r"((?:19|20)\d{2}\s*[.\-/年]\s*\d{1,2}?)\s*[-–—~至]+\s*(((?:19|20)\d{2}\s*[.\-/年]\s*\d{1,2})|至今|今|present|now)",
    re.I)


def guess_type(text):
    if any(k in text for k in ("本科", "硕士", "博士", "GPA", "学位", "Bachelor", "Master")):
        return "教育"
    if any(k in text for k in ("研究", "论文", "报告", "research", "paper")):
        return "研究"
    if any(k in text for k in ("耶鲁", "LSE", "交换", "暑校", "对话", "exchange", "summer")):
        return "国际经历"
    return "实习"


def parse_events(text, limit=14):
    pua = re.compile(r"[\ue000-\uf8ff]")
    lines = [re.sub(r"\s+", " ", pua.sub("", l)).strip() for l in text.split("\n")]
    lines = [l for l in lines if l]
    events, current = [], None
    for line in lines:
        m = PERIOD.search(line)
        if m:
            if current:
                events.append(current)
            head = PERIOD.sub("", line).strip(" |-·")
            current = {"period": m.group(1).replace(" ", "") + "–" + m.group(2).replace(" ", ""),
                       "head": head, "bullets": []}
        elif current is not None and len(current["bullets"]) < 4:
            if len(line) > 8:
                current["bullets"].append(line)
    if current:
        events.append(current)

    out = []
    for i, ev in enumerate(events[:limit]):
        head = ev["head"]
        parts = re.split(r"[|｜·]", head)
        org = parts[0].strip() if parts else head
        role = parts[1].strip() if len(parts) > 1 else ""
        out.append({
            "id": slug(org + "-" + str(i)) or f"exp-{i}",
            "type": guess_type(head + " " + " ".join(ev["bullets"])),
            "org": org,
            "role": role,
            "period": ev["period"],
            "title": (ev["bullets"][0][:40] if ev["bullets"] else head)[:60],
            "summary": (ev["bullets"][0] if ev["bullets"] else head)[:160],
            "bullets": ev["bullets"][:4],
            "keywords": [],
            "themes": [],
            "tracks": ["A"],
            "regions": [],
            "competencies": [],
            "evidence": [],
            "resume_line": ev["bullets"][0] if ev["bullets"] else "",
            "strength": 3,
        })
    return out


THEME_RULES = {
    "政策研究": ["政策", "public policy", "policy", "监管", "政府"],
    "区域国别": ["东南亚", "美国", "欧洲", "越南", "新加坡", "国别", "区域", "country", "region"],
    "美国政治": ["美国", "国会", "congress", "中美", "us-china"],
    "数据与量化": ["数据", "data", "sql", "excel", "统计", "量化", "模型", "指标"],
    "项目与协调": ["项目", "协调", "组织", "活动", "推进", "project", "运营"],
    "政府事务": ["政府", "部委", "大使馆", "government", "公共事务"],
    "内容与传播": ["写作", "简报", "传播", "媒体", "content", "公众号", "文案"],
    "科技与AI": ["ai", "人工智能", "科技", "技术", "digital", "算法"],
    "地缘与安全": ["安全", "地缘", "军事", "冲突", "security", "战略"],
    "国际交流": ["交换", "国际", "海外", "留学", "交流", "global", "international"],
}
TRACK_RULES = {
    "A": ["国际", "海外", "战略", "business", "市场", "出海", "全球"],
    "B": ["政策", "政府", "public", "研究", "国关", "治理"],
    "C": ["数据", "ai", "产品", "数字", "技术", "platform"],
}
REGION_WORDS = ["中国", "美国", "英国", "越南", "新加坡", "日本", "韩国", "欧洲", "东南亚",
                "北京", "上海", "深圳", "香港", "伦敦", "纽约"]


def enrich(event):
    """给自动解析出来的事件补关键词、主题、路径、地区，让匹配页能用。"""
    text = (event.get("title", "") + " " + event.get("summary", "") + " " +
            " ".join(event.get("bullets") or [])).lower()
    themes = [t for t, words in THEME_RULES.items() if any(w.lower() in text for w in words)]
    event["themes"] = themes[:4]
    tracks = [k for k, words in TRACK_RULES.items() if any(w.lower() in text for w in words)]
    event["tracks"] = tracks or ["A"]
    event["regions"] = sorted({w for w in REGION_WORDS if w in text})
    kws = []
    for t in themes[:3]:
        kws.append({"k": t, "syn": [w for w in THEME_RULES[t] if w.lower() in text][:3], "w": 3})
    for r in event["regions"][:2]:
        kws.append({"k": r, "syn": [r.lower()], "w": 2})
    if not kws:
        kws = [{"k": event.get("type", "经历"), "syn": [], "w": 1}]
    event["keywords"] = kws
    if not event.get("resume_line"):
        event["resume_line"] = (event.get("bullets") or [event.get("title", "")])[0][:80]
    event["strength"] = 4 if len(event.get("bullets") or []) >= 2 else 3
    return event

PROMPT = """# 把简历文本整理成经历素材库

把下面的 `experience.json` 脚手架交给任意大模型（ChatGPT / Claude / DSH），用这段提示词精修：

---
你是职业研究顾问。请把 `experiences` 数组里的每个事件改写成可直接用于岗位匹配的结构：

- `title`：一句话概括这段经历做了什么（不超过 20 字）
- `summary`：2 句话，说明做了什么、产生了什么结果
- `bullets`：3–4 条要点，尽量量化
- `keywords`：4–7 个关键词，每个写成 {{"k": "关键词", "syn": ["同义词", "english"], "w": 3}}
  - k 用你希望在图和标签里显示的中文短语；syn 放英文/别名；w 取 2–5，越能区分这段经历越高
- `themes`：从这些主题里选 1–4 个：政策研究 / 区域国别 / 美国政治 / 数据与量化 / 项目与协调 / 政府事务 / 内容与传播 / 科技与AI / 地缘与安全 / 国际交流
- `tracks`：A 国际业务 / B 公共政策 / C 数字科技 / D 交叉方向（可多选）
- `regions`：涉及的国家或地区
- `resume_line`：一句可直接粘进简历的中文表述
- `strength`：1–5，代表这段经历在求职中的分量

只输出完整 JSON，不要解释。
---

原始简历文本：

```
{resume}
```
"""


def build(resume_path, out_path, name=""):
    text = extract_text(resume_path)
    events = [enrich(e) for e in parse_events(text)]
    profile = {
        "name": name or os.path.splitext(os.path.basename(resume_path))[0],
        "school": "", "major": "", "degree": "", "period": "",
        "rank": "", "gpa": "", "honors": [], "languages": [], "courses": [],
        "summary": "",
    }
    doc = {"profile": profile, "experiences": events}
    write_json(out_path, doc)

    prompt_path = os.path.join(os.path.dirname(out_path), "..", "prompts", "profile_refine.md")
    os.makedirs(os.path.dirname(os.path.abspath(prompt_path)), exist_ok=True)
    with open(prompt_path, "w", encoding="utf-8") as f:
        f.write(PROMPT.format(resume=text[:6000]))
    return doc, prompt_path
