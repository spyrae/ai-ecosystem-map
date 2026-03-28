'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Generate self-contained HTML with embedded data
 */
function generateHtml(data, serveMode = false) {
  const templatePath = path.join(__dirname, '..', 'template', 'index.html');
  let template = fs.readFileSync(templatePath, 'utf-8');

  // Inject data and mode
  const dataJson = JSON.stringify(data, null, 0);
  template = template.replace('/*__DATA_PLACEHOLDER__*/',
    `const DATA = ${dataJson};\nconst SERVE_MODE = ${serveMode};`
  );

  return template;
}

module.exports = { generateHtml };
