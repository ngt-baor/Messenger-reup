const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function getButtonContent(id) {
  const match = html.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/button>`));
  assert.ok(match, `missing service button ${id}`);
  return match[0];
}

for (const service of ['messenger', 'discord']) {
  const button = getButtonContent(`btn-service-${service}`);
  assert.match(button, new RegExp(`aria-label="${service === 'messenger' ? 'Messenger' : 'Discord'}"`));

  for (const theme of ['dark', 'light']) {
    const file = `${service}-${theme}.svg`;
    const color = theme === 'dark' ? 'white' : 'black';
    assert.match(button, new RegExp(`<img class="service-icon service-icon-${theme}" src="assets/service-icons/${file}" alt="" aria-hidden="true">`));
    assert.match(fs.readFileSync(path.join(root, 'assets', 'service-icons', file), 'utf8'), new RegExp(`<path[^>]*fill="${color}"`));
  }
}

assert.ok(packageJson.build.files.includes('assets/service-icons/*.svg'));
assert.match(html, /\.service-btn \.service-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/);
assert.match(html, /\.service-btn \.service-icon-light\s*\{\s*display:\s*none;\s*\}/);
assert.match(html, /body\.light-mode \.service-btn \.service-icon-dark\s*\{\s*display:\s*none;\s*\}/);
assert.match(html, /body\.light-mode \.service-btn \.service-icon-light\s*\{\s*display:\s*block;\s*\}/);

console.log('Service switch uses fixed black and white SVG assets in both themes.');
