# -*- coding: utf-8 -*-
"""
build-cc-ops.py  —  Pharma Triage  ·  Call-Center OPERATIONS analytics builder.

This is SEPARATE from build-analytics.py (which handles the agent performance
reports). This script reads the monthly call-center *operations* workbook —
incoming vs abandoned calls per shift, hourly load, staffing coverage, and the
staff-leave schedule — and produces an ADVANCED analytics dashboard.

Source workbook (one per month), e.g. "JUNE 2026 C.C.xlsx", sheets:
    المهجورة والوارد كل شيفت   — per-day × 4 shifts: abandoned / incoming / CS-abandoned / rate
    الوارد كل ساعة             — per-day × 24 hours: incoming volume (heat-map)
    المواعيد / المواعيد شيفتات  — staffing coverage grid (1 = present that hour)
    الاجازات الشهرية           — daily leave log (free text: name + leave type)
    الاجازات الاسبوعية          — weekly leave grid per shift

It flattens everything into JSON and EMBEDS it into `cc-ops.html`
(between the // CCOPS_DATA_START / // CCOPS_DATA_END markers) so the dashboard
works fully offline with no server. Also writes `cc-ops-data.json`.

Re-run whenever you drop in a fresh month:
    1. Put the .xlsx next to this script.
    2. Add/uncomment its entry in MONTHLY_FILES below.
    3. python build-cc-ops.py

Requires: openpyxl   (pip install openpyxl)

NOTE on the parsers: the source is hand-maintained and messy (merged cells,
future-empty days, #DIV/0!, free-text leaves). Every parser is defensive — a
sheet that is missing / renamed / empty degrades to an empty section in the
dashboard instead of crashing. So you can build a month even before all sheets
are filled.
"""
import os, re, json, statistics, datetime as dt
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_JSON  = os.path.join(HERE, "cc-ops-data.json")
HTML_FILE = os.path.join(HERE, "cc-ops.html")

# ── .env loader (zero-dependency) ────────────────────────────────────────────
# Loads FB_ADMIN_EMAIL / FB_ADMIN_PASS (and any other KEY=VALUE) from a local
# env file next to this script so the Firestore push works without exporting
# vars in the shell. Existing real environment variables are NOT overridden.
# NEVER commit the env file — it holds the admin password (see .gitignore).
ENV_FILES = ["cc ops.env", ".env"]
# Search next to the script AND one level up (project root). The secret lives
# OUTSIDE public/ so it is never deployed — see firebase.json ignore "**/*.env".
ENV_DIRS = [HERE, os.path.dirname(HERE)]

def load_env():
    for d in ENV_DIRS:
        for fname in ENV_FILES:
            path = os.path.join(d, fname)
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8-sig") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
            print(f"  loaded env from {fname}")
            return

# ── Monthly file registry ────────────────────────────────────────────────────
# key = Arabic month label shown in the dashboard selector.  Newest month last.
# may.xlsx is intentionally left commented until it is re-exported in the same
# multi-sheet shape as the June workbook (its current shape is a single sheet).
MONTHLY_FILES = {
    "مايو ٢٠٢٦":  "i:/JULYYYYY  2026 C.C.xlsx",
    # "يونيو ٢٠٢٦": "JUNE 2026 C.C.xlsx",
}

# ── Shift model ──────────────────────────────────────────────────────────────
SHIFT_DEFS = [
    {"key": "morning",   "ar": "صباحي · ٧ص–١م",  "match": ("7am",  "1pm")},
    {"key": "afternoon", "ar": "ظهري · ١م–٥م",   "match": ("1pm",  "5pm")},
    {"key": "evening",   "ar": "مسائي · ٥م–١٢ص", "match": ("5pm",  "12am")},
    {"key": "night",     "ar": "ليلي · ١٢ص–٧ص",  "match": ("12am", "7am")},
]
ANOMALY_RATE = 0.15  # a shift abandonment rate above this is flagged

