export class AsyncEvent<T = void> {

	private handlers: ({ fn: (arg: T) => void | Promise<void>, once: boolean})[] = [];

	get listenersCount(): number {
		return this.handlers.length;
	}

	listen(handler: (arg: T) => void | Promise<void>){
		this.handlers.push({fn: handler, once: false});
	}

	listenOnce(handler: (arg: T) => void){
		this.handlers.push({fn: handler, once: true});
	}

	unlisten(handler: (arg: T)  => void){
		this.handlers = this.handlers.filter(x => x.fn !== handler);
	}

	wait(): Promise<T> {
		return new Promise(ok => this.listenOnce(ok));
	}

	async fire(arg: T): Promise<void>{
		// not too optimal here
		let handlers = this.handlers.filter(x => !!x)
		this.handlers = handlers.filter(x => !x.once);
		let errors: Error[] = [];
		for(let handler of handlers){
			try {
				await Promise.resolve(handler?.fn(arg));
			} catch(e){
				errors.push(e);
			}
		}

		switch(errors.length){
			case 0: return;
			case 1: throw errors[0];
			default: throw new Error("Multiple errors were thrown when firing event:\n" + errors.map(x => x.message).join("\n"));
		}
	}

}