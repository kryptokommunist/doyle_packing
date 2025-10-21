"""
Interactive UI for generating a Voronoi + golden-ratio spiral SVG with optional infill lines,
and two Doyle-style circle-packing modes:
 - approximate greedy packing (original behaviour)
 - exact Doyle spiral shape generation (from the provided Doyle script)

Now with option to color only the *outer Voronoi edges* red (inner edges black).
"""

%matplotlib inline
from IPython.display import display, SVG
from matplotlib.path import Path as MplPath

import ipywidgets as widgets
import math
import random
from pathlib import Path

import numpy as np
from scipy.spatial import Voronoi
import colorsys
from scipy.optimize import root


# ----------------- Utilities -----------------
def hsv_to_hex(h, s, v):
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return '#{0:02x}{1:02x}{2:02x}'.format(int(r * 255), int(g * 255), int(b * 255))


def voronoi_finite_polygons_2d(vor, radius=None):
    """Convert infinite Voronoi regions to finite polygons."""
    if vor.points.shape[1] != 2:
        raise ValueError("Requires 2D input")

    new_regions = []
    new_vertices = vor.vertices.tolist()

    center = vor.points.mean(axis=0)
    if radius is None:
        radius = vor.points.ptp().max() * 2

    all_ridges = {}
    for (p1, p2), (v1, v2) in zip(vor.ridge_points, vor.ridge_vertices):
        all_ridges.setdefault(p1, []).append((p2, v1, v2))
        all_ridges.setdefault(p2, []).append((p1, v1, v2))

    for p1, region_idx in enumerate(vor.point_region):
        vertices = vor.regions[region_idx]
        if all(v >= 0 for v in vertices):
            new_regions.append(vertices)
            continue

        ridges = all_ridges[p1]
        new_region = [v for v in vertices if v >= 0]

        for p2, v1, v2 in ridges:
            if v2 < 0 or v1 < 0:
                v_finite = v1 if v1 >= 0 else v2
                tangent = vor.points[p2] - vor.points[p1]
                tangent /= np.linalg.norm(tangent)
                normal = np.array([-tangent[1], tangent[0]])
                midpoint = vor.points[[p1, p2]].mean(axis=0)
                direction = np.sign(np.dot(midpoint - center, normal)) * normal
                far_point = vor.vertices[v_finite] + direction * radius
                new_vertices.append(far_point.tolist())
                new_region.append(len(new_vertices) - 1)

        vs = np.asarray([new_vertices[v] for v in new_region])
        c = vs.mean(axis=0)
        angles = np.arctan2(vs[:, 1] - c[1], vs[:, 0] - c[0])
        new_region = [v for _, v in sorted(zip(angles, new_region))]
        new_regions.append(new_region)

    return new_regions, np.asarray(new_vertices)


def phyllotaxis(n_points, width, height, turns=10, spacing_power=1.6, margin=0.05, single_spiral=False):
    """Generate a golden-ratio or single outward spiral of points."""
    max_r = 0.5 * min(width, height) * (1 - margin)
    pts = []

    if single_spiral:
        total_angle = turns * 2 * math.pi
        for i in range(n_points):
            theta = i / (n_points - 1) * total_angle if n_points > 1 else 0
            ratio = (i / (n_points - 1)) ** spacing_power if n_points > 1 else 0
            r = max_r * ratio
            x = r * math.cos(theta)
            y = r * math.sin(theta)
            pts.append((x, y))
    else:
        golden_angle = math.pi * (3 - math.sqrt(5)) * turns / 10.0
        for i in range(n_points):
            theta = i * golden_angle
            ratio = (i / (n_points - 1)) ** spacing_power if n_points > 1 else 0
            r = max_r * math.sqrt(ratio)
            x = r * math.cos(theta)
            y = r * math.sin(theta)
            pts.append((x, y))

    pts = np.array(pts)
    pts[:, 0] += width / 2
    pts[:, 1] += height / 2
    return pts


