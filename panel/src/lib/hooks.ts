import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
	data: T | undefined
	error: Error | undefined
	loading: boolean
	reload: () => void
}

/** Loads data and reloads on demand, keeping the previous data while reloading. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
	const [data, setData] = useState<T>()
	const [error, setError] = useState<Error>()
	const [loading, setLoading] = useState(true)
	const [tick, setTick] = useState(0)
	const loadRef = useRef(load)
	loadRef.current = load

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		loadRef.current().then(
			value => { if (!cancelled) { setData(value); setError(undefined); setLoading(false) } },
			err => { if (!cancelled) { setError(err instanceof Error ? err : new Error(String(err))); setLoading(false) } },
		)
		return () => { cancelled = true }
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...deps, tick])

	const reload = useCallback(() => setTick(value => value + 1), [])
	return { data, error, loading, reload }
}

const SETTINGS_CHANGED = 'cobrix:settings-changed'

/** Tells screens that show company or provider data (the sidebar, the summary) to reload. */
export function notifySettingsChanged(): void {
	window.dispatchEvent(new Event(SETTINGS_CHANGED))
}

export function useSettingsVersion(): number {
	const [version, setVersion] = useState(0)
	useEffect(() => {
		const bump = () => setVersion(value => value + 1)
		window.addEventListener(SETTINGS_CHANGED, bump)
		return () => window.removeEventListener(SETTINGS_CHANGED, bump)
	}, [])
	return version
}

export function useDebounced<T>(value: T, ms: number): T {
	const [debounced, setDebounced] = useState(value)
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), ms)
		return () => clearTimeout(timer)
	}, [value, ms])
	return debounced
}
