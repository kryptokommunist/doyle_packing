"""
3D Three.js animation for Doyle spirals with golden glow effects.
Uses three.js directly via IFrame - no pythreejs!
"""

import sys
sys.path.insert(0, '/home/runner/workspace/src')

import ipywidgets as widgets
from IPython.display import display, IFrame
import json
import os
import uuid
from doyle import DoyleSpiral, ArcElement, ArcSelector


def create_3d_spiral_threejs():
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
        # BUGFIX: Must call BOTH methods to populate circles!
        spiral.generate_circles()  # Creates main circles
        spiral.generate_outer_circles()  # Creates outer closure circles
        spiral.compute_all_intersections()
        
        print(f"DEBUG: Generated {len(spiral.circles)} circles")
        
        # Compute ring indices
        radius_to_ring = spiral._compute_ring_indices()
        spiral.arc_groups.clear()
        
        # Create arc groups
        spiral_center = 0 + 0j
        circles_with_6_intersections = 0
        for c in spiral.circles:
            if len(c.intersections) != 6:
                continue
            circles_with_6_intersections += 1
            
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
        
        print(f"DEBUG: {circles_with_6_intersections} circles with 6 intersections")
        print(f"DEBUG: Created {len(spiral.arc_groups)} arc groups")
        
        # Convert arc groups to JSON-serializable format
        meshes_data = []
        skipped_outer = 0
        skipped_no_points = 0
        for key, group in spiral.arc_groups.items():
            if 'outer' in key:
                skipped_outer += 1
                continue
            
            # Get closed outline points
            points = group.get_closed_outline()
            if not points or len(points) < 3:
                skipped_no_points += 1
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
        
        print(f"DEBUG: Skipped {skipped_outer} outer groups")
        print(f"DEBUG: Skipped {skipped_no_points} groups with no points")
        print(f"DEBUG: Final meshes_data count: {len(meshes_data)}")
        
        return meshes_data
    
    def create_html_file():
        """Create standalone HTML file with three.js visualization."""
        meshes_data = generate_spiral_data()
        meshes_json = json.dumps(meshes_data)
        rotation_speed_val = rotation_speed.value
        
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Doyle Spiral 3D</title>
    <style>
        body {{ margin: 0; overflow: hidden; }}
        canvas {{ display: block; }}
    </style>
</head>
<body>
    <script src="https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.158.0/examples/js/controls/OrbitControls.js"></script>
    
    <script>
        // Wait for THREE to load
        if (typeof THREE === 'undefined') {{
            document.write('<p style="color: red; padding: 20px;">Error loading Three.js. Please refresh.</p>');
        }} else {{
            // Scene setup
            const scene = new THREE.Scene();
            scene.background = new THREE.Color(0xf0f0f0);
            
            const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.set(0, 4, 8);
            camera.lookAt(0, 0, 0);
            
            const renderer = new THREE.WebGLRenderer({{ antialias: true }});
            renderer.setSize(window.innerWidth, window.innerHeight);
            document.body.appendChild(renderer.domElement);
            
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
            const outlines = [];
            
            console.log('Creating', meshesData.length, 'meshes');
            
            // Compute bounds for camera positioning
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            meshesData.forEach(meshData => {{
                meshData.points.forEach(p => {{
                    minX = Math.min(minX, p[0]);
                    maxX = Math.max(maxX, p[0]);
                    minY = Math.min(minY, p[1]);
                    maxY = Math.max(maxY, p[1]);
                }});
            }});
            
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const rangeX = maxX - minX;
            const rangeY = maxY - minY;
            const maxRange = Math.max(rangeX, rangeY);
            
            console.log('Bounds:', {{ minX, maxX, minY, maxY, centerX, centerY, maxRange }});
            
            // Create meshes
            meshesData.forEach(meshData => {{
                const points = meshData.points;
                if (points.length < 3) return;
                
                // Normalize points to center and scale
                const normalizedPoints = points.map(p => [
                    (p[0] - centerX),
                    (p[1] - centerY)
                ]);
                
                // Create triangles from center
                const vertices = [];
                const center = normalizedPoints.reduce((acc, p) => {{
                    acc[0] += p[0];
                    acc[1] += p[1];
                    return acc;
                }}, [0, 0]).map(v => v / normalizedPoints.length);
                
                for (let i = 0; i < normalizedPoints.length - 1; i++) {{
                    // Triangle: center, point[i], point[i+1]
                    vertices.push(center[0], center[1], 0);
                    vertices.push(normalizedPoints[i][0], normalizedPoints[i][1], 0);
                    vertices.push(normalizedPoints[i+1][0], normalizedPoints[i+1][1], 0);
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
                
                // Create outline
                const outlineGeometry = new THREE.BufferGeometry();
                const outlineVertices = [];
                for (let i = 0; i < normalizedPoints.length; i++) {{
                    const p1 = normalizedPoints[i];
                    const p2 = normalizedPoints[(i + 1) % normalizedPoints.length];
                    outlineVertices.push(p1[0], p1[1], 0.01); // Slightly above mesh
                    outlineVertices.push(p2[0], p2[1], 0.01);
                }}
                outlineGeometry.setAttribute('position',
                    new THREE.Float32BufferAttribute(outlineVertices, 3));
                
                const outlineMaterial = new THREE.LineBasicMaterial({{
                    color: 0x000000,
                    linewidth: 1
                }});
                
                const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
                diskGroup.add(outline);
                outlines.push(outline);
            }});
            
            console.log('Created', meshes.length, 'meshes successfully');
            
            // Position camera to fit spiral
            const cameraDistance = maxRange * 1.2;
            camera.position.set(0, cameraDistance * 0.5, cameraDistance);
            camera.lookAt(0, 0, 0);
            
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
            
            // Handle window resize
            window.addEventListener('resize', () => {{
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            }});
        }}
    </script>
</body>
</html>
        """
        
        # Save to file with unique name
        filename = f'doyle_3d_{uuid.uuid4().hex[:8]}.html'
        with open(filename, 'w') as f:
            f.write(html_content)
        
        return filename
    
    def render(_=None):
        """Render the 3D scene."""
        with output:
            output.clear_output(wait=True)
            try:
                filename = create_html_file()
                print(f"✓ Created {filename}")
                print(f"✓ Rendering {len(generate_spiral_data())} mesh groups")
                display(IFrame(src=filename, width=920, height=620))
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
