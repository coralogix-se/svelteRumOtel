"""Fetch real image URLs from the web for chat responses (Wikimedia Commons + optional Pixabay)."""

from __future__ import annotations

import json
import logging
import os
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request

import certifi

logger = logging.getLogger("chat-api")

_USER_AGENT = os.getenv(
    "IMAGE_SEARCH_USER_AGENT", "svelteRumOtel-chatbot/1.0 (demo; +https://github.com)"
)
_COMMONS_API = "https://commons.wikimedia.org/w/api.php"
_PIXABAY_API = "https://pixabay.com/api/"

_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "of",
        "me",
        "please",
        "picture",
        "pictures",
        "photo",
        "photos",
        "image",
        "images",
        "pic",
        "pics",
        "show",
        "can",
        "could",
        "would",
        "see",
        "want",
        "need",
        "get",
        "give",
        "send",
        "find",
        "look",
        "at",
        "i",
        "you",
    }
)
_MAX_IMAGES_PER_REPLY = 6
# Titles containing these are usually not what the user meant (e.g. "The Sun" tabloid/bus).
_NEGATIVE_TITLE_TERMS = (
    "bus",
    "coach",
    "vehicle",
    "newspaper",
    "tabloid",
    "logo",
    "brand",
    "advertisement",
    "company",
    "shop",
    "store",
    "album cover",
    "magazine cover",
)
# Boost when query terms suggest astronomy/nature and title matches.
_POSITIVE_TITLE_HINTS = (
    "solar",
    "nasa",
    "corona",
    "flare",
    "observatory",
    "astronomy",
    "lunar",
    "planet",
    "galaxy",
    "wildlife",
    "landscape",
)

_VISUAL_NOUN = r"(?:pictures?|photos?|images?|pics?)"
_IMAGE_INTENT_RE = re.compile(
    r"\b("
    rf"{_VISUAL_NOUN}|"
    r"photograph|drawing|illustration|"
    r"show me|see a|look at|visual of|depict"
    r")\b",
    re.I,
)
_COUNT_VISUAL_RE = re.compile(
    rf"\b(\d{{1,2}})\s+{_VISUAL_NOUN}\b",
    re.I,
)
_QUERY_PREFIX_RE = re.compile(
    rf"^(?:please\s+)?(?:"
    rf"(?:show|get|find|give|send)\s+(?:me\s+)?(?:(?:\d{{1,2}}\s+)?(?:a\s+)?{_VISUAL_NOUN}|(?:a\s+)?(?:picture|photo|image|pic))\s+of\s+|"
    rf"(?:can\s+(?:you|i)\s+)?(?:show|get|find|see|have)\s+(?:me\s+)?(?:(?:\d{{1,2}}\s+)?(?:a\s+)?{_VISUAL_NOUN}|(?:a\s+)?(?:picture|photo|image))\s+of\s+|"
    rf"(?:i\s+)?(?:want|need|would like)\s+(?:to\s+see\s+)?(?:(?:\d{{1,2}}\s+)?(?:a\s+)?{_VISUAL_NOUN}|(?:a\s+)?(?:picture|photo|image))\s+of\s+|"
    r"draw(?:ing)?\s+(?:me\s+)?(?:an?\s+)?(?:picture\s+of\s+|image\s+of\s+)|"
    rf"(?:(?:\d{{1,2}}\s+)?{_VISUAL_NOUN}|(?:picture|photo|image|pic))\s+of\s+"
    rf")",
    re.I,
)
_SUBJECT_AFTER_VISUAL_RE = re.compile(
    rf"(?:{_VISUAL_NOUN}|picture|photo|image|pic)\s+of\s+(.+)$",
    re.I,
)
_LEADING_COUNT_RE = re.compile(r"^\d{1,2}\s+", re.I)
_ARTICLE_PREFIX_RE = re.compile(r"^(?:the|a|an)\s+", re.I)
_SKIP_MIME = frozenset({"image/svg+xml", "image/x-svg+xml"})
_SKIP_TITLE_TERMS = (" icon", "icon ", " logo", "logo ", " emblem", " svg", ".svg", " badge", " seal ")
_GEOGRAPHIC_NOISE_TERMS = (
    "view of",
    "satellite",
    " iss",
    "- iss",
    "marsh",
    "island",
    "bridge",
    "refuge",
    " bay ",
    "aerial",
    "geograph.org",
    "cropped)",
)
_DRAWING_INTENT_RE = re.compile(r"\b(draw|drawing|sketch|illustrate)\b", re.I)
# Single-word queries that need extra disambiguation (not animals, food, etc.).
_AMBIGUOUS_SINGLE_TERMS = frozenset(
    {"sun", "moon", "star", "mars", "earth", "venus", "jupiter", "saturn", "mercury"}
)
_TRAILING_ASIDE_RE = re.compile(r"\s*[—–-]\s+.+$")
_JUST_PICTURE_ASIDE_RE = re.compile(r"\s*—?\s*just use a picture\.?\s*$", re.I)


