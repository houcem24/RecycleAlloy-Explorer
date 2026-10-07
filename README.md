# RecycleAlloy Explorer

**6171 Data Visualization — SoSe 2026 · Group 11**
Houssem Ouerdiane · Noor Abouelhoda

An interactive dashboard for exploring a large simulated dataset of sustainable
aluminium alloys made from recycled scrap. It helps a materials engineer see how
scrap mixing ratios, chemistry, and microstructure drive an alloy's mechanical
and thermophysical performance, and pick out promising candidates.

---

## 1. How to run

This is a plain HTML / JavaScript / D3 project — there is **no build step and no
server required**.

1. Unzip the project folder.
2. Open **`index.html`** in a modern browser (Chrome, Edge, or Firefox).
   - The page pulls D3 v7 and jQuery UI from their CDNs, so an internet
     connection is needed the first time you open it.
3. Go to the **Data Loading** tab and choose your dataset file with the file
   picker. Both formats work:
   - a comma-separated `.csv`, or
   - the original tab-separated `.txt` (the loader detects the delimiter
     automatically).
4. Once the file has loaded, open the **Dashboard** tab. All six views appear
   and are ready to use.

> **Tip:** if you just want to try it quickly, load one of the small sample
> files (e.g. a 10,000-row CSV) — it opens in about a second.

### Large files and performance

The full contest dataset is roughly **324,000 rows × 70 columns (~190 MB)**.
Loading every row into a live, six-view dashboard can exhaust a browser tab's
memory and crash it. To load the full file reliably, the app does two things:

- It reads the file as text and releases the raw string as soon as it is parsed.
- If the file has **more than 80,000 rows**, it keeps an **evenly-spaced sample
  of 80,000 rows** that still spans the entire dataset, and shows a short notice
  telling you how many rows are in use. Smaller files are used in full.

This keeps every interaction smooth while still representing the whole design
space. (The threshold is the `MAX_ROWS` constant in `dataVis.js` if you ever
want to change it.)

---

## 2. Project structure

```
index.html            Page shell: masthead, tabs, and the empty containers
                      the dashboard fills in.
dataVis.js            Framework plumbing (Part 1): file loading, delimiter
                      detection, large-file down-sampling, the data-preview
                      table, tab switching, and the shared selection state.
dashboard.js          The dashboard (Part 2): column detection, the control
                      bar, and all six linked, animated views.
dashboard_styles.css  Visual theme for the dashboard (layout, colours, chips,
                      sliders, tooltips).
style.css             Base framework styles.
TestData/             Small example CSVs shipped with the framework.
README.md             This file.
```

The shared **selection state** (`selected`, `selectionColors`) lives in
`dataVis.js`, which is why pinning an alloy in one view instantly updates all the
others.

---

## 3. The interface

### Global filter bar (top)

Six **range sliders**, one per scrap source (KS1295 piston alloy, 6082, 2024,
Battery-box, 3003, 4032). Dragging a slider narrows the whole dashboard to
alloys whose mixing ratio for that scrap falls in the chosen range — every view
updates together. A **Clear selection** button unpins all selected alloys.

### Per-plot controls

Each plot carries its own controls directly above it (axis pickers, a mode
toggle, or property chips), so the control that affects a plot always sits with
that plot.

### Pinning alloys

"Pinning" (selecting) an alloy is the core interaction. Click a point in Plot 1
(or a point in the Correlation Explorer) to pin it; it gets a colour and appears
in every other view. Up to seven alloys can be pinned at once. Each pinned alloy
shows as a chip under Plot 1 with a **×** button to remove it.

---

## 4. The six visualizations

### Plot 1 — Design-Space Scatter
**What it shows.** Every alloy as a point. You choose the X axis (any scrap
ratio or any of the 15 microstructure phase fractions) and the Y axis (any of
the 3 mechanical or 11 thermophysical properties).
**How to use it.** Zoom and pan with the mouse wheel / drag. Hover a point for a
read-out of its dominant scraps and its solidification behaviour (eutectic
fraction and temperature, liquidus and solidus temperatures, and the
solidification intervals). Click a point to pin the alloy.
**Why this view.** It answers the core sensitivity question — "how does this
input or phase affect this property?" — directly, with no projection, so the
position of every point is its real measured value.

