/*
* Data Visualization - Framework
* Copyright (C) University of Passau
*   Faculty of Computer Science and Mathematics
*   Chair of Cognitive sensor systems
* Maintenance:
*   2025, Alexander Gall <alexander.gall@uni-passau.de>
*
* All rights reserved.
*/

// scatterplot axes
let xAxis, yAxis, xAxisLabel, yAxisLabel;
// radar chart axes
let radarAxes, radarAxesAngle;

let dimensions = ["dimension 1", "dimension 2", "dimension 3", "dimension 4", "dimension 5", "dimension 6"];
let loadedData = [];
// --- start implemented selection state section ---
let selected = new Set();
let labelAttribute = null;
let maxSelected = 7;
let availableColors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
let selectionColors = new Map();
// --- end implemented selection state section ---
//*HINT: the first dimension is often a label; you can simply remove the first dimension with
// dimensions.splice(0, 1);

// the visual channels we can use for the scatterplot
let channels = ["scatterX", "scatterY", "size"];

// size of the plots
let margin, width, height, radius;
// svg containers
let scatter, radar, dataTable;

// Add additional variables


function init() {
    // define size of plots
    margin = {top: 20, right: 20, bottom: 20, left: 50};
    width = 600;
    height = 500;
    radius = width / 2;

    // Start at default tab
    document.getElementById("defaultOpen").click();

	// data table
	dataTable = d3.select('#dataTable');

    // (Basic Visualization scatter/radar containers removed — the delivered
    //  interface is the Part-2 dashboard, built in dashboard.js.)

    // read and parse input file
    let fileInput = document.getElementById("upload"), readFile = function () {

        // clear existing visualizations
        clear();
        selected.clear();

        let reader = new FileReader();
        reader.onloadend = function () {
            // ================================================================
            //  CSV/TSV LOADING  (memory-critical: the file can be ~190 MB)
            // ================================================================
            // NOTE: never console.log(reader.result) here — printing a 190 MB
            // string can crash the tab on its own. We also null the string out
            // the instant we are done with it so the garbage collector can
            // reclaim that memory before we build the (also large) row objects.

            // (1) Auto-detect the delimiter from the FIRST line only. We pass a
            //     limit of 1 to split() so we don't split the entire 190 MB
            //     string just to look at the header.
            let text = reader.result;
            let firstLine = text.split(/\r?\n/, 1)[0];
            let delim = firstLine.includes("\t") ? "\t"        // tab-separated
                      : firstLine.includes(";")  ? ";"          // semicolon
                      : ",";                                     // default: comma

            // (2) Parse the whole text into an array of row objects. d3.autoType
            //     converts numeric strings to real numbers and "" / "nan" to
            //     null. This is the single most memory-heavy step.
            let parsedData = d3.dsvFormat(delim).parse(text, d3.autoType);
            text = null; reader.result = null;                  // free the raw string ASAP

            // (3) DOWN-SAMPLE FOR VERY LARGE FILES.
            //     324k rows × 70 columns is ~22 million values; keeping every
            //     row in memory AND driving six live views from it can exhaust
            //     the browser tab and crash it. If the file is bigger than
            //     MAX_ROWS, we keep an EVENLY-SPACED subset (every step-th row)
            //     so the sample still spans the whole design space, then let the
            //     rest be garbage-collected. Smaller files are used whole.
            const MAX_ROWS = 80000;                             // safe working size
            let usedData = parsedData;
            let sampledFrom = 0;                                // 0 = not sampled
            if (parsedData.length > MAX_ROWS) {
                sampledFrom = parsedData.length;
                const step = parsedData.length / MAX_ROWS;      // fractional stride
                const subset = [];
                for (let i = 0; i < parsedData.length; i += step) {
                    subset.push(parsedData[Math.floor(i)]);     // take every step-th row
                }
                subset.columns = parsedData.columns;            // preserve the header list
                usedData = subset;
                parsedData = null;                              // release the full array
            }

            // (4) Book-keeping shared by all views.
            loadedData = usedData;
            loadedData.forEach(function (d, i) { d.__index = i; });   // stable per-row id
            selected.clear();
            selectionColors.clear();

            // (5) Pick a label column = the first column whose FIRST value is not
            //     a number (checks one row, not all rows).
            let first = usedData[0] || {};
            labelAttribute = usedData.columns.find(function (col) {
                return typeof first[col] !== 'number';
            }) || usedData.columns[0];

            // (6) Build the small preview table and the dashboard. If we sampled,
            //     tell the user clearly how many rows are in play.
            CreateDataTable(usedData);
            if (sampledFrom > 0) {
                showSampleNotice(sampledFrom, usedData.length);
            }
            initDashboard(usedData);
            // --- end implemented CSV loading section ---
        };
        // readAsText decodes UTF-8 directly (correct °C etc.) and uses less peak
        // memory than readAsBinaryString for a file this large.
        reader.readAsText(fileInput.files[0]);
    };
    fileInput.addEventListener('change', readFile);
}