# Leave-type classification (checked in order — most specific first).
LEAVE_TYPES = [
    ("compensation", "تعويض / إضافي", ("نزول", "اضاف", "إضاف", "ساعة اضاف", "ساعه")),
    ("unpaid",       "بدون مرتب",      ("بدون مرتب",)),
    ("exam",         "امتحان",         ("امتحان",)),
    ("status",       "تغيير حالة",     ("تغيير حالة", "تغيير الحالة")),
    ("permission",   "استئذان",        ("استئذان", "هيستأذن", "هيستاذن", "استاذن")),
    ("casual",       "عارضة",          ("عارض",)),
    ("annual",       "اعتيادي",        ("اعتيادي", "اعتيادى")),
    ("swap",         "بدل",            ("بدل",)),
]
# tokens that mark where the employee NAME ends and the leave description begins
_NAME_STOP = ("اجازة", "اجازه", "إجازة", "امتحان", "استئذان", "تغيير", "نزول",
              "ساعة", "ساعه", "ساعات", "بدل", "تعويض", "بدون", "عارض",
              "هيستأذن", "هيستاذن", "استاذن", "اغيير", "ساعه")


# ── helpers ──────────────────────────────────────────────────────────────────
def iso(v):
    """Best-effort date → 'YYYY-MM-DD'. Accepts datetime or dd-mm-yyyy /
    yyyy-mm-dd strings. Returns None if it can't tell."""
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    s = str(v or "").strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return None


def numf(v):
    """Cell → float, or None for blanks / errors (#DIV/0! etc)."""
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s or s.startswith("#"):
        return None
    try:
        return float(s.replace("%", "").replace(",", ""))
    except ValueError:
        return None


def find_sheet(wb, *needles):
    """Sheet whose title contains ANY needle (case/space-insensitive)."""
    def norm(s): return re.sub(r"\s+", "", str(s)).lower()
    for ws in wb.worksheets:
        t = norm(ws.title)
        if any(norm(n) in t for n in needles):
            return ws
    return None


def rows_of(ws, max_row=400):
    """Materialise a sheet as a list-of-lists (1-based padded), capped."""
    out = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        out.append(list(row))
        if i + 1 >= max_row:
            break
    return out


def shift_for_label(lbl):
    s = re.sub(r"\s+", "", str(lbl)).lower()
    for sd in SHIFT_DEFS:
        a, b = sd["match"]
        if a in s and b in s:
            return sd
    return None


def modal_month(isos):
    """(year, month) that appears most among a list of ISO dates — used to drop
    stray TOTAL rows / next-month planning rows that share the sheet."""
    counts = {}
    for d in isos:
        if not d:
            continue
        ym = d[:7]
        counts[ym] = counts.get(ym, 0) + 1
    if not counts:
        return None
    return max(counts, key=counts.get)  # 'YYYY-MM'


