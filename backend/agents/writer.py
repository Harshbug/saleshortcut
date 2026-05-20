import os
from dotenv import load_dotenv
from groq import Groq
import json
import re

load_dotenv()

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

async def write_email(
    research: str,
    recipient_name: str | None = None,
    sender_name: str | None = None,
    context: str | None = None,
    related_businesses: str | None = None,
) -> dict:
    recipient = (recipient_name or "").strip()
    sender = (sender_name or "").strip()
    extra = (context or "").strip()
    related = (related_businesses or "").strip()
    prompt = f"""Research:
{research}

Recipient name (use in greeting if provided): {recipient if recipient else "(not provided)"}
Sender name: {sender if sender else "[Your Name]"}
Extra context from user (product, offer, ICP, tone, constraints, etc.):
{extra if extra else "(none)"}

Related businesses (web snippets for positioning only; may be imperfect):
{related if related else "(not provided)"}

Write a cold email (subject + body, <120 words).
You MUST reference at least one specific fact from the research
(recent news, product launch, acquisition, or milestone) directly
in the email body. Generic statements like 'I know you work in tech'
are strictly forbidden. If no specific fact is used, the email fails.

If recipient name is provided, greet them by name (e.g. "Hi Priya,"). Match tone to the extra context if provided.
If related businesses are provided, you may name at most ONE adjacent/alternative company for positioning
(e.g., "teams evaluating X vs Y") — do not imply partnerships, customers, or verified relationships.
End with a clear CTA. End the email with a signature using Sender name.
Return ONLY JSON:
{{"subject": "...", "body": "...", "reasoning": "..."}}
"""
    resp = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        response_format={"type": "json_object"}
    )
    text = resp.choices[0].message.content.strip()
    # Remove markdown if any
    if text.startswith("```json"):
        text = text[7:]
    if text.endswith("```"):
        text = text[:-3]
    return json.loads(text)