# Mathematical Visualizations - Jupyter Notebooks

## Overview
This project contains interactive Jupyter notebooks that create beautiful mathematical visualizations:
- **Doyle circles**: Interactive visualization of Doyle circle spirals with customizable parameters
- **Golden ratio spiral**: Voronoi diagrams and phyllotaxis patterns with golden ratio spirals

## Project Structure
```
.
├── src/
│   └── doyle_spiral.py          # Doyle spiral module (all classes and utilities)
├── Doyle circles.ipynb          # Doyle circle spiral visualizations
├── golden_ratio_spiral.ipynb    # Golden ratio and Voronoi diagrams
├── requirements.txt             # Python dependencies
└── .gitignore                  # Git ignore patterns
```

## Setup
The project is configured to run in Replit with JupyterLab. All dependencies are automatically installed:
- numpy: Numerical computations
- scipy: Scientific computing and optimization
- svgwrite: SVG generation for visualizations
- ipywidgets: Interactive widgets for notebooks
- shapely: Geometric operations
- jupyterlab: Jupyter notebook interface
- matplotlib: Plotting library

## Usage
1. The JupyterLab server starts automatically on port 5000
2. Open either notebook file to explore the visualizations
3. Use the interactive widgets to adjust parameters in real-time
4. Enter a filename and click "Save SVG" to export visualizations with custom names

## Features
- Interactive parameter controls using ipywidgets
- Real-time SVG rendering
- Manual SVG export with custom filenames (no automatic saving)
- Mathematical pattern generation (Doyle circles, golden spirals, Voronoi diagrams)
- Object-oriented geometry classes for circles, arcs, and shapes
- Complex number-based geometric calculations
- **Doyle circles enhancements**:
  - Clipped line pattern fills using matplotlib path clipping (replaces SVG pattern fills)
  - Per-ring rotation: angle increments across spiral rings for dynamic visual effects
  - Flexible outline control: toggle polygon outlines independently from line patterns
  - Red outline highlighting for specific arcs

## Code Architecture
The Doyle circles visualization is organized as a clean Python module (`src/doyle_spiral.py`) with object-oriented design. The notebook imports and uses this module, keeping the notebook file simple and focused on interaction.

### Geometry Utilities
- **Line-polygon intersection**: Exact geometric intersection calculations (no sampling)
- **Polygon operations**: Inward buffering using Shapely for line offset control
- **Clipping algorithm**: Precise line clipping to polygon boundaries

### Core Classes
- **Shape**: Abstract base class for geometric elements
- **DrawingContext**: SVG rendering and coordinate normalization
- **CircleElement**: Circle representation with intersection calculations
- **ArcElement**: Arc segments with SVG path generation
- **ArcGroup**: Groups of arcs with outline ordering and fill patterns
- **DoyleSpiral**: Main spiral generator with multiple rendering modes
- **ArcSelector**: Arc selection strategies (closest, farthest, alternating, etc.)

### Rendering Pipeline
1. Generate outer circles and compute intersections
2. Create arc groups for each circle with ring indices
3. Draw closure arcs from outer circles
4. Apply fill patterns or debug visualization
5. Render to SVG with scaling

## Recent Changes
- **2025-10-18**: Added manual SVG export controls
  - Replaced automatic saving with user-controlled save functionality
  - Added filename text input field for custom SVG filenames
  - Added "Save SVG" button to export only when user clicks
  - SVG files now saved on-demand with user-specified names
- **2025-10-18**: Extracted code into reusable Python module
  - Created `src/doyle_spiral.py` module (~1524 lines) containing all classes and utilities
  - Simplified notebook to just import and call `spiral_ui()` function
  - Clean separation: module contains implementation, notebook focuses on interaction
  - All functionality preserved - fully backward compatible
- **2025-10-18**: Major code refactoring for maintainability
  - Extracted geometry utilities into separate helper functions
  - Simplified DrawingContext class by extracting pattern fill logic
  - Refactored ArcGroup.get_closed_outline into smaller focused methods
  - Split DoyleSpiral._render_arram_boyle into modular helper methods
  - Added clear section headers and improved code organization
  - Improved docstrings and code comments throughout
  - All functionality preserved - backward compatible refactoring
- **2025-10-18**: Added line offset control UI
  - New "Line offset" slider (0-10px) for inward polygon buffering
  - Uses Shapely's buffer method for precise offset calculation
  - Creates clean space between arc outlines and clipped lines
- **2025-10-18**: Fixed line clipping antialiasing artifacts
  - Replaced sampling-based approach with exact geometric intersections
  - Eliminated visual artifacts at polygon edges
  - More precise and mathematically correct line clipping
- **2025-10-17**: Enhanced Doyle circles visualization
  - Replaced SVG pattern fills with actual clipped parallel lines for better visual quality
  - Implemented polygon clipping using matplotlib.path for precise line boundaries
  - Added per-ring angle rotation (ring_index * angle) for spiral line patterns
  - Added "Draw group outline" checkbox (default: checked) to control polygon borders
  - Fixed arc rendering logic to properly respect UI checkbox settings
  - Outer closure arcs now properly display with red outline option
- **2025-10-17**: Initial setup in Replit environment
  - Installed Python 3.11 and all required dependencies
  - Configured JupyterLab to run on port 5000 with proper host settings
  - Created requirements.txt for dependency management
  - Added .gitignore for Python and Jupyter files
