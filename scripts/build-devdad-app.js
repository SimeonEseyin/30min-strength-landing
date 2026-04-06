const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const repoRoot = path.resolve(__dirname, '..');
const sourceHtmlPath = path.join(repoRoot, 'devdad-app-v2-enhanced.html');
const outputHtmlPath = path.join(repoRoot, 'devdad-app.html');
const assetDir = path.join(repoRoot, 'assets');
const outputJsPath = path.join(assetDir, 'devdad-app.js');
const outputCssPath = path.join(assetDir, 'devdad-app.css');
const tailwindInputPath = path.join(repoRoot, 'styles', 'devdad-app-tailwind.css');

function removeRequiredBlock(source, pattern, label) {
  const nextSource = source.replace(pattern, '');
  if (nextSource === source) {
    throw new Error(`Unable to find ${label} in ${path.basename(sourceHtmlPath)}`);
  }
  return nextSource;
}

function insertBefore(source, marker, injection, label) {
  const index = source.indexOf(marker);
  if (index === -1) {
    throw new Error(`Unable to find ${label} in ${path.basename(sourceHtmlPath)}`);
  }
  return `${source.slice(0, index)}${injection}${source.slice(index)}`;
}

async function buildJavascript(jsxSource) {
  const bundledEntry = `
import React from 'react';
import ReactDOM from 'react-dom';

${jsxSource.trim()}
`.trim();

  await esbuild.build({
    bundle: true,
    format: 'iife',
    globalName: 'DevDadApp',
    minify: true,
    outfile: outputJsPath,
    platform: 'browser',
    target: ['es2018'],
    loader: {
      '.js': 'jsx',
    },
    stdin: {
      contents: bundledEntry,
      loader: 'jsx',
      resolveDir: repoRoot,
      sourcefile: 'devdad-app.entry.jsx',
    },
  });
}

function buildStyles() {
  execFileSync(
    path.join(repoRoot, 'node_modules', '.bin', 'tailwindcss'),
    [
      '-i',
      tailwindInputPath,
      '-o',
      outputCssPath,
      '--content',
      sourceHtmlPath,
      '--minify',
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
    }
  );
}

function buildHtml(sourceHtml) {
  let outputHtml = sourceHtml;
  outputHtml = removeRequiredBlock(
    outputHtml,
    /\s*<!-- Tailwind CSS -->\s*<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*/,
    'Tailwind CDN block'
  );
  outputHtml = removeRequiredBlock(
    outputHtml,
    /\s*<!-- React and ReactDOM - MUST load before Babel script -->[\s\S]*?<script src="https:\/\/unpkg\.com\/@babel\/standalone\/babel\.min\.js"><\/script>\s*/,
    'React and Babel CDN scripts'
  );
  outputHtml = removeRequiredBlock(
    outputHtml,
    /\s*<script type="text\/babel">[\s\S]*?<\/script>\s*/,
    'inline Babel application script'
  );

  if (!/rel="icon"/.test(outputHtml)) {
    outputHtml = insertBefore(
      outputHtml,
      '</head>',
      '  <link rel="icon" href="/icons/favicon.ico" sizes="any">\n',
      '</head>'
    );
  }

  outputHtml = insertBefore(
    outputHtml,
    '</head>',
    '\n  <link rel="stylesheet" href="/assets/devdad-app.css">\n',
    '</head>'
  );
  outputHtml = insertBefore(
    outputHtml,
    '</body>',
    '\n  <script defer src="/assets/devdad-app.js"></script>\n',
    '</body>'
  );

  fs.writeFileSync(outputHtmlPath, outputHtml);
}

async function main() {
  const sourceHtml = fs.readFileSync(sourceHtmlPath, 'utf8');
  const scriptMatch = sourceHtml.match(/<script type="text\/babel">([\s\S]*?)<\/script>\s*<\/body>/);
  if (!scriptMatch) {
    throw new Error(`Unable to extract the inline application script from ${path.basename(sourceHtmlPath)}`);
  }

  fs.mkdirSync(assetDir, { recursive: true });
  await buildJavascript(scriptMatch[1]);
  buildStyles();
  buildHtml(sourceHtml);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
