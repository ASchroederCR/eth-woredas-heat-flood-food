"""Latest EthioMet daily forecast bulletin -> app/data/ethiomet.js (window.EMI).

The Ethiopian Meteorological Institute (EMI) posts a daily bulletin, "Daily Rainfall, Exceptional rainfall
and Temperature Forecast", at https://www.ethiomet.gov.et/products/numerical-weather-prediction/ . Each has
four products (total rainfall, exceptional rainfall, minimum and maximum temperature) for three 24-hour
periods, each a JPG map plus a sentence or two of text. No machine-readable data is published, so this
only records the bulletin's link, its own text and links to its maps; the app shows them as a summary
panel. Nothing here is joined to woredas: that waits for EMI's gridded files.

Usage:  python ethiomet.py        (run daily by refresh_daily.ps1; keeps the old file if the fetch fails)
"""
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'app' / 'data' / 'ethiomet.js'
INDEX = ROOT / 'app' / 'index.html'
SITE = 'https://www.ethiomet.gov.et'
LIST = SITE + '/products/numerical-weather-prediction/'
UA = 'eth-woredas-heat-map/1.0 (daily bulletin link; github.com/ASchroederCR/eth-woredas-heat-flood-food)'
MONTHS = {m: i + 1 for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}


def log(msg):
    print(time.strftime('%H:%M:%S'), msg, flush=True)


def get(url, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:  # network hiccups: back off and retry
            if k == tries - 1:
                raise
            log(f'retry {url}: {e}')
            time.sleep(15 * (k + 1))


def parse_date(s):
    """'Nov. 10, 2026' / 'Nov 10, 2026' -> date, else None."""
    m = re.search(r'([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})', s)
    if not m or m.group(1).lower() not in MONTHS:
        return None
    return dt.date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))


def latest_post():
    """Newest bulletin on the listing page, by the date window in its title (the slugs are not reliable)."""
    page = get(LIST)
    best = None
    for href, title in re.findall(r'<a href="(/products/numerical-weather-prediction/[^"]+)"\s+class="pub-title">\s*([^<]+?)\s*</a>', page):
        title = html.unescape(title)
        m = re.search(r'for\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*-\s*(?:([A-Za-z]{3})[a-z]*\.?\s+)?(\d{1,2}),\s*(\d{4})', title)
        if not m:
            continue
        mon1, d1, mon2, d2, yr = m.groups()
        start = dt.date(int(yr), MONTHS[mon1.lower()], int(d1))
        end = dt.date(int(yr), MONTHS[(mon2 or mon1).lower()], int(d2))
        if end < start:            # e.g. Dec 31 - Jan 2
            end = end.replace(year=end.year + 1)
        if best is None or start > best[0]:
            best = (start, end, SITE + href, title)
    if best is None:
        raise RuntimeError('no bulletin found on the listing page (layout changed?)')
    return best


class Bulletin(HTMLParser):
    """Collects tab labels (product names), and per product: date pills, map images and texts."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.labels, self.cats = {}, {}
        self.sections = []           # [{id, days: [{dates, img, text}]}]
        self.cur_cat = None
        self.mode = None             # 'cat' | 'tab' | 'pill' | 'desc'
        self.buf = []
        self.tab_id = None
        self.pills = []

    def handle_starttag(self, tag, a):
        a = dict(a)
        cls = (a.get('class') or '').split()
        if tag == 'span' and 'pd-cat-name' in cls:
            self.mode, self.buf = 'cat', []
        elif tag == 'a' and 'pd-tab' in cls and a.get('aria-controls'):
            self.mode, self.buf, self.tab_id = 'tab', [], a['aria-controls']
        elif tag == 'div' and 'pd-content' in cls and a.get('id'):
            self.sections.append({'id': a['id'], 'days': []})
            self.pills = []
        elif tag == 'button' and 'pd-date-pill' in cls:
            self.mode, self.buf = 'pill', []
        elif tag == 'div' and 'pd-item' in cls and self.sections:
            k = len(self.sections[-1]['days'])
            self.sections[-1]['days'].append({'dates': self.pills[k] if k < len(self.pills) else '', 'img': None, 'text': ''})
        elif tag == 'img' and a.get('data-progressive') and self.sections and self.sections[-1]['days']:
            day = self.sections[-1]['days'][-1]
            day['img'] = day['img'] or SITE + a['data-progressive']
        elif tag == 'div' and 'pd-description' in cls and self.sections and self.sections[-1]['days']:
            self.mode, self.buf = 'desc', []

    def handle_endtag(self, tag):
        text = ' '.join(''.join(self.buf).split())
        if self.mode == 'cat' and tag == 'span':
            self.cur_cat, self.mode = text, None
        elif self.mode == 'tab' and tag == 'a':
            self.labels[self.tab_id], self.cats[self.tab_id], self.mode = text, self.cur_cat, None
        elif self.mode == 'pill' and tag == 'button':
            self.pills.append(text)
            self.mode = None
        elif self.mode == 'desc' and tag == 'div':
            self.sections[-1]['days'][-1]['text'] = text
            self.mode = None
        elif self.mode == 'desc' and tag == 'p':
            self.buf.append(' ')

    def handle_data(self, data):
        if self.mode:
            self.buf.append(data)


def day_window(pill):
    """'Nov. 9, 2026 – Nov. 10, 2026' -> ['2026-11-09', '2026-11-10']."""
    parts = [parse_date(p) for p in re.split(r'[–-]\s*(?=[A-Za-z]{3})', pill)]
    parts = [p.isoformat() for p in parts if p]
    return parts if len(parts) == 2 else parts[:1] * 2 if parts else [None, None]


def main():
    start, end, url, title = latest_post()
    log(f'latest bulletin: {title}')
    p = Bulletin()
    p.feed(get(url))
    products = []
    for s in p.sections:
        days = [{'from': day_window(d['dates'])[0], 'to': day_window(d['dates'])[1], 'img': d['img'], 'text': d['text']}
                for d in s['days'] if d['text'] or d['img']]
        if days:
            products.append({'name': p.labels.get(s['id'], s['id']), 'group': p.cats.get(s['id']), 'days': days})
    if not products:
        raise RuntimeError('bulletin page had no products (layout changed?)')
    out = {
        'title': title, 'url': url, 'start': start.isoformat(), 'end': end.isoformat(),
        'fetched': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
        'listing': LIST, 'products': products,
    }
    OUT.write_text('window.EMI = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    stamp = time.strftime('%Y%m%d%H%M')
    idx = INDEX.read_text(encoding='utf-8')
    idx2 = re.sub(r'data/ethiomet\.js\?v=\d+', f'data/ethiomet.js?v={stamp}', idx)
    if idx2 != idx:
        INDEX.write_text(idx2, encoding='utf-8')
    log(f'ethiomet.js: {len(products)} products × {max(len(x["days"]) for x in products)} days, {start} to {end}')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        log(f'FAILED: {e} (keeping the previous app/data/ethiomet.js)')
        sys.exit(1)
