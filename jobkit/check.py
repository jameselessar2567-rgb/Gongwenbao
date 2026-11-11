# -*- coding: utf-8 -*-
"""在架状态核查：按 URL 自动选择官方 API 或页面检查。"""
import datetime
import http.client
import json
import os
import re
import ssl
import urllib.error
import urllib.request

from .config import data_dir, read_json, write_json, today

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
CLOSED = ["该职位已下线", "职位已关闭", "已停止招聘", "暂停招聘", "职位不存在",
          "no longer accepting", "position has been filled", "job has expired"]


def _get(url, want_json=False, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        try:
            body = r.read()
        except http.client.IncompleteRead as e:
            body = e.partial
    text = body.decode("utf-8", "ignore")
    return r.status, (json.loads(text) if want_json else text)


def check_one(job):
    url = (job.get("apply") or {}).get("url") or ""
    jd_url = (job.get("apply") or {}).get("jd_url") or ""
    if url.startswith("mailto:"):
        url = jd_url or url
    try:
        if "jobs.bytedance.com" in url:
            m = re.search(r"/position/(\d+)", url) or re.search(r"/(\d{15,})", url)
            if m:
                st, d = _get(f"https://jobs.bytedance.com/api/v1/job/posts/{m.group(1)}", True)
                det = ((d.get("data") or {}).get("job_post_detail") or {})
                online = det.get("channel_online_status")
                return {"status": "open" if online == 1 else ("closed" if online == 0 else "unknown"),
                        "http": st, "note": f"官方 API channel_online_status={online}"}
        if "smartrecruiters.com" in url:
            m = re.search(r"/(\d{12,})", url)
            if m:
                st, d = _get(f"https://api.smartrecruiters.com/v1/companies/{url.split('/')[3]}/postings/{m.group(1)}", True)
                return {"status": "open" if d.get("active") else "closed", "http": st,
                        "note": f"官方 ATS active={d.get('active')}"}
        if "mycareersfuture.gov.sg" in url:
            m = re.search(r"([0-9a-f]{32})\s*$", url.rstrip("/"))
            if m:
                st, d = _get(f"https://api.mycareersfuture.gov.sg/v2/jobs/{m.group(1)}", True)
                status = (d.get("status") or {}).get("jobStatus")
                return {"status": "open" if status == "Open" else "closed", "http": st,
                        "note": f"MCF jobStatus={status}"}
        st, text = _get(url)
        low = text.lower()
        if any(c in low for c in CLOSED):
            return {"status": "closed", "http": st, "note": "页面出现关闭标记"}
        return {"status": "open", "http": st, "note": "页面可访问且未见关闭标记"}
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            return {"status": "closed", "http": e.code, "note": f"HTTP {e.code}，页面不存在"}
        if e.code == 403:
            return {"status": "unknown", "http": e.code, "note": "HTTP 403：反爬拦截，需人工确认"}
        return {"status": "unknown", "http": e.code, "note": f"HTTP {e.code}"}
    except Exception as e:
        return {"status": "unknown", "http": None, "note": "访问异常：" + type(e).__name__}


def run(cfg, verbose=True):
    d = data_dir(cfg)
    doc = read_json(os.path.join(d, "jobs.json"), {"meta": {}, "jobs": []})
    prev = read_json(os.path.join(d, "updates.json"), {}) or {}
    history = prev.get("history") or {}
    prev_jobs = prev.get("jobs") or {}
    results, changes = {}, []
    for j in doc.get("jobs") or []:
        r = check_one(j)
        r["checked_at"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        results[j["id"]] = r
        old = (prev_jobs.get(j["id"]) or {}).get("status")
        if old and old != r["status"]:
            changes.append({"id": j["id"], "company": j.get("company"), "title": j.get("title_en"),
                            "type": "status", "from": old, "to": r["status"], "note": r["note"]})
        if verbose:
            print(f"  {r['status']:7} {j.get('company','')[:24]:24} {r.get('title_cn') or j.get('title_en','')[:40]:40} {r['note'][:40]}")
    counts = {"open": 0, "closed": 0, "unknown": 0}
    for r in results.values():
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    history[today()] = {k: v["status"] for k, v in results.items()}
    for k in sorted(history)[:-30]:
        history.pop(k, None)
    out = {"generated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
           "generated_date": today(),
           "summary": {"total": len(results), "open": counts["open"], "closed": counts["closed"],
                       "unknown": counts["unknown"], "changes_today": len(changes)},
           "jobs": results, "changes": changes, "history": history}
    write_json(os.path.join(d, "updates.json"), out)
    print("核查完成：", out["summary"])
    return out
