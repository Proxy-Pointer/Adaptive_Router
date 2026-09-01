import pytest
import json
import os
from unittest.mock import patch, MagicMock

from router.model_router import ModelRouter, StepClassification, RouterResult

# Load test cases
with open(os.path.join(os.path.dirname(__file__), "classifier_test_cases.json"), "r") as f:
    TEST_CASES = json.load(f)

@pytest.fixture
def router():
    # Mock settings so we don't need real API keys
    with patch("router.model_router.settings") as mock_settings:
        mock_settings.google_api_key = "test_key"
        with patch("router.model_router.google_genai.Client"):
            router = ModelRouter()
            yield router

@pytest.mark.parametrize("case", TEST_CASES)
def test_router_classification_mocked(router, case):
    """
    Since we can't reliably test the actual LLM's classification in a unit test without paying/latency,
    we mock the LLM's structured output to ensure the *router logic* correctly processes it.
    """
    router._generate = MagicMock(return_value=StepClassification(
        complexity=case["expected_complexity"],
        reasoning=case["expected_reasoning"],
        complexity_explanation="Mocked",
        estimated_input_tokens=1000,
        estimated_output_tokens=500
    ))
    
    result = router.route(case["task"])
    
    assert result.complexity == case["expected_complexity"]
    assert result.reasoning == case["expected_reasoning"]

def test_context_sizing(router):
    assert router._context_tier(1000) == "small"
    assert router._context_tier(5000) == "medium"
    assert router._context_tier(15000) == "large"

def test_score_calculation(router):
    assert router._score("low", "low", "small") == 0
    assert router._score("high", "high", "large") == 6
    assert router._score("medium", "medium", "small") == 2

def test_determine_tier(router):
    assert router._tier(0) == "fast"
    assert router._tier(2) == "fast"
    assert router._tier(3) == "balanced"
    assert router._tier(4) == "balanced"
    assert router._tier(5) == "powerful"
    assert router._tier(6) == "powerful"
