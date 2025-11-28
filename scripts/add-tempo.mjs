import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const kernScoresPath = path.resolve(__dirname, '..', 'kern');

// Tempo table: [OMD, meter, MM value]
const tempi = [
	['Adagio', '3/2', 104],
	['Adagio e piano', '3/2', 104],
	['Adagio', '3/4', 72],
	['Adagio e piano', '3/4', 72],
	['Adagio', '3/8', 40],
	['Adagio', '4/4', 36],
	['Adagio', '2/2', 36],
	['Grave', '3/2', 132],
	['Grave', '4/4', 34],
	['Largo', '3/2', 108],
	['Largo', '3/4', 72],
	['Largo', '4/4', 56],
	['Largo e puntato', '4/4', 72],
	['Presto', '2/2', 168],
	['Presto', '4/4', 160],
	['Vivace', '3/4', 192],
	['Vivace', '4/4', 152],
	['Allegro', '12/8', 192],
	['Allegro', '2/2', 220],
	['Allegro', '3/4', 176],
	['Allegro', '3/8', 152],
	['Allegro', '4/4', 104],
	['Allegro', '6/4', 210],
	['Allegro', '6/8', 152],
];

const tempoNames = [...new Set(tempi.map(([name]) => name.toLowerCase()))];

// Helper: find MM value for a given OMD + meter
function findTempo(omd, meter) {
	return tempi.find(([tOmd, tMeter]) =>
		tOmd.trim().toLowerCase() === omd.trim().toLowerCase() &&
		tMeter === meter
	);
}

try {
	const files = fs.readdirSync(kernScoresPath).filter(f => f.endsWith('.krn'));

	for (const filename of files) {
		const filePath = path.resolve(kernScoresPath, filename);;
		const result = fs.readFileSync(filePath, 'utf-8').trim();
		const lines = result.split('\n');

		// Find the exclusive interpretation line (**kern)
		const headerLine = lines.find(l => l.startsWith('**'));
		if (!headerLine) throw new Error(`No exclusive interpretation found in ${filename}`);
		const headers = headerLine.split('\t');
		const kernCols = headers.map(h => h.startsWith('**kern')); // mark **kern columns

		// Extract OMD value from !!!OMD: line
		const omdLine = lines.find(l => l.startsWith('!!!OMD:'));
		if (!omdLine) {
			console.warn(`⚠️ No OMD found in ${filename}`);
			continue;
		}
		const omd = omdLine.replace('!!!OMD:', '').trim();

		const output = [];
		let currentMeasure = 0;
		let currentMeter = null;
		let currentTempo = null;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Ignore metronome numbers of original score
			if (line.startsWith('*MM')) {
				continue;
			}

			// Track current measure number
			if (line.startsWith('=')) {
				const m = line.match(/^=(\d+)/);
				if (m) currentMeasure = parseInt(m[1]);
			}

			// Track current tempo
			if (line.startsWith('!!!OMD')) {
				const t = line.match(/^!!!OMD: (.+)$/);
				if (t) currentTempo = t[1].trim();
			}

			// Track current meter
			if (line.startsWith('*M')) {
				const mm = line.match(/^\*M(\d+)\/(\d+)/);
				if (mm) currentMeter = `${mm[1]}/${mm[2]}`;
			}

			// Remove all tempo comment (!...Adagio etc.)
			if (line.startsWith('!') && !line.startsWith('!!!')) {
				// see fix-tempo.mjs. !!!OMD will only be rendered in Verovio
				// if bound to the first note of a measure. This workaround
				// ensures the diplay of the tempo marking.
				if (line.includes('KEEP')) {
					output.push(line.replace('KEEP', ''));
					continue;
				}
				const lower = line.toLowerCase();
				const isTempoComment = tempoNames.some(t => lower.includes(t));
				const isMMComment = /t=.*=\d+/i.test(lower);
				if (isTempoComment || isMMComment) continue;
			}

			output.push(line);

			// Helper to detect lines that should block MM insertion
			const matchLineToAddMM = (line) => {
				return /^\*M\d+\/\d+/.test(line)
					|| line.startsWith('!!!OMD')
					|| line.startsWith('*met')
					|| /^\*MM\d+/.test(line)
				;
			};

			// Add or replace MM after *M or !!!OMD
			if (matchLineToAddMM(line)) {
				const nextLine = lines[i + 1];
				const tempoEntry = findTempo(currentTempo, currentMeter);

				if (tempoEntry) {
					const mmValue = tempoEntry[2];
					const newMM = headers.map((h, idx) =>
						kernCols[idx] ? `*MM${mmValue}` : '*'
					).join('\t');

					// Case A: replace existing MM
					if (/^\*MM\d+/.test(nextLine)) {
						output.push(newMM);
						i++; // skip old MM
						continue;
					}

					// Case B: insert new MM
					if (!matchLineToAddMM(nextLine)) {
						output.push(newMM);
					}
				} else if (currentMeasure > 1) {
					console.warn(`⚠️ No tempo for ${currentTempo} ${currentMeter} in ${filename}`);
				}
			}
		}

		// Clean redundant interpretations
		const cleaned = execSync(`ridxx -i`, {
			input: output.join('\n'),
			encoding: 'utf8'
		}).trim();

		fs.writeFileSync(filePath, cleaned, 'utf8');
		console.log(`✔ Inserted MM lines for ${filename} (${omd})`);
	}
} catch (err) {
	console.error(err);
}
