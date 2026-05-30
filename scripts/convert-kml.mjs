import fs from 'fs';
import path from 'path';

// Helper to strip CDATA wrapper
function stripCData(str) {
  if (!str) return '';
  return str.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

// Helper to parse KML color (aabbggrr) to hex (#rrggbb) and opacity (0-1)
function parseKmlColor(kmlColor) {
  if (!kmlColor || kmlColor.length !== 8) {
    return { color: '#000000', opacity: 1 };
  }
  const aa = kmlColor.slice(0, 2);
  const bb = kmlColor.slice(2, 4);
  const gg = kmlColor.slice(4, 6);
  const rr = kmlColor.slice(6, 8);
  const color = `#${rr}${gg}${bb}`.toLowerCase();
  const opacity = parseFloat((parseInt(aa, 16) / 255).toFixed(4));
  return { color, opacity };
}

// Generate geometry fingerprint for matching
function getGeometryFingerprint(geometry) {
  if (!geometry || !geometry.coordinates) return '';
  const round = (num) => typeof num === 'number' ? num.toFixed(6) : '';
  
  const processCoords = (coords) => {
    if (typeof coords[0] === 'number') {
      return `${round(coords[0])},${round(coords[1])}`;
    }
    if (Array.isArray(coords)) {
      return coords.map(processCoords).join(';');
    }
    return '';
  };
  
  return `${geometry.type}:${processCoords(geometry.coordinates)}`;
}

// Parse space/newline-separated coordinate string into [[lng, lat], ...]
function parseCoordinates(coordStr) {
  const lines = coordStr.trim().split(/[\s\r\n]+/);
  return lines.map(line => {
    const parts = line.split(',');
    if (parts.length >= 2) {
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!isNaN(lng) && !isNaN(lat)) {
        return [lng, lat];
      }
    }
    return null;
  }).filter(c => c !== null);
}

// Parse single Polygon geometry body
function parsePolygon(body) {
  const coordinates = [];
  
  // Parse outerBoundaryIs
  const outerMatch = body.match(/<outerBoundaryIs>([\s\S]*?)<\/outerBoundaryIs>/);
  if (outerMatch) {
    const coordsMatch = outerMatch[1].match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (coordsMatch) {
      const ring = parseCoordinates(coordsMatch[1]);
      if (ring.length > 0) coordinates.push(ring);
    }
  }
  
  // Parse innerBoundaryIs (holes)
  const innerRegex = /<innerBoundaryIs>([\s\S]*?)<\/innerBoundaryIs>/g;
  let innerMatch;
  while ((innerMatch = innerRegex.exec(body)) !== null) {
    const coordsMatch = innerMatch[1].match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (coordsMatch) {
      const ring = parseCoordinates(coordsMatch[1]);
      if (ring.length > 0) coordinates.push(ring);
    }
  }
  
  return coordinates.length > 0 ? { type: 'Polygon', coordinates } : null;
}

// Parse single LineString geometry body
function parseLineString(body) {
  const coordsMatch = body.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
  if (coordsMatch) {
    const coords = parseCoordinates(coordsMatch[1]);
    if (coords.length > 0) {
      return { type: 'LineString', coordinates: coords };
    }
  }
  return null;
}

// Parse MultiGeometry body
function parseMultiGeometry(body) {
  const geometries = [];
  
  const polygonRegex = /<Polygon>([\s\S]*?)<\/Polygon>/g;
  let polyMatch;
  while ((polyMatch = polygonRegex.exec(body)) !== null) {
    const geom = parsePolygon(polyMatch[1]);
    if (geom) geometries.push(geom);
  }
  
  const lineRegex = /<LineString>([\s\S]*?)<\/LineString>/g;
  let lineMatch;
  while ((lineMatch = lineRegex.exec(body)) !== null) {
    const geom = parseLineString(lineMatch[1]);
    if (geom) geometries.push(geom);
  }
  
  // For GeoJSON, represent as GeometryCollection if we have mixed or multiple geometries
  if (geometries.length === 1) {
    return geometries[0];
  } else if (geometries.length > 1) {
    return { type: 'GeometryCollection', geometries };
  }
  return null;
}

