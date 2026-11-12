import ts from "typescript";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const option = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const interfaceFile = option("--interface");
if (!interfaceFile || interfaceFile.startsWith("--")) {
  throw new Error("Supply the reference explicitly: pnpm check:compat --interface /path/to/output-interface.ts [--factory /path/to/output-factory.ts]");
}
const interfacePath = resolve(interfaceFile);
await readFile(interfacePath);
const factoryFile = option("--factory");
const entry = resolve(import.meta.dirname, "../dist/plugin/index.js");
const literal = value => JSON.stringify(value.replaceAll("\\", "/"));
const folder = await mkdtemp(join(tmpdir(), "describe-synth-contract-"));
const check = join(folder, "compatibility.ts");
await writeFile(check, `
import OutputDescribeSynth, { describeSynthPlugin } from ${literal(entry)};
import type { IAudioOutput } from ${literal(interfacePath)};
declare const output: OutputDescribeSynth;
const compatibleOutput: IAudioOutput = output;
${factoryFile ? `import type { OutputFactory } from ${literal(resolve(factoryFile))};
const compatibleFactory: OutputFactory = describeSynthPlugin;` : ""}
`);
const program = ts.createProgram([check], {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
  skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, types: [],
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(interfacePath);
const symbol = source && checker.getSymbolAtLocation(source);
const contract = symbol && checker.getExportsOfModule(symbol).find(item => item.name === "IAudioOutput");
if (!contract || !checker.getDeclaredTypeOfSymbol(contract).getProperty("noteOn")) throw new Error("Reference must export the actual IAudioOutput interface.");
const diagnostics = [
  ...program.getSyntacticDiagnostics(program.getSourceFile(check)),
  ...program.getSemanticDiagnostics(program.getSourceFile(check)),
];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(), getCanonicalFileName: path => path, getNewLine: () => "\n",
  }));
  process.exitCode = 1;
} else console.log("Compatible with the supplied IAudioOutput" + (factoryFile ? " and OutputFactory" : "") + ". Reference checkout was read only.");
