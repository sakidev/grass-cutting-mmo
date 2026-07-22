const fs = require('fs');
const obfuscator = require('javascript-obfuscator');

console.log("Working dir: ", __dirname);

const config = JSON.parse(fs.readFileSync(__dirname + "/config.json", 'utf-8'));

const OBFUSCATE = config.obfuscate;

const srcPath = __dirname.replace('compiler', '') + config.srcPath;
console.log("> Defined source path: ", srcPath);

const compileFileNames = fs.readdirSync(srcPath);
console.log("=== Compile file names ===");
console.log(">", compileFileNames);

let bundle = "";
console.log("=== Bundling ===");

const scriptOrder = config.scriptsOrder;
const scripts = [];

for(let i = 0; i < compileFileNames.length;i++){
    process.stdout.write("\n> " + srcPath + compileFileNames[i]);
    const fileData = fs.readFileSync(srcPath + compileFileNames[i], 'utf-8');

    // Strip import/export statements so they're only used for IntelliSense
    const cleaned = fileData
        .replace(/^\s*import\s+.*?;?\s*$/gm, '')
        .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, '')
        .replace(/^\s*export\s+(const|let|var|function|class)\s/gm, '$1 ');

    // Write to correct order
    const idxInScriptsOrder = scriptOrder.indexOf(compileFileNames[i]);
    scripts[idxInScriptsOrder] = cleaned;
    process.stdout.write(" ..DONE!");
}

// Write all scripts after they've been read & ordered
bundle += "const PRODUCTION = " + (config.production ? "true" : "false") + ";\n";
bundle += "window.PRODUCTION = PRODUCTION;\n";
bundle += "const VERSION = '" + config.version + "';\n";
bundle += "window.VERSION = VERSION;\n";
for(let i = 0; i < scripts.length;i++){
    bundle += scripts[i];
}

let obfuscated;
if(OBFUSCATE){
    console.log("\n=== Obfuscating ===");
    
    obfuscated = obfuscator.obfuscate(bundle, {
        stringArray: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayThreshold: 0.75,
        stringArrayIndexShift: true,
        compact: true,
        simplify: true,
        renameGlobals: true,
        identifierNamesGenerator: 'hexadecimal',
        target: 'browser',
        stringArrayWrappersCount: 1,
        stringArrayWrappersType: 'variable',
        stringArrayWrappersChainedCalls: true
    }).toString();
}

// Organize file names by script order

console.log("\n> Bundle length: ", bundle.length);

const outDir = __dirname.replace('compiler', '') + config.outDir;
process.stdout.write("\n> Writing...");

fs.writeFileSync(outDir + "client-" + config.version + ".js", OBFUSCATE ? obfuscated : bundle);
process.stdout.write(" DONE!");

console.log("\nAll finished.");