// [removed] Basic Visualization function 'initVis' (Part 1) — not used by the delivered dashboard.

// clear visualizations before loading a new file
function clear(){
    // Basic Visualization containers were removed; guard in case they are absent.
    if (typeof scatter !== "undefined" && scatter) scatter.selectAll("*").remove();
    if (typeof radar !== "undefined" && radar) radar.selectAll("*").remove();
    dataTable.selectAll("*").remove();
    selected.clear();
}

//Create Table
// Shows a small banner on the Data Loading tab when a very large file was
// down-sampled, so the user knows exactly how many rows the dashboard is using.
// `total` = rows in the original file, `used` = rows kept after even sampling.
function showSampleNotice(total, used) {
    let host = d3.select("#dataTable");
    host.selectAll(".sampleNotice").remove();          // clear any previous banner
    host.insert("div", ":first-child")
        .attr("class", "sampleNotice")
        .style("margin", "0 0 12px 0")
        .style("padding", "10px 14px")
        .style("background", "#e2f3f4")
        .style("border", "1px solid #0e8f9b")
        .style("border-radius", "8px")
        .style("color", "#0a6c76")
        .style("font-size", "13px")
        .html("Large file detected: " + total.toLocaleString() +
              " rows. To keep the dashboard responsive, an evenly-spaced sample of " +
              used.toLocaleString() + " rows (spanning the whole dataset) is being used.");
}

function CreateDataTable(_data) {
    // --- start implemented table rendering section ---
    if (!_data || _data.length === 0) {
        return;
    }

    // remove any previous table content
    dataTable.selectAll("*").remove();

    // create table and apply the existing CSS class
    let table = dataTable.append("table")
        .attr("class", "dataTableClass");

    let thead = table.append("thead");
    let tbody = table.append("tbody");

    // add header row from CSV column titles
    thead.append("tr")
        .selectAll("th")
        .data(_data.columns)
        .enter()
        .append("th")
        .attr("class", "tableHeaderClass")
        .text(d => d);

    // add one table row per data row.
    // IMPORTANT: only show a PREVIEW of the first rows. Rendering all 324k rows
    // would create millions of DOM nodes and crash the browser; the full data
    // still lives in memory and drives the dashboard.
    const PREVIEW_ROWS = 100;
    let previewData = _data.slice(0, PREVIEW_ROWS);
    let rows = tbody.selectAll("tr")
        .data(previewData)
        .enter()
        .append("tr")
        .attr("class", "dataRow");

    // add cells for each attribute in the row
    rows.selectAll("td")
        .data(function(row) {
            return _data.columns.map(function(column) {
                return {column: column, value: row[column]};
            });
        })
        .enter()
        .append("td")
        .attr("class", "tableBodyClass")
        .text(d => d.value);

    // caption telling the user this is only a preview of a larger dataset
    if (_data.length > PREVIEW_ROWS) {
        dataTable.append("div")
            .attr("class", "tablePreviewNote")
            .style("margin-top", "8px")
            .style("font-size", "12px")
            .style("color", "#5b6b78")
            .text("Showing first " + PREVIEW_ROWS + " of " +
                  _data.length.toLocaleString() + " rows. The full dataset is loaded in the Dashboard.");
    }
    // --- end implemented table rendering section ---
}
// [removed] Basic Visualization function 'renderScatterplot' (Part 1) — not used by the delivered dashboard.

// [removed] Basic Visualization function 'renderRadarChart' (Part 1) — not used by the delivered dashboard.

// --- start implemented legend section ---
// [removed] Basic Visualization function 'renderLegend' (Part 1) — not used by the delivered dashboard.
// --- end implemented legend section ---


// [removed] Basic Visualization function 'radarX' (Part 1) — not used by the delivered dashboard.

// [removed] Basic Visualization function 'radarY' (Part 1) — not used by the delivered dashboard.

// [removed] Basic Visualization function 'radarAngle' (Part 1) — not used by the delivered dashboard.

// init scatterplot select menu
// [removed] Basic Visualization function 'initMenu' (Part 1) — not used by the delivered dashboard.

// refresh menu after reloading data
// [removed] Basic Visualization function 'refreshMenu' (Part 1) — not used by the delivered dashboard.

// read current scatterplot parameters
// [removed] Basic Visualization function 'readMenu' (Part 1) — not used by the delivered dashboard.

// switches and displays the tabs
function openPage(pageName,elmnt,color) {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tablink");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].style.backgroundColor = "";
    }
    document.getElementById(pageName).style.display = "block";
    elmnt.style.backgroundColor = color;
}
