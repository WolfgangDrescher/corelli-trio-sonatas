import fs from 'node:fs';

const fixes = {
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
};

try {
	const files = fs.readdirSync('./kern').filter(f => f.endsWith('.krn'));

	for (const filename of files) {

		const id = filename.replace('.krn', '');
		const fileFixes = fixes[id] || [];
		if(fileFixes.length) {
			const path = `./kern/${filename}`;
			const result = fs.readFileSync(path, 'utf8').trim();
			const lines = result.split('\n');
	
	
			const output = [];
			let currentMeasure = 0;
	
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];

	
				// Track measure number
				let newOmdRecord = null;
				if (line.startsWith('=')) {
					const m = line.match(/^=(\d+)/);
					if (m) currentMeasure = parseInt(m[1]);
					fileFixes.forEach(([measure, tempo]) => {
						if (measure === currentMeasure) {
							newOmdRecord = `!!!OMD: ${tempo}`;
						}
					});
				}

				// if (line.startsWith('!!!OMD:')) {
				// 	const [, tempo] = fileFixes.find(([measure]) => measure === 0);
				// 	newOmdRecord = `!!!OMD: ${tempo}`;
				// }
				output.push(line);
				if (newOmdRecord) {
					output.push(newOmdRecord);
				}
			}
	
			// Write back to the same file
			fs.writeFileSync(path, output.join('\n'), 'utf8');
			console.log(`✔ Fixed movement designations (OMD) for ${filename}`);
		}
	}
} catch (err) {
	console.error(err);
}