def polygon_to_svg(points, fill, stroke='#000000', stroke_width=0.5, fill_opacity=1.0):
    coords = ' '.join(f'{x:.3f},{y:.3f}' for x, y in points)
    return f'<polygon points="{coords}" fill="{fill}" fill-opacity="{fill_opacity}" stroke="{stroke}" stroke-width="{stroke_width}" />\n'


def circle_to_svg(x, y, r, fill, stroke='none', stroke_width=0.5, fill_opacity=1.0):
    return f'<circle cx="{x:.3f}" cy="{y:.3f}" r="{r:.3f}" fill="{fill}" stroke="{stroke}" stroke-width="{stroke_width}" fill-opacity="{fill_opacity}" />\n'


def lines_in_polygon(polygon, line_spacing=5, angle=0, color="#0000ff", stroke_width=0.5):
    """Fill polygon with parallel lines at a given angle."""
    if len(polygon) < 3:
        return ""

    polygon = np.array(polygon)
    centroid = polygon.mean(axis=0)

    min_x, min_y = polygon[:, 0].min(), polygon[:, 1].min()
    max_x, max_y = polygon[:, 0].max(), polygon[:, 1].max()
    bbox_diag = math.hypot(max_x - min_x, max_y - min_y)

    theta = np.radians(angle)
    dx, dy = math.cos(theta), math.sin(theta)
    px, py = -dy, dx

    num_lines = int(bbox_diag / line_spacing) + 1
    lines = []
    path = MplPath(polygon)

    for i in range(-num_lines, num_lines):
        shift_x = px * i * line_spacing
        shift_y = py * i * line_spacing
        line_start = np.array([centroid[0] - dx * bbox_diag + shift_x,
                               centroid[1] - dy * bbox_diag + shift_y])
        line_end = np.array([centroid[0] + dx * bbox_diag + shift_x,
                             centroid[1] + dy * bbox_diag + shift_y])

        num_samples = min(int(np.linalg.norm(line_end - line_start)), 800)
        xs = np.linspace(line_start[0], line_end[0], num_samples)
        ys = np.linspace(line_start[1], line_end[1], num_samples)
        in_poly = [path.contains_point((x, y)) for x, y in zip(xs, ys)]
        start_idx = None
        for j, inside in enumerate(in_poly):
            if inside and start_idx is None:
                start_idx = j
            elif not inside and start_idx is not None:
                end_idx = j - 1
                lines.append(((xs[start_idx], ys[start_idx]), (xs[end_idx], ys[end_idx])))
                start_idx = None
        if start_idx is not None:
            lines.append(((xs[start_idx], ys[start_idx]), (xs[-1], ys[-1])))

    svg_str = ""
    for (x1, y1), (x2, y2) in lines:
        svg_str += f'<line x1="{x1:.3f}" y1="{y1:.3f}" x2="{x2:.3f}" y2="{y2:.3f}" stroke="{color}" stroke-width="{stroke_width}" />\n'
    return svg_str


# ----------------- Doyle math + packers (unchanged) -----------------
def d_(z, t, p, q):
    w = z ** (p / q)
    s = (p * t + 2 * np.pi) / q
    return (z * np.cos(t) - w * np.cos(s))**2 + (z * np.sin(t) - w * np.sin(s))**2


def s_(z, p, q):
    return (z + z ** (p / q)) ** 2


def r_(z, t, p, q):
    return d_(z, t, p, q) / s_(z, p, q)


