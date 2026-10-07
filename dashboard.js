/*
* Data Visualization - Framework
* Copyright (C) University of Passau
*   Faculty of Computer Science and Mathematics
*   Chair of Cognitive sensor systems
*
* ===========================================================================
* RecycleAlloy Explorer — Dashboard (Part 2)
* Group 11 — Houssem OUERDIANE & Noor ABOUELHODA
* ===========================================================================
*
* PURPOSE
*   An interactive dashboard for exploring a large simulated dataset of
*   recycled-aluminium alloys (~324k rows × 70 columns). Six coordinated views
*   share ONE selection: pinning an alloy in any view highlights it everywhere.
*
* THE SIX VIEWS
*   Plot 1  Design-Space Scatter   Pick any input (scrap ratio / microstructure
*                                  phase) on X vs any property (mechanical /
*                                  thermophysical) on Y. Canvas points + SVG
*                                  overlay; zoom, hover read-out, multi-select.
*   Plot 2  Composition Ribbon     A 100%-wide band per selected alloy, morphing
*                                  between scrap / element / phase composition.
*   Plot 3  Mechanical Radar       The 3 mechanical properties for pinned alloys.
*   Plot 4  Thermophysical Strips  All 11 thermophysical properties, one track
*                                  each, every pinned alloy a dot on the range.
*   Plot 5  Correlation Explorer   Scatter of any input vs any property, with the
*                                  Pearson r coefficient reported.
*   Plot 6  Multi-Alloy Comparison Grouped bars comparing all pinned alloys over
*                                  a user-chosen subset of the 14 properties.
*
* DATA GROUPS (auto-detected in detectColumns)
*   inputs    6 scrap mixing ratios      elements  12 atomic elements
*   micro     15 phase volume fractions  mech      3 mechanical properties
*   thermo    11 thermophysical props    targets   the 14 mech+thermo properties
*
* LAYOUT OF THIS FILE
*   1. Globals & state
*   2. Column detection
*   3. init / refresh / filter pipeline
*   4. Selection helpers (shared with the framework's `selected` set)
*   5. Global controls (scrap-ratio filter sliders)
*   6. Per-plot controls (each plot's own pickers, shown above that plot)
*   7. Panel construction
*   8. Plot 1 … Plot 6 render functions (each in its own section)
*   9. Utilities (labels, formatting, statistics, tooltips)
*
* CONVENTIONS
*   - `d<Name>` variables hold the D3 selection for a plot's drawing group.
*   - All transitions use DUR (~400 ms) for consistent, trackable animation.
*   - Selection state (`selected`, `selectionColors`) lives in dataVis.js so the
*     dashboard and the framework stay in sync.
*/

// ===========================================================================
//  1. GLOBALS & STATE
// ===========================================================================
const DUR = 400;                            // animation duration (ms), used everywhere
const SCATTER_CAP = 8000;                   // max background points drawn in Plots 1 & 5
                                            // (the full data is kept; only the DRAWN
                                            //  sample is capped so rendering stays fast)
// --- data ---
let dashData = [];        // the full parsed dataset (all rows)
let dashRows = [];        // rows passing the current global (scrap-ratio) filter
let dashFilter = {};      // { columnName: [min, max] } active filter ranges

// detected column groups (filled by detectColumns)
let cols = { inputs: [], elements: [], micro: [], mech: [], thermo: [], targets: [], numeric: [] };

// [min, max] for every numeric column, computed once by computeRanges().
// Views read from here instead of re-scanning the whole dataset each render.
let ranges = {};

// --- per-plot user choices ---
let scatterX = null, scatterY = null;   // Plot 1 axes
let compMode = "scraps";                // Plot 2 mode: "scraps" | "elements" | "phases"
let corrX = null, corrY = null;         // Plot 5 axes (input vs property)
let compareProps = [];                  // Plot 6 chosen properties (subset of the 14 targets)

// --- D3 selections / canvas handles for each plot's drawing area ---
let dScatterG, scCanvas, scCtx, scX, scY, scZoom, scTransform = d3.zoomIdentity;  // Plot 1
let dRibbon, dRadar, dStrips, dCorr, dCompare;                                    // Plots 2–6

// ===========================================================================
//  2. COLUMN DETECTION — sort the 70 raw columns into meaningful groups
// ===========================================================================
// Given the parsed data, return the six meaningful column groups. The dataset's
// column NAMES are the only clue to a column's role, so most of this is careful
// name-matching, tolerant of spacing and capitalisation differences.
function detectColumns(data) {
    const all = data.columns;                       // every column name, in file order
    // a column counts as "numeric" only if every value is a number or null
    const numeric = all.filter(c => data.every(r => r[c] === null || typeof r[c] === "number"));
    // helper: strip whitespace + lowercase, so "YS (MPa)" and "ys(mpa)" match
    const norm = s => String(s).replace(/\s+/g, "").toLowerCase();

    // --- 6 scrap inputs: a "%" column whose name contains a known scrap token ---
    const inputTokens = ["ks1295","6082","2024","batterybox","bat-box","4043","4032","3003"];
    const isPct = c => /\[%\]/.test(c) || /%\s*$/.test(c);           // ends in % or [%]
    let inputs = numeric.filter(c => isPct(c) && inputTokens.some(t => norm(c).includes(norm(t))));
    // fallback: if the names don't match, take any "%" column that isn't a
    // eutectic-fraction output (so we don't mistake an output for an input)
    if (!inputs.length) inputs = numeric.filter(c => isPct(c) && !/frac|eut/i.test(c));

    // --- 12 atomic elements: columns whose name is exactly an element symbol ---
    const elementNames = ["Al","Si","Cu","Ni","Mg","Mn","Fe","Cr","Ti","Zr","V","Zn"];
    const elements = numeric.filter(c => elementNames.includes(c));

    // --- 15 microstructure phases: every "Vf_..." volume-fraction column ---
    const micro = numeric.filter(c => /^Vf_/i.test(c));

    // --- 3 mechanical properties: match each wanted name to a real column ---
    const mechWanted = ["CSC","YS(MPa)","hardness(Vickers)"];
    // for each wanted name, find the actual column with the same normalised name;
    // filter(Boolean) drops any that weren't found
    const mech = mechWanted.map(w => numeric.find(c => norm(c) === norm(w))).filter(Boolean);

    // --- 11 thermophysical properties: same name-matching approach ---
    const thermoWanted = ["CTEvol(1/K)(20.0-300.0°C)","Density(g/cm3)","Volume(m3/mol)",
        "El.conductivity(S/m)","El. resistivity(ohm m)","heat capacity(J/(mol K))",
        "Therm.conductivity(W/(mK))","Therm. diffusivity(m2/s)","Therm.resistivity(mK/W)",
        "Linear thermal expansion (1/K)(20.0-300.0°C)","Technical thermal expansion (1/K)(20.0-300.0°C)"];
    let thermo = thermoWanted.map(w => numeric.find(c => norm(c) === norm(w))).filter(Boolean);
    // if some names didn't match, top up with left-over numeric columns that are
    // not inputs/elements/phases and not phase-temperature columns (T_, delta_T, …)
    if (thermo.length < 11) {
        const used0 = new Set([...inputs, ...elements, ...micro, ...mech, ...thermo]);
        const extra = numeric.filter(c => !used0.has(c) &&
            !/^T_|^T\(|^delta_T|^eut|liqu|sol|CSC/i.test(c));
        thermo = [...thermo, ...extra];
    }

    // the 14 "target" properties = 3 mechanical + 11 thermophysical
    const targets = [...mech, ...thermo];

    return { inputs, elements, micro, mech, thermo, targets, numeric };
}

// Compute [min, max] for every numeric column in ONE pass over the rows.
// (Calling d3.extent once per column would scan the data once per column —
//  here we scan the data a single time and update every column's min/max as we
//  go, which is dramatically cheaper on 324k rows.)
function computeRanges() {
    ranges = {};
    const numeric = cols.numeric;
    // start each column at [+Infinity, -Infinity] so the first value overwrites it
    numeric.forEach(c => ranges[c] = [Infinity, -Infinity]);
    for (const row of dashData) {                 // one pass over all rows
        for (const c of numeric) {                // update every numeric column
            const v = row[c];
            if (v == null || isNaN(v)) continue;  // skip NaN / missing
            const r = ranges[c];
            if (v < r[0]) r[0] = v;               // new minimum
            if (v > r[1]) r[1] = v;               // new maximum
        }
    }
    // guard: a column that was entirely NaN gets a safe default range
    numeric.forEach(c => {
        if (ranges[c][0] === Infinity) ranges[c] = [0, 1];
    });
}

// ---------------------------------------------------------------------------
//  3. INIT / REFRESH / FILTER — entry point and the render pipeline
// ---------------------------------------------------------------------------
function initDashboard(_data) {
    dashData = _data;
    cols = detectColumns(_data);

    // Precompute the [min, max] of every numeric column ONCE, in a single pass
    // over the data. Views read ranges from this cache instead of scanning all
    // 324k rows on every render — the key change that lets the full file load.
    computeRanges();

    // Choose sensible starting axes. `||` chains fall back gracefully if a
    // preferred column is missing: Plot 1 defaults to (first scrap) vs (yield
    // strength, or the first available mechanical/thermophysical/numeric column).
    scatterX = cols.inputs[0] || cols.numeric[0];
    scatterY = cols.mech.find(c => /YS/i.test(c)) || cols.mech[0] || cols.thermo[0] || cols.numeric[1];

    // plot 5 correlation defaults: an input vs yield strength
    corrX = cols.inputs[0] || cols.numeric[0];
    corrY = cols.mech.find(c => /YS/i.test(c)) || cols.targets[0];

    // plot 6 compare: start with the 3 mechanical properties enabled
    compareProps = cols.mech.slice();

    // seed filter ranges from the precomputed cache (no re-scan of the data)
    dashFilter = {};
    cols.inputs.forEach(c => dashFilter[c] = ranges[c].slice());

    buildControls();    // build the top filter bar
    buildPanels();      // build the six plot cards + their drawing areas
    applyFilter();      // compute the filtered rows and draw every view

    // Panels have zero width while the Dashboard tab is hidden, so charts must be
    // rebuilt once it becomes visible (or the window resizes). We attach these
    // listeners only once (guarded by window.__dashHooked).
    if (!window.__dashHooked) {
        window.__dashHooked = true;
        let rt;                                    // debounce timer handle
        const refit = () => {
            const vis = document.querySelector("#Dashboard");
            if (!vis || vis.style.display === "none") return;   // only if visible
            buildPanels(); refreshAll();                        // re-measure + redraw
        };
        // on resize, wait 200 ms after the last event before refitting (debounce)
        window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(refit, 200); });
        // when a tab button is clicked, refit shortly after it becomes visible
        document.querySelectorAll(".tablink").forEach(b =>
            b.addEventListener("click", () => setTimeout(refit, 60)));
    }
}

