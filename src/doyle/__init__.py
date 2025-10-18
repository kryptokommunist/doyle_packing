"""Doyle spiral visualization library."""

from .geometry import (
    Shape,
    CircleElement,
    ArcElement,
    ArcGroup,
    convert_polygon_to_array,
    apply_polygon_inset,
    line_segment_intersection,
    find_line_polygon_intersections,
    lines_in_polygon
)
from .drawing import DrawingContext
from .spiral import DoyleSpiral, DoyleMath, ArcSelector

__all__ = [
    'Shape',
    'CircleElement',
    'ArcElement',
    'ArcGroup',
    'DrawingContext',
    'DoyleSpiral',
    'DoyleMath',
    'ArcSelector',
    'convert_polygon_to_array',
    'apply_polygon_inset',
    'line_segment_intersection',
    'find_line_polygon_intersections',
    'lines_in_polygon'
]
