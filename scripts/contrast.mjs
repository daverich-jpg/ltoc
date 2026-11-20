// WCAG 2.1 contrast for the status/text pairs in the Notion-based theme.
const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) }
const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a))
const lum = c => { const l = c.map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2] }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const W = hex('#ffffff'), P = hex('#f6f5f4')
const tint = (h, a, bg = W) => over(hex(h), a, bg)
const rows = [
  ['body text-2 on paper', hex('#31302e'), P, 4.5],
  ['muted text-3 on white', hex('#615d59'), W, 4.5],
  ['muted text-3 on paper', hex('#615d59'), P, 4.5],
  ['blue link/accent-ink on white', hex('#005bab'), W, 4.5],
  ['white on primary button', W, hex('#0075de'), 4.5],
  ['act-ink on white', hex('#a84500'), W, 4.5],
  ['act-ink on act tint', hex('#a84500'), tint('#dd5b00', 0.1), 4.5],
  ['watch on watch tint', hex('#391c57'), tint('#d6b6f6', 0.38), 4.5],
  ['ok-ink on ok tint', hex('#137a2a'), tint('#1aae39', 0.1), 4.5],
  ['sim-ink on sim tint', hex('#1c6e6b'), tint('#2a9d99', 0.12), 4.5],
  ['assumed brown on white', hex('#523410'), W, 4.5],
  ['act glyph vs white (non-text)', hex('#dd5b00'), W, 3],
  ['watch glyph stroke vs white', hex('#391c57'), W, 3],
  ['ok bar vs white (non-text)', hex('#159a32'), W, 3],
  ['heavy traffic vs road white', hex('#e8409f'), W, 3],
  ['standstill vs road white', hex('#a3196f'), W, 3],
  ['free traffic vs white (calm, by design)', hex('#cfcbc6'), W, 1],
  ['map label text-3 on map land', hex('#615d59'), hex('#fbfaf9'), 4.5],
  ['stepper text-4 future step (decorative)', hex('#a39e98'), W, 2.5],
]
for (const [n, f, b, min] of rows) { const r = ratio(f, b); console.log((r >= min ? 'PASS' : 'FAIL').padEnd(5), r.toFixed(2).padStart(5), `(need ${min})`, n) }

// ---- Dark theme ----
console.log('\n-- dark --')
const D = hex('#202020'), DB = hex('#191919'), DL = hex('#1c1c1c'), DR = hex('#3a3a3a')
const dtint = (h, a, bg = D) => over(hex(h), a, bg)
const drows = [
  ['text-2 on bg', hex('#d4d4d4'), DB, 4.5],
  ['muted text-3 on surface', hex('#a3a3a3'), D, 4.5],
  ['accent-ink on surface', hex('#6cb2f5'), D, 4.5],
  ['white on primary button', hex('#ffffff'), hex('#1f74c9'), 4.5],
  ['act-ink on act tint', hex('#ff9a5c'), dtint('#ff7a2e', 0.14), 4.5],
  ['watch on watch tint', hex('#c9a6f2'), dtint('#c9a6f2', 0.14), 4.5],
  ['ok-ink on ok tint', hex('#5fd47c'), dtint('#3bbf5a', 0.14), 4.5],
  ['sim-ink on sim tint', hex('#5fd0cb'), dtint('#3dbab5', 0.14), 4.5],
  ['assumed on surface', hex('#d1a878'), D, 4.5],
  ['indigo AI marker on its tint', hex('#9aa6f0'), dtint('#9aa6f0', 0.14), 4.5],
  ['act glyph vs surface', hex('#ff7a2e'), D, 3],
  ['watch glyph vs surface', hex('#c9a6f2'), D, 3],
  ['ok bar vs surface', hex('#3bbf5a'), D, 3],
  ['heavy traffic vs dark road', hex('#e8409f'), DR, 3],
  ['standstill vs dark road', hex('#ff8ccf'), DR, 3],
  ['slow traffic vs dark road (width also carries it)', hex('#8c3f70'), DR, 1.2],
  ['map label text-3 on land', hex('#a3a3a3'), DL, 4.5],
  ['diversion vs land', hex('#9aa6f0'), DL, 3],
]
for (const [n, f, b, min] of drows) { const r = ratio(f, b); console.log((r >= min ? 'PASS' : 'FAIL').padEnd(5), r.toFixed(2).padStart(5), `(need ${min})`, n) }