// Re-draw every view. Called whenever the selection or the filter changes so
// all six plots always reflect the same shared state.
// Redraws every view. Called after any change to the selection or the filter,
// so all six plots always reflect the same shared state.
function refreshAll() {
    renderScatter();    // Plot 1
    renderRibbon();     // Plot 2
    renderRadar();      // Plot 3
    renderStrips();     // Plot 4
    renderCorr();       // Plot 5
    renderCompare();    // Plot 6
    renderChips();      // selected-alloy chips under Plot 1
}

// Recompute dashRows = the rows that pass every active scrap-ratio filter,
// then redraw. A row passes a filter if its value is inside [min, max]; missing
// values (null/NaN) are kept so an alloy is never hidden for lacking one number.
function applyFilter() {
    dashRows = dashData.filter(d =>
        cols.inputs.every(c => {                 // must satisfy ALL scrap filters
            const v = d[c], f = dashFilter[c];   // value and this column's [min,max]
            if (!f) return true;                 // no filter set → keep
            return v === null || isNaN(v) || (v >= f[0] && v <= f[1]);
        }));
    refreshAll();
}

// ---------------------------------------------------------------------------
//  4. SELECTION HELPERS — pin/unpin alloys; colours come from the framework
// ---------------------------------------------------------------------------
function toggleSelect(index) {
    if (selected.has(index)) {
        // already pinned → unpin it and free its colour
        selected.delete(index); selectionColors.delete(index);
    } else if (selected.size < maxSelected) {
        // pin it and assign the first unused colour from the shared palette
        selected.add(index);
        const usedC = new Set(selectionColors.values());
        selectionColors.set(index, availableColors.find(c => !usedC.has(c))
            || availableColors[selectionColors.size % availableColors.length]);
    }
    refreshAll();   // re-render every view from the shared selection state
}
// Colour assigned to a pinned alloy (falls back to teal if somehow unset).
function selColor(i) { return selectionColors.get(i) || "#0e8f9b"; }
// The full row objects for all currently pinned alloys.
function selectedRows() { return dashData.filter(d => selected.has(d.__index)); }

// ---------------------------------------------------------------------------
//  5. GLOBAL CONTROLS — scrap-ratio filter sliders shown at the very top
// ---------------------------------------------------------------------------
// Builds the global filter bar at the very top: a "Clear selection" button and
// one range slider per scrap source. Runs once on load (and again on resize).
function buildControls() {
    // Find the control bar container. If it doesn't exist yet, create it and
    // insert it just BEFORE the plot grid so it sits at the top of the page.
    let bar = d3.select("#dashControls");
    if (bar.empty())
        bar = d3.select("#Dashboard").insert("div", ".dashboardGrid")
            .attr("id", "dashControls").attr("class", "dashControls");
    bar.selectAll("*").remove();                 // wipe old content before rebuilding

    // --- header row: title + a button to unpin every selected alloy ---
    const head = bar.append("div").attr("class","globalHead");
    head.append("span").attr("class","globalTitle").text("Global filters");
    head.append("button").attr("class", "ctrlBtn").text("Clear selection")
        .on("click", () => {
            selected.clear(); selectionColors.clear();   // drop all pins + their colours
            refreshAll();                                // redraw every view (now empty of pins)
        });

    // --- one range slider per scrap source ---
    const sliders = bar.append("div").attr("class", "sliderRow");
    // Helper that builds a single labelled range slider for column `c`.
    // `group` is a CSS class ("scrap") used only for colour styling.
    const addSlider = (c, group) => {
        const ext = ranges[c];                   // [min, max] of this column (precomputed)
        if (ext[0] == null) return;              // skip a column with no numeric values
        const box = sliders.append("div").attr("class", "sliderBox " + group);
        box.append("div").attr("class", "sliderLabel").text(shortLabel(c));   // full name
        // live-updating text showing the currently selected [low – high] range
        const val = box.append("div").attr("class", "sliderVal").text(fmt(ext[0]) + " – " + fmt(ext[1]));
        const slot = box.append("div").attr("class", "sliderSlot");
        // Turn the empty <div> into a jQuery UI two-handle range slider.
        $(slot.node()).slider({
            range: true, min: ext[0], max: ext[1], values: [ext[0], ext[1]],   // start fully open
            step: Math.max((ext[1]-ext[0])/100, 1e-9),                          // ~100 steps, never 0
            // while dragging: just update the label (cheap, no re-filter)
            slide: (e,ui) => val.text(fmt(ui.values[0]) + " – " + fmt(ui.values[1])),
            // on release: store the new [min,max] and re-filter every view
            change: (e,ui) => { dashFilter[c] = [ui.values[0], ui.values[1]]; applyFilter(); }
        });
    };
    // section label, then build one slider for each of the 6 scrap inputs
    sliders.append("div").attr("class","sliderGroupLabel").text("Scrap mixing ratios");
    cols.inputs.forEach(c => addSlider(c, "scrap"));
}

// Adds a labelled <optgroup> of <option>s to a <select>. Used by the per-plot
// dropdowns so related columns (e.g. "Mechanical", "Thermophysical") are grouped.
function appendOptGroup(sel, label, list) {
    if (!list.length) return;                    // nothing to add for an empty group
    const g = sel.append("optgroup").attr("label", label);
    g.selectAll("option").data(list).join("option")
        .attr("value", d => d)                   // option value = raw column name
        .text(d => shortLabel(d));               // visible text = full human-readable name
}

