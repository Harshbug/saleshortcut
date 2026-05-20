import os
from dotenv import load_dotenv
from groq import Groq
import json
import re

load_dotenv()

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

async def critique_and_rewrite(
    draft: dict,
    research: str,
    recipient_name: str | None = None,
    sender_name: str | None = None,
    context: str | None = None,
) -> dict:
    recipient = (recipient_name or "").strip()
    sender = (sender_name or "").strip()
    extra = (context or "").strip()
    prompt = f"""Research: {research}
Draft: Subject: {draft['subject']} Body: {draft['body']}
Recipient name (use in greeting if provided): {recipient if recipient else "(not provided)"}
Sender name: {sender if sender else "[Your Name]"}
Extra context from user: {extra if extra else "(none)"}

Give scores (1-10) for Personalization, Clarity, Hook. Provide 2-3 fixes.
Rewrite email incorporating the extra context where relevant. If recipient name is provided, greet them by name. End with a signature using Sender name.

If any score is below 6, rewrite the section completely — do not
preserve the original structure or phrasing.

Return JSON:
{{"scores": {{"personalization":0-10,"clarity":0-10,"hook":0-10}},
  "critique_text": "feedback",
  "rewritten_email": {{"subject":"...","body":"..."}}
}}
"""
    resp = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.5,
        response_format={"type": "json_object"}
    )
    text = resp.choices[0].message.content.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.endswith("```"):
        text = text[:-3]
    return json.loads(text)