# -*- coding: utf-8 -*-
"""岗位来源适配器：官方 ATS / 政府平台 / 本地 JSON。统一输出候选岗位。"""
import datetime
import html
import json
import re
import ssl
import time
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
TODAY = datetime.date.today()


def _get(url, want_json=True, timeout=30, retries=1):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/html"})
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                body = r.read()
            text = body.decode("utf-8", "ignore")
            return json.loads(text) if want_json else text
        except Exception as e:
            last = e
            time.sleep(0.6 + attempt * 0.6)
    raise last


def clean_html(s):
    if not s:
        return ""
    t = re.sub(r"<br\s*/?>", "\n", s)
    t = re.sub(r"</(p|li|div|h\d)>", "\n", t)
    t = re.sub(r"<li[^>]*>", "- ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    for a, b in [("&nbsp;", " "), ("&amp;", "&"), ("&rsquo;", "'"), ("&ldquo;", '"'),
                 ("&rdquo;", '"'), ("&#39;", "'"), ("&quot;", '"'), ("&lt;", "<"), ("&gt;", ">")]:
        t = t.replace(a, b)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t)
    return t.strip()


COUNTRY = {"sg": "Singapore", "vn": "Vietnam", "my": "Malaysia", "th": "Thailand",
           "id": "Indonesia", "cn": "China", "hk": "Hong Kong", "ph": "Philippines",
           "kh": "Cambodia", "jp": "Japan", "au": "Australia", "us": "United States"}


def cand(source, source_type, company, title, location, country, url, posted=None,
         deadline=None, description="", employment="", raw_id=""):
    country = COUNTRY.get((country or "").lower(), country or "")
    return {
        "source": source, "source_type": source_type, "company": company,
        "title": title, "location": location or "", "country": country or "",
        "url": url, "posted": posted, "deadline": deadline,
        "description": clean_html(description), "employment": employment or "",
        "raw_id": raw_id,
    }


def _is_intern(title, employment):
    t = (title or "").lower()
    e = (employment or "").lower()
    return ("intern" in t or "实习" in t or "trainee" in t or "attachment" in e or "intern" in e)


def smartrecruiters(src):
    company = src["company"]
    out = []
    seen = set()
    t0 = time.time()
    for q in (src.get("queries") or [""]):
        params = {"limit": 100, "offset": 0}
        if q:
            params["q"] = q
        if src.get("country"):
            params["country"] = src["country"]
        url = f"https://api.smartrecruiters.com/v1/companies/{urllib.parse.quote(company)}/postings?{urllib.parse.urlencode(params)}"
        try:
            d = _get(url)
        except Exception as e:
            print(f"  ! {company} {q}: {e}")
            continue
        for p in d.get("content", []):
            pid = p.get("id")
            if pid in seen:
                continue
            seen.add(pid)
            title = p.get("name") or ""
            emp = (p.get("typeOfEmployment") or {}).get("label", "")
            if src.get("interns_only", True) and not _is_intern(title, emp):
                continue
            loc = p.get("location") or {}
            detail = ""
            if time.time() - t0 < 35:
                try:
                    det = _get(f"https://api.smartrecruiters.com/v1/companies/{company}/postings/{pid}", timeout=8)
                    secs = (det.get("jobAd") or {}).get("sections") or {}
                    detail = " ".join((secs.get(k) or {}).get("text", "") for k in
                                      ("jobDescription", "qualifications", "additionalInformation"))
                except Exception:
                    pass
            out.append(cand(f"smartrecruiters:{company}", "official", company, title,
                            loc.get("city"), loc.get("country"), f"https://jobs.smartrecruiters.com/{company}/{pid}",
                            (p.get("releasedDate") or "")[:10], None, detail, emp, pid))
    return out


def greenhouse(src):
    token = src["token"]
    d = _get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true")
    out = []
    for j in d.get("jobs", []):
        title = j.get("title") or ""
        if src.get("interns_only", True) and not _is_intern(title, ""):
            continue
        loc = (j.get("location") or {}).get("name", "")
        out.append(cand(f"greenhouse:{token}", "official", src.get("company", token), title,
                        loc, "", j.get("absolute_url"), (j.get("updated_at") or "")[:10],
                        None, html.unescape(j.get("content") or ""), "", j.get("id")))
    return out


