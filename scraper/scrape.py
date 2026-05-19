#!/usr/bin/env python3
"""
JobFinder scraper — pulls creative, AI, game dev, and film jobs from:
  - Remotive.io (free API)
  - Jobicy.com (free API)
  - Greenhouse.io (public company boards)
  - Lever.co (public company boards)
  - Arbeitnow (free API)

Outputs: data/jobs.json
"""

import json
import re
import time
import hashlib
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; JobFinder/1.0; +https://github.com/joshuaopel/jobfinder)"
})

OUT_FILE = Path(__file__).parent.parent / "data" / "jobs.json"

# ─────────────────────────────────────────────────────────────────────────────
# KEYWORD FILTERS — only keep jobs matching at least one keyword per category
# ─────────────────────────────────────────────────────────────────────────────
CATEGORY_KEYWORDS = {
    "game_dev": [
        "game", "unity", "unreal", "gameplay", "level design", "game design",
        "game developer", "game artist", "game engineer", "technical artist",
        "game producer", "game writer", "narrative designer", "narrative design",
        "qa tester", "game tester", "environment artist", "concept artist",
        "character artist", "vfx artist", "rigging", "animation director",
        "live ops", "game economy", "esports", "game ui", "gamer",
    ],
    "ai_tech": [
        "ai ", "artificial intelligence", "machine learning", " ml ", "llm",
        "large language model", "nlp", "natural language", "prompt engineer",
        "generative ai", "deep learning", "computer vision", "diffusion",
        "data scientist", "ai researcher", "ai engineer", "ai artist",
        "ai product", "foundation model", "reinforcement learning",
        "stable diffusion", "midjourney", "imagen", "gpt", "ai content",
        "ai tools", "creative ai", "synthetic data",
    ],
    "film": [
        "film", "vfx", "visual effects", "compositor", "compositing",
        "cinematograph", "production designer", "motion picture", "feature film",
        "episodic", "animation director", "cg supervisor", "td ", "technical director",
        "lookdev", "lighting artist", "fx artist", "matte paint", "rotoscop",
        "color grading", "colorist", "color scientist", "pipeline td",
        "layout artist", "production coordinator film",
    ],
    "creative": [
        "creative director", "art director", "motion design", "motion graphic",
        "graphic designer", "brand designer", "visual designer", "animator",
        "3d artist", "3d generalist", "illustrator", "ui designer", "ux designer",
        "product designer", "interaction designer", "content creator",
        "copywriter", "creative strategist", "creative producer",
        "video editor", "video producer", "social media creative",
        "creative technologist", "experiential", "immersive",
    ],
}

ALL_KEYWORDS = [kw for kws in CATEGORY_KEYWORDS.values() for kw in kws]

LOCATION_KEYWORDS_REMOTE = [
    "remote", "anywhere", "distributed", "work from home", "wfh", "globally"
]
LOCATION_KEYWORDS_DALLAS = [
    "dallas", " tx ", "texas", "dfw", "fort worth", "plano", "frisco",
    "irving", "mckinney", "richardson"
]


def make_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:16]


def categorize(title: str, description: str) -> str:
    text = (title + " " + description).lower()
    scores = {cat: 0 for cat in CATEGORY_KEYWORDS}
    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                scores[cat] += 1
    best = max(scores, key=lambda c: scores[c])
    return best if scores[best] > 0 else "other"


def location_type(location: str, description: str = "") -> str:
    text = (location + " " + description).lower()
    if any(k in text for k in LOCATION_KEYWORDS_DALLAS):
        return "dallas"
    if any(k in text for k in LOCATION_KEYWORDS_REMOTE):
        return "remote"
    return "onsite"


def is_relevant(title: str, description: str) -> bool:
    text = (title + " " + description).lower()
    return any(kw in text for kw in ALL_KEYWORDS)


def extract_tags(title: str, description: str) -> list[str]:
    """Heuristically extract skill keywords mentioned in the text."""
    SKILL_PATTERNS = [
        "Python", "C++", "C#", "JavaScript", "TypeScript", "Rust", "Go",
        "Unity", "Unreal Engine", "Godot", "Blender", "Maya", "Houdini",
        "Nuke", "After Effects", "Cinema 4D", "ZBrush", "Substance",
        "Figma", "Photoshop", "Illustrator", "Premiere", "DaVinci Resolve",
        "PyTorch", "TensorFlow", "JAX", "ONNX", "CUDA",
        "AI", "Machine Learning", "LLM", "NLP", "VFX", "Motion Graphics",
        "3D", "Animation", "Rigging", "Compositing", "HLSL", "GLSL",
        "Niagara", "Blueprints", "Perforce", "Git", "USD", "Husk",
        "Remote", "Unreal", "Game Design", "Narrative", "Prompt Engineering",
        "Generative AI", "Stable Diffusion", "LoRA",
    ]
    text = title + " " + description
    found = []
    for skill in SKILL_PATTERNS:
        if re.search(r'\b' + re.escape(skill) + r'\b', text, re.IGNORECASE):
            found.append(skill)
    return found[:10]