# ── 1) SHIFT ABANDONMENT  (the core sheet) ───────────────────────────────────
def parse_shift_abandon(wb):
    """Per-day, per-shift incoming / abandoned / rate.

    Works on the named Arabic sheet OR a generic 'Sheet2' with the same header
    pattern (the old may.xlsx). Returns dict or None.
    """
    ws = find_sheet(wb, "المهجورة والوارد", "المهجوره والوارد", "وارد كل شيفت",
                    "المهجورة كل شيفت", "المهجوره كل شيفت")
    grid = None
    if ws:
        grid = rows_of(ws)
    else:
        # fall back: any sheet whose first rows carry shift labels like '7AM'
        for cand in wb.worksheets:
            g = rows_of(cand, 8)
            if any(re.search(r"\d+\s*(am|pm)", str(c or ""), re.I)
                   for r in g for c in r):
                ws, grid = cand, rows_of(cand)
                break
    if not grid:
        return None

    # locate the shift-label row, then map shift → start column
    grp_i = None
    for i, r in enumerate(grid[:8]):
        if any(re.search(r"\d+\s*(am|pm)", str(c or ""), re.I) for c in r):
            grp_i = i
            break
    if grp_i is None:
        return None

    shift_cols = []  # [(shift_def, start_col_index0)]
    for ci, c in enumerate(grid[grp_i]):
        sd = shift_for_label(c) if c else None
        if sd:
            shift_cols.append((sd, ci))
    if not shift_cols:
        return None

    data_start = grp_i + 2  # group row, sub-header row, then data
    daily = []
    for r in grid[data_start:]:
        if not r:
            continue
        d = iso(r[0]) if r else None
        if not d:
            continue
        shifts, t_ab, t_inc, t_cs = [], 0, 0, 0
        any_data = False
        for sd, ci in shift_cols:
            ab  = numf(r[ci])   if ci   < len(r) else None
            inc = numf(r[ci+1]) if ci+1 < len(r) else None
            cs  = numf(r[ci+2]) if ci+2 < len(r) else None
            if inc and inc > 0:
                any_data = True
                rate = (ab or 0) / inc
                shifts.append({"key": sd["key"], "ar": sd["ar"],
                               "ab": int(ab or 0), "inc": int(inc),
                               "cs": int(cs or 0), "rate": round(rate, 4)})
                t_ab += int(ab or 0); t_inc += int(inc); t_cs += int(cs or 0)
            else:
                shifts.append({"key": sd["key"], "ar": sd["ar"],
                               "ab": 0, "inc": 0, "cs": 0, "rate": None})
        if not any_data:
            continue
        daily.append({
            "date": d, "shifts": shifts,
            "ab": t_ab, "inc": t_inc, "cs": t_cs,
            "rate": round(t_ab / t_inc, 4) if t_inc else None,
        })

    if not daily:
        return None

    # drop stray TOTAL / next-month rows: keep only the dominant calendar month
    ym = modal_month([d["date"] for d in daily])
    if ym:
        daily = [d for d in daily if d["date"][:7] == ym]
    if not daily:
        return None
    daily.sort(key=lambda d: d["date"])

    # per-shift roll-up + anomalies + month totals
    per_shift = {sd["key"]: {"key": sd["key"], "ar": sd["ar"],
                             "ab": 0, "inc": 0, "cs": 0, "days": 0}
                 for sd in SHIFT_DEFS}
    anomalies = []
    for day in daily:
        for s in day["shifts"]:
            ps = per_shift.get(s["key"])
            if ps and s["inc"] > 0:
                ps["ab"] += s["ab"]; ps["inc"] += s["inc"]
                ps["cs"] += s["cs"]; ps["days"] += 1
            if s["rate"] is not None and s["rate"] >= ANOMALY_RATE:
                anomalies.append({"date": day["date"], "shift": s["ar"],
                                  "rate": s["rate"], "ab": s["ab"], "inc": s["inc"]})
    for ps in per_shift.values():
        ps["rate"] = round(ps["ab"] / ps["inc"], 4) if ps["inc"] else None

    tot_ab  = sum(d["ab"] for d in daily)
    tot_inc = sum(d["inc"] for d in daily)
    tot_cs  = sum(d["cs"] for d in daily)
    anomalies.sort(key=lambda a: a["rate"], reverse=True)

    return {
        "daily": daily,
        "per_shift": [per_shift[sd["key"]] for sd in SHIFT_DEFS],
        "totals": {"ab": tot_ab, "inc": tot_inc, "cs": tot_cs,
                   "rate": round(tot_ab / tot_inc, 4) if tot_inc else None,
                   "answer_rate": round(1 - tot_ab / tot_inc, 4) if tot_inc else None,
                   "days": len(daily)},
        "anomalies": anomalies[:12],
        "period": f"{daily[0]['date']} → {daily[-1]['date']}",
        "ym": ym,
    }


# ── 2) HOURLY INCOMING  (heat-map) ───────────────────────────────────────────
def parse_hourly(wb, ym=None):
    ws = find_sheet(wb, "الوارد كل ساعة", "وارد كل ساعة")
    if not ws:
        return None
    grid = rows_of(ws)
    if not grid:
        return None
    hdr = grid[0]
    hour_cols = []  # [(hour_int, col_index)]
    for ci, c in enumerate(hdr[1:], start=1):
        if c is None:
            continue
        hh = None
        if isinstance(c, dt.time):
            hh = c.hour
        else:
            m = re.match(r"^(\d{1,2})", str(c).strip())
            if m:
                hh = int(m.group(1)) % 24
        if hh is not None:
            hour_cols.append((hh, ci))
    if not hour_cols:
        return None

    by_hour = {h: 0 for h in range(24)}
    daily = []
    any_data = False
    for r in grid[1:]:
        d = iso(r[0]) if r else None
        if not d:
            continue
        if ym and d[:7] != ym:
            continue
        row_hours = {}
        for hh, ci in hour_cols:
            v = numf(r[ci]) if ci < len(r) else None
            if v:
                by_hour[hh] += int(v); row_hours[hh] = int(v); any_data = True
        if row_hours:
            daily.append({"date": d, "hours": row_hours})
    if not any_data:
        return None
    return {"by_hour": [by_hour[h] for h in range(24)], "daily": daily}