def lever(src):
    company = src["company"]
    d = _get(f"https://api.lever.co/v0/postings/{company}?mode=json")
    out = []
    for j in d:
        title = j.get("text") or ""
        if src.get("interns_only", True) and not _is_intern(title, ""):
            continue
        cats = j.get("categories") or {}
        desc = j.get("descriptionPlain") or ""
        for lst in (j.get("lists") or []):
            desc += "\n" + (lst.get("text") or "") + "\n" + clean_html(lst.get("content") or "")
        out.append(cand(f"lever:{company}", "official", src.get("company_name", company), title,
                        cats.get("location"), "", j.get("hostedUrl"),
                        datetime.datetime.utcfromtimestamp((j.get("createdAt") or 0) / 1000).date().isoformat()
                        if j.get("createdAt") else None,
                        None, desc, cats.get("commitment", ""), j.get("id")))
    return out


def ashby(src):
    org = src["org"]
    d = _get(f"https://api.ashbyhq.com/posting-api/job-board/{org}")
    out = []
    for j in d.get("jobs", []):
        title = j.get("title") or ""
        if src.get("interns_only", True) and not _is_intern(title, ""):
            continue
        out.append(cand(f"ashby:{org}", "official", src.get("company", org), title,
                        j.get("location"), "", j.get("jobUrl"), (j.get("publishedAt") or "")[:10],
                        None, j.get("descriptionHtml") or j.get("descriptionPlain") or "", "", j.get("id")))
    return out


def workable(src):
    token = src["account"]
    d = _get(f"https://apply.workable.com/api/v1/widget/accounts/{token}?details=true")
    out = []
    for j in d.get("jobs", []):
        title = j.get("title") or ""
        if src.get("interns_only", True) and not _is_intern(title, ""):
            continue
        loc = j.get("location") or {}
        desc = (j.get("description") or "") + " " + (j.get("requirements") or "")
        out.append(cand(f"workable:{token}", "official", src.get("company", token), title,
                        loc.get("city"), loc.get("country"), j.get("url") or j.get("shortlink"),
                        (j.get("published_on") or "")[:10], None, desc, "", j.get("shortcode")))
    return out


def mcf(src):
    out = []
    for q in src.get("queries", []):
        url = "https://api.mycareersfuture.gov.sg/v2/jobs?" + urllib.parse.urlencode(
            {"search": q, "limit": src.get("limit", 30)})
        try:
            d = _get(url)
        except Exception as e:
            print(f"  ! mcf {q}: {e}")
            continue
        for j in d.get("results", []):
            meta = j.get("metadata") or {}
            status = (j.get("status") or {}).get("jobStatus")
            expiry = meta.get("expiryDate")
            if status != "Open" or (expiry and expiry < TODAY.isoformat()):
                continue
            emps = [e.get("employmentType", "") for e in (j.get("employmentTypes") or [])]
            title = j.get("title") or ""
            if src.get("interns_only", True) and not _is_intern(title, ",".join(emps)):
                continue
            sal = j.get("salary") or {}
            pay = f"SGD {sal.get('minimum')}-{sal.get('maximum')}/month" if sal.get("minimum") else ""
            out.append(cand("mcf", "government", (j.get("postedCompany") or {}).get("name", ""), title,
                            (j.get("address") or {}).get("districts", [{}])[0].get("location", ""),
                            "Singapore", meta.get("jobDetailsUrl"), meta.get("newPostingDate"), expiry,
                            j.get("description") or "", ",".join(emps), j.get("uuid")))
            out[-1]["salary"] = pay
    return out


def tencent(src):
    """腾讯招聘公开接口（careers.tencent.com）。"""
    out = []
    pages = src.get("pages", 2)
    for page in range(1, pages + 1):
        params = {
            "timestamp": int(time.time() * 1000),
            "keyword": src.get("keyword", "实习"),
            "pageIndex": page, "pageSize": 30,
            "language": "zh-cn", "area": "cn",
        }
        url = "https://careers.tencent.com/tencentcareer/api/post/Query?" + urllib.parse.urlencode(params)
        try:
            d = _get(url)
        except Exception as e:
            print(f"  ! tencent page {page}: {e}")
            break
        posts = (d.get("Data") or {}).get("Posts") or []
        if not posts:
            break
        for p in posts:
            title = p.get("RecruitPostName") or ""
            if src.get("interns_only", True) and "实习" not in title and "intern" not in title.lower():
                continue
            desc = (p.get("Responsibility") or "") + "\n" + (p.get("Requirement") or "")
            out.append(cand("tencent", "official", "腾讯", title,
                            p.get("LocationName") or "", "China",
                            p.get("PostURL") or "", _cn_date(p.get("LastUpdateTime")), None,
                            desc, "实习", p.get("PostId")))
            out[-1]["salary"] = p.get("Salary") or "面议"
    return out


