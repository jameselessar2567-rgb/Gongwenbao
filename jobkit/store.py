# -*- coding: utf-8 -*-
"""把 jobs.json / experience.json / site.json / updates.json 合成前端需要的 bundle。"""
import csv
import json
import os

from .config import data_dir, read_json, write_json, today


def bundle(cfg, write=True):
    d = data_dir(cfg)
    jobs_doc = read_json(os.path.join(d, "jobs.json"), {"meta": {}, "jobs": []})
    jobs = jobs_doc.get("jobs") or []
    out = {"meta": jobs_doc.get("meta") or {}, "jobs": jobs}

    exp = read_json(os.path.join(d, "experience.json"))
    if exp:
        out["experiences"] = exp

    site = read_json(os.path.join(d, "site.json"))
    if site:
        out["site"] = site

    live = read_json(os.path.join(d, "updates.json"))
    if live:
        out["live"] = live

    out["meta"]["last_verified"] = out["meta"].get("last_verified") or today()
    out["meta"]["counts"] = {
        "total": len(jobs),
        "official": sum(1 for j in jobs if (j.get("verification") or {}).get("status") == "official"),
        "platform": sum(1 for j in jobs if (j.get("verification") or {}).get("status") == "platform"),
    }

    if not write:
        return out

    write_json(os.path.join(d, "jobs.json"), jobs_doc)
    with open(os.path.join(d, "jobs.js"), "w", encoding="utf-8") as f:
        f.write("/* 由 jobkit build 生成，请勿手工编辑 */\nwindow.JOBS_DATA = ")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    cols = ["id", "company", "title_en", "title_cn", "city", "country", "region_tier",
            "industry", "function", "priority", "score_total", "duration", "days_per_week",
            "start_window", "posted_date", "deadline", "salary", "verification_status",
            "eligibility_status", "apply_url"]
    with open(os.path.join(d, "jobs.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for j in jobs:
            w.writerow([
                j.get("id"), j.get("company"), j.get("title_en"), j.get("title_cn"),
                j.get("city"), j.get("country"), j.get("region_tier"), j.get("industry"),
                j.get("function"), j.get("priority"), j.get("score_total"), j.get("duration"),
                j.get("days_per_week"), j.get("start_window"), j.get("posted_date"),
                j.get("deadline"), j.get("salary"),
                (j.get("verification") or {}).get("status"),
                (j.get("eligibility") or {}).get("status"),
                (j.get("apply") or {}).get("url"),
            ])
    return out
