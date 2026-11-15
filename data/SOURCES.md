# Data sources

The files in this folder are compact versions of the data below, made by `tools/build_data.py`.

## d3-celestial

`stars.json`, `constellations.json`, `dso.json` (positions and types, and the sizes and magnitudes of objects outside the Messier catalog) and `milkyway.json` come from d3-celestial 0.7.35 by Olaf Frohn. Its sources include the XHIP extended Hipparcos compilation, IAU star names and constellation figures, and SEDS Messier data.

```
Copyright (c) 2015, Olaf Frohn
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## SEDS Messier Catalog

The visual magnitudes and sizes of the 110 Messier objects in `dso.json` come from the data table of the SEDS Messier Catalog by Hartmut Frommert and Christine Kronberg (http://www.messier.seds.org/data.html, last modified April 26, 2013), in place of d3-celestial's. Its materials may be freely used for non-profit, educational purposes when the SEDS Messier Catalog online database is acknowledged as the source (http://www.messier.seds.org/usage.html).

## NGC 2000.0

The sizes and magnitudes of the NGC objects added in November 2026 (the southern showpieces from the Jewel Box to NGC 6744, and the northern classics) come from NGC 2000.0, edited by Roger W. Sinnott (Sky Publishing and Cambridge University Press, 1988), as VizieR gives it (catalogue VII/118, https://cdsarc.cds.unistra.fr/viz-bin/cat/VII/118, read November 2026). Where its magnitude is photographic or missing, d3-celestial's stands; `tools/build_data.py` lists each exception. Their positions and types are d3-celestial's. This research has made use of the VizieR catalogue access tool, CDS, Strasbourg, France.

## OpenNGC

The Tarantula Nebula's size and magnitude, the Turtle Nebula's (NGC 6210) visual magnitude, and the Needle Galaxy's (NGC 4565) position and the ratio of its axes come from OpenNGC by Mattia Verga (https://github.com/mattiaverga/OpenNGC, `NGC.csv`, read November 2026), released under the Creative Commons Attribution-ShareAlike 4.0 license (CC BY-SA 4.0); OpenNGC draws them from the NASA/IPAC Extragalactic Database, HyperLEDA and SIMBAD.

## Open cluster catalogues

Stock 2, which has no NGC or IC number, takes its position and size from the catalogue of optically visible open clusters by Dias, Alessi, Moitinho & Lépine (2002, A&A 389, 871; version 3.5, VizieR B/ocl), and its magnitude from the integrated V of Kharchenko, Piskunov, Schilbach, Röser & Scholz (2009, A&A 504, 681; VizieR J/A+A/504/681), both read through VizieR in November 2026.

## Kemble's Cascade

Kemble's Cascade, an asterism with no entry in these catalogues, is measured from d3-celestial's own star catalog by `tools/build_data.py`: it's placed on HD 24479 (HIP 18505), the 5th-magnitude star in its middle, runs twice as far as NGC 1502 is from that star, and its magnitude adds up the catalog's stars along the line.

## Washington Double Star Catalog

The separations, position angles and magnitudes of the double stars in `dso.json` are the latest measures in the Washington Double Star Catalog (WDS) summary, `wdsweb_summ2.txt`, as of November 2026 (Mason, Wycoff, Hartkopf, Douglass & Worley 2001, AJ 122, 3466; current version at http://www.astro.gsu.edu/wds/), except Almach's, which is explained in `tools/build_data.py`. This research has made use of the Washington Double Star Catalog maintained at the U.S. Naval Observatory.

## IAU Working Group on Star Names

`tools/wgsn.tsv` lists the star names adopted by the IAU Working Group on Star Names (WGSN), from the IAU Catalog of Star Names at https://exopla.net/star-names/modern-iau-star-names/ as of October 2026. `build_data.py` gives each star d3-celestial names the WGSN's name for it, and drops a name the WGSN never adopted for that star, which then goes by its Bayer or Flamsteed label. IAU star names are free to use and in the public domain.

## city-timezones

`cities.json` and `tzcity.json` come from city-timezones 1.3.4 by Kevin Roberts, released under the MIT License:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Written for Starhop

The double-star list (which pairs, their names, colours and notes) and the object descriptions were written for Starhop and are covered by the project's MIT license.
