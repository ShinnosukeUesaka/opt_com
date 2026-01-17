import asyncio
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from api_sketch import Agent, CommunicationProtocol, Optimizer

app = FastAPI(title="Agent Protocol Demo", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    agent1_prompt: str
    agent2_prompt: str
    user_input: str
    protocol: str
    agent1_name: str = "Agent 1"
    agent2_name: str = "Agent 2"


class OptimizeRequest(BaseModel):
    agent1_prompt: str
    agent2_prompt: str
    protocol: str
    agent1_name: str = "Agent 1"
    agent2_name: str = "Agent 2"
    input_prompts: List[str] = Field(default_factory=list)
    rounds: int = Field(default=3, ge=1, le=10)
    variation_count: int = Field(default=5, ge=1, le=20)
    entry_agent: Optional[str] = None


class TTSRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    model_id: Optional[str] = None
    output_format: Optional[str] = None


DEFAULT_VOICE_ID = "onwK4e9ZLuTAKqWW03F9"
DEFAULT_MODEL_ID = "eleven_multilingual_v2"
DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"


def fetch_tts_audio(url: str, api_key: str, payload: dict) -> tuple[bytes, Optional[str]]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "xi-api-key": api_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read(), response.headers.get("Content-Type")


def build_agents(req: RunRequest) -> CommunicationProtocol:
    agent1 = Agent(role=req.agent1_prompt, name=req.agent1_name)
    agent2 = Agent(role=req.agent2_prompt, name=req.agent2_name)
    return CommunicationProtocol(req.protocol, [agent1, agent2])


@app.post("/api/run")
async def run_once(req: RunRequest):
    protocol = build_agents(req)
    agent1 = protocol.agents[0]

    events = []

    async def observer(event):
        events.append(event)

    final_text, communication_tokens = await agent1.run(
        req.user_input,
        observer=observer,
    )
    return {
        "final": final_text,
        "communication_tokens": communication_tokens,
        "events": events,
    }


@app.post("/api/run/stream")
async def run_stream(req: RunRequest):
    protocol = build_agents(req)
    agent1 = protocol.agents[0]

    queue: asyncio.Queue = asyncio.Queue()

    async def observer(event):
        await queue.put(event)

    async def runner():
        try:
            final_text, communication_tokens = await agent1.run(
                req.user_input,
                observer=observer,
            )
            await queue.put(
                {
                    "type": "final",
                    "from": agent1.name,
                    "message": final_text,
                    "tokens": communication_tokens,
                }
            )
        except Exception as exc:  # noqa: BLE001
            await queue.put({"type": "error", "message": str(exc)})
        finally:
            await queue.put(None)

    asyncio.create_task(runner())

    async def event_generator():
        while True:
            item = await queue.get()
            if item is None:
                break
            yield {"event": "message", "data": json.dumps(item)}

    return EventSourceResponse(event_generator())


@app.post("/api/tts")
async def text_to_speech(req: TTSRequest):
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY is not set")
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    voice_id = req.voice_id or os.getenv("ELEVENLABS_VOICE_ID", DEFAULT_VOICE_ID)
    model_id = req.model_id or os.getenv("ELEVENLABS_MODEL_ID", DEFAULT_MODEL_ID)
    output_format = req.output_format or os.getenv(
        "ELEVENLABS_OUTPUT_FORMAT",
        DEFAULT_OUTPUT_FORMAT,
    )

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    if output_format:
        url = f"{url}?output_format={urllib.parse.quote(output_format)}"

    payload = {"text": req.text, "model_id": model_id}
    try:
        audio_bytes, content_type = await asyncio.to_thread(
            fetch_tts_audio,
            url,
            api_key,
            payload,
        )
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(
            status_code=exc.code,
            detail=detail or "ElevenLabs request failed",
        ) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail="Failed to reach ElevenLabs",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail="Failed to generate audio",
        ) from exc

    return Response(content=audio_bytes, media_type=content_type or "audio/mpeg")


@app.post("/api/optimize")
async def optimize(req: OptimizeRequest):
    if not req.input_prompts:
        raise HTTPException(status_code=400, detail="input_prompts is required")
    run_req = RunRequest(
        agent1_prompt=req.agent1_prompt,
        agent2_prompt=req.agent2_prompt,
        protocol=req.protocol,
        user_input=req.input_prompts[0],
        agent1_name=req.agent1_name,
        agent2_name=req.agent2_name,
    )
    protocol = build_agents(run_req)
    optimizer = Optimizer(
        communication_protocal=protocol,
        variation_count=req.variation_count,
        rounds=req.rounds,
    )
    if req.entry_agent:
        for agent in protocol.agents:
            if agent.name == req.entry_agent:
                optimizer.entry_agent = agent
                break

    best_node = await optimizer.optimize(
        input_prompts=req.input_prompts,
        rounds=req.rounds,
        variation_count=req.variation_count,
    )
    return {
        "best_node": best_node.as_dict(),
        "best_path": optimizer.best_path,
        "tree": optimizer.tree_as_dicts(),
        "best_rule": best_node.rule,
    }


@app.post("/api/optimize/stream")
async def optimize_stream(req: OptimizeRequest):
    if not req.input_prompts:
        raise HTTPException(status_code=400, detail="input_prompts is required")
    run_req = RunRequest(
        agent1_prompt=req.agent1_prompt,
        agent2_prompt=req.agent2_prompt,
        protocol=req.protocol,
        user_input=req.input_prompts[0],
        agent1_name=req.agent1_name,
        agent2_name=req.agent2_name,
    )
    protocol = build_agents(run_req)
    optimizer = Optimizer(
        communication_protocal=protocol,
        variation_count=req.variation_count,
        rounds=req.rounds,
    )
    if req.entry_agent:
        for agent in protocol.agents:
            if agent.name == req.entry_agent:
                optimizer.entry_agent = agent
                break

    async def event_generator():
        try:
            async for event in optimizer.optimize_events(
                input_prompts=req.input_prompts,
                rounds=req.rounds,
                variation_count=req.variation_count,
            ):
                yield {"event": "message", "data": json.dumps(event)}
        except Exception as exc:  # noqa: BLE001
            yield {"event": "message", "data": json.dumps({"type": "error", "message": str(exc)})}

    return EventSourceResponse(event_generator())
