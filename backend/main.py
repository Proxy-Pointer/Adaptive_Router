from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
import logging
from dotenv import load_dotenv

load_dotenv()

from router.model_router import ModelRouter, PlanStep

logger = logging.getLogger(__name__)

app = FastAPI(title="Adaptive Agent Model Router")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router_instance = ModelRouter()

# The 4 pipeline agents and their roles (used by the analyzer)
PIPELINE_AGENTS = [
    ("researcher", "Gathers information — web searches, data collection, fact-finding, and source retrieval relevant to the query"),
    ("analyst",   "Analyses the gathered research — pattern recognition, statistical analysis, interpreting evidence, and drawing data-backed conclusions"),
    ("critic",    "Reviews the analysis critically — identifies weaknesses, logical gaps, alternative interpretations, and validates the reasoning chain"),
    ("reporter",  "Synthesizes everything into a final deliverable — executive summary, structured findings, and actionable recommendations"),
]

# ─────────────────────────────────────────────────────────
# Request models
# ─────────────────────────────────────────────────────────

class RouteRequest(BaseModel):
    agent: str
    task: str

class AnalyzeRequest(BaseModel):
    query: str

# ─────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────

class PlanRouteRequest(BaseModel):
    agent: str
    query: str

AGENT_ROLES = {
    "researcher": "Gathers, searches, and synthesizes information — web searches, data collection, fact-finding",
    "analyst":    "Analyses the gathered research — pattern recognition, drawing evidence-based conclusions",
    "critic":     "Reviews analysis critically — identifies weaknesses and validates reasoning",
    "reporter":   "Synthesises everything into a final structured report with recommendations",
}

@app.post("/api/route")
def route_task(req: RouteRequest):
    """Playground: route a single task and return real classification + token estimates + cost."""
    try:
        result = router_instance.route(req.task, agent_name=req.agent)
        return result.model_dump()
    except Exception as e:
        logger.error(f"/api/route error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/plan-route")
def plan_route(req: PlanRouteRequest):
    """
    Playground (detailed): generate a plan for one agent, analyze each step,
    return per-step token/cost breakdown + aggregate totals.
    """
    try:
        role = AGENT_ROLES.get(req.agent, "Performs general analysis")
        steps = router_instance.generate_agent_plan(req.agent, role, req.query)
        
        results = []
        base_input = None
        for step in steps:
            # Researcher steps are evaluated independently; others share the same context
            override_input = None if req.agent == "researcher" else base_input
            res = router_instance.analyze_step(step, req.query, base_input_tokens=override_input).model_dump()
            
            if req.agent != "researcher" and base_input is None:
                base_input = res["estimated_input_tokens"]
            results.append(res)

        total_input  = sum(r["estimated_input_tokens"]  for r in results)
        total_output = sum(r["estimated_output_tokens"] for r in results)
        total_cost   = round(sum(r["cost_usd"] for r in results), 8)
        max_score    = max(r["routing_score"] for r in results)
        rec_tier     = router_instance._tier(max_score)
        rec_model    = router_instance._model_name(rec_tier)

        return {
            "steps": results,
            "total_input_tokens":  total_input,
            "total_output_tokens": total_output,
            "total_cost":          total_cost,
            "recommended_tier":    rec_tier,
            "recommended_model":   rec_model,
            "max_routing_score":   max_score,
        }
    except Exception as e:
        logger.error(f"/api/plan-route error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/plan-route/stream")
