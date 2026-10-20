# SalesShortcut

SalesShortcut is an AI sales-development assistant. Give it a company name and it researches the company on the web, optionally finds competitors or adjacent businesses, drafts a personalized cold email, and then critiques and rewrites that draft. It can run for a single company or for a batch of up to 8 (the seed company plus competitors it discovers).

The backend is FastAPI with a staged agent pipeline, a local LLM served through Ollama, and Tavily for web search. Progress is streamed to a React frontend over Server-Sent Events.

## Features

- **Company research:** Tavily search results are summarized into a short brief with source URLs. The prompt tells the model to treat web content as evidence rather than instructions, and to say so when evidence is missing instead of inventing facts.
- **Related-business discovery:** Finds competitors and adjacent companies to use as positioning context in the email.
- **Batch mode:** Resolves up to 8 target companies from one seed and runs the full pipeline for each.
- **Personalized drafting:** Generates a subject and body using the research, recipient name, sender name, and optional user context. The recipient greeting is enforced in code rather than trusted to the model.
- **Critique and rewrite:** One LLM call scores the draft (personalization, clarity, hook, each 1-10), writes feedback, and returns a rewritten email.
- **Streaming:** `GET /generate-stream` emits progress events, research, drafts, and final results as SSE.
- **Defensive validation:** Tavily and LLM responses are checked for shape and type before use. Malformed JSON, empty fields, boolean scores, and out-of-range scores are rejected.
- **Safe streaming errors:** Internal exceptions are logged server-side. Clients only receive a generic error event.
- **Non-blocking I/O:** The synchronous Tavily and OpenAI SDK calls run in worker threads with a concurrency cap of 8, so they do not block the event loop.

## Architecture

```text
React (Vite)
    |
    |  POST /generate        (JSON)
    |  GET  /generate-stream (SSE)
    v
FastAPI (main.py)
    |
    +--> resolve_target_companies   (batch only: Tavily + LLM, seed always first)
    |
    v
for each target company:
    Research        Tavily search  ->  LLM research brief
    Related         Tavily search  ->  competitor list (only if suggest_related=true)
    Writer          LLM  ->  JSON {subject, body, reasoning}
    Critique+Rewrite LLM ->  JSON {scores, critique_text, rewritten_email}
```

Stages run sequentially for each company. Batch targets are processed one after another, not in parallel.

The critique and rewrite step is a single LLM call. It scores and rewrites in one pass. There is no score threshold and no iterative revision loop.

## Tech stack

| Layer | Tools |
|---|---|
| API | FastAPI, Pydantic, Uvicorn |
| LLM client | OpenAI Python SDK pointed at an Ollama endpoint |
| LLM runtime | Ollama (default models `llama3.1:8b` / `qwen3:8b`) |
| Web search | Tavily |
| Frontend | React, Vite, Tailwind CSS |
| Tests | pytest, pytest-cov |

## Project structure

```text
backend/
  main.py              FastAPI app, request model, /generate and /generate-stream
  orchestration.py     run_pipeline: research -> related -> write -> critique/rewrite
  agents/
    researcher.py      Tavily search + research brief
    related.py         related-business search and batch target resolution
    writer.py          email drafting and output validation
    critic_rewrite.py  scoring, critique, rewrite, output validation
    runtime.py         run_blocking: thread offload with concurrency cap
  tests/               65 pytest cases
frontend/              React + Vite UI
```

## Getting started

### Prerequisites

- Python 3.10+ and `pip`
- [Ollama](https://ollama.com) with a model pulled, for example `ollama pull llama3.1:8b`
- A [Tavily](https://tavily.com) API key
- Node.js, for the frontend

### Backend

```bash
git clone https://github.com/Harshbug/saleshortcut.git
cd saleshortcut

python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Create a `.env` file in `backend/`. Never commit it.

```dotenv
TAVILY_API_KEY=your_tavily_api_key
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_API_KEY=ollama
OLLAMA_MODEL=llama3.1:8b
OUTBOUND_REQUEST_TIMEOUT_SECONDS=30
```

Start the server:

```bash
cd backend
uvicorn main:app --reload
```

The API runs at `http://127.0.0.1:8000`, with interactive docs at `/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The UI runs at `http://localhost:5173`. The backend CORS config currently allows only this origin, and the frontend expects the API at `http://localhost:8000`.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/` | Health-style root response |
| `POST` | `/generate` | Run the pipeline and return the full result as JSON |
| `GET` | `/generate-stream` | Run the pipeline and stream progress as SSE |

### Request fields

`POST /generate` takes a JSON body. `GET /generate-stream` takes the same fields as query parameters.

| Field | Type | Notes |
|---|---|---|
| `company` | string | Required. Blank values are rejected with 400 on `/generate`. |
| `recipient_name` | string | Optional. Used for the greeting. |
| `sender_name` | string | Optional. Used for the signature. |
| `context` | string | Optional. Extra positioning or product context. |
| `suggest_related` | bool | Default `false`. Adds related-business context to the email. |
| `target_count` | int | Default `1`, allowed range 1-8. Out-of-range values get 422 on `/generate`. The stream endpoint clamps to 1-8 instead. |

### Example

```bash
curl -X POST http://127.0.0.1:8000/generate \
  -H "Content-Type: application/json" \
  -d '{"company": "Notion", "sender_name": "Harsh", "suggest_related": true}'
```

A single-company response contains `research`, `related_businesses`, `draft`, and `final`. A batch response contains `batch`, `targets`, and a `results` list with one entry per company.

### Stream events

The stream emits JSON payloads in `data:` lines. Event types:

`ping`, `batch_start`, `target_start`, `agent`, `research`, `related_businesses`, `draft`, `final`, `target_done`, `error`, `done`

On failure the stream sends one generic `error` event followed by `done`. Exception details stay in server logs.

## Testing

All 65 tests run without network access or a running LLM. Tavily and the OpenAI client are mocked.

```bash
cd backend
python -m pytest -q
```

Coverage, including branch coverage:

```bash
pip install pytest-cov
python -m pytest --cov=agents --cov=main --cov=orchestration --cov-branch --cov-report=term-missing
```

What the tests cover:

- **API:** request validation (blank company, missing company, `target_count` bounds and types), single and batch routing, and a check that streaming errors do not leak exception text.
- **Researcher:** blank input, empty or unusable search results, Tavily failures propagating, malformed Tavily and LLM responses, and handling of missing source URLs.
- **Writer:** invalid JSON, malformed or empty fields, non-string reasoning, and recipient placeholder replacement.
- **Critic and rewrite:** invalid drafts, malformed critic output, boolean and out-of-range scores, and empty rewritten fields.
- **Related businesses:** blank seeds, invalid search results, seed company kept first, and no invented peer names.
- **Runtime:** exception propagation and confirmation that blocking calls do not block the event loop.

These are unit tests with mocked dependencies. They verify validation and error handling. They do not measure the quality of generated emails.

## Known limitations

- Critique and rewrite is a single pass. Scores are reported but do not gate anything.
- Batch targets run sequentially, so latency grows with `target_count`.
- Competitor names come from an LLM reading search snippets, with a fallback that parses search-result titles. Results can be wrong and should be checked.
- Email quality depends heavily on the local model and hardware. Review every email before sending.
- There is no authentication, rate limiting, or caching. CORS is hard-coded to the local dev origin.
- The streaming endpoint's success path is not covered by automated tests.
