"""Tests for Doyle spiral generation and 3D conversion."""

import sys
sys.path.insert(0, '/home/runner/workspace/src')

import pytest
import numpy as np
from doyle import DoyleSpiral, ArcElement, ArcSelector, ArcGroup, CircleElement


class TestSpiralGeneration:
    """Test basic spiral generation."""
    
    def test_spiral_creates_circles(self):
        """Test that spiral generates outer circles."""
        spiral = DoyleSpiral(p=16, q=16, t=5)
        spiral.generate_outer_circles()
        
        assert len(spiral.circles) > 0, "Spiral should generate circles"
        print(f"✓ Generated {len(spiral.circles)} circles")
    
    def test_spiral_computes_intersections(self):
        """Test that spiral computes intersection points."""
        spiral = DoyleSpiral(p=16, q=16, t=5)
        spiral.generate_outer_circles()
        spiral.compute_all_intersections()
        
        # Count circles with 6 intersections
        circles_with_6 = sum(1 for c in spiral.circles if len(c.intersections) == 6)
        assert circles_with_6 > 0, "Should have circles with 6 intersections"
        print(f"✓ {circles_with_6} circles have 6 intersections")
    
    def test_ring_indices_computed(self):
        """Test that ring indices are computed correctly."""
        spiral = DoyleSpiral(p=16, q=16, t=5)
        spiral.generate_outer_circles()
        spiral.compute_all_intersections()
        
        radius_to_ring = spiral._compute_ring_indices()
        assert len(radius_to_ring) > 0, "Should compute ring indices"
        print(f"✓ Computed {len(radius_to_ring)} unique ring indices")


class TestArcGroupGeneration:
    """Test arc group generation for 3D conversion."""
    
    def test_arc_groups_created(self):
        """Test that arc groups are created for circles."""
        spiral = DoyleSpiral(p=16, q=16, t=5, arc_mode='closest', num_gaps=3)
        spiral.generate_outer_circles()
        spiral.compute_all_intersections()
        
        # Compute ring indices
        radius_to_ring = spiral._compute_ring_indices()
        spiral.arc_groups.clear()
        
        # Create arc groups (same logic as 3D visualization)
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
        
        assert len(spiral.arc_groups) > 0, "Should create arc groups"
        print(f"✓ Created {len(spiral.arc_groups)} arc groups")
    
    def test_arc_group_polygon_conversion(self):
        """Test that arc groups can be converted to polygons."""
        spiral = DoyleSpiral(p=16, q=16, t=5, arc_mode='closest', num_gaps=3)
        spiral.generate_outer_circles()
        spiral.compute_all_intersections()
        
        # Compute ring indices
        radius_to_ring = spiral._compute_ring_indices()
        spiral.arc_groups.clear()
        
        # Create arc groups
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
        
        # Test polygon conversion
        polygons_created = 0
        for key, group in spiral.arc_groups.items():
            if 'outer' in key:
                continue
            
            points = group.get_closed_outline()
            if points and len(points) >= 3:
                polygons_created += 1
                
                # Verify points are complex numbers or can be converted
                for p in points:
                    assert isinstance(p, complex) or (hasattr(p, 'real') and hasattr(p, 'imag')), \
                        f"Point should be complex number, got {type(p)}"
        
        assert polygons_created > 0, "Should create polygons from arc groups"
        print(f"✓ Created {polygons_created} polygons from arc groups")
        
        return polygons_created


class Test3DDataConversion:
    """Test data conversion for 3D visualization."""
    
    def test_mesh_data_generation(self):
        """Test that mesh data is generated correctly for 3D visualization."""
        spiral = DoyleSpiral(p=16, q=16, t=5, arc_mode='closest', num_gaps=3)
        spiral.generate_outer_circles()
        spiral.compute_all_intersections()
        
        # Compute ring indices
        radius_to_ring = spiral._compute_ring_indices()
        spiral.arc_groups.clear()
        
        # Create arc groups (same as 3D visualization)
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
        
        # Convert to mesh data (same as in 3D visualization)
        meshes_data = []
        for key, group in spiral.arc_groups.items():
            if 'outer' in key:
                continue
            
            points = group.get_closed_outline()
            if not points or len(points) < 3:
                continue
            
            ring_idx = group.ring_index if group.ring_index is not None else 0
            ring_angle = ring_idx * 15.0  # Default angle
            
            # Convert complex points to [x, y] pairs
            points_2d = [[p.real, p.imag] for p in points]
            
            meshes_data.append({
                'id': key,
                'points': points_2d,
                'ringAngle': ring_angle
            })
        
        assert len(meshes_data) > 0, f"Should generate mesh data, got {len(meshes_data)} meshes"
        print(f"✓ Generated {len(meshes_data)} mesh groups for 3D visualization")
        
        # Verify structure of first mesh
        if meshes_data:
            mesh = meshes_data[0]
            assert 'id' in mesh, "Mesh should have id"
            assert 'points' in mesh, "Mesh should have points"
            assert 'ringAngle' in mesh, "Mesh should have ringAngle"
            assert len(mesh['points']) >= 3, "Mesh should have at least 3 points"
            assert all(len(p) == 2 for p in mesh['points']), "Each point should be [x, y]"
            print(f"✓ First mesh: {mesh['id']} with {len(mesh['points'])} points at angle {mesh['ringAngle']}°")
        
        return meshes_data


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s'])