def doyle_exact_root(p, q):
    def f_(x):
        z, t = x
        f1 = r_(z, t, 0, 1) - r_(z, t, p, q)
        f2 = r_(z, t, 0, 1) - r_(z ** (p / q), (p * t + 2 * np.pi) / q, 0, 1)
        return [f1, f2]
    sol = root(f_, [2.0, 0.0], tol=1e-8)
    if not sol.success:
        raise RuntimeError("Root finding did not converge")
    z, t = sol.x
    r = np.sqrt(r_(z, t, 0, 1))
    a = z * np.exp(1j * t)
    z2 = z ** (p / q)
    t2 = (p * t + 2 * np.pi) / q
    b = z2 * np.exp(1j * t2)
    return {"a": a, "b": b, "r": r, "mod_a": z, "arg_a": t}


def doyle_exact_circles(p, q, t_param=0.0, max_d=600, scale_image=1.0, colors=("#49B49B", "#483352")):
    root = doyle_exact_root(p, q)
    start = root["a"]
    scale = root["mod_a"] ** t_param
    alpha = root["arg_a"] * t_param
    min_d = 1 / scale

    circles = []
    for i in range(1, q + 1):
        opts = {"fill": list(colors), "i": 1 + (i % 2), "min_d": min_d, "max_d": max_d}
        circles_branch = []
        mod_delta = abs(root["a"])
        color_index = opts["i"]
        qpt = start
        mod_q = abs(qpt)
        w = np.exp(1j * alpha)
        while mod_q < max_d:
            col = opts["fill"][color_index - 1]
            center = scale * qpt * w
            radius = root["r"] * scale * mod_q
            circles_branch.append((center.real, center.imag, radius, col))
            color_index = 1 + (color_index % len(opts["fill"]))
            qpt *= root["a"]
            mod_q *= mod_delta
        color_index = opts["i"] - 1 if opts["i"] > 1 else len(opts["fill"])
        qpt = start / root["a"]
        mod_q = abs(qpt)
        while mod_q > min_d:
            col = opts["fill"][color_index - 1]
            center = scale * qpt * w
            radius = root["r"] * scale * mod_q
            circles_branch.append((center.real, center.imag, radius, col))
            color_index = color_index - 1 if color_index > 1 else len(opts["fill"])
            qpt /= root["a"]
            mod_q /= mod_delta
        for c in circles_branch:
            circles.append({"x": c[0], "y": c[1], "r": c[2], "fill": c[3]})
        start *= root["b"]
    return circles


def doyle_greedy_packing(centers, initial_radius=6.0, min_radius=0.5, radius_scale=1.0, gap=0.0):
    n = len(centers)
    radii = np.zeros(n, dtype=float)
    if n == 0:
        return radii
    radii[0] = max(min_radius, initial_radius) * radius_scale
    for i in range(1, n):
        ci = centers[i]
        dists = np.linalg.norm(ci - centers[:i], axis=1) - radii[:i] - gap
        candidate = np.min(dists) if len(dists) > 0 else min_radius
        r = max(min_radius, candidate) * radius_scale
        if candidate < min_radius:
            r = min_radius * radius_scale
        radii[i] = r
    return radii