// ---------------------------------------------------------------------------
//  6. PER-PLOT CONTROLS — each plot's own pickers, rendered above that plot
// ---------------------------------------------------------------------------
// Plot 1's controls: two dropdowns choosing the X and Y columns of the scatter.
// Changing either resets the zoom (scTransform) and redraws the scatter.
function buildScatterControls() {
    const host = d3.select("#chart1Ctrl"); host.selectAll("*").remove();
    // X axis: any scrap input or any microstructure phase
    const xBox = host.append("div").attr("class","pcField");
    xBox.append("label").text("X");
    const xSel = xBox.append("select").on("change", function(){ scatterX=this.value; scTransform=d3.zoomIdentity; renderScatter(); });
    appendOptGroup(xSel, "Scrap inputs", cols.inputs);
    appendOptGroup(xSel, "Microstructure (Vf)", cols.micro);
    xSel.property("value", scatterX);            // show the current choice as selected

    // Y axis: any mechanical or thermophysical property
    const yBox = host.append("div").attr("class","pcField");
    yBox.append("label").text("Y");
    const ySel = yBox.append("select").on("change", function(){ scatterY=this.value; scTransform=d3.zoomIdentity; renderScatter(); });
    appendOptGroup(ySel, "Mechanical", cols.mech);
    appendOptGroup(ySel, "Thermophysical", cols.thermo);
    ySel.property("value", scatterY);
}

// Plot 2's control: a three-way toggle choosing what the composition band shows.
function buildRibbonControls() {
    const host = d3.select("#chart2Ctrl"); host.selectAll("*").remove();
    const box = host.append("div").attr("class","pcField");
    box.append("label").text("Show as");
    const seg = box.append("div").attr("class","segToggle");
    // one button per mode; [key, label] pairs
    [["scraps","Scraps"],["elements","Elements"],["phases","Phases"]].forEach(([k,lab]) => {
        seg.append("button").attr("class","segBtn"+(compMode===k?" on":""))  // highlight active
            .text(lab).on("click", function(){
                compMode=k;                              // remember the chosen mode
                seg.selectAll(".segBtn").classed("on",false);   // clear all highlights
                d3.select(this).classed("on",true);             // highlight this one
                renderRibbon();                                 // redraw with the new mode
            });
    });
}

// Plot 5's controls: pick the input (X) and property (Y) to correlate.
function buildCorrControls() {
    const host = d3.select("#chart5Ctrl"); host.selectAll("*").remove();
    // Input: a scrap, an element, or a phase
    const xBox = host.append("div").attr("class","pcField");
    xBox.append("label").text("Input");
    const xSel = xBox.append("select").on("change", function(){ corrX=this.value; renderCorr(); });
    appendOptGroup(xSel, "Scrap inputs", cols.inputs);
    appendOptGroup(xSel, "Elements", cols.elements);
    appendOptGroup(xSel, "Microstructure (Vf)", cols.micro);
    xSel.property("value", corrX);

    // Property: any mechanical or thermophysical target
    const yBox = host.append("div").attr("class","pcField");
    yBox.append("label").text("Property");
    const ySel = yBox.append("select").on("change", function(){ corrY=this.value; renderCorr(); });
    appendOptGroup(ySel, "Mechanical", cols.mech);
    appendOptGroup(ySel, "Thermophysical", cols.thermo);
    ySel.property("value", corrY);
}

// Plot 6's control: a row of toggle chips, one per target property. Clicking a
// chip adds/removes that property from the comparison (compareProps).
function buildCompareControls() {
    const host = d3.select("#chart6Ctrl"); host.selectAll("*").remove();
    host.append("label").attr("class","pcInlineLabel").text("Properties");
    const chips = host.append("div").attr("class","propChips");
    cols.targets.forEach(p => {                       // one chip per property
        chips.append("button")
            .attr("class","propChip" + (compareProps.includes(p) ? " on" : ""))  // on = enabled
            .text(shortLabel(p))
            .on("click", function(){
                const i = compareProps.indexOf(p);
                if (i>=0) compareProps.splice(i,1);   // was enabled → remove it
                else compareProps.push(p);            // was disabled → add it
                d3.select(this).classed("on", compareProps.includes(p));   // update highlight
                renderCompare();                      // redraw the bars
            });
    });
}

// ---------------------------------------------------------------------------
//  7. PANEL CONSTRUCTION — build the six cards and their drawing areas
// ---------------------------------------------------------------------------
// Creates one plot card (title + a controls strip + an empty drawing div) and
// appends it to the grid — but only if it doesn't already exist. `id` is the
// drawing div's id (e.g. "chart1"); its controls strip gets id "chart1Ctrl".
function ensurePanel(id, idx, title, subtitle) {
    if (!d3.select("#" + id).empty()) return;    // already built → do nothing
    const grid = d3.select(".dashboardGrid");
    const c = grid.append("div").attr("class", "container").attr("data-chart", idx);
    // header: a small index badge (01, 02, …) plus title and subtitle
    const head = c.append("div").attr("class", "panel-head");
    head.append("span").attr("class", "panel-idx").text(String(idx).padStart(2,"0"));
    const h = head.append("div"); h.append("h2").text(title); h.append("h4").text(subtitle);
    c.append("div").attr("class", "panelControls").attr("id", id + "Ctrl");  // per-plot filters
    c.append("div").attr("id", id);              // the empty div each plot draws into
}

// Returns the current drawing size for a plot. Width is measured from the first
// card so plots fill their column; height is fixed. Guards against a zero width
// (which happens while the tab is hidden) with sensible minimums.
function panelSize() {
    const el = document.querySelector("#chart1");
    const w = el ? el.clientWidth : 0;
    return { W: Math.max(w || 360, 220), H: 320 };
}

// Creates all six plot cards (if not already present), then builds each plot's
// controls and its drawing surface (canvas for Plot 1, SVG for the rest).
function buildPanels() {
    ensurePanel("chart1", 1, "Design-Space Scatter", "Any input vs any property");
    ensurePanel("chart2", 2, "Composition Ribbon", "What each alloy is made of");
    ensurePanel("chart3", 3, "Mechanical Radar", "Strength, hardness, crack risk");
    ensurePanel("chart4", 4, "Thermophysical Strips", "All 11 properties at a glance");
    ensurePanel("chart5", 5, "Correlation Explorer", "Any input vs any property");
    ensurePanel("chart6", 6, "Multi-Alloy Comparison", "Selected alloys across chosen properties");

    const { W, H } = panelSize();

    // ---- Plot 1: per-plot axis controls + scatter + selected chips ----
    buildScatterControls();
    d3.select("#chart1").selectAll("*").remove();
    const wrap = d3.select("#chart1").append("div").attr("class","scatterWrap")
        .style("position","relative").style("width", W+"px").style("height", H+"px");
    scCanvas = wrap.append("canvas").attr("width", W).attr("height", H)
        .style("position","absolute").style("left",0).style("top",0).node();
    scCtx = scCanvas.getContext("2d");
    dScatterG = wrap.append("svg").attr("width", W).attr("height", H)
        .style("position","absolute").style("left",0).style("top",0);
    wrap.append("div").attr("class","hoverPanel").style("opacity",0);
    // chips panel sits under the scatter (its own div, outside the fixed-height wrap)
    d3.select("#chart1").append("div").attr("class","chipsPanel").attr("id","selChips");

    // ---- Plot 2: composition-mode toggle ----
    buildRibbonControls();
    dRibbon = freshSvg("#chart2", W, H);

    // ---- Plot 3: no per-plot control (fixed 3 mechanical axes) ----
    d3.select("#chart3Ctrl").selectAll("*").remove();
    dRadar  = freshSvg("#chart3", W, H).append("g").attr("transform",`translate(${W/2},${H/2})`);

    // ---- Plot 4: no per-plot control (all 11) ----
    d3.select("#chart4Ctrl").selectAll("*").remove();
    dStrips = freshSvg("#chart4", W, Math.max(H, 26 * (cols.thermo.length || 11) + 30));

    // ---- Plot 5: correlation axis pickers ----
    buildCorrControls();
    dCorr = freshSvg("#chart5", W, H);

    // ---- Plot 6: property select/deselect filter ----
    buildCompareControls();
    dCompare = freshSvg("#chart6", W, H);

    renderChips();
}

// Empties a plot's div and appends a fresh <svg> of the given size, returning
// the SVG selection. Used to (re)initialise the SVG-based plots.
function freshSvg(id, w, h) {
    d3.select(id).selectAll("*").remove();       // clear any previous SVG
    return d3.select(id).append("svg").attr("width", w).attr("height", h);
}

