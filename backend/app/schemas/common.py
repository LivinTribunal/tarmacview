"""shared schema literals and pagination wrappers."""

from typing import Literal

from pydantic import BaseModel

# white balance presets
WhiteBalanceStr = Literal["DAYLIGHT", "CLOUDY", "TUNGSTEN", "MANUAL_4000K"]
# focus mode: AUTO lets the camera autofocus; INFINITY locks focus at infinity
FocusModeStr = Literal["AUTO", "INFINITY"]


def validate_range_order(
    from_val: float | None,
    to_val: float | None,
    message: str,
    *,
    allow_equal: bool = False,
) -> None:
    """raise ValueError when from_val exceeds to_val (both must be supplied).

    allow_equal lets equal bounds pass (inclusive ranges); the default also
    rejects equal (angle bands must strictly increase).
    """
    if from_val is None or to_val is None:
        return
    invalid = from_val > to_val if allow_equal else from_val >= to_val
    if invalid:
        raise ValueError(message)


class DeleteResponse(BaseModel):
    """shared delete response."""

    deleted: bool
    warnings: list[str] = []


class ListMeta(BaseModel):
    """shared list metadata."""

    total: int
    limit: int | None = None
    offset: int | None = None
