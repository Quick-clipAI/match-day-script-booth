# Converts match page-data files downloaded once in a while (by hand, in Colab) into Creator Booth "match JSON" (the format of Admin > Match details).
# Usage: python3 convert_to_match_json.py <folder-with-json-files> <output-folder>
import json, glob, os, re, sys

LEAGUE = {"LaLiga": "LALIGA", "Ligue 1": "LIGUE1", "Serie A": "SERIEA", "Premier League": "EPL", "Bundesliga": "BUNDESLIGA", "Champions League": "UCL", "UEFA Champions League": "UCL", "Europa League": "UEL", "UEFA Europa League": "UEL", "Conference League": "UECL", "UEFA Conference League": "UECL", "Europa Conference League": "UECL"}
POS = {0: "G", 1: "D", 2: "M", 3: "F"}
STATS = {"BallPossesion": "possession", "expected_goals": "xg", "total_shots": "shots", "ShotsOnTarget": "shots_on_target",
         "ShotsOffTarget": "shots_off_target", "blocked_shots": "blocked", "corners": "corners", "Offsides": "offsides",
         "fouls": "fouls", "yellow_cards": "yellow_cards", "red_cards": "red_cards", "keeper_saves": "saves"}


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)", str(v))
    return float(m.group(1)) if m else None


def grid_for(starters):
    """The page data gives x/y on the pitch; our grid is 'row:place' (row 1 = goalkeeper, place 1 = the left-back side)."""
    ys = sorted({round(p["verticalLayout"]["y"], 2) for p in starters if p.get("verticalLayout")})
    rows = []
    for y in ys:                                   # merge rows that are within 0.06 of each other
        if rows and y - rows[-1][-1] < 0.06:
            rows[-1].append(y)
        else:
            rows.append([y])
    out = {}
    for ri, ys_ in enumerate(rows, 1):
        members = [p for p in starters if p.get("verticalLayout") and round(p["verticalLayout"]["y"], 2) in ys_]
        for place, p in enumerate(sorted(members, key=lambda q: -q["verticalLayout"]["x"]), 1):
            out[p["id"]] = f"{ri}:{place}"
    return out


