import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const kernScoresPath = path.resolve(__dirname, '..', 'kern');

const fixes = {
	op01n01d: [
		[1, 'Allegro'],
		[73, 'Adagio'],
		[87, 'Allegro'],
	],
	op01n05c: [
		[1, 'Adagio'],
		[5, 'Allegro'],
		[8, 'Adagio'],
		[10, 'Allegro'],
		[13, 'Adagio'],
		[13, 'Adagio'],
		[15, 'Adagio'],
		[21, 'Allegro'],
		[27, 'Adagio'],
		[28, 'Adagio e piano'],
	],
	op01n09a: [
		[1, 'Allegro'],
		[10, 'Allegro'],
		['28/3', 'Adagio e piano'],
		[31, 'Allegro'],
	],
	op01n09b: [
		[1, 'Adagio'],
		[5, 'Allegro'],
	],
	op01n09d: [
		[1, 'Allegro'],
		['31/3', 'Adagio'],
		[35, 'Allegro'],
		[51, 'Adagio'],
	],
	op03n04d: [
		[1, 'Presto'],
		['48/2.5', 'Adagio'],
	],
};

function parseTimepoint(tp) {
	if (typeof tp === 'string') {
		const [measureStr, beatStr] = tp.split(/\/(.+)/).filter(Boolean);
		return {
			measure: parseInt(measureStr, 10),
			beat: parseFloat(beatStr),
		};
	}
	return {
		measure: parseInt(tp, 10),
		beat: 1,
	};	
}

try {
	const files = fs.readdirSync(kernScoresPath).filter(f => f.endsWith('.krn'));

	for (const filename of files) {

		const id = filename.replace('.krn', '');
		const fileFixes = fixes[id] || [];
		if(fileFixes.length) {
			const filePath = path.resolve(kernScoresPath, filename);;
			const result = fs.readFileSync(filePath, 'utf8').trim();

			const kernScore = execSync(`meter -f`, {
				input: result,
			}).toString().trim();

			const lines = kernScore.split('\n');

			// Find the exclusive interpretation line (column headers: **kern, **cdata-beat, etc.)
			const headerLine = kernScore.split('\n').find(l => l.startsWith('**'));
			if (!headerLine) throw new Error(`No exclusive interpretation found in ${id}`);
			const headers = headerLine.split('\t');
			const meterSpines = headers.map((h, i) => {
				return h.startsWith('**cdata-beat') ? i : -1;
			}).filter(i => i !== -1);
			const kernIndices = headers.map((h, i) => h === '**kern' ? i : -1).filter(i => i !== -1);
			const lastKernIndex = kernIndices.length > 0 ? kernIndices[kernIndices.length - 1] : -1;
			const topKernSpine = headers.map((h, i) => i === lastKernIndex);

			const output = [];
			let currentMeasure = 0;
			let currentBeat = 0;
			const usedFixes = new Set();

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];

				// Track meter
				const tokens = line.split('\t');
				for (let j = 0; j < meterSpines.length; j++) {
					const meterToken = tokens[meterSpines[j]];
					if (meterToken) {
						const meter = parseFloat(meterToken);
						if (meter) {
							currentBeat = meter;
							break;
						}
					}
				}

				// Track measure number
				let newOmdRecord = null;
				let newOmdLocalComment = null;
				if (line.startsWith('=')) {
					const m = line.match(/^=(\d+)/);
					if (m) {
						currentMeasure = parseInt(m[1]);
						currentBeat = 1; // TODO
					}
					output.push(line);
					continue;
				}

				fileFixes.forEach(([measure, tempo], fixIndex) => {
					if (usedFixes.has(fixIndex)) return;
					const tp = parseTimepoint(measure);
					if (tp.measure === currentMeasure && currentBeat === tp.beat) {
						newOmdRecord = `!!!OMD: ${tempo}`;
						if (currentBeat !== 1) {
							// see add-tempo.mjs. !!!OMD will only be rendered in Verovio
							// if bound to the first note of a measure. This workaround
							// ensures the diplay of the tempo marking.
							newOmdLocalComment = topKernSpine.map(s => s ? `!KEEPLO:TX:a:B:t=${tempo}` : '!').join('\t');
						}
						usedFixes.add(fixIndex);
					}
				});

				// if (line.startsWith('!!!OMD:')) {
				// 	const [, tempo] = fileFixes.find(([measure]) => measure === 0);
				// 	newOmdRecord = `!!!OMD: ${tempo}`;
				// }

				if (newOmdRecord) {
					output.push(newOmdRecord);
				}
				if (newOmdLocalComment) {
					output.push(newOmdLocalComment);
				} 
				output.push(line);
			}

			const fileContent = execSync("extractxx -I '**cdata-beat'", {
				input: output.join('\n'),
			}).toString().trim();
	
			// Write back to the same file
			fs.writeFileSync(filePath, fileContent, 'utf8');
			console.log(`✔ Fixed movement designations (OMD) for ${filename}`);
		}
	}
} catch (err) {
	console.error(err);
}
