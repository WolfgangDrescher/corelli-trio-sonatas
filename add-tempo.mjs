import fs from 'node:fs';
import { execSync } from 'node:child_process';

// Tempo table: [OMD, meter, MM value]
const tempos = [
	['Adagio', '3/2', 104],
	['Adagio e piano', '3/2', 104],
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
		let currentMeter = null;
		let currentTempo = null;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

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

			// Remove tempo comment (!...Adagio etc.) in measure 0 or 1
			if (currentMeasure <= 1 && line.startsWith('!') && !line.startsWith('!!!')) {
				const lower = line.toLowerCase();
				const isTempoComment = tempoNames.some(t => lower.includes(t));
				const isMMComment = /t=.*=\d+/i.test(lower);
				if (isTempoComment || isMMComment) continue;
			}

			output.push(line);

			const matchLineToAddMM = (line) => {
				return line.match(/^\*M(\d+)\/(\d+)/)
					|| line.startsWith('!!!OMD')
					|| line.startsWith('*met')
				;
			}

			// Add new MM after time signature (*M...) or tempo (!!!OMD...) changes
			if (matchLineToAddMM(line)) {
				const nextLine = lines[i + 1];
				if (!matchLineToAddMM(nextLine)) {
					const tempoEntry = findTempo(currentTempo, currentMeter);
					if (tempoEntry) {
						const mmValue = tempoEntry[2];
						const newLine = headers.map((h, idx) =>
							kernCols[idx] ? `*MM${mmValue}` : '*'
						).join('\t');
						output.push(newLine);
					} else if (currentMeasure > 1) {
						console.warn(`⚠️ No tempo for ${currentTempo} ${currentMeter} in ${filename}`);
					}
				}
			}
		}

		// Clean redundant interpretations using Humdrum tool "ridxx"
		const cleaned = execSync(`ridxx -i`, {
			input: output.join('\n'),
			encoding: 'utf8'
		}).trim();

		// Write back to the same file
		fs.writeFileSync(path, cleaned, 'utf8');
		console.log(`✔ Inserted MM lines for ${filename} (${omd})`);
	}
} catch (err) {
	console.error(err);
}