// ===========================================================================
//  8a. PLOT 1 — DESIGN-SPACE SCATTER (any input vs any property)
// ===========================================================================
function renderScatter() {
    if (!scatterX || !scatterY || !scCtx) return;
    const { W, H } = panelSize();
    const m = { t: 14, r: 14, b: 40, l: 56 };   // plot margins (leave room for axes)

    // keep only rows with valid numbers on both chosen axes
    const pts = dashRows.filter(d =>
        d[scatterX] != null && !isNaN(d[scatterX]) &&
        d[scatterY] != null && !isNaN(d[scatterY]));

    // Drawing 324k canvas arcs every zoom frame is what freezes the browser.
    // We draw at most SCATTER_CAP background points (an even sample across the
    // filtered set) but ALWAYS draw every pinned alloy exactly. Hover/click below
    // still search the full `pts`, so no alloy becomes unclickable.
    const bg = sampleArray(pts, SCATTER_CAP);

    // base (un-zoomed) scales from the cached column ranges (no per-render scan)
    scX = d3.scaleLinear().domain(ranges[scatterX]).nice().range([m.l, W-m.r]);
    scY = d3.scaleLinear().domain(ranges[scatterY]).nice().range([H-m.b, m.t]);

    // axis groups + titles live on the SVG overlay (drawn crisply as vectors)
    dScatterG.selectAll("*").remove();
    const gx = dScatterG.append("g").attr("class","scAxis").attr("transform",`translate(0,${H-m.b})`);
    const gy = dScatterG.append("g").attr("class","scAxis").attr("transform",`translate(${m.l},0)`);
    dScatterG.append("text").attr("class","scAxisTitle")
        .attr("x",(m.l+W-m.r)/2).attr("y",H-4).attr("text-anchor","middle").text(shortLabel(scatterX));
    dScatterG.append("text").attr("class","scAxisTitle")
        .attr("transform",`translate(14,${(m.t+H-m.b)/2}) rotate(-90)`)
        .attr("text-anchor","middle").text(shortLabel(scatterY));

    // Redraw axes for the current zoom transform `tx` (tx.rescaleX shifts+scales).
    const drawAxes = (tx) => {
        gx.call(d3.axisBottom(tx.rescaleX(scX)).ticks(6));
        gy.call(d3.axisLeft(tx.rescaleY(scY)).ticks(6));
    };
    // Draw points on the canvas. Two passes: the faint background sample first,
    // then the pinned alloys on top in their colours (searched over ALL pts so
    // none is missed).
    const drawPoints = (tx) => {
        const zx = tx.rescaleX(scX), zy = tx.rescaleY(scY);   // zoom-adjusted scales
        scCtx.clearRect(0,0,W,H);
        scCtx.save();
        scCtx.beginPath(); scCtx.rect(m.l, m.t, W-m.r-m.l, H-m.b-m.t); scCtx.clip();  // stay inside axes
        for (const d of bg) {                                 // capped background sample
            if (selected.has(d.__index)) continue;            // skip pinned (drawn later)
            scCtx.globalAlpha = 0.4; scCtx.fillStyle = "#8fb2c4";
            scCtx.beginPath(); scCtx.arc(zx(d[scatterX]), zy(d[scatterY]), 2.2, 0, 6.283); scCtx.fill();
        }
        for (const d of pts) {                                // every pinned alloy, exact
            if (!selected.has(d.__index)) continue;
            scCtx.globalAlpha = 0.98; scCtx.fillStyle = selColor(d.__index);
            scCtx.beginPath(); scCtx.arc(zx(d[scatterX]), zy(d[scatterY]), 5.5, 0, 6.283); scCtx.fill();
            scCtx.lineWidth = 1.5; scCtx.strokeStyle = "#1b232b"; scCtx.stroke();
        }
        scCtx.restore(); scCtx.globalAlpha = 1;
    };
    const redraw = (tx) => { drawAxes(tx); drawPoints(tx); };
    redraw(scTransform);

    // Throttle zoom redraws to one per animation frame. Without this, a fast
    // drag queues hundreds of full canvas redraws and the tab locks up.
    let zoomQueued = false;
    scZoom = d3.zoom().scaleExtent([1, 40])
        .translateExtent([[0,0],[W,H]]).extent([[0,0],[W,H]])
        .on("zoom", (ev) => {
            scTransform = ev.transform;
            if (!zoomQueued) {
                zoomQueued = true;
                requestAnimationFrame(() => { redraw(scTransform); zoomQueued = false; });
            }
        });
    dScatterG.call(scZoom);
    dScatterG.call(scZoom.transform, scTransform);

    const hoverPanel = d3.select("#chart1 .hoverPanel");
    // Find the nearest DRAWN point to the cursor. We search `bg` (the points
    // actually on screen) plus every selected alloy, not all 324k rows, so
    // pointer moves stay instant. `bd` is the squared pixel distance threshold.
    const pickSet = bg;
    const pick = (mx, my, tx) => {
        const zx = tx.rescaleX(scX), zy = tx.rescaleY(scY);
        let best=null, bd=100;                              // 100 = 10px radius, squared
        for (const d of pickSet) {
            const dx = zx(d[scatterX])-mx, dy = zy(d[scatterY])-my, dd = dx*dx+dy*dy;
            if (dd < bd) { bd = dd; best = d; }             // keep the closest so far
        }
        return best;
    };
    dScatterG.on("mousemove", function (ev) {
        const [mx,my] = d3.pointer(ev, this);
        const d = pick(mx,my, scTransform);
        if (d) hoverPanel.html(hoverHTML(d)).style("opacity",1)
            .style("left", Math.min(mx+14, W-190)+"px").style("top", Math.max(my-10, 6)+"px");
        else hoverPanel.style("opacity",0);
    }).on("mouseleave", () => hoverPanel.style("opacity",0));

    dScatterG.on("click", function (ev) {
        const [mx,my] = d3.pointer(ev, this);
        const d = pick(mx,my, scTransform);
        if (d) toggleSelect(d.__index);
    });
}

// Builds the HTML for Plot 1's hover panel: the alloy name, its top-3 scrap
// sources, and its eutectic/solidification read-out. `line()` formats one
// "label: value" row; `scraps` lists the three largest scrap shares.
function hoverHTML(d) {
    const lbl = alloyLabel(d);
    const line = (k,v) => `<div class="hpRow"><span>${shortLabel(k)}</span><b>${fmt(v)}</b></div>`;
    // take each scrap's value, keep the non-null ones, sort high→low, keep top 3
    const scraps = cols.inputs.map(c => [shortLabel(c), d[c]]).filter(x=>x[1]!=null)
        .sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>`${x[0]} ${fmt(x[1])}%`).join(" · ");
    let html = `<div class="hpTitle">${lbl}</div>`;
    html += `<div class="hpScraps">${scraps}</div><div class="hpDiv"></div>`;
    // eutectic + solidification set requested for the general readout
    const general = [
        ["eut. frac.[%]"], ["eut. T (°C)"], ["T(liqu)"], ["T(sol)"], ["delta_T"],
        ["delta_T_FCC"], ["delta_T_Al15Si2M4"], ["delta_T_Si"]
    ];
    general.forEach(cands => { const c = findCol(cands); if (c) html += line(c, d[c]); });
    return html;
}

