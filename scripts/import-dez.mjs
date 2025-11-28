import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const kernScoresPath = path.resolve(__dirname, '..', 'kern');

const inputPath = process.argv[2];

if (!inputPath) {
    console.error('Please provide a file or directory path as argument.');
    process.exit(1);
}

const resolvedPath = path.resolve(__dirname, inputPath);
const stat = fs.statSync(resolvedPath);

function getIdFromFilename(path) {
    return path.split(/[\\\/]/).pop().replace(/\..+$/, '');
}

const cadences = {}
const sequences = {}
const modulations = {}

function createMeasureMeterMap(kernPath) {
	const result = {};
	const raw = fs.readFileSync(kernPath, 'utf8');
	const stdout = execSync(`composite | extractxx -i '**kern-comp' | beatx -c | meter | extractxx -I '**kern-comp' | ridxx -LGTIglid`, {
		input: raw,
	}).toString().trim();
	
	const lines = stdout.split('\n');

	let currentMeasure = '0';

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (line.startsWith('=')) {
			const measureMatch = line.match(/^=(\d+)/);
			if (measureMatch) {
				currentMeasure = parseInt(measureMatch[1], 10);
			}
		} else {
			const [meter, beat] = line.split('\t');
			result[beat] = `${currentMeasure}/${meter}`;
		}

	}
	
	return result;
}

function convertBeatToMeasuerMeter(beat) {
	return '1/1';
}

function processFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
	const id = getIdFromFilename(filePath);
	const kernFilePath = path.resolve(kernScoresPath, `${id}.krn`);

	if (!fs.existsSync(kernFilePath)) {
		console.error(`${kernFilePath} not found: rename .dez file with the piece id as filename`);
		return;
	}

	const measureMeterMap = createMeasureMeterMap(kernFilePath);

    try {
        const dez = JSON.parse(raw);
		const pieceAnnotations = {
			modulations: [],
			cadences: [],
			sequences: [],
		};
		dez.labels?.forEach(item => {
			const start = measureMeterMap[item.start ?? 0];
			const end = measureMeterMap[(item.start ?? 0) + (item.duration?? 0)];
			if (item.type === 'Key') {
				const keyMatch = item.tag.match(/[A-Ha-h\#\-]+/);
				if (!keyMatch) {
					console.warn(`${item.tag} does not match a key in ${filePath}`);
				}
				pieceAnnotations.modulations.push([start, item.tag]);
			} else if (item.type === 'Cadence') {
				const tags = item.tag.split(',').map(v => v.trim());
				pieceAnnotations.cadences.push([start, end, tags]);
			} else if (item.type === 'Harmonic sequence') {
				const tags = item.tag.split(',').map(v => v.trim());
				pieceAnnotations.sequences.push([start, end, tags]);
			}
		});
		modulations[id] = pieceAnnotations.modulations;
		cadences[id] = pieceAnnotations.cadences;
		sequences[id] = pieceAnnotations.sequences;
    } catch (err) {
        console.error(err.message);
    }
}

if (stat.isFile()) {
    processFile(resolvedPath);
} else if (stat.isDirectory()) {
    const files = fs.readdirSync(resolvedPath);
    const dezFiles = files.filter((f) => f.endsWith('.dez'));
    if (dezFiles.length === 0) {
        console.log('No .dez files found in directory.');
        process.exit(0);
    }
    for (const file of dezFiles) {
        const fullPath = path.join(resolvedPath, file);
        processFile(fullPath);
    }
} else {
	console.error('Path is neither a file nor a directory.');
}

// process.exit(0)

console.log('');
console.log('Add to modulations.yaml:');
console.log('========================');
console.log('');
console.log(yaml.dump(modulations, {
	indent: 4,
    lineWidth: -1,
    sortKeys: true,
    flowLevel: 2,
}));
console.log('');

console.log('Add to cadences.yaml:');
console.log('=====================');
console.log('');
console.log(yaml.dump(cadences, {
	indent: 4,
    lineWidth: -1,
    sortKeys: true,
    flowLevel: 2,
}));
console.log('');

console.log('Add to sequences.yaml:');
console.log('======================');
console.log('');
console.log(yaml.dump(sequences, {
	indent: 4,
    lineWidth: -1,
    sortKeys: true,
    flowLevel: 2,
}));

process.exit(1);
