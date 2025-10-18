"""
3D Pythreejs animation for Doyle spirals with golden glow effects.
"""

from pythreejs import *
import numpy as np
import ipywidgets as widgets
from IPython.display import display
import time
import threading


def create_3d_spiral_animation(DoyleSpiral, ArcElement, ArcSelector):
    """Create interactive 3D spinning disk visualization with golden glow effects."""
    
    # UI Controls (same as 2D spiral)
    p = widgets.IntSlider(value=16, min=2, max=20, step=1, description='p')
    q = widgets.IntSlider(value=16, min=4, max=40, step=1, description='q')
    t = widgets.FloatSlider(value=0, min=0, max=1, step=0.05, description='t')
    mode = widgets.Dropdown(options=['doyle', 'arram_boyle'], value='arram_boyle', description='Mode')
    arc_mode = widgets.Dropdown(options=['closest', 'farthest', 'alternating', 'all'], 
                                value='closest', description='Arc Mode')
    num_gaps = widgets.IntSlider(value=2, min=0, max=6, step=1, description='Num Gaps')
    fill_pattern_angle = widgets.FloatSlider(value=15.0, min=0.0, max=90.0, step=1.0, 
                                            description='Pattern Angle')
    rotation_speed = widgets.FloatSlider(value=1.0, min=0.1, max=5.0, step=0.1, 
                                        description='Rotation Speed')
    camera_distance = widgets.FloatSlider(value=8.0, min=3.0, max=15.0, step=0.5,
                                         description='Camera Distance')
    
    output = widgets.Output()
    
    # State to hold current spiral and animation
    state = {
        'spiral': None,
        'scene': None,
        'renderer': None,
        'meshes': {},  # Map group keys to mesh objects
        'glow_timers': {},  # Track glow effects
        'animation_thread': None,
        'stop_animation': False
    }
    
    def create_arc_group_mesh(group, group_key, ring_angle):
        """Convert arc group to 3D mesh with material properties."""
        # Get closed outline points
        points = group.get_closed_outline()
        if not points or len(points) < 3:
            return None
        
        # Create material with emissive property for glow
        base_color = '#2a5599'  # Blue base color
        material = MeshPhysicalMaterial(
            color=base_color,
            emissive='#000000',  # Start with no glow
            emissiveIntensity=0.0,
            metalness=0.3,
            roughness=0.4,
            side='DoubleSide'
        )
        
        # Create a simple polygon mesh using triangles from center
        tri_vertices = []
        center = sum(points) / len(points)
        for i in range(len(points) - 1):
            # Triangle: center, point[i], point[i+1]
            tri_vertices.extend([center.real, center.imag, 0.0])
            tri_vertices.extend([points[i].real, points[i].imag, 0.0])
            tri_vertices.extend([points[i+1].real, points[i+1].imag, 0.0])
        
        geometry = BufferGeometry(
            attributes={
                'position': BufferAttribute(array=tri_vertices, itemSize=3)
            }
        )
        
        mesh = Mesh(geometry=geometry, material=material)
        mesh.name = group_key
        mesh.userData = {'ring_angle': ring_angle}  # Store the pattern angle
        
        return mesh
    
    def trigger_golden_glow(mesh):
        """Light up mesh with golden reflection for 300ms."""
        if mesh is None:
            return
        
        # Set golden emissive color
        mesh.material.emissive = '#ffd700'  # Gold color
        mesh.material.emissiveIntensity = 2.0
        
        # Schedule return to normal after 300ms
        def reset_glow():
            time.sleep(0.3)
            mesh.material.emissive = '#000000'
            mesh.material.emissiveIntensity = 0.0
        
        threading.Thread(target=reset_glow, daemon=True).start()
    
    def check_angle_match(rotation_angle, pattern_angle, tolerance=5.0):
        """Check if rotation angle matches pattern angle (in degrees)."""
        # Normalize angles to 0-360
        rot_norm = rotation_angle % 360
        pat_norm = pattern_angle % 360
        
        # Check if angles match within tolerance
        diff = abs(rot_norm - pat_norm)
        if diff > 180:
            diff = 360 - diff
        
        return diff <= tolerance
    
    def create_scene():
        """Create the 3D scene with spiral meshes."""
        # Generate spiral
        spiral = DoyleSpiral(p.value, q.value, t.value, 
                            arc_mode=arc_mode.value, num_gaps=num_gaps.value)
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
                c, spiral_center, num_gaps=num_gaps.value, mode=arc_mode.value
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
        
        state['spiral'] = spiral
        
        # Create 3D meshes for each arc group
        meshes = []
        state['meshes'] = {}
        
        for key, group in spiral.arc_groups.items():
            if 'outer' in key:
                continue
            
            ring_idx = group.ring_index if group.ring_index is not None else 0
            ring_angle = ring_idx * fill_pattern_angle.value
            
            mesh = create_arc_group_mesh(group, key, ring_angle)
            if mesh:
                meshes.append(mesh)
                state['meshes'][key] = mesh
        
        # Create container for all meshes
        disk_group = Group(children=meshes)
        
        # Set up lighting
        key_light = DirectionalLight(position=[5, 5, 5], intensity=1.0, color='white')
        ambient_light = AmbientLight(intensity=0.6, color='white')
        
        # Set up camera
        camera = PerspectiveCamera(
            position=[0, camera_distance.value * 0.5, camera_distance.value],
            fov=50,
            aspect=1.5
        )
        camera.lookAt([0, 0, 0])
        
        # Create scene
        scene = Scene(children=[disk_group, camera, key_light, ambient_light])
        
        # Set up controls
        controls = OrbitControls(controlling=camera)
        
        # Create renderer
        renderer = Renderer(
            camera=camera,
            scene=scene,
            controls=[controls],
            width=900,
            height=600
        )
        
        state['scene'] = scene
        state['renderer'] = renderer
        state['disk_group'] = disk_group
        
        # Start rotation animation
        start_rotation_animation()
        
        return renderer
    
    def start_rotation_animation():
        """Animate disk rotation and check for angle matches."""
        import math
        
        # Stop previous animation if running
        state['stop_animation'] = True
        if state['animation_thread'] and state['animation_thread'].is_alive():
            time.sleep(0.1)
        
        # Get disk group
        if 'disk_group' not in state or state['disk_group'] is None:
            return
        
        disk_group = state['disk_group']
        state['stop_animation'] = False
        
        # Animation loop
        def animate():
            angle = 0
            last_matched = {}  # Track last match time per mesh
            
            while not state['stop_animation']:
                time.sleep(0.05)  # ~20 FPS
                
                # Update rotation
                angle += rotation_speed.value * 2  # Degrees per frame
                angle_rad = math.radians(angle)
                
                # Rotate around Z-axis using quaternion (x, y, z, w)
                # For Z-axis rotation: [0, 0, sin(angle/2), cos(angle/2)]
                half_angle = angle_rad / 2
                disk_group.rotation = [0, 0, math.sin(half_angle), math.cos(half_angle)]
                
                # Check each mesh for angle matching
                current_time = time.time()
                for key, mesh in state['meshes'].items():
                    pattern_angle = mesh.userData.get('ring_angle', 0)
                    
                    # Check if angles match
                    if check_angle_match(angle, pattern_angle, tolerance=3.0):
                        # Check if we haven't glowed recently (debounce)
                        last_time = last_matched.get(key, 0)
                        if current_time - last_time > 1.0:  # Min 1 second between glows
                            trigger_golden_glow(mesh)
                            last_matched[key] = current_time
        
        # Start animation in background thread
        thread = threading.Thread(target=animate, daemon=True)
        thread.start()
        state['animation_thread'] = thread
    
    def render(_=None):
        """Render the 3D scene."""
        with output:
            output.clear_output(wait=True)
            try:
                renderer = create_scene()
                display(renderer)
            except Exception as e:
                print(f"Error creating 3D scene: {e}")
                import traceback
                traceback.print_exc()
    
    # Wire up observers
    for w in [p, q, t, mode, arc_mode, num_gaps, fill_pattern_angle, camera_distance]:
        w.observe(render, names='value')
    
    # Initial render
    render()
    
    # Layout
    controls_top = widgets.HBox([p, q, t, mode])
    controls_arc = widgets.HBox([arc_mode, num_gaps, fill_pattern_angle])
    controls_3d = widgets.HBox([rotation_speed, camera_distance])
    
    display(widgets.VBox([
        widgets.HTML('<h3>3D Spinning Disk - Golden Glow on Angle Match</h3>'),
        controls_top, 
        controls_arc, 
        controls_3d,
        output
    ]))