# ── 3) COVERAGE  (staffing grid — sum of 1s per hour column) ──────────────────
def parse_coverage(wb):
    ws = find_sheet(wb, "المواعيد شيفتات", "المواعيد شيفتات")
    if not ws:
        ws = find_sheet(wb, "المواعيد")
    if not ws:
        return None
    grid = rows_of(ws, 1000)
    if not grid:
        return None
    hdr = grid[0]
    cols = []  # [(label, col_index)]
    for ci, c in enumerate(hdr):
        if c is None or str(c).strip() == "":
            continue
        cols.append((str(c).strip(), ci))
    if not cols:
        return None
    counts = []
    for label, ci in cols:
        total = 0
        for r in grid[1:]:
            v = r[ci] if ci < len(r) else None
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v:
                total += int(v)
        counts.append({"label": label, "count": total})
    if not any(c["count"] for c in counts):
        return None
    return {"by_slot": counts}


# ── 4) MONTHLY LEAVES  (free-text log) ───────────────────────────────────────
def classify_leave(text):
    s = str(text)
    for key, ar, needles in LEAVE_TYPES:
        if any(n in s for n in needles):
            return key, ar
    return "other", "أخرى"


def employee_name(text):
    toks = str(text).split()
    name = []
    for t in toks:
        if any(t.startswith(m) or m in t for m in _NAME_STOP):
            break
        name.append(t)
    nm = " ".join(name).strip()
    return nm or "—"


def parse_monthly_leaves(wb, ym=None):
    ws = find_sheet(wb, "الاجازات الشهرية", "الاجازات الشهريه")
    if not ws:
        return None
    grid = rows_of(ws, 1000)
    if not grid:
        return None

    # find date columns: a cell that parses as a date marks the start of a day
    # block; entries for that day are the non-empty text cells beneath it (in
    # the same column) until the next date row.
    daily = {}          # iso -> list of entries
    type_tot = {}
    emp = {}            # name -> {count, types{}}
    open_cols = {}      # col_index -> current iso date

    for r in grid:
        # 1. does this row open new day-blocks?
        opened_here = {}
        for ci, c in enumerate(r):
            d = iso(c) if isinstance(c, (dt.datetime, dt.date)) else None
            if not d and isinstance(c, str) and re.match(r"^\d{4}-\d", c.strip()):
                d = iso(c)
            if d:
                opened_here[ci] = d
        if opened_here:
            # close previous blocks that share a column, open the new ones.
            # A column that opens a date outside the target month is closed so
            # its (next-month planning) entries are ignored.
            for ci, d in opened_here.items():
                if ym and d[:7] != ym:
                    open_cols.pop(ci, None)
                    continue
                open_cols[ci] = d
                daily.setdefault(d, [])
            continue
        # 2. otherwise collect entries under each open column
        for ci, d in list(open_cols.items()):
            c = r[ci] if ci < len(r) else None
            if c is None:
                continue
            txt = str(c).strip()
            if not txt or txt in ("الاجازات", "التعويض"):
                continue
            if len(txt) < 3:
                continue
            key, ar = classify_leave(txt)
            name = employee_name(txt)
            daily[d].append({"name": name, "type": key, "type_ar": ar, "raw": txt})
            type_tot[ar] = type_tot.get(ar, 0) + 1
            e = emp.setdefault(name, {"count": 0, "types": {}})
            e["count"] += 1
            e["types"][ar] = e["types"].get(ar, 0) + 1

    if not any(daily.values()):
        return None

    daily_list = [{"date": d, "count": len(v),
                   "by_type": _count_types(v)}
                  for d, v in sorted(daily.items()) if v]
    top_emp = sorted(
        ({"name": n, "count": e["count"], "types": e["types"]}
         for n, e in emp.items() if n != "—"),
        key=lambda x: x["count"], reverse=True)[:15]
    type_list = sorted(({"ar": k, "count": v} for k, v in type_tot.items()),
                       key=lambda x: x["count"], reverse=True)
    return {"daily": daily_list, "by_type": type_list,
            "top_employees": top_emp,
            "total": sum(len(v) for v in daily.values())}


