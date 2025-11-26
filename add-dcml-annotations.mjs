import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FORCE_DOWNLOAD = process.argv.includes('--force-download');
const CACHE_DIR = path.resolve('./dcml-annotations');
const SCORES_DIR = path.resolve('./annotated-kern');

const notesList = 'https://api.github.com/repos/DCMLab/corelli/contents/reviewed';

if (FORCE_DOWNLOAD) {
	if (fs.existsSync(CACHE_DIR)) {
        fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    }
}

if (fs.existsSync(SCORES_DIR)) {
	fs.rmSync(SCORES_DIR, { recursive: true, force: true });
}

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}
if (!fs.existsSync(SCORES_DIR)) {
    fs.mkdirSync(SCORES_DIR, { recursive: true });
}


function readTSV(tsv) {
    const lines = tsv.trim().split("\n");
    const headers = lines[0].split("\t");

    const rows = lines.slice(1).map(line => {
        const cols = line.split("\t");
        const obj = {};
        headers.forEach((header, i) => {
            obj[header] = cols[i];
        });
        return obj;
    });

    return rows;
}

try {
	const notesListResponse = await fetch(notesList);
	if (!notesListResponse.ok) throw new Error(`GitHub API error: ${notesListResponse.status}`);
	const notesListJson = await notesListResponse.json();
	const downloadUrlMap = Object.fromEntries(notesListJson.map(item => [item.name.replace('_reviewed.tsv', ''), item.download_url]));

	const files = fs.readdirSync('./kern').filter(f => f.endsWith('.krn'));

	for (const filename of files) {
		const id = filename.replace('.krn', '');

		
		const cacheFile = path.join(CACHE_DIR, `${id}_reviewed.tsv`);

		let notesBody;

		// If cached and not forcing: use the cached file
		if (fs.existsSync(cacheFile) && !FORCE_DOWNLOAD) {
			console.log(`Using cached ${id}_reviewed.tsv`);
			notesBody = fs.readFileSync(cacheFile, 'utf-8');
		} else {
			console.log(`Downloading ${id}_reviewed.tsv…`);
			const notesResponse = await fetch(downloadUrlMap[id]);
			if (!notesResponse.ok) {
				throw new Error(`GitHub API error: ${notesResponse.status}`);
			}
			notesBody = await notesResponse.text();
			fs.writeFileSync(cacheFile, notesBody);
		}

		const notes = readTSV(notesBody);
		const dcmlLabelMap = Object.fromEntries(notes.map(row => {
			const [nominator, denominator] =  row.mn_onset.split('/').map(v => parseInt(v, 10));
			let meter = 0;
			if (nominator && denominator) {
				meter = nominator / (denominator / 4);
			}
			return [
			`${row.mn}/${meter}`,
			row.label,
		]
		}));

		const kernScore = fs.readFileSync(`./kern/${filename}`, 'utf-8');
		
		const meterKernScore = execSync(`meter -zfr`, {
			input: kernScore,
		}).toString().trim();

		const headerLine = meterKernScore.split('\n').find(l => l.startsWith('**'));
		const headers = headerLine.split('\t');
		const meterSpines = headers.map((h, i) => {
			return h.startsWith('**cdata-beat') ? i : -1;
		}).filter(i => i !== -1);
		const kernSpines = headers.map((h, i) => {
			return h.startsWith('**kern') ? i : -1;
		}).filter(i => i !== -1);

		const meterKernScoreLines = meterKernScore.split('\n');

		let currentMeasure = null;
		let currentMeter = null;
		let aboveAdded = false;

		const output = [];

		for (let i = 0; i < meterKernScoreLines.length; i++) {
			const line = meterKernScoreLines[i];
			const tokens = line.split('\t');

			// Detect current measure number (=N)
			if (line.startsWith('=')) {
				const measureMatch = line.match(/^=(\d+)/);
				if (measureMatch) {
					currentMeasure = parseInt(measureMatch[1], 10);
				}
			}

			// Detect current beat (meter)
			if (!line.startsWith('*') && !line.startsWith('!') && !line.startsWith('=')) {
				for (const spineIndex of meterSpines) {
					const value = tokens[spineIndex];
					if (value && value !== '.' && value !== '.:.') {
						currentMeter = value;
						break;
					}
				}
			}
			
			const firstKernIndex = kernSpines[0];
			const columns = line.split('\t');
			let valueToInsert;

			if (line.startsWith('**')) {
				valueToInsert = '**harm';
			} else if (line.startsWith('*-')) {
				valueToInsert = '*-';
			} else if (line.startsWith('*')) {
				if (aboveAdded) {
					valueToInsert = '*';
				} else {
					valueToInsert = '*above';
					aboveAdded = true;
				}
			} else if (line.startsWith('!!!')) {
				valueToInsert = null; 
			} else if (line.startsWith('!')) {
				valueToInsert = '!';
			} else if (line.startsWith('=')) {
				valueToInsert = line.split('\t')[0];
			} else {
				const dcmlLabel = dcmlLabelMap[`${currentMeasure}/${currentMeter}`];
				valueToInsert = dcmlLabel ?? '.';
			}

			// insert new value right after the first **kern column
			if (valueToInsert !== null) {
				columns.splice(firstKernIndex + 1, 0, valueToInsert);
			}

			const newline = columns.join('\t');

			output.push(newline);
		}

		const newScore = execSync('extractxx -I "**cdata-beat" | ridxx -gild', {
			input: output.join('\n'),
		}).toString().trim();

		fs.writeFileSync(path.join(SCORES_DIR, filename), newScore);

		console.log(`✔ Added DCML annotation kern for ${id}`);
	}
} catch (err) {
	console.error(err);
}
