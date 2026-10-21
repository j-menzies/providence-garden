import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, Geometry } from './model';
import { typeOf } from './catalogue';
import { circle, vertices, withVertices, type Fix } from './geo';

export const HOME: [number, number] = [-0.0698, 51.5014];

export type MapMode = 'browse' | 'draw' | 'place' | 'edit';

interface Props {
  features: Feature[];
  visibleLayers: Set<string>;
  aerial: boolean;
  aerialOpacity: number;
  selectedId: string | null;
  mode: MapMode;
  /** Vertices of a shape being drawn, or the single point being placed. */
  draft: [number, number][];
  draftKind: 'point' | 'line' | 'polygon';
  /** Geometry being edited (drag handles shown). */
  editGeometry: Geometry | null;
  userFix: Fix | null;
  flyTo: { centre: [number, number]; zoom?: number; seq: number } | null;
  /** Space taken by an open panel, so centring keeps features visible. */
  panelOpen: boolean;
  onSelect: (id: string | null) => void;
  onMapTap: (lngLat: [number, number]) => void;
  onEditChange: (g: Geometry) => void;
}

const empty = { type: 'FeatureCollection' as const, features: [] };

export function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const props = useRef(p);
  props.current = p;
  const handles = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      center: HOME,
      zoom: 17.6,
      maxZoom: 22,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          aerial: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
          },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#26302b' } },
          { id: 'aerial', type: 'raster', source: 'aerial' },
        ],
      },
    });
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('load', () => {
      map.addSource('features', { type: 'geojson', data: empty });
      map.addSource('accuracy', { type: 'geojson', data: empty });
      map.addSource('draft', { type: 'geojson', data: empty });
      map.addSource('me', { type: 'geojson', data: empty });

      map.addLayer({ id: 'poly-fill', type: 'fill', source: 'features', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': ['case', ['get', 'selected'], 0.45, ['==', ['get', 'type'], 'bed'], 0.12, 0.28] } });
      map.addLayer({ id: 'poly-line', type: 'line', source: 'features', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': ['case', ['get', 'selected'], '#ffffff', ['get', 'colour']], 'line-width': ['case', ['get', 'selected'], 3, ['==', ['get', 'type'], 'bed'], 2.5, 1.5] } });
      // MapLibre 4 can't vary line-dasharray per feature, so power runs get their own dashed layer.
      const linePaint: maplibregl.LineLayerSpecification['paint'] = { 'line-color': ['case', ['get', 'selected'], '#ffffff', ['get', 'colour']], 'line-width': ['case', ['get', 'selected'], 5, 3.5] };
      map.addLayer({ id: 'lines', type: 'line', source: 'features', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'layer'], 'power']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: linePaint });
      map.addLayer({ id: 'lines-power', type: 'line', source: 'features', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'layer'], 'power']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { ...linePaint, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'accuracy', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#f2b84b', 'fill-opacity': 0.18, 'fill-outline-color': '#f2b84b' } });
      map.addLayer({ id: 'points', type: 'circle', source: 'features', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': ['get', 'colour'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 4, 20, ['case', ['get', 'selected'], 11, 8]], 'circle-stroke-width': ['case', ['get', 'selected'], 3, 2], 'circle-stroke-color': ['case', ['get', 'selected'], '#ffffff', ['==', ['get', 'status'], 'rough'], '#f2b84b', '#14201a'] } });

      map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#ffffff', 'circle-radius': 6, 'circle-stroke-color': '#14201a', 'circle-stroke-width': 2 } });

      map.addLayer({ id: 'me-acc', type: 'fill', source: 'me', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#3d8bff', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'me-dot', type: 'circle', source: 'me', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#3d8bff', 'circle-radius': 7, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
      ready.current = true;
      sync();
    });
    map.on('click', (e) => {
      const cur = props.current;
      if (cur.mode === 'draw' || cur.mode === 'place') {
        cur.onMapTap([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      if (cur.mode !== 'browse') return;
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - 10, e.point.y - 10],
        [e.point.x + 10, e.point.y + 10],
      ];
      // Prefer points, then lines, then the smallest polygon under the tap.
      const order = ['points', 'lines', 'lines-power', 'poly-fill'];
      const hits = map.queryRenderedFeatures(box, { layers: order });
      hits.sort((a, b) => order.indexOf(a.layer.id) - order.indexOf(b.layer.id) || (a.properties.area ?? 0) - (b.properties.area ?? 0));
      cur.onSelect(hits[0] ? String(hits[0].properties.id) : null);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      ready.current = false;
    };
  }, []);

  function sync() {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const cur = props.current;
    const fc = {
      type: 'FeatureCollection' as const,
      features: cur.features
        .filter((f) => f.geometry && cur.visibleLayers.has(typeOf(f.type).layer) && !(cur.mode === 'edit' && f.id === cur.selectedId))
        .map((f) => {
          const g = f.geometry!;
          const area = g.type === 'Polygon' ? Math.abs(bboxArea(vertices(g))) : 0;
          return { type: 'Feature' as const, geometry: g, properties: { id: f.id, type: f.type, layer: typeOf(f.type).layer, colour: typeOf(f.type).colour, status: f.positionStatus, selected: f.id === cur.selectedId, area } };
        }),
    };
    // Polygons drawn largest first so smaller beds and groups sit on top.
    fc.features.sort((a, b) => b.properties.area - a.properties.area);
    (map.getSource('features') as GeoJSONSource).setData(fc);

    const sel = cur.features.find((f) => f.id === cur.selectedId);
    (map.getSource('accuracy') as GeoJSONSource).setData(
      sel?.geometry?.type === 'Point' && sel.positionStatus === 'rough' && sel.gpsAccuracy && cur.mode !== 'edit'
        ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(sel.geometry.coordinates, sel.gpsAccuracy)] } }
        : empty,
    );

    const d = cur.draft;
    const draftFeatures: GeoJSON.Feature[] = d.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }));
    if (cur.draftKind === 'polygon' && d.length >= 3) draftFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...d, d[0]]] } });
    else if (cur.draftKind !== 'point' && d.length >= 2) draftFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: d } });
    if (cur.mode !== 'edit') (map.getSource('draft') as GeoJSONSource).setData({ type: 'FeatureCollection', features: draftFeatures });

    const me = cur.userFix;
    (map.getSource('me') as GeoJSONSource).setData(
      me
        ? {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle([me.lng, me.lat], me.accuracy)] } },
              { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [me.lng, me.lat] } },
            ],
          }
        : empty,
    );

    map.setLayoutProperty('aerial', 'visibility', cur.aerial ? 'visible' : 'none');
    map.setPaintProperty('aerial', 'raster-opacity', cur.aerialOpacity);
    map.getCanvas().style.cursor = cur.mode === 'draw' || cur.mode === 'place' ? 'crosshair' : '';
  }

  useEffect(sync, [p.features, p.visibleLayers, p.aerial, p.aerialOpacity, p.selectedId, p.mode, p.draft, p.draftKind, p.userFix]);

  // Drag handles for refining a geometry.
  useEffect(() => {
    const map = mapRef.current;
    handles.current.forEach((m) => m.remove());
    handles.current = [];
    if (!map || p.mode !== 'edit' || !p.editGeometry) return;
    const g = p.editGeometry;
    const pts = vertices(g);
    const sel = props.current.features.find((f) => f.id === props.current.selectedId);
    const colour = sel ? typeOf(sel.type).colour : '#ffffff';
    pts.forEach((pt, i) => {
      const node = document.createElement('div');
      node.className = g.type === 'Point' ? 'handle handle-point' : 'handle';
      node.style.setProperty('--c', colour);
      node.setAttribute('aria-label', g.type === 'Point' ? 'Drag to move' : `Corner ${i + 1}, drag to move`);
      const m = new maplibregl.Marker({ element: node, draggable: true }).setLngLat(pt).addTo(map);
      m.on('drag', () => {
        const next = [...vertices(props.current.editGeometry!)];
        const ll = m.getLngLat();
        next[i] = [ll.lng, ll.lat];
        props.current.onEditChange(withVertices(props.current.editGeometry!, next));
      });
      handles.current.push(m);
    });
    // Rebuild handles only when the number of vertices changes; dragging updates in place.
  }, [p.mode, p.editGeometry ? vertices(p.editGeometry).length : 0, p.selectedId, p.editGeometry === null]);

  // Show the edited shape live while dragging.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    if (p.mode === 'edit' && p.editGeometry && p.editGeometry.type !== 'Point') {
      const d = vertices(p.editGeometry);
      const kind = p.editGeometry.type === 'Polygon' ? 'polygon' : 'line';
      const feats: GeoJSON.Feature[] = [];
      if (kind === 'polygon') feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...d, d[0]]] } });
      else feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: d } });
      (map.getSource('draft') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats });
    } else if (p.mode === 'edit') {
      (map.getSource('draft') as GeoJSONSource).setData(empty);
    }
  }, [p.mode, p.editGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const wide = window.innerWidth >= 900;
    map.setPadding(p.panelOpen ? (wide ? { top: 0, bottom: 0, left: 0, right: 400 } : { top: 0, left: 0, right: 0, bottom: Math.round(window.innerHeight * 0.55) }) : { top: 0, bottom: 0, left: 0, right: 0 });
  }, [p.panelOpen]);

  useEffect(() => {
    if (!p.flyTo || !mapRef.current) return;
    mapRef.current.easeTo({ center: p.flyTo.centre, zoom: p.flyTo.zoom ?? Math.max(mapRef.current.getZoom(), 19), duration: 600 });
  }, [p.flyTo?.seq]);

  return <div ref={el} className="map" data-testid="map" />;
}

function bboxArea(pts: [number, number][]) {
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) * 1e10;
}
