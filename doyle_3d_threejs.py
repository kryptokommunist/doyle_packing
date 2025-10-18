"""
3D Three.js animation for Doyle spirals with golden glow effects.
Uses three.js directly via HTML/JavaScript widget - no pythreejs!
"""

import ipywidgets as widgets
from IPython.display import display, HTML
import json


def create_3d_spiral_threejs(DoyleSpiral, ArcElement, ArcSelector):
    """Create interactive 3D spinning disk visualization using three.js directly."""
    
    # UI Controls
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
    
    output = widgets.Output()
    
    def generate_spiral_data():
        """Generate spiral data as JSON for JavaScript."""
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
        
        # Convert arc groups to JSON-serializable format
        meshes_data = []
        for key, group in spiral.arc_groups.items():
            if 'outer' in key:
                continue
            
            # Get closed outline points
            points = group.get_closed_outline()
            if not points or len(points) < 3:
                continue
            
            ring_idx = group.ring_index if group.ring_index is not None else 0
            ring_angle = ring_idx * fill_pattern_angle.value
            
            # Convert complex points to [x, y] pairs
            points_2d = [[p.real, p.imag] for p in points]
            
            meshes_data.append({
                'id': key,
                'points': points_2d,
                'ringAngle': ring_angle
            })
        
        return meshes_data
    
    def create_threejs_widget():
        """Create the three.js HTML widget."""
        meshes_data = generate_spiral_data()
        meshes_json = json.dumps(meshes_data)
        rotation_speed_val = rotation_speed.value
        
        html_content = f"""
        <div id="threejs-container" style="width: 900px; height: 600px; border: 1px solid #ccc;"></div>
        
        <script src="https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/three@0.158.0/examples/js/controls/OrbitControls.js"></script>
        
        <script>
        (function() {{
            const container = document.getElementById('threejs-container');
            if (!container) return;
            
            // Clear previous content
            container.innerHTML = '';
            
            // Scene setup
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(50, 900/600, 0.1, 1000);
            camera.position.set(0, 4, 8);
            camera.lookAt(0, 0, 0);
            
            const renderer = new THREE.WebGLRenderer({{ antialias: true }});
            renderer.setSize(900, 600);
            container.appendChild(renderer.domElement);
            
            // Lighting
            const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
            keyLight.position.set(5, 5, 5);
            scene.add(keyLight);
            
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);
            
            // Controls
            const controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            
            // Create disk group
            const diskGroup = new THREE.Group();
            scene.add(diskGroup);
            
            // Mesh data from Python
            const meshesData = {meshes_json};
            const meshes = [];
            
            // Create meshes
            meshesData.forEach(meshData => {{
                const points = meshData.points;
                if (points.length < 3) return;
                
                // Create triangles from center
                const vertices = [];
                const center = points.reduce((acc, p) => {{
                    acc[0] += p[0];
                    acc[1] += p[1];
                    return acc;
                }}, [0, 0]).map(v => v / points.length);
                
                for (let i = 0; i < points.length - 1; i++) {{
                    // Triangle: center, point[i], point[i+1]
                    vertices.push(center[0], center[1], 0);
                    vertices.push(points[i][0], points[i][1], 0);
                    vertices.push(points[i+1][0], points[i+1][1], 0);
                }}
                
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', 
                    new THREE.Float32BufferAttribute(vertices, 3));
                geometry.computeVertexNormals();
                
                const material = new THREE.MeshPhysicalMaterial({{
                    color: 0x2a5599,
                    emissive: 0x000000,
                    emissiveIntensity: 0.0,
                    metalness: 0.3,
                    roughness: 0.4,
                    side: THREE.DoubleSide
                }});
                
                const mesh = new THREE.Mesh(geometry, material);
                mesh.userData = {{ 
                    ringAngle: meshData.ringAngle,
                    id: meshData.id,
                    lastGlowTime: 0
                }};
                
                diskGroup.add(mesh);
                meshes.push(mesh);
            }});
            
            // Animation
            let angle = 0;
            const rotationSpeed = {rotation_speed_val};
            
            function checkAngleMatch(rotAngle, patternAngle, tolerance = 3.0) {{
                const rotNorm = rotAngle % 360;
                const patNorm = patternAngle % 360;
                let diff = Math.abs(rotNorm - patNorm);
                if (diff > 180) diff = 360 - diff;
                return diff <= tolerance;
            }}
            
            function triggerGoldenGlow(mesh) {{
                const now = Date.now();
                // Debounce: min 1 second between glows
                if (now - mesh.userData.lastGlowTime < 1000) return;
                
                mesh.material.emissive.setHex(0xffd700); // Gold
                mesh.material.emissiveIntensity = 2.0;
                mesh.userData.lastGlowTime = now;
                
                setTimeout(() => {{
                    mesh.material.emissive.setHex(0x000000);
                    mesh.material.emissiveIntensity = 0.0;
                }}, 300);
            }}
            
            function animate() {{
                requestAnimationFrame(animate);
                
                // Update rotation
                angle += rotationSpeed * 2; // degrees per frame
                diskGroup.rotation.z = angle * Math.PI / 180;
                
                // Check for angle matches and trigger glow
                meshes.forEach(mesh => {{
                    const patternAngle = mesh.userData.ringAngle;
                    if (checkAngleMatch(angle, patternAngle, 3.0)) {{
                        triggerGoldenGlow(mesh);
                    }}
                }});
                
                controls.update();
                renderer.render(scene, camera);
            }}
            
            animate();
        }})();
        </script>
        """
        
        return HTML(html_content)
    
    def render(_=None):
        """Render the 3D scene."""
        with output:
            output.clear_output(wait=True)
            try:
                widget = create_threejs_widget()
                display(widget)
            except Exception as e:
                print(f"Error creating 3D scene: {e}")
                import traceback
                traceback.print_exc()
    
    # Wire up observers
    for w in [p, q, t, mode, arc_mode, num_gaps, fill_pattern_angle, rotation_speed]:
        w.observe(render, names='value')
    
    # Initial render
    render()
    
    # Layout
    controls_top = widgets.HBox([p, q, t, mode])
    controls_arc = widgets.HBox([arc_mode, num_gaps, fill_pattern_angle])
    controls_3d = widgets.HBox([rotation_speed])
    
    display(widgets.VBox([
        widgets.HTML('<h3>3D Spinning Disk - Three.js Direct (No pythreejs bugs!)</h3>'),
        controls_top, 
        controls_arc, 
        controls_3d,
        output
    ]))