def _count_types(entries):
    out = {}
    for e in entries:
        out[e["type_ar"]] = out.get(e["type_ar"], 0) + 1
    return out


# ── BRANCH CALLS  (مكالمات الفروع) — premium analytics ───────────────────────
# Reads the per-branch / per-department incoming-vs-answered snapshot and derives
# the analytics the cc-ops dashboard renders: Pareto, performance quadrant, loss
# analysis, Bayesian-smoothed scorecards, and a branch/department split.
BR_BAYES_C = 150  # prior strength (in calls) pulling small queues toward the mean

def _bint(v):
    f = numf(v)
    return None if f is None else int(round(f))

def parse_branches(wb):
    ws = find_sheet(wb, "مكالمات الفروع", "مكالمه الفروع", "مكالمة الفروع", "الفروع")
    if not ws:
        return None
    grid = rows_of(ws, 200)
    if len(grid) < 2:
        return None
    items = []
    for r in grid[1:]:
        r = (list(r) + [None] * 7)[:7]
        name, q, inc, ans, miss, _rate, typ = r
        name = str(name).strip() if name is not None else ""
        if not name or name == "الإجمالي":
            continue
        inc, ans, miss = _bint(inc), _bint(ans), _bint(miss)
        if inc is None:
            continue
        ans = ans or 0
        miss = miss if miss is not None else max(inc - ans, 0)
        typ = "dept" if str(typ or "").strip() == "قسم" else "branch"
        rate = (ans / inc) if inc else 0.0
        items.append({"name": name, "q": str(q or "").strip(), "inc": inc,
                      "ans": ans, "miss": miss, "rate": round(rate, 4), "typ": typ})
    active = [d for d in items if d["inc"] > 0]
    if not active:
        return None
    active.sort(key=lambda x: -x["inc"])

    TI = sum(d["inc"] for d in active)
    TA = sum(d["ans"] for d in active)
    TM = sum(d["miss"] for d in active)
    avg = TA / TI if TI else 0
    br = [d for d in active if d["typ"] == "branch"]
    dp = [d for d in active if d["typ"] == "dept"]

    pareto, c = [], 0
    for d in active:
        c += d["inc"]
        pareto.append({"name": d["name"], "inc": d["inc"],
                       "cum_pct": round(c / TI, 4) if TI else 0, "typ": d["typ"]})
    pareto_80 = next((i + 1 for i, p in enumerate(pareto) if p["cum_pct"] >= 0.8), len(pareto))

    loss, c = [], 0
    for d in sorted(active, key=lambda x: -x["miss"]):
        if d["miss"] <= 0:
            continue
        c += d["miss"]
        loss.append({"name": d["name"], "miss": d["miss"], "typ": d["typ"], "rate": d["rate"],
                     "pct": round(d["miss"] / TM, 4) if TM else 0,
                     "cum_pct": round(c / TM, 4) if TM else 0})
    loss_2_pct = round(sum(x["miss"] for x in loss[:2]) / TM, 4) if (TM and loss) else 0

    med_inc = statistics.median([d["inc"] for d in active])
    def zone(d):
        hv, hr = d["inc"] >= med_inc, d["rate"] >= avg
        return ("star" if hv and hr else "crit" if hv else "stable" if hr else "watch")
    quad = {"avg_rate": round(avg, 4), "med_inc": med_inc,
            "points": [{"name": d["name"], "inc": d["inc"], "rate": d["rate"],
                        "miss": d["miss"], "typ": d["typ"], "zone": zone(d)} for d in active]}

    cards = []
    for d in active:
        health = (d["ans"] + BR_BAYES_C * avg) / (d["inc"] + BR_BAYES_C)
        band = ("excellent" if d["rate"] >= 0.99 else "good" if d["rate"] >= avg
                else "warn" if d["rate"] >= 0.95 else "bad")
        cards.append({**d, "health": round(health, 4), "band": band})
    cards.sort(key=lambda x: -x["health"])
    for i, c2 in enumerate(cards):
        c2["rank"] = i + 1

    worst = min(active, key=lambda x: x["rate"])
    headline = (f"أعلى {pareto_80} طوابير بتمثّل {round(pareto[pareto_80 - 1]['cum_pct'] * 100)}% من الوارد، "
                f"و«{worst['name']}» هو الأضعف ردًّا ({round(worst['rate'] * 100, 1)}%). "
                f"طابورين بس مسؤولين عن {round(loss_2_pct * 100)}% من المكالمات المفقودة.")

    return {
        "generated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "totals": {"inc": TI, "ans": TA, "miss": TM, "rate": round(avg, 4),
                   "queues": len(active), "branches": len(br), "depts": len(dp),
                   "branch_inc": sum(d["inc"] for d in br), "dept_inc": sum(d["inc"] for d in dp),
                   "pareto_80": pareto_80, "loss_2_pct": loss_2_pct, "med_inc": med_inc},
        "rows": active, "pareto": pareto, "loss": loss, "quadrant": quad, "scorecards": cards,
        "split": {"branch": {"inc": sum(d["inc"] for d in br), "n": len(br),
                             "miss": sum(d["miss"] for d in br)},
                  "dept": {"inc": sum(d["inc"] for d in dp), "n": len(dp),
                           "miss": sum(d["miss"] for d in dp)}},
        "headline": headline,
    }


