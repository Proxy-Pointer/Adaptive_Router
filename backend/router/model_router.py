from pydantic import BaseModel, Field
from google import genai as google_genai
from google.genai import types as genai_types
from config.settings import settings
import tiktoken
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas (also used as response_schema for Gemini structured output)
# ─────────────────────────────────────────────────────────────────────────────

class PlanStep(BaseModel):
    name: str = Field(description="Short snake_case identifier, e.g. 'web_search'")
    description: str = Field(description="Exactly what this step does for the given query")

class PlanOutput(BaseModel):
    steps: list[PlanStep] = Field(description="2-4 concrete, ordered sub-tasks")

class StepClassification(BaseModel):
    complexity: str          = Field(description="'low', 'medium', or 'high'")
    reasoning: str           = Field(description="'low', 'medium', or 'high'")
    complexity_explanation: str = Field(description="One sentence why this rating")
    estimated_input_tokens: int  = Field(description="Realistic input token count (system prompt ~200, query ~100, any docs/context this step needs)")
    estimated_output_tokens: int = Field(description="Realistic output token count for this step's response")

class StepResult(BaseModel):
    name: str
    description: str
    complexity: str
    reasoning: str
    complexity_explanation: str
    context_size: str
    estimated_input_tokens: int
    estimated_output_tokens: int
    routing_score: int
    tier: str
    model: str
    cost_usd: float

class RouterResult(BaseModel):
    complexity: str
    reasoning: str
    context_size: str
    routing_score: int
    tier: str
    model: str
    routing_reason: str
    estimated_input_tokens: Optional[int] = None
    estimated_output_tokens: Optional[int] = None
    cost_usd: Optional[float] = None

# ─────────────────────────────────────────────────────────────────────────────
# Routing constants
# ─────────────────────────────────────────────────────────────────────────────

COMPLEXITY_SCORES  = {"low": 0, "medium": 1, "high": 2}
REASONING_SCORES   = {"low": 0, "medium": 1, "high": 2}
CONTEXT_THRESHOLDS = {"small": 2_000, "medium": 6_000}
TIER_THRESHOLDS    = {"fast": (0, 2), "balanced": (3, 4), "powerful": (5, 6)}
MODEL_NAME         = "gemini-3.1-flash-lite"

# ─────────────────────────────────────────────────────────────────────────────
# Router
# ─────────────────────────────────────────────────────────────────────────────

