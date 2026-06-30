"""resolve a per-AGL lha selection rule into a concrete set of lha ids.

mirrors `frontend/src/utils/resolveLhaSelection.ts`. tests in
`tests/test_lha_selection_resolver.py` and the frontend parity suite
keep both implementations in lockstep on edge cases (empty range bounds,
threshold projection sign, missing surface positions, custom intersection).
"""

from __future__ import annotations

import math
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.core.constants import METERS_PER_DEG_LAT
from app.core.exceptions import DomainError
from app.core.geometry import wkt_to_geojson
from app.models.agl import AGL, LHA
from app.models.airport import AirfieldSurface

# the resolver mirrors METERS_PER_DEG_LAT in
# frontend/src/utils/resolveLhaSelection.ts - keep both in lockstep.


def _point_xy(geom) -> tuple[float, float] | None:
    """parse a WKT point geometry to (lon, lat); none if missing or bad."""
    if geom is None:
        return None
    try:
        data = wkt_to_geojson(geom)
    except Exception:
        return None
    coords = data.get("coordinates") if isinstance(data, dict) else None
    if not coords or len(coords) < 2:
        return None
    return float(coords[0]), float(coords[1])


def _along_track_distance_m(
    lha_pt: tuple[float, float],
    threshold_pt: tuple[float, float],
    end_pt: tuple[float, float],
    anchor: str,
) -> float:
    """signed-positive distance along threshold->end vector, anchored at start or end.

    uses an equirectangular projection centered on the anchor latitude (same
    correction as the seq-number backfill in d4a7b8c9e012). returns the
    along-track scalar in meters, clamped to >= 0 when the lha is past the
    chosen endpoint in the wrong direction (those points still resolve as
    "outside the band" naturally because callers compare against distance_m).
    """
    anchor_pt = threshold_pt if anchor == "START" else end_pt
    other_pt = end_pt if anchor == "START" else threshold_pt

    cos_lat = math.cos(math.radians(anchor_pt[1]))
    # vector from anchor toward the other endpoint
    vx = (other_pt[0] - anchor_pt[0]) * cos_lat * METERS_PER_DEG_LAT
    vy = (other_pt[1] - anchor_pt[1]) * METERS_PER_DEG_LAT
    # vector from anchor to lha
    px = (lha_pt[0] - anchor_pt[0]) * cos_lat * METERS_PER_DEG_LAT
    py = (lha_pt[1] - anchor_pt[1]) * METERS_PER_DEG_LAT

    v_len = math.hypot(vx, vy)
    if v_len == 0:
        # degenerate runway - everything sits at distance 0 along-track
        return 0.0

    dot = (px * vx + py * vy) / v_len
    return dot


def resolve_rule(
    rule: dict,
    agl: AGL,
    surface: AirfieldSurface | None,
) -> set[UUID]:
    """resolve a single rule to the set of lha ids it picks on this AGL.

    rule shape mirrors the pydantic LhaSelectionRule discriminated union:
    {"mode": "ALL"} | {"mode": "RANGE", "params": {"from": int|None, "to": int|None}}
    | {"mode": "FROM_THRESHOLD", "params": {"threshold": "START"|"END", "distance_m": float}}
    | {"mode": "CUSTOM"}.

    CUSTOM returns an empty set - the canonical custom selection is whatever
    the caller already wrote into config.lha_ids. callers that need the
    intersection with the AGL do that explicitly.
    """
    if not isinstance(rule, dict):
        raise DomainError("rule must be a dict", status_code=400)

    mode = rule.get("mode")
    lhas: list[LHA] = list(agl.lhas or [])

    if mode == "ALL":
        return {lha.id for lha in lhas}

    if mode == "CUSTOM":
        return set()

    if mode == "RANGE":
        params = rule.get("params") or {}
        # populate_by_name leaves us with either "from" or "from_" - accept both.
        raw_from = params.get("from", params.get("from_"))
        raw_to = params.get("to")
        if raw_from is not None and (not isinstance(raw_from, int) or raw_from < 1):
            raise DomainError("range from must be a positive integer", status_code=400)
        if raw_to is not None and (not isinstance(raw_to, int) or raw_to < 1):
            raise DomainError("range to must be a positive integer", status_code=400)
        if raw_from is not None and raw_to is not None and raw_from > raw_to:
            raise DomainError("range from must be <= to", status_code=400)

        max_seq = max((lha.sequence_number for lha in lhas), default=0)
        lo = raw_from if raw_from is not None else 1
        hi = raw_to if raw_to is not None else max_seq
        return {lha.id for lha in lhas if lo <= lha.sequence_number <= hi}

    if mode == "FROM_THRESHOLD":
        params = rule.get("params") or {}
        anchor = params.get("threshold")
        distance_m = params.get("distance_m")
        if anchor not in ("START", "END"):
            raise DomainError("threshold must be START or END", status_code=400)
        if not isinstance(distance_m, (int, float)) or distance_m < 0:
            raise DomainError("distance_m must be non-negative", status_code=400)

        if surface is None:
            raise DomainError(
                "from-threshold mode requires the AGL's parent surface", status_code=400
            )
        threshold_pt = _point_xy(getattr(surface, "threshold_position", None))
        end_pt = _point_xy(getattr(surface, "end_position", None))
        if threshold_pt is None or end_pt is None:
            raise DomainError(
                "surface lacks threshold_position/end_position for from-threshold mode",
                status_code=400,
            )

        picked: set[UUID] = set()
        for lha in lhas:
            lha_pt = _point_xy(lha.position)
            if lha_pt is None:
                continue
            d = _along_track_distance_m(lha_pt, threshold_pt, end_pt, anchor)
            # within the band when 0 <= d <= distance_m. negative d means the
            # lha is on the wrong side of the anchor; treat as outside.
            if 0.0 <= d <= float(distance_m):
                picked.add(lha.id)
        return picked

    raise DomainError(f"unknown lha selection mode: {mode}", status_code=400)