// ===========================================================================
//  8b. PLOT 2 — COMPOSITION RIBBON (part-to-whole band per selected alloy)
// ===========================================================================
// Which columns make up "composition" depends on the toggle: scrap sources,
// atomic elements, or microstructure phases.
function compFields() {
    if (compMode === "elements") return cols.elements;   // 12 atomic elements
    if (compMode === "phases")   return cols.micro;       // 15 phase volume fractions
    return cols.inputs;                                   // default: 6 scrap sources
}
// Draws Plot 2: one horizontal 100%-wide band per pinned alloy, split into
// coloured segments for the active composition mode (scraps / elements / phases).
function renderRibbon() {
    const { W, H } = panelSize();
    const m = { t: 20, r: 12, b: 20, l: 96 };             // margins (l leaves room for row labels)
    const rows = selectedRows();                          // the currently pinned alloys
    const fields = compFields();                          // component columns for the active mode

    // If nothing is pinned, show a hint and stop (nothing to draw).
    dRibbon.selectAll(".ribHint").remove();
    if (!rows.length) {
        dRibbon.selectAll("g.ribRow").remove();
        dRibbon.append("text").attr("class","ribHint")
            .attr("x",W/2).attr("y",H/2).attr("text-anchor","middle")
            .attr("fill","#9aa8b2").style("font-size","12px")
            .text("Pin alloys in Plot 1 to see their composition");
        return;
    }

    // Colour each component consistently. interpolateTurbo spreads distinct hues
    // across [0,1]; (i+0.5)/n centres each field in its own slice of the range.
    const color = d3.scaleOrdinal().domain(fields)
        .range(fields.map((_,i)=> d3.interpolateTurbo((i+0.5)/fields.length)));

    // yRow places one horizontal band per pinned alloy; xScale maps 0–100% to px.
    const yRow = d3.scaleBand().domain(rows.map(d=>d.__index)).range([m.t, H-m.b]).paddingInner(0.35);
    const xScale = d3.scaleLinear().domain([0,100]).range([m.l, W-m.r]);

    // --- D3 data-join: one <g> group per pinned alloy, keyed by __index ---
    // The key function (d=>d.__index) lets D3 match existing groups to the same
    // alloy across re-renders, so only added/removed alloys change in the DOM.
    const rowG = dRibbon.selectAll("g.ribRow").data(rows, d=>d.__index);
    rowG.exit().remove();                                       // drop groups for unpinned alloys
    const rowEnter = rowG.enter().append("g").attr("class","ribRow");   // create for newly pinned
    rowEnter.append("text").attr("class","ribLabel");
    // merge() = "for both new and existing groups, do the following":
    const rowAll = rowEnter.merge(rowG).attr("transform", d => `translate(0,${yRow(d.__index)})`);
    rowAll.select(".ribLabel")                                  // the alloy name at the left
        .attr("x", m.l-8).attr("y", yRow.bandwidth()/2).attr("dy","0.32em").attr("text-anchor","end")
        .attr("fill", d => selColor(d.__index))                // label in the alloy's own colour
        .style("font-family","'IBM Plex Mono',monospace").style("font-size","10px").style("font-weight","600")
        .text(d => alloyLabel(d));

    // For each selected alloy, turn its raw component values into cumulative
    // 0–100% segment boundaries (x0→x1), so every band fills the full width
    // regardless of the raw totals — a true part-to-whole comparison.
    rowAll.each(function (d) {                                  // `d` = this alloy's row object
        const g = d3.select(this);
        // read each component value, clamping negatives (or nulls) to 0
        const vals = fields.map(f => ({ f, v: Math.max(0, d[f]||0) }));
        const total = d3.sum(vals, x=>x.v) || 1;               // sum of components (|| 1 avoids /0)
        // Walk the components left→right, accumulating percentage so each
        // segment starts where the previous ended (x0 = running total).
        let acc = 0;
        const segs = vals.map(x => {
                const s = { f:x.f, x0:acc, x1:acc + 100*x.v/total };  // this segment's [start,end] %
                acc = s.x1;                                          // advance the cursor
                return s;
            })
            .filter(s => s.x1 - s.x0 > 0.01);                  // drop invisible slivers (<0.01%)

        // Data-join the segments within this alloy's group, keyed by field name.
        const seg = g.selectAll("rect.ribSeg").data(segs, s=>s.f);
        seg.exit().transition().duration(DUR).attr("width",0).remove();   // shrink-out removed
        seg.enter().append("rect").attr("class","ribSeg")                 // create new segments
                .attr("y",0).attr("height", yRow.bandwidth()).attr("rx",2)
                .attr("x", s=>xScale(s.x0)).attr("width",0).attr("fill", s=>color(s.f))
                .on("mousemove", (e,s)=>ribTip(e, d, s)).on("mouseout", ribTipOut)
            .merge(seg).attr("fill", s=>color(s.f))                       // update new+existing
                .transition().duration(DUR)                              // animate to new size
                .attr("x", s=>xScale(s.x0))
                .attr("width", s=>Math.max(0,xScale(s.x1)-xScale(s.x0)))
                .attr("height", yRow.bandwidth());
    });

    // panel caption reflecting the active mode
    dRibbon.selectAll(".ribTitle").data([0]).join("text").attr("class","ribTitle")
        .attr("x",m.l).attr("y",12).attr("fill","#5b6b78")
        .style("font-size","10px").style("font-weight","600").text("Share by " + compMode);
}
// Show/hide the tooltip for a hovered ribbon segment (component name + value).
function ribTip(event, d, s) {
    tip("ribTip").style("opacity",1).html(`${shortLabel(s.f)}<br><b>${fmt(d[s.f])}</b>`)
        .style("left",(event.pageX+12)+"px").style("top",(event.pageY-10)+"px");
}
function ribTipOut(){ tip("ribTip").style("opacity",0); }

// ===========================================================================
//  8c. PLOT 3 — MECHANICAL RADAR (3 mechanical properties per alloy)
// ===========================================================================
// Draws a 3-axis radar (yield strength, hardness, CSC). Each axis is normalised
// to the dataset's range, and each pinned alloy becomes one coloured polygon.
function renderRadar() {
    const { W, H } = panelSize();
    const R = Math.min(W, H)/2 - 54;        // radar radius (leave room for labels)
    const metrics = cols.mech;              // the 3 mechanical properties = the 3 axes
    const n = metrics.length;
    if (n < 3) return;                       // nothing sensible to draw with < 3 axes

    // one scale per axis: maps that property's [min,max] to a radius 0..R
    const norm = {};
    metrics.forEach(mt => norm[mt] = d3.scaleLinear().domain(ranges[mt]).range([0,R]));
    // angle of axis i, starting at the top (−90°) and going clockwise
    const ang = i => (Math.PI*2/n)*i - Math.PI/2;

    dRadar.selectAll(".rGrid").data([0.25,0.5,0.75,1]).join("circle")
        .attr("class","rGrid").attr("r",d=>d*R).attr("fill","none")
        .attr("stroke","#e0e6eb").attr("stroke-dasharray","3 3");
    const axisG = dRadar.selectAll(".rAxis").data(metrics).join("g").attr("class","rAxis");
    axisG.selectAll("line").data(d=>[d]).join("line")
        .attr("x1",0).attr("y1",0)
        .attr("x2",d=>R*Math.cos(ang(metrics.indexOf(d))))
        .attr("y2",d=>R*Math.sin(ang(metrics.indexOf(d)))).attr("stroke","#c8d2da");
    axisG.selectAll("text").data(d=>[d]).join("text")
        .attr("x",d=>(R+22)*Math.cos(ang(metrics.indexOf(d))))
        .attr("y",d=>(R+22)*Math.sin(ang(metrics.indexOf(d))))
        .attr("text-anchor","middle").attr("dy","0.35em")
        .attr("fill","#33414d").style("font-size","10px").text(d=>shortLabel(d));

    const rows = selectedRows();            // one polygon per pinned alloy
    // radial line generator: turns a list of {r} into a closed radar polygon
    const lineGen = d3.lineRadial().curve(d3.curveLinearClosed)
        .angle((d,i)=>(Math.PI*2/n)*i).radius(d=>d.r);
    // for each pinned alloy build its polygon: one radius per metric (NaN → 0)
    const shapes = rows.map(d => ({
        __index:d.__index, color:selColor(d.__index), row:d,
        pts: metrics.map(mt => ({ r:(d[mt]==null||isNaN(d[mt]))?0:norm[mt](d[mt]) }))
    }));

    // tooltip showing all three mechanical values for the hovered alloy
    const showRadarTip = (event, s) => {
        const rowsHtml = metrics.map(mt =>
            `<div class="hpRow"><span>${shortLabel(mt)}</span><b>${fmt(s.row[mt])}</b></div>`).join("");
        tip("radarTip").style("opacity",1)
            .html(`<div class="hpTitle" style="color:${s.color}">${alloyLabel(s.row)}</div>${rowsHtml}`)
            .style("left",(event.pageX+14)+"px").style("top",(event.pageY-10)+"px");
    };
    const hideRadarTip = () => tip("radarTip").style("opacity",0);

    // draw/update one polygon path per alloy (data-joined by __index)
    const polys = dRadar.selectAll("path.rPoly").data(shapes, d=>d.__index);
    polys.exit().transition().duration(DUR).attr("opacity",0).remove();   // removed alloys fade out
    polys.enter().append("path").attr("class","rPoly")
            .attr("fill","none").attr("stroke-width",2).attr("opacity",0)
            .attr("stroke",d=>d.color).attr("d",d=>lineGen(d.pts))
        .merge(polys).attr("stroke",d=>d.color)
            .style("cursor","pointer")
            .on("mousemove", showRadarTip).on("mouseout", hideRadarTip)
            .on("click", (e,d)=>toggleSelect(d.__index))
            .transition().duration(DUR).attr("d",d=>lineGen(d.pts)).attr("opacity",0.9);

    // Flatten every polygon vertex into a flat list of dots. Dots are bigger,
    // easier hover/click targets than the thin polygon outline. Each vertex's
    // (x,y) is its polar position (radius r at the axis angle) in Cartesian.
    const vtx = [];
    shapes.forEach(s => s.pts.forEach((p,i) => vtx.push({
        key: s.__index+"|"+i, color:s.color, row:s.row, shape:s,
        x: p.r*Math.cos(ang(i)), y: p.r*Math.sin(ang(i))
    })));
    const dots = dRadar.selectAll("circle.rVtx").data(vtx, d=>d.key);
    dots.exit().transition().duration(DUR).attr("r",0).remove();
    dots.enter().append("circle").attr("class","rVtx")
            .attr("cx",d=>d.x).attr("cy",d=>d.y).attr("r",0)
            .attr("fill",d=>d.color).style("cursor","pointer")
            .on("mousemove",(e,d)=>showRadarTip(e,d.shape)).on("mouseout",hideRadarTip)
            .on("click",(e,d)=>toggleSelect(d.row.__index))
        .merge(dots).attr("fill",d=>d.color)
            .transition().duration(DUR).attr("cx",d=>d.x).attr("cy",d=>d.y).attr("r",3.5);

    dRadar.selectAll(".rHint").data(rows.length?[]:[0]).join("text")
        .attr("class","rHint").attr("text-anchor","middle").attr("fill","#9aa8b2")
        .style("font-size","11px").text("Pin alloys to compare");
}

