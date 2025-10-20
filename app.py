from __future__ import annotations

import time
import uuid
from collections import OrderedDict
from typing import Any, Dict, Mapping

from flask import Flask, abort, jsonify, redirect, render_template, request, url_for

from src.doyle_spiral import DoyleSpiral

app = Flask(__name__, static_folder="static", template_folder="templates")

_SPIRAL_CACHE: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
_CACHE_LIMIT = 12


def _store_spiral(payload: Dict[str, Any]) -> str:
    """Store spiral JSON payload in memory and return an identifier."""
    spiral_id = str(uuid.uuid4())
    _SPIRAL_CACHE[spiral_id] = payload
    # Keep cache bounded
    while len(_SPIRAL_CACHE) > _CACHE_LIMIT:
        _SPIRAL_CACHE.popitem(last=False)
    return spiral_id


def _parse_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"true", "1", "yes", "on"}
    if value is None:
        return default
    return bool(value)


@app.route("/")
def index() -> str:
    return render_template("index.html")


def _coerce_payload(data: Mapping[str, Any]) -> Dict[str, Any]:
    """Normalize incoming spiral parameters from JSON or query strings."""

    def _get(key: str, default: Any) -> Any:
        value = data.get(key, default)
        # Handle values coming from MultiDict (lists/tuples)
        if isinstance(value, (list, tuple)):
            return value[-1]
        return value

    try:
        payload = {
            "p": int(_get("p", 16)),
            "q": int(_get("q", 16)),
            "t": float(_get("t", 0.0)),
            "arc_mode": str(_get("arc_mode", "closest")),
            "mode": str(_get("mode", "arram_boyle")),
            "num_gaps": int(_get("num_gaps", 2)),
            "add_fill_pattern": _parse_bool(_get("add_fill_pattern", False)),
            "fill_pattern_spacing": float(_get("fill_pattern_spacing", 5.0)),
            "fill_pattern_angle": float(_get("fill_pattern_angle", 0.0)),
            "fill_pattern_offset": float(_get("fill_pattern_offset", 0.0)),
            "draw_group_outline": _parse_bool(_get("draw_group_outline", True)),
        }
    except (TypeError, ValueError):
        raise ValueError("Invalid spiral parameters") from None

    return payload


def _render_spiral(payload: Dict[str, Any]):
    spiral = DoyleSpiral(
        payload["p"],
        payload["q"],
        payload["t"],
        arc_mode=payload["arc_mode"],
        num_gaps=payload["num_gaps"],
    )

    svg = spiral.to_svg(
        mode=payload["mode"],
        add_fill_pattern=payload["add_fill_pattern"],
        fill_pattern_spacing=payload["fill_pattern_spacing"],
        fill_pattern_angle=payload["fill_pattern_angle"],
        draw_group_outline=payload["draw_group_outline"],
        fill_pattern_offset=payload["fill_pattern_offset"],
    )

    return spiral, svg


@app.post("/api/spiral")
def create_spiral():
    data = request.get_json(force=True, silent=True) or {}

    try:
        payload = _coerce_payload(data)
    except ValueError:
        abort(400, description="Invalid spiral parameters")

    start = time.perf_counter()

    try:
        spiral, svg = _render_spiral(payload)
    except Exception as exc:  # pragma: no cover - surface failure to client
        abort(500, description=f"Failed to generate spiral: {exc}")

    elapsed_ms = round((time.perf_counter() - start) * 1000, 2)

    stats = {
        "arcgroups": None,
        "polygons": None,
        "duration_ms": elapsed_ms,
    }
    view_url = None
    spiral_id = None

    if payload["mode"] == "arram_boyle":
        try:
            json_payload = spiral.to_json_dict()
        except RuntimeError:
            json_payload = None
        if json_payload:
            stats["arcgroups"] = len(json_payload.get("arcgroups", []))
            stats["polygons"] = sum(len(group.get("outline", [])) for group in json_payload["arcgroups"])
            spiral_id = _store_spiral(json_payload)
            view_url = url_for("viewer", spiral_id=spiral_id)

    response = {
        "svg": svg,
        "stats": stats,
        "render_ms": elapsed_ms,
        "spiral_id": spiral_id,
        "view_url": view_url,
    }

    return jsonify(response)


@app.route("/viewer")
def viewer_from_query():
    spiral_id = request.args.get("spiral_id")
    if spiral_id:
        if spiral_id in _SPIRAL_CACHE:
            return render_template("doyle_3d.html", spiral_id=spiral_id)
        abort(404)

    if not request.args:
        return redirect(url_for("index"))

    try:
        payload = _coerce_payload(request.args)
    except ValueError:
        abort(400, description="Invalid spiral parameters")

    # The 3D viewer only supports Arram–Boyle data; force the mode accordingly.
    payload["mode"] = "arram_boyle"

    try:
        spiral, _ = _render_spiral(payload)
    except Exception as exc:  # pragma: no cover - surface failure to client
        abort(500, description=f"Failed to prepare spiral: {exc}")

    try:
        json_payload = spiral.to_json_dict()
    except RuntimeError as exc:
        abort(500, description=f"Failed to cache spiral: {exc}")

    spiral_id = _store_spiral(json_payload)
    return redirect(url_for("viewer", spiral_id=spiral_id))


@app.route("/viewer/<spiral_id>")
def viewer(spiral_id: str):
    if spiral_id not in _SPIRAL_CACHE:
        abort(404)
    return render_template("doyle_3d.html", spiral_id=spiral_id)


@app.route("/api/spiral/<spiral_id>")
def get_spiral(spiral_id: str):
    payload = _SPIRAL_CACHE.get(spiral_id)
    if not payload:
        abort(404)
    return jsonify(payload)


if __name__ == "__main__":  # pragma: no cover
    app.run(debug=True)
