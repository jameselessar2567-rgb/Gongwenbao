# -*- coding: utf-8 -*-
"""把「公司名」解析成可抓取的官方招聘板（Greenhouse / Lever / Ashby / Workable / SmartRecruiters）。"""
import json
import re
import ssl
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def _get(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def _slugs(name):
    base = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    flat = base.replace("-", "")
    out = []
    for s in (base, flat, base.replace("-", "")):
        if s and s not in out:
            out.append(s)
    return out


def _try(fn, slug, attempts=2):
    for i in range(attempts):
        try:
            return fn(slug)
        except Exception:
            if i == attempts - 1:
                return None


def _greenhouse(slug):
    d = _get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
    if d.get("jobs"):
        return {"type": "greenhouse", "token": slug}
    return None


def _lever(slug):
    for candidate in (slug, slug + "-2", slug + "-1"):
        try:
            d = _get(f"https://api.lever.co/v0/postings/{candidate}?mode=json")
        except Exception:
            continue
        if isinstance(d, list) and d:
            return {"type": "lever", "company": candidate}
    return None


def _ashby(slug):
    d = _get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    if d.get("jobs"):
        return {"type": "ashby", "org": slug}
    return None


def _workable(slug):
    d = _get(f"https://apply.workable.com/api/v1/widget/accounts/{slug}")
    if d.get("jobs"):
        return {"type": "workable", "account": slug}
    return None


def _smartrecruiters(slug):
    d = _get(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=1")
    if d.get("content"):
        return {"type": "smartrecruiters", "company": slug}
    return None


BOARDS = [("Greenhouse", _greenhouse), ("Lever", _lever), ("Ashby", _ashby),
          ("Workable", _workable), ("SmartRecruiters", _smartrecruiters)]

CN_NAMES = {}
CN_UNSUPPORTED = set()

# 国内公司：通过实习僧检索（第三方在架，投递前需复核官方）
SXS_NAMES = {
    "字节": "字节跳动", "字节跳动": "字节跳动", "bytedance": "字节跳动", "抖音": "字节跳动", "tiktok": "字节跳动",
    "腾讯": "腾讯", "tencent": "腾讯",
    "京东": "京东", "jd": "京东", "jd.com": "京东",
    "阿里": "阿里巴巴", "阿里巴巴": "阿里巴巴", "alibaba": "阿里巴巴",
    "美团": "美团", "meituan": "美团",
    "小红书": "小红书", "xiaohongshu": "小红书",
    "滴滴": "滴滴", "didi": "滴滴",
    "快手": "快手", "kuaishou": "快手",
    "百度": "百度", "baidu": "百度",
    "网易": "网易", "netease": "网易",
    "华为": "华为", "huawei": "华为",
    "小米": "小米", "xiaomi": "小米",
    "拼多多": "拼多多", "pdd": "拼多多",
    "哔哩哔哩": "哔哩哔哩", "b站": "哔哩哔哩", "bilibili": "哔哩哔哩",
}


def _tencent():
    url = ("https://careers.tencent.com/tencentcareer/api/post/Query?"
           "timestamp=1&keyword=%E5%AE%9E%E4%B9%A0&pageIndex=1&pageSize=1&language=zh-cn&area=cn")
    d = _get(url)
    data = d.get("Data") or {}
    if d.get("Code") == 200 and (data.get("Count") or 0) > 0:
        return {"type": "tencent", "keyword": "实习"}
    return None


def resolve(name):
    """返回 (source, board_label)；找不到返回 (None, None)。"""
    key = (name or "").strip().lower()
    if key in SXS_NAMES:
        return {"type": "shixiseng", "keyword": SXS_NAMES[key]}, "实习僧"
    for slug in _slugs(name):
        for label, fn in BOARDS:
            src = _try(fn, slug)
            if src:
                return src, label
    return None, None


def unsupported_hint(name):
    key = (name or "").strip().lower()
    return key in CN_UNSUPPORTED


def resolve_all(names):
    found, missing = [], []
    for n in names:
        n = (n or "").strip()
        if not n:
            continue
        src, label = resolve(n)
        if src:
            src["_display"] = n
            found.append({"name": n, "board": label, "source": src})
        else:
            missing.append(n)
    return found, missing
