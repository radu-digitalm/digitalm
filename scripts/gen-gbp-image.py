#!/usr/bin/env python3
"""Generate a GBP marketing scene with FAL FLUX 2 Pro (the 'imagegen' backend Hermes uses)."""
import os, sys, base64, urllib.request, pathlib

# Load FAL_KEY from the Hermes env without printing it.
for line in pathlib.Path("/home/hermes/.hermes/.env").read_text().splitlines():
    if line.startswith("FAL_KEY="):
        os.environ["FAL_KEY"] = line.split("=", 1)[1].strip().strip('"')
if not os.environ.get("FAL_KEY"):
    sys.exit("FAL_KEY not found")

import fal_client

PROMPT = (
    "Editorial corporate photograph, photorealistic, two professionals — a man and a woman "
    "in smart-casual attire — collaborating energetically at a sleek modern desk with two large "
    "monitors, building an AI automation workflow. One large screen shows a clean abstract "
    "node-based automation flow diagram and a bright upward-trending green line chart signalling "
    "growth; the second screen shows a minimal analytics dashboard with rising bar charts. "
    "Bright airy contemporary studio office, warm morning sunlight through large windows, soft "
    "bokeh, indoor plants, light wood and matte-black accents, subtle teal and violet light "
    "accents. Mood: optimistic, confident, momentum, growth and success. Shallow depth of field, "
    "35mm, natural light, premium tech-startup aesthetic, high detail, professional color grading. "
    "Clean uncluttered negative space across the top of the frame. "
    "No text, no captions, no watermarks, no logos, no signage on screens or walls."
)

print("Generating with FLUX 2 Pro …")
result = fal_client.subscribe(
    "fal-ai/flux-2-pro",
    arguments={
        "prompt": PROMPT,
        "image_size": "landscape_16_9",
        "num_inference_steps": 50,
        "guidance_scale": 4.5,
        "num_images": 1,
        "output_format": "png",
        "enable_safety_checker": False,
        "safety_tolerance": "5",
        "sync_mode": True,
    },
    with_logs=False,
)

images = result.get("images") or []
if not images:
    sys.exit(f"No image returned: {result}")
url = images[0]["url"]
out = "/home/hermes/workspace/digitalm/public/media/gbp-ai-team-raw.png"
if url.startswith("data:"):
    data = base64.b64decode(url.split(",", 1)[1])
    pathlib.Path(out).write_bytes(data)
else:
    urllib.request.urlretrieve(url, out)
sz = pathlib.Path(out).stat().st_size
print(f"saved {out} ({sz} bytes); dims hint: {images[0].get('width')}x{images[0].get('height')}")
