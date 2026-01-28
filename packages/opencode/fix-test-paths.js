const fs = require('fs');
const filePath = 'test/snapshot/snapshot.test.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Replace: toContain(`${...}...`) -> toContain(n(`${...}...`))
// But skip already-wrapped ones
const regex = /toContain\((?!n\()(`\$\{[^`]+`)\)/g;
content = content.replace(regex, 'toContain(n($1))');

fs.writeFileSync(filePath, content);
console.log('Replacements done');
