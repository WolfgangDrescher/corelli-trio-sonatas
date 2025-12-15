import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, parseDocument, visit } from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.resolve(__dirname, '..');

const yamlOptions = {
	indent: 4,
	lineWidth: 0,
	flowCollectionPadding: false,
	sortMapEntries: (a, b) => {
        return a.key.value.localeCompare(b.key.value);
    },
	defaultStringType: 'PLAIN',
};

function deepNode(doc, flowLevel, value, depth = 0) {
	if (Array.isArray(value)) {
		const seq = doc.createNode([]);
		seq.flow = depth >= flowLevel;
		for (const item of value) {
			seq.add(deepNode(doc, flowLevel, item, depth + 1));
		}
		return seq;
	} else if (value && typeof value === 'object') {
		const map = doc.createNode({});
		for (const [k, v] of Object.entries(value)) {
			map.set(k, deepNode(doc, flowLevel, v, depth + 1));
		}
		return map;
	} else {
		return value;
	}
}

export function toYaml(data, flowLevel = 2) {
    const doc = new Document();
    doc.contents = deepNode(doc, flowLevel, data, 0);
    return doc.toString(yamlOptions);
}

export function mergePieceData(filePath, data) {
		const fileContent = fs.readFileSync(path.resolve(rootPath, filePath), { encoding: 'utf-8'});
		const doc = parseDocument(fileContent);

		Object.entries(data).forEach(([pieceId, value]) => {			
			const existingPair = doc.contents.items.find(item => item.key.value === pieceId);
			if (!existingPair) {
				doc.set(pieceId, deepNode(doc, 1, value));
			} else {
				visit(doc, {
					Pair(index, node) {
						if (node.key && node.key.value === pieceId) {
							node.value = deepNode(doc, 1, value);
							return visit.BREAK;
						}
					},
				});
			}
		});

		fs.writeFileSync(path.resolve(rootPath, filePath), doc.toString(yamlOptions));
}