# ----------------- SVG Generator -----------------
def make_svg(n_points=300, width=800, height=800, spacing_power=1.6, turns=10,
             outlines_only=False, add_lines=False, line_angle_shift=15, line_spacing=5,
             single_spiral=False,
             mode='voronoi',
             doyle_initial_radius=6.0,
             doyle_min_radius=0.5,
             doyle_radius_scale=1.0,
             doyle_gap=0.0,
             extend_voronoi=False,
             extra_voronoi_fraction=0.3,
             extra_voronoi_turns=3,
             only_outer_red=False,
             doyle_p=8, doyle_q=16, doyle_t=0.0, doyle_max_d=600):

    if extend_voronoi and mode == 'voronoi':
        n_total = max(n_points + 1, int(n_points * (1.0 + extra_voronoi_fraction)))
        pts_all = phyllotaxis(n_total, width, height, turns + extra_voronoi_turns, spacing_power, single_spiral=single_spiral)
        points = pts_all
        real_n = n_points
    else:
        points = phyllotaxis(n_points, width, height, turns, spacing_power, single_spiral=single_spiral)
        real_n = n_points

    xmin, ymin, xmax, ymax = 0, 0, width, height

    def clip_polygon_to_bbox(poly):
        def clip_with_edge(points, edge):
            axis, val, which = edge
            new_pts = []
            for i in range(len(points)):
                a = points[i]
                b = points[(i + 1) % len(points)]
                if axis == 'x':
                    a_in = a[0] >= val if which == 'gt' else a[0] <= val
                    b_in = b[0] >= val if which == 'gt' else b[0] <= val
                else:
                    a_in = a[1] >= val if which == 'gt' else a[1] <= val
                    b_in = b[1] >= val if which == 'gt' else b[1] <= val
                if a_in and b_in:
                    new_pts.append(b)
                elif a_in and not b_in:
                    t = intersection(a, b, axis, val)
                    new_pts.append(t)
                elif not a_in and b_in:
                    t = intersection(a, b, axis, val)
                    new_pts.append(t)
                    new_pts.append(b)
            return new_pts

        def intersection(a, b, axis, val):
            ax, ay = a
            bx, by = b
            if axis == 'x':
                if bx == ax:
                    return (val, ay)
                t = (val - ax) / (bx - ax)
                y = ay + t * (by - ay)
                return (val, y)
            else:
                if by == ay:
                    return (ax, val)
                t = (val - ay) / (by - ay)
                x = ax + t * (bx - ax)
                return (x, val)

        poly_pts = poly.tolist()
        edges = [('x', xmin, 'gt'), ('x', xmax, 'lt'), ('y', ymin, 'gt'), ('y', ymax, 'lt')]
        for edge in edges:
            poly_pts = clip_with_edge(poly_pts, edge)
            if not poly_pts:
                return []
        return poly_pts

    svg_elements = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">\n',
                    f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>\n']

    random.seed(42)
    current_angle = 0

    if mode == 'voronoi':
        vor = Voronoi(points)
        regions, vertices = voronoi_finite_polygons_2d(vor, radius=max(width, height) * 2)

        # --- Identify outer edges (after clipping to bbox) ---
        eps = 1e-6
        outer_edges = set()
        xmin, ymin, xmax, ymax = 0, 0, width, height

        # Go through all ridge segments in Voronoi
        for (v1, v2) in vor.ridge_vertices:
            if v1 == -1 or v2 == -1:
                continue
            x1, y1 = vertices[v1]
            x2, y2 = vertices[v2]
            # If either endpoint is outside the bbox (slightly beyond), mark as outer edge
            if (x1 < xmin - eps or x1 > xmax + eps or
                y1 < ymin - eps or y1 > ymax + eps or
                x2 < xmin - eps or x2 > xmax + eps or
                y2 < ymin - eps or y2 > ymax + eps):
                outer_edges.add(tuple(sorted((v1, v2))))

        for i in range(real_n):
            region = regions[i]
            polygon = vertices[region]
            clipped = clip_polygon_to_bbox(polygon)
            if len(clipped) < 3:
                continue

            if outlines_only and only_outer_red:
                fill = 'none'
                clipped_edges = list(zip(clipped, np.roll(clipped, -1, axis=0)))

                # Color only edges that correspond to the "outer edges" we identified
                for (x1, y1), (x2, y2) in clipped_edges:
                    # Find closest Voronoi vertex indices for this edge (approx)
                    v_idx1 = np.argmin(np.linalg.norm(vertices - (x1, y1), axis=1))
                    v_idx2 = np.argmin(np.linalg.norm(vertices - (x2, y2), axis=1))
                    edge_key = tuple(sorted((v_idx1, v_idx2)))
                    edge_color = "#ff0000" if edge_key in outer_edges else "#000000"
                    svg_elements.append(
                        f'<line x1="{x1:.3f}" y1="{y1:.3f}" x2="{x2:.3f}" y2="{y2:.3f}" '
                        f'stroke="{edge_color}" stroke-width="0.6" />\n'
                    )
            else:
                # normal polygon rendering
                if outlines_only:
                    fill = 'none'
                    stroke_color = '#ff0000' if only_outer_red else '#000000'
                else:
                    h = (i / real_n + random.uniform(-0.02, 0.02)) % 1.0
                    fill = hsv_to_hex(h, 0.5, 0.9)
                    stroke_color = '#ffffff'

                svg_elements.append(polygon_to_svg(clipped, fill, stroke=stroke_color, stroke_width=0.6, fill_opacity=0.7))

                if add_lines and not outlines_only:
                    current_angle += line_angle_shift
                    svg_elements.append(lines_in_polygon(clipped, line_spacing, current_angle, color="#000000", stroke_width=0.4))

    elif mode == 'doyle_greedy':
        radii = doyle_greedy_packing(points, initial_radius=doyle_initial_radius, min_radius=doyle_min_radius,
                                     radius_scale=doyle_radius_scale, gap=doyle_gap)
        for i, (x, y) in enumerate(points):
            fill = hsv_to_hex((i / n_points) % 1.0, 0.5, 0.9)
            svg_elements.append(circle_to_svg(x, y, radii[i], fill, stroke="#000000", stroke_width=0.3))

    elif mode == 'doyle_exact':
        circles = doyle_exact_circles(doyle_p, doyle_q, t_param=doyle_t, max_d=doyle_max_d)
        for c in circles:
            x, y, r, col = c['x'], c['y'], c['r'], c['fill']
            cx, cy = x * 0.7 + width / 2, y * 0.7 + height / 2
            svg_elements.append(circle_to_svg(cx, cy, r * 30, col, stroke="#000000", stroke_width=0.3))

    svg_elements.append('</svg>')
    return ''.join(svg_elements)


