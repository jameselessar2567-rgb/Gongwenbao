/* 实习申请库 — 前端应用
 * 数据来源: data/jobs.json (优先, 需 http) 或 data/jobs.js (window.JOBS_DATA, 支持 file://)
 * 申请进度: localStorage
 */
(function () {
  "use strict";

  var LS_KEY = "internship_library_v1";
  var STATUSES = ["未查看", "准备申请", "已投递", "笔试/面试中", "已结束"];
  var TRACK_LABELS = {
    A: "国际业务与企业战略",
    B: "MPA 公共政策",
    C: "OII 数字科技",
    D: "交叉方向"
  };
  var TRACK_SHORT = {
    A: "A 国际业务",
    B: "B MPA 政策",
    C: "C OII 科技",
    D: "D 交叉方向"
  };
  var REGION_ORDER = ["北京", "越南", "新加坡", "其他东南亚", "中国其他城市"];
  var PRIORITY_ORDER = ["A", "B", "C"];

  var state = {
    view: "library",
    q: "",
    filters: {
      region: [], track: [], priority: [], industry: [], func: [],
      duration: [], deadline: [], eligibility: [], verification: [], favOnly: false
    },
    sort: "score",
    showPendingInline: false,
    currentId: null,
    list: [],
    pendingList: [],
    matchJobId: null,
    expFilter: "全部",
    expQuery: ""
  };

  var DATA = null, JOBS = [];
  var SITE = {};
  var store = loadStore();

  /* ---------------- utils ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function t(v, fb) { return (v === null || v === undefined || v === "") ? (fb === undefined ? "未说明" : fb) : v; }
  function u(v, fb) { return (!v || v === "未说明" || v === "null") ? fb : v; }
  function arr(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x && !s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function has(arrv, v) { return arrv.indexOf(v) !== -1; }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr + "T23:59:59");
    if (isNaN(d.getTime())) return null;
    var now = new Date();
    return Math.ceil((d - now) / 86400000);
  }
  function fmtDeadline(j) {
    if (!j.deadline) return { text: "滚动招聘 / 未公布", cls: "none", sub: "" };
    var d = daysUntil(j.deadline);
    if (d === null) return { text: j.deadline, cls: "none", sub: "" };
    if (d < 0) return { text: j.deadline, cls: "urgent", sub: "已截止" };
    if (d <= 14) return { text: j.deadline, cls: "urgent", sub: "剩 " + d + " 天" };
    return { text: j.deadline, cls: "", sub: "剩 " + d + " 天" };
  }
  function normalizeDate(v) { return v || ""; }

  function loadStore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return { favorites: {}, records: {} };
      var p = JSON.parse(raw);
      return { favorites: p.favorites || {}, records: p.records || {} };
    } catch (e) { return { favorites: {}, records: {} }; }
  }
  function saveStore() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* quota */ }
  }
  function recordOf(id) {
    if (!store.records[id]) store.records[id] = { status: "未查看", notes: "", applyDate: "", followUp: "", updatedAt: "" };
    return store.records[id];
  }
  function isTracked(id) {
    var r = store.records[id];
    return !!store.favorites[id] || (r && (r.status !== "未查看" || r.notes || r.applyDate || r.followUp));
  }
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2200);
  }

  /* ---------------- data load ---------------- */
  function boot() {
    var embedded = window.JOBS_DATA;
    function fallback() {
      if (embedded && embedded.jobs && embedded.jobs.length) init(embedded);
      else renderFatal();
    }
    if (typeof fetch !== "function") { fallback(); return; }
    fetch("data/jobs.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (json) { init(json); })
      .catch(fallback);
  }

  /* ---------------- theme ---------------- */
  var THEMES = [
    { key: "dracula", name: "Dracula", dot: "#FF79C6" },
    { key: "graphite", name: "石墨", dot: "#E0A458" },
    { key: "nord", name: "北境", dot: "#88C0D0" },
    { key: "forest", name: "森林", dot: "#9CC5A1" },
    { key: "paper", name: "纸张", dot: "#B4552D" },
    { key: "ink", name: "靛青", dot: "#2F6690" }
  ];

  function applyTheme(key) {
    document.documentElement.setAttribute("data-theme", key || "dracula");
    try { localStorage.setItem("jobkit_theme", key || "dracula"); } catch (e) {}
    $$(".theme-item").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-key") === key);
    });
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem("jobkit_theme"); } catch (e) {}
    applyTheme(saved || SITE.theme || "dracula");
    var host = document.querySelector(".topbar-right");
    if (!host) return;
    var wrap = document.createElement("div");
    wrap.className = "theme-wrap";
    wrap.innerHTML = '<button class="theme-btn" title="切换配色" aria-label="切换配色">◐</button>' +
      '<div class="theme-pop"><div class="tp-title">配色</div>' +
      THEMES.map(function (t) {
        return '<button class="theme-item" data-key="' + t.key + '"><span class="theme-dot" style="background:' + t.dot + '"></span>' + t.name + "</button>";
      }).join("") + "</div>";
    host.appendChild(wrap);
    var btn = wrap.querySelector(".theme-btn");
    var pop = wrap.querySelector(".theme-pop");
    btn.onclick = function (e) { e.stopPropagation(); pop.classList.toggle("open"); };
    document.addEventListener("click", function () { pop.classList.remove("open"); });
    $$(".theme-item", wrap).forEach(function (b) {
      b.onclick = function () {
        applyTheme(b.getAttribute("data-key"));
        pop.classList.remove("open");
      };
    });
  }

  function init(json) {    DATA = json || {};
    JOBS = (DATA.jobs || []).filter(function (j) {
      return j && j.verification && (j.verification.status === "official" || j.verification.status === "platform");
    });
    // guarantee totals
    JOBS.forEach(function (j) {
      if (j.scores) {
        var sum = 0;
        Object.keys(j.scores).forEach(function (k) { sum += Number(j.scores[k]) || 0; });
        if (!j.score_total) j.score_total = sum;
      }
      j._search = [
        j.company, j.company_en, j.title_en, j.title_cn, j.dept, j.city,
        j.industry, j.function, (j.tags || []).join(" "),
        (j.jd && (j.jd.responsibilities || []).join(" ")) || "",
        (j.jd && (j.jd.requirements || []).join(" ")) || "",
        (j.fit && j.fit.why) || ""
      ].join(" ").toLowerCase();
    });
    renderStats();
    buildFilters();
    var expData = (DATA && DATA.experiences) || {};
    EXPERIENCE = expData.experiences || [];
    PROFILE = expData.profile || {};
    SITE = (DATA && DATA.site) || {};
    applySite();
    initTheme();
    var etc = $("#tabCountExp");
    if (etc) etc.textContent = EXPERIENCE.length;
    renderMethod();
    render();
    renderTracker();
    renderFreshness();
    renderLive();
    wire();
    applyDeepLink();
  }

  /* ---------------- live tracking ---------------- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (!d || isNaN(d.getTime())) return t(iso, "—");
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function liveOf() { return (DATA && DATA.live) || null; }

  function renderFreshness() {
    var el = $("#freshness");
    if (!el) return;
    var live = liveOf();
    if (!live || !live.generated_at) {
      el.className = "freshness warn";
      el.innerHTML = '<span class="dot"></span><span>尚未运行每日核查</span>' +
        '<span class="sep"></span><span>运行 <code>python tools/daily_check.py</code> 后刷新页面</span>' +
        '<span class="sep"></span><a data-goto="live">查看更新追踪 →</a>';
    } else {
      var when = new Date(live.generated_at);
      var hours = (Date.now() - when.getTime()) / 3600000;
      var s = live.summary || {};
      var fresh = hours < 36;
      var ago = hours < 1 ? "刚刚" : (hours < 24 ? Math.round(hours) + " 小时前" : Math.round(hours / 24) + " 天前");
      el.className = "freshness" + (fresh ? "" : " warn");
      el.innerHTML = '<span class="dot"></span>' +
        '<span>实时核查：' + (s.open || 0) + "/" + (s.total || 0) + ' 个岗位在架</span>' +
        '<span class="sep"></span><span>最后核查 ' + esc(fmtDateTime(live.generated_at)) + "（" + esc(ago) + "）</span>" +
        (s.changes_today ? '<span class="sep"></span><span>' + s.changes_today + " 条变化</span>" : "") +
        (fresh ? "" : '<span class="sep"></span><span>建议今日重新核查</span>') +
        '<span class="sep"></span><a data-goto="live">查看更新追踪 →</a>';
    }
    $$("#freshness [data-goto]").forEach(function (a) {
      a.onclick = function () { switchView("live"); };
    });
  }

  function renderLive() {
    var live = liveOf();
    var stamp = $("#liveStamp");
    var statsEl = $("#liveStats");
    var changesEl = $("#liveChanges");
    var historyEl = $("#liveHistory");
    var bodyEl = $("#liveBody");
    var howto = $("#liveHowto");
    var badge = $("#tabCountLive");

    if (howto) {
      howto.innerHTML = "<h3>如何让它每天自动更新</h3><ol>" +
        "<li>在项目目录运行一次 <code>python tools/daily_check.py</code>，会生成 <code>data/updates.json</code> 并自动重建 <code>data/jobs.js</code>。</li>" +
        "<li>Windows 可在「任务计划程序」中新建每日任务，操作填 <code>python</code>，参数填 <code>tools\\daily_check.py</code>，起始位置填项目目录。</li>" +
        "<li>macOS / Linux 可用 <code>crontab -e</code> 加一行：<code>0 9 * * * cd /path/to/library &amp;&amp; python3 tools/daily_check.py</code>。</li>" +
        "<li>核查逻辑：字节跳动看官方接口的 <code>channel_online_status</code>，Grab 看 ATS 的 <code>active</code>，新加坡岗位看 MCF 的 <code>jobStatus</code> 与截止日，其余页面看 HTTP 状态、关闭关键词与页面截止日期。</li>" +
        "<li>状态从「在架」变为「已关闭」、或页面截止日期与库内不一致时，会出现在「最近变化」里。</li>" +
        "</ol>";
    }

    if (!live) {
      if (stamp) stamp.innerHTML = "<b>尚无核查记录</b>运行 tools/daily_check.py 后生成";
      if (statsEl) statsEl.innerHTML = "";
      if (changesEl) changesEl.innerHTML = '<div class="live-empty">运行一次每日核查后，这里会显示状态变化。</div>';
      if (historyEl) historyEl.innerHTML = '<div class="live-empty">暂无历史数据。</div>';
      if (bodyEl) bodyEl.innerHTML = "";
      if (badge) badge.style.display = "none";
      return;
    }

    var s = live.summary || {};
    if (stamp) {
      stamp.innerHTML = "<b>最后核查 " + esc(fmtDateTime(live.generated_at)) + "</b>" +
        "覆盖 " + (s.total || 0) + " 个岗位，历史 " + Object.keys(live.history || {}).length + " 天";
    }
    if (statsEl) {
      var cells = [
        { n: s.open || 0, l: "在架可投" },
        { n: s.closed || 0, l: "已关闭" },
        { n: s.unknown || 0, l: "待人工确认" },
        { n: s.changes_today || 0, l: "今日变化" },
        { n: Object.keys(live.history || {}).length, l: "已记录天数" }
      ];
      statsEl.innerHTML = cells.map(function (c) {
        return '<div class="live-stat"><div class="n">' + c.n + '</div><div class="l">' + c.l + "</div></div>";
      }).join("");
    }

    if (changesEl) {
      var cs = (live.changes || []).slice(0, 8);
      changesEl.innerHTML = cs.length ? cs.map(function (c) {
        var label = c.type === "deadline" ? "截止变更" : "状态变更";
        var cls = c.type === "deadline" ? "ty-deadline" : "ty-status";
        var from = c.from === "open" ? "在架" : c.from === "closed" ? "已关闭" : c.from;
        var to = c.to === "open" ? "在架" : c.to === "closed" ? "已关闭" : c.to;
        return '<div class="live-change"><span class="co">' + esc(c.company) + "</span>" +
          '<span class="tx"><b>' + esc(c.title) + "</b>：" + esc(from) + " → " + esc(to) + "</span>" +
          '<span class="ty ' + cls + '">' + label + "</span></div>";
      }).join("") : '<div class="live-empty">最近一次核查没有发现状态变化。</div>';
    }

    if (historyEl) {
      var hist = live.history || {};
      var dates = Object.keys(hist).sort().slice(-14);
      if (!dates.length) {
        historyEl.innerHTML = '<div class="live-empty">暂无历史数据。</div>';
      } else {
        historyEl.innerHTML = dates.map(function (d) {
          var rec = hist[d] || {};
          var total = Object.keys(rec).length;
          var open = Object.keys(rec).filter(function (k) { return rec[k] === "open"; }).length;
          var pct = total ? Math.round(open / total * 100) : 0;
          return '<div class="hist-row"><span class="d">' + esc(d.slice(5)) + '</span>' +
            '<span class="bar"><span class="fill" style="width:' + pct + '%"></span></span>' +
            '<span class="v">' + open + "/" + total + "</span></div>";
        }).join("");
      }
    }

    if (bodyEl) {
      var rows = JOBS.slice().sort(function (a, b) {
        var ra = (live.jobs || {})[a.id] || {}, rb = (live.jobs || {})[b.id] || {};
        var order = { closed: 0, unknown: 1, open: 2 };
        var oa = order[ra.status] === undefined ? 3 : order[ra.status];
        var ob = order[rb.status] === undefined ? 3 : order[rb.status];
        if (oa !== ob) return oa - ob;
        return (b.score_total || 0) - (a.score_total || 0);
      });
      bodyEl.innerHTML = rows.map(function (j) {
        var r = (live.jobs || {})[j.id] || {};
        var st = r.status || "unknown";
        var label = st === "open" ? "在架" : st === "closed" ? "已关闭" : "待确认";
        var dl = j.deadline ? daysUntil(j.deadline) : null;
        var dlText = j.deadline ? (dl !== null && dl >= 0 ? "剩 " + dl + " 天" : "已过期") : "滚动";
        var when = r.checked_at ? fmtDateTime(r.checked_at).slice(11) : "—";
        return '<tr><td><div class="co">' + esc(j.company) + "，" + esc(j.region_tier) + "</div>" +
          '<div class="ti">' + esc(j.title_en || j.title_cn) + "</div></td>" +
          "<td>" + esc(j.priority) + " 类</td>" +
          '<td><span class="live-status st-' + st + '">' + label + "</span></td>" +
          "<td>" + esc(when) + "</td>" +
          "<td>" + esc(dlText) + "</td>" +
          '<td><div class="live-note">' + esc(r.note || "—") + "</div></td></tr>";
      }).join("");
    }

    if (badge) {
      if ((s.changes_today || 0) > 0) { badge.textContent = s.changes_today; badge.style.display = ""; }
      else { badge.style.display = "none"; }
    }
  }

  function renderFatal() {
    $("#jobList").innerHTML = '<div class="empty"><p class="empty-title">数据加载失败</p><p>请确认 data/jobs.js 或 data/jobs.json 与 index.html 在同一目录结构中。</p></div>';
  }

  /* ---------------- site config ---------------- */
  function applySite() {
    if (!SITE || !Object.keys(SITE).length) return;
    if (SITE.title) {
      document.title = SITE.title;
      var h1 = $(".brand-text h1");
      if (h1) h1.textContent = SITE.title;
    }
    if (SITE.subtitle) {
      var p = $(".brand-text p");
      if (p) p.textContent = SITE.subtitle;
    }
    if (SITE.brand) {
      var img = $(".brand-mark");
      if (img && img.tagName === "IMG") img.src = SITE.brand;
    }
    if (Array.isArray(SITE.tracks) && SITE.tracks.length) {
      Object.keys(TRACK_LABELS).forEach(function (k) { delete TRACK_LABELS[k]; });
      Object.keys(TRACK_SHORT).forEach(function (k) { delete TRACK_SHORT[k]; });
      SITE.tracks.forEach(function (t) {
        TRACK_LABELS[t.key] = t.label;
        TRACK_SHORT[t.key] = t.short || t.label;
      });
      var td = FILTER_DEFS.filter(function (d) { return d.key === "track"; })[0];
      if (td) td.values = SITE.tracks.map(function (t) { return t.key; });
    }
  }

  function statValue(spec) {
    var t = spec.type;
    if (t === "official") return JOBS.filter(function (j) { return j.verification.status === "official"; }).length;
    if (t === "platform") return JOBS.filter(function (j) { return j.verification.status === "platform"; }).length;
    if (t === "total") return JOBS.length;
    if (t === "priority") return JOBS.filter(function (j) { return j.priority === spec.value; }).length;
    if (t === "region") return JOBS.filter(function (j) { return j.region_tier === spec.value; }).length;
    if (t === "track") return JOBS.filter(function (j) { return (j.tracks || []).indexOf(spec.value) !== -1; }).length;
    if (t === "mpa") return JOBS.filter(function (j) { return (j.mpa || 0) >= (spec.min || 3); }).length;
    if (t === "oii") return JOBS.filter(function (j) { return (j.oii || 0) >= (spec.min || 3); }).length;
    return 0;
  }

  /* ---------------- stats ---------------- */
  function renderStats() {
    var platform = JOBS.filter(function (j) { return j.verification.status === "platform"; }).length;
    var specs = (SITE.stats && SITE.stats.length) ? SITE.stats : [
      { type: "official", label: "已确认开放（官方）", sub: "另有 {platform} 个平台在架" },
      { type: "priority", value: "A", label: "A 类优先岗位", sub: "值得优先投递" },
      { type: "region", value: "北京", label: "北京岗位", sub: "总部或海外事业部" },
      { type: "region", value: "越南", label: "越南岗位", sub: "河内、胡志明市" },
      { type: "region", value: "新加坡", label: "新加坡岗位", sub: "区域总部与平台" },
      { type: "mpa", label: "MPA 相关", sub: "政策、地缘、咨询" },
      { type: "oii", label: "OII 相关", sub: "AI、平台、数字政策" }
    ];
    var items = specs.map(function (s) {
      var sub = (s.sub || "").replace("{platform}", platform).replace("{total}", JOBS.length);
      return { n: statValue(s), l: s.label, s: sub };
    });
    $("#stats").innerHTML = items.map(function (i) {
      return '<div class="stat"><div class="stat-num">' + i.n + '</div>' +
        '<div class="stat-label">' + esc(i.l) + '</div><div class="stat-sub">' + esc(i.s) + '</div></div>';
    }).join("");
    $("#verifiedChip").textContent = "最后核实 " + t(DATA.meta && DATA.meta.last_verified, "2026-11-11");
    $("#tabCountLibrary").textContent = JOBS.filter(function (j) { return j.verification.status === "official"; }).length;
    $("#tabCountPending").textContent = platform;
  }

  /* ---------------- filters ---------------- */
  var FILTER_DEFS = [
    { key: "region", label: "工作地点", values: REGION_ORDER },
    { key: "track", label: "职业路径", values: ["A", "B", "C", "D"], labels: TRACK_LABELS },
    { key: "priority", label: "优先级", values: ["A", "B", "C"], labels: { A: "A 高度推荐", B: "B 值得申请", C: "C 探索性" } },
    { key: "industry", label: "行业", values: [] },
    { key: "func", label: "职能", values: [] },
    { key: "duration", label: "实习时长", values: ["≤3个月", "3–4个月", "5–6个月", "6个月以上", "未说明"] },
    { key: "deadline", label: "申请截止", values: ["两周内截止", "一个月内截止", "已公布具体日期", "滚动/未公布"] },
    { key: "eligibility", label: "工作资格", values: ["可直接投递", "需核实", "存在硬性障碍"] },
    { key: "verification", label: "数据状态", values: ["官方确认", "平台在架"] }
  ];

  function durationBucket(j) {
    var m = j.duration_months;
    if (m === null || m === undefined) {
      var s = (j.duration || "") + "";
      var mm = s.match(/(\d+)\s*[-–~至]\s*(\d+)\s*个?月/);
      if (mm) m = Number(mm[2]);
      else { var m2 = s.match(/(\d+)\s*个?月/); if (m2) m = Number(m2[1]); }
      if (m === null || m === undefined) {
        if (/3\s*个?月/.test(s) && !/\d+\s*[-–]/.test(s)) m = 3;
      }
    }
    if (m === null || m === undefined) return "未说明";
    if (m <= 3) return "≤3个月";
    if (m <= 4) return "3–4个月";
    if (m <= 6) return "5–6个月";
    return "6个月以上";
  }

  function filterValues(key) {
    if (key === "region") return REGION_ORDER;
    if (key === "track") return Object.keys(TRACK_LABELS);
    if (key === "priority") return ["A", "B", "C"];
    if (key === "industry") return uniq(JOBS.map(function (j) { return j.industry; }).filter(Boolean)).sort();
    if (key === "func") return uniq(JOBS.map(function (j) { return j.function; }).filter(Boolean)).sort();
    var d = FILTER_DEFS.filter(function (f) { return f.key === key; })[0];
    return d ? d.values : [];
  }

  function countFor(key, val) {
    return JOBS.filter(function (j) {
      if (key === "region") return j.region_tier === val;
      if (key === "track") return has(j.tracks || [], val);
      if (key === "priority") return j.priority === val;
      if (key === "industry") return j.industry === val;
      if (key === "func") return j.function === val;
      if (key === "duration") return durationBucket(j) === val;
      if (key === "deadline") {
        var d = daysUntil(j.deadline);
        if (val === "滚动/未公布") return !j.deadline;
        if (val === "已公布具体日期") return !!j.deadline;
        if (val === "两周内截止") return d !== null && d >= 0 && d <= 14;
        if (val === "一个月内截止") return d !== null && d >= 0 && d <= 30;
      }
      if (key === "eligibility") return (j.eligibility && j.eligibility.status) === val;
      if (key === "verification") return val === "官方确认" ? j.verification.status === "official" : j.verification.status === "platform";
      return false;
    }).length;
  }

  function buildFilters() {
    var labels = {};
    FILTER_DEFS.forEach(function (d) { labels[d.key] = d.labels || {}; });
    var html = FILTER_DEFS.map(function (d) {
      var vals = filterValues(d.key);
      var opts = vals.map(function (v) {
        var c = countFor(d.key, v);
        var lab = (labels[d.key] && labels[d.key][v]) || v;
        return '<label class="filter-option' + (c === 0 ? " disabled" : "") + '">' +
          '<input type="checkbox" data-filter="' + d.key + '" value="' + esc(v) + '">' +
          '<span>' + esc(lab) + '</span><span class="cnt">' + c + '</span></label>';
      }).join("");
      return '<div class="filter-group"><div class="filter-title"><span>' + d.label + '</span></div>' + opts + '</div>';
    }).join("");

    html += '<div class="filter-group"><div class="filter-title"><span>收藏</span></div>' +
      '<label class="filter-option"><input type="checkbox" id="favOnlyFilter"><span>仅看已收藏</span>' +
      '<span class="cnt">' + Object.keys(store.favorites).filter(function (k) { return store.favorites[k]; }).length + '</span></label></div>';

    $("#filterGroups").innerHTML = html;
    $$('#filterGroups input[data-filter]').forEach(function (cb) {
      cb.addEventListener("change", function () {
        var k = cb.getAttribute("data-filter"), v = cb.value;
        var list = state.filters[k];
        if (cb.checked) { if (!has(list, v)) list.push(v); }
        else state.filters[k] = list.filter(function (x) { return x !== v; });
        render();
      });
    });
    var favCb = $("#favOnlyFilter");
    if (favCb) {
      favCb.checked = state.filters.favOnly;
      favCb.addEventListener("change", function () { state.filters.favOnly = favCb.checked; render(); });
    }
  }

  function activeFilterChips() {
    var out = [];
    Object.keys(state.filters).forEach(function (k) {
      if (k === "favOnly") return;
      state.filters[k].forEach(function (v) {
        var def = FILTER_DEFS.filter(function (d) { return d.key === k; })[0];
        var lab = (def && def.labels && def.labels[v]) || v;
        out.push({ k: k, v: v, label: (def ? def.label : k) + "：" + lab });
      });
    });
    if (state.filters.favOnly) out.push({ k: "favOnly", v: true, label: "仅看收藏" });
    return out;
  }

  /* ---------------- filtering & sorting ---------------- */
  function matches(j) {
    var f = state.filters;
    if (f.region.length && !has(f.region, j.region_tier)) return false;
    if (f.track.length && !(j.tracks || []).some(function (x) { return has(f.track, x); })) return false;
    if (f.priority.length && !has(f.priority, j.priority)) return false;
    if (f.industry.length && !has(f.industry, j.industry)) return false;
    if (f.func.length && !has(f.func, j.function)) return false;
    if (f.duration.length && !has(f.duration, durationBucket(j))) return false;
    if (f.eligibility.length && !has(f.eligibility, (j.eligibility && j.eligibility.status) || "需核实")) return false;
    if (f.verification.length) {
      var v = j.verification.status === "official" ? "官方确认" : "平台在架";
      if (!has(f.verification, v)) return false;
    }
    if (f.deadline.length) {
      var d = daysUntil(j.deadline), ok = false;
      f.deadline.forEach(function (val) {
        if (val === "滚动/未公布" && !j.deadline) ok = true;
        if (val === "已公布具体日期" && j.deadline) ok = true;
        if (val === "两周内截止" && d !== null && d >= 0 && d <= 14) ok = true;
        if (val === "一个月内截止" && d !== null && d >= 0 && d <= 30) ok = true;
      });
      if (!ok) return false;
    }
    if (f.favOnly && !store.favorites[j.id]) return false;
    if (state.q) {
      var q = state.q.toLowerCase().trim();
      if (q) {
        var hit = q.split(/\s+/).every(function (part) { return j._search.indexOf(part) !== -1; });
        if (!hit) return false;
      }
    }
    return true;
  }

  function sortList(list) {
    var s = state.sort;
    return list.slice().sort(function (a, b) {
      if (s === "deadline") {
        var da = a.deadline ? new Date(a.deadline).getTime() : 9e15;
        var db = b.deadline ? new Date(b.deadline).getTime() : 9e15;
        if (da !== db) return da - db;
        return (b.score_total || 0) - (a.score_total || 0);
      }
      if (s === "posted") {
        var pa = a.posted_date ? new Date(a.posted_date).getTime() : 0;
        var pb = b.posted_date ? new Date(b.posted_date).getTime() : 0;
        return pb - pa;
      }
      if (s === "company") return (a.company || "").localeCompare(b.company || "", "zh");
      return (b.score_total || 0) - (a.score_total || 0);
    });
  }

  function setPendingIncluded(on) {
    state.showPendingInline = !!on;
    $$("#scopeSeg button").forEach(function (b) {
      b.classList.toggle("active", (b.getAttribute("data-scope") === "all") === state.showPendingInline);
    });
    var link = $("#togglePendingInline");
    if (link) link.textContent = state.showPendingInline ? "仅显示官方确认岗位" : "显示平台在架岗位（" + state.pendingList.length + "）";
    render();
  }

  function render() {
    var all = JOBS.filter(matches);
    state.list = sortList(all.filter(function (j) { return j.verification.status === "official" || state.showPendingInline; }));
    state.pendingList = sortList(all.filter(function (j) { return j.verification.status === "platform"; }));

    $("#resultCount").textContent = "显示 " + state.list.length + " 个岗位" +
      (state.showPendingInline ? "（含平台在架）" : "（仅官方确认）");
    var chips = activeFilterChips();
    $("#activeFilters").innerHTML = chips.map(function (c) {
      return '<span class="chip-filter">' + esc(c.label) + '<button data-remove="' + c.k + '" data-val="' + esc(String(c.v)) + '">×</button></span>';
    }).join("");
    $$("#activeFilters button").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var k = b.getAttribute("data-remove"), v = b.getAttribute("data-val");
        if (k === "favOnly") { state.filters.favOnly = false; var fc = $("#favOnlyFilter"); if (fc) fc.checked = false; }
        else {
          state.filters[k] = state.filters[k].filter(function (x) { return x !== v; });
          var cb = $('input[data-filter="' + k + '"][value="' + v.replace(/"/g, '\\"') + '"]');
          if (cb) cb.checked = false;
        }
        render();
      });
    });

    var prevOfficial = state.list.length;
    $("#togglePendingInline").textContent = state.showPendingInline ? "仅显示官方确认岗位" : "显示平台在架岗位（" + state.pendingList.length + "）";
    var segO = $("#segOfficial"), segA = $("#segAll");
    if (segO) segO.textContent = JOBS.filter(function (j) { return j.verification.status === "official"; }).length;
    if (segA) segA.textContent = JOBS.length;
    $$("#scopeSeg button").forEach(function (b) {
      b.classList.toggle("active", (b.getAttribute("data-scope") === "all") === state.showPendingInline);
    });

    $("#jobList").innerHTML = state.list.map(cardHTML).join("");
    $("#emptyState").hidden = state.list.length !== 0;
    wireCards($("#jobList"));
    $("#tabCountTracker").textContent = Object.keys(store.records).filter(isTracked).length;
  }

  /* ---------------- card ---------------- */
  function priorityLabel(p) { return { A: "A 高度推荐", B: "B 值得申请", C: "C 探索性" }[p] || p; }

  function cardHTML(j) {
    var dl = fmtDeadline(j);
    var ver = j.verification.status === "official"
      ? '<span class="ver ver-official" title="公司官方招聘系统 / 官方页面已核实">官方确认</span>'
      : '<span class="ver ver-platform" title="第三方平台具体职位页在架，企业官方渠道未单独核实">平台在架</span>';
    var tracks = (j.tracks || []).map(function (tr) {
      return '<span class="tag track">' + esc(TRACK_SHORT[tr] || tr) + "</span>";
    }).join("");
    var tags = (j.tags || []).slice(0, 2).map(function (x) { return '<span class="tag">' + esc(x) + "</span>"; }).join("");
    var fav = store.favorites[j.id] ? " on" : "";
    var applied = store.records[j.id] && store.records[j.id].status !== "未查看";
    var statusTag = applied ? '<span class="tag" style="color:var(--moss)">' + esc(store.records[j.id].status) + "</span>" : "";

    return '<article class="job-card card-' + esc(j.priority) + (store.favorites[j.id] ? " is-fav" : "") + '" data-id="' + esc(j.id) + '" tabindex="0">' +
      '<div class="score-wrap"><div class="score-num">' + (j.score_total || "–") + '</div><div class="score-cap">/100 匹配</div></div>' +
      '<div class="job-main">' +
        '<div class="job-head"><span class="company">' + esc(j.company) + "</span>" +
          '<span class="pri pri-' + esc(j.priority) + '" title="' + esc(priorityLabel(j.priority)) + '">' + esc(j.priority) + "</span>" + ver + statusTag +
        "</div>" +
        '<h3 class="job-title">' + esc(j.title_en || j.title_cn) + "</h3>" +
        (j.title_cn && j.title_en ? '<div class="job-title-cn">' + esc(j.title_cn) + "</div>" : "") +
        '<div class="job-meta">' +
          '<span class="item">' + esc(j.city) + "，" + esc(j.country) + "</span><span class=\"dot\"></span>" +
          '<span class="item">' + esc(u(j.duration, "时长待确认")) + "</span><span class=\"dot\"></span>" +
          '<span class="item">' + esc(u(j.days_per_week, "每周天数待确认")) + "</span><span class=\"dot\"></span>" +
          '<span class="item">' + esc(j.industry) + "</span>" +
        "</div>" +
        '<div class="tags">' + tracks + tags + "</div>" +
      "</div>" +
      '<div class="job-side">' +
        '<div class="deadline ' + dl.cls + '"><b>' + esc(dl.text) + "</b>" + (dl.sub ? esc(dl.sub) : "") + "</div>" +
        '<div class="card-actions">' +
          '<button class="fav-btn' + fav + '" data-fav="' + esc(j.id) + '" title="收藏">' + (store.favorites[j.id] ? "★" : "☆") + "</button>" +
          '<button class="apply-btn" data-apply="' + esc(j.id) + '">申请</button>' +
        "</div>" +
      "</div>" +
    "</article>";
  }

  function wireCards(root) {
    $$(".job-card", root).forEach(function (card) {
      card.addEventListener("click", function (ev) {
        var favBtn = ev.target.closest("[data-fav]");
        var applyBtn = ev.target.closest("[data-apply]");
        if (favBtn) {
          ev.stopPropagation();
          toggleFav(favBtn.getAttribute("data-fav"));
          return;
        }
        if (applyBtn) {
          ev.stopPropagation();
          var id = applyBtn.getAttribute("data-apply");
          var job = JOBS.filter(function (x) { return x.id === id; })[0];
          if (job && job.apply && job.apply.url) window.open(job.apply.url, "_blank", "noopener");
          else toast("该岗位未提供直接申请链接，请查看详情页来源");
          return;
        }
        openDetail(card.getAttribute("data-id"));
      });
      card.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") openDetail(card.getAttribute("data-id"));
      });
    });
  }

  function toggleFav(id) {
    store.favorites[id] = !store.favorites[id];
    if (!store.favorites[id] && store.records[id] && store.records[id].status === "未查看") {
      // keep record, just un-favorite
    }
    saveStore();
    render();
    if (state.currentId === id) openDetail(id, true);
    toast(store.favorites[id] ? "已加入收藏" : "已取消收藏");
  }

  /* ---------------- drawer ---------------- */
  function jobById(id) { return JOBS.filter(function (j) { return j.id === id; })[0]; }

  function openDetail(id, keepScroll) {
    var j = jobById(id);
    if (!j) return;
    var body = $("#drawerBody");
    var prevScroll = keepScroll ? body.scrollTop : 0;
    state.currentId = id;
    body.innerHTML = detailHTML(j);
    $("#drawerOverlay").hidden = false;
    $("#drawer").hidden = false;
    document.body.style.overflow = "hidden";
    body.scrollTop = prevScroll;
    wireDetail(j);
  }
  function closeDetail() {
    $("#drawer").hidden = true;
    $("#drawerOverlay").hidden = true;
    document.body.style.overflow = "";
    state.currentId = null;
  }

  function navDetail(dir) {
    if (!state.list.length) return;
    var idx = state.list.map(function (j) { return j.id; }).indexOf(state.currentId);
    if (idx === -1) idx = 0;
    var next = (idx + dir + state.list.length) % state.list.length;
    openDetail(state.list[next].id);
  }

  function detailHTML(j) {
    var dl = fmtDeadline(j);
    var ver = j.verification.status === "official"
      ? '<span class="ver ver-official">官方确认（' + esc(j.verification.method || "") + "）</span>"
      : '<span class="ver ver-platform">平台在架（待官方复核）</span>';
    var tracks = (j.tracks || []).map(function (tr) { return '<span class="tag track">' + tr + " " + esc(TRACK_LABELS[tr] || "") + "</span>"; }).join("");
    var rec = recordOf(j.id);
    var fav = !!store.favorites[j.id];

    var resp = arr(j.jd && j.jd.responsibilities).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
    var reqs = arr(j.jd && j.jd.requirements).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
    var skills = arr(j.jd && j.jd.skills).map(function (x) { return '<span class="tag">' + esc(x) + "</span>"; }).join(" ");

    var blockers = arr(j.eligibility && j.eligibility.blockers);
    var eligClass = j.eligibility.status === "可直接投递" ? "green" : j.eligibility.status === "存在硬性障碍" ? "red" : "amber";

    var fit = j.fit || {};
    var fitExp = arr(fit.experience).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
    var gaps = arr(fit.gaps).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");

    var sc = j.scores || {};
    var scoreDefs = [
      ["direction", "职业方向匹配", 30], ["business", "实际业务参与", 25],
      ["sea", "东南亚/国际业务", 15], ["location", "地点与安排", 10],
      ["duration", "期限与时间", 10], ["background", "教育经历匹配", 10]
    ];
    var scoreHTML = scoreDefs.map(function (d) {
      var v = Number(sc[d[0]] || 0), pct = Math.round(v / d[2] * 100);
      return '<div class="score-line"><span class="lbl">' + d[1] + '</span><span class="bar"><i style="width:' + pct + '%"></i></span><span class="val">' + v + "/" + d[2] + "</span></div>";
    }).join("");

    var links = [];
    if (j.apply && j.apply.url) links.push({ k: "直接申请", u: j.apply.url });
    if (j.apply && j.apply.jd_url && j.apply.jd_url !== (j.apply.url || "")) links.push({ k: "官方JD", u: j.apply.jd_url });
    if (j.apply && j.apply.alt_url) links.push({ k: "第三方页", u: j.apply.alt_url });
    if (j.apply && j.apply.official_url) links.push({ k: "去官方核实", u: j.apply.official_url });
    var linksHTML = links.map(function (l) {
      return '<a class="apply-link" href="' + esc(l.u) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="k">' + l.k + '</span><span class="u">' + esc(l.u) + '</span><span class="ext">↗</span></a>';
    }).join("");

    return '<div class="d-head">' +
        '<div class="d-company">' + esc(j.company) + (j.company_en && j.company_en !== j.company ? "（" + esc(j.company_en) + "）" : "") + "</div>" +
        '<h2 class="d-title">' + esc(j.title_en || j.title_cn) + "</h2>" +
        (j.title_cn && j.title_en ? '<div class="d-title-cn">' + esc(j.title_cn) + "</div>" : "") +
        '<div class="d-badges"><span class="pri pri-' + esc(j.priority) + '">' + esc(j.priority) + " 类</span>" +
          ver + tracks + '<span class="tag">匹配分 ' + (j.score_total || "–") + "/100</span></div>" +
      "</div>" +

      '<div class="d-quick">' +
        '<div><div class="k">地点</div><div class="v">' + esc(j.city) + "，" + esc(j.country) + "</div></div>" +
        '<div><div class="k">实习时长</div><div class="v">' + esc(t(j.duration, "未说明")) + "</div></div>" +
        '<div><div class="k">每周出勤</div><div class="v">' + esc(t(j.days_per_week, "未说明")) + "</div></div>" +
        '<div><div class="k">截止日期</div><div class="v">' + esc(t(j.deadline, "滚动/未公布")) + "</div></div>" +
      "</div>" +

      // match experiences entry
      '<div class="match-cta-wrap">' +
        '<button class="match-cta" data-match="' + esc(j.id) + '">查看匹配经历 →</button>' +
        "<span>对照经历素材库，看哪几段能直接写进这个岗位的简历</span>" +
      "</div>" +

      // tracker
      '<div class="tracker-box">' +
        '<div class="row">' +
          '<div><label>申请状态</label><select id="trkStatus">' +
            STATUSES.map(function (s) { return '<option' + (rec.status === s ? " selected" : "") + ">" + s + "</option>"; }).join("") +
          "</select></div>" +
          '<div><label>优先级 / 来源</label><div style="font-size:12.5px;padding-top:5px;color:var(--ink-2)">' + esc(j.priority) + " 类，" + esc(j.region_tier) + "</div></div>" +
        "</div>" +
        '<div class="row">' +
          '<div><label>投递日期</label><input type="date" id="trkApply" value="' + esc(rec.applyDate || "") + '"></div>' +
          '<div><label>后续跟进日期</label><input type="date" id="trkFollow" value="' + esc(rec.followUp || "") + '"></div>' +
        "</div>" +
        '<div><label>个人备注</label><textarea id="trkNotes" placeholder="记录投递材料、联系人、面试进度、需要补的能力…">' + esc(rec.notes || "") + "</textarea></div>" +
        '<div class="actions" style="margin-top:10px">' +
          '<button class="btn small" id="trkSave">保存记录</button>' +
          '<button class="btn ghost small" id="trkFav">' + (fav ? "★ 已收藏" : "☆ 收藏岗位") + "</button>" +
          '<span class="saved-hint" id="savedHint">已保存</span>' +
        "</div>" +
      "</div>" +

      '<div class="d-section"><h3>岗位概览</h3><dl class="kv">' +
        "<dt>公司</dt><dd>" + esc(j.company) + "</dd>" +
        "<dt>部门 / 业务线</dt><dd>" + esc(t(j.dept)) + "</dd>" +
        "<dt>工作地点</dt><dd>" + esc(j.city) + "，" + esc(j.country) + "（" + esc(t(j.work_mode, "未说明")) + "）</dd>" +
        "<dt>行业</dt><dd>" + esc(t(j.industry)) + "</dd>" +
        "<dt>职能</dt><dd>" + esc(t(j.function)) + "</dd>" +
        "<dt>岗位类型</dt><dd>" + esc(t(j.job_type)) + "</dd>" +
        "<dt>发布时间</dt><dd>" + esc(t(j.posted_date, "未公布")) + "</dd>" +
        "<dt>申请截止</dt><dd>" + esc(dl.text) + (dl.sub ? "（" + esc(dl.sub) + "）" : "") + "</dd>" +
        "<dt>薪酬</dt><dd>" + esc(t(j.salary, "未公开")) + "</dd>" +
        "<dt>最后核实</dt><dd>" + esc(t(j.verification && j.verification.checked_at, "2026-11-11")) + "</dd>" +
      "</dl></div>" +

      '<div class="d-section"><h3>岗位职责（中文整理）</h3><ul>' + (resp || "<li>官方 JD 未提供可整理内容</li>") + "</ul></div>" +
      '<div class="d-section"><h3>任职资格</h3><ul>' + (reqs || "<li>官方 JD 未提供可整理内容</li>") + "</ul>" +
        (skills ? '<div class="tags" style="margin-top:8px">' + skills + "</div>" : "") + "</div>" +

      '<div class="d-section"><h3>学历、经验、语言与出勤</h3><dl class="kv">' +
        "<dt>学历要求</dt><dd>" + esc(t(j.jd && j.jd.education)) + "</dd>" +
        "<dt>专业要求</dt><dd>" + esc(t(j.eligibility && j.eligibility.major)) + "</dd>" +
        "<dt>经验要求</dt><dd>" + esc(t(j.jd && j.jd.experience)) + "</dd>" +
        "<dt>语言要求</dt><dd>" + esc(t(j.jd && j.jd.language)) + "</dd>" +
        "<dt>每周出勤</dt><dd>" + esc(t(j.jd && j.jd.attendance, t(j.days_per_week))) + "</dd>" +
        "<dt>实习时长</dt><dd>" + esc(t(j.jd && j.jd.duration_note, t(j.duration))) + "</dd>" +
        "<dt>预计入职</dt><dd>" + esc(t(j.start_window, "未说明")) + "</dd>" +
        "<dt>其他要求</dt><dd>" + esc(t(j.jd && j.jd.other, "无特别说明")) + "</dd>" +
      "</dl></div>" +

      '<div class="d-section"><h3>资格与风险</h3>' +
        '<div class="callout ' + eligClass + '"><b>工作资格判断：' + esc(t(j.eligibility && j.eligibility.status, "需核实")) + "</b><br>" +
        "本科在读：" + esc(t(j.eligibility && j.eligibility.undergrad)) +
        "；非商科专业：" + esc(t(j.eligibility && j.eligibility.non_business)) +
        "；中国大陆学籍：" + esc(t(j.eligibility && j.eligibility.mainland_student)) + "<br>" +
        "签证 / 工作许可：" + esc(t(j.eligibility && j.eligibility.visa)) +
        "；毕业年份限制：" + esc(t(j.eligibility && j.eligibility.grad_year)) +
        (blockers.length ? "<br><b>硬性门槛：</b>" + blockers.map(esc).join("；") : "") +
        "</div>" +
        (j.eligibility && j.eligibility.notes ? '<p style="margin-top:8px;font-size:12.5px;color:var(--muted)">' + esc(j.eligibility.notes) + "</p>" : "") +
      "</div>" +

      '<div class="d-section"><h3>与我的匹配分析</h3>' +
        '<p style="margin-bottom:8px">' + esc(t(fit.why, "暂无分析")) + "</p>" +
        (fitExp ? "<p style=\"font-weight:600;font-size:12.5px;margin-top:10px\">可用的相关经历</p><ul>" + fitExp + "</ul>" : "") +
        (gaps ? "<p style=\"font-weight:600;font-size:12.5px;margin-top:10px\">能力缺口</p><ul>" + gaps + "</ul>" : "") +
        (fit.competitiveness ? "<p style=\"margin-top:8px\"><b>竞争力判断：</b>" + esc(fit.competitiveness) + "</p>" : "") +
        (fit.career_path ? "<p style=\"margin-top:6px\"><b>对长期目标的价值：</b>" + esc(fit.career_path) + "</p>" : "") +
        '<div class="tags" style="margin-top:10px">' +
          '<span class="tag">MPA 相关度 ' + (j.mpa || 0) + "/5</span>" +
          '<span class="tag">OII 相关度 ' + (j.oii || 0) + "/5</span>" +
          '<span class="tag">东南亚相关度 ' + (j.sea_fit || 0) + "/5</span>" +
        "</div>" +
      "</div>" +

      '<div class="d-section"><h3>评分明细（' + (j.score_total || 0) + "/100）</h3><div class=\"score-grid\">" + scoreHTML + "</div></div>" +

      '<div class="d-section"><h3>申请信息</h3><div class="apply-links">' + (linksHTML || '<div class="callout">未提供直接申请链接</div>') + "</div>" +
        '<dl class="kv" style="margin-top:12px"><dt>所需材料</dt><dd>' + esc(t(j.apply && j.apply.materials)) + "</dd>" +
        (j.apply && j.apply.note ? "<dt>投递提示</dt><dd>" + esc(j.apply.note) + "</dd>" : "") +
        "</dl></div>" +

      '<div class="d-section"><h3>来源与核实</h3><div class="callout">' +
        "<b>核实状态：</b>" + (j.verification.status === "official" ? "官方渠道已确认开放" : "第三方平台在架，官方渠道未单独核实") + "<br>" +
        "<b>核实方式：</b>" + esc(t(j.verification.method)) + "　<b>核实时间：</b>" + esc(t(j.verification.checked_at)) + "<br>" +
        "<b>证据：</b>" + esc(t(j.verification.evidence)) +
        "</div></div>";
  }

  function wireDetail(j) {
    $("#drawerClose").onclick = closeDetail;
    $("#drawerOverlay").onclick = closeDetail;
    $("#prevJob").onclick = function () { navDetail(-1); };
    $("#nextJob").onclick = function () { navDetail(1); };

    var statusEl = $("#trkStatus");
    if (statusEl) statusEl.onchange = function () {
      var r = recordOf(j.id);
      r.status = statusEl.value;
      if (r.status === "已投递" && !r.applyDate) {
        r.applyDate = new Date().toISOString().slice(0, 10);
        var ap = $("#trkApply"); if (ap) ap.value = r.applyDate;
      }
      r.updatedAt = new Date().toISOString();
      saveStore(); render(); renderTracker(); flashSaved();
    };
    var saveBtn = $("#trkSave");
    if (saveBtn) saveBtn.onclick = function () {
      var r = recordOf(j.id);
      r.notes = ($("#trkNotes") || {}).value || "";
      r.applyDate = ($("#trkApply") || {}).value || "";
      r.followUp = ($("#trkFollow") || {}).value || "";
      r.status = ($("#trkStatus") || {}).value || "未查看";
      r.updatedAt = new Date().toISOString();
      saveStore(); render(); renderTracker(); flashSaved();
      toast("申请记录已保存");
    };
    var favBtn = $("#trkFav");
    if (favBtn) favBtn.onclick = function () { toggleFav(j.id); };
    var matchBtn = $("[data-match]");
    if (matchBtn) matchBtn.onclick = function () { openMatch(j.id); };
  }

  function flashSaved() {
    var el = $("#savedHint");
    if (!el) return;
    el.classList.add("show");
    setTimeout(function () { el.classList.remove("show"); }, 1500);
  }

  /* ---------------- tracker ---------------- */
  function renderTracker() {
    var ids = Object.keys(store.records).filter(isTracked);
    var tbody = $("#trackerBody");
    var counts = STATUSES.map(function (s) {
      return ids.filter(function (id) { return recordOf(id).status === s; }).length;
    });
    $("#trackerStats").innerHTML = STATUSES.map(function (s, i) {
      return '<div class="tracker-stat"><div class="n">' + counts[i] + '</div><div class="l">' + s + "</div></div>";
    }).join("") + '<div class="tracker-stat"><div class="n">' + ids.length + '</div><div class="l">合计跟踪</div></div>';

    if (!ids.length) {
      tbody.innerHTML = "";
      $("#trackerTable").style.display = "none";
      $("#trackerEmpty").hidden = false;
      $("#tabCountTracker").textContent = "0";
      return;
    }
    $("#trackerTable").style.display = "";
    $("#trackerEmpty").hidden = true;

    ids.sort(function (a, b) {
      var ja = jobById(a), jb = jobById(b);
      var ra = recordOf(a), rb = recordOf(b);
      var sa = STATUSES.indexOf(ra.status), sb = STATUSES.indexOf(rb.status);
      if (sa !== sb) return sa - sb;
      return ((jb && jb.score_total) || 0) - ((ja && ja.score_total) || 0);
    });

    tbody.innerHTML = ids.map(function (id) {
      var j = jobById(id); if (!j) return "";
      var r = recordOf(id);
      var due = r.followUp ? daysUntil(r.followUp) : null;
      var dueCls = due !== null && due < 0 ? "color:var(--clay)" : "";
      return "<tr data-id=\"" + esc(id) + "\">" +
        '<td><div class="co">' + esc(j.company) + '</div><div class="ti">' + esc(j.title_en || j.title_cn) + "</div>" +
          '<div style="font-size:11px;color:var(--muted-2);margin-top:2px">' + esc(j.city) + "，" + esc(j.priority) + " 类</div></td>" +
        '<td><span class="pri pri-' + esc(j.priority) + '">' + esc(j.priority) + "</span></td>" +
        "<td>" + (j.score_total || "-") + "</td>" +
        '<td><select data-trk-status="' + esc(id) + '">' +
          STATUSES.map(function (s) { return '<option' + (r.status === s ? " selected" : "") + ">" + s + "</option>"; }).join("") +
        "</select></td>" +
        '<td><input type="date" data-trk-apply="' + esc(id) + '" value="' + esc(r.applyDate || "") + '"></td>' +
        '<td><input type="date" data-trk-follow="' + esc(id) + '" value="' + esc(r.followUp || "") + '" style="' + dueCls + '"></td>' +
        '<td><div class="note">' + esc((r.notes || "").slice(0, 120)) + "</div></td>" +
        '<td><button class="btn ghost small" data-open="' + esc(id) + '">详情</button> ' +
          '<button class="btn ghost small" data-untrack="' + esc(id) + '">移除</button></td>' +
      "</tr>";
    }).join("");

    $$("[data-trk-status]", tbody).forEach(function (el) {
      el.onchange = function () {
        var id = el.getAttribute("data-trk-status");
        var r = recordOf(id); r.status = el.value;
        if (r.status === "已投递" && !r.applyDate) r.applyDate = new Date().toISOString().slice(0, 10);
        r.updatedAt = new Date().toISOString();
        saveStore(); renderTracker(); render(); toast("状态已更新");
      };
    });
    $$("[data-trk-apply]", tbody).forEach(function (el) {
      el.onchange = function () { var r = recordOf(el.getAttribute("data-trk-apply")); r.applyDate = el.value; saveStore(); };
    });
    $$("[data-trk-follow]", tbody).forEach(function (el) {
      el.onchange = function () { var r = recordOf(el.getAttribute("data-trk-follow")); r.followUp = el.value; saveStore(); toast("已设置跟进日期"); };
    });
    $$("[data-open]", tbody).forEach(function (el) {
      el.onclick = function () { openDetail(el.getAttribute("data-open")); };
    });
    $$("[data-untrack]", tbody).forEach(function (el) {
      el.onclick = function () {
        var id = el.getAttribute("data-untrack");
        delete store.records[id];
        store.favorites[id] = false;
        saveStore(); renderTracker(); render(); toast("已移除该记录");
      };
    });
    $("#tabCountTracker").textContent = ids.length;
  }

  /* ---------------- pending view ---------------- */
  function renderPending() {
    var list = JOBS.filter(function (j) { return j.verification.status === "platform"; });
    list = sortList(list);
    $("#pendingList").innerHTML = list.map(cardHTML).join("");
    $("#pendingEmpty").hidden = list.length !== 0;
    wireCards($("#pendingList"));
    $("#tabCountPending").textContent = list.length;
  }

  /* ---------------- experience library & matching ---------------- */
  var EXPERIENCE = [], PROFILE = {};

  function jobMatchText(j) {
    var parts = [j.title_en, j.title_cn, j.dept, j.industry, j.function,
      (j.tags || []).join(" "), (j.tracks || []).map(function (t) { return TRACK_LABELS[t] || ""; }).join(" "),
      (j.jd && j.jd.summary) || "", ((j.jd && j.jd.responsibilities) || []).join(" "),
      ((j.jd && j.jd.requirements) || []).join(" "), (j.fit && j.fit.why) || ""];
    return parts.join(" ").toLowerCase();
  }

  function matchFor(job) {
    var text = jobMatchText(job);
    var out = [];
    EXPERIENCE.forEach(function (e) {
      var hits = [], score = 0;
      (e.keywords || []).forEach(function (kw) {
        var k = (kw.k || "").toLowerCase();
        var hit = (k && text.indexOf(k) !== -1) ||
          (kw.syn || []).some(function (s) { return s && text.indexOf(String(s).toLowerCase()) !== -1; });
        if (hit) { hits.push(kw.k); score += kw.w || 2; }
      });
      var tb = (e.tracks || []).filter(function (t) { return (job.tracks || []).indexOf(t) !== -1; }).length;
      score += tb * 1.5;
      if (job.region_tier === "越南" && (e.regions || []).indexOf("越南") !== -1) score += 4;
      if (job.region_tier === "新加坡" && (e.regions || []).some(function (r) {
        return ["东南亚", "越南", "马来西亚", "老挝"].indexOf(r) !== -1;
      })) score += 2;
      if (hits.length) out.push({ exp: e, score: score, hits: hits.slice(0, 6) });
    });
    out.sort(function (a, b) { return b.score - a.score || (b.exp.strength || 0) - (a.exp.strength || 0); });
    var strong = out.filter(function (x) { return x.score >= 4; });
    return (strong.length >= 2 ? strong : out).slice(0, 4);
  }

  function expCardHTML(item, index) {
    var e = item.exp, hits = item.hits || [];
    return '<article class="exp-card">' +
      '<div class="exp-no">' + (index + 1 < 10 ? "0" : "") + (index + 1) + "</div>" +
      '<div class="exp-body">' +
        '<div class="exp-meta">' + esc(e.period) + " · " + esc(e.type) + "</div>" +
        "<h4>" + esc(e.title) + "</h4>" +
        '<div class="exp-org">' + esc(e.org) + " · " + esc(e.role) + "</div>" +
        '<p class="exp-sum">' + esc(e.summary) + "</p>" +
        (hits.length ? '<div class="exp-hits"><span class="k">命中</span>' +
          hits.map(function (h) { return '<span class="hit">' + esc(h) + "</span>"; }).join("") + "</div>" : "") +
        (e.resume_line ? '<div class="exp-resume"><b>可直接写进简历</b>' + esc(e.resume_line) + "</div>" : "") +
        (e.evidence && e.evidence.length ? '<ul class="exp-ev">' +
          e.evidence.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      "</div></article>";
  }

  function openMatch(id) {
    if (!jobById(id)) return;
    state.matchJobId = id;
    closeDetail();
    switchView("match");
    renderMatch(id);
    try {
      var u = "?view=match&job=" + encodeURIComponent(id);
      if (history && history.replaceState) history.replaceState(null, "", u);
    } catch (e) { /* file:// */ }
  }

  function renderMatch(id) {
    var j = jobById(id) || JOBS[0];
    if (!j) return;
    var matches = matchFor(j);
    var el = $("#matchContent");
    if (!el) return;

    var head = '<div class="match-top">' +
      '<button class="link-btn back" id="matchBack">← 返回岗位库</button>' +
      '<div class="match-job">' +
        '<div class="match-co">' + esc(j.company) + " · " + esc(j.city) + "</div>" +
        "<h2>" + esc(j.title_en || j.title_cn) + "</h2>" +
        (j.title_cn && j.title_en ? '<div class="match-cn">' + esc(j.title_cn) + "</div>" : "") +
        '<div class="match-meta">' + esc(j.priority) + " 类 · " + esc(t(j.deadline, "滚动招聘")) +
          " · " + esc(t(j.duration, "时长待确认")) + "</div>" +
      "</div>" +
      '<a class="btn" href="' + esc(j.apply.url) + '" target="_blank" rel="noopener noreferrer">打开申请页 ↗</a>' +
      "</div>";

    var cards = matches.map(expCardHTML).join("");
    if (!matches.length) {
      var fallback = EXPERIENCE.slice().sort(function (a, b) { return (b.strength || 0) - (a.strength || 0); }).slice(0, 3);
      cards = '<p class="match-empty">这个岗位没有明显的关键词命中，以下是最可迁移的三段通用经历。</p>' +
        fallback.map(function (e, i) { return expCardHTML({ exp: e, hits: [] }, i); }).join("");
    }

    var req = ((j.jd && j.jd.requirements) || []).slice(0, 4);
    var gaps = (j.fit && j.fit.gaps) || [];
    var side = '<aside class="match-side">' +
      '<div class="side-block"><h3>岗位在找什么</h3><ul>' +
        req.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" +
      '<div class="side-block"><h3>还缺什么</h3><ul>' +
        gaps.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" +
      '<div class="side-block"><h3>投递建议</h3><p>' + esc((j.apply && (j.apply.note || j.apply.materials)) || "—") + "</p></div>" +
      "</aside>";

    el.innerHTML = head +
      '<div class="match-grid"><div class="match-main">' +
        '<div class="match-title">匹配经历 <span>' + (matches.length ? matches.length + " 条" : "通用") + "</span></div>" +
        cards +
      "</div>" + side + "</div>";

    var back = $("#matchBack");
    if (back) back.onclick = function () { switchView("library"); };
  }
  function renderExperienceLibrary() {
    var el = $("#expList");
    if (!el) return;
    var q = (state.expQuery || "").toLowerCase().trim();
    var type = state.expFilter || "全部";
    var list = EXPERIENCE.filter(function (e) {
      if (type !== "全部" && e.type !== type) return false;
      if (!q) return true;
      var blob = [e.title, e.org, e.role, e.summary, (e.keywords || []).map(function (k) { return k.k; }).join(" "),
        (e.evidence || []).join(" ")].join(" ").toLowerCase();
      return blob.indexOf(q) !== -1;
    });
    $("#expProfile").innerHTML =
      '<div class="prof-name">' + esc(PROFILE.name || "") + "</div>" +
      '<div class="prof-line">' + esc(PROFILE.school || "") + " · " + esc(PROFILE.major || "") + " · " + esc(PROFILE.degree || "") + "</div>" +
      '<div class="prof-line">' + esc(PROFILE.rank || "") + " · " + esc(PROFILE.gpa || "") + " · " + esc((PROFILE.languages || []).join(" / ")) + "</div>" +
      '<p class="prof-sum">' + esc(PROFILE.summary || "") + "</p>";
    $("#expCount").textContent = list.length + " 条";

    if (!list.length) {
      el.innerHTML = '<div class="empty"><p class="empty-title">没有匹配的经历</p><p>换个关键词试试。</p></div>';
      return;
    }
    el.innerHTML = list.map(function (e) {
      var n = EXPERIENCE.indexOf(e) + 1;
      return '<article class="exp-lib-card" data-exp="' + esc(e.id) + '">' +
        '<div class="exp-lib-head"><span class="exp-index">' + (n < 10 ? "0" : "") + n + "</span>" +
        '<span class="exp-meta">' + esc(e.period) + " · " + esc(e.type) + "</span>" +
        '<span class="exp-strength">' + "●".repeat(e.strength || 1) + "○".repeat(Math.max(0, 5 - (e.strength || 1))) + "</span></div>" +
        "<h4>" + esc(e.title) + "</h4>" +
        '<div class="exp-org">' + esc(e.org) + " · " + esc(e.role) + "</div>" +
        '<p class="exp-sum">' + esc(e.summary) + "</p>" +
        '<div class="exp-kws">' + (e.keywords || []).map(function (k) { return '<span class="kw">' + esc(k.k) + "</span>"; }).join("") + "</div>" +
        '<div class="exp-detail" hidden><ul>' + (e.bullets || []).map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>" +
          (e.resume_line ? '<div class="exp-resume"><b>可直接写进简历</b>' + esc(e.resume_line) + "</div>" : "") + "</div>" +
        "</article>";
    }).join("");

    renderExpGraph(list);

    $$("#expList .exp-lib-card").forEach(function (card) {
      card.onclick = function () {
        var d = card.querySelector(".exp-detail");
        if (d) d.hidden = !d.hidden;
      };
    });
  }

  var EXP_COLORS = { "实习": "#FF79C6", "研究": "#BD93F9", "国际经历": "#8BE9FD", "教育": "#50FA7B" };

  function renderExpGraph(list) {
    var svg = $("#expGraph");
    var info = $("#expGraphInfo");
    if (!svg) return;
    if (!list.length) { svg.innerHTML = ""; if (info) info.textContent = "当前筛选下没有经历。"; return; }

    var W = 1000, H = 640, cx = 500, cy = 320;
    var exps = list.map(function (e, i) {
      return { e: e, n: EXPERIENCE.indexOf(e) + 1, ang: -Math.PI / 2 + i * 2 * Math.PI / list.length };
    });
    exps.forEach(function (x) { x.x = cx + 190 * Math.cos(x.ang); x.y = cy + 172 * Math.sin(x.ang); });

    var kmap = {};
    exps.forEach(function (x) {
      (x.e.themes || []).forEach(function (t) {
        if (!kmap[t]) kmap[t] = { k: t, exps: [] };
        kmap[t].exps.push(x);
      });
    });
    var kws = Object.keys(kmap).map(function (k) { return kmap[k]; })
      .sort(function (a, b) { return b.exps.length - a.exps.length; })
      .slice(0, 12);
    if (!kws.length) {
      svg.innerHTML = "";
      if (info) info.textContent = "这些经历还没有主题标签。给 data/experience.json 里的事件补上 themes，这里就会出现连接图。";
      var lg0 = $("#expLegend");
      if (lg0) lg0.innerHTML = "";
      return;
    }
    kws.forEach(function (k) {
      var sx = 0, sy = 0;
      k.exps.forEach(function (x) { sx += Math.cos(x.ang); sy += Math.sin(x.ang); });
      k.mean = Math.atan2(sy, sx);
    });
    kws.sort(function (a, b) { return a.mean - b.mean; });
    kws.forEach(function (k, i) {
      k.ang = -Math.PI / 2 + i * 2 * Math.PI / kws.length;
      k.x = cx + 330 * Math.cos(k.ang);
      k.y = cy + 288 * Math.sin(k.ang);
    });

    var edges = [];
    kws.forEach(function (k) {
      k.exps.forEach(function (x) {
        edges.push('<line class="edge" data-k="' + esc(k.k) + '" data-e="' + esc(x.e.id) + '" x1="' + x.x.toFixed(1) + '" y1="' + x.y.toFixed(1) + '" x2="' + k.x.toFixed(1) + '" y2="' + k.y.toFixed(1) + '"/>');
      });
    });

    var kwNodes = kws.map(function (k) {
      var right = Math.cos(k.ang) >= 0;
      var tx = k.x + (right ? 12 : -12);
      var r = Math.min(12, 4 + k.exps.length * 1.5);
      return '<g class="kw-node" data-k="' + esc(k.k) + '">' +
        '<circle cx="' + k.x.toFixed(1) + '" cy="' + k.y.toFixed(1) + '" r="' + r.toFixed(1) + '"/>' +
        '<text x="' + tx.toFixed(1) + '" y="' + (k.y + 4).toFixed(1) + '" text-anchor="' + (right ? "start" : "end") + '">' +
        esc(k.k) + "</text></g>";
    }).join("");

    var expNodes = exps.map(function (x) {
      return '<g class="exp-node" data-id="' + esc(x.e.id) + '" data-n="' + x.n + '" style="color:' + (EXP_COLORS[x.e.type] || "#9DA1B8") + '">' +
        '<circle cx="' + x.x.toFixed(1) + '" cy="' + x.y.toFixed(1) + '" r="15"/>' +
        '<text x="' + x.x.toFixed(1) + '" y="' + (x.y + 4).toFixed(1) + '" text-anchor="middle">' + x.n + "</text></g>";
    }).join("");

    svg.innerHTML =
      '<g class="g-edges">' + edges.join("") + "</g>" +
      '<g class="g-hub"><circle cx="' + cx + '" cy="' + cy + '" r="52"/>' +
        '<text class="hub-n" x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle">' + list.length + " 段</text>" +
        '<text class="hub-l" x="' + cx + '" y="' + (cy + 18) + '" text-anchor="middle">经历</text></g>' +
      '<g class="g-kws">' + kwNodes + "</g>" +
      '<g class="g-exps">' + expNodes + "</g>";

    var legend = $("#expLegend");
    if (legend) {
      legend.innerHTML = exps.map(function (x) {
        return "<span><b>" + (x.n < 10 ? "0" : "") + x.n + "</b>" + esc(x.e.title) + "</span>";
      }).join("");
    }

    function clearFocus() {
      $$("#expGraph .edge").forEach(function (l) { l.classList.remove("on", "dim"); });
      $$("#expGraph .kw-node").forEach(function (n) { n.classList.remove("on", "dim"); });
      $$("#expGraph .exp-node").forEach(function (n) { n.classList.remove("on", "dim"); });
      if (info) info.textContent = "悬停主题或编号，查看关联经历。";
    }

    function focusKw(key) {
      var expIds = {}, titles = [];
      $$("#expGraph .edge").forEach(function (l) {
        if (l.getAttribute("data-k") === key) {
          l.classList.add("on");
          var id = l.getAttribute("data-e");
          expIds[id] = 1;
        } else l.classList.add("dim");
      });
      $$("#expGraph .exp-node").forEach(function (n) {
        var on = expIds[n.getAttribute("data-id")];
        n.classList.toggle("on", !!on);
        n.classList.toggle("dim", !on);
        if (on) {
          var e = EXPERIENCE.filter(function (x) { return x.id === n.getAttribute("data-id"); })[0];
          if (e) titles.push((EXPERIENCE.indexOf(e) + 1) + " " + e.title);
        }
      });
      $$("#expGraph .kw-node").forEach(function (n) {
        var on = n.getAttribute("data-k") === key;
        n.classList.toggle("on", on);
        n.classList.toggle("dim", !on);
      });
      if (info) info.innerHTML = "<b>「" + esc(key) + "」</b> → " + titles.join("、");
    }

    function focusExp(id) {
      var kwsOn = {};
      $$("#expGraph .edge").forEach(function (l) {
        if (l.getAttribute("data-e") === id) {
          l.classList.add("on");
          kwsOn[l.getAttribute("data-k")] = 1;
        } else l.classList.add("dim");
      });
      $$("#expGraph .kw-node").forEach(function (n) {
        var on = kwsOn[n.getAttribute("data-k")];
        n.classList.toggle("on", !!on);
        n.classList.toggle("dim", !on);
      });
      $$("#expGraph .exp-node").forEach(function (n) {
        var on = n.getAttribute("data-id") === id;
        n.classList.toggle("on", on);
        n.classList.toggle("dim", !on);
      });
      var e = EXPERIENCE.filter(function (x) { return x.id === id; })[0];
      if (info && e) info.innerHTML = "<b>" + esc(e.title) + "</b> → " + Object.keys(kwsOn).join("、");
    }

    $$("#expGraph .kw-node").forEach(function (n) {
      n.addEventListener("mouseenter", function () { focusKw(n.getAttribute("data-k")); });
      n.addEventListener("mouseleave", clearFocus);
    });
    $$("#expGraph .exp-node").forEach(function (n) {
      n.addEventListener("mouseenter", function () { focusExp(n.getAttribute("data-id")); });
      n.addEventListener("mouseleave", clearFocus);
      n.addEventListener("click", function () {
        var id = n.getAttribute("data-id");
        var card = document.querySelector('.exp-lib-card[data-exp="' + id + '"]');
        if (card) {
          if (card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "center" });
          var d = card.querySelector(".exp-detail");
          if (d) d.hidden = false;
        }
      });
    });
  }

  /* ---------------- methodology ---------------- */
  function renderMethod() {
    var m = (DATA && DATA.meta) || {};
    var meth = m.methodology || {};
    var rules = m.eligibility_rules || [];
    var sources = meth.sources || [];
    var counts = {
      official: JOBS.filter(function (j) { return j.verification.status === "official"; }).length,
      platform: JOBS.filter(function (j) { return j.verification.status === "platform"; }).length
    };

    var html = "<h2>研究说明</h2>" +
      '<div class="meta-line">数据更新：' + esc(t(m.last_verified)) + "　　岗位总数：" + JOBS.length +
      "（官方确认 " + counts.official + " / 平台在架 " + counts.platform + "）</div>" +
      "<p>" + esc(t(m.description, "")) + "</p>";

    html += "<h3>一、检索范围与方法</h3><ul>" +
      arr(meth.methods).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";

    html += "<h3>二、三类数据状态的定义</h3><table><thead><tr><th>状态</th><th>含义</th><th>是否进入岗位库</th></tr></thead><tbody>" +
      "<tr><td><span class=\"ver ver-official\">官方确认</span></td><td>公司官方招聘系统或官方页面可打开该具体职位、显示在招；本库通过官方 ATS / 官方 API / 官网页面核实。</td><td>是（主库）</td></tr>" +
      "<tr><td><span class=\"ver ver-platform\">平台在架</span></td><td>实习僧 / 猎聘 / 高校就业网 / 聚合站的具体职位页仍在架、可进入投递，但企业官方招聘系统未单独核实。</td><td>是（单列“待核实”页签，卡片带橙色标记）</td></tr>" +
      "<tr><td><span class=\"ver ver-unverified\">已关闭 / 过期</span></td><td>截止日期已过、页面显示关闭、职位下线或只有公司招聘主页。</td><td>否，已排除</td></tr>" +
      "</tbody></table>";

    html += "<h3>三、评分机制（满分 100）</h3><table><thead><tr><th>维度</th><th>分值</th><th>评分要点</th></tr></thead><tbody>" +
      "<tr><td>职业方向匹配度</td><td>30</td><td>岗位内容是否直接服务于国际业务 / 战略 / 政策 / 数字科技方向，而非仅名称相似</td></tr>" +
      "<tr><td>实际业务参与程度</td><td>25</td><td>是否参与市场进入、商业拓展、产品商业化、客户开发、经营决策；资料收集与行政性工作得分低</td></tr>" +
      "<tr><td>东南亚及国际业务相关度</td><td>15</td><td>是否覆盖东南亚市场或跨境业务</td></tr>" +
      "<tr><td>地点与工作安排</td><td>10</td><td>北京 &gt; 越南 &gt; 新加坡 &gt; 其他东南亚 &gt; 中国其他城市</td></tr>" +
      "<tr><td>实习期限与时间匹配</td><td>10</td><td>能否覆盖 2026-12 至 2027-06、4–6 个月、每周 ≥4 天</td></tr>" +
      "<tr><td>个人教育及经历匹配</td><td>10</td><td>国际政治训练、政策简报、国会数据项目、越南研究能否直接迁移</td></tr>" +
      "</tbody></table>" +
      '<p class="muted" style="font-size:12px">A 类 ≥ 78 分且业务参与度高；B 类 62–77 分；C 类 &lt; 62 分或方向探索性较强。分数为研究判断，不是企业评分。</p>';

    html += "<h3>四、数据来源</h3><ul>" +
      sources.map(function (s) {
        return "<li><b>" + esc(s.name) + "</b>（" + esc(s.type) + "）：" +
          (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url) + "</a>" : esc(s.note || "")) + "</li>";
      }).join("") + "</ul>";

    html += "<h3>五、筛选标准与排除规则</h3><ul>" +
      arr(meth.criteria).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";

    html += "<h3>六、海外实习的工作资格与签证规则</h3>" +
      "<p>以下为公开发布的官方规则摘要，仅用于判断可行性，不构成法律意见；具体执行以使领馆、当地劳动部门与雇主 HR 的最新口径为准。</p>";
    rules.forEach(function (r) {
      var conf = r.confidence || "medium";
      html += '<div class="rule-card"><h4>' + esc(r.topic) +
        '<span class="country">' + esc(r.country) + "</span>" +
        '<span class="conf conf-' + esc(conf) + '">可信度 ' + esc(conf) + "</span></h4>" +
        "<p>" + esc(r.finding_cn) + "</p>" +
        (arr(r.details).length ? "<ul>" + arr(r.details).map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>" : "") +
        (r.caveat ? '<p class="muted" style="font-size:11.5px">注意：' + esc(r.caveat) + "</p>" : "") +
        '<div class="rule-src">来源：' + esc(t(r.source_name)) + "，" +
          (r.official_source_url ? '<a href="' + esc(r.official_source_url) + '" target="_blank" rel="noopener">' + esc(r.official_source_url) + "</a>" : "未提供链接") +
        "</div></div>";
    });

    html += "<h3>七、使用与更新</h3><ul>" +
      "<li>岗位数据在 <code>data/jobs.json</code>，展示逻辑在 <code>assets/app.js</code>，两者分离；修改 JSON 后运行 <code>python tools/build_data.py</code> 重新生成离线可用的 <code>data/jobs.js</code>。</li>" +
      "<li>每日核查：运行 <code>python tools/daily_check.py</code>，逐条确认岗位是否仍在架并记录变化，结果写入 <code>data/updates.json</code>，页面「更新追踪」页签读取该文件。建议用系统计划任务每天定时运行。</li>" +
      "<li>直接双击 <code>index.html</code> 即可使用；如通过本地服务器打开，页面会优先读取 <code>data/jobs.json</code>。</li>" +
      "<li>收藏、申请状态、备注、投递与跟进日期保存在浏览器 localStorage，换浏览器或清缓存会丢失，可用「导出」备份。</li>" +
      "<li>所有申请链接均为可点击外链，点击卡片上的「申请」会直接打开具体职位页。</li>" +
      "</ul>" +
      "<h3>八、局限</h3><ul>" +
      arr(meth.limitations).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";

    $("#methodContent").innerHTML = html;
  }

  /* ---------------- export ---------------- */
  function download(filename, text, mime) {
    var a = document.createElement("a");
    a.download = filename;
    var url = null;
    try {
      if (typeof Blob === "function" && typeof URL !== "undefined" && URL.createObjectURL) {
        url = URL.createObjectURL(new Blob([text], { type: mime || "text/plain;charset=utf-8" }));
      }
    } catch (e) { url = null; }
    a.href = url || ("data:" + (mime || "text/plain") + ";charset=utf-8," + encodeURIComponent(text));
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      if (url) URL.revokeObjectURL(url);
    }, 100);
  }
  function csvCell(v) {
    var s = (v === null || v === undefined) ? "" : String(v);
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function jobsCSV(list) {
    var head = ["公司", "英文岗位", "中文岗位", "地点", "国家", "区域", "行业", "职能", "优先级", "匹配分",
      "实习时长", "每周出勤", "发布日期", "截止日期", "数据状态", "工作资格", "申请链接", "官方JD"];
    var rows = list.map(function (j) {
      return [j.company, j.title_en, j.title_cn, j.city, j.country, j.region_tier, j.industry, j.function,
        j.priority, j.score_total, j.duration, j.days_per_week, j.posted_date, j.deadline,
        j.verification.status === "official" ? "官方确认" : "平台在架",
        (j.eligibility && j.eligibility.status) || "", j.apply && j.apply.url, j.apply && j.apply.jd_url];
    });
    return "\ufeff" + [head].concat(rows).map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
  }
  function trackerCSV() {
    var head = ["公司", "岗位", "地点", "优先级", "匹配分", "状态", "投递日期", "跟进日期", "备注", "申请链接"];
    var rows = Object.keys(store.records).filter(isTracked).map(function (id) {
      var j = jobById(id) || {}; var r = recordOf(id);
      return [j.company, j.title_en || j.title_cn, j.city, j.priority, j.score_total, r.status,
        r.applyDate, r.followUp, r.notes, j.apply && j.apply.url];
    });
    return "\ufeff" + [head].concat(rows).map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
  }
  function trackerJSON() {
    var out = Object.keys(store.records).filter(isTracked).map(function (id) {
      var j = jobById(id) || {}; var r = recordOf(id);
      return {
        id: id, company: j.company, title: j.title_en || j.title_cn, city: j.city,
        priority: j.priority, score: j.score_total, status: r.status,
        applyDate: r.applyDate, followUp: r.followUp, notes: r.notes,
        applyUrl: j.apply && j.apply.url
      };
    });
    return JSON.stringify({ exported_at: new Date().toISOString(), records: out }, null, 2);
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    $$("#tabs .tab").forEach(function (b) {
      b.onclick = function () { switchView(b.getAttribute("data-view")); };
    });

    var si = $("#searchInput");
    var timer = null;
    si.oninput = function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = si.value; render(); }, 160);
    };

    $("#sortSelect").onchange = function () { state.sort = this.value; render(); };

    $("#resetFilters").onclick = resetAll;
    $("#emptyReset").onclick = resetAll;
    $("#togglePendingInline").onclick = function () {
      var on = !state.showPendingInline;
      setPendingIncluded(on);
      toast(on ? "已并入平台在架岗位" : "已切回仅官方确认");
    };
    $$("#scopeSeg button").forEach(function (b) {
      b.onclick = function () { setPendingIncluded(b.getAttribute("data-scope") === "all"); };
    });

    var expSearch = $("#expSearch");
    if (expSearch) {
      var etimer = null;
      expSearch.oninput = function () {
        clearTimeout(etimer);
        etimer = setTimeout(function () { state.expQuery = expSearch.value; renderExperienceLibrary(); }, 150);
      };
    }
    $$("#expFilters button").forEach(function (b) {
      b.onclick = function () {
        state.expFilter = b.getAttribute("data-type");
        $$("#expFilters button").forEach(function (x) { x.classList.toggle("active", x === b); });
        renderExperienceLibrary();
      };
    });

    $("#openFilters").onclick = openSidebar;
    $("#filterBackdrop").onclick = closeSidebar;

    $("#exportBtn").onclick = function (e) {
      e.stopPropagation();
      $("#exportMenu").classList.toggle("open");
    };
    document.addEventListener("click", function () { $("#exportMenu").classList.remove("open"); });
    $$("#exportMenu button").forEach(function (b) {
      b.onclick = function () {
        var kind = b.getAttribute("data-export");
        if (kind === "json") download("internships.json", JSON.stringify(DATA, null, 2), "application/json");
        if (kind === "csv") download("internships.csv", jobsCSV(JOBS), "text/csv;charset=utf-8");
        if (kind === "tracker-json") download("my_applications.json", trackerJSON(), "application/json");
        if (kind === "tracker-csv") download("my_applications.csv", trackerCSV(), "text/csv;charset=utf-8");
        $("#exportMenu").classList.remove("open");
        toast("已导出");
      };
    });

    $("#trackerExport").onclick = function () { download("my_applications.csv", trackerCSV(), "text/csv;charset=utf-8"); toast("已导出申请进度"); };
    $("#clearTracker").onclick = function () {
      if (!confirm("确定清空所有收藏、状态、备注与日期？此操作不可撤销。")) return;
      store = { favorites: {}, records: {} };
      saveStore(); render(); renderTracker(); toast("已清空全部记录");
    };

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("#drawer").hidden) closeDetail();
      if (e.key === "/" && document.activeElement !== si) { e.preventDefault(); si.focus(); }
    });
  }

  function switchView(v) {
    $$("#tabs .tab").forEach(function (x) {
      x.classList.toggle("active", x.getAttribute("data-view") === v);
    });
    $$(".view").forEach(function (x) { x.classList.remove("active"); });
    var target = $("#view-" + v);
    if (target) target.classList.add("active");
    state.view = v;
    if (v === "tracker") renderTracker();
    if (v === "pending") renderPending();
    if (v === "live") renderLive();
    if (v === "experience") renderExperienceLibrary();
    if (v === "match") renderMatch(state.matchJobId);
    if (window.scrollTo) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyDeepLink() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    var q = params.get("q");
    if (q) { state.q = q; var si = $("#searchInput"); if (si) si.value = q; render(); }
    var v = params.get("view");
    var job = params.get("job");
    if (v === "match" && job && jobById(job)) {
      state.matchJobId = job;
      switchView("match");
      renderMatch(job);
      return;
    }
    if (v && $("#view-" + v)) switchView(v);
    if (job && jobById(job)) openDetail(job);
  }

  function resetAll() {
    state.q = "";
    $("#searchInput").value = "";
    Object.keys(state.filters).forEach(function (k) {
      state.filters[k] = (k === "favOnly") ? false : [];
    });
    $$('#filterGroups input[type="checkbox"]').forEach(function (cb) { cb.checked = false; });
    state.showPendingInline = false;
    render();
  }

  function openSidebar() {
    $("#sidebar").classList.add("open");
    $("#filterBackdrop").hidden = false;
  }
  function closeSidebar() {
    $("#sidebar").classList.remove("open");
    $("#filterBackdrop").hidden = true;
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