### Plot 2 — Composition Ribbon
**What it shows.** For each pinned alloy, a single 100%-wide band split into
coloured segments. A toggle switches what the segments represent: **scrap
sources**, **atomic elements**, or **microstructure phases**.
**How to use it.** Pin one or more alloys, then switch the mode to see the same
alloys described at three levels; the segments animate between modes. Hover a
segment for its exact share.
**Why this view.** Composition is part-to-whole (the shares add to 100%), so a
normalised band is the honest encoding, and it links the recycling recipe to the
chemistry to the resulting microstructure.

### Plot 3 — Mechanical Radar
**What it shows.** The three mechanical properties — yield strength, hardness,
and hot-crack susceptibility (CSC) — on a normalised three-axis radar, one
polygon per pinned alloy.
**How to use it.** Pin alloys to compare their mechanical profiles at a glance;
hover a polygon (or a vertex dot) for the exact three values. A larger reach on
strength and hardness with a small CSC is the desirable shape.
**Why this view.** With exactly three objectives a radar is unambiguous and makes
shape-based comparison immediate.

### Plot 4 — Thermophysical Strips
**What it shows.** One horizontal track per thermophysical property (all 11). The
faint bar is the property's full range across the dataset; each pinned alloy
drops a coloured dot where it sits on that range.
**How to use it.** Pin alloys and read, per property, whether each sits low or
high relative to all alloys and to each other. Hover a dot for the exact value.
**Why this view.** Eleven properties are too many for a readable radar; a strip
per property stays legible and uses position — the most accurately read visual
channel.

### Plot 5 — Correlation Explorer
**What it shows.** A scatter of any one input (scrap, element, or phase) against
any one of the 14 target properties, with a least-squares trend line and the
**Pearson correlation coefficient r** reported (with a plain-language strength
label).
**How to use it.** Pick the input and the property from the two dropdowns. Read
the r value and the trend line to judge how strongly, and in which direction,
the input relates to the property. Pinned alloys are highlighted among the
points.
**Why this view.** It turns the "which factors matter" question into a direct,
quantified answer for any pair the user is curious about.

### Plot 6 — Multi-Alloy Comparison
**What it shows.** Grouped bars comparing **all pinned alloys** across a
user-chosen subset of the 14 properties. Each property is normalised 0–100%
across the dataset so properties on very different scales compare fairly.
**How to use it.** Pin the alloys you care about, then use the property chips
above the plot to enable or disable each property. Hover a bar for the alloy's
exact value on that property.
**Why this view.** It is the side-by-side decision view — once a few candidates
are shortlisted, it shows exactly where each one wins or loses across the metrics
that matter.

---

## 5. How the data is handled

- **Column groups.** On load, the columns are sorted automatically into scraps,
  elements, microstructure phases, mechanical properties, and thermophysical
  properties (see `detectColumns` in `dashboard.js`). Matching is tolerant of
  spacing and capitalisation, so small naming differences don't break detection.
- **Missing values (NaN).** These are meaningful — a phase that doesn't form, or
  a simulation that didn't converge. Rows are never dropped; each view simply
  skips missing values for the specific column it needs, so an alloy stays
  visible everywhere it has valid data.
- **Normalisation.** It is applied only where it is needed and only inside the
  view that needs it — the radar and the thermophysical strips normalise each
  axis, and the comparison bars normalise each property to 0–1. The scatter and
  correlation plots show raw measured values.

---

## 6. Notes for graders

- The delivered interface is the **Dashboard** tab. The Part-1 "Basic
  Visualization" views have been removed; their now-unused functions in
  `dataVis.js` are marked with `// [removed] ...` comments.
- All animated transitions use a single duration constant (`DUR`, ~400 ms) for a
  consistent feel.
- The code is organised top-to-bottom by concern, with a table of contents in
  the header comment of `dashboard.js` and a numbered banner for each section.
