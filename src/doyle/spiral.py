import numpy as np
from scipy.optimize import root
from typing import List, Tuple, Optional, Dict, TYPE_CHECKING
import math
import itertools
from .geometry import CircleElement, ArcElement, ArcGroup

if TYPE_CHECKING:
    from .drawing import DrawingContext

class DoyleSpiral:
    """Manages the generation, intersection, and rendering of a Doyle spiral."""
    def __init__(self, p: int = 7, q: int = 32, t: float = 0, max_d: float = 2000, arc_mode: str = "closest", num_gaps: int = 2):
        """
        Initializes a DoyleSpiral.

        Args:
            p: The p parameter for the spiral.
            q: The q parameter for the spiral.
            t: The t parameter for the spiral.
            max_d: The maximum distance from the center for generating circles.
            arc_mode: The mode for selecting arcs ('closest', 'farthest', 'alternating', 'all', 'random', 'symmetric', 'angular').
            num_gaps: The number of "gaps" or arcs not to draw in 'arram_boyle' mode.
        """
        self.p, self.q, self.t, self.max_d = p, q, t, max_d
        self.arc_mode = arc_mode
        self.num_gaps = num_gaps
        # Solve the underlying Doyle system for the given parameters
        self.root = DoyleMath.solve(p, q)
        self.circles: List[CircleElement] = []
        self.outer_circles: List[CircleElement] = []
        self._is_generated = False

        # ArcGroups keyed by circle id or arbitrary name
        self.arc_groups: Dict[str, ArcGroup] = {}

    def generate_circles(self):
        """Generates the main set of visible circles based on the spiral parameters."""
        # Extract parameters from the Doyle solution
        r = self.root["r"]
        start = self.root["a"]
        scale = self.root["mod_a"] ** self.t
        alpha = self.root["arg_a"] * self.t
        min_d = 1 / scale
        a, b = self.root["a"], self.root["b"]
        w = np.exp(1j * alpha)

        circles = []
        # Generate q families of circles
        for _ in range(1, self.q + 1):
            # Generate circles moving outward from the center
            qv = start
            mod_q = abs(qv)
            while mod_q < self.max_d:
                center = scale * qv * w
                circles.append(CircleElement(center, r * scale * mod_q))
                qv *= a
                mod_q *= abs(a)

            # Generate circles moving inward towards the center
            qv = start / a # Start one step inward from the base
            mod_q = abs(qv)
            while mod_q > min_d:
                center = scale * qv * w
                circles.append(CircleElement(center, r * scale * mod_q))
                qv /= a
                mod_q /= abs(a)

            # Move to the next family of circles
            start *= b

        self.circles = circles
        self._is_generated = True

    def generate_outer_circles(self):
        """Generates exactly one outer ring of invisible circles for Arram-Boyle closure."""
        r = self.root["r"]
        start = self.root["a"]
        scale = self.root["mod_a"] ** self.t
        alpha = self.root["arg_a"] * self.t
        a, b = self.root["a"], self.root["b"]
        w = np.exp(1j * alpha)

        outer_circles = []
        # Generate one outer circle for each of the q families
        for _ in range(1, self.q + 1):
            qv = start
            # Fast-forward to the last generated visible circle's 'qv'
            while abs(qv) * scale < self.max_d:
                qv *= a

            # Add exactly one more circle (the next one outward)
            center = scale * qv * w
            # Use a generous multiplier for max_d check to ensure we get the next ring
            if abs(qv) * scale < self.max_d * abs(a) * 2:
                outer_circles.append(CircleElement(center, r * scale * abs(qv), visible=False))

            start *= b

        self.outer_circles = outer_circles

    def compute_all_intersections(self):
        """Computes all intersections for visible and outer circles."""
        all_circles = self.circles + self.outer_circles
        for c in all_circles:
            # All circles need the spiral center (0+0j) as the reference for sorting
            c.compute_intersections(all_circles, start_reference=0+0j)

    # ---- ArcGroup management APIs ----
    def create_group_for_circle(self, circle: CircleElement, name: Optional[str] = None) -> ArcGroup:
        """
        Create an ArcGroup for a specific circle.

        Args:
            circle: The CircleElement for which to create the group.
            name: An optional name for the group. If None, a name based on the circle ID is used.

        Returns:
            The created ArcGroup object.
        """
        key = name or f"circle_{circle.id}"
        group = ArcGroup(name=key)
        self.arc_groups[key] = group
        return group

    def add_arc_to_group(self, group_key: str, arc: ArcElement):
        """
        Add an ArcElement to an existing group (or create group if missing).

        Args:
            group_key: The key/name of the ArcGroup.
            arc: The ArcElement to add to the group.
        """
        if group_key not in self.arc_groups:
            self.arc_groups[group_key] = ArcGroup(name=group_key)
        self.arc_groups[group_key].add_arc(arc)

    # ---- Rendering Helpers ----
    
    def _compute_ring_indices(self):
        """Compute ring index mapping based on circle radii."""
        radii = [round(c.radius, 6) for c in self.circles]
        unique_radii = sorted(set(radii))
        return {r: i for i, r in enumerate(unique_radii)}
    
    def _create_arc_groups_for_circles(self, radius_to_ring, spiral_center, debug_groups, 
                                       add_fill_pattern, draw_group_outline, context):
        """Create arc groups for visible circles and draw individual arcs."""
        for c in self.circles:
            if len(c.intersections) != 6:
                continue
            
            # Select arcs based on mode
            arcs_to_draw = ArcSelector.select_arcs_for_gaps(
                c, spiral_center, num_gaps=self.num_gaps, mode=self.arc_mode
            )
            if not arcs_to_draw:
                continue
            
            # Create group for this circle
            group = self.create_group_for_circle(c)
            group.ring_index = radius_to_ring.get(round(c.radius, 6), None)
            
            # Assign debug color if needed
            if debug_groups:
                rng = random.Random(c.id)
                group.debug_fill = "#%06x" % rng.randint(0, 0xFFFFFF)
                group.debug_stroke = "#000000"
            
            # Create and add arcs to group
            for i, j in arcs_to_draw:
                start = c.intersections[i][0]
                end = c.intersections[j][0]
                arc = ArcElement(c, start, end, visible=True)
                
                # Draw arc only if not using fill pattern and outline enabled
                if not add_fill_pattern and draw_group_outline:
                    context.draw_scaled(arc)
                
                group.add_arc(arc)
    
    def _draw_outer_closure_arcs(self, spiral_center, debug_groups, red_outline, 
                                 add_fill_pattern, draw_group_outline, context):
        """Draw closure arcs from outer invisible circles."""
        for c in self.outer_circles:
            if len(c.intersections) < 2:
                continue
            
            pts = [p for p, _ in c.intersections]
            arc_distances = []
            
            # Calculate arc midpoint distances to center
            for i in range(len(pts)):
                j = (i + 1) % len(pts)
                midpoint = (pts[i] + pts[j]) / 2
                arc_distances.append((abs(midpoint - spiral_center), i, j))
            
            # Draw 2nd and 3rd closest arcs
            arc_distances.sort()
            for idx in range(1, min(3, len(arc_distances))):
                _, i, j = arc_distances[idx]
                arc = ArcElement(c, pts[i], pts[j], visible=True)
                
                # Draw if red outline enabled or (no fill and outline enabled)
                if red_outline or (not add_fill_pattern and draw_group_outline):
                    color = "#ff0000" if red_outline else "#000000"
                    context.draw_scaled(arc, color=color, width=1.2)
                
                # Add to outer closure group
                key = f"outer_{c.id}"
                if key not in self.arc_groups:
                    self.arc_groups[key] = ArcGroup(name=key)
                    self.arc_groups[key].ring_index = -1
                    if debug_groups:
                        rng = random.Random(c.id + 1000)
                        self.arc_groups[key].debug_fill = "#%06x" % rng.randint(0, 0xFFFFFF)
                        self.arc_groups[key].debug_stroke = "#000000"
                
                self.arc_groups[key].add_arc(arc)
    
    # ---- Rendering ----

    def _render_arram_boyle(self, context: "DrawingContext", debug_groups: bool = False, 
                           add_fill_pattern: bool = False, fill_pattern_spacing: float = 5.0, 
                           fill_pattern_angle: float = 0.0, red_outline: bool = False, 
                           draw_group_outline: bool = True, fill_pattern_offset: float = 0):
        """Render spiral in Arram-Boyle mode with arc groups.
        
        Creates arc groups for each circle, draws closure arcs, and optionally
        adds pattern fills or debug visualization.
        """
        # Setup
        self.generate_outer_circles()
        self.compute_all_intersections()
        context.set_normalization_scale(self.circles + self.outer_circles)
        
        spiral_center = 0 + 0j
        self.arc_groups.clear()
        
        # Compute ring indices for all circles
        radius_to_ring_index = self._compute_ring_indices()
        
        # Create arc groups for visible circles
        self._create_arc_groups_for_circles(
            radius_to_ring_index, spiral_center, debug_groups,
            add_fill_pattern, draw_group_outline, context
        )
        
        # Draw outer closure arcs
        self._draw_outer_closure_arcs(
            spiral_center, debug_groups, red_outline,
            add_fill_pattern, draw_group_outline, context
        )
        
        #"""
        # complete arc groups - This block appears to add additional arcs based on neighbor circles
        # and specific indices. This might require further review for its geometric purpose.
        max_index = max([group.ring_index for group in self.arc_groups.values()])
        for c in self.circles:
            if not f"circle_{c.id}" in self.arc_groups.keys(): continue
            group = self.arc_groups[f"circle_{c.id}"]
            neigh_lst = c.get_neighbour_circles()
            if len(neigh_lst) == 6:
                for k in [-1,-2,-5,-6]: #[0,-1,2,3]: # Indices to select neighbors
                    neigh_a = neigh_lst[k]
                    # Select all arcs from the neighbor circle
                    arcs_a = ArcSelector.select_arcs_for_gaps(neigh_a, spiral_center, mode="all")
                    #print(len(arcs_a)) # Debug print, can be removed
                    if len(arcs_a) == 6:
                        # Select specific arc index based on neighbor index k
                        arc_i = 0
                        if k == -1: arc_i = -3
                        if k == -2: arc_i = -2
                        if k == -5: arc_i = 1
                        if k == -6: arc_i = 0
                        i,j = arcs_a[arc_i]
                        # Get start and end points from the neighbor circle's intersections
                        start_a = neigh_a.intersections[i][0]
                        end_a = neigh_a.intersections[j][0]
                        # Create a new arc element from the neighbor circle
                        arc_a = ArcElement(neigh_a, start_a, end_a, visible=True)
                        # Add this arc to the current circle's group

                        group.add_arc(arc_a)
                    else:
                        # Similar logic for neighbors with a different number of arcs
                        arc_i = 0
                        if k == -1: arc_i = -3
                        if k == -2: arc_i = -2
                        if k == -5: arc_i = 1
                        if k == -6: arc_i = 0
                        i,j = arcs_a[arc_i]
                        start_a = neigh_a.intersections[i][0]
                        end_a = neigh_a.intersections[j][0]
                        arc_a = ArcElement(neigh_a, start_a, end_a, visible=True)
                        group.add_arc(arc_a)
        
        #"""
        # After drawing all arcs, render group outlines (debug fills) if debug is enabled
        if debug_groups:
            for key, group in self.arc_groups.items():
                # Exclude outer circle groups from default debug rendering
                if "outer" in key: continue
                # render group fill/outline
                group.to_svg_fill(context, debug=True, fill_opacity=0.25)

        #"""
        # After drawing all arcs, render line fillings
        if add_fill_pattern:
            for key, group in self.arc_groups.items():
                # Exclude outer circle groups from default debug rendering
                if "outer" in key: continue
                # render group fill/outline
                #group.to_svg_fill(context, debug=True, fill_opacity=0.25)
                # Interpret fill_pattern_angle as per-ring angle offset (degrees)
                ring_idx = group.ring_index if group.ring_index is not None else 0
                line_settings = (fill_pattern_spacing, ring_idx * fill_pattern_angle)
                group.to_svg_fill(context, debug=False, fill_opacity=0.25, pattern_fill=True, line_settings=line_settings, draw_outline=draw_group_outline, line_offset=fill_pattern_offset)

        #draw red outline if option is set
        for c in self.circles:
            if not f"circle_{c.id}" in self.arc_groups.keys(): continue
            group = self.arc_groups[f"circle_{c.id}"]
            
            for i, arc in enumerate(group.arcs):
                if red_outline and (i in [3,2]) and group.ring_index == max_index: 
                    color = "#ff0000"
                    context.draw_scaled(arc, color=color, width=1.2)

        # ring_index has been assigned at creation time for inner groups and -1 for outer groups


    def _render_doyle(self, context: "DrawingContext"):
        """Handles the standard Doyle rendering mode (full circles)."""
        # Set normalization scale based on visible circles
        context.set_normalization_scale(self.circles)
        # Draw all visible circles
        for c in self.circles:
            context.draw_scaled(c)  # Use default circle color


    def to_svg(self, mode: str = "doyle", size: int = 800, debug_groups: bool = False, add_fill_pattern: bool = False, fill_pattern_spacing: float = 5.0, fill_pattern_angle: float = 0.0, red_outline: bool = False, draw_group_outline: bool = True, fill_pattern_offset: float = 0) -> str:
        """
        Generates the SVG representation of the spiral in the specified mode.

        Args:
            mode: The rendering mode ('doyle' for full circles, 'arram_boyle' for arcs).
            size: The size of the output SVG (width and height).
            debug_groups: If True, render arc group outlines with debug colors in 'arram_boyle' mode.
            add_fill_pattern: If True, add line pattern fills to arc groups.
            fill_pattern_spacing: Spacing between lines in the pattern.
            fill_pattern_angle: Angle increment per ring for line patterns.
            red_outline: If True, draw red outline on specific arcs.
            draw_group_outline: If True, draw the arc group polygon outlines (default: True).
            fill_pattern_offset: Inset distance from polygon edge for line clipping (positive = shrink inward).

        Returns:
            A string containing the SVG representation of the spiral.

        Raises:
            ValueError: If an unknown rendering mode is provided.
        """
        # Generate circles if not already generated
        if not self._is_generated:
            self.generate_circles()

        # Create a drawing context
        from .drawing import DrawingContext
        context = DrawingContext(size)

        # Render based on the selected mode
        if mode == "doyle":
            self._render_doyle(context)
        elif mode == "arram_boyle":
            self._render_arram_boyle(context, debug_groups=debug_groups, add_fill_pattern=add_fill_pattern, fill_pattern_spacing=fill_pattern_spacing, fill_pattern_angle=fill_pattern_angle, red_outline=red_outline, draw_group_outline=draw_group_outline, fill_pattern_offset=fill_pattern_offset)
        else:
            raise ValueError(f"Unknown rendering mode: {mode}")

        # Return the SVG as a string
        return context.to_string()