def strip_html(html: str) -> str:
    text = re.sub(r'<br\s*/?>', '\n', html, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&gt;', '>', text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&#39;', "'", text)
    text = re.sub(r'&quot;', '"', text)
    text = re.sub(r'\s{3,}', '\n\n', text)
    return text.strip()


def get(url: str, **kwargs) -> Optional[dict]:
    try:
        r = SESSION.get(url, timeout=15, **kwargs)
        if r.status_code == 200:
            return r.json()
        log.warning("  %s → HTTP %s", url[:80], r.status_code)
    except Exception as e:
        log.warning("  %s → %s", url[:80], e)
    return None


# ─────────────────────────────────────────────────────────────────────────────
# SOURCE: REMOTIVE
# ─────────────────────────────────────────────────────────────────────────────
REMOTIVE_SEARCHES = [
    ("software-dev", "game"),
    ("software-dev", "ai"),
    ("software-dev", "creative"),
    ("design", ""),
    ("design", "game"),
    ("design", "ai"),
    ("writing", ""),
    ("marketing", "creative"),
]


def scrape_remotive() -> list[dict]:
    jobs = []
    seen = set()
    for category, search in REMOTIVE_SEARCHES:
        url = f"https://remotive.com/api/remote-jobs?category={category}&search={search}&limit=50"
        data = get(url)
        if not data:
            continue
        for j in data.get("jobs", []):
            jid = str(j.get("id", ""))
            if jid in seen:
                continue
            seen.add(jid)
            title = j.get("title", "")
            desc = strip_html(j.get("description", ""))
            if not is_relevant(title, desc):
                continue
            loc = j.get("candidate_required_location", "Remote")
            jobs.append({
                "id": make_id(j.get("url", jid)),
                "title": title,
                "company": j.get("company_name", ""),
                "location": loc,
                "location_type": location_type(loc),
                "category": categorize(title, desc),
                "source": "remotive",
                "url": j.get("url", ""),
                "description": desc[:3000],
                "tags": extract_tags(title, desc),
                "posted_date": j.get("publication_date", ""),
                "salary_range": j.get("salary", None),
            })
        time.sleep(0.5)
    log.info("Remotive: %d jobs", len(jobs))
    return jobs


# ─────────────────────────────────────────────────────────────────────────────
# SOURCE: JOBICY
# ─────────────────────────────────────────────────────────────────────────────
JOBICY_TAGS = ["ai", "game", "design", "creative", "animation", "vfx", "film", "video"]


def scrape_jobicy() -> list[dict]:
    jobs = []
    seen = set()
    for tag in JOBICY_TAGS:
        url = f"https://jobicy.com/api/v2/remote-jobs?count=50&tag={tag}"
        data = get(url)
        if not data:
            continue
        for j in data.get("jobs", []):
            jid = str(j.get("id", ""))
            if jid in seen:
                continue
            seen.add(jid)
            title = j.get("jobTitle", "")
            desc = strip_html(j.get("jobDescription", ""))
            if not is_relevant(title, desc):
                continue
            loc = j.get("jobGeo", "Remote")
            jobs.append({
                "id": make_id(j.get("url", jid)),
                "title": title,
                "company": j.get("companyName", ""),
                "location": loc,
                "location_type": location_type(loc),
                "category": categorize(title, desc),
                "source": "jobicy",
                "url": j.get("url", ""),
                "description": desc[:3000],
                "tags": extract_tags(title, desc),
                "posted_date": j.get("pubDate", ""),
                "salary_range": j.get("annualSalaryMin") and
                    f"${j['annualSalaryMin']:,}–${j.get('annualSalaryMax','?'):,}",
            })
        time.sleep(0.5)
    log.info("Jobicy: %d jobs", len(jobs))
    return jobs


