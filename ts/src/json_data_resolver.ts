import {JsonDataPath} from "types";
import {promises as fs} from "fs";
import * as path from "path";
import {arrayOfMaybeArray} from "utils";

/** Class that contains utility methods to run json data queries */
export abstract class JsonDataResolver {
	protected abstract readonly workingDirectory: string;

	async runJsonDataPath(jsonDataPath: JsonDataPath): Promise<unknown>{
		let fileContent: string;
		let fullFilePath = path.resolve(this.workingDirectory, jsonDataPath.jsonFilePath)
		try {
			fileContent = await fs.readFile(fullFilePath, "utf8");
		} catch(e){
			throw new Error(`Failed to extract value from JSON file ${fullFilePath}: FS error: ${e.message}`);
		}
	
		let json: unknown;
		try {
			json = JSON.parse(fileContent);
		} catch(e){
			throw new Error(`Failed to extract value from JSON file ${fullFilePath}: JSON parsing error: ${e.message}`);
		}
		let keySequence = typeof(jsonDataPath.keys) === "string"? jsonDataPath.keys.split("."): arrayOfMaybeArray(jsonDataPath.keys);
		for(let part of keySequence){
			if(typeof(json) !== "object" || !json){
				throw new Error(`Failed to extract value from JSON file ${fullFilePath}: failed to follow path part "${part}" (of ${keySequence.map(x => `"${x}"`).join(".")}): previous path part yielded non-object or null value.`);
			}
			json = (json as Record<string, unknown>)[part];
		}
		return json;
	}
	
	async runJsonDataPathForNumber(jsonDataPath: JsonDataPath): Promise<number> {
		let value = await this.runJsonDataPath(jsonDataPath);
		if(typeof(value) === "number"){
			return value;
		}
		
		if(typeof(value) === "string" && value.match(/^\d+$/)){
			return parseInt(value);
		}
	
		throw new Error(`Failed to extract value from JSON file ${path.resolve(this.workingDirectory, jsonDataPath.jsonFilePath)} with in-file path of ${jsonDataPath.keys}: there is ${typeof(value)} (${JSON.stringify(value)}) at this in-file path, and it is not convertible to number.`);
	}
}