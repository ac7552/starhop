# Credits

| What | From | Licence | Where |
|---|---|---|---|
| Star positions, magnitudes and colours | HYG database v4.1 by David Nash (astronexus), <https://github.com/astronexus/HYG-Database> | CC BY-SA 4.0 | `data/stars.bin`, `data/stars.json` (repacked by `tools/pack_stars.py`: stars brighter than magnitude 7 or within 25 parsecs, turned into ecliptic coordinates). Licence text in `data/HYG-LICENSE.md`. |
| Planet orbital elements | E. M. Standish, "Keplerian Elements for Approximate Positions of the Major Planets", NASA JPL Solar System Dynamics, <https://ssd.jpl.nasa.gov/planets/approx_pos.html> | published numerical data | `src/solar.js` |
| Planet poles | IAU Working Group on Cartographic Coordinates and Rotational Elements (Archinal et al. 2018) | published numerical data | `src/solar.js` |
| B-V to temperature | Ballesteros, "New insights into black bodies", EPL 97 (2012) | formula | `src/stars.js` |
| CIE colour matching functions | the analytic fit of Wyman, Sloan and Shirley, JCGT 2 (2013) | formula | `src/stars.js` |
| 3D drawing | three.js r170 | MIT | `web/vendor/` (`three-LICENSE.txt`) |
| Font | Inter Tight | SIL Open Font Licence 1.1 | `web/fonts/` (`inter-tight-OFL.txt`) |

Everything else (the ship, the planet shading, the made-up planetary systems) is drawn by this project's own code.
The made-up planets around other stars are not real.

The star data is CC BY-SA 4.0, so anything made from `data/` must credit the HYG database and keep that licence.
The code is MIT.