# ── 5) AGENT CALLS  (مكالمات الزملاء) ───────────────────────────────────────
def parse_agent_calls(wb, shift=None):
    ws = find_sheet(wb, "مكالمات الزملاء", "مكالمات الزمله", "مكالمات زملاء")
    if not ws:
        return None
    grid = rows_of(ws, 500)
    if len(grid) < 2:
        return None
    # header row: الترتيب | رقم C.C | الاسم | الداخلي | إجمالي المكالمات
    agents = []
    for r in grid[1:]:
        if not r or len(r) < 5:
            continue
        cc   = str(r[1] or "").strip()
        name = str(r[2] or "").strip()
        ext  = str(r[3] or "").strip()
        tot  = numf(r[4])
        if not cc or not name:
            continue
        agents.append({"cc": cc, "name": name, "ext": ext,
                       "total": int(tot) if tot is not None else 0})
    if not agents:
        return None
    agents.sort(key=lambda a: -a["total"])
    total_calls = sum(a["total"] for a in agents)
    # الفترة من بيانات الشيفت لو متاحة
    period = {}
    if shift:
        daily = shift.get("daily", [])
        if daily:
            period = {"from": daily[0]["date"], "to": daily[-1]["date"]}
    return {
        "generated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "period": period,
        "agents": agents,
        "totals": {"agents": len(agents), "calls": total_calls},
    }


