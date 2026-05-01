import { PaperAnalysisSchema } from "~/schema";
import type { PaperAnalysis } from "~/schema";

import paper0 from "../../kb/raw/gastritis/marshall-warren-1984-curved-bacilli.json";
import paper1 from "../../kb/raw/gastritis/fellenius-1981-ppi-mechanism.json";
import paper2 from "../../kb/raw/gastritis/cheney-1950-vitamin-u.json";
import paper3 from "../../kb/raw/gastritis/ford-2020-eradication-cancer-prevention.json";
import paper4 from "../../kb/raw/gastritis/nanjundaiah-2011-ginger-gastroprotection.json";
import paper5 from "../../kb/raw/gastritis/fasano-2020-zonulin-leaky-gut.json";
import paper6 from "../../kb/raw/gastritis/he-2025-acupuncture-chronic-gastritis.json";
import paper7 from "../../kb/raw/gastritis/park-2020-cheonwangbosim-dan-hpylori.json";
import paper8 from "../../kb/raw/gastritis/sipponen-maaroos-2015-chronic-gastritis.json";
import paper9 from "../../kb/raw/gastritis/tan-2000-voacanga-africana-anti-ulcer.json";

// Ten papers selected for maximum domain diversity:
// Microbiology (Marshall-Warren), Pharmacology (Fellenius PPI), Dietary therapy (Cheney vitamin U),
// Cancer prevention (Ford), Ethnopharmacology (Nanjundaiah ginger, Tan Voacanga),
// Gut barrier biology (Fasano zonulin), Traditional Chinese medicine (He acupuncture, Park herbal),
// Pathology classification (Sipponen chronic gastritis)
const rawPapers = [paper0, paper1, paper2, paper3, paper4, paper5, paper6, paper7, paper8, paper9];

let cachedPapers: PaperAnalysis[] | null = null;

export function loadPapers(): PaperAnalysis[] {
	if (cachedPapers) return cachedPapers;
	cachedPapers = rawPapers.map((p) => PaperAnalysisSchema.parse(p));
	return cachedPapers;
}
