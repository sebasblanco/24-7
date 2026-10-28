"""
Pulls live data for The Tape from three free, public, no-auth-required APIs:
- Kalshi (prediction markets, economics/politics/world/elections)
- Polymarket (prediction markets, keyword-filtered for econ/politics relevance)
- Frankfurter (FX rates, ECB reference data, indexed-to-100 trailing year)

No API keys needed for any of these. Keep this module side-effect-free aside
from outbound HTTP — server.py owns the caching layer.
"""
import time
from datetime import date, timedelta

import requests

TIMEOUT = 8

KALSHI_BASE = "https://external-api.kalshi.com/trade-api/v2"
POLY_BASE = "https://gamma-api.polymarket.com"
FX_BASE = "https://api.frankfurter.app"

# Curated Kalshi series: (ticker, short label). Mix of recurring US economic
# data releases plus a few Fed/trade/central-bank items from Politics/World
# for breadth. Picked by hand from /series?category=... — see project notes.
KALSHI_SERIES = [
    ("KXCPINDEX", "US CPI"),
    ("KXECONSTATU3", "US Unemployment Rate"),
    ("KXFEDFUNDSYEAR", "Fed Funds Rate (year-end)"),
    ("JOBLESS", "Initial Jobless Claims"),
    ("HOUSESTART", "US Housing Starts"),
    ("KXADP", "ADP Employment Change"),
    ("KXFEDCHGCOUNT", "Fed Rate-Change Count"),
    ("KXTRUFCPI", "Truflation US CPI"),
    ("BOE", "Bank of England Rate"),
    ("ONRRP", "Overnight Reverse Repo"),
    ("KXTARIFFENDGLOBAL", "Global Tariff (10%)"),
    ("KXLEAVEPOWELLGOV", "Powell Leaves Fed"),
]

POLY_KEYWORDS = [
    "fed", "rate", "inflation", "cpi", "recession", "gdp", "unemployment",
    "election", "president", "congress", "shutdown", "tariff", "china",
    "russia", "ukraine", "israel", "war", "nato", "oil", "opec", "economy",
    "interest rate", "treasury", "debt", "powell",
]

FX_PAIRS = ["EUR", "JPY", "MXN", "GBP", "CNY"]


def _safe_float(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def fetch_kalshi():
    """One representative open market per curated series (highest 24h volume,
    falling back to total volume), with implied YES probability + day change."""
    out = []
    for ticker, label in KALSHI_SERIES:
        try:
            r = requests.get(
                f"{KALSHI_BASE}/markets",
                params={"series_ticker": ticker, "status": "open", "limit": 200},
                timeout=TIMEOUT,
            )
            r.raise_for_status()
            markets = r.json().get("markets", [])
            if not markets:
                continue
            markets.sort(
                key=lambda m: (
                    _safe_float(m.get("volume_24h_fp")),
                    _safe_float(m.get("volume_fp")),
                ),
                reverse=True,
            )
            m = markets[0]
            last = _safe_float(m.get("last_price_dollars"))
            prev = _safe_float(m.get("previous_price_dollars"), last)
            out.append({
                "source": "kalshi",
                "label": label,
                "title": m.get("title") or m.get("yes_sub_title") or label,
                "probability": round(last * 100, 1),
                "change": round((last - prev) * 100, 1),
                "volume": _safe_float(m.get("volume_fp")),
                "close_time": m.get("close_time"),
                "url": f"https://kalshi.com/markets/{ticker.lower()}",
            })
        except (requests.RequestException, ValueError, KeyError):
            continue
    return out


def fetch_polymarket():
    """Top-volume active markets, keyword-filtered for econ/politics relevance."""
    out = []
    try:
        r = requests.get(
            f"{POLY_BASE}/markets",
            params={
                "limit": 150,
                "active": "true",
                "closed": "false",
                "order": "volume24hr",
                "ascending": "false",
            },
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        markets = r.json()
    except (requests.RequestException, ValueError):
        return out

    for m in markets:
        q = (m.get("question") or "").lower()
        if not any(kw in q for kw in POLY_KEYWORDS):
            continue
        try:
            import json as _json
            prices = _json.loads(m.get("outcomePrices") or "[]")
            outcomes = _json.loads(m.get("outcomes") or "[]")
            yes_idx = outcomes.index("Yes") if "Yes" in outcomes else 0
            prob = _safe_float(prices[yes_idx]) * 100
        except (ValueError, IndexError, TypeError):
            prob = None
        out.append({
            "source": "polymarket",
            "label": m.get("groupItemTitle") or m.get("question"),
            "title": m.get("question"),
            "probability": round(prob, 1) if prob is not None else None,
            "change": None,  # Polymarket's public markets endpoint has no
                              # day-over-day price field; volume24hr stands
                              # in as the "heat" signal instead, shown as-is.
            "volume": _safe_float(m.get("volume24hr")),
            "close_time": m.get("endDate"),
            "url": f"https://polymarket.com/event/{m.get('slug', '')}",
        })
        if len(out) >= 12:
            break
    return out


def fetch_fx():
    """Trailing-year daily FX series per pair, indexed to 100 at the oldest point."""
    end = date.today()
    start = end - timedelta(days=365)
    try:
        r = requests.get(
            f"{FX_BASE}/{start.isoformat()}..{end.isoformat()}",
            params={"from": "USD", "to": ",".join(FX_PAIRS)},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
    except (requests.RequestException, ValueError):
        return {"series": {}, "dates": [], "as_of": None}

    rates_by_date = data.get("rates", {})
    dates = sorted(rates_by_date.keys())
    if not dates:
        return {"series": {}, "dates": [], "as_of": None}

    baseline = rates_by_date[dates[0]]
    series = {ccy: [] for ccy in FX_PAIRS}
    for d in dates:
        day = rates_by_date[d]
        for ccy in FX_PAIRS:
            if ccy in day and ccy in baseline and baseline[ccy]:
                series[ccy].append(round(day[ccy] / baseline[ccy] * 100, 3))
            else:
                series[ccy].append(None)

    latest = rates_by_date[dates[-1]]

    # Nearest available trading day to "3 months ago" for the quick-read table.
    three_mo = end - timedelta(days=90)
    three_mo_key = min(dates, key=lambda d: abs(date.fromisoformat(d) - three_mo))

    table = []
    for ccy in FX_PAIRS:
        table.append({
            "currency": ccy,
            "now": latest.get(ccy),
            "three_months_ago": rates_by_date[three_mo_key].get(ccy),
            "one_year_ago": baseline.get(ccy),
        })

    return {
        "dates": dates,
        "series": series,
        "table": table,
        "as_of": dates[-1],
    }


def build_snapshot():
    return {
        "generated_at": int(time.time()),
        "kalshi": fetch_kalshi(),
        "polymarket": fetch_polymarket(),
        "fx": fetch_fx(),
    }
