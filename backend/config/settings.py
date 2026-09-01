from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    # Model identifiers (used as labels — swap these for any model names you want)
    fast_model: str = Field(default="gpt-5-mini", alias="FAST_MODEL")
    balanced_model: str = Field(default="gpt-5", alias="BALANCED_MODEL")
    powerful_model: str = Field(default="gpt-5-pro", alias="POWERFUL_MODEL")

    # ──────────────────────────────────────────────────────────────────────────
    # OpenAI pricing — USD per 1,000,000 tokens (source: platform.openai.com/docs/pricing)
    # ──────────────────────────────────────────────────────────────────────────
    # gpt-5-mini
    fast_input_cost_per_million: float = Field(default=0.25, alias="FAST_INPUT_COST")
    fast_output_cost_per_million: float = Field(default=2.00, alias="FAST_OUTPUT_COST")
    # gpt-4o
    balanced_input_cost_per_million: float = Field(default=1.25, alias="BALANCED_INPUT_COST")
    balanced_output_cost_per_million: float = Field(default=10.00, alias="BALANCED_OUTPUT_COST")
    # o1
    powerful_input_cost_per_million: float = Field(default=15.00, alias="POWERFUL_INPUT_COST")
    powerful_output_cost_per_million: float = Field(default=120.00, alias="POWERFUL_OUTPUT_COST")

    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    google_api_key: str = Field(default="", alias="GOOGLE_API_KEY")

    model_retry_count: int = Field(default=1, alias="MODEL_RETRY_COUNT")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