def format_image_markdown(alt: str, url: str) -> str:
    """Markdown image with angle-bracket URL so filenames like ``foo_(1).jpg`` parse correctly."""
    clean_alt = re.sub(r"[\[\]]", "", (alt or "Image").strip()) or "Image"
    return f"![{clean_alt}](<{url}>)"


# Strip model or legacy image markdown (including URLs that contain parentheses).
_IMAGE_MARKDOWN_RE = re.compile(
    r"!\[[^\]]*\]\(\s*"
    r"(?:<[^>]+>|(?:https?://|/)(?:[^()]|\([^)]*\))*)"
    r"\s*\)",
    re.I,
)


def strip_image_markdown(text: str) -> str:
    return _IMAGE_MARKDOWN_RE.sub("", text).strip()


def user_wants_image(message: str) -> bool:
    return bool(_IMAGE_INTENT_RE.search(message))


def requested_image_count(user_message: str) -> int:
    match = _COUNT_VISUAL_RE.search(user_message)
    if match:
        return max(1, min(int(match.group(1)), _MAX_IMAGES_PER_REPLY))
    return 1


def image_search_query(user_message: str) -> str:
    raw = user_message.strip()
    q = _QUERY_PREFIX_RE.sub("", raw).strip(" .?!")
    if q == raw or len(q.split()) > 5:
        match = _SUBJECT_AFTER_VISUAL_RE.search(raw)
        if match:
            q = match.group(1).strip(" .?!")
    q = _LEADING_COUNT_RE.sub("", q).strip()
    q = _ARTICLE_PREFIX_RE.sub("", q).strip()
    q = _JUST_PICTURE_ASIDE_RE.sub("", q).strip()
    q = _TRAILING_ASIDE_RE.sub("", q).strip(" .?!")
    return q or raw


def _query_terms(query: str) -> list[str]:
    return [t for t in re.findall(r"\w+", query.lower()) if t not in _STOP_WORDS and len(t) > 1]


def _search_variants(query: str, *, user_message: str = "") -> list[str]:
    """Try several Commons queries; single-word queries like "sun" need disambiguation."""
    q = query.strip()
    if not q:
        return []
    seen: set[str] = set()
    variants: list[str] = []

    def add(s: str) -> None:
        key = s.lower()
        if key not in seen:
            seen.add(key)
            variants.append(s)

    add(q)
    stripped = _ARTICLE_PREFIX_RE.sub("", q).strip()
    if stripped and stripped.lower() != q.lower():
        add(stripped)
    terms = _query_terms(q)
    if _DRAWING_INTENT_RE.search(user_message):
        add(f"{q} illustration")
    # Disambiguate only known ambiguous single words (e.g. "sun" → not "The Sun" bus).
    if len(terms) == 1 and terms[0] in _AMBIGUOUS_SINGLE_TERMS:
        core = terms[0]
        add(f"{core} astronomy")
        add(f"{core} nature")
    return variants


def _term_in_title(term: str, title_l: str) -> bool:
    return bool(re.search(rf"\b{re.escape(term)}\b", title_l))


def _should_skip_image(title: str, mime: str, url: str) -> bool:
    if mime in _SKIP_MIME or url.lower().rstrip("/").endswith(".svg"):
        return True
    title_l = title.lower()
    return any(term in title_l for term in _SKIP_TITLE_TERMS)


def _score_title(title: str, query: str) -> float:
    title_l = re.sub(r"^File:", "", title, flags=re.I).lower().replace("_", " ")
    terms = _query_terms(query)
    if not terms:
        return 0.0
    matched = [t for t in terms if _term_in_title(t, title_l)]
    if len(terms) >= 2 and len(matched) < len(terms):
        return -1.0
    score = 0.0
    phrase = " ".join(terms)
    if len(terms) >= 2 and phrase in title_l:
        score += 8.0
    for term in matched:
        score += 3.0
    for neg in _NEGATIVE_TITLE_TERMS:
        if neg in title_l:
            score -= 5.0
    if any(noise in title_l for noise in _GEOGRAPHIC_NOISE_TERMS):
        score -= 5.0
    if "nest" in title_l and "nest" not in terms:
        score -= 4.0
    if "pond" in terms and any(
        pub in title_l for pub in ("beer garden", "pub", "inn", "hotel", "tavern")
    ):
        score -= 6.0
    if re.search(r"\b(18|19)\d{2}\b", title_l) and len(terms) >= 2:
        score -= 3.0
    if ("'" in title_l or '"' in title_l) and matched:
        score -= 4.0
    if any(hint in title_l for hint in _POSITIVE_TITLE_HINTS):
        if any(term in ("sun", "moon", "mars", "earth", "star", "planet") for term in terms):
            score += 3.0
        else:
            score += 1.0
    return score


