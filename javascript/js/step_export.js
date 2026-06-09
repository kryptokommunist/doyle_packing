/**
 * STEP AP214 export for Doyle Spiral outlines.
 *
 * Produces FACETED_BREP solids: each closed polyline outline is extruded
 * to a configurable thickness along Z, yielding a solid body recognisable
 * by Prusa Slicer and other CAD/slicer tools.
 *
 * Coordinate transform (matches SVG/DXF exactly):
 *   x = re * scaleFactor + W/2
 *   y = -(im * scaleFactor) + H/2
 */

function cross3(a, b) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function norm3(v) {
  const l = Math.hypot(...v);
  return l > 1e-12 ? v.map(x => x/l) : [0, 0, 1];
}

function buildSolid(pts2d, thickness, emit) {
  // Deduplicate consecutive points and remove closing duplicate
  let pts = [pts2d[0]];
  for (let i = 1; i < pts2d.length; i++) {
    const [px, py] = pts[pts.length - 1];
    const [cx, cy] = pts2d[i];
    if (Math.hypot(cx - px, cy - py) > 1e-9) pts.push(pts2d[i]);
  }
  if (pts.length > 1) {
    const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1];
    if (Math.hypot(lx - fx, ly - fy) < 1e-9) pts.pop();
  }
  if (pts.length < 3) return null;

  // Ensure CCW winding (positive signed area → outward normal +Z for top face)
  const n = pts.length;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  if (area2 < 0) pts = pts.slice().reverse();

  const dir3 = (x, y, z) => emit(`DIRECTION('',( ${x.toFixed(9)},${y.toFixed(9)},${z.toFixed(9)}))`);

  const botCp = pts.map(([x, y]) => emit(`CARTESIAN_POINT('',( ${x.toFixed(9)},${y.toFixed(9)},0.0))`));
  const topCp = pts.map(([x, y]) => emit(`CARTESIAN_POINT('',( ${x.toFixed(9)},${y.toFixed(9)},${thickness.toFixed(9)}))`));
  const botVp = botCp.map(c => emit(`VERTEX_POINT('',#${c})`));
  const topVp = topCp.map(c => emit(`VERTEX_POINT('',#${c})`));

  function mkLine(x1, y1, z1, x2, y2, z2) {
    const dx = x2-x1, dy = y2-y1, dz = z2-z1;
    const l = Math.hypot(dx, dy, dz);
    const [ux, uy, uz] = l > 1e-12 ? [dx/l, dy/l, dz/l] : [1, 0, 0];
    const cp = emit(`CARTESIAN_POINT('',( ${x1.toFixed(9)},${y1.toFixed(9)},${z1.toFixed(9)}))`);
    const d  = dir3(ux, uy, uz);
    const v  = emit(`VECTOR('',#${d},${l.toFixed(9)})`);
    return emit(`LINE('',#${cp},#${v})`);
  }

  const botLn  = pts.map(([x,y], i) => { const [x2,y2]=pts[(i+1)%n]; return mkLine(x,y,0,x2,y2,0); });
  const topLn  = pts.map(([x,y], i) => { const [x2,y2]=pts[(i+1)%n]; return mkLine(x,y,thickness,x2,y2,thickness); });
  const vertLn = pts.map(([x,y]) => mkLine(x,y,0,x,y,thickness));

  const botEc  = pts.map((_,i) => emit(`EDGE_CURVE('',#${botVp[i]},#${botVp[(i+1)%n]},#${botLn[i]},.T.)`));
  const topEc  = pts.map((_,i) => emit(`EDGE_CURVE('',#${topVp[i]},#${topVp[(i+1)%n]},#${topLn[i]},.T.)`));
  const vertEc = pts.map((_,i) => emit(`EDGE_CURVE('',#${botVp[i]},#${topVp[i]},#${vertLn[i]},.T.)`));

  function mkPlane(ox, oy, oz, nx, ny, nz, rx, ry, rz) {
    const axPt  = emit(`CARTESIAN_POINT('',( ${ox.toFixed(9)},${oy.toFixed(9)},${oz.toFixed(9)}))`);
    const axDir = dir3(nx, ny, nz);
    const axRef = dir3(rx, ry, rz);
    const ax = emit(`AXIS2_PLACEMENT_3D('',#${axPt},#${axDir},#${axRef})`);
    return emit(`PLANE('',#${ax})`);
  }

  function mkFace(oesData, planeId) {
    const oes  = oesData.map(([ec, fwd]) => emit(`ORIENTED_EDGE('',*,*,#${ec},${fwd ? '.T.' : '.F.'})`));
    const loop = emit(`EDGE_LOOP('',(${oes.map(o => '#'+o).join(',')}))`);
    const fb   = emit(`FACE_BOUND('',#${loop},.T.)`);
    return emit(`ADVANCED_FACE('',(#${fb}),#${planeId},.T.)`);
  }

  const botPl   = mkPlane(0, 0, 0,           0, 0, -1,  1, 0, 0);
  const botFace = mkFace(pts.map((_, i) => [botEc[n-1-i], false]), botPl);

  const topPl   = mkPlane(0, 0, thickness,   0, 0,  1,  1, 0, 0);
  const topFace = mkFace(pts.map((_, i) => [topEc[i], true]), topPl);

  const sideFaces = pts.map((_, i) => {
    const j = (i + 1) % n;
    const [x1, y1] = pts[i], [x2, y2] = pts[j];
    const dx = x2-x1, dy = y2-y1;
    const l = Math.hypot(dx, dy);
    const [nx, ny] = [dy/l, -dx/l];
    const [rx, ry] = [dx/l,  dy/l];
    const ox = (x1+x2)/2, oy = (y1+y2)/2;
    const pl = mkPlane(ox, oy, 0,  nx, ny, 0,  rx, ry, 0);
    return mkFace([[botEc[i],true],[vertEc[j],true],[topEc[i],false],[vertEc[i],false]], pl);
  });

  const shell = emit(`CLOSED_SHELL('',(${[botFace, topFace, ...sideFaces].map(f => '#'+f).join(',')}))`);
  return emit(`FACETED_BREP('',#${shell})`);
}

