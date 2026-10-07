RecycleAlloy Explorer

An interactive D3.js dashboard for exploring a large simulated dataset of sustainable aluminium alloys made from recycled scrap. It shows how scrap mixing ratios, chemistry, and microstructure drive an alloy's mechanical and thermophysical performance, and helps a materials engineer shortlist promising candidates.

🎥 Demo video: Group11_video_part2.mp4

🚀 Features & Capabilities
Six linked, animated views: pin an alloy in one view and every other view updates instantly
Global filter bar with range sliders for the six scrap sources (KS1295 piston alloy, 6082, 2024, Battery-box, 3003, 4032)
Alloy pinning: compare up to seven colour-coded alloys side by side
Correlation analysis with least-squares trend lines and Pearson's r
Large-file handling: loads datasets of ~324,000 rows × 70 columns (~190 MB) smoothly in the browser
No build step, no server: plain HTML, JavaScript, and D3 v7

📂 Repository Structure
.
├── index.html                   Page shell: masthead, tabs, and the containers the dashboard fills in
├── dataVis.js                   File loading, delimiter detection, down-sampling, data preview,
│                                tab switching, and the shared selection state
├── dashboard.js                 Column detection, the control bar, and all six linked views
├── dashboard_styles.css         Dashboard theme (layout, colours, chips, sliders, tooltips)
├── style.css                    Base styles
├── Group11_screenshot_part2.png Dashboard screenshot
├── Group11_video_part2.mp4      Demo video
└── README.md

📌 Getting Started
Prerequisites
A modern browser (Chrome, Edge, or Firefox)
An internet connection on first load (D3 v7 and jQuery UI are loaded from CDNs)
Running the Application
bash
git clone https://github.com/houcem24/RecycleAlloy-Explorer.git
cd RecycleAlloy-Explorer
Open index.html in your browser.
In the Data Loading tab, choose a dataset file. Both comma-separated .csv and tab-separated .txt work, since the delimiter is detected automatically.
Switch to the Dashboard tab. All six views are ready to use.

🧪 Usage & Workflow
Filter the design space with the scrap-ratio sliders at the top.
Explore sensitivities in the Design-Space Scatter and the Correlation Explorer.
Pin interesting alloys by clicking their points. Each gets a colour and a removable chip.
Compare pinned alloys across composition, mechanical, and thermophysical views.
Shortlist candidates in the Multi-Alloy Comparison using the properties that matter to you.

📊 The Six Visualizations
#	View	What it shows	Why this encoding
1	Design-Space Scatter	Any scrap ratio or phase fraction (X) against any of the 14 properties (Y), with zoom, pan, and rich tooltips	Shows real measured values with no projection, so it answers "how does this input affect this property?" directly
2	Composition Ribbon	A 100%-wide band per pinned alloy, toggling between scrap sources, atomic elements, and microstructure phases	Composition is part-to-whole, and the three modes link recipe → chemistry → microstructure
3	Mechanical Radar	Yield strength, hardness, and hot-crack susceptibility (CSC) on a normalised three-axis radar	With exactly three objectives, shape-based comparison is immediate
4	Thermophysical Strips	One track per thermophysical property (11), showing each pinned alloy's position within the dataset range	Too many axes for a radar; position on a common scale is the most accurately read channel
5	Correlation Explorer	Any input against any property, with a trend line and Pearson's r plus a plain-language strength label	Turns "which factors matter?" into a quantified answer
6	Multi-Alloy Comparison	Grouped bars for all pinned alloys over a user-chosen subset of properties, normalised 0–100%	The side-by-side decision view for a final shortlist
⚙️ Data Handling
Automatic column grouping: columns are sorted into scraps, elements, microstructure phases, mechanical properties, and thermophysical properties (detectColumns in dashboard.js). Matching tolerates differences in spacing and capitalisation.
Missing values are kept: a NaN can mean a phase that doesn't form or a simulation that didn't converge. Rows are never dropped; each view skips only the missing values in the column it needs.
Targeted normalisation: only the radar, strips, and comparison bars normalise. The scatter and correlation plots show raw values.
Large-file sampling: files above 80,000 rows are reduced to an evenly-spaced 80,000-row sample that still spans the whole dataset, and a notice reports how many rows are in use. The threshold is the MAX_ROWS constant in dataVis.js.
Consistent motion: all transitions share one duration constant (DUR, ~400 ms).

🛠️ Tech Stack
D3.js v7 for all visualizations and transitions
jQuery UI for range sliders and tabs
Vanilla JavaScript, HTML, CSS

📬 Acknowledgment
Developed as part of the Data Visualization course (Summer Semester 2026) at the University of Passau, Germany.
