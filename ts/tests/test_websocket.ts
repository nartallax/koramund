import {test} from "@nartallax/clamsensor"
import {sleep, testPath, withTestProjectCopy} from "tests/test_utils"
import * as Ws from "ws"

test("websocket", assert => withTestProjectCopy(async controller => {

	async function doConnect(): Promise<Ws> {
		return new Promise((ok, bad) => {
			let socket = new Ws(`ws://localhost:${port}`, {timeout: 250})

			let connected = false

			socket.on("error", err => {
				if(!connected){
					console.error("Websocket connection failed: " + err)
					bad(err)
				}
			})

			socket.on("open", async() => {
				connected = true
				ok(socket)
			})
		})
	}

	async function makeConnection(): Promise<void> {
		let onConnStart = app.onWebsocketConnectStarted.wait()
		let onConn = app.onWebsocketConnected.wait()
		let connPromise = doConnect()
		await assert(onConnStart).fasterThan(500)
		await assert(onConn).fasterThan(500)
		socket = await assert(connPromise).fasterThan(500)
	}

	function dataToStr(data: Ws.Data): string {
		if(typeof(data) === "string"){
			return data
		}

		if(Array.isArray(data)){
			return Buffer.concat(data).toString("utf-8")
		}

		if(data instanceof Buffer){
			return data.toString("utf-8")
		}

		if(data instanceof ArrayBuffer){
			return Buffer.from(data).toString("utf-8")
		}

		throw new Error("This data is in unexpected format.")
	}

	function exchangeMessages(outData: unknown): Promise<unknown> {
		return new Promise((ok, bad) => {
			function onMsg(msg: Ws.Data): void {
				clear()
				ok(JSON.parse(dataToStr(msg)))
			}

			function onError(err: Error): void {
				clear()
				bad(err)
			}

			function onClose(): void {
				clear()
				bad(new Error("No connection"))
			}

			function clear() {
				socket.off("message", onMsg)
				socket.off("error", onError)
				socket.off("close", onClose)
			}

			if(socket.readyState === Ws.CLOSED){
				bad(new Error("No connection"))
			}

			socket.on("message", onMsg)
			socket.on("error", onError)
			socket.on("close", onClose)
			socket.send(JSON.stringify(outData))
		})
	}

	async function disconnect(): Promise<void> {
		let disconnPromise = app.onWebsocketDisconnected.wait()
		socket.close()
		await assert(disconnPromise).fasterThan(500)
	}

	let port = 7633
	let socket = null as unknown as Ws

	let app = controller.addProject({
		name: "Websock",
		getLaunchCommand: () => [controller.nodeEnv.nodeExecutablePath, testPath("./websock.js")],
		proxyHttpPort: port,
		proxyTimeout: 3000
	})
	app.onStderr(line => {
		let portMatch = line.match(/Started on (\d+)/)
		if(portMatch){
			app.notifyProjectHttpPort(parseInt(portMatch[1]))
			app.notifyLaunched()
		}
	})

	app.onWebsocketMessage(async msg => {
		if(msg.from === "client" && JSON.parse(dataToStr(msg.data)).doRestart){
			await app.restart()
		}
	})

	assert(app.process.state).equalsTo("stopped")
	await assert(app.start()).fasterThan(500)
	assert(app.process.state).equalsTo("running")

	{ // basic test, nothing special
		await makeConnection()
		assert(await exchangeMessages({a: 5, b: 10})).equalsTo({result: 15, isOk: true})
		assert(await exchangeMessages({a: "cats say: ", b: "nya!"})).equalsTo({result: "cats say: nya!", isOk: true})
		await disconnect()
	}

	{ // socket behavior on process not launched
		await app.stop()
		assert(app.process.state).equalsTo("stopped")
		await makeConnection()
		assert(app.process.state).equalsTo("running")
		assert(await exchangeMessages({a: 5, b: 10})).equalsTo({result: 15, isOk: true})
		await disconnect()
	}

	{ // message handlers are working
		await makeConnection()
		let startPromise = app.onStarted.wait()
		assert(exchangeMessages({a: 5, b: 10, doRestart: true})).throws("No connection")
		await assert(startPromise).fasterThan(1000)
	}

	await sleep(1000)
}))