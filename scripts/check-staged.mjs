import { execFileSync } from 'node:child_process';
const files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const blocked = [];
for (const file of files) {
  if (/(^|\/)(\.env(?:\..*)?|.*\.db(?:-.*)?|.*\.pem|.*\.key)$/.test(file) && !file.endsWith('.env.example')) { blocked.push(file); continue; }
  let content;
  try { content = execFileSync('git', ['show', ':' + file], { encoding: 'utf8', maxBuffer: 10_000_000 }); } catch { continue; }
  if (/sk-(?:proj-|svcacct-)?[a-zA-Z0-9_-]{24,}/.test(content) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) blocked.push(file);
}
if (blocked.length) { console.error('Unstage private material before committing:\n' + blocked.join('\n')); process.exit(1); }
console.log(`Checked ${files.length} staged paths: no environment secrets, local databases or recognised private-key material found.`);
