/**
 * STEP AP214 export for Doyle Spiral outlines.
 *
 * Produces an ISO-10303-21 file (AP214 automotive_design schema) with one
 * EDGE_LOOP per closed polyline outline, all coordinates in millimetres.
 *
 * The coordinate transform matches DXF/SVG exactly:
 *   x = re * scaleFactor + W/2
 *   y = -(im * scaleFactor) + H/2
 *
 * Options mirror the DXF export toggles:
 *   drawGroupOutline – export spiral outlines
 *   redOutline       – export highlight rim paths
 */

function buildPolylineEntities(pts, startId) {
  const lines = [];
  let id = startId;
  const n = pts.length;

  const cpIds = [];
  for (const { x, y } of pts) {
    lines.push(`#${id}=CARTESIAN_POINT('',( ${x.toFixed(6)},${y.toFixed(6)},0.0));`);
    cpIds.push(id++);
  }

  const vpIds = [];
  for (const cp of cpIds) {
    lines.push(`#${id}=VERTEX_POINT('',#${cp});`);
    vpIds.push(id++);
  }

  const ecIds = [];
  for (let i = 0; i < n; i++) {
    const { x: x1, y: y1 } = pts[i];
    const { x: x2, y: y2 } = pts[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ux = len > 1e-12 ? dx / len : 1.0;
    const uy = len > 1e-12 ? dy / len : 0.0;
    const dirId = id++;
    lines.push(`#${dirId}=DIRECTION('',( ${ux.toFixed(9)},${uy.toFixed(9)},0.0));`);
    const vecId = id++;
    lines.push(`#${vecId}=VECTOR('',#${dirId},${len.toFixed(6)});`);
    const lnId = id++;
    lines.push(`#${lnId}=LINE('',#${cpIds[i]},#${vecId});`);
    const ecId = id++;
    lines.push(`#${ecId}=EDGE_CURVE('',#${vpIds[i]},#${vpIds[(i + 1) % n]},#${lnId},.T.);`);
    ecIds.push(ecId);
  }

  const oeIds = [];
  for (const ec of ecIds) {
    lines.push(`#${id}=ORIENTED_EDGE('',*,*,#${ec},.T.);`);
    oeIds.push(id++);
  }

  const elId = id++;
  lines.push(`#${elId}=EDGE_LOOP('',(${oeIds.map(o => `#${o}`).join(',')}));`);

  return { lines, nextId: id, elId };
}

function buildSTEP(elIds, allEntityLines, name) {
  const lines = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${name}'),'2;1');`,
    `FILE_NAME('${name}.stp','2024-01-01T00:00:00',(''),(''),'','','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    ...allEntityLines,
  ];

  // Context and product structure (IDs above all geometry)
  let id = allEntityLines.length + 10000;
  const mmId = id++;
  lines.push(`#${mmId}=( NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) LENGTH_UNIT() );`);
  const radId = id++;
  lines.push(`#${radId}=( NAMED_UNIT(*) SI_UNIT($,.RADIAN.) PLANE_ANGLE_UNIT() );`);
  const repCtxId = id++;
  lines.push(`#${repCtxId}=( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${mmId},#${radId})) REPRESENTATION_CONTEXT('Context','3D Context') );`);
  const appCtxId = id++;
  lines.push(`#${appCtxId}=APPLICATION_CONTEXT('core data for automotive mechanical design processes');`);
  const apdId = id++;
  lines.push(`#${apdId}=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtxId});`);
  const prodId = id++;
  lines.push(`#${prodId}=PRODUCT('${name}','${name}','',());`);
  const pdcId = id++;
  lines.push(`#${pdcId}=PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtxId},'design');`);
  const pdfId = id++;
  lines.push(`#${pdfId}=PRODUCT_DEFINITION_FORMATION('','',#${prodId});`);
  const pdId = id++;
  lines.push(`#${pdId}=PRODUCT_DEFINITION('','',#${pdfId},#${pdcId});`);
  const pdsId = id++;
  lines.push(`#${pdsId}=PRODUCT_DEFINITION_SHAPE('','',#${pdId});`);
  const gbwsrId = id++;
  lines.push(`#${gbwsrId}=GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('',(${elIds.map(e => `#${e}`).join(',')}),#${repCtxId});`);
  const sdrId = id++;
  lines.push(`#${sdrId}=SHAPE_DEFINITION_REPRESENTATION(#${pdsId},#${gbwsrId});`);

  lines.push('ENDSEC;', 'END-ISO-10303-21;');
  return lines.join('\n');
}

/**
 * @param {Map<string, ArcGroup>} arcGroups
 * @param {number} scaleFactor        - mm per internal unit
 * @param {number} boundingWidthMm
 * @param {number} boundingHeightMm
 * @param {Object} [opts]
 * @param {boolean} [opts.drawGroupOutline=true]
 * @param {boolean} [opts.redOutline=false]
 * @param {string}  [opts.name='doyle-spiral']
 * @returns {string} STEP file contents
 */
export function generateSTEP(arcGroups, scaleFactor, boundingWidthMm, boundingHeightMm, opts = {}) {
  const drawGroupOutline = opts.drawGroupOutline !== false;
  const redOutline = Boolean(opts.redOutline);
  const name = opts.name || 'doyle-spiral';

  function ptToMm(re, im) {
    return {
      x: re * scaleFactor + boundingWidthMm / 2,
      y: -(im * scaleFactor) + boundingHeightMm / 2,
    };
  }

  const allEntityLines = [];
  const elIds = [];
  let nextId = 100;

  if (drawGroupOutline) {
    for (const [key, group] of arcGroups.entries()) {
      if (key.startsWith('outer_')) continue;
      const outline = group.getClosedOutline();
      if (!outline || outline.length < 2) continue;
      const pts = outline.map(pt => ptToMm(pt.re, pt.im));
      const { lines, nextId: nid, elId } = buildPolylineEntities(pts, nextId);
      allEntityLines.push(...lines);
      elIds.push(elId);
      nextId = nid;
    }
  }

  return buildSTEP(elIds, allEntityLines, name);
}

/**
 * Generates a STEP file for one or more closed polyline outlines plus optional highlight paths.
 *
 * @param {Array<Array<{re,im}>>} outlines
 * @param {Array<Array<{re,im}>>} highlightPaths
 * @param {number} scaleFactor
 * @param {number} workpieceWmm
 * @param {number} workpieceHmm
 * @param {string} [name='doyle-spiral']
 * @returns {string} STEP file contents
 */
export function generateSingleGroupSTEP(outlines, highlightPaths, scaleFactor, workpieceWmm, workpieceHmm, name = 'doyle-spiral') {
  function ptToMm(re, im) {
    return {
      x: re * scaleFactor + workpieceWmm / 2,
      y: -(im * scaleFactor) + workpieceHmm / 2,
    };
  }

  const normalisedOutlines = outlines.length > 0
    ? (Array.isArray(outlines[0]) ? outlines : [outlines])
    : [];

  const allEntityLines = [];
  const elIds = [];
  let nextId = 100;

  for (const outline of normalisedOutlines) {
    const pts = outline.map(pt => ptToMm(pt.re, pt.im));
    const { lines, nextId: nid, elId } = buildPolylineEntities(pts, nextId);
    allEntityLines.push(...lines);
    elIds.push(elId);
    nextId = nid;
  }

  if (Array.isArray(highlightPaths)) {
    for (const path of highlightPaths) {
      if (!path || path.length < 2) continue;
      const pts = path.map(pt => ptToMm(pt.re, pt.im));
      const { lines, nextId: nid, elId } = buildPolylineEntities(pts, nextId);
      allEntityLines.push(...lines);
      elIds.push(elId);
      nextId = nid;
    }
  }

  return buildSTEP(elIds, allEntityLines, name);
}