class ModelRouter:
    def __init__(self):
        self.client  = google_genai.Client(api_key=settings.google_api_key)
        self.encoder = tiktoken.get_encoding("o200k_base")

    # ── private helpers ───────────────────────────────────────────────────────

    def _generate(self, prompt: str, schema: type) -> object:
        """Call Gemini with native JSON structured output. Returns parsed Pydantic object."""
        response = self.client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
                temperature=0,
            ),
        )
        return response.parsed

    def _context_tier(self, tokens: int) -> str:
        if tokens < CONTEXT_THRESHOLDS["small"]:  return "small"
        if tokens < CONTEXT_THRESHOLDS["medium"]: return "medium"
        return "large"

    def _score(self, complexity: str, reasoning: str, context_size: str) -> int:
        return (
            COMPLEXITY_SCORES.get(complexity.lower(), 0)
            + REASONING_SCORES.get(reasoning.lower(), 0)
            + {"small": 0, "medium": 1, "large": 2}.get(context_size, 0)
        )

    def _tier(self, score: int) -> str:
        for tier, (lo, hi) in TIER_THRESHOLDS.items():
            if lo <= score <= hi:
                return tier
        return "powerful"

    def _model_name(self, tier: str) -> str:
        return {
            "fast":     settings.fast_model,
            "balanced": settings.balanced_model,
            "powerful": settings.powerful_model,
        }.get(tier, settings.powerful_model)

    def _cost(self, tier: str, in_tok: int, out_tok: int) -> float:
        pricing = {
            "fast":     (settings.fast_input_cost_per_million,     settings.fast_output_cost_per_million),
            "balanced": (settings.balanced_input_cost_per_million, settings.balanced_output_cost_per_million),
            "powerful": (settings.powerful_input_cost_per_million, settings.powerful_output_cost_per_million),
        }
        in_usd, out_usd = pricing.get(tier, (2.50, 10.00))
        return round((in_tok * in_usd + out_tok * out_usd) / 1_000_000, 8)

    # ── public API ────────────────────────────────────────────────────────────

    def generate_agent_plan(self, agent_name: str, agent_role: str, query: str) -> list[PlanStep]:
        """Use Gemini to generate 2-4 real, specific sub-tasks for this agent."""
        prompt = f"""You are planning the concrete work for the '{agent_name}' agent in a multi-agent research pipeline.

User Query: {query}

This agent's role: {agent_role}

Generate exactly 2 to 4 specific sub-tasks this agent must perform to fulfil its role for this query.
Requirements:
- step 'name': short snake_case, e.g. 'web_search', 'extract_key_claims', 'draft_executive_summary'
- step 'description': a specific sentence describing what happens in this step FOR THIS QUERY
- Tasks must be within this agent's role only
- Each task must be genuinely distinct and necessary"""

        try:
            result = self._generate(prompt, PlanOutput)
            if result and result.steps:
                return result.steps
            raise ValueError("Empty plan returned")
        except Exception as e:
            logger.error(f"generate_agent_plan failed for '{agent_name}': {e}")
            # Meaningful fallbacks per agent
            fallbacks = {
                "researcher": [
                    PlanStep(name="web_search",     description=f"Search for information relevant to: {query[:80]}"),
                    PlanStep(name="source_review",  description="Review and validate retrieved sources for credibility"),
                    PlanStep(name="data_synthesis", description="Synthesize gathered information into structured findings"),
                ],
                "analyst": [
                    PlanStep(name="pattern_analysis",  description="Identify key patterns and trends in the research findings"),
                    PlanStep(name="evidence_review",   description="Evaluate strength of evidence for each major claim"),
                    PlanStep(name="draw_conclusions",  description="Draw data-backed conclusions from the analysis"),
                ],
                "critic": [
                    PlanStep(name="identify_gaps",     description="Identify logical gaps and missing evidence in the analysis"),
                    PlanStep(name="validate_reasoning",description="Validate the reasoning chain for logical consistency"),
                ],
                "reporter": [
                    PlanStep(name="structure_report",  description="Structure findings into a clear, logical report format"),
                    PlanStep(name="executive_summary", description="Write an executive summary with key findings and recommendations"),
                ],
            }
            return fallbacks.get(agent_name, [PlanStep(name=f"{agent_name}_task", description=f"Perform {agent_name} work on the query.")])

    def analyze_step(self, step: PlanStep, query: str, base_input_tokens: Optional[int] = None) -> StepResult:
        """Classify a step's complexity and estimate token usage, then route and calculate cost."""
        prompt = f"""You are an AI inference cost estimation expert analyzing a single pipeline step.

Original user query: {query}

Step to analyze:
  Name: {step.name}
  Description: {step.description}

Provide:
1. complexity ('low'/'medium'/'high') — intellectual difficulty
2. reasoning ('low'/'medium'/'high') — multi-step reasoning required
3. complexity_explanation — one sentence justifying both ratings
4. estimated_input_tokens — be realistic:
   - System prompt: ~200 tokens
   - User query context: ~50-150 tokens
   - Retrieved documents/search results (if this step uses them): 500-8,000 tokens
   - Prior step outputs passed as context: 300-3,000 tokens
5. estimated_output_tokens — realistic response length for this specific step"""

        try:
            cls = self._generate(prompt, StepClassification)
            if not cls:
                raise ValueError("No classification returned")
        except Exception as e:
            logger.error(f"analyze_step failed for '{step.name}': {e}")
            cls = StepClassification(
                complexity="medium", reasoning="medium",
                complexity_explanation="Could not classify — using defaults.",
                estimated_input_tokens=1_000, estimated_output_tokens=500,
            )

        if base_input_tokens is not None:
            cls.estimated_input_tokens = base_input_tokens

        context_size = self._context_tier(cls.estimated_input_tokens)
        score  = self._score(cls.complexity, cls.reasoning, context_size)
        tier   = self._tier(score)
        model  = self._model_name(tier)
        cost   = self._cost(tier, cls.estimated_input_tokens, cls.estimated_output_tokens)

        return StepResult(
            name=step.name,
            description=step.description,
            complexity=cls.complexity,
            reasoning=cls.reasoning,
            complexity_explanation=cls.complexity_explanation,
            context_size=context_size,
            estimated_input_tokens=cls.estimated_input_tokens,
            estimated_output_tokens=cls.estimated_output_tokens,
            routing_score=score,
            tier=tier,
            model=model,
            cost_usd=cost,
        )

    def route(self, task_description: str, agent_name: str = "agent") -> RouterResult:
        """Single-task routing for the Playground — estimates tokens for the full agent workload."""
        # Describe the task in the context of what this agent would actually need to do the full job.
        enriched = (
            f"[{agent_name.upper()} AGENT — full workload for this task]\n"
            f"Task: {task_description}\n\n"
            f"Estimate tokens needed for the {agent_name} agent to complete this task end-to-end, "
            f"including system instructions, the task description, any documents or search results it "
            f"would need to retrieve, and prior context from earlier pipeline stages."
        )
        step = PlanStep(name=f"{agent_name}_task", description=enriched)
        result = self.analyze_step(step, query=task_description)
        return RouterResult(
            complexity=result.complexity,
            reasoning=result.reasoning,
            context_size=result.context_size,
            routing_score=result.routing_score,
            tier=result.tier,
            model=result.model,
            routing_reason=result.complexity_explanation,
            estimated_input_tokens=result.estimated_input_tokens,
            estimated_output_tokens=result.estimated_output_tokens,
            cost_usd=result.cost_usd,
        )