# ── per-file orchestration ───────────────────────────────────────────────────
def parse_file(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out = {}
    try:
        out["shift"]    = parse_shift_abandon(wb)
        ym = out["shift"]["ym"] if out["shift"] else None
        out["hourly"]   = parse_hourly(wb, ym)
        out["coverage"] = parse_coverage(wb)
        out["leaves"]   = parse_monthly_leaves(wb, ym)
        out["branches"] = parse_branches(wb)
        out["calls"]    = parse_agent_calls(wb, out["shift"])
    finally:
        wb.close()

    # daily correlation: abandonment rate vs leave count (shared dates)
    corr = []
    if out.get("shift") and out.get("leaves"):
        lv = {d["date"]: d["count"] for d in out["leaves"]["daily"]}
        for day in out["shift"]["daily"]:
            if day["date"] in lv and day["rate"] is not None:
                corr.append({"date": day["date"], "rate": day["rate"],
                             "leaves": lv[day["date"]], "inc": day["inc"],
                             "ab": day["ab"]})
    out["correlation"] = corr
    return out


def main():
    load_env()
    months = list(MONTHLY_FILES.keys())
    if not months:
        raise SystemExit("MONTHLY_FILES is empty — add at least one month.")

    payload = {"generated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
               "months": {}}
    for label, fname in MONTHLY_FILES.items():
        path = os.path.join(HERE, fname)
        if not os.path.exists(path):
            raise SystemExit(f"Missing file for [{label}]: {fname}")
        data = parse_file(path)
        payload["months"][label] = data
        s = data.get("shift")
        print(f"\n  ── {label} ──")
        if s:
            t = s["totals"]
            print(f"    shift:    days={t['days']}  inc={t['inc']}  ab={t['ab']}  "
                  f"rate={t['rate']}  anomalies={len(s['anomalies'])}")
        else:
            print("    shift:    (none)")
        print(f"    hourly:   {'ok' if data.get('hourly') else '—'}   "
              f"coverage: {'ok' if data.get('coverage') else '—'}   "
              f"leaves:   {data['leaves']['total'] if data.get('leaves') else '—'}   "
              f"corr-days:{len(data.get('correlation') or [])}")
        if data.get("branches"):
            bt = data["branches"]["totals"]
            print(f"    branches: {bt['queues']} طابور  inc={bt['inc']}  miss={bt['miss']}  "
                  f"rate={bt['rate']}  (فرع {bt['branches']} · قسم {bt['depts']})")
        else:
            print("    branches: (no «مكالمات الفروع» sheet)")

    payload["latest"] = months[-1]

    # top-level branch snapshot = newest month that actually has a branches sheet.
    # branch data lives in its OWN block (CCBRANCH_DATA), so strip it out of the
    # per-month payload to keep CCOPS_DATA lean and avoid duplicating it.
    branch_payload = None
    for label in reversed(months):
        if payload["months"][label].get("branches"):
            branch_payload = branch_payload or payload["months"][label]["branches"]
        payload["months"][label].pop("branches", None)

    # calls payload = آخر شهر عنده بيانات مكالمات زملاء
    calls_payload = None
    for label in reversed(months):
        c = payload["months"][label].get("calls")
        if c:
            calls_payload = c
            break
    # شيل calls من months عشان CCOPS_DATA تفضل lean (CCCALLS_DATA منفصل)
    for label in months:
        payload["months"][label].pop("calls", None)

    # ملف الرفع (cc-ops-data.json) بيضم الفروع والمكالمات عشان رفع الموقع يحدّثهم برضه.
    file_payload = dict(payload)
    if branch_payload:
        file_payload["branches"] = branch_payload
    if calls_payload:
        file_payload["calls"] = calls_payload
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        f.write(json.dumps(file_payload, ensure_ascii=False, separators=(",", ":")))

    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    if os.path.exists(HTML_FILE):
        html = open(HTML_FILE, encoding="utf-8").read()
        new = html
        # embed CCOPS_DATA
        block = "// CCOPS_DATA_START\nconst CCOPS_DATA = " + blob + ";\n// CCOPS_DATA_END"
        new = re.sub(r"// CCOPS_DATA_START.*?// CCOPS_DATA_END", lambda _: block, new, flags=re.S)
        # embed CCBRANCH_DATA
        if branch_payload:
            bblob = json.dumps(branch_payload, ensure_ascii=False, separators=(",", ":"))
            bblock = "// CCBRANCH_DATA_START\nconst CCBRANCH_DATA = " + bblob + ";\n// CCBRANCH_DATA_END"
            if "CCBRANCH_DATA_START" in new:
                new = re.sub(r"// CCBRANCH_DATA_START.*?// CCBRANCH_DATA_END",
                             lambda _: bblock, new, flags=re.S)
            else:
                print("  WARNING: markers // CCBRANCH_DATA_START..END not found — branch widgets won't update.")
        # embed CCCALLS_DATA
        if calls_payload:
            cblob = json.dumps(calls_payload, ensure_ascii=False, separators=(",", ":"))
            cblock = "// CCCALLS_DATA_START\nconst CCCALLS_DATA = " + cblob + ";\n// CCCALLS_DATA_END"
            if "CCCALLS_DATA_START" in new:
                new = re.sub(r"// CCCALLS_DATA_START.*?// CCCALLS_DATA_END",
                             lambda _: cblock, new, flags=re.S)
            else:
                print("  WARNING: markers // CCCALLS_DATA_START..END not found — agent calls won't update.")
        if new != html:
            open(HTML_FILE, "w", encoding="utf-8").write(new)
            extras = []
            if branch_payload: extras.append("branch analytics")
            if calls_payload:  extras.append(f"agent calls ({calls_payload['totals']['agents']} زميل)")
            print(f"\n  embedded {len(months)} month(s)" +
                  (f" + {', '.join(extras)}" if extras else "") + " into cc-ops.html")
        else:
            print("\n  WARNING: markers // CCOPS_DATA_START..END not found in cc-ops.html")
    else:
        print("\n  (cc-ops.html not found yet — wrote JSON only)")

    print(f"\nwrote cc-ops-data.json ({len(blob)} bytes)  |  months: {', '.join(months)}")

    # ── الرفع بقى من الموقع نفسه (أدمن) — مش من هنا ──────────────────────────────
    # القرار (2026-06-24): أرشيف الشهور (ccOpsMonths) بيترفع من زرار «رفع شيت الشهر»
    # في تاب الاستخراج داخل cc-ops.html، عشان سكربت اللايف ما يدوسش عليه.
    # شغّل السكربت ده عشان يطلّع cc-ops-data.json بس، وبعدين ارفع الملف من الموقع.
    # (push_to_firestore لسه موجودة تحت لو احتجتها يدوياً.)
    print("\n  ✦ خلص! افتح cc-ops.html → تاب الاستخراج → «رفع شيت الشهر»")
    print("    واختار الملف:  cc-ops-data.json")
    # push_to_firestore(payload, branch_payload)   # متوقف عمداً — الرفع من الموقع


# ── Firestore push ─────────────────────────────────────────────────────────────
# Pushes per-month ops data to Firestore so cc-ops.html can refresh live.
# Requires FB_ADMIN_EMAIL / FB_ADMIN_PASS env vars (admin account credentials).
FIREBASE_API_KEY = "AIzaSyBvmHh6-KVlKNATzbfMk3hIswbMCrBZwf4"
FIREBASE_PROJECT = "pharma-triage-5d165"

def _fb_token():
    try:
        import requests as _rq
    except ImportError:
        print("  pip install requests  to enable Firestore push.")
        return None
   
    email = os.environ.get("FB_ADMIN_EMAIL")
    password = os.environ.get("FB_ADMIN_PASS")
    if not email or not password:
        return None
    try:
        r = _rq.post(
            f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}",
            json={"email": email, "password": password, "returnSecureToken": True},
            timeout=20, verify=False,
        )
        return r.json().get("idToken")
    except Exception as e:
        print(f"  Firebase login failed: {e}")
        return None

