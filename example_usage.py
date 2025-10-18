"""
Example usage of the Doyle spiral modules.
This demonstrates how to use the refactored code.
"""

import sys
sys.path.insert(0, '/home/runner/workspace/src')

from doyle import DoyleSpiral, ArcElement, ArcSelector

# Create a spiral
spiral = DoyleSpiral(p=16, q=16, t=5, arc_mode='closest', num_gaps=3)

# Generate circles - IMPORTANT: Must call BOTH methods!
spiral.generate_circles()  # Generate main circles
spiral.generate_outer_circles()  # Generate outer closure circles
spiral.compute_all_intersections()  # Compute intersection points

print(f"✓ Generated {len(spiral.circles)} main circles")
print(f"✓ Generated {len(spiral.outer_circles)} outer circles")

# Count circles with intersections
circles_with_6 = sum(1 for c in spiral.circles if len(c.intersections) == 6)
print(f"✓ {circles_with_6} circles have 6 intersections")

# Compute ring indices
radius_to_ring = spiral._compute_ring_indices()
print(f"✓ Computed {len(radius_to_ring)} unique ring indices")

# Create arc groups for visualization
spiral.arc_groups.clear()
spiral_center = 0 + 0j

for c in spiral.circles:
    if len(c.intersections) != 6:
        continue
    
    arcs_to_draw = ArcSelector.select_arcs_for_gaps(
        c, spiral_center, num_gaps=3, mode='closest'
    )
    if not arcs_to_draw:
        continue
    
    group = spiral.create_group_for_circle(c)
    group.ring_index = radius_to_ring.get(round(c.radius, 6), None)
    
    for i, j in arcs_to_draw:
        start = c.intersections[i][0]
        end = c.intersections[j][0]
        arc = ArcElement(c, start, end, visible=True)
        group.add_arc(arc)

print(f"✓ Created {len(spiral.arc_groups)} arc groups")

# Convert to 3D mesh data
meshes_data = []
for key, group in spiral.arc_groups.items():
    if 'outer' in key:
        continue
    
    points = group.get_closed_outline()
    if not points or len(points) < 3:
        continue
    
    ring_idx = group.ring_index if group.ring_index is not None else 0
    ring_angle = ring_idx * 15.0
    
    # Convert complex points to [x, y] pairs
    points_2d = [[p.real, p.imag] for p in points]
    
    meshes_data.append({
        'id': key,
        'points': points_2d,
        'ringAngle': ring_angle
    })

print(f"✓ Generated {len(meshes_data)} mesh groups for 3D visualization")
print("\n🎉 Success! All spiral data generated correctly.")
print("\nTo use in Jupyter notebook:")
print("  from doyle_3d_threejs import create_3d_spiral_threejs")
print("  create_3d_spiral_threejs()")
