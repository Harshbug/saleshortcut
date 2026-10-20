
import asyncio
import json
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from orchestration import run_pipeline
from agents.researcher import research_company
from agents.writer import write_email
from agents.critic_rewrite import critique_and_rewrite
from agents.related import find_related_businesses, resolve_target_companies


load_dotenv()

logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CompanyRequest(BaseModel):
    company: str
    recipient_name: str | None = None
    sender_name: str | None = None
    context: str | None = None
    suggest_related: bool = False
    target_count: int = Field(default=1, ge=1, le=8)


@app.get("/")
def root():
    return {"message": "SDR Agent API ready"}


@app.post("/generate")
async def generate(request: CompanyRequest):
    seed = request.company.strip()

    if not seed:
        raise HTTPException(
            status_code=400,
            detail="company is required",
        )

    if request.target_count <= 1:
        return await run_pipeline(
            seed,
            recipient_name=request.recipient_name,
            sender_name=request.sender_name,
            context=request.context,
            suggest_related=request.suggest_related,
        )

    targets = await resolve_target_companies(
        seed,
        request.context,
        request.target_count,
    )

    results = []

    for company in targets:
        result = await run_pipeline(
            company,
            recipient_name=request.recipient_name,
            sender_name=request.sender_name,
            context=request.context,
            suggest_related=request.suggest_related,
        )

        results.append({
            "company": company,
            **result,
        })

    return {
        "batch": True,
        "targets": targets,
        "results": results,
    }


@app.get("/generate-stream")
async def generate_stream(
    company: str,
    recipient_name: str | None = None,
    sender_name: str | None = None,
    context: str | None = None,
    suggest_related: bool = False,
    target_count: int = 1,
):
    async def event_gen():
        def sse(payload):
            return (
                f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            )

        try:
            yield sse({"type": "ping"})

            target_count_safe = max(
                1,
                min(int(target_count or 1), 8),
            )

            targets = await resolve_target_companies(
                company,
                context,
                target_count_safe,
            )

            yield sse({
                "type": "batch_start",
                "targets": targets,
                "total": len(targets),
            })

            for index, target_company in enumerate(targets):
                yield sse({
                    "type": "target_start",
                    "index": index,
                    "company": target_company,
                    "total": len(targets),
                })

                await asyncio.sleep(0.02)

                yield sse({
                    "type": "agent",
                    "name": "researcher",
                    "status": "started",
                })

                await asyncio.sleep(0.05)

                research = await research_company(target_company)

                yield sse({
                    "type": "research",
                    "content": research,
                    "target_index": index,
                    "target_company": target_company,
                })

                related_businesses = ""

                if suggest_related:
                    related_businesses = await find_related_businesses(
                        target_company,
                        context=context,
                    )

                    yield sse({
                        "type": "related_businesses",
                        "content": related_businesses,
                        "target_index": index,
                        "target_company": target_company,
                    })

                yield sse({
                    "type": "agent",
                    "name": "writer",
                    "status": "started",
                })

                await asyncio.sleep(0.05)

                draft = await write_email(
                    research,
                    recipient_name=recipient_name,
                    sender_name=sender_name,
                    context=context,
                    related_businesses=related_businesses or None,
                )

                yield sse({
                    "type": "draft",
                    "content": {
                        "subject": draft.get("subject"),
                        "body": draft.get("body"),
                    },
                    "target_index": index,
                    "target_company": target_company,
                })

                yield sse({
                    "type": "agent",
                    "name": "critic",
                    "status": "started",
                })

                await asyncio.sleep(0.05)

                yield sse({
                    "type": "agent",
                    "name": "rewriter",
                    "status": "started",
                })

                await asyncio.sleep(0.05)

                final = await critique_and_rewrite(
                    draft,
                    research,
                    recipient_name=recipient_name,
                    sender_name=sender_name,
                    context=context,
                )

                yield sse({
                    "type": "final",
                    "content": final,
                    "target_index": index,
                    "target_company": target_company,
                })

                yield sse({
                    "type": "target_done",
                    "index": index,
                    "company": target_company,
                    "total": len(targets),
                })

            yield sse({"type": "done"})

        except Exception:
            # Keep the traceback in server logs, not in the API response.
            logger.exception("Streaming generation failed")

            yield sse({
                "type": "error",
                "message": "Generation failed. Please try again.",
            })

            yield sse({"type": "done"})

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