# ----------------- Interactive UI -----------------
def show_ui():
    mode_dropdown = widgets.Dropdown(options=['voronoi', 'doyle_greedy', 'doyle_exact'], value='voronoi', description='Mode:')
    n_points_slider = widgets.IntSlider(value=400, min=50, max=1500, step=50, description='N Points')
    spacing_slider = widgets.FloatSlider(value=1.6, min=0.2, max=3.0, step=0.05, description='Spacing Power')
    turns_slider = widgets.FloatSlider(value=10, min=1, max=40, step=1, description='Turns')
    outlines_toggle = widgets.Checkbox(value=False, description='Outlines Only')
    outer_red_toggle = widgets.Checkbox(value=False, description='Only Outer Line Red')
    add_lines_toggle = widgets.Checkbox(value=False, description='Add Lines')
    single_spiral_toggle = widgets.Checkbox(value=False, description='Single Spiral')
    line_angle_shift_slider = widgets.IntSlider(value=15, min=1, max=60, step=1, description='Angle Shift')
    line_spacing_slider = widgets.IntSlider(value=5, min=1, max=20, step=1, description='Line Spacing')

    doyle_init_slider = widgets.FloatSlider(value=6.0, min=0.1, max=20.0, step=0.1, description='Init Radius')
    doyle_min_slider = widgets.FloatSlider(value=0.5, min=0.01, max=5.0, step=0.01, description='Min Radius')
    doyle_scale_slider = widgets.FloatSlider(value=1.0, min=0.1, max=2.0, step=0.05, description='Scale')
    doyle_gap_slider = widgets.FloatSlider(value=0.0, min=0.0, max=5.0, step=0.1, description='Gap')

    doyle_p_slider = widgets.IntSlider(value=8, min=1, max=20, step=1, description='p')
    doyle_q_slider = widgets.IntSlider(value=16, min=2, max=40, step=1, description='q')
    doyle_t_slider = widgets.FloatSlider(value=0.0, min=0.0, max=5.0, step=0.05, description='t')
    doyle_maxd_slider = widgets.FloatSlider(value=600.0, min=100.0, max=2000.0, step=50.0, description='max_d')

    extend_voronoi_toggle = widgets.Checkbox(value=False, description='Extend Voronoi')
    extra_voronoi_fraction_slider = widgets.FloatSlider(value=0.3, min=0.0, max=1.0, step=0.05, description='Extra Fraction')
    extra_voronoi_turns_slider = widgets.IntSlider(value=3, min=0, max=10, step=1, description='Extra Turns')

    save_button = widgets.Button(description='Save SVG')
    output = widgets.Output()

    common_widgets = [mode_dropdown, n_points_slider, spacing_slider, turns_slider, outlines_toggle, outer_red_toggle,
                      add_lines_toggle, single_spiral_toggle, line_angle_shift_slider, line_spacing_slider,
                      extend_voronoi_toggle, extra_voronoi_fraction_slider, extra_voronoi_turns_slider]

    doyle_widgets = [doyle_init_slider, doyle_min_slider, doyle_scale_slider, doyle_gap_slider,
                     doyle_p_slider, doyle_q_slider, doyle_t_slider, doyle_maxd_slider]

    ui = widgets.VBox(common_widgets + doyle_widgets + [save_button, output])

    def update(*args):
        with output:
            output.clear_output()
            svg_str = make_svg(
                n_points=n_points_slider.value,
                spacing_power=spacing_slider.value,
                turns=turns_slider.value,
                outlines_only=outlines_toggle.value,
                add_lines=add_lines_toggle.value,
                single_spiral=single_spiral_toggle.value,
                line_angle_shift=line_angle_shift_slider.value,
                line_spacing=line_spacing_slider.value,
                extend_voronoi=extend_voronoi_toggle.value,
                extra_voronoi_fraction=extra_voronoi_fraction_slider.value,
                extra_voronoi_turns=extra_voronoi_turns_slider.value,
                only_outer_red=outer_red_toggle.value,
                mode=mode_dropdown.value,
                doyle_initial_radius=doyle_init_slider.value,
                doyle_min_radius=doyle_min_slider.value,
                doyle_radius_scale=doyle_scale_slider.value,
                doyle_gap=doyle_gap_slider.value,
                doyle_p=doyle_p_slider.value,
                doyle_q=doyle_q_slider.value,
                doyle_t=doyle_t_slider.value,
                doyle_max_d=doyle_maxd_slider.value,
            )
            display(SVG(svg_str))

    for w in common_widgets + doyle_widgets:
        w.observe(update, 'value')

    def save_svg(b):
        svg_str = make_svg(
            n_points=n_points_slider.value,
            spacing_power=spacing_slider.value,
            turns=turns_slider.value,
            outlines_only=outlines_toggle.value,
            add_lines=add_lines_toggle.value,
            single_spiral=single_spiral_toggle.value,
            line_angle_shift=line_angle_shift_slider.value,
            line_spacing=line_spacing_slider.value,
            extend_voronoi=extend_voronoi_toggle.value,
            extra_voronoi_fraction=extra_voronoi_fraction_slider.value,
            extra_voronoi_turns=extra_voronoi_turns_slider.value,
            only_outer_red=outer_red_toggle.value,
            mode=mode_dropdown.value,
            doyle_initial_radius=doyle_init_slider.value,
            doyle_min_radius=doyle_min_slider.value,
            doyle_radius_scale=doyle_scale_slider.value,
            doyle_gap=doyle_gap_slider.value,
            doyle_p=doyle_p_slider.value,
            doyle_q=doyle_q_slider.value,
            doyle_t=doyle_t_slider.value,
            doyle_max_d=doyle_maxd_slider.value,
        )
        Path('output.svg').write_text(svg_str)
        with output:
            print("SVG saved as output.svg")

    save_button.on_click(save_svg)
    display(ui)
    update()

show_ui()