def _http_get_json(url: str, *, timeout: float = 12.0) -> dict:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
    )
    ctx = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _iter_wikimedia_commons(query: str, *, width: int = 960, limit: int = 12):
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "generator": "search",
            "gsrsearch": query,
            "gsrnamespace": "6",
            "gsrlimit": str(limit),
            "prop": "imageinfo",
            "iiprop": "url|thumburl|mime",
            "iiurlwidth": str(width),
            "format": "json",
        }
    )
    try:
        data = _http_get_json(f"{_COMMONS_API}?{params}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        logger.warning("Wikimedia image search failed: %s", e)
        return

    pages = data.get("query", {}).get("pages") or {}
    for page in pages.values():
        info_list = page.get("imageinfo") or []
        if not info_list:
            continue
        info = info_list[0]
        mime = (info.get("mime") or "").lower()
        if mime and not mime.startswith("image/"):
            continue
        url = info.get("thumburl") or info.get("url")
        if not url or not str(url).startswith("https://"):
            continue
        title = page.get("title", "image")
        if _should_skip_image(title, mime, str(url)):
            continue
        alt = re.sub(r"^File:", "", title, flags=re.I).replace("_", " ")[:120]
        yield str(url), alt, title


def _collect_wikimedia_images(
    query: str, *, count: int, width: int = 960, user_message: str = ""
) -> list[tuple[str, str]]:
    ranked: list[tuple[float, str, str]] = []
    seen_urls: set[str] = set()
    for variant in _search_variants(query, user_message=user_message):
        for url, alt, title in _iter_wikimedia_commons(variant, width=width, limit=24):
            if url in seen_urls:
                continue
            seen_urls.add(url)
            score = _score_title(title, query)
            if score < 0:
                continue
            ranked.append((score, url, alt))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [(url, alt) for _, url, alt in ranked[:count]]


def _search_pixabay(query: str, *, count: int = 1) -> list[tuple[str, str]]:
    key = os.getenv("PIXABAY_API_KEY", "").strip()
    if not key:
        return []
    params = urllib.parse.urlencode(
        {
            "key": key,
            "q": query,
            "image_type": "photo",
            "orientation": "horizontal",
            "safesearch": "true",
            "per_page": "12",
        }
    )
    try:
        data = _http_get_json(f"{_PIXABAY_API}?{params}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        logger.warning("Pixabay image search failed: %s", e)
        return []

    ranked: list[tuple[float, str, str]] = []
    seen_urls: set[str] = set()
    for hit in data.get("hits") or []:
        url = hit.get("webformatURL") or hit.get("largeImageURL")
        if not url or not str(url).startswith("https://"):
            continue
        url = str(url)
        if url in seen_urls:
            continue
        seen_urls.add(url)
        tags = (hit.get("tags") or query)[:120]
        score = _score_title(tags, query)
        if score < 0:
            continue
        label = (hit.get("tags") or query).split(",")[0].strip() or query
        ranked.append((score, url, label[:120]))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [(url, alt) for _, url, alt in ranked[:count]]


def search_images_for_query(
    query: str,
    count: int = 1,
    *,
    user_message: str = "",
    is_harness: bool = False,
) -> list[tuple[str, str]]:
    """Return up to count (url, alt_text) pairs for a search query."""
    want = max(1, min(count, _MAX_IMAGES_PER_REPLY))
    if is_harness and user_message:
        from harness_images import harness_image_for_prompt

        fixed = harness_image_for_prompt(user_message)
        if fixed:
            logger.info(
                "Harness fixed image",
                extra={"image_query": query, "image_url": fixed[0]},
            )
            return [fixed]
    q = query.strip()
    if not q:
        return []
    if os.getenv("PIXABAY_API_KEY", "").strip():
        found = _search_pixabay(q, count=want)
        if found:
            logger.info(
                "Images from Pixabay",
                extra={"image_query": q, "image_count": len(found)},
            )
            return found
    found = _collect_wikimedia_images(q, count=want, user_message=user_message)
    if found:
        logger.info(
            "Images from Wikimedia Commons",
            extra={"image_query": q, "image_count": len(found)},
        )
        return found
    return _search_pixabay(q, count=want)


def search_image_for_query(query: str) -> tuple[str, str] | None:
    """Return (image_url, alt_text) for a search query, or None."""
    found = search_images_for_query(query, 1)
    return found[0] if found else None
