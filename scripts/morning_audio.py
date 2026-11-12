"""Morgonsoffan som ljudfil: läser talmanuset med Microsofts neurala svenska röst
(edge-tts, samma tjänst som uppläsningen i Microsoft Edge), lägger ihop styckena med
korta pauser och laddar upp MP3-filen som en GitHub-release. Appen får adressen och
var varje stycke börjar, så att den kan markera texten medan ljudet spelas.

Körs av .github/workflows/morning-audio.yml efter att sessionen skrivits kl 07.30.
Inofficiell användning av tjänsten: slutar den fungera läser appen upp med
enhetens egen röst i stället.
"""
import asyncio, datetime, json, os, re, subprocess, sys, tempfile, urllib.request
from zoneinfo import ZoneInfo

import edge_tts

APP = os.environ.get('APP_URL', 'https://omx-analys.vercel.app').rstrip('/')
KEY = os.environ.get('CRON_SECRET', '')
REPO = os.environ.get('GITHUB_REPOSITORY', 'EnCodecwtf/omx-analys')
VOICE = os.environ.get('VOICE', 'sv-SE-MattiasNeural')
# Glen: Mattias, lite snabbare och ljusare än standard (valt efter röstproven i public/rostprov/).
RATE = os.environ.get('RATE', '+8%')
PITCH = os.environ.get('PITCH', '+4Hz')
TAG = 'morgon-ljud'


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'omx-analys-audio'}), timeout=120) as r:
        return json.load(r)


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


# Engelska uttryck i talmanuset är markerade [[en:…]] och läses av en engelsk mansröst,
# eftersom den svenska rösten uttalar dem fel. Bitarna klipps ihop till ett stycke.
EN_VOICE = os.environ.get('EN_VOICE', 'en-US-AndrewMultilingualNeural')
EN_MARK = re.compile(r'\[\[en:(.+?)\]\]')


async def synth_one(text, path, voice, rate, pitch):
    for attempt in range(3):
        try:
            await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(path)
            if os.path.getsize(path) > 0:
                return
        except Exception as err:  # noqa: BLE001 – försök igen, tjänsten är inofficiell
            print('Försök', attempt + 1, 'misslyckades:', err)
        await asyncio.sleep(3)
    raise RuntimeError('Ingen röst från tjänsten')


async def synth(text, path):
    bits = EN_MARK.split(text)  # udda index = engelska
    if len(bits) == 1:
        return await synth_one(text, path, VOICE, RATE, PITCH)
    work = tempfile.mkdtemp()
    files = []
    for k, bit in enumerate(bits):
        bit = bit.strip(' ')
        if not bit.strip():
            continue
        f = os.path.join(work, f'b{k:02d}.mp3')
        if k % 2:
            await synth_one(bit, f, EN_VOICE, '+0%', '+0Hz')
        else:
            await synth_one(bit, f, VOICE, RATE, PITCH)
        files.append(f)
    lst = os.path.join(work, 'l.txt')
    with open(lst, 'w') as fh:
        fh.writelines(f"file '{x}'\n" for x in files)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-ac', '1', '-ar', '24000', '-b:a', '48k', '-acodec', 'libmp3lame', path], check=True)


def main():
    m = (get_json(f'{APP}/api/morning') or {}).get('morning')
    today = datetime.datetime.now(ZoneInfo('Europe/Stockholm')).date().isoformat()
    if not m or not m.get('talk'):
        sys.exit('Ingen session med talmanus')
    if m['date'] != today and not os.environ.get('FORCE'):
        print('Dagens session är inte skriven än:', m['date'])
        return
    if (m.get('audio') or {}).get('date') == m['date'] and not os.environ.get('FORCE'):
        print('Ljudet finns redan')
        return
    talk = m['talk']
    work = tempfile.mkdtemp()
    parts, offsets, t = [], [], 0.0
    pause_short, pause_long = os.path.join(work, 'p1.mp3'), os.path.join(work, 'p2.mp3')
    for p, sec in ((pause_short, 0.15), (pause_long, 0.5)):
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', str(sec), '-q:a', '9', '-acodec', 'libmp3lame', p], check=True)
    for i, item in enumerate(talk):
        path = os.path.join(work, f'{i:02d}.mp3')
        asyncio.run(synth(item['text'], path))
        if i:
            pause = pause_long if item.get('section') != talk[i - 1].get('section') else pause_short
            parts.append(pause)
            t += duration(pause)
        offsets.append(round(t, 2))
        parts.append(path)
        t += duration(path)
    listfile = os.path.join(work, 'list.txt')
    with open(listfile, 'w') as f:
        f.writelines(f"file '{p}'\n" for p in parts)
    name = f"morgon-{m['date']}.mp3"
    out = os.path.join(work, name)
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listfile, '-ac', '1', '-ar', '24000', '-b:a', '48k', '-acodec', 'libmp3lame', out], check=True)
    total = round(duration(out), 1)
    print(f'{name}: {total} s, {len(talk)} stycken, {os.path.getsize(out) // 1024} kB')

    # Ladda upp som release-fil och behåll bara de senaste 7 dagarna.
    if subprocess.run(['gh', 'release', 'view', TAG, '-R', REPO], capture_output=True).returncode:
        subprocess.run(['gh', 'release', 'create', TAG, '-R', REPO, '--title', 'Morgonsoffan – ljud', '--notes', 'Ljudfiler för Morgonsoffan med Glen. Skapas automatiskt varje vardag.'], check=True)
    subprocess.run(['gh', 'release', 'upload', TAG, out, '-R', REPO, '--clobber'], check=True)
    assets = json.loads(subprocess.run(['gh', 'release', 'view', TAG, '-R', REPO, '--json', 'assets'], capture_output=True, text=True, check=True).stdout)['assets']
    old = sorted(a['name'] for a in assets if a['name'].startswith('morgon-'))[:-7]
    for a in old:
        subprocess.run(['gh', 'release', 'delete-asset', TAG, a, '-R', REPO, '-y'], check=False)

    body = json.dumps({'date': m['date'], 'file': name, 'offsets': offsets, 'duration': total, 'voice': VOICE}).encode()
    url = f'{APP}/api/cron/morning-audio' + (f'?key={KEY}' if KEY else '')
    req = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json', 'User-Agent': 'omx-analys-audio'})
    with urllib.request.urlopen(req, timeout=60) as r:
        print('Appen:', r.read().decode())


if __name__ == '__main__':
    main()
