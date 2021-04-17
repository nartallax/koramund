import {ToolConfig} from "types";
import {promises as fs} from "fs";
import {errorAndExit, isExternalProgramDefinition, isImploderProjectDef, nameOf} from "utils";
import * as path from "path";

const modeValues = {
	"development": true,
	"build": true,
	"build-all": true
}

const cliDefaults = {
	"mode": "development" as keyof typeof modeValues,
	"config": "",
	"project": "",
	"help": false
}

export type CliOptions = typeof cliDefaults

export type FullToolConfig = ToolConfig & CliOptions;

export async function assembleConfig(args: ReadonlyArray<string> = process.argv.slice(2)): Promise<FullToolConfig>{
	let cliArgs = parseCliArgs(args);
	let cfg = await parseConfig(cliArgs.config);
	return { ...cliArgs, ...cfg };
}

async function parseConfig(cfgPath: string): Promise<ToolConfig> {
	let cfgStr = await fs.readFile(cfgPath, "utf8");
	let cfg: ToolConfig = JSON.parse(cfgStr);

	if(!cfg || typeof(cfg) !== "object" || !Array.isArray(cfg.projects) || cfg.projects.length === 0){
		errorAndExit(`Config (${path.resolve(cfgPath)}) is not valid or empty. Expected config to contain object with "projects" array of project definitions.`);
	}

	fixConfig(cfg, cfgPath)

	return cfg;
}

function fixConfig(cfg: ToolConfig, cfgPath: string): void {
	let cfgDir = path.dirname(cfgPath);
	cfg.projects = cfg.projects.map(def => {
		def = {
			...(cfg.defaultProjectSettings || {}),
			...def
		};

		if(isImploderProjectDef(def)){
			def.imploderProject = path.resolve(cfgDir, def.imploderProject);
			if(def.workingDirectory){
				def.workingDirectory = path.resolve(cfgDir, def.workingDirectory);
			} else {
				def.workingDirectory = path.dirname(def.imploderProject);
			}
		} else if(isExternalProgramDefinition(def)) {
			def.workingDirectory = path.resolve(cfgDir, def.workingDirectory || ".")
		} else {
			errorAndExit("Project definition is malformed: could not understand its type. Definition is " + JSON.stringify(def));
		}

		if(!def.name){
			def.name = path.basename(def.workingDirectory);
		}

		return def;
	});
}

function parseCliArgs(args: ReadonlyArray<string>): CliOptions {
	let result: CliOptions = {...cliDefaults};

	for(let i = 0; i < args.length; i++){
		let v = args[i];
		if(!v.startsWith("--")){
			errorAndExit(`Failed to parse command-line arguments: "${v}" is not known argument.`);
		}

		let k = v.substr(2) as keyof(typeof cliDefaults);
		if(!(k in cliDefaults)){
			errorAndExit(`Failed to parse command-line arguments: "${v}" is not known argument.`);
		}

		let argType = typeof(cliDefaults[k]);
		if(argType === "string"/* || argType === "number"*/){
			if(i === args.length - 1){
				errorAndExit(`Failed to parse command-line arguments: expected value after "${v}".`);
			}

			i++;
			let argValue = args[i];

			/*
			if(argType === "number"){
				let numValue = parseFloat(argValue);
				if(Number.isNaN(numValue)){
					errorAndExit(`Failed to parse command-line arguments: expected numeric value after "${v}".`);
				}
				(result[k] as number) = numValue;
			} else {
				(result[k] as string) = argValue;
			}
			*/

			(result[k] as string) = argValue;

		} else if(typeof(cliDefaults[k]) === "boolean") {
			(result[k] as boolean) = true;
		} else {
			errorAndExit(`Failed to parse command-line arguments: bad default config value, contact the developer about this error.`);
		}
	}
	
	validateCliArgs(result);

	return result;
}

function validateCliArgs(args: CliOptions){
	if(!args.mode){
		errorAndExit(`Failed to parse command-line arguments: "--${nameOf<CliOptions>("mode")}" is not present.`);
	}

	if(!(args.mode in modeValues)){
		errorAndExit(`Failed to parse command-line arguments: "${args.mode}" is not valid value of mode.`);
	}

	if(!args.config){
		errorAndExit(`Failed to parse command-line arguments: "--${nameOf<CliOptions>("config")}" is not present.`);
	}

	if(args.mode === "build" && !args.project){
		errorAndExit(`Failed to parse command-line arguments: mode "${args.mode}" requires project name to be passed.`);
	}
}