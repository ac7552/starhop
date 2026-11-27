# Credits

| What | From | Licence | Where |
|---|---|---|---|
| Star positions, magnitudes, colours and parallaxes | Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren 1991), as converted to JSON in <https://github.com/brettonw/YaleBrightStarCatalog> (commit abffb3b) | MIT (`data/bsc5/LICENSE`, copyright 2016 Bretton Wade) | `data/bsc5/bsc5.json`, unchanged; field notes in `data/bsc5/bsc5.readme.txt` |
| Planet orbital elements | E. M. Standish, "Keplerian Elements for Approximate Positions of the Major Planets", NASA JPL Solar System Dynamics, <https://ssd.jpl.nasa.gov/planets/approx_pos.html> | published numerical data | `src/solar.js` |
| Planet poles | IAU Working Group on Cartographic Coordinates and Rotational Elements (Archinal et al. 2018) | published numerical data | `src/solar.js` |
| B-V to temperature | Ballesteros, "New insights into black bodies", EPL 97 (2012) | formula | `src/stars.js` |
| CIE colour matching functions | the analytic fit of Wyman, Sloan and Shirley, JCGT 2 (2013) | formula | `src/stars.js` |
| 3D drawing | three.js r170 | MIT | `web/vendor/` (`three-LICENSE.txt`) |
| Font | Inter Tight | SIL Open Font Licence 1.1 | `web/fonts/` (`inter-tight-OFL.txt`) |

Everything else (the ship, the planet shading, the made-up planetary systems) is drawn by this project's own code.
The made-up planets around other stars are not real.

The code is MIT.
