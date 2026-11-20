import { lintPlaces } from '../src/places/index.js';

const findings = lintPlaces(new Date().toISOString().slice(0, 10));
for (const finding of findings) console.log(finding);
if (findings.length) process.exitCode = 1;