# ============================================
# Doyle Math and Arc Selection
# ============================================

class DoyleMath:
    """Static methods for solving the Doyle spiral system."""
    @staticmethod
    def d_(z: float, t: float, p: int, q: int) -> float:
        # Helper function for the Doyle equation
        w = z ** (p / q)
        s = (p * t + 2 * np.pi) / q
        return (z * np.cos(t) - w * np.cos(s))**2 + (z * np.sin(t) - w * np.sin(s))**2

    @staticmethod
    def s_(z: float, p: int, q: int) -> float:
        # Helper function for the Doyle equation
        return (z + z ** (p / q)) ** 2

    @staticmethod
    def r_(z: float, t: float, p: int, q: int) -> float:
        # Helper function for the Doyle equation
        return DoyleMath.d_(z, t, p, q) / DoyleMath.s_(z, p, q)

    @staticmethod
    def solve(p: int, q: int) -> dict:
        """
        Solves the Doyle system for a given (p, q).

        Args:
            p: The p parameter of the Doyle spiral.
            q: The q parameter of the spiral.

        Returns:
            A dictionary containing the solution parameters 'a', 'b', 'r', 'mod_a', and 'arg_a'.
        """
        # Define the system of equations to solve
        def f_(x: np.ndarray) -> List[float]:
            z, t = x
            f1 = DoyleMath.r_(z, t, 0, 1) - DoyleMath.r_(z, t, p, q)
            f2 = DoyleMath.r_(z, t, 0, 1) - DoyleMath.r_(z ** (p / q), (p * t + 2 * np.pi) / q, 0, 1)
            return [f1, f2]

        # Use scipy's root finder to solve the system
        sol = root(f_, [2.0, 0.0], tol=1e-6)
        z, t = sol.x
        # Calculate spiral parameters from the solution
        r = np.sqrt(DoyleMath.r_(z, t, 0, 1))
        a = z * np.exp(1j * t)
        b = z ** (p / q) * np.exp(1j * (p * t + 2 * np.pi) / q)
        return {"a": a, "b": b, "r": r, "mod_a": z, "arg_a": t}

