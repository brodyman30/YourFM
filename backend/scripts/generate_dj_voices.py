import os, json, sys
from dotenv import load_dotenv
from elevenlabs import ElevenLabs, VoiceSettings

load_dotenv('/app/backend/.env')
c = ElevenLabs(api_key=os.environ['ELEVEN_API_KEY'])

SPECS = [
    ("Top 40", "Jaxon — Top-40 Hype", "A high-energy American male Top-40 morning radio DJ in his early 30s, bright, fast-paced, charismatic and upbeat with natural breaths and lively inflection."),
    ("Top 40", "Mia — Pop Energy", "A bubbly American female pop radio host in her mid 20s, playful, enthusiastic, warm and fun with a modern upbeat delivery."),
    ("Chill Lofi", "Cole — Lofi Mellow", "A smooth chill lo-fi radio host, soft-spoken American male in his late 20s, mellow, relaxed and intimate with a calm late-night cadence."),
    ("Chill Lofi", "Luna — Late-Night Velvet", "A warm soothing female late-night radio host, slightly husky and calm, with a slow relaxed velvety cadence and gentle warmth."),
    ("Rock / Metal", "Axl — Rock Gravel", "A gritty classic-rock radio DJ, gravelly deep American male voice in his 40s, rugged, confident and commanding with rock-and-roll attitude."),
    ("Rock / Metal", "Reaper — Metal Roar", "An intense deep metal radio announcer, powerful and menacing low male voice, dramatic and gritty with dark commanding energy."),
    ("Accents", "Oliver — London Smooth", "A charismatic British male radio presenter with a smooth London accent, witty and warm in a polished BBC broadcast style."),
    ("Accents", "Kai — Aussie Cool", "A cool laid-back Australian male radio host with a friendly surfer vibe, easygoing yet energetic and charming."),
]

results = []
for vibe, name, desc in SPECS:
    try:
        d = c.text_to_voice.design(voice_description=desc, model_id='eleven_ttv_v3', auto_generate_text=True)
        gvid = d.previews[0].generated_voice_id
        v = c.text_to_voice.create(voice_name=name, voice_description=desc, generated_voice_id=gvid)
        results.append({"voice_id": v.voice_id, "name": name, "description": desc, "vibe": vibe})
        print(f"OK  {vibe:12} {name:26} -> {v.voice_id}", flush=True)
    except Exception as e:
        print(f"ERR {name}: {e}", flush=True)

with open('/app/backend/scripts/dj_voices.json', 'w') as f:
    json.dump(results, f, indent=2)
print("SAVED", len(results), "voices")

# Validate eleven_v3 TTS on the first generated voice
if results:
    vid = results[0]['voice_id']
    for model in ['eleven_v3', 'eleven_multilingual_v2']:
        try:
            gen = c.text_to_speech.convert(
                text="You're locked in to your F M, the hits keep rolling.",
                voice_id=vid, model_id=model,
                voice_settings=VoiceSettings(stability=0.5, similarity_boost=0.8, style=0.4, use_speaker_boost=True)
            )
            n = sum(len(ch) for ch in gen)
            print(f"TTS {model}: OK {n} bytes")
        except Exception as e:
            print(f"TTS {model}: ERR {e}")
