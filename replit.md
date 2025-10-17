# Mathematical Visualizations - Jupyter Notebooks

## Overview
This project contains interactive Jupyter notebooks that create beautiful mathematical visualizations:
- **Doyle circles**: Interactive visualization of Doyle circle spirals with customizable parameters
- **Golden ratio spiral**: Voronoi diagrams and phyllotaxis patterns with golden ratio spirals

## Project Structure
```
.
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
4. The notebooks generate SVG visualizations that can be exported

## Features
- Interactive parameter controls using ipywidgets
- Real-time SVG rendering
- Mathematical pattern generation (Doyle circles, golden spirals, Voronoi diagrams)
- Object-oriented geometry classes for circles, arcs, and shapes
- Complex number-based geometric calculations

## Recent Changes
- **2025-10-17**: Initial setup in Replit environment
  - Installed Python 3.11 and all required dependencies
  - Configured JupyterLab to run on port 5000 with proper host settings
  - Created requirements.txt for dependency management
  - Added .gitignore for Python and Jupyter files