function buildSTEPFile(polylines2d, thickness, name) {
  const entityLines = [];
  let nextId = 1;
  const emit = s => { const id = nextId++; entityLines.push(`#${id}=${s};`); return id; };

  const solidIds = polylines2d
    .map(pts => buildSolid(pts, thickness, emit))
    .filter(id => id !== null);

  if (solidIds.length === 0) return null;

  const mm  = emit('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
  const rad = emit('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
  const sr  = emit('( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )');
  const unc = emit(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#${mm},'distance_accuracy_value','confusion accuracy')`);
  const ctx = emit(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${mm},#${rad},#${sr})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`);
  const app = emit("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  emit(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${app})`);
  const prod = emit(`PRODUCT('${name}','${name}','',())`);
  emit(`PRODUCT_CONTEXT('',#${app},'mechanical')`);
  const pdf = emit(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
  const pdc = emit(`PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design')`);
  const pd  = emit(`PRODUCT_DEFINITION('design','',#${pdf},#${pdc})`);
  const pds = emit(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
  const ocp = emit("CARTESIAN_POINT('',(0.,0.,0.))");
  const od  = emit("DIRECTION('',(0.,0.,1.))");
  const ox  = emit("DIRECTION('',(1.,0.,0.))");
  const ax  = emit(`AXIS2_PLACEMENT_3D('',#${ocp},#${od},#${ox})`);
  const absr = emit(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${ax},${solidIds.map(s=>'#'+s).join(',')}),#${ctx})`);
  emit(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${absr})`);

  return [
    'ISO-10303-21;', 'HEADER;',
    `FILE_DESCRIPTION(('${name}'),'2;1');`,
    `FILE_NAME('${name}.stp','2024-01-01T00:00:00',(''),(''),'','','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;', 'DATA;',
    ...entityLines,
    'ENDSEC;', 'END-ISO-10303-21;',
  ].join('\n');
}

/**
 * @param {Map<string, ArcGroup>} arcGroups
 * @param {number} scaleFactor        - mm per internal unit
 * @param {number} boundingWidthMm
 * @param {number} boundingHeightMm
 * @param {Object} [opts]
 * @param {boolean} [opts.drawGroupOutline=true]
 * @param {number}  [opts.thickness=1]  - extrusion thickness in mm
 * @param {string}  [opts.name='doyle-spiral']
 * @returns {string|null} STEP file contents, or null if no geometry
 */
export function generateSTEP(arcGroups, scaleFactor, boundingWidthMm, boundingHeightMm, opts = {}) {
  const drawGroupOutline = opts.drawGroupOutline !== false;
  const thickness = (opts.thickness != null && opts.thickness > 0) ? opts.thickness : 1;
  const name = opts.name || 'doyle-spiral';

  function ptToArr(re, im) {
    return [
      re * scaleFactor + boundingWidthMm / 2,
      -(im * scaleFactor) + boundingHeightMm / 2,
    ];
  }

  const polylines = [];
  if (drawGroupOutline) {
    for (const [key, group] of arcGroups.entries()) {
      if (key.startsWith('outer_')) continue;
      const outline = group.getClosedOutline();
      if (!outline || outline.length < 3) continue;
      polylines.push(outline.map(pt => ptToArr(pt.re, pt.im)));
    }
  }

  return buildSTEPFile(polylines, thickness, name);
}

/**
 * Generates a STEP file for one or more closed polyline outlines (highlight paths ignored —
 * STEP is a solid format; outlines become extruded solids).
 *
 * @param {Array<Array<{re,im}>>} outlines
 * @param {Array} _highlightPaths  - unused (no highlight concept in solid export)
 * @param {number} scaleFactor
 * @param {number} workpieceWmm
 * @param {number} workpieceHmm
 * @param {string} [name='doyle-spiral']
 * @param {number} [thickness=1]
 * @returns {string|null} STEP file contents
 */
export function generateSingleGroupSTEP(outlines, _highlightPaths, scaleFactor, workpieceWmm, workpieceHmm, name = 'doyle-spiral', thickness = 1) {
  function ptToArr(re, im) {
    return [
      re * scaleFactor + workpieceWmm / 2,
      -(im * scaleFactor) + workpieceHmm / 2,
    ];
  }

  const normalisedOutlines = outlines.length > 0
    ? (Array.isArray(outlines[0]) ? outlines : [outlines])
    : [];

  const polylines = normalisedOutlines
    .filter(o => o && o.length >= 3)
    .map(o => o.map(pt => ptToArr(pt.re, pt.im)));

  return buildSTEPFile(polylines, thickness, name);
}
