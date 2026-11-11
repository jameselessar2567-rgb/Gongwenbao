# -*- coding: utf-8 -*-
"""内置公司池：无需用户填写公司，也能按地点/关键词检索一批官方招聘板。"""

# regions: us / eu / sg / global
BOARDS = [
    {"name": "Airbnb", "type": "greenhouse", "token": "airbnb", "regions": ["us", "global"], "tags": ["travel", "marketplace"]},
    {"name": "Figma", "type": "greenhouse", "token": "figma", "regions": ["us", "global"], "tags": ["design", "product"]},
    {"name": "Robinhood", "type": "greenhouse", "token": "robinhood", "regions": ["us"], "tags": ["fintech"]},
    {"name": "Reddit", "type": "greenhouse", "token": "reddit", "regions": ["us", "global"], "tags": ["platform", "content"]},
    {"name": "Pinterest", "type": "greenhouse", "token": "pinterest", "regions": ["us", "global"], "tags": ["platform", "ads"]},
    {"name": "Dropbox", "type": "greenhouse", "token": "dropbox", "regions": ["us"], "tags": ["saas"]},
    {"name": "Discord", "type": "greenhouse", "token": "discord", "regions": ["us"], "tags": ["community"]},
    {"name": "Scale AI", "type": "greenhouse", "token": "scaleai", "regions": ["us"], "tags": ["ai", "data"]},
    {"name": "Anthropic", "type": "greenhouse", "token": "anthropic", "regions": ["us", "global"], "tags": ["ai", "policy"]},
    {"name": "Brex", "type": "greenhouse", "token": "brex", "regions": ["us"], "tags": ["fintech"]},
    {"name": "Coinbase", "type": "greenhouse", "token": "coinbase", "regions": ["us", "global"], "tags": ["crypto", "policy"]},
    {"name": "Notion", "type": "ashby", "org": "notion", "regions": ["us", "global"], "tags": ["productivity", "ai"]},
    {"name": "Linear", "type": "ashby", "org": "linear", "regions": ["us"], "tags": ["saas", "product"]},
    {"name": "Vanta", "type": "ashby", "org": "vanta", "regions": ["us"], "tags": ["security"]},
    {"name": "Ramp", "type": "ashby", "org": "ramp", "regions": ["us"], "tags": ["fintech"]},
    {"name": "ShopBack", "type": "lever", "company": "shopback-2", "regions": ["sg", "global"], "tags": ["payments", "sea"]},
    {"name": "Grab", "type": "smartrecruiters", "company": "Grab", "queries": ["intern"], "country": "sg", "regions": ["sg", "sea"], "tags": ["platform", "sea"]},
]


def region_keys(locations):
    keys = set()
    for loc in locations or []:
        l = (loc or "").lower()
        if any(k in l for k in ("新加坡", "singapore", "吉隆坡", "曼谷", "雅加达", "越南", "河内", "胡志明", "马尼拉", "东南亚")):
            keys.add("sg")
        elif any(k in l for k in ("伦敦", "巴黎", "柏林", "阿姆斯特丹", "london", "paris", "berlin", "europe")):
            keys.add("eu")
        elif any(k in l for k in ("纽约", "旧金山", "西雅图", "多伦多", "美国", "new york", "san francisco", "seattle", "toronto")):
            keys.add("us")
        else:
            keys.add("global")
    return keys or {"global"}


def pick(locations, limit=6):
    """按地点挑选公司板，优先区域匹配。"""
    keys = region_keys(locations)
    scored = []
    for b in BOARDS:
        score = 0
        if keys & set(b["regions"]):
            score += 2
        if "global" in b["regions"]:
            score += 1
        scored.append((score, b["name"], b))
    scored.sort(key=lambda x: (-x[0], x[1]))
    out = []
    for _, _, b in scored[:limit]:
        src = {k: v for k, v in b.items() if k not in ("name", "regions", "tags")}
        src["_display"] = b["name"]
        out.append({"name": b["name"], "source": src})
    return out


def all_names():
    return [b["name"] for b in BOARDS]
