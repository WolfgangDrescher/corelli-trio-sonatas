import fs from 'node:fs';
import { execSync } from 'node:child_process';

// Tempo table: [OMD, meter, MM value]
const tempos = [
	['Adagio', '3/2', 104],
	['Adagio', '3/4', 72],
	['Adagio', '3/8', 40],
	['Adagio', '4/4', 36],
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

const tempoNames = [...new Set(tempos.map(([name]) => name.toLowerCase()))];

// Helper: find MM value for a given OMD + meter
function findTempo(omd, meter) {
	return tempos.find(([tOmd, tMeter]) =>
		tOmd.trim().toLowerCase() === omd.trim().toLowerCase() &&
		tMeter === meter
	);
}

try {
	const files = fs.readdirSync('./kern').filter(f => f.endsWith('.krn'));

	for (const filename of files) {
		const path = `./kern/${filename}`;
		const result = execSync(`cat ${path}`).toString().trim();
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

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Track measure number
			if (line.startsWith('=')) {
				const m = line.match(/^=(\d+)/);
				if (m) currentMeasure = parseInt(m[1]);
			}

			// Remove tempo comment (!...Adagio etc.) in measure 0 or 1
			if (currentMeasure <= 1 && line.startsWith('!') && !line.startsWith('!!!')) {
				const lower = line.toLowerCase();
				const isTempoComment = tempoNames.some(t => lower.includes(t));
				if (isTempoComment) continue; // Zeile überspringen
			}

			output.push(line);

			// Detect time signature line (*M...)
			const match = line.match(/^\*M(\d+)\/(\d+)/);
			if (match) {
				const meter = `${match[1]}/${match[2]}`;
				const tempoEntry = findTempo(omd, meter);

				if (!tempoEntry) {
					console.warn(`⚠️ No tempo for ${omd} (${meter}) in ${filename}`);
					continue;
				}

				const mmValue = tempoEntry[2];
				let insertIndex = i + 1; // default: after *M line

				// If next line is *met, place MM after that line instead
				const nextLine = lines[i + 1] || '';
				if (nextLine.includes('*met')) {
					output.push(nextLine); // keep the *met line before inserting *MM
					i++; // skip it
					insertIndex = i + 1;
				}

				// Check if the next relevant line already contains *MM
				const afterNext = lines[insertIndex] || '';
				if (afterNext.includes('*MM')) {
					// Replace existing *MM line with new tempo
					const replaced = afterNext
						.split('\t')
						.map((cell, idx) => kernCols[idx] ? `*MM${mmValue}` : cell.startsWith('*') ? '*' : cell)
						.join('\t');
					output.push(replaced);
					i++; // skip original *MM
				} else {
					// Insert new *MM line after *M or *met
					const newLine = headers.map((h, idx) =>
						kernCols[idx] ? `*MM${mmValue}` : '*'
					).join('\t');
					output.push(newLine);
				}
			}
		}

		// Combine all lines back into text
		const outputString = output.join('\n');

		// Clean redundant interpretations using Humdrum tool "ridxx"
		const cleaned = execSync(`ridxx -i`, {
			input: outputString,
			encoding: 'utf8'
		}).trim();

		// Write back to the same file
		fs.writeFileSync(path, cleaned, 'utf8');
		console.log(`✔ Inserted MM lines for ${filename} (${omd})`);
	}
} catch (err) {
	console.error(err);
}
