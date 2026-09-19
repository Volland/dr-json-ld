# Extension artwork

Three variants on the same brief: the letters **LD**, a **graph**, a **doctor**
motif, in blue and white. All three are one 128-unit square, white on a blue
tile, and all three draw their letters as paths — a mark that depended on a font
being installed would shift on the machine that rendered it.

| file | idea | reads at 42px |
| --- | --- | --- |
| `logo-ld-graph.svg` | The monogram *is* a graph: the letterforms are edges, their vertices are nodes, and one node is a medical cross. | yes — recommended |
| `logo-stethoscope-graph.svg` | A stethoscope whose tubing is the graph; the chest piece is the largest node and carries the monogram. | the stethoscope does; the LD does not |
| `logo-cross-graph.svg` | A cross that is also the simplest graph — four edges from one hub — with the letters in the quadrants it leaves empty. | the cross does; the letters do not |

`logo-ld-graph.svg` is the recommendation because it is the only one that keeps
all three parts of the brief legible at the size the extensions list actually
uses.

## Regenerating the raster

The Marketplace icon in `package.json` **must be a PNG** — an SVG there is
rejected — so the SVG is the source and the PNG is built from it:

```bash
rsvg-convert -w 256 -h 256 logo-ld-graph.svg -o icon.png
```

`icon.png` is committed because publishing needs it; edit the SVG and rerun the
command rather than touching the PNG.
