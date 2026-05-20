import json
import os
import re
from dotenv import load_dotenv
from groq import Groq
from tavily import TavilyClient

load_dotenv()

tavily_client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))


async def find_related_businesses(company_name: str, context: str | None = None) -> str:
    """
    Pull a short list of adjacent/alternative businesses using web search results.
    This is meant as positioning context for cold emails (not claims of relationships).
    """
    extra = (context or "").strip()
    query = f"{company_name} competitors alternatives similar companies"
    if extra:
        query += f" {extra}"

    search = tavily_client.search(query=query, search_depth="basic", max_results=5)
    lines: list[str] = []
    for res in search.get("results", [])[:5]:
        title = res.get("title") or ""
        content = (res.get("content") or "").strip()
        url = res.get("url") or ""
        if title or content:
            line = title
            if content:
                line = f"{line}: {content}" if line else content
            if url:
                line = f"{line} ({url})"
            lines.append(line)

    if not lines:
        return f"No related-business search results found for {company_name}."

    return "\n".join(f"- {ln}" for ln in lines if ln)


def _strip_json_fence(raw: str) -> str:
    s = (raw or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"\s*```$", "", s)
    return s.strip()


async def resolve_target_companies(seed: str, context: str | None, count: int) -> list[str]:
    """
    Build the list of company names to run the pipeline against.
    First entry is always the seed; additional entries are competitors/adjacencies from search + LLM.
    """
    seed_clean = (seed or "").strip()
    if not seed_clean:
        return []
    n = max(1, min(int(count), 8))
    if n == 1:
        return [seed_clean]

    extra = (context or "").strip()
    query = f"{seed_clean} competitors alternatives similar companies products"
    if extra:
        query += f" {extra[:320]}"

    search = tavily_client.search(query=query, search_depth="basic", max_results=12)
    results = search.get("results", []) or []

    snippets: list[str] = []
    for res in results:
        title = res.get("title") or ""
        content = (res.get("content") or "").strip()
        if title or content:
            snippets.append(f"- {title}: {content[:400]}")

    blob = "\n".join(snippets) if snippets else "No search results."
    need = n - 1

    prompt = f"""You help sales development research. The user will run the same outreach for several companies.

Seed company (must NOT appear in your list): "{seed_clean}"
Shared outreach context (may be empty): "{extra}"

From the web snippets below, return exactly {need} distinct company or product brand names that are competitors, alternatives, or close market adjacencies to "{seed_clean}".

Rules:
- JSON array of {need} strings only. No markdown, no keys, no commentary.
- Each string: 1-4 words, recognizable business / product name.
- Do not include "{seed_clean}" or obvious spelling variants.

Snippets:
{blob}
"""

    names: list[str] = []
    try:
        resp = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        raw = _strip_json_fence(resp.choices[0].message.content or "")
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            for x in parsed:
                s = str(x).strip()
                if s and s.lower() != seed_clean.lower():
                    names.append(s)
    except Exception:
        names = []

    seen: set[str] = set()
    deduped: list[str] = []
    for nm in names:
        key = nm.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(nm)
    names = deduped[:need]

    if len(names) < need:
        fb = await find_related_businesses(seed_clean, context=context)
        for line in fb.split("\n"):
            line = line.strip().lstrip("-•* ").strip()
            if not line:
                continue
            part = line.split(":")[0].split("(")[0].strip()
            if (
                part
                and part.lower() != seed_clean.lower()
                and part.lower() not in seen
            ):
                seen.add(part.lower())
                names.append(part)
            if len(names) >= need:
                break

    out = [seed_clean]
    seen_out: set[str] = {seed_clean.lower()}
    for nm in names:
        if len(out) >= n:
            break
        k = nm.lower()
        if k in seen_out:
            continue
        seen_out.add(k)
        out.append(nm)

    # Fill remaining slots from article titles (last resort)
    while len(out) < n:
        added = False
        for res in results:
            title = (res.get("title") or "").strip()
            if not title:
                continue
            candidate = re.split(r"[\|–—\-]:\s*", title)[0].strip()
            candidate = re.sub(r"^\d+\.\s*", "", candidate)
            ck = candidate.lower()
            if (
                len(candidate) > 2
                and ck != seed_clean.lower()
                and ck not in seen_out
            ):
                seen_out.add(ck)
                out.append(candidate)
                added = True
                break
        if not added:
            peer = f"Peer {len(out)} ({seed_clean} market)"
            out.append(peer)
            seen_out.add(peer.lower())

    return out[:n]
