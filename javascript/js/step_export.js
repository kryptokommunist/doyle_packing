/**
 * STEP AP214 export for Doyle Spiral outlines.
 *
 * Uses POLYLINE + GEOMETRIC_CURVE_SET inside
 * GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION.
 * Coordinates in millimetres, matching SVG/DXF transform exactly:
 *   x = re * scaleFactor + W/2
 *   y = -(im * scaleFactor) + H/2
 */

function buildSTEP(polylines_mm, name) {
  const lines = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${name}'),'2;1');`,
    `FILE_NAME('${name}.stp','2024-01-01T00:00:00',(''),(''),'','','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
  ];

  let id = 1;
  const polyIds = [];

  for (const pts of polylines_mm) {
    const cpIds = [];
    for (const { x, y } of pts) {
      lines.push(`#${id}=CARTESIAN_POINT('',( ${x.toFixed(6)},${y.toFixed(6)},0.0));`);
      cpIds.push(id++);
    }
    // close the polyline by repeating first point
    cpIds.push(cpIds[0]);
    const polyId = id++;
    lines.push(`#${polyId}=POLYLINE('',(${cpIds.map(c => `#${c}`).join(',')}));`);
    polyIds.push(polyId);
  }

  const gcsId = id++;
  lines.push(`#${gcsId}=GEOMETRIC_CURVE_SET('outlines',(${polyIds.map(p => `#${p}`).join(',')}));`);

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
  lines.push(`#${gbwsrId}=GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('',(#${gcsId}),#${repCtxId});`);
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
  const name = opts.name || 'doyle-spiral';

  function ptToMm(re, im) {
    return {
      x: re * scaleFactor + boundingWidthMm / 2,
      y: -(im * scaleFactor) + boundingHeightMm / 2,
    };
  }

  const polylines = [];

  if (drawGroupOutline) {
    for (const [key, group] of arcGroups.entries()) {
      if (key.startsWith('outer_')) continue;
      const outline = group.getClosedOutline();
      if (!outline || outline.length < 2) continue;
      polylines.push(outline.map(pt => ptToMm(pt.re, pt.im)));
    }
  }

  if (polylines.length === 0) return buildSTEP([[{ x: 0, y: 0 }, { x: 0, y: 0 }]], name);
  return buildSTEP(polylines, name);
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

  const polylines = normalisedOutlines.map(o => o.map(pt => ptToMm(pt.re, pt.im)));

  if (Array.isArray(highlightPaths)) {
    for (const path of highlightPaths) {
      if (!path || path.length < 2) continue;
      polylines.push(path.map(pt => ptToMm(pt.re, pt.im)));
    }
  }

  if (polylines.length === 0) return buildSTEP([[{ x: 0, y: 0 }, { x: 0, y: 0 }]], name);
  return buildSTEP(polylines, name);
}
