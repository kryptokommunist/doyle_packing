import numpy as np
import svgwrite
from typing import List, Tuple, Optional
from matplotlib.path import Path as MplPath
from .geometry import Shape, convert_polygon_to_array, apply_polygon_inset, lines_in_polygon

class DrawingContext:
    """
    Handles SVG drawing and coordinate normalization.

    Manages the SVG drawing object and scales geometric elements to fit within the viewbox.
    """
    def __init__(self, size: int = 800):
        """
        Initializes a DrawingContext.

        Args:
            size: The size of the square drawing area in pixels.
        """
        self.size = size
        self.dwg = svgwrite.Drawing(size=(size, size))
        self.scale_factor = 1.0

    def set_normalization_scale(self, elements: List['CircleElement']):
        """
        Calculates and sets the scale factor to fit elements into the viewbox.

        The scale factor is determined by the maximum extent of the circles (center + radius).

        Args:
            elements: A list of CircleElement objects to consider for scaling.
        """
        if not elements:
            self.scale_factor = 1.0
            self.dwg.viewbox(-self.size/2, -self.size/2, self.size, self.size)
            return

        coords = [c.center for c in elements]
        radii = [c.radius for c in elements]

        # Find the maximum extent including circle radii
        max_extent = max(max(abs(z.real) + r, abs(z.imag) + r) for z, r in zip(coords, radii))

        # Tighter padding: scale such that the max extent fits within 95% of the viewbox half-size
        self.scale_factor = (self.size / 2.1) / max_extent
        # Set the viewbox to center the drawing
        self.dwg.viewbox(-self.size/2, -self.size/2, self.size, self.size)


    def draw_scaled(self, element: Shape, **kwargs):
        """
        Draws a shape element after scaling its coordinates.

        Args:
            element: The Shape element to draw.
            **kwargs: Additional keyword arguments to pass to the element's to_svg method.
        """
        if isinstance(element, CircleElement):
            # Apply scaling to center and radius
            scaled_center = element.center * self.scale_factor
            scaled_radius = element.radius * self.scale_factor
            # Create a temporary scaled element for drawing purposes
            scaled_element = CircleElement(scaled_center, scaled_radius, element.visible)
            svg_element = scaled_element.to_svg(self.dwg, **kwargs)

        elif isinstance(element, ArcElement):
            # Scale the underlying circle and points for the arc
            scaled_circle = CircleElement(
                element.circle.center * self.scale_factor,
                element.circle.radius * self.scale_factor
            )
            # Scale start and end points
            scaled_start = element.start * self.scale_factor
            scaled_end = element.end * self.scale_factor
            # Create a temporary scaled element for drawing purposes
            scaled_element = ArcElement(
                scaled_circle,
                scaled_start,
                scaled_end,
                element.steps,
                element.visible
            )
            svg_element = scaled_element.to_svg(self.dwg, **kwargs)

        else:
            # Unknown element type; skip drawing
            svg_element = None

        if svg_element is not None:
            self.dwg.add(svg_element)

    def make_line_pattern(self, pattern_id="linePattern", spacing=10, angle=45, color="black", stroke_width=1):
        """Create a robust, angle-agnostic parallel line pattern.

        - spacing: distance between lines in user units (pixels)
        - angle: rotation in degrees (0 = vertical lines); positive is CCW
        """
        # Define a square pattern tile in user space; rotate the pattern itself
        pattern = self.dwg.pattern(
            id=pattern_id,
            patternUnits="userSpaceOnUse",
            size=(spacing, spacing),
        )

        # Rotate the pattern so the single vertical line becomes angled globally
        pattern['patternTransform'] = f"rotate({angle})"

        # Draw a vertical line spanning the tile height; duplicate at tile edge to avoid seams
        line_style = {
            'stroke': color,
            'stroke_width': stroke_width,
            'stroke_linecap': 'butt',
        }
        pattern.add(self.dwg.line(start=(0, 0), end=(0, spacing), **line_style))
        # Edge duplicate to mitigate antialiasing gaps at tile boundaries
        pattern.add(self.dwg.line(start=(spacing, 0), end=(spacing, spacing), **line_style))

        # Register pattern in defs
        self.dwg.defs.add(pattern)
        return pattern
    
    def _draw_clipped_line_fill(self, coords, points, stroke, stroke_width, line_pattern_settings, draw_outline, line_offset):
        """Draw polygon with clipped parallel line fill."""
        line_spacing, line_angle = line_pattern_settings
        
        # Generate clipped line segments
        line_segments = lines_in_polygon(
            points, 
            line_spacing=line_spacing, 
            angle=line_angle,
            offset=line_offset
        )
        
        # Optionally draw polygon outline
        if draw_outline:
            self.dwg.add(self.dwg.polygon(
                points=coords, 
                fill="none", 
                stroke=stroke, 
                stroke_width=stroke_width
            ))
        
        # Draw clipped line segments
        line_color = stroke or "#000000"
        for (x1, y1), (x2, y2) in line_segments:
            self.dwg.add(self.dwg.line(
                start=(x1, y1), 
                end=(x2, y2),
                stroke=line_color, 
                stroke_width=0.5
            ))
    
    def draw_group_outline(self, points: List[complex], fill: Optional[str] = None, 
                          stroke: Optional[str] = None, stroke_width: float = 1.0, 
                          line_pattern_settings = (3, 0), use_clipped_lines: bool = False, 
                          draw_outline: bool = True, line_offset: float = 0):
        """Draw a polygon with optional line pattern fill.
        
        Args:
            points: Complex numbers representing polygon vertices
            fill: Fill type ("pattern", "clipped_lines", color, or None)
            stroke: Outline color
            stroke_width: Outline width
            line_pattern_settings: Tuple of (spacing, angle) for line fills
            use_clipped_lines: Use precise clipped lines instead of SVG patterns
            draw_outline: Whether to draw polygon outline
            line_offset: Inward offset for line clipping
        """
        if not points:
            return
        
        coords = [(p.real, p.imag) for p in points]
        
        # Use clipped lines for pattern fills (new method)
        if use_clipped_lines or fill in ("pattern", "clipped_lines"):
            self._draw_clipped_line_fill(
                coords, points, stroke, stroke_width, 
                line_pattern_settings, draw_outline, line_offset
            )
        elif fill is not None:
            # Solid color fill
            self.dwg.add(self.dwg.polygon(
                points=coords, 
                fill=fill, 
                stroke=stroke, 
                stroke_width=stroke_width
            ))
        else:
            # No fill - just outline
            self.dwg.add(self.dwg.polyline(
                points=coords, 
                fill="none", 
                stroke=stroke or "#000000", 
                stroke_width=stroke_width
            ))


    def to_string(self) -> str:
        """
        Returns the SVG drawing as a string.
        """
        return self.dwg.tostring()

