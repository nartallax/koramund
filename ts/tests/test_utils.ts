import * as http from "http";
import {promises as fs} from "fs";
import * as path from "path";
import {Logger} from "logger";

export async function expectError<T>(msg: string | null, action: () => T | Promise<T>): Promise<void>{
	let hadException = false;
	try {
		await Promise.resolve(action());
	} catch(e){
		hadException = true;
		if(msg !== null && e.message !== msg){
			throw new Error(`Expected action to throw error "${msg}", but got "${e.message}" instead.`);
		}
	}

	if(!hadException){
		throw new Error(`Expected action to throw exception, but it did not.`);
	}
}

export async function rmRf(rootPath: string): Promise<void> {
	let stat = await fs.stat(rootPath);
	if(stat.isDirectory()){
		let proms = (await fs.readdir(rootPath)).map(name => {
			return rmRf(path.resolve(rootPath, name));	
		});
		await Promise.all(proms);
		await fs.rmdir(rootPath);
	} else {
		await fs.unlink(rootPath);
	}
}

export async function rmRfIgnoreEnoent(rootPath: string): Promise<void>{
	try {
		await rmRf(rootPath);
	} catch(e){
		if(e.code !== "ENOENT"){
			throw e;
		}
	}
}

export async function mkdirIgnoreEexist(dirPath: string): Promise<void>{
	try {
		await fs.mkdir(dirPath);
	} catch(e){
		if(e.code !== "EEXIST"){
			throw e;
		}
	}
}

export async function copyRecursive(fromPath: string, toPath: string): Promise<void> {
	let stat = await fs.stat(fromPath);
	if(stat.isDirectory()){
		await mkdirIgnoreEexist(toPath);
		let proms = (await fs.readdir(fromPath)).map(name => {
			return copyRecursive(path.resolve(fromPath, name), path.resolve(toPath, name));
		});
		await Promise.all(proms);
	} else {
		await fs.copyFile(fromPath, toPath);
	}
}

export function httpReq(args: {port: number, path?: string, body?: string, method?: string}): Promise<{code: number, body: string}> {
	return new Promise((ok, bad) => {
		let req = http.request({
			host: "localhost",
			port: args.port,
			path: args.path,
			method: args.method || (args.body? "POST": "GET")
		}, resp => {
			let data: Buffer[] = [];
			resp.on("error", bad);
			resp.on("data", chunk => data.push(chunk));
			resp.on("end", () => ok({
				code: resp.statusCode || -1,
				body: Buffer.concat(data).toString("utf-8")
			}))
		});
		
		req.on("error", bad);
		req.end(args.body);
	});

}

export function shouldBeEqual<T>(context: string, ethalon: T, value: T): void {
	if(value !== ethalon){
		throw new Error(`Values of ${context} are not equal: expected ${ethalon}, got ${value}`);
	}
}

export function waitPromiseForLimitedTime<T>(x: T | Promise<T>, timeMs: number, errorMessage?: string): Promise<T>{
	return promiseWithTimeout(x, timeMs, errorMessage, false) as Promise<T>;
}

export async function waitNoResolutionForLimitedTime<T>(x: T | Promise<T>, timeMs: number, errorMessage?: string): Promise<void>{
	await promiseWithTimeout(x, timeMs, errorMessage, true);
}

function promiseWithTimeout<T>(x: T | Promise<T>, timeMs: number, errorMessage?: string, expectNoResolution?: boolean): Promise<T | null>{
	return new Promise((ok, bad) => {
		let completed = false;
		setTimeout(() => {
			if(!completed){
				completed = true;
				if(expectNoResolution){
					ok(null);
				} else {
					bad(new Error(errorMessage || "Timeout"))
				}
			}
		}, timeMs);
		Promise.resolve(x).then(
			result => {
				if(!completed){
					completed = true;
					if(expectNoResolution){
						bad(errorMessage || "Promise resolved, but we expected it not to.")
					} else {
						ok(result);
					}
				}
			},
			e => {
				if(!completed){
					completed = true;
					bad(e)
				}
			}
		);
	});
}

export function waitLine(logger: Logger, regexp: RegExp): Promise<string>{
	return new Promise(ok => {
		let handler = (line: string) => {
			if(line.match(regexp)){
				logger.onLine.unlisten(handler);
				ok(line);
			}
		}
		logger.onLine.listen(handler);
	});
}