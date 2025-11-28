import yaml from 'js-yaml';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const modulationYamlPath = path.resolve(__dirname, '..', 'modulations.yaml');
const kernScoresPath = path.resolve(__dirname, '..', 'kern');

try {
	const files = yaml.load(fs.readFileSync(modulationYamlPath, 'utf8'));
	
	Object.entries(files).forEach(([filename, modulations]) => {
		// Run Humdrum "meter -f" to annotate beats in each line
		const kernScore = fs.readFileSync(path.resolve(kernScoresPath, `${filename}.krn`));
		const result = execSync('meter -f', {
			input: kernScore,
		}).toString().trim();
		const lines = result.split('\n');
		
		// Find the exclusive interpretation line (column headers: **kern, **cdata-beat, etc.)
		const headerLine = lines.find(l => l.startsWith('**'));
		if (!headerLine) throw new Error(`No exclusive interpretation found in ${filename}`);
		const headers = headerLine.split('\t');
		const kernCols = headers.map(h => h.startsWith('**kern')); // mark which columns are **kern

		const output = [];
		let currentMeasure = null;
		
		// --- 1. Handle the initial modulation (measure 0 or 1, beat 1) ---
		const initialModulation = modulations.find(([pos]) => {
			const [m, b] = pos.split('/');
			return (parseInt(m, 10) === 0) || (parseInt(m, 10) === 1 && parseFloat(b) === 1);
		});

		// Create a list of remaining modulations, excluding the initial one
		const remainingModulations = initialModulation
			? modulations.filter(([pos]) => pos !== `${initialModulation[0]}`)
			: modulations;

		let insertedInitial = false;

		// --- 2. Process each line of the file ---
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Detect *k[ line (key signature declaration)
			if (line.includes('*k[') && initialModulation && !insertedInitial) {
				output.push(line);
				const nextLine = lines[i + 1] || '';
				const newKey = initialModulation[1];
				
				// Check if the next line already contains a key (e.g., *C:, *a:)
				if (nextLine.match(/^\*(\w+):/)) {
					// Replace existing key definitions with the new key
					const replaced = nextLine
						.split('\t')
						.map((cell, idx) => kernCols[idx] ? `*${newKey}:` : cell.startsWith('*') ? '*' : cell)
						.join('\t');
					output.push(replaced);
					i++; // skip the original line (we replaced it)
				} else {
					// Insert a new *key: line if none exists after *k[
					const newLine = headers.map((h, idx) =>
						kernCols[idx] ? `*${newKey}:` : '*'
					).join('\t');
					output.push(newLine);
				}

				insertedInitial = true; // ensure this happens only once
				continue;
			}

			// Detect measure changes (=N)
			const measureMatch = line.match(/^=(\d+)/);
			if (measureMatch) {
				currentMeasure = parseInt(measureMatch[1], 10);
			}

			// Handle all remaining modulations normally (excluding the initial one)
			if (currentMeasure && line.includes('\t')) {
				const cells = line.split('\t');

				// Collect numeric beat values from **cdata-beat columns
				const beatValues = headers.map((h, idx) =>
					h.startsWith('**cdata-beat') ? cells[idx] : null
				).filter(v => v && v.match(/^\d+(\.\d+)?$/));

				if (beatValues.length > 0) {
					const firstBeat = parseFloat(beatValues[0]);
					
					// Look for a modulation at this measure/beat (excluding the initial one)
					const modulation = remainingModulations.find(([pos]) => {
						const [m, b] = pos.split('/');
						return parseInt(m, 10) === currentMeasure && parseFloat(b) === firstBeat;
					});

					// Insert a *key: line before the first note/rest line of that beat
					if (modulation) {
						const key = modulation[1];
						const newLine = headers.map((h, idx) =>
							kernCols[idx] ? `*${key}:` : '*'
						).join('\t');
						output.push(newLine);
					}
				}
			}

			// Always include the original line
			output.push(line);
		}

		// Combine everything into a single string
		const linesAsString = output.join('\n');

		// Run Humdrum tools:
		// - extractxx removes **cdata-beat columns
		// - ridxx -i cleans redundant interpretations
		const finalResult = execSync(`extractxx -I '**cdata-beat' | ridxx -i`, {
			input: linesAsString,
			encoding: 'utf8'
		}).trim();

		// Write the cleaned result back to the file
		fs.writeFileSync(path.resolve(kernScoresPath, `${filename}.krn`), finalResult, 'utf8');
		console.log(`✔ Added modulations for ${filename}`);
	});
} catch (err) {
	console.error(err);
}