// ===========================================================================
//  8d. PLOT 4 — THERMOPHYSICAL STRIPS (11 properties, one track each)
// ===========================================================================
// Draws one horizontal track per thermophysical property. Each pinned alloy is
// a dot placed along the track at its position within that property's full range.
function renderStrips() {
    const { W } = panelSize();
    const params = cols.thermo;                          // the 11 thermophysical properties
    if (!params.length) return;
    const H = Math.max(320, 26 * params.length + 30);    // taller SVG: ~26px per track
    const m = { t: 14, r: 20, b: 10, l: 14 };

    const yBand = d3.scaleBand().domain(params).range([m.t, H-m.b]).padding(0.30);  // vertical slot per property
    const xFull = m.l, xEnd = W - m.r;                   // track spans this x-range
    const trackY = bw => bw - 5;                         // bar sits near the bottom of each band
    // one x-scale per property, mapping that property's [min,max] to the track width
    const sx = {};
    params.forEach(p => sx[p] = d3.scaleLinear().domain(ranges[p]).range([xFull, xEnd]));

    const track = dStrips.selectAll("g.strip").data(params, d=>d);
    track.exit().remove();
    const tEnter = track.enter().append("g").attr("class","strip");
    tEnter.append("text").attr("class","stripLabel");
    tEnter.append("rect").attr("class","stripBg");
    const tAll = tEnter.merge(track).attr("transform", d=>`translate(0,${yBand(d)})`);
    // label ABOVE the track, left-aligned, full name
    tAll.select(".stripLabel")
        .attr("x", xFull).attr("y", 2).attr("dy","0.7em").attr("text-anchor","start")
        .attr("fill","#33414d").style("font-size","9.5px")
        .text(d=>shortLabel(d));
    tAll.select(".stripBg")
        .attr("x", xFull).attr("y", d=>trackY(yBand.bandwidth())).attr("height", 4).attr("rx",2)
        .attr("fill","#e4e9ee").attr("width", xEnd - xFull);

    const rows = selectedRows();
    const dotData = [];
    params.forEach(p => rows.forEach(d => {
        if (d[p]!=null && !isNaN(d[p])) dotData.push({ key:d.__index+"|"+p, p, idx:d.__index, v:d[p] });
    }));

    const dots = dStrips.selectAll("circle.stripDot").data(dotData, d=>d.key);
    dots.exit().transition().duration(DUR).attr("r",0).remove();
    dots.enter().append("circle").attr("class","stripDot")
            .attr("cy", d=>yBand(d.p)+trackY(yBand.bandwidth())+2).attr("cx", d=>sx[d.p](d.v)).attr("r",0)
            .attr("fill", d=>selColor(d.idx)).attr("opacity",0.9)
            .on("mousemove",(e,d)=>stripTip(e,d)).on("mouseout",stripTipOut)
        .merge(dots).attr("fill", d=>selColor(d.idx))
            .transition().duration(DUR)
            .attr("cy", d=>yBand(d.p)+trackY(yBand.bandwidth())+2).attr("cx", d=>sx[d.p](d.v)).attr("r", 5);

    dStrips.selectAll(".stripHint").data(rows.length?[]:[0]).join("text")
        .attr("class","stripHint").attr("x",(xFull+xEnd)/2).attr("y",H/2)
        .attr("text-anchor","middle").attr("fill","#9aa8b2")
        .style("font-size","11px").text("Pin alloys to place them on each property range");
}
// Show/hide the tooltip for a hovered strip dot (property name + exact value).
function stripTip(event, d) {
    tip("stripTip").style("opacity",1).html(`${shortLabel(d.p)}<br><b>${fmt(d.v)}</b>`)
        .style("left",(event.pageX+12)+"px").style("top",(event.pageY-10)+"px");
}
function stripTipOut(){ tip("stripTip").style("opacity",0); }

// ===========================================================================
//  8a-bis. SELECTED-ALLOY CHIPS (under Plot 1): name + colour + deselect
// ===========================================================================
// Renders one chip per pinned alloy under Plot 1: a colour dot, the alloy name,
// and a × button to unpin it. Shows a hint line when nothing is pinned.
function renderChips() {
    const host = d3.select("#selChips");
    if (host.empty()) return;                         // panel not built yet
    const rows = selectedRows();
    // section title only appears when there is at least one pinned alloy
    host.selectAll(".chipsTitle").data(rows.length?[0]:[]).join("div")
        .attr("class","chipsTitle").text("Selected alloys");
    if (!rows.length) {                               // nothing pinned → show hint, stop
        host.selectAll(".chip").remove();
        host.selectAll(".chipsEmpty").data([0]).join("div")
            .attr("class","chipsEmpty").text("Click points in the scatter to pin alloys");
        return;
    }
    host.selectAll(".chipsEmpty").remove();           // remove the hint once we have pins
    // data-join one chip per pinned alloy, keyed by row index
    const chips = host.selectAll(".chip").data(rows, d=>d.__index);
    chips.exit().remove();                            // drop chips for unpinned alloys
    const en = chips.enter().append("div").attr("class","chip");   // build new chips
    en.append("span").attr("class","chipDot");        // colour swatch
    en.append("span").attr("class","chipName");       // alloy name
    en.append("button").attr("class","chipX").html("&times;")      // × deselect button
        .on("click", (e,d)=> toggleSelect(d.__index));
    const all = en.merge(chips);                       // update new + existing chips
    all.select(".chipDot").style("background", d=>selColor(d.__index));
    all.select(".chipName").text(d=>alloyLabel(d));
}

