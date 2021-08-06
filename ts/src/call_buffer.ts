/** A buffer for case when multiple invocations of single asyncronously acquiring value could happen
 * Enforces that one or none calls will happen at all */
export class CallBuffer<T> {

	private value: T | null = null;
	private acquired = false;
	private acquiringInProgress = false;
	private promises: {ok: (value: T) => void, bad: (err: Error) => void}[] = [];

	constructor(private readonly doGet: () => Promise<T>){}

	isWorking(): boolean {
		return this.acquiringInProgress;
	}

	hasValue(): boolean {
		return this.acquired;
	}

	getValueOrNull(): T | null {
		return this.acquired? this.value as T: null;
	}

	getValue(): T {
		if(!this.acquired){
			throw new Error("Could not get value: it's not acquired yet.");
		}
		return this.value as T
	}

	get(): Promise<T>{
		if(this.acquired){
			return Promise.resolve(this.value as T);
		}

		let prom = new Promise<T>((ok, bad) => this.promises.push({ok, bad}))
		if(!this.acquiringInProgress){
			this.acquiringInProgress = true;
			this.doGet().then(
				value => {
					this.acquiringInProgress = false;
					this.value = value;
					this.acquired = true;
					for(let i = 0; i < this.promises.length; i++){
						this.promises[i].ok(value);
					}
					this.promises = [];
				},
				err => {
					this.acquiringInProgress = false;
					for(let i = 0; i < this.promises.length; i++){
						this.promises[i].bad(err);
					}
					this.promises = [];
				}
			)
		}
		
		return prom;
	}

}