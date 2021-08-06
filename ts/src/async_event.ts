import {Koramund} from "types";

export interface AsyncEvent<T = void> extends Koramund.AsyncEvent<T>{
	listen(handler: (value: T) => void | Promise<void>): void;
	fire(value: T): Promise<void>;
	throw(error: Error): void;
}

export function makeAsyncEvent<T = void>(): AsyncEvent<T>{
	let handlers: ({ 
		fn: (arg: T) => void | Promise<void>, 
		onErr?: (err: Error) => void,
		once: boolean
	})[] = []

	let result = function(handler: (arg: T) => void | Promise<void>): void{
		event.listen(handler);
	}

	let event = result as unknown as AsyncEvent<T>;

	Object.defineProperty(event, "listenersCount", {
		get: () => handlers.length
	});

	event.listen = (handler: (arg: T) => void | Promise<void>): void => {
		handlers.push({fn: handler, once: false});
	}

	event.once = (handler: (arg: T) => void | Promise<void>): void => {
		handlers.push({fn: handler, once: true});
	}

	event.detach = (handler: (arg: T)  => void): void => {
		handlers = handlers.filter(x => x.fn !== handler);
	}

	event.wait = (): Promise<T> => {
		return new Promise<T>((ok, bad) => {
			handlers.push({fn: ok, once: true, onErr: bad})
		});
	}

	event.fire = async (arg: T): Promise<void> => {
		// not too optimal here
		let curHandlers = [...handlers];
		handlers = curHandlers.filter(x => !x.once);
		let errors: Error[] = [];
		for(let handler of curHandlers){
			try {
				await Promise.resolve(handler.fn(arg));
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

	event.throw = (err: Error): void => {
		// not too optimal here
		let errHandlers = handlers.filter(x => !!x.onErr)
		handlers = handlers.filter(x => !x.once || !x.onErr);

		errHandlers.forEach(errHandler => {
			errHandler.onErr && errHandler.onErr(err);
		});
	}

	return event
}