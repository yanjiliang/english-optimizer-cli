const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');

// Read current version
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const currentVersion = packageJson.version;

console.log(`\n📦 Current version: ${currentVersion}\n`);

// Get new version from command line argument
const newVersion = process.argv[2];

if (!newVersion) {
  console.log('Usage: npm run version:bump -- <new-version>');
  console.log('Example: npm run version:bump -- 2.0.1');
  console.log('Or use npm semantic versioning (runs lint/test/build via preversion):');
  console.log('  npm run release:patch  (2.0.0 -> 2.0.1)');
  console.log('  npm run release:minor  (2.0.0 -> 2.1.0)');
  console.log('  npm run release:major  (2.0.0 -> 3.0.0)\n');
  process.exit(1);
}

// Validate version format (semver)
const versionRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
if (!versionRegex.test(newVersion)) {
  console.error('❌ Invalid version format. Expected: x.y.z (e.g., 2.0.1)');
  process.exit(1);
}

// Update package.json
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

// Keep package-lock.json in sync if present
const updatedFiles = ['package.json'];
if (fs.existsSync(packageLockPath)) {
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf-8'));
  packageLock.version = newVersion;
  if (packageLock.packages && packageLock.packages['']) {
    packageLock.packages[''].version = newVersion;
  }
  fs.writeFileSync(packageLockPath, JSON.stringify(packageLock, null, 2) + '\n');
  updatedFiles.push('package-lock.json');
}

console.log(`✅ Version updated to ${newVersion} in ${updatedFiles.join(', ')}\n`);
console.log('Next steps:');
console.log('  1. Update CHANGELOG.md with the release notes');
console.log(`  2. git add ${updatedFiles.join(' ')} CHANGELOG.md`);
console.log(`  3. git commit -m "chore(release): bump version to ${newVersion}"`);
console.log(`  4. git tag -a v${newVersion} -m "Release v${newVersion}"`);
console.log('  5. git push && git push --tags');
console.log('  6. npm publish\n');
