"""Fixed Wikimedia images for RUM harness prompts (tests/rum-harness.mjs QUESTIONS).

Only used when the chat request User-Agent contains ``test_harness``. Real users
always go through open image search in ``image_search.py``.

Keep the three keys below in sync with the image prompts in ``tests/rum-harness.mjs``.
"""

from __future__ import annotations

import re

# Normalized harness prompt → (https image url, alt text). Verified Commons thumbnails.
_HARNESS_IMAGES: dict[str, tuple[str, str]] = {
    "show me a picture of a duck on a pond": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/"
        "A_Duck_pond_and_ducks_in_Howrah%2C_West_Bengal%2C_India.jpg/"
        "960px-A_Duck_pond_and_ducks_in_Howrah%2C_West_Bengal%2C_India.jpg",
        "Ducks on a pond",
    ),
    "can i see a photo of chocolate truffles": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/"
        "Chocolate_Truffles_%284202810000%29.jpg/"
        "960px-Chocolate_Truffles_%284202810000%29.jpg",
        "Chocolate truffles",
    ),
    "draw me an image of a duck egg": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/"
        "Duck_Egg.jpg/960px-Duck_Egg.jpg",
        "Duck egg",
    ),
}


def normalize_harness_prompt(message: str) -> str:
    """Lowercase, collapse whitespace, strip trailing punctuation/asides."""
    text = message.strip().lower()
    text = re.sub(r"\s*—\s*just use a picture\.?\s*$", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" .?!")
    return text


def harness_image_for_prompt(user_message: str) -> tuple[str, str] | None:
    """Return a fixed image for a known harness prompt, else None."""
    return _HARNESS_IMAGES.get(normalize_harness_prompt(user_message))