// Main logic
async function run() {
  const configPath = path.resolve('scripts/convert-config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found at ${configPath}`);
    process.exit(1);
  }
  
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const kmlInputPath = path.resolve(config.kmlInputPath);
  const geojsonOutputPath = path.resolve(config.geojsonOutputPath);
  const overlaysPath = path.resolve(config.overlaysPath);
  const backupDir = path.resolve(config.backupDir);
  const featureIdPrefix = config.featureIdPrefix || 'mymaps';
  
  console.log(`--- Starting KML Converter ---`);
  console.log(`Input KML: ${kmlInputPath}`);
  console.log(`Output GeoJSON: ${geojsonOutputPath}`);
  console.log(`Overlays File: ${overlaysPath}`);
  
  if (!fs.existsSync(kmlInputPath)) {
    console.error(`KML file not found at ${kmlInputPath}`);
    process.exit(1);
  }
  
  const kmlContent = fs.readFileSync(kmlInputPath, 'utf8');
  
  // 1. Resolve styleMap and style definitions
  console.log('Parsing KML styles...');
  const styles = {};
  const styleMaps = {};
  
  const styleRegex = /<Style\s+id="([^"]+)">([\s\S]*?)<\/Style>/g;
  const styleMapRegex = /<StyleMap\s+id="([^"]+)">([\s\S]*?)<\/StyleMap>/g;
  
  let styleMapMatch;
  while ((styleMapMatch = styleMapRegex.exec(kmlContent)) !== null) {
    const id = styleMapMatch[1];
    const body = styleMapMatch[2];
    const normalMatch = body.match(/<key>normal<\/key>[\s\S]*?<styleUrl>#([^<]+)<\/styleUrl>/);
    if (normalMatch) {
      styleMaps[id] = normalMatch[1];
    }
  }
  
  let styleMatch;
  while ((styleMatch = styleRegex.exec(kmlContent)) !== null) {
    const id = styleMatch[1];
    const body = styleMatch[2];
    const styleProps = {};
    
    // Parse LineStyle
    const lineStyleMatch = body.match(/<LineStyle>([\s\S]*?)<\/LineStyle>/);
    if (lineStyleMatch) {
      const lsBody = lineStyleMatch[1];
      const colorMatch = lsBody.match(/<color>([^<]+)<\/color>/);
      const widthMatch = lsBody.match(/<width>([^<]+)<\/width>/);
      if (colorMatch) {
        const { color, opacity } = parseKmlColor(colorMatch[1].trim());
        styleProps.stroke = color;
        styleProps['stroke-opacity'] = opacity;
      }
      if (widthMatch) {
        styleProps['stroke-width'] = parseFloat(widthMatch[1]);
      }
    }
    
    // Parse PolyStyle
    const polyStyleMatch = body.match(/<PolyStyle>([\s\S]*?)<\/PolyStyle>/);
    if (polyStyleMatch) {
      const psBody = polyStyleMatch[1];
      const colorMatch = psBody.match(/<color>([^<]+)<\/color>/);
      if (colorMatch) {
        const { color, opacity } = parseKmlColor(colorMatch[1].trim());
        styleProps.fill = color;
        styleProps['fill-opacity'] = opacity;
      }
    }
    
    styles[id] = styleProps;
  }
  
  function resolveStyle(styleUrl) {
    if (!styleUrl) return {};
    const id = styleUrl.replace(/^#/, '');
    const targetId = styleMaps[id] || id;
    return styles[targetId] || {};
  }
  
  // 2. Parse Placemarks
  console.log('Parsing Placemarks...');
  const placemarkRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  const newFeatures = [];
  let index = 0;
  
  let placemarkMatch;
  while ((placemarkMatch = placemarkRegex.exec(kmlContent)) !== null) {
    const placemarkBody = placemarkMatch[1];
    
    // Parse geometry
    let geometry = null;
    if (placemarkBody.includes('<MultiGeometry>')) {
      const mgMatch = placemarkBody.match(/<MultiGeometry>([\s\S]*?)<\/MultiGeometry>/);
      if (mgMatch) geometry = parseMultiGeometry(mgMatch[1]);
    } else if (placemarkBody.includes('<Polygon>')) {
      const polyMatch = placemarkBody.match(/<Polygon>([\s\S]*?)<\/Polygon>/);
      if (polyMatch) geometry = parsePolygon(polyMatch[1]);
    } else if (placemarkBody.includes('<LineString>')) {
      const lineMatch = placemarkBody.match(/<LineString>([\s\S]*?)<\/LineString>/);
      if (lineMatch) geometry = parseLineString(lineMatch[1]);
    }
    
    if (!geometry) {
      // Skip Placemarks without supported geometries
      continue;
    }
    
    index++;
    const featureId = `${featureIdPrefix}-${index}`;
    
    // Parse ExtendedData properties
    const extData = {};
    const dataMatches = placemarkBody.match(/<Data name="([^"]+)">([\s\S]*?)<\/Data>/g) || [];
    for (const dataBlock of dataMatches) {
      const nameMatch = dataBlock.match(/<Data name="([^"]+)">/);
      const valMatch = dataBlock.match(/<value>([\s\S]*?)<\/value>/);
      if (nameMatch) {
        const key = nameMatch[1].trim();
        const val = valMatch ? stripCData(valMatch[1]) : '';
        extData[key] = val;
      }
    }
    
    // Resolve category key name flexibly
    let category = '';
    for (const k of Object.keys(extData)) {
      if (k.toLowerCase().includes('category') || k.includes('Loại hạng mục')) {
        category = extData[k];
        break;
      }
    }
    
    // Extract style properties
    const styleUrlMatch = placemarkBody.match(/<styleUrl>([^<]+)<\/styleUrl>/);
    const styleUrl = styleUrlMatch ? styleUrlMatch[1].trim() : null;
    const styleProps = resolveStyle(styleUrl);
    
    const properties = {
      id: featureId,
      ...styleProps,
      category: category,
      source: 'google-mymaps'
    };
    
    // Add non-empty name and description
    const rawName = extData['name'] || '';
    const rawDesc = extData['description'] || '';
    if (rawName) properties.name = rawName;
    if (rawDesc) properties.description = rawDesc;
    
    newFeatures.push({
      type: 'Feature',
      geometry: geometry,
      properties: properties,
      id: featureId
    });
  }
  
  console.log(`Found ${newFeatures.length} valid new features from KML.`);
  
  // 3. Load old data for merging
  let oldGeojson = null;
  let oldOverlays = null;
  
  if (fs.existsSync(geojsonOutputPath)) {
    try {
      oldGeojson = JSON.parse(fs.readFileSync(geojsonOutputPath, 'utf8'));
      console.log(`Loaded old GeoJSON with ${oldGeojson.features?.length || 0} features.`);
    } catch (e) {
      console.warn(`Could not parse old GeoJSON file: ${e.message}`);
    }
  }
  
  if (fs.existsSync(overlaysPath)) {
    try {
      oldOverlays = JSON.parse(fs.readFileSync(overlaysPath, 'utf8'));
      console.log('Loaded old overlays.json.');
    } catch (e) {
      console.warn(`Could not parse old overlays.json: ${e.message}`);
    }
  }
  
  // Create output directories and backups if old files exist
  if (!fs.existsSync(path.dirname(geojsonOutputPath))) {
    fs.mkdirSync(path.dirname(geojsonOutputPath), { recursive: true });
  }
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  if (fs.existsSync(geojsonOutputPath)) {
    fs.copyFileSync(geojsonOutputPath, path.join(backupDir, `map-cache-${timestamp}.geojson`));
    console.log(`Backed up old map-cache.geojson to ${backupDir}`);
  }
  if (fs.existsSync(overlaysPath)) {
    fs.copyFileSync(overlaysPath, path.join(backupDir, `overlays-${timestamp}.json`));
    console.log(`Backed up old overlays.json to ${backupDir}`);
  }
  
  // 4. Match geometry and merge overlays
  const newOverlays = {
    objectInfo: {},
    myMapsStyles: {},
    textLabels: (oldOverlays && oldOverlays.textLabels) ? oldOverlays.textLabels : []
  };
  
  let mergedCount = 0;
  let unmatchedOldCount = 0;
  let unmatchedNewCount = 0;
  
  if (oldGeojson && oldGeojson.features && oldOverlays) {
    console.log('Performing smart geometry merge...');
    
    // Map fingerprint to list of old features (multimap for duplicate coordinates)
    const oldFeatureByFp = {};
    for (const f of oldGeojson.features) {
      const fp = getGeometryFingerprint(f.geometry);
      if (fp) {
        if (!oldFeatureByFp[fp]) oldFeatureByFp[fp] = [];
        oldFeatureByFp[fp].push(f);
      }
    }
    
    const usedOldIds = new Set();
    const migratedIdsMap = {}; // oldId -> newId
    
    for (const newFeat of newFeatures) {
      const newFp = getGeometryFingerprint(newFeat.geometry);
      const oldMatches = oldFeatureByFp[newFp] || [];
      
      // Find first unmatched old feature with the same coordinates
      const oldMatch = oldMatches.find(f => !usedOldIds.has(f.id));
      
      if (oldMatch) {
        const oldId = oldMatch.id;
        const newId = newFeat.id;
        usedOldIds.add(oldId);
        migratedIdsMap[oldId] = newId;
        
        // Migrate objectInfo if exists
        if (oldOverlays.objectInfo && oldOverlays.objectInfo[oldId]) {
          newOverlays.objectInfo[newId] = oldOverlays.objectInfo[oldId];
          mergedCount++;
        }
        
        // Migrate myMapsStyles if exists
        if (oldOverlays.myMapsStyles && oldOverlays.myMapsStyles[oldId]) {
          newOverlays.myMapsStyles[newId] = oldOverlays.myMapsStyles[oldId];
        }
      } else {
        unmatchedNewCount++;
      }
    }
    
    // Determine deleted overlays
    const oldOverlayIds = new Set([
      ...Object.keys(oldOverlays.objectInfo || {}),
      ...Object.keys(oldOverlays.myMapsStyles || {})
    ]);
    
    for (const oldId of oldOverlayIds) {
      if (!usedOldIds.has(oldId)) {
        unmatchedOldCount++;
        console.log(`⚠️ Overlay data of deleted feature ${oldId} was not migrated.`);
      }
    }
    
    console.log(`Merge summary:`);
    console.log(`- Successfully matched and migrated overlay data for ${mergedCount} features.`);
    console.log(`- ${unmatchedNewCount} new features had no prior overlay data.`);
    console.log(`- ${unmatchedOldCount} old features with overlay data were deleted from the map.`);
  } else {
    console.log('No prior GeoJSON/overlays found. Creating initial overlays structure.');
  }
  
  // 5. Save results
  const newGeojson = {
    type: 'FeatureCollection',
    features: newFeatures
  };
  
  fs.writeFileSync(geojsonOutputPath, JSON.stringify(newGeojson), 'utf8');
  console.log(`Saved new GeoJSON cache to ${geojsonOutputPath}`);
  
  fs.writeFileSync(overlaysPath, JSON.stringify(newOverlays, null, 2), 'utf8');
  console.log(`Saved new overlays JSON to ${overlaysPath}`);
  
  console.log(`--- KML Converter Finished Successfully ---`);
}

run().catch(err => {
  console.error('An error occurred during conversion:', err);
  process.exit(1);
});
