"""Provinspelningar av rösten till Morgonsoffan: samma text med flera av Microsofts neurala
röster (de flerspråkiga har mer inlevelse och kan svenska). Filerna läggs i public/rostprov/
så att de kan lyssnas på i appen. Körs av .github/workflows/voice-samples.yml."""
import asyncio, os
import edge_tts

TEXT = ('God morgon och välkommen till Morgonsoffan. Det är torsdag den tolfte november. '
        'Terminerna i USA har fallit några tiondelar sedan vi stängde i går, och det pekar på en svag öppning – '
        'runt en halv procent ned för O M X. Guldet är i nedåttrend och har fallit fyra procent på en vecka. '
        'Fear and Greed står på tjugonio – alltså rädsla. Och kom ihåg: handla planen, inte känslan.')
VOICES = [
    ('mattias', 'sv-SE-MattiasNeural', '+4%', '+0Hz'),
    ('mattias-livligare', 'sv-SE-MattiasNeural', '+8%', '+4Hz'),
    ('andrew', 'en-US-AndrewMultilingualNeural', '+0%', '+0Hz'),
    ('brian', 'en-US-BrianMultilingualNeural', '+0%', '+0Hz'),
    ('florian', 'de-DE-FlorianMultilingualNeural', '+0%', '+0Hz'),
    ('remy', 'fr-FR-RemyMultilingualNeural', '+0%', '+0Hz'),
    ('william', 'en-AU-WilliamMultilingualNeural', '+0%', '+0Hz'),
    ('ava', 'en-US-AvaMultilingualNeural', '+0%', '+0Hz'),
    ('emma', 'en-US-EmmaMultilingualNeural', '+0%', '+0Hz'),
    ('sofie', 'sv-SE-SofieNeural', '+4%', '+0Hz'),
]

# Uttal av engelska ord: samma mening med olika svenska stavningar (Glens röst).
FG = [
    ('fg-1', 'Fear and Greed'),
    ('fg-2', 'Fiir änd griid'),
    ('fg-3', 'Fiir and griid'),
    ('fg-4', 'Fiöränd griid'),
    ('fg-5', 'Fir end grid'),
    ('fg-6', 'Fiir-änd-griid'),
]

async def fg_samples():
    for name, word in FG:
        path = f'public/rostprov/{name}.mp3'
        text = f'{word}-index för aktier står på tjugonio, alltså rädsla. {word} har stigit från sex den senaste veckan.'
        for attempt in range(3):
            try:
                await edge_tts.Communicate(text, 'sv-SE-MattiasNeural', rate='+8%', pitch='+4Hz').save(path)
                if os.path.getsize(path) > 0:
                    print('klar', name); break
            except Exception as err:  # noqa: BLE001
                print('försök', attempt + 1, name, err)
            await asyncio.sleep(2)

async def main():
    os.makedirs('public/rostprov', exist_ok=True)
    for name, voice, rate, pitch in VOICES:
        path = f'public/rostprov/{name}.mp3'
        for attempt in range(3):
            try:
                await edge_tts.Communicate(TEXT, voice, rate=rate, pitch=pitch).save(path)
                if os.path.getsize(path) > 0:
                    print('klar', name, os.path.getsize(path)); break
            except Exception as err:  # noqa: BLE001
                print('försök', attempt + 1, name, err)
            await asyncio.sleep(2)

asyncio.run(main())
asyncio.run(fg_samples())