def _to_fs(v):
    if v is None:                       return {"nullValue": None}
    if isinstance(v, bool):             return {"booleanValue": v}
    if isinstance(v, int):              return {"integerValue": str(v)}
    if isinstance(v, float):
        if v != v or abs(v) == float("inf"): return {"nullValue": None}
        return {"doubleValue": v}
    if isinstance(v, str):              return {"stringValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [_to_fs(x) for x in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: _to_fs(x) for k, x in v.items()}}}
    return {"stringValue": str(v)}

def _fs_set(collection, doc_id, data, token):
    try:
        import requests as _rq
    except ImportError:
        return False, 0
    url = (f"https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT}"
           f"/databases/(default)/documents/{collection}/{doc_id}")
    body = {"fields": {k: _to_fs(v) for k, v in data.items()}}
    r = _rq.patch(url, json=body,
                  headers={"Authorization": f"Bearer {token}"},
                  timeout=30, verify=False)
    return r.ok, r.status_code

def push_to_firestore(payload, branch_payload=None):
    token = _fb_token()
    if not token:
        print("  Firestore push skipped — set FB_ADMIN_EMAIL and FB_ADMIN_PASS to enable.")
        return
    months_data = payload.get("months", {})
    for ar_name, mdata in months_data.items():
        ym = mdata.get("shift", {}).get("ym") or mdata.get("shift", {}).get("period", "")[:7]
        if not ym:
            continue
        # strip hourly daily breakdown (large + not rendered) before storing
        doc_data = json.loads(json.dumps(mdata, ensure_ascii=False))  # deep copy
        if "hourly" in doc_data and doc_data["hourly"]:
            doc_data["hourly"] = {"by_hour": doc_data["hourly"].get("by_hour", [])}
        doc_data["ar"] = ar_name
        doc_data["generated"] = payload.get("generated", "")
        print(f"  pushing month {ym} ({ar_name}) to Firestore …", end=" ", flush=True)
        ok, code = _fs_set("ccOpsMonths", ym, doc_data, token)
        print("OK" if ok else f"FAILED ({code})")
    if branch_payload:
        print("  pushing branch analytics to Firestore …", end=" ", flush=True)
        ok, code = _fs_set("ccOpsData", "branches", branch_payload, token)
        print("OK" if ok else f"FAILED ({code})")


if __name__ == "__main__":
    main()
