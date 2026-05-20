from agents.researcher import research_company
from agents.writer import write_email
from agents.critic_rewrite import critique_and_rewrite
from agents.related import find_related_businesses


async def run_pipeline(
    company_name: str,
    recipient_name: str | None = None,
    sender_name: str | None = None,
    context: str | None = None,
    suggest_related: bool = False,
):
    research = await research_company(company_name)
    related_businesses = (
        await find_related_businesses(company_name, context=context) if suggest_related else ""
    )
    draft = await write_email(
        research,
        recipient_name=recipient_name,
        sender_name=sender_name,
        context=context,
        related_businesses=related_businesses or None,
    )
    final = await critique_and_rewrite(
        draft,
        research,
        recipient_name=recipient_name,
        sender_name=sender_name,
        context=context,
    )
    return {
        "research": research,
        "related_businesses": related_businesses if suggest_related else None,
        "draft": draft,
        "final": final,
    }