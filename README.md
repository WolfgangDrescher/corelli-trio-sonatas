# Corelli Trio Sonatas

This repository contains the Humdrum `kern`-converted files from the DCML
Corelli corpus:

https://github.com/DCMLab/corelli

> Hentschel, J., Moss, F. C., Neuwirth, M., & Rohrmeier, M. A. (2021). A
> semi-automated workflow paradigm for the distributed creation and curation of
> expert annotations. Proceedings of the 22nd International Society for Music
> Information Retrieval Conference, ISMIR, 262–269.
> https://doi.org/10.5281/ZENODO.5624417

This corpus forms part of the larger Distant Listening Corpus which constitutes
a data infrastructure the data report of which has implications for the present
corpus, too:

> Hentschel, J., Rammos, Y., Neuwirth, M., & Rohrmeier, M. (2025). A corpus and
> a modular infrastructure for the empirical study of (an)notated music.
> Scientific Data, 12(1), 685. https://doi.org/10.1038/s41597-025-04976-z


## Adjustments and additions

* Instrument names were standardized to `Violino I`, `Violino II`, `Violone`,
  `Cembalo`, and `Organo`.
* When *Cembalo/Organo* was identical to *Violone*, the two voices were merged
  into a single part to avoid duplication.
* Manually created analytical annotations are provided in the files
  `modulations.yaml`, `sequences.yaml`, and `cadences.yaml`.
* Key annotations were added to the Humdrum scores as tandem interpretations
  (`*key:`) indicating the current key designation.
* Measure numbers were added to all Humdrum files to support navigation and
  analysis.
* Re-encordings of `op04n06g`, `op04n07e` and `op04n12c` in full `12/8` meter to
  avoid polymeter and rendering issues in Verovio. See
  https://github.com/music-encoding/music-encoding/issues/1561
