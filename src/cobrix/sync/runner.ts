/**
 * Launches runs in the background and broadcasts their progress to whoever listens (the panel,
 * through Server-Sent Events). The run itself never depends on a listener being connected.
 */

import { runImport } from './import.ts'
import { runPaid } from './paid.ts'
import type { Progress, RunKind, RunOutcome, SyncDeps } from './runs.ts'

export type RunnerEvent =
	| { readonly type: 'progress'; readonly progress: Progress }
	| { readonly type: 'finished'; readonly outcome: RunOutcome & { readonly kind: RunKind; readonly dryRun: boolean } }

export interface Launched {
	readonly runId: number
	readonly done: Promise<RunOutcome>
}

export class Runner {
	private readonly deps: SyncDeps
	private readonly listeners = new Set<(event: RunnerEvent) => void>()
	private current: Progress | undefined

	constructor(deps: SyncDeps) {
		this.deps = deps
	}

	/** Progress of the run in flight, for a panel that connects in the middle of it. */
	get inProgress(): Progress | undefined {
		return this.current
	}

	subscribe(listener: (event: RunnerEvent) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	/**
	 * Resolves as soon as the run is registered (with its id); `done` resolves when it ends.
	 * Rejects with RunInProgressError if another run holds the lock.
	 */
	launch(kind: RunKind, dryRun: boolean, trigger: 'manual' | 'auto' = 'manual'): Promise<Launched> {
		return new Promise((resolve, reject) => {
			let registered = false
			const run = kind === 'import' ? runImport : runPaid
			const done = run(this.deps, {
				dryRun,
				trigger,
				onProgress: progress => {
					this.current = progress
					this.emit({ type: 'progress', progress })
					if (!registered) {
						registered = true
						resolve({ runId: progress.runId, done })
					}
				},
			})
			done.then(
				outcome => {
					this.current = undefined
					this.emit({ type: 'finished', outcome: { ...outcome, kind, dryRun } })
					if (!registered) resolve({ runId: outcome.runId, done })
				},
				error => {
					this.current = undefined
					if (!registered) reject(error)
				},
			)
		})
	}

	private emit(event: RunnerEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event)
			} catch {
				// A broken listener (closed connection) must not stop the run.
			}
		}
	}
}