def _cn_date(s):
    m = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s or "")
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


def _pua_clean(s):
    """去掉字体混淆用的私有区字符，并反转义 HTML 实体。"""
    if not s:
        return ""
    s = html.unescape(s)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[\ue000-\uf8ff]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _sxs_detail(url):
    """抓详情页：返回 (干净标题, JD 文本)。"""
    try:
        h = _get(url, want_json=False, timeout=15)
    except Exception:
        return "", ""
    m = re.search(r"<title[^>]*>(.*?)</title>", h, re.S)
    title = html.unescape(m.group(1)).split("实习招聘")[0].strip() if m else ""
    jd = ""
    m2 = re.search(r'class="job_detail"[^>]*>(.*?)</div>', h, re.S)
    if m2:
        jd = _pua_clean(m2.group(1))[:2000]
    return title, jd


def shixiseng(src):
    """实习僧检索：国内公司的第三方在架岗位（平台来源，需复核）。"""
    kw = src.get("keyword", "")
    params = {"keyword": kw, "type": "intern"}
    if src.get("city"):
        params["city"] = src["city"]
    url = "https://www.shixiseng.com/interns?" + urllib.parse.urlencode(params)
    try:
        page = _get(url, want_json=False, timeout=20)
    except Exception as e:
        print(f"  ! shixiseng {kw}: {e}")
        return []

    out = []
    blocks = page.split('data-intern-id="')[1:]
    for b in blocks[: src.get("limit", 12)]:
        iid = b.split('"', 1)[0]
        if not iid.startswith("inn_"):
            continue
        m = re.search(r'class="title ellipsis font"[^>]*>(.*?)</a>', b, re.S)
        raw_title = _pua_clean(m.group(1)) if m else ""
        if len(raw_title) < 4:
            continue
        city_m = re.search(r'class="city ellipsis"[^>]*>(.*?)</span>', b, re.S)
        city = _pua_clean(city_m.group(1)) if city_m else ""
        comp_m = re.search(r'intern-detail__company.*?title="([^"]+)"', b, re.S)
        comp = _pua_clean(comp_m.group(1)) if comp_m else kw
        if kw and kw not in comp and kw not in raw_title:
            continue

        link = f"https://www.shixiseng.com/intern/{iid}"
        title, jd = _sxs_detail(link)
        if not title:
            title = raw_title
        title = title.replace("|", " ").strip()
        employer = ""
        if " - " in title:
            role, employer = title.split(" - ", 1)
            title = role.strip()
            employer = employer.strip()
            if employer and employer not in title and employer != comp:
                title = f"{title}（{employer}）"
        if not jd:
            jd = title

        out.append(cand("shixiseng", "third_party", comp, title, city, "China",
                        link, None, None, jd or title, "实习", iid))
        out[-1]["salary"] = "面议"
    return out


def jsonfile(src):
    path = src["path"]
    d = json.load(open(path, encoding="utf-8-sig"))
    rows = d.get("jobs") if isinstance(d, dict) else d
    out = []
    for j in rows or []:
        title = j.get("title") or j.get("title_en") or j.get("title_cn") or ""
        out.append(cand("json:" + path, "third_party", j.get("company", ""), title,
                        j.get("location") or j.get("city", ""), j.get("country", ""),
                        j.get("url") or (j.get("apply") or {}).get("url", ""),
                        j.get("posted_date"), j.get("deadline"),
                        j.get("description") or ((j.get("jd") or {}).get("summary") or ""),
                        j.get("job_type", ""), j.get("id", "")))
    return out


ADAPTERS = {
    "smartrecruiters": smartrecruiters,
    "greenhouse": greenhouse,
    "lever": lever,
    "ashby": ashby,
    "workable": workable,
    "mcf": mcf,
    "tencent": tencent,
    "shixiseng": shixiseng,
    "json": jsonfile,
}


def collect(cfg):
    out = []
    for src in cfg.get("sources") or []:
        fn = ADAPTERS.get(src.get("type"))
        if not fn:
            print(f"  ? 未知来源类型：{src.get('type')}")
            continue
        print(f"  · 抓取 {src.get('type')} {src.get('company') or src.get('token') or src.get('org') or src.get('account') or src.get('path') or ''}")
        rows = fn({**sys_defaults(), **src})
        print(f"    {len(rows)} 条")
        out.extend(rows[: src.get("max", 60)])
    return out


def sys_defaults():
    return {"interns_only": True}
