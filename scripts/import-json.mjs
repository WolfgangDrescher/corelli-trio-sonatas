import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import yaml from 'js-yaml';
import { mergePieceData } from './utils.mjs';

const inputPath = process.argv[2];
const overwriteFlag = process.argv.includes('--overwrite') || process.argv.includes('-o');

if (!inputPath) {
    console.error('Please provide a file or directory path as argument.');
    process.exit(1);
}

const resolvedPath = path.resolve(inputPath);

if (!fs.existsSync(resolvedPath)) {
	console.error(`${resolvedPath} not found`);
	process.exit(1);
}

const stat = fs.statSync(resolvedPath);

const cadences = {}
const sequences = {}
const modulations = {}

function createMeasureMeterMap(kern) {
	const result = {};
	const stdout = execSync(`lnnr -p | composite | meter -r | extractxx -s 2,3 | ridxx -LGTIglid`, {
		input: kern,
	}).toString().trim();

	const lines = stdout.split('\n');

	let currentMeasure = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (line.startsWith('=')) {
			const measureMatch = line.match(/^=+(\d+)/);
			if (measureMatch) {
				currentMeasure = parseInt(measureMatch[1], 10);
			}
		} else {
			const [meter, lnnr] = line.split('\t');
			result[lnnr] = `${currentMeasure}/${meter.replace('r', '')}`;
		}

	}
	
	return result;
}

function processFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
	const importData = JSON.parse(raw);
	
    try {
		const kern = execSync(`git show ${importData.commitSha}:kern/${importData.pieceId}.krn`).toString().trim();
		const measureMeterMap = createMeasureMeterMap(kern);

		const pieceAnnotations = {
			modulations: [],
			cadences: [],
			sequences: [],
		};
		importData.modulations.forEach(item => {
			const start = measureMeterMap[item.startLine];
			pieceAnnotations.modulations.push([
				start,
				item.key.trim(),
			]);
		});
		importData.cadences.forEach(item => {
			const start = measureMeterMap[item.startLine];
			const end = measureMeterMap[item.endLine];
			pieceAnnotations.cadences.push([
				start,
				end,
				item.tags.map(v => v.trim()),
			]);
		});
		importData.sequences.forEach(item => {
			const start = measureMeterMap[item.startLine];
			const end = measureMeterMap[item.endLine];
			pieceAnnotations.sequences.push([
				start,
				end,
				item.tags.map(v => v.trim()),
			]);
		});
		modulations[importData.pieceId] = pieceAnnotations.modulations;
		cadences[importData.pieceId] = pieceAnnotations.cadences;
		sequences[importData.pieceId] = pieceAnnotations.sequences;
    } catch (err) {
        console.error(err.message);
    }
}

if (stat.isFile()) {
    processFile(resolvedPath);
} else if (stat.isDirectory()) {
    const files = fs.readdirSync(resolvedPath);
    const dezFiles = files.filter((f) => f.endsWith('.json'));
    if (dezFiles.length === 0) {
        console.log('No .json files found in directory.');
        process.exit(0);
    }
    for (const file of dezFiles) {
        const fullPath = path.join(resolvedPath, file);
        processFile(fullPath);
    }
} else {
	console.error('Path is neither a file nor a directory.');
}

if (overwriteFlag) {
	console.log('Overwriting existing YAML files...');
	mergePieceData('modulations.yaml', modulations);
	mergePieceData('cadences.yaml', cadences);
	mergePieceData('sequences.yaml', sequences);
} else {
	console.log('Data not saved into YAML files (use --overwrite or -o to apply changes to YAML files).');
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