# ─────────────────────────────────────────────────────────────────────────────
# SOURCE: GREENHOUSE
# ─────────────────────────────────────────────────────────────────────────────
GREENHOUSE_COMPANIES = {
    # Game Dev
    "epicgames":          {"name": "Epic Games",          "cat": "game_dev"},
    "riotgames":          {"name": "Riot Games",           "cat": "game_dev"},
    "bungie":             {"name": "Bungie",               "cat": "game_dev"},
    "roblox":             {"name": "Roblox",               "cat": "game_dev"},
    "discord":            {"name": "Discord",              "cat": "game_dev"},
    "unity-technologies": {"name": "Unity Technologies",   "cat": "game_dev"},
    "niantic":            {"name": "Niantic",              "cat": "game_dev"},
    "zynga":              {"name": "Zynga",                "cat": "game_dev"},
    "scopely":            {"name": "Scopely",              "cat": "game_dev"},
    "kabam":              {"name": "Kabam",                "cat": "game_dev"},
    "moonactivegames":    {"name": "Moon Active",          "cat": "game_dev"},
    "warnerbros":         {"name": "Warner Bros. Games",   "cat": "game_dev"},
    "2k":                 {"name": "2K",                   "cat": "game_dev"},
    "gearbox":            {"name": "Gearbox Software",     "cat": "game_dev"},
    "techland":           {"name": "Techland",             "cat": "game_dev"},
    "kingcom":            {"name": "King",                 "cat": "game_dev"},
    "supercell":          {"name": "Supercell",            "cat": "game_dev"},
    # AI / Tech
    "anthropic":          {"name": "Anthropic",            "cat": "ai_tech"},
    "openai":             {"name": "OpenAI",               "cat": "ai_tech"},
    "midjourney":         {"name": "Midjourney",           "cat": "ai_tech"},
    "adobe":              {"name": "Adobe",                "cat": "ai_tech"},
    "nvidia":             {"name": "NVIDIA",               "cat": "ai_tech"},
    "huggingface":        {"name": "Hugging Face",         "cat": "ai_tech"},
    "runway":             {"name": "Runway",               "cat": "ai_tech"},
    "stability":          {"name": "Stability AI",         "cat": "ai_tech"},
    "elevenlabs":         {"name": "ElevenLabs",           "cat": "ai_tech"},
    "pika-labs":          {"name": "Pika",                 "cat": "ai_tech"},
    "ideogram-ai":        {"name": "Ideogram",             "cat": "ai_tech"},
    # Creative / Film
    "netflix":            {"name": "Netflix",              "cat": "film"},
    "pixar":              {"name": "Pixar",                "cat": "film"},
    "dreamworks":         {"name": "DreamWorks Animation", "cat": "film"},
    "ilm":                {"name": "ILM",                  "cat": "film"},
    "dneg":               {"name": "DNEG",                 "cat": "film"},
    "weta":               {"name": "Weta FX",              "cat": "film"},
    # Dallas-area tech
    "at-t":               {"name": "AT&T",                 "cat": "ai_tech"},
    "gamestop":           {"name": "GameStop",             "cat": "game_dev"},
}


def scrape_greenhouse() -> list[dict]:
    jobs = []
    for slug, meta in GREENHOUSE_COMPANIES.items():
        url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
        data = get(url)
        if not data:
            time.sleep(0.3)
            continue
        for j in data.get("jobs", []):
            title = j.get("title", "")
            desc = strip_html(j.get("content", ""))
            if not is_relevant(title, desc):
                continue
            loc_raw = j.get("location", {}).get("name", "") or ""
            jobs.append({
                "id": make_id(j.get("absolute_url", str(j.get("id", "")))),
                "title": title,
                "company": meta["name"],
                "location": loc_raw,
                "location_type": location_type(loc_raw, desc),
                "category": categorize(title, desc) if categorize(title, desc) != "other" else meta["cat"],
                "source": "greenhouse",
                "url": j.get("absolute_url", ""),
                "description": desc[:3000],
                "tags": extract_tags(title, desc),
                "posted_date": j.get("updated_at", ""),
                "salary_range": None,
            })
        time.sleep(0.4)
    log.info("Greenhouse: %d jobs", len(jobs))
    return jobs


# ─────────────────────────────────────────────────────────────────────────────
# SOURCE: LEVER
# ─────────────────────────────────────────────────────────────────────────────
LEVER_COMPANIES = {
    "respawn":            {"name": "Respawn Entertainment", "cat": "game_dev"},
    "ea":                 {"name": "Electronic Arts",       "cat": "game_dev"},
    "naughty-dog":        {"name": "Naughty Dog",           "cat": "game_dev"},
    "insomniacgames":     {"name": "Insomniac Games",       "cat": "game_dev"},
    "sledgehammergames":  {"name": "Sledgehammer Games",    "cat": "game_dev"},
    "highmoonstudios":    {"name": "High Moon Studios",     "cat": "game_dev"},
    "treyarch":           {"name": "Treyarch",              "cat": "game_dev"},
    "obsidian":           {"name": "Obsidian Entertainment","cat": "game_dev"},
    "doublefine":         {"name": "Double Fine",           "cat": "game_dev"},
    "square-enix-na":     {"name": "Square Enix NA",        "cat": "game_dev"},
    "nexon":              {"name": "Nexon",                  "cat": "game_dev"},
    "ubisoft":            {"name": "Ubisoft",               "cat": "game_dev"},
    # AI / Creative
    "cohere":             {"name": "Cohere",                "cat": "ai_tech"},
    "adept":              {"name": "Adept",                 "cat": "ai_tech"},
    "character-ai":       {"name": "Character.AI",          "cat": "ai_tech"},
    "typeface":           {"name": "Typeface",              "cat": "ai_tech"},
    "photoroom":          {"name": "Photoroom",             "cat": "ai_tech"},
    # Film
    "framestore":         {"name": "Framestore",            "cat": "film"},
    "method-studios":     {"name": "Method Studios",        "cat": "film"},
    "scanline-vfx":       {"name": "Scanline VFX",          "cat": "film"},
}


