import os, json, sys
from dotenv import load_dotenv
from elevenlabs import ElevenLabs, VoiceSettings

load_dotenv('/app/backend/.env')
c = ElevenLabs(api_key=os.environ['ELEVEN_API_KEY'])

# NOTE: The two Top-40 hype voices (Johnny + Jaxon) were hand-designed and tuned against
# live previews using the turbo engine, so they are PINNED here by voice_id rather than
# re-designed on each run (re-designing would produce a different-sounding voice). The
# remaining voices can be regenerated via Voice Design if needed.
#
# Each entry carries its own tuned TTS recipe (model + settings) which must match
# CURATED_DJ_VOICES in server.py.

# Pinned, pre-designed voices (do NOT re-design — keep these exact voice_ids)
PINNED = [
    {
        "voice_id": "0xDJFYYJsXzkI1tnTGpW", "vibe": "Top 40", "name": "Johnny \u2014 Top-40 Hype",
        "description": "Genuinely high-energy Top-40 hype host \u2014 upbeat, excited, still conversational. Mid-30s American male.",
        "model": "eleven_turbo_v2_5",
        "settings": {"stability": 0.75, "similarity_boost": 0.55, "style": 0.0, "use_speaker_boost": False, "speed": 0.96},
    },
    {
        "voice_id": "jjPWyIS2ybPXJL6blCvY", "vibe": "Top 40", "name": "Jaxon \u2014 Top-40 Energy",
        "description": "Mid-30s energetic Top-40 host \u2014 upbeat and excited but conversational, not over the top.",
        "model": "eleven_turbo_v2_5",
        "settings": {"stability": 0.85, "similarity_boost": 0.45, "style": 0.0, "use_speaker_boost": False, "speed": 0.95},
    },
]

# Voices that may be (re)designed via Voice Design. Each row:
# (vibe, name, design_description, model, settings)
SPECS = [
    ("Top 40", "Mia \u2014 Pop Energy",
     "A bubbly American female pop radio host in her mid 20s, playful, enthusiastic, warm and fun with a modern upbeat delivery.",
     "eleven_v3", {"stability": 0.6, "similarity_boost": 0.7, "style": 0.3, "use_speaker_boost": True}),
    ("Chill Lofi", "Cole \u2014 Lofi Mellow",
     "A smooth chill lo-fi radio host, soft-spoken American male in his late 20s, mellow, relaxed and intimate with a calm late-night cadence.",
     "eleven_v3", {"stability": 0.5, "similarity_boost": 0.8, "style": 0.3, "use_speaker_boost": True}),
    ("Chill Lofi", "Luna \u2014 Late-Night Velvet",
     "A warm soothing female late-night radio host, slightly husky and calm, with a slow relaxed velvety cadence and gentle warmth.",
     "eleven_v3", {"stability": 0.5, "similarity_boost": 0.8, "style": 0.3, "use_speaker_boost": True}),
    ("Rock / Metal", "Axl \u2014 Rock Gravel",
     "A gritty classic-rock radio DJ, gravelly deep American male voice in his 40s, rugged, confident and commanding with rock-and-roll attitude.",
     "eleven_v3", {"stability": 0.6, "similarity_boost": 0.7, "style": 0.3, "use_speaker_boost": True}),
    ("Rock / Metal", "Reaper \u2014 Metal Roar",
     "An intense deep metal radio announcer, powerful and menacing low male voice, dramatic and gritty with dark commanding energy.",
     "eleven_v3", {"stability": 1.0, "similarity_boost": 0.85, "style": 0.4, "use_speaker_boost": True}),
    ("Accents", "Oliver \u2014 London Smooth",
     "A charismatic British male radio presenter with a smooth London accent, witty and warm in a polished BBC broadcast style.",
     "eleven_multilingual_v2", {"stability": 0.5, "similarity_boost": 0.75, "style": 0.15, "use_speaker_boost": True}),
    ("Accents", "Kai \u2014 Aussie Cool",
     "A cool laid-back Australian male radio host with a friendly surfer vibe, easygoing yet energetic and charming.",
     "eleven_v3", {"stability": 0.5, "similarity_boost": 0.85, "style": 0.7, "use_speaker_boost": True}),
]

# Set REDESIGN=1 to actually run Voice Design on the SPECS rows (creates NEW voices).
# By default we keep the existing pinned voice_ids (used by dj_voices.json / server.py).
REDESIGN = os.environ.get("REDESIGN") == "1"

results = list(PINNED)

if REDESIGN:
    for vibe, name, desc, model, settings in SPECS:
        try:
            d = c.text_to_voice.design(voice_description=desc, model_id='eleven_ttv_v3', auto_generate_text=True)
            gvid = d.previews[0].generated_voice_id
            v = c.text_to_voice.create(voice_name=name, voice_description=desc, generated_voice_id=gvid)
            results.append({"voice_id": v.voice_id, "name": name, "description": desc,
                            "vibe": vibe, "model": model, "settings": settings})
            print(f"OK  {vibe:12} {name:26} -> {v.voice_id}", flush=True)
        except Exception as e:
            print(f"ERR {name}: {e}", flush=True)
else:
    print("REDESIGN not set; keeping existing voice_ids from dj_voices.json for SPECS rows.")
    try:
        with open('/app/backend/scripts/dj_voices.json') as f:
            existing = {v["name"]: v for v in json.load(f)}
    except Exception:
        existing = {}
    for vibe, name, desc, model, settings in SPECS:
        prev = existing.get(name, {})
        results.append({"voice_id": prev.get("voice_id"), "name": name, "description": desc,
                        "vibe": vibe, "model": model, "settings": settings})

with open('/app/backend/scripts/dj_voices.json', 'w') as f:
    json.dump(results, f, indent=2)
print("SAVED", len(results), "voices")

# Validate TTS round-trips on each voice using its OWN model + settings.
TEST_LINE = "You are locked in to your F M where the hits keep rolling all night long."
for r in results:
    vid = r.get("voice_id")
    if not vid:
        print(f"SKIP {r['name']}: no voice_id")
        continue
    settings = dict(r["settings"])
    speed = settings.pop("speed", None)
    kwargs = dict(settings)
    if speed is not None and r["model"] in ("eleven_turbo_v2_5", "eleven_multilingual_v2", "eleven_turbo_v2"):
        kwargs["speed"] = speed
    try:
        gen = c.text_to_speech.convert(
            text=TEST_LINE, voice_id=vid, model_id=r["model"],
            voice_settings=VoiceSettings(**kwargs)
        )
        n = sum(len(ch) for ch in gen)
        print(f"TTS {r['name']:26} {r['model']:24}: OK {n} bytes")
    except Exception as e:
        print(f"TTS {r['name']:26} {r['model']:24}: ERR {e}")