def resolve_rules_to_lha_ids(
    rules: dict[UUID | str, dict],
    agl_index: dict[UUID, AGL],
    custom_lha_ids: list[UUID] | None = None,
) -> list[UUID]:
    """resolve every per-AGL rule and union the results into a flat list.

    `rules` keys may be UUID or string-uuid (jsonb round-trip). rule entries
    pointing at AGLs absent from agl_index are silently skipped - the form
    should never produce a rule for an unknown AGL, but we don't hard-error
    during a save.

    `custom_lha_ids` are unioned in for AGLs whose rule mode is CUSTOM (the
    canonical custom selection lives on the inspection's lha_ids field).
    only custom ids that belong to one of the AGLs in `agl_index` are kept.

    AGLs present in `agl_index` but absent from `rules` are treated as
    implicit CUSTOM: their portion of `custom_lha_ids` is preserved so a
    partial rules dict cannot silently drop existing selections on
    untouched AGLs (caller is responsible for loading those AGLs).
    """
    resolved: set[UUID] = set()
    custom_set: set[UUID] = set(custom_lha_ids or [])

    # normalize rule keys to UUID and drop entries not in agl_index
    rules_by_uuid: dict[UUID, dict] = {}
    for raw_key, rule in (rules or {}).items():
        agl_id = raw_key if isinstance(raw_key, UUID) else UUID(str(raw_key))
        if agl_id in agl_index:
            rules_by_uuid[agl_id] = rule

    custom_aglids: set[UUID] = set()

    for agl_id, agl in agl_index.items():
        rule = rules_by_uuid.get(agl_id)
        if rule is None:
            # AGL not mentioned in rules - implicit CUSTOM
            custom_aglids.add(agl_id)
            continue
        mode = rule.get("mode") if isinstance(rule, dict) else None
        if mode == "CUSTOM":
            custom_aglids.add(agl_id)
            continue
        surface = getattr(agl, "surface", None)
        resolved |= resolve_rule(rule, agl, surface)

    # for CUSTOM-mode (explicit and implicit) AGLs, keep only the custom ids that belong to them
    if custom_aglids and custom_set:
        for agl_id in custom_aglids:
            agl = agl_index[agl_id]
            agl_lha_ids = {lha.id for lha in (agl.lhas or [])}
            resolved |= custom_set & agl_lha_ids

    return sorted(resolved, key=lambda u: str(u))


def _normalize_rules_for_storage(rules) -> dict[str, dict]:
    """coerce per-AGL rule dict into JSONB-friendly shape (string keys, alias 'from')."""
    out: dict[str, dict] = {}
    for raw_key, rule in (rules or {}).items():
        key = str(raw_key)
        if not isinstance(rule, dict):
            rule = rule.model_dump(by_alias=True)  # type: ignore[attr-defined]
        copy = dict(rule)
        if copy.get("mode") == "RANGE":
            params = dict(copy.get("params") or {})
            if "from_" in params:
                params["from"] = params.pop("from_")
            copy["params"] = params
        out[key] = copy
    return out


def apply_lha_selection(db: Session, config_data: dict) -> None:
    """resolve lha_selection_rules in-place into a flat lha_ids list.

    mutates `config_data`: when `lha_selection_rules` is present, normalizes
    its keys/params to the storage shape, looks up every affected AGL (those
    in the rules dict plus every AGL that owns any pre-existing `lha_ids`
    entry), runs the resolver, and overwrites `lha_ids` with the resolved
    union. CUSTOM-mode and untouched AGLs preserve their portion of the
    pre-existing `lha_ids` (intersected with the AGL's lhas) so a partial
    rules dict from the form cannot silently drop selections on AGLs the
    user did not edit.
    """
    rules = config_data.get("lha_selection_rules")
    if rules is None:
        return

    normalized = _normalize_rules_for_storage(rules)
    if not normalized:
        config_data["lha_selection_rules"] = {}
        return

    custom_ids_raw = config_data.get("lha_ids") or []
    custom_ids = [UUID(str(u)) for u in custom_ids_raw]

    rule_agl_ids = {UUID(k) for k in normalized.keys()}

    # also pull in every AGL that owns any of the pre-existing lha_ids so
    # AGLs absent from a partial rules dict aren't silently dropped.
    extra_agl_ids: set[UUID] = set()
    if custom_ids:
        owners = db.query(LHA.agl_id).filter(LHA.id.in_(custom_ids)).distinct().all()
        extra_agl_ids = {row[0] for row in owners}

    all_agl_ids = rule_agl_ids | extra_agl_ids

    agls = (
        db.query(AGL)
        .options(joinedload(AGL.lhas), joinedload(AGL.surface))
        .filter(AGL.id.in_(all_agl_ids))
        .all()
    )
    agl_index = {a.id: a for a in agls}

    resolved = resolve_rules_to_lha_ids(normalized, agl_index, custom_ids)

    config_data["lha_selection_rules"] = normalized
    config_data["lha_ids"] = [str(u) for u in resolved]