def scrape_lever() -> list[dict]:
    jobs = []
    for slug, meta in LEVER_COMPANIES.items():
        url = f"https://api.lever.co/v0/postings/{slug}?mode=json"
        data = get(url)
        if not data or not isinstance(data, list):
            time.sleep(0.3)
            continue
        for j in data:
            title = j.get("text", "")
            desc_parts = j.get("descriptionPlain", "") or ""
            desc = strip_html(desc_parts)[:3000]
            if not is_relevant(title, desc):
                continue
            loc_raw = j.get("categories", {}).get("location", "") or j.get("workplaceType", "")
            jobs.append({
                "id": make_id(j.get("hostedUrl", j.get("id", ""))),
                "title": title,
                "company": meta["name"],
                "location": loc_raw,
                "location_type": location_type(loc_raw, desc),
                "category": categorize(title, desc) if categorize(title, desc) != "other" else meta["cat"],
                "source": "lever",
                "url": j.get("hostedUrl", ""),
                "description": desc,
                "tags": extract_tags(title, desc),
                "posted_date": datetime.fromtimestamp(
                    j.get("createdAt", 0) / 1000, tz=timezone.utc
                ).isoformat() if j.get("createdAt") else "",
                "salary_range": None,
            })
        time.sleep(0.4)
    log.info("Lever: %d jobs", len(jobs))
    return jobs


# ─────────────────────────────────────────────────────────────────────────────
# SOURCE: ARBEITNOW (remote-first, EU + US)
# ─────────────────────────────────────────────────────────────────────────────
def scrape_arbeitnow() -> list[dict]:
    jobs = []
    url = "https://www.arbeitnow.com/api/job-board-api?page=1"
    for page in range(1, 4):
        data = get(f"https://www.arbeitnow.com/api/job-board-api?page={page}")
        if not data:
            break
        for j in data.get("data", []):
            title = j.get("title", "")
            desc = strip_html(j.get("description", ""))
            if not is_relevant(title, desc):
                continue
            loc = "Remote" if j.get("remote") else j.get("location", "")
            jobs.append({
                "id": make_id(j.get("url", j.get("slug", ""))),
                "title": title,
                "company": j.get("company_name", ""),
                "location": loc,
                "location_type": "remote" if j.get("remote") else location_type(loc),
                "category": categorize(title, desc),
                "source": "arbeitnow",
                "url": j.get("url", ""),
                "description": desc[:3000],
                "tags": extract_tags(title, desc) + j.get("tags", [])[:5],
                "posted_date": j.get("created_at", ""),
                "salary_range": None,
            })
        time.sleep(0.5)
    log.info("Arbeitnow: %d jobs", len(jobs))
    return jobs


# ─────────────────────────────────────────────────────────────────────────────
# DEDUPLICATION
# ─────────────────────────────────────────────────────────────────────────────
def dedup(jobs: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for j in jobs:
        key = j["id"]
        if key not in seen:
            seen.add(key)
            out.append(j)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
def main():
    log.info("=== JobFinder Scraper starting ===")
    all_jobs = []

    log.info("Scraping Remotive…")
    all_jobs += scrape_remotive()

    log.info("Scraping Jobicy…")
    all_jobs += scrape_jobicy()

    log.info("Scraping Greenhouse…")
    all_jobs += scrape_greenhouse()

    log.info("Scraping Lever…")
    all_jobs += scrape_lever()

    log.info("Scraping Arbeitnow…")
    all_jobs += scrape_arbeitnow()

    all_jobs = dedup(all_jobs)
    all_jobs.sort(key=lambda j: j.get("posted_date", ""), reverse=True)

    source_counts = {}
    for j in all_jobs:
        source_counts[j["source"]] = source_counts.get(j["source"], 0) + 1

    output = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "job_count": len(all_jobs),
        "sources": source_counts,
        "jobs": all_jobs,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    log.info("=== Done: %d jobs written to %s ===", len(all_jobs), OUT_FILE)
    for src, n in sorted(source_counts.items(), key=lambda x: -x[1]):
        log.info("  %-15s %d", src, n)


if __name__ == "__main__":
    main()
