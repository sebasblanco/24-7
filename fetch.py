"""
Pulls live data for 24/7 from three free, public, no-auth-required APIs:
- Kalshi (prediction markets, economics/politics/world/elections)
- Polymarket (prediction markets, keyword-filtered for econ/politics relevance)
- Frankfurter (FX rates, ECB reference data, actual trailing-year daily rates)

No API keys needed for any of these. Keep this module side-effect-free aside
from outbound HTTP — server.py owns the caching layer.
"""
import time
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from email.utils import parsedate_to_datetime

import requests

TIMEOUT = 8
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; 24-7-dashboard/1.0)"}

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

# Curated RSS feeds, not a news API — avoids key limits/paywalls. Mix of
# world/politics breadth (BBC, Guardian, Al Jazeera) and an economics-specific
# source (BBC Business, plus the Fed's own press releases, which pair
# naturally with the Kalshi Fed-rate markets above). MarketWatch was tried
# and dropped: its general "topstories" feed mixes in personal-finance
# advice-column clickbait, and its more on-theme "marketpulse" feed turned
# out to be dead (stuck on mid-2025 content as of this writing).
HEADLINE_FEEDS = [
    ("BBC World", "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ("BBC Business", "http://feeds.bbci.co.uk/news/business/rss.xml"),
    ("The Guardian", "https://www.theguardian.com/world/rss"),
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"),
]
HEADLINES_PER_FEED = 8
HEADLINES_TOTAL = 20


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
    """Trailing-year daily FX series per pair, actual rates (not indexed)."""
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
            series[ccy].append(day[ccy] if ccy in day else None)

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


def _parse_rss_date(raw):
    if not raw:
        return None
    try:
        return parsedate_to_datetime(raw.strip())
    except (TypeError, ValueError):
        return None


def _fetch_one_feed(source, url):
    out = []
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        root = ET.fromstring(r.content)
    except (requests.RequestException, ET.ParseError):
        return out

    # RSS 2.0 shape: rss > channel > item*. Every feed here confirmed RSS 2.0
    # (not Atom) before being added to HEADLINE_FEEDS.
    items = root.findall("./channel/item")[:HEADLINES_PER_FEED]
    for item in items:
        title_el = item.find("title")
        link_el = item.find("link")
        date_el = item.find("pubDate")
        title = (title_el.text or "").strip() if title_el is not None else ""
        link = (link_el.text or "").strip() if link_el is not None else ""
        if not title or not link:
            continue
        published = _parse_rss_date(date_el.text if date_el is not None else None)
        out.append({
            "source": source,
            "title": title,
            "url": link,
            "published": published.isoformat() if published else None,
            "_sort_key": published.timestamp() if published else 0,
        })
    return out


def fetch_headlines():
    """Most recent headlines merged across curated RSS feeds. One slow or
    dead feed shouldn't blank the whole section — each feed fails on its
    own and the rest still render."""
    all_items = []
    for source, url in HEADLINE_FEEDS:
        all_items.extend(_fetch_one_feed(source, url))

    all_items.sort(key=lambda h: h["_sort_key"], reverse=True)
    for h in all_items:
        del h["_sort_key"]
    return all_items[:HEADLINES_TOTAL]


def build_snapshot():
    return {
        "generated_at": int(time.time()),
        "kalshi": fetch_kalshi(),
        "polymarket": fetch_polymarket(),
        "fx": fetch_fx(),
        "headlines": fetch_headlines(),
    }
