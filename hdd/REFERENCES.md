# References

The geometry was built against these photographs and figures. The photos were downloaded for study only and are
not part of this repository (`hdd/ref/` is ignored): they belong to their authors.

| Source | What it gave |
|---|---|
| Aesonlabs, "What is inside a hard drive? Complete stripdown", <https://aesonlabs.ca/blogs/what-is-inside-a-hard-drive-complete-stripdown/>: photos of the parking ramp, the head stack, the magnets and voice coil, the preamp, the platter stack | The ramp is a tan plastic comb at the platter's outer edge beside the actuator, one finger per head, the suspensions' lift tabs resting on it. The top magnet is a nickel-plated L-shaped plate held by three screws, cut in an arc around the pivot bearing. Under it, a copper coil shaped as a rounded trapezoid with arc-shaped sides centred on the pivot, opposite the arms. Crash stops beside it. Arms with lightening holes, tapered stainless suspensions, the slider at the tip, an amber flex cable from the E-block to a connector on the floor. The preamp is a black chip on the flex, on the side of the E-block. Platters separated by spacers, held by a screwed clamp on the hub. |
| Wikimedia Commons, "Hard drive.svg", <https://commons.wikimedia.org/wiki/File:Hard_drive-en.svg> | The overall top-view layout: the platter toward one end, the actuator axis in the opposite corner, the voice coil actuator on the connector side. |
| iFixit, "WD Blue Hard Drive Teardown" (WD10EZEX, 7,200 rpm), <https://www.ifixit.com/Teardown/WD+Blue+Hard+Drive+Teardown/159818> | The teardown order, the travel stops, the coil over a magnet that swings the heads. |
| Seagate Barracuda 7200.x product manuals and listings | 8.5 ms average read seek; 0.8 to 1.0 ms track to track. |

## Figures kept (one source: `hdd-shared/kin.js`, checked by `hdd/check.mjs`)

- 3.5-inch form factor (SFF-8301): 101.6 × 147 × 26.1 mm.
- Platter Ø 95 mm, Ø 25 mm bore, 1.27 mm, aluminium; data from r = 20 to 46 mm.
- 7,200 rpm = 120 rev/s; one turn 8.333 ms; average latency 4.167 ms.
- v = 2π r · 120: r = 20 mm → 15.08 m/s; r = 46 mm → 34.68 m/s.
- Average seek (a third of the stroke) 8.5 ms, track to track about 1 ms.
- Pivot → head L = 48 mm, spindle → pivot D = 57.1 mm (chosen for zero skew near r = 31 mm): 31.4° of stroke
  over the data band, skew from −16.6° to +15.3°.
- Zoned recording: 16 zones, 508 sectors of 4 KiB per track outside → 250 MB/s; 244 inside → 120 MB/s.
- 80 nm track pitch → 324,992 cylinders × 4 surfaces ≈ 2.0 TB.
- Flying height ≈ 3 nm (shown on a log scale, not to scale).
