import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 ships its worker as a separate file and looks for it next to its own script, which a bundle
// doesn't have. Let Vite emit the worker and tell MapLibre where it is, in dev and in the Pages build.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
maplibregl.setWorkerUrl(workerUrl)
import { NODES, Z0, unproj } from '../sim/geo'
import { LAB, type Basemap as Mode } from './store'
import { useTheme, type Theme } from './theme'

// Real basemap under the SVG overlay. The SVG stays the source of truth for pan/zoom and
// interaction; this map only follows its viewBox (non-interactive), so every overlay keeps
// working unchanged. Vector tiles: OpenFreeMap (OpenStreetMap data, no key).
// Imagery: Esri World Imagery, dimmed and desaturated so the incident colours still read.

const VECTOR: Record<Theme, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}
const SATELLITE: StyleSpecification = {
  version: 8,
  sources: {
    img: {
      type: 'raster', tileSize: 256, maxzoom: 18,
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    },
  },
  layers: [{ id: 'img', type: 'raster', source: 'img', paint: { 'raster-saturation': -0.55, 'raster-brightness-max': 0.78, 'raster-contrast': -0.1 } }],
}

export const ATTRIBUTION: Record<Exclude<Mode, 'schematic'>, string> = {
  map: '© OpenStreetMap contributors · OpenFreeMap',
  satellite: 'Imagery © Esri, Maxar, Earthstar Geographics · roads © OpenStreetMap contributors',
}

// Place names the overlay already labels at its junctions; the basemap drops them so nothing reads twice.
const OURS = Array.from(new Set(NODES.flatMap(n => [n.name, n.name.replace(/^towards /, ''), n.name.replace(/ 1$/, ' I')])))

/** Quiet the vector style: the basemap is orientation, the overlay is information. */
function mute(map: maplibregl.Map, theme: Theme) {
  for (const l of map.getStyle().layers ?? []) {
    const id = l.id
    // POIs, shields and house numbers compete with incident glyphs
    if (l.type === 'symbol' && /poi|shield|housenumber|aerialway|transit|airport/i.test(id)) { map.setLayoutProperty(id, 'visibility', 'none'); continue }
    if (l.type === 'symbol' && /^(label_|place_)(other|village|town|city|suburb)/.test(id) && 'filter' in l) {
      map.setFilter(id, ['all', l.filter as maplibregl.FilterSpecification, ['!', ['in', ['get', 'name'], ['literal', OURS]]]] as maplibregl.FilterSpecification)
    }
    if (l.type === 'symbol') { map.setPaintProperty(id, 'text-opacity', /place|label_city|label_town/i.test(id) ? 0.55 : 0.7) }
    if (l.type === 'line' && /road|highway|bridge|tunnel/i.test(id)) map.setPaintProperty(id, 'line-opacity', theme === 'dark' ? 0.75 : 0.9)
  }
}

export function Basemap({ mode, view, size }: { mode: Exclude<Mode, 'schematic'>; view: { x: number; y: number; w: number; h: number }; size: { w: number; h: number } }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const theme = useTheme()
  const [failed, setFailed] = useState(false)
  const applied = useRef('')
  const styleFor = (m: typeof mode, t: Theme) => m === 'satellite' ? SATELLITE : VECTOR[t]

  const camera = () => {
    const [lat, lon] = unproj(view.x + view.w / 2, view.y + view.h / 2)
    return { center: [lon, lat] as [number, number], zoom: Z0 + Math.log2(Math.max(1, size.w) / view.w) }
  }

  useEffect(() => {
    let m: maplibregl.Map
    try {
      m = new maplibregl.Map({
        container: el.current!, style: styleFor(mode, theme), interactive: false, attributionControl: false,
        fadeDuration: 0, ...camera(), maxZoom: 18,
        // ?lab keeps the frame readable so case-study captures can snapshot the map; the product doesn't pay for it
        canvasContextAttributes: { preserveDrawingBuffer: LAB },
      })
    } catch { setFailed(true); return }
    m.on('style.load', () => { if (m.getStyle().sources.openmaptiles) mute(m, currentThemeOf(m)) })
    map.current = m
    return () => { m.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // style follows mode + theme
  useEffect(() => {
    const m = map.current; if (!m) return
    const key = mode + theme
    ;(m as unknown as { _ltocTheme: Theme })._ltocTheme = theme
    if (applied.current !== key) { if (applied.current) m.setStyle(styleFor(mode, theme)); applied.current = key }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, theme])

  useEffect(() => { map.current?.resize() }, [size.w, size.h])
  useEffect(() => { map.current?.jumpTo(camera()) })

  if (failed) return null
  return <div ref={el} className="basemap" aria-hidden data-mode={mode} />
}

const currentThemeOf = (m: maplibregl.Map): Theme => (m as unknown as { _ltocTheme?: Theme })._ltocTheme ?? (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
