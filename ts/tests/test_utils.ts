import * as Http from "http"
import {promises as Fs} from "fs"
import * as Path from "path"
import {Logger} from "logger"
import {Koramund} from "koramund"
import {errMessage} from "utils"

export async function expectError<T>(msg: string | null, action: () => T | Promise<T>): Promise<void> {
	let hadException = false
	try {
		await Promise.resolve(action())
	} catch(e){
		hadException = true
		let errMsg = errMessage(e)
		if(msg !== null && errMsg !== msg){
			throw new Error(`Expected action to throw error "${msg}", but got "${errMsg}" instead.`)
		}
	}

	if(!hadException){
		throw new Error("Expected action to throw exception, but it did not.")
	}
}

export async function sleep(timeMs: number): Promise<void> {
	return new Promise(ok => setTimeout(ok, timeMs))
}

async function rmRf(rootPath: string): Promise<void> {
	let stat = await Fs.stat(rootPath)
	if(stat.isDirectory()){
		let proms = (await Fs.readdir(rootPath)).map(name => {
			return rmRf(Path.resolve(rootPath, name))
		})
		await Promise.all(proms)
		await Fs.rmdir(rootPath)
	} else {
		await Fs.unlink(rootPath)
	}
}

async function rmRfIgnoreEnoent(rootPath: string): Promise<void> {
	try {
		await rmRf(rootPath)
	} catch(e){
		if((e as Error & {code: string}).code !== "ENOENT"){
			throw e
		}
	}
}

async function mkdirIgnoreEexist(dirPath: string): Promise<void> {
	try {
		await Fs.mkdir(dirPath)
	} catch(e){
		if((e as Error & {code: string}).code !== "EEXIST"){
			throw e
		}
	}
}

async function copyRecursive(fromPath: string, toPath: string): Promise<void> {
	let stat = await Fs.stat(fromPath)
	if(stat.isDirectory()){
		await mkdirIgnoreEexist(toPath)
		let proms = (await Fs.readdir(fromPath)).map(name => {
			return copyRecursive(Path.resolve(fromPath, name), Path.resolve(toPath, name))
		})
		await Promise.all(proms)
	} else {
		await Fs.copyFile(fromPath, toPath)
	}
}

export function httpReq(args: {port: number, path?: string, body?: string, method?: string}): Promise<{code: number, body: string}> {
	return new Promise((ok, bad) => {
		let req = Http.request({
			host: "localhost",
			port: args.port,
			path: args.path,
			method: args.method || (args.body ? "POST" : "GET")
		}, resp => {
			let data: Buffer[] = []
			resp.on("error", err => {
				bad(err)
			})
			resp.on("data", chunk => data.push(chunk))
			resp.on("end", () => {
				ok({
					code: resp.statusCode || -1,
					body: Buffer.concat(data).toString("utf-8")
				})
			})
		})

		req.on("error", bad)
		req.end(args.body)
	})

}

export function waitLoggerLine(logger: Koramund.Logger, regexp: RegExp): Promise<string> {
	if(!(logger instanceof Logger)){
		throw new Error("WUT")
	}
	return new Promise(ok => {
		let handler = (line: Koramund.LoggingLineOptions) => {
			if(line.message.match(regexp)){
				logger.onLine.detach(handler)
				ok(line.message)
			}
		}
		logger.onLine(handler)
	})
}

export const testProjectsDirectory = "./test_projects_temp_dir_for_tests"

export function testPath(subpath: string): string {
	return Path.resolve(testProjectsDirectory, subpath)
}

export async function withTestProjectCopy<T>(action: (controller: Koramund.ProjectController) => T | Promise<T>): Promise<T> {
	await rmRfIgnoreEnoent(testProjectsDirectory)
	await copyRecursive("./test_projects", testProjectsDirectory)
	let controller = await Koramund.create({
		log: opts => {
			console.error(`${opts.paddedProjectName} | ${opts.message}`)
		}
	})

	try {
		return await Promise.resolve(action(controller))
	} finally {
		await controller.shutdown()
		await rmRfIgnoreEnoent(testProjectsDirectory)
	}
}