// ===========================================================================
//  8e. PLOT 5 — CORRELATION EXPLORER (chosen input vs property, with r)
// ===========================================================================
// Scatter of the chosen input (corrX) vs the chosen property (corrY), with a
// least-squares trend line and the Pearson r shown as a badge.
function renderCorr() {
    if (!dCorr || !corrX || !corrY) return;
    const { W, H } = panelSize();
    const m = { t: 34, r: 16, b: 40, l: 56 };            // top margin leaves room for the r badge

    // keep only rows with valid numbers on both chosen columns, then compute r
    const pts = dashRows.filter(d =>
        d[corrX]!=null && !isNaN(d[corrX]) && d[corrY]!=null && !isNaN(d[corrY]));
    const r = pearson(pts, corrX, corrY);

    const x = d3.scaleLinear().domain(ranges[corrX]).nice().range([m.l, W-m.r]);
    const y = d3.scaleLinear().domain(ranges[corrY]).nice().range([H-m.b, m.t]);

    dCorr.selectAll("*").remove();                       // redraw from scratch each time
    dCorr.append("g").attr("class","scAxis").attr("transform",`translate(0,${H-m.b})`)
        .call(d3.axisBottom(x).ticks(6));
    dCorr.append("g").attr("class","scAxis").attr("transform",`translate(${m.l},0)`)
        .call(d3.axisLeft(y).ticks(6));
    dCorr.append("text").attr("class","scAxisTitle")
        .attr("x",(m.l+W-m.r)/2).attr("y",H-4).attr("text-anchor","middle").text(shortLabel(corrX));
    dCorr.append("text").attr("class","scAxisTitle")
        .attr("transform",`translate(14,${(m.t+H-m.b)/2}) rotate(-90)`)
        .attr("text-anchor","middle").text(shortLabel(corrY));

    // sample points for speed; draw as small dots
    const sample = sampleArray(pts, 3000);
    dCorr.selectAll("circle.corrDot").data(sample, d=>d.__index).join(
        enter => enter.append("circle").attr("class","corrDot")
            .attr("cx",d=>x(d[corrX])).attr("cy",d=>y(d[corrY])).attr("r",2)
            .attr("fill", d=> selected.has(d.__index) ? selColor(d.__index) : "#8fb2c4")
            .attr("opacity", d=> selected.has(d.__index) ? 0.95 : 0.35),
        update => update.attr("cx",d=>x(d[corrX])).attr("cy",d=>y(d[corrY]))
            .attr("fill", d=> selected.has(d.__index) ? selColor(d.__index) : "#8fb2c4")
            .attr("r", d=> selected.has(d.__index) ? 5 : 2)
            .attr("opacity", d=> selected.has(d.__index) ? 0.95 : 0.35)
    );

    // Least-squares regression line y = slope·x + intercept.
    // slope = Σ(x-x̄)(y-ȳ) / Σ(x-x̄)²  ; intercept keeps the line through (x̄, ȳ).
    if (pts.length > 2 && !isNaN(r)) {
        const mx=d3.mean(pts,d=>d[corrX]), my=d3.mean(pts,d=>d[corrY]);   // means
        let sxy=0,sxx=0; pts.forEach(d=>{ sxy+=(d[corrX]-mx)*(d[corrY]-my); sxx+=(d[corrX]-mx)**2; });
        const slope = sxx? sxy/sxx : 0, intc = my - slope*mx;
        const xr = x.domain();                                           // draw across the x-range
        dCorr.append("line").attr("class","corrTrend")
            .attr("x1",x(xr[0])).attr("y1",y(slope*xr[0]+intc))
            .attr("x2",x(xr[1])).attr("y2",y(slope*xr[1]+intc))
            .attr("stroke","#e08a1e").attr("stroke-width",2).attr("stroke-dasharray","5 3");
    }

    // r-value badge: classify strength by |r| and note the direction (±).
    const strength = Math.abs(r) > 0.6 ? "strong" : Math.abs(r) > 0.3 ? "moderate" : "weak";
    const g = dCorr.append("g").attr("class","corrBadge").attr("transform",`translate(${m.l},18)`);
    g.append("text").attr("class","corrR")
        .attr("fill", "#0a6c76").style("font-weight","700").style("font-size","15px")
        .text("r = " + (isNaN(r) ? "—" : r.toFixed(3)));
    g.append("text").attr("x",92).attr("dy","0.05em")
        .attr("fill","#7a8893").style("font-size","10.5px")
        .text("(" + strength + (r<0?", negative":r>0?", positive":"") + ")");
}

