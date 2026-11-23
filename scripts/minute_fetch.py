"""Hämtar gratis minutdata (Dukascopy) för S&P 500 och Nasdaq 100 för ett år och
sparar bara ordinarie handelstid i New York som kompakt json.
Används av .github/workflows/minute-data.yml för backtester av daytradestrategier.
Användning: python3 scripts/minute_fetch.py ÅR UTMAPP [INSTRUMENT ...]
Med andra instrument (t.ex. XAUUSD) sparas hela dygnet som 5-minutersstaplar."""
import datetime as dt, json, lzma, os, struct, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

NY = ZoneInfo('America/New_York')
INSTR = ('USATECHIDXUSD', 'USA500IDXUSD')
URL = 'https://datafeed.dukascopy.com/datafeed/{i}/{y}/{m:02d}/{d:02d}/BID_candles_min_1.bi5'


def get(ins, day):
    url = URL.format(i=ins, y=day.year, m=day.month - 1, d=day.day)
    for k in range(8):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return b''
        except Exception:
            pass
        time.sleep(2 + k * 3)
    return None


def rows(raw, day, full=False):
    if not raw:
        return []
    b = lzma.decompress(raw, format=lzma.FORMAT_ALONE)
    base = dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc)
    out = []
    for i in range(len(b) // 24):
        t, o, c, l, h, v = struct.unpack('>iiiiif', b[i * 24:i * 24 + 24])
        ny = (base + dt.timedelta(seconds=t)).astimezone(NY)
        hm = ny.hour * 60 + ny.minute
        if full or 570 <= hm < 960:
            out.append([ny.date().isoformat(), hm, o, h, l, c, round(v, 4)])
    return out


def five(r):
    """Minutstaplar -> 5-minutersstaplar [hm, o, h, l, c, v]."""
    out = {}
    for hm, o, h, l, c, v in r:
        k = hm - hm % 5
        b = out.get(k)
        if b is None: out[k] = [k, o, h, l, c, v]
        else: b[2] = max(b[2], h); b[3] = min(b[3], l); b[4] = c; b[5] = round(b[5] + v, 4)
    return [out[k] for k in sorted(out)]


def main():
    year, outdir = int(sys.argv[1]), sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    end = min(dt.date(year, 12, 31), dt.date.today() - dt.timedelta(days=1))
    days = [dt.date(year, 1, 1) + dt.timedelta(n) for n in range((end - dt.date(year, 1, 1)).days + 1)]
    days = [d for d in days if d.weekday() < 5]
    instr = sys.argv[3:] or INSTR
    for ins in instr:
        full = ins not in INSTR
        with ThreadPoolExecutor(3) as ex:
            raws = list(ex.map(lambda d: get(ins, d), days))
        res, missing = {}, 0
        for d, raw in zip(days, raws):
            if raw is None:
                missing += 1
                continue
            for r in rows(raw, d, full):
                res.setdefault(r[0], []).append(r[1:])
        if full:
            keep = {d: five(sorted(r)) for d, r in res.items() if len(r) >= 300}
        else:
            keep = {d: sorted(r) for d, r in res.items() if len(r) >= 300 and len({x[4] for x in r}) > 20}
        with open(os.path.join(outdir, f'{ins}_{year}.json'), 'w') as f:
            json.dump(keep, f, separators=(',', ':'))
        print(ins, year, len(keep), 'dagar,', missing, 'saknas', flush=True)


if __name__ == '__main__':
    main()
