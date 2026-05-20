import os
from dotenv import load_dotenv
from tavily import TavilyClient
from groq import Groq

load_dotenv()

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
tavily_client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))

async def research_company(company_name: str) -> str:
    # Search web
    search = tavily_client.search(
        query=f"{company_name} company news products",
        search_depth="basic",
        max_results=5
    )
    content = ""
    for res in search.get("results", []):
        content += f"Title: {res.get('title')}\nContent: {res.get('content')}\n\n"
    if not content:
        content = f"No live data for {company_name}. Use general knowledge."

    prompt = f"""Summarize the following about {company_name}:
1. What they do
2. Industry & size
3. Recent news (last 3 months)
4. Two likely pain points for sales outreach

{content}

Return plain text only, under 250 words."""
    resp = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3
    )
    return resp.choices[0].message.content

