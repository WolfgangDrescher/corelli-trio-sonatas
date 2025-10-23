import yaml from 'js-yaml';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

try {
	const files = yaml.load(fs.readFileSync('./modulations.yaml', 'utf8'));
	
	Object.entries(files).forEach(([filename, modulations]) => {
		const result = execSync(`cat ./kern/${filename}.krn | meter -f`).toString().trim();
		const lines = result.split('\n');
		
		const headerLine = lines.find(l => l.startsWith('**'));
		if (!headerLine) throw new Error(`No exclusive interpretation found in ${filename}`);
		const headers = headerLine.split('\t');
		const kernCols = headers.map(h => h.startsWith('**kern'));

		const output = [];
		let currentMeasure = null;
		
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			const measureMatch = line.match(/^=(\d+)/);
			if (measureMatch) {
				currentMeasure = parseInt(measureMatch[1], 10);
			}

			if (currentMeasure && line.includes('\t')) {
				const cells = line.split('\t');
				const beatValues = headers.map((h, idx) => h.startsWith('**cdata-beat') ? cells[idx] : null)
					.filter(v => v && v.match(/^\d+(\.\d+)?$/));

				if (beatValues.length > 0) {
					const firstBeat = parseFloat(beatValues[0]);
					const modulation = modulations.find(([pos]) => {
						const [m, b] = pos.split('/');
						return parseInt(m, 10) === currentMeasure && parseFloat(b) === firstBeat;
					});
					
					if (modulation) {
						const key = modulation[1];
						const newLine = headers.map((h, idx) =>
							kernCols[idx] ? `*${key}:` : '*'
						).join('\t');
						
						output.push(newLine);
					}
				}
			}

			output.push(line);
		}

		const linesAsString = output.join('\n');

		const finalResult = execSync(`extractxx -I '**cdata-beat'`, {
			input: linesAsString,
			encoding: 'utf8'
		}).toString().trim();

		fs.writeFileSync(`./kern/${filename}.krn`, finalResult, 'utf8');
		console.log(`✔ Added modulations for ${filename}`);
	});
} catch (e) {
	console.error(e);
}
