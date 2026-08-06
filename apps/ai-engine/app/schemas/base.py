from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base for all request/response schemas: Python attributes stay snake_case,
    wire format (JSON in/out) is camelCase to match docs/API_SPEC.md. Reused
    verbatim from `AI-ORION/app/schemas/base.py`."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