class ArcSelector:
    """Static methods for selecting which arcs to draw based on a mode."""
    @staticmethod
    def select_arcs_for_gaps(
        circle: CircleElement,
        spiral_center: complex,
        num_gaps: int = 2,
        mode: str = "closest"
    ) -> List[Tuple[int, int]]:
        """
        Selects arcs from a circle based on geometric or heuristic rules.
        Returns a list of arc index pairs (start_idx, end_idx) to be drawn.

        Args:
            circle: The CircleElement from which to select arcs.
            spiral_center: The center of the Doyle spiral (used as a reference point).
            num_gaps: The number of "gaps" or arcs *not* to draw.
            mode: The selection mode ('closest', 'farthest', 'alternating', 'all', 'random', 'symmetric', 'angular').

        Returns:
            A list of tuples, where each tuple represents the start and end index of an arc to be drawn,
            based on the sorted intersection points of the circle.
        """
        # Get intersection points from the circle
        pts = [p for p, _ in circle.intersections]
        n = len(pts)
        c = circle.center # Center of the current circle
        s = spiral_center # Center of the spiral

        if n < 2:
            return []

        # Create pairs of indices representing potential arcs between consecutive intersection points
        arcs = [(i, (i + 1) % n) for i in range(n)]
        # Calculate midpoints of these potential arcs
        midpoints = [(pts[i] + pts[j]) / 2 for i, j in arcs]

        # Select arcs based on the specified mode
        if mode in ("closest", "farthest"):
            # Calculate distances of arc midpoints to the line connecting circle center and spiral center
            line_vec = s - c
            # Handle the case where the line vector is zero (circle center is spiral center)
            if abs(line_vec) < 1e-6:
                 # In this case, all distances to the line are effectively zero.
                 # Sort by distance from the spiral center directly.
                 distances = [abs(m - s) for m in midpoints]
            else:
                 distances = [abs(np.imag(np.conj(line_vec) * (m - c))) / abs(line_vec) for m in midpoints]

            # Sort arcs based on distance, reverse if mode is 'farthest'
            sorted_arcs = [arc for _, arc in sorted(zip(distances, arcs), reverse=(mode == "farthest"))]
            # Select arcs to draw (skip the ones creating gaps)
            arcs_to_draw = sorted_arcs[num_gaps:]

        elif mode == "alternating":
            # Select arcs in an alternating pattern
            if num_gaps >= n:
                return [] # Skip all if num_gaps is greater than or equal to number of arcs
            # Determine the interval for skipping
            interval = max(1, n // (num_gaps + 1))
            arcs_to_draw = [arcs[i] for i in range(n) if (i % (interval)) != 0]

        elif mode == "all":
            # Select all arcs
            arcs_to_draw = arcs
        elif mode == "random":
            # Randomly select arcs to skip
            rng = np.random.default_rng()
            skip_idxs = rng.choice(range(n), size=min(num_gaps, n), replace=False)
            arcs_to_draw = [arc for i, arc in enumerate(arcs) if i not in skip_idxs]

        elif mode == "symmetric":
            # Select symmetric gaps around the line to the spiral center
            line_vec = s - c
             # Handle the case where the line vector is zero (circle center is spiral center)
            if abs(line_vec) < 1e-6:
                 # In this case, all angles are relative to the center, sort by angle from the x-axis
                 angles = [np.angle(m - c) for m in midpoints]
                 target_angle = 0 # Reference angle is along the positive x-axis
            else:
                angles = [np.angle(m - c) for m in midpoints]
                target_angle = np.angle(s - c)

            angular_diffs = [abs(np.angle(np.exp(1j * (a - target_angle)))) for a in angles]
            sorted_indices = np.argsort(angular_diffs)

            # Choose indices for half the gaps
            num_half_gaps = num_gaps // 2
            chosen = sorted_indices[:num_half_gaps]

            # Find symmetric indices - this needs to be relative to the circle's intersections, not angle directly
            # Find the intersection points closest to the line (which correspond to the smallest angular_diffs)
            # Then find the points roughly 180 degrees around the circle from those points.
            skip_indices = set()
            for idx in chosen:
                skip_indices.add(idx) # Add the original index
                # Find the intersection point corresponding to this midpoint arc
                midpoint_pt = midpoints[idx]
                # Find the index of the intersection point that is roughly 180 degrees opposite on the circle
                opposite_angle = np.angle(midpoint_pt - c) + np.pi
                opposite_index = -1
                min_angle_diff = float('inf')
                for i in range(n):
                    pt_angle = np.angle(pts[i] - c)
                    diff = abs(np.angle(np.exp(1j * (pt_angle - opposite_angle))))
                    if diff < min_angle_diff:
                        min_angle_diff = diff
                        opposite_index = i
                # The arc starting at the opposite_index is the symmetric one
                symmetric_arc_start_index = opposite_index
                # Find which arc index starts at symmetric_arc_start_index
                for i, (start, end) in enumerate(arcs):
                    if start == symmetric_arc_start_index:
                         # Add the arc index (not the intersection point index) to the skip list
                         skip_indices.add(i)
                         break

            # If num_gaps is odd, and the circle has an intersection point very close to the line,
            # we skip the arc that crosses the line.
            if num_gaps % 2 != 0 and abs(line_vec) > 1e-6:
                 # Find the intersection point closest to the line
                 intersection_distances = [abs(np.imag(np.conj(line_vec) * (p - c))) / abs(line_vec) for p, _ in circle.intersections]
                 closest_intersection_idx = np.argmin(intersection_distances)
                 # The arc that crosses the line is likely the one starting at or ending at this point
                 # We'll skip the arc starting at this point
                 for i, (start, end) in enumerate(arcs):
                     if start == closest_intersection_idx:
                         skip_indices.add(i)
                         break

            # Select arcs to draw
            arcs_to_draw = [arc for i, arc in enumerate(arcs) if i not in skip_indices]


        elif mode == "angular":
            # Select arcs based on angular distance from the line to the spiral center
            line_vec = s - c
             # Handle the case where the line vector is zero (circle center is spiral center)
            if abs(line_vec) < 1e-6:
                 # In this case, all angles are relative to the center, sort by angle from the x-axis
                 angles = [np.angle(m - c) for m in midpoints]
                 target_angle = 0 # Reference angle is along the positive x-axis
            else:
                angles = [np.angle(m - c) for m in midpoints]
                target_angle = np.angle(s - c)

            angular_diffs = [abs(np.angle(np.exp(1j * (a - target_angle)))) for a in angles]
            # Sort arcs by angular difference
            sorted_arcs = [arc for _, arc in sorted(zip(angular_diffs, arcs))]
            # Select arcs to draw (skip the ones creating gaps)
            arcs_to_draw = sorted_arcs[num_gaps:]

        else:
            raise ValueError(f"Unknown mode '{mode}'")

        return arcs_to_draw

# ============================================
# Interactive UI
# ============================================

def spiral_ui():
    """
    Sets up the interactive UI for the Doyle Spiral with debug toggle for ArcGroups.

    Creates sliders and dropdowns for controlling spiral parameters and rendering mode,
    and displays the generated SVG. Includes controls for manually adding arcs to groups.
    """
    # Create interactive widgets for controlling spiral parameters and rendering
