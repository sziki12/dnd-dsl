const fs = require('fs/promises');
const path = require('path');

async function copyFiles(src, dest) {
  try {
    // 'recursive: true' ensures folders and subfolders are copied
    // 'force: true' overwrites existing files in the destination
    await fs.cp(src, dest, { recursive: true, force: true });
    console.log(`✅ Successfully copied from ${src} to ${dest}`);
  } catch (err) {
    console.error(`❌ Error copying files: ${err.message}`);
    process.exit(1);
  }
}

// Paths
const languageSource = path.join(__dirname, 'packages/language/src');
const cliSource = path.join(__dirname, 'packages/cli/src');
//const frontendDestinationDir = path.join('../');
const backendLanguageDest = path.resolve(__dirname, '../dnd-dsl-backend/src/dnd-language/language/src');
const backendCliDest = path.resolve(__dirname, '../dnd-dsl-backend/src/dnd-language/cli/src');

//Function calls
async function run() {
  console.log('🚀 Starting sync...');
  await copyFiles(languageSource, backendLanguageDest);
  await copyFiles(cliSource, backendCliDest);
  console.log('✨ All sync tasks complete.');
}

run();