// ===========================================================================
//  8f. PLOT 6 — MULTI-ALLOY COMPARISON (selected alloys × chosen properties)
//  Grouped bars. Each property is normalised 0–1 across the whole dataset so
//  properties on very different scales (e.g. MPa vs g/cm³) compare fairly.
// ===========================================================================
function renderCompare() {
    if (!dCompare) return;
    const { W, H } = panelSize();
    const m = { t: 16, r: 12, b: 70, l: 40 };
    const rows = selectedRows();                                   // one bar-group member per pinned alloy
    const props = compareProps.filter(p => cols.targets.includes(p));  // only valid, enabled properties

    // Nothing to draw unless we have both alloys AND properties — show a hint.
    dCompare.selectAll(".cmpHint").remove();
    if (!rows.length || !props.length) {
        dCompare.selectAll("g.cmpProp").remove();
        dCompare.append("text").attr("class","cmpHint")
            .attr("x",W/2).attr("y",H/2).attr("text-anchor","middle")
            .attr("fill","#9aa8b2").style("font-size","12px")
            .text(!rows.length ? "Pin alloys in Plot 1 to compare them"
                               : "Enable at least one property above");
        return;
    }

    // Build a 0–1 normaliser per property (min→0, max→1 across the whole
    // dataset) so bars for properties on wildly different scales are comparable.
    // If a property is constant (max===min) we place it at 0.5 to avoid /0.
    const nrm = {};
    props.forEach(p => { const e=ranges[p]; nrm[p]=v=>(e[1]===e[0])?0.5:(v-e[0])/(e[1]-e[0]); });

    // grouped-bar scales: x0 positions each PROPERTY group; x1 positions each
    // ALLOY's bar within a group; y maps the normalised 0..1 value to height.
    const x0 = d3.scaleBand().domain(props).range([m.l, W-m.r]).paddingInner(0.25);
    const x1 = d3.scaleBand().domain(rows.map(d=>d.__index)).range([0,x0.bandwidth()]).padding(0.08);
    const y = d3.scaleLinear().domain([0,1]).range([H-m.b, m.t]);

    // y axis (normalized 0..1)
    dCompare.selectAll("g.cmpY").data([0]).join("g").attr("class","cmpY scAxis")
        .attr("transform",`translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(".0%")));

    // groups per property
    const groups = dCompare.selectAll("g.cmpProp").data(props, d=>d);
    groups.exit().remove();
    const gEnter = groups.enter().append("g").attr("class","cmpProp");
    gEnter.append("text").attr("class","cmpLabel");
    const gAll = gEnter.merge(groups).attr("transform", d=>`translate(${x0(d)},0)`);
    gAll.select(".cmpLabel")
        .attr("transform",`translate(${x0.bandwidth()/2},${H-m.b+12}) rotate(35)`)
        .attr("text-anchor","start").attr("fill","#33414d").style("font-size","9px")
        .text(d=>shortLabel(d));

    // For each property group, draw one bar per pinned alloy (a NESTED join:
    // outer join = property groups above, inner join here = alloy bars within).
    gAll.each(function(p){                                     // `p` = this group's property name
        const g = d3.select(this);
        const bars = g.selectAll("rect.cmpBar").data(rows, d=>d.__index);   // one bar per alloy
        // removed alloys: animate their bar down to zero height, then delete
        bars.exit().transition().duration(DUR).attr("height",0).attr("y",y(0)).remove();
        bars.enter().append("rect").attr("class","cmpBar")    // new alloy → new bar, starts flat
                .attr("x", d=>x1(d.__index)).attr("width", x1.bandwidth())
                .attr("y", y(0)).attr("height",0).attr("rx",2)
                .attr("fill", d=>selColor(d.__index))
                .on("mousemove",(e,d)=>cmpTip(e,d,p)).on("mouseout",()=>tip("cmpTip").style("opacity",0))
            .merge(bars)                                       // new + existing bars:
                .attr("x", d=>x1(d.__index)).attr("width", x1.bandwidth())
                .attr("fill", d=>selColor(d.__index))
                .transition().duration(DUR)                   // animate to the normalised height
                // y = top of the bar; if the value is missing, keep it flat at the baseline
                .attr("y", d=>{ const v=d[p]; return (v==null||isNaN(v))?y(0):y(nrm[p](v)); })
                // height = distance from baseline y(0) up to the value's y position
                .attr("height", d=>{ const v=d[p]; return (v==null||isNaN(v))?0:(y(0)-y(nrm[p](v))); });
    });
}
// Tooltip for a hovered comparison bar: alloy name, property, and exact value.
function cmpTip(event, d, p) {
    tip("cmpTip").style("opacity",1)
        .html(`${alloyLabel(d)}<br>${shortLabel(p)}<br><b>${fmt(d[p])}</b>`)
        .style("left",(event.pageX+12)+"px").style("top",(event.pageY-10)+"px");
}

// ---------------------------------------------------------------------------
//  9. UTILITIES — labels, number formatting, statistics, tooltips
// ---------------------------------------------------------------------------
// Returns a shared tooltip <div> of the given class, creating it once on first
// use. All hover tooltips reuse the same styled element per class name.
function tip(cls) {
    let t = d3.select("body").select("."+cls);
    if (t.empty())                                // create it the first time only
        t = d3.select("body").append("div").attr("class",cls)
            .style("position","absolute").style("pointer-events","none")
            .style("background","#1b232b").style("color","#fff")
            .style("padding","5px 8px").style("border-radius","6px")
            .style("font","11px 'IBM Plex Mono',monospace").style("opacity",0).style("z-index",1000);
    return t;
}

// A readable name for an alloy row. Uses the dataset's label column if it holds
// a real (non-NaN) value; otherwise falls back to "Alloy #<row index>".
function alloyLabel(d) {
    if (labelAttribute) {
        const v = d[labelAttribute];
        // accept the label only if it's present and not a NaN / "nan" placeholder
        if (v != null && !(typeof v === "number" && isNaN(v)) && String(v).toLowerCase() !== "nan")
            return v;
    }
    return "Alloy #" + d.__index;
}

// Finds the real column name matching any of the candidate names, ignoring
// spacing and case (e.g. "T(liqu)" vs "t (liqu)"). Returns null if none match.
function findCol(cands) {
    const norm = s => String(s).replace(/\s+/g,"").toLowerCase();
    for (const w of cands) { const hit = dashData.columns.find(c=>norm(c)===norm(w)); if (hit) return hit; }
    return null;
}

// Maps a raw column name to a full, human-readable label (no abbreviations).
// Matching ignores spaces, case, and degree-symbol encoding quirks. Falls back
// to generated names for elements and Vf_ phases, or the raw name if unknown.
function shortLabel(s) {
    s = String(s);
    // normalise the lookup key: drop spaces, degree symbols/encoding artefacts, lowercase
    const norm = v => String(v).replace(/\s+/g, "").replace(/[°º�]|â°|Â°/g, "").toLowerCase();
    // full, human-readable names (no abbreviations), matched space/case-tolerantly
    const map = {
        // scrap inputs
        "ks1295[%]":"KS1295 piston alloy (%)",
        "6082[%]":"6082 alloy (%)",
        "2024[%]":"2024 alloy (%)",
        "bat-box[%]":"Battery-box alloy (%)",
        "batterybox[%]":"Battery-box alloy (%)",
        "3003[%]":"3003 alloy (%)",
        "4032[%]":"4032 alloy (%)",
        "4043[%]":"4043 alloy (%)",
        // mechanical
        "csc":"Hot-crack susceptibility",
        "ys(mpa)":"Yield strength (MPa)",
        "hardness(vickers)":"Hardness (Vickers)",
        // thermophysical
        "density(g/cm3)":"Density (g/cm³)",
        "density(g/cm³)":"Density (g/cm³)",
        "volume(m3/mol)":"Molar volume (m³/mol)",
        "el.conductivity(s/m)":"Electrical conductivity (S/m)",
        "el.resistivity(ohmm)":"Electrical resistivity (Ω·m)",
        "heatcapacity(j/(molk))":"Heat capacity (J/mol·K)",
        "therm.conductivity(w/(mk))":"Thermal conductivity (W/m·K)",
        "therm.diffusivity(m2/s)":"Thermal diffusivity (m²/s)",
        "therm.resistivity(mk/w)":"Thermal resistivity (m·K/W)",
        "ctevol(1/k)(20.0-300.0c)":"Volumetric thermal expansion (1/K)",
        "linearthermalexpansion(1/k)(20.0-300.0c)":"Linear thermal expansion (1/K)",
        "technicalthermalexpansion(1/k)(20.0-300.0c)":"Technical thermal expansion (1/K)",
        // solidification / eutectic (for the hover readout)
        "t(liqu)":"Liquidus temperature (°C)",
        "t(sol)":"Solidus temperature (°C)",
        "delta_t":"Solidification interval (°C)",
        "delta_t_fcc":"Solidification interval – α-Al matrix (°C)",
        "delta_t_al15si2m4":"Solidification interval – Al₁₅(Fe,Mn)₃Si₂ (°C)",
        "delta_t_si":"Solidification interval – Si phase (°C)",
        "eut.frac.[%]":"Eutectic fraction (%)",
        "eut.t(c)":"Eutectic formation temperature (°C)"
    };
    if (map[norm(s)]) return map[norm(s)];       // known column → mapped name

    // atomic elements → full element names
    const elements = {
        "Al":"Aluminium (Al)","Si":"Silicon (Si)","Cu":"Copper (Cu)","Ni":"Nickel (Ni)",
        "Mg":"Magnesium (Mg)","Mn":"Manganese (Mn)","Fe":"Iron (Fe)","Cr":"Chromium (Cr)",
        "Ti":"Titanium (Ti)","Zr":"Zirconium (Zr)","V":"Vanadium (V)","Zn":"Zinc (Zn)"
    };
    if (elements[s]) return elements[s];

    // microstructure phases: turn "Vf_XXX" into "XXX phase (vol %)"
    if (/^Vf_/i.test(s)) {
        const phase = s.replace(/^Vf_/i, "").replace(/_/g, " ");
        return phase + " phase (vol %)";
    }

    return s;                                     // unknown column → show as-is
}

// Formats a number for display. Returns "—" for missing values, scientific
// notation for very small/large magnitudes, else rounds to 3 decimal places.
function fmt(v) {
    if (v==null||isNaN(v)) return "—";
    const a=Math.abs(v);
    if (a!==0 && (a<1e-3 || a>=1e5)) return v.toExponential(2);   // tiny or huge → 1.23e-4
    return (Math.round(v*1000)/1000).toString();                 // otherwise 3 dp
}

// Pearson correlation coefficient r between columns `a` and `b` over `rows`.
// Skips rows missing either value; returns NaN if fewer than 3 valid pairs.
// r ∈ [-1, 1]: +1 perfectly increasing, -1 perfectly decreasing, 0 no linear link.
function pearson(rows, a, b) {
    const xs=[], ys=[];
    for (const r of rows) {                       // collect the valid (x,y) pairs
        const x=r[a], y=r[b];
        if (x==null||y==null||isNaN(x)||isNaN(y)) continue;
        xs.push(x); ys.push(y);
    }
    const n=xs.length; if (n<3) return NaN;       // too few points to be meaningful
    const mx=d3.mean(xs), my=d3.mean(ys);         // means of x and y
    let num=0,dx=0,dy=0;                          // covariance and the two variances
    for (let i=0;i<n;i++){ const p=xs[i]-mx, q=ys[i]-my; num+=p*q; dx+=p*p; dy+=q*q; }
    const den=Math.sqrt(dx*dy);                   // product of standard deviations
    return den? num/den : NaN;                    // r = covariance / (sd_x · sd_y)
}

// Evenly down-samples an array to at most `k` items by taking every (n/k)-th
// element. Used to cap how many points a plot draws so large data stays smooth.
function sampleArray(arr, k) {
    if (arr.length<=k) return arr;                // already small enough → keep all
    const step=arr.length/k, out=[];             // fractional stride
    for (let i=0;i<arr.length;i+=step) out.push(arr[Math.floor(i)]);
    return out;
}

// Clears every plot's drawing area (canvas + all SVG groups). Called by the
// framework when a new dataset is loaded so nothing stale remains on screen.
function clearDashboard() {
    if (scCtx) { const {W,H}=panelSize(); scCtx.clearRect(0,0,W,H); }   // wipe the canvas
    [dScatterG, dRibbon, dRadar, dStrips, dCorr, dCompare].forEach(g => g && g.selectAll("*").remove());
}
