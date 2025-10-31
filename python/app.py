"""Flask application providing an HTTP interface for Doyle spiral generation."""

from __future__ import annotations

from typing import Any, Dict, Mapping, Tuple

from flask import Flask, jsonify, render_template, request

from src.doyle_spiral import DoyleSpiral


app = Flask(__name__, static_folder="static", template_folder="templates")


DEFAULT_PARAMS: Dict[str, Any] = {
    "p": 16,
    "q": 16,
    "t": 0.0,
    "mode": "arram_boyle",
    "arc_mode": "closest",
    "num_gaps": 2,
    "size": 800,
    "debug_groups": False,
    "add_fill_pattern": False,
    "fill_pattern_spacing": 5.0,
    "fill_pattern_angle": 0.0,
    "fill_pattern_offset": 0.0,
    "fill_pattern_animation": "ring",
    "red_outline": False,
    "draw_group_outline": True,
}

ALLOWED_MODES = {"doyle", "arram_boyle"}
ALLOWED_ARC_MODES = {
    "closest",
    "farthest",
    "alternating",
    "all",
    "random",
    "symmetric",
    "angular",
}

ALLOWED_PATTERN_ANIMATIONS = {
    "ring",
    "rings",
    "log_spiral",
    "log-spiral sweep",
    "curvature_cascade",
    "curvature cascade",
    "golden_sector",
    "golden sector starburst",
    "ripple_focus",
    "ripple from focus",
    "arm_interleaving",
    "arm interleaving",
    "quasi_moire",
    "quasi-moiré stripe scan",
}


def _get_value(source: Mapping[str, Any], key: str, default: Any) -> Any:
    value = source.get(key, default)
    return default if value in (None, "") else value


def _parse_bool(source: Mapping[str, Any], key: str, default: bool) -> bool:
    value = _get_value(source, key, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _parse_params(source: Mapping[str, Any]) -> Dict[str, Any]:
    params: Dict[str, Any] = {}

    def as_int(name: str, default: int) -> int:
        value = _get_value(source, name, default)
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def as_float(name: str, default: float) -> float:
        value = _get_value(source, name, default)
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    params["p"] = max(2, as_int("p", DEFAULT_PARAMS["p"]))
    params["q"] = max(2, as_int("q", DEFAULT_PARAMS["q"]))
    params["t"] = as_float("t", DEFAULT_PARAMS["t"])
    params["size"] = max(200, as_int("size", DEFAULT_PARAMS["size"]))

    mode = str(_get_value(source, "mode", DEFAULT_PARAMS["mode"]))
    params["mode"] = mode if mode in ALLOWED_MODES else DEFAULT_PARAMS["mode"]

    arc_mode = str(_get_value(source, "arc_mode", DEFAULT_PARAMS["arc_mode"]))
    params["arc_mode"] = arc_mode if arc_mode in ALLOWED_ARC_MODES else DEFAULT_PARAMS["arc_mode"]

    params["num_gaps"] = max(0, as_int("num_gaps", DEFAULT_PARAMS["num_gaps"]))
    params["debug_groups"] = _parse_bool(source, "debug_groups", DEFAULT_PARAMS["debug_groups"])
    params["add_fill_pattern"] = _parse_bool(source, "add_fill_pattern", DEFAULT_PARAMS["add_fill_pattern"])
    params["fill_pattern_spacing"] = max(0.1, as_float("fill_pattern_spacing", DEFAULT_PARAMS["fill_pattern_spacing"]))
    params["fill_pattern_angle"] = as_float("fill_pattern_angle", DEFAULT_PARAMS["fill_pattern_angle"])
    params["fill_pattern_offset"] = max(0.0, as_float("fill_pattern_offset", DEFAULT_PARAMS["fill_pattern_offset"]))
    raw_animation = str(_get_value(source, "fill_pattern_animation", DEFAULT_PARAMS["fill_pattern_animation"])).strip().lower()
    params["fill_pattern_animation"] = raw_animation if raw_animation in ALLOWED_PATTERN_ANIMATIONS else DEFAULT_PARAMS["fill_pattern_animation"]
    params["red_outline"] = _parse_bool(source, "red_outline", DEFAULT_PARAMS["red_outline"])
    params["draw_group_outline"] = _parse_bool(source, "draw_group_outline", DEFAULT_PARAMS["draw_group_outline"])

    return params


def _render_spiral(spiral: DoyleSpiral, params: Mapping[str, Any], *, mode: str | None = None) -> Tuple[str, Dict[str, Any] | None]:
    render_mode = mode or params["mode"]
    svg = spiral.to_svg(
        mode=render_mode,
        size=params["size"],
        debug_groups=params["debug_groups"],
        add_fill_pattern=params["add_fill_pattern"],
        fill_pattern_spacing=params["fill_pattern_spacing"],
        fill_pattern_angle=params["fill_pattern_angle"],
        red_outline=params["red_outline"],
        draw_group_outline=params["draw_group_outline"],
        fill_pattern_offset=params["fill_pattern_offset"],
        fill_pattern_animation=params["fill_pattern_animation"],
    )

    geometry = None
    if render_mode == "arram_boyle":
        geometry = spiral.to_json_dict()

    return svg, geometry


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/viewer")
def viewer() -> str:
    return render_template("doyle_3d.html")


@app.post("/api/spiral")
def generate_spiral():
    payload = request.get_json(silent=True) or {}
    params = {**DEFAULT_PARAMS, **_parse_params(payload)}

    try:
        spiral = DoyleSpiral(
            params["p"],
            params["q"],
            params["t"],
            arc_mode=params["arc_mode"],
            num_gaps=params["num_gaps"],
        )
        svg, geometry = _render_spiral(spiral, params)
    except Exception as exc:  # pragma: no cover - error path
        app.logger.exception("Failed to generate spiral")
        return jsonify({"error": str(exc)}), 400

    response: Dict[str, Any] = {"svg": svg, "params": params}
    if geometry is not None:
        response["geometry"] = geometry
    return jsonify(response)


@app.get("/api/spiral/geometry")
def spiral_geometry():
    params = {**DEFAULT_PARAMS, **_parse_params(request.args)}
    params["mode"] = "arram_boyle"

    try:
        spiral = DoyleSpiral(
            params["p"],
            params["q"],
            params["t"],
            arc_mode=params["arc_mode"],
            num_gaps=params["num_gaps"],
        )
        _, geometry = _render_spiral(spiral, params, mode="arram_boyle")
    except Exception as exc:  # pragma: no cover - error path
        app.logger.exception("Failed to export spiral geometry")
        return jsonify({"error": str(exc)}), 400

    return jsonify({"geometry": geometry, "params": params})


if __name__ == "__main__":  # pragma: no cover - manual execution only
    app.run(debug=True)