def convert(page):
    g, c, hd = page["general"], page["content"], page["header"]
    lu = c["lineup"]
    hs, as_ = hd["teams"][0]["score"], hd["teams"][1]["score"]
    ib = c["matchFacts"].get("infoBox") or {}
    out = {"league": LEAGUE.get(g["leagueName"], g["leagueName"]), "season": 2026,
           "date": g["matchTimeUTCDate"][:10], "home": g["homeTeam"]["name"], "away": g["awayTeam"]["name"],
           "score": {"hg": hs, "ag": as_}}
    st = ib.get("Stadium") or {}
    if st.get("name"):
        out["venue"] = st["name"] + (", " + st["city"] if st.get("city") else "")
    if (ib.get("Referee") or {}).get("text"):
        out["referee"] = ib["Referee"]["text"]

    # who is a starter (to tell who goes off in a substitution)
    starters = {"home": {p["name"] for p in lu["homeTeam"]["starters"]}, "away": {p["name"] for p in lu["awayTeam"]["starters"]}}
    coaches = {(lu[k].get('coach') or {}).get('name') for k in ('homeTeam', 'awayTeam')}
    events, goals_by, assists_by, yc, rc, off_at, on_at = [], {}, {}, {}, {}, {}, {}
    ph = pa = 0
    for e in c["matchFacts"]["events"]["events"]:
        t = e.get("type")
        if e.get("isPenaltyShootoutEvent"):
            continue
        minute, extra = e.get("time"), e.get("overloadTime") or None
        if not isinstance(minute, int):
            continue
        if t == "Goal":
            ns = e.get("newScore") or []
            if len(ns) == 2:                       # side the goal COUNTS FOR, from the score change
                side = "home" if ns[0] > ph else "away"
                ph, pa = ns
            else:
                side = "home" if e.get("isHome") else "away"
            kind = "own goal" if e.get("ownGoal") else ("penalty" if "enalty" in str(e.get("goalDescription")) else "goal")
            ev = {"minute": minute, "team": side, "type": kind, "player": e.get("fullName") or (e.get("player") or {}).get("name", "")}
            if e.get("assistInput"):
                ev["assist"] = e["assistInput"]
            if extra:
                ev["extra"] = extra
            events.append(ev)
            if kind != "own goal":
                goals_by[ev["player"]] = goals_by.get(ev["player"], 0) + 1
                if e.get("assistInput"):
                    assists_by[e["assistInput"]] = assists_by.get(e["assistInput"], 0) + 1
        elif t == "Card":
            side = "home" if e.get("isHome") else "away"
            name = e.get("fullName") or (e.get("player") or {}).get("name", "")
            if name in coaches:                    # a card shown to a coach is not a player card
                continue
            card = e.get("card")
            kind = "red" if card == "Red" else "second yellow" if card == "YellowRed" else "yellow"
            ev = {"minute": minute, "team": side, "type": kind, "player": name}
            if extra:
                ev["extra"] = extra
            events.append(ev)
            if kind == "yellow" or kind == "second yellow":
                yc[name] = yc.get(name, 0) + 1
            if kind != "yellow":
                rc[name] = rc.get(name, 0) + 1
        elif t == "Substitution" and e.get("swap") and len(e["swap"]) == 2:
            side = "home" if e.get("isHome") else "away"
            a, b = e["swap"][0]["name"], e["swap"][1]["name"]
            off, on = (a, b) if (a in starters[side]) else (b, a)
            ev = {"minute": minute, "team": side, "type": "sub", "on": on, "off": off}
            if extra:
                ev["extra"] = extra
            events.append(ev)
            off_at[off] = minute
            on_at[on] = minute
    out["events"] = events

    # statistics
    stats = {}
    for grp in c["stats"]["Periods"]["All"]["stats"]:
        for s in grp["stats"]:
            if s["key"] in STATS and len(s["stats"]) == 2:
                a, b = num(s["stats"][0]), num(s["stats"][1])
                if a is not None and b is not None:
                    stats[STATS[s["key"]]] = [a, b]
            if s["key"] == "accurate_passes" and len(s["stats"]) == 2:
                a, b = num(s["stats"][0]), num(s["stats"][1])
                if a is not None and b is not None:
                    stats["passes_accurate"] = [a, b]
    out["stats"] = stats

    # line-ups
    lineups = {}
    for side, key in (("home", "homeTeam"), ("away", "awayTeam")):
        t = lu[key]
        grid = grid_for(t["starters"])

        def person(p, is_xi):
            name = p["name"]
            perf = p.get("performance") or {}
            rating = perf.get("rating")
            if is_xi:
                mins = off_at.get(name, 90)
            else:
                subin = on_at.get(name)
                if subin is None:
                    subin = next((x["time"] for x in (perf.get("substitutionEvents") or []) if x.get("type") == "subIn"), None)
                mins = max(0, off_at.get(name, 90) - subin) if subin is not None else 0
            d = {"n": int(p["shirtNumber"]) if str(p.get("shirtNumber") or "").isdigit() else None, "name": name,
                 "pos": POS.get(p.get("usualPlayingPositionId"), ""), "min": mins,
                 "goals": goals_by.get(name, 0), "assists": assists_by.get(name, 0), "yellow": yc.get(name, 0), "red": rc.get(name, 0)}
            if is_xi and p["id"] in grid:
                d["grid"] = grid[p["id"]]
            if rating:
                d["rating"] = round(float(rating), 1)
            return d
        lineups[side] = {"formation": t.get("formation"), "coach": (t.get("coach") or {}).get("name"),
                         "xi": [person(p, True) for p in t["starters"]], "subs": [person(p, False) for p in t["subs"]]}
    out["lineups"] = lineups
    return out


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    by = {}
    for f in sorted(glob.glob(os.path.join(src, "**", "*.json"), recursive=True)):
        try:
            page = json.load(open(f, encoding="utf-8"))
            fid = re.search(r"_(\d+)\.json$", f).group(1)
            if str(page["general"]["matchId"]) != fid:
                print("SKIP wrong match:", os.path.basename(f)); continue
            if not page["general"].get("finished"):
                print("SKIP not finished:", os.path.basename(f)); continue
            m = convert(page)
            by.setdefault(m["league"], []).append(m)
        except Exception as e:
            print("ERROR", os.path.basename(f), e)
    for lg, items in by.items():
        items.sort(key=lambda m: (m["date"], m["home"]))
        for i in range(0, len(items), 30):
            name = os.path.join(dst, f"match_json_{lg}_{i // 30 + 1:02d}.json")
            json.dump({"matches": items[i:i + 30]}, open(name, "w", encoding="utf-8"), ensure_ascii=False)
            print("wrote", name, len(items[i:i + 30]), "matches")