async def plan_route_stream(req: PlanRouteRequest):
    """
    Playground (streaming): same as /api/plan-route but yields each step
    result as an SSE event as soon as it is analyzed, then a final summary.
    """
    async def event_generator():
        try:
            role = AGENT_ROLES.get(req.agent, "Performs general analysis")
            steps = await asyncio.to_thread(
                router_instance.generate_agent_plan, req.agent, role, req.query
            )
            # Signal how many steps are coming so the UI can render placeholders
            yield f"data: {json.dumps({'event': 'plan', 'steps': [s.model_dump() for s in steps]})}\n\n"

            results = []
            base_input = None
            for step in steps:
                override_input = None if req.agent == "researcher" else base_input
                try:
                    res = await asyncio.to_thread(
                        router_instance.analyze_step, step, req.query,
                        base_input_tokens=override_input
                    )
                    r = res.model_dump()
                    if req.agent != "researcher" and base_input is None:
                        base_input = r["estimated_input_tokens"]
                    results.append(r)
                    yield f"data: {json.dumps({'event': 'step_result', **r})}\n\n"
                except Exception as e:
                    logger.error(f"plan-route/stream step failed: {e}")
                    yield f"data: {json.dumps({'event': 'step_error', 'name': step.name, 'message': str(e)})}\n\n"

            if results:
                total_input  = sum(r["estimated_input_tokens"]  for r in results)
                total_output = sum(r["estimated_output_tokens"] for r in results)
                total_cost   = round(sum(r["cost_usd"] for r in results), 8)
                max_score    = max(r["routing_score"] for r in results)
                rec_tier     = router_instance._tier(max_score)
                rec_model    = router_instance._model_name(rec_tier)
                yield f"data: {json.dumps({'event': 'complete', 'total_input_tokens': total_input, 'total_output_tokens': total_output, 'total_cost': total_cost, 'recommended_tier': rec_tier, 'recommended_model': rec_model, 'max_routing_score': max_score})}\n\n"
        except Exception as e:
            logger.error(f"/api/plan-route/stream error: {e}")
            yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")



@app.post("/api/analyze")
async def analyze_query(req: AnalyzeRequest):
    """
    Full pipeline: iterate Researcher → Analyst → Critic → Reporter.
    For each agent, generate real sub-tasks via LLM, then route + cost each one.
    Streams SSE events to the frontend.
    """
    async def event_generator():
        total_cost = 0.0
        base_query_tokens = 500  # Approx tokens for the system prompt + user query
        
        # Track total output tokens per agent
        agent_outputs = {"researcher": 0, "analyst": 0, "critic": 0, "reporter": 0}

        for agent_name, agent_role in PIPELINE_AGENTS:
            # Signal agent is starting (planning its tasks)
            yield f"data: {json.dumps({'event': 'agent_start', 'agent': agent_name})}\n\n"

            # Generate real tasks for this agent
            try:
                steps = await asyncio.to_thread(
                    router_instance.generate_agent_plan, agent_name, agent_role, req.query
                )
            except Exception as e:
                logger.error(f"generate_agent_plan failed for {agent_name}: {e}")
                steps = [PlanStep(name=f"{agent_name}_task", description=f"Core {agent_name} work.")]

            # Send plan for this agent so the UI can show placeholders
            yield f"data: {json.dumps({'event': 'agent_plan', 'agent': agent_name, 'steps': [s.model_dump() for s in steps]})}\n\n"

            # Route + cost each step
            agent_base_input = None
            if agent_name == "analyst":
                agent_base_input = base_query_tokens + agent_outputs["researcher"]
            elif agent_name == "critic":
                agent_base_input = base_query_tokens + agent_outputs["researcher"] + agent_outputs["analyst"]
            elif agent_name == "reporter":
                # Reporter drops the raw researcher data; only formats the synthesized/critiqued results
                agent_base_input = base_query_tokens + agent_outputs["analyst"] + agent_outputs["critic"]
                
            for step in steps:
                try:
                    result = await asyncio.to_thread(
                        router_instance.analyze_step, step, req.query, base_input_tokens=agent_base_input
                    )
                    
                    agent_outputs[agent_name] += result.estimated_output_tokens
                    total_cost += result.cost_usd
                    yield f"data: {json.dumps({'event': 'step_result', 'agent': agent_name, **result.model_dump()})}\n\n"
                except Exception as e:
                    logger.error(f"analyze_step failed for '{step.name}': {e}")
                    yield f"data: {json.dumps({'event': 'step_error', 'agent': agent_name, 'name': step.name, 'message': str(e)})}\n\n"

            # Agent is done
            yield f"data: {json.dumps({'event': 'agent_done', 'agent': agent_name})}\n\n"

        yield f"data: {json.dumps({'event': 'complete', 'total_cost': round(total_cost, 8)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
