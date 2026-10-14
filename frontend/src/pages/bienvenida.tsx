/**
 * First-time assistant: connect the ISP in four guided steps. Recommended rules come checked,
 * advanced options folded, and nothing is brought in until the operator sees the preview.
 *   1 Empresa · 2 Conectar el ISP · 3 Qué se cobra · 4 Vista previa → Traer clientes y facturas
 */

import { CheckCircle2, CircleAlert, Loader2, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ChangeSections } from '@/components/changes'
import { LiveRun } from '@/components/runs'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { CheckboxPill, Field, Input, Select } from '@/components/ui/form'
import { api, ApiError, type Company, type Provider, type Settings } from '@/lib/api'
import { changesOf, runAndWait, type RunWithItems } from '@/lib/changes'
import { money } from '@/lib/format'
import { notifySettingsChanged, useAsync } from '@/lib/hooks'
import { cn } from '@/lib/utils'

const STEPS = ['Empresa', 'Conectar el ISP', 'Qué se cobra', 'Vista previa'] as const
const STATUSES = [
	{ value: 'ACTIVO', label: 'Activos', recommended: true },
	{ value: 'CORTADO', label: 'Cortados por falta de pago', recommended: true },
	{ value: 'CORTESIA', label: 'De cortesía' },
	{ value: 'RETIRADO', label: 'Retirados' },
	{ value: 'RECHAZADO', label: 'Rechazados' },
	{ value: 'ANULADO', label: 'Anulados' },
]
const DOCUMENT_TYPES = [['V', 'Venezolano'], ['E', 'Extranjero'], ['J', 'Jurídico'], ['G', 'Gobierno'], ['P', 'Pasaporte']] as const

/** The provider as the save endpoint expects it, with some fields replaced. */
function providerInput(provider: Provider, overrides: Record<string, unknown>) {
	return {
		name: provider.name, baseUrl: provider.baseUrl, username: provider.username,
		importableStatuses: provider.importableStatuses, windowMonths: provider.windowMonths, maxRecentPerContract: provider.maxRecentPerContract,
		graceDays: provider.graceDays, ledgerMonths: provider.ledgerMonths, maxNewInvoices: provider.maxNewInvoices,
		maxNewAmount: provider.maxNewAmountCents === null ? null : provider.maxNewAmountCents / 100,
		excludedDocumentTypes: provider.excludedDocumentTypes, autoEnabled: provider.autoEnabled, autoTime: provider.autoTime,
		...overrides,
	}
}

function StepCompany({ settings, onDone }: { settings: Settings; onDone: (settings: Settings) => void }) {
	const [form, setForm] = useState<Company>(settings.company)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [saving, setSaving] = useState(false)
	const set = (key: keyof Company) => (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value }))
	const next = async () => {
		setSaving(true)
		try {
			const saved = await api.saveCompany(form)
			notifySettingsChanged()
			onDone(saved)
		} catch (error) {
			if (error instanceof ApiError) setErrors(error.fields)
		} finally {
			setSaving(false)
		}
	}
	return (
		<StepFrame title="Tu empresa" description="Aparece en el panel y en los mensajes de cobranza."
			footer={<Button size="lg" onClick={() => void next()} disabled={saving}>{saving && <Loader2 className="animate-spin" />}Siguiente</Button>}>
			<Field label="Nombre" error={errors.name}>{props => <Input {...props} value={form.name} onChange={set('name')} placeholder="Mi ISP, C.A." className="h-11" />}</Field>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field label="RIF" error={errors.rif} hint="Ejemplo: J-12345678-9">{props => <Input {...props} value={form.rif} onChange={set('rif')} className="h-11" />}</Field>
				<Field label="Correo de cobranza" error={errors.collectionsEmail}>{props => <Input {...props} type="email" value={form.collectionsEmail} onChange={set('collectionsEmail')} className="h-11" />}</Field>
			</div>
		</StepFrame>
	)
}

function StepConnect({ settings, onBack, onDone }: { settings: Settings; onBack: () => void; onDone: (settings: Settings) => void }) {
	const [baseUrl, setBaseUrl] = useState(settings.provider.baseUrl)
	const [username, setUsername] = useState(settings.provider.username)
	const [password, setPassword] = useState('')
	const [busy, setBusy] = useState(false)
	const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
	const [errors, setErrors] = useState<Record<string, string>>({})

	const finish = async (saved: Settings) => {
		const test = await api.testConnection({})
		setResult(test)
		if (test.ok) {
			notifySettingsChanged()
			onDone(saved)
		}
	}
	const connect = async () => {
		setBusy(true)
		setResult(null)
		try {
			const test = await api.testConnection({ baseUrl, username, password })
			if (!test.ok) { setResult(test); return }
			const saved = await api.saveProvider(providerInput(settings.provider, { baseUrl, username, password }))
			await finish(saved)
		} catch (error) {
			if (error instanceof ApiError) setErrors(error.fields)
			setResult({ ok: false, message: error instanceof Error ? error.message : 'No se pudo conectar.' })
		} finally {
			setBusy(false)
		}
	}
	const sandbox = async () => {
		setBusy(true)
		setResult(null)
		try {
			await finish(await api.connectSandbox())
		} catch (error) {
			setResult({ ok: false, message: error instanceof Error ? error.message : 'No se pudo conectar al sandbox local.' })
		} finally {
			setBusy(false)
		}
	}

	return (
		<StepFrame title="Sistema de facturación del ISP" description="La dirección y el usuario que te dio tu proveedor. La contraseña se guarda cifrada y no se vuelve a mostrar."
			footer={<><Button variant="secondary" size="lg" onClick={onBack}>Atrás</Button><Button size="lg" onClick={() => void connect()} disabled={busy}>{busy && <Loader2 className="animate-spin" />}Probar y seguir</Button></>}>
			<Field label="Dirección de la API" error={errors.baseUrl} hint="Con o sin /api/v1.">{props => <Input {...props} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://facturas.miisp.com" inputMode="url" className="h-11" />}</Field>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field label="Usuario o correo" error={errors.username}>{props => <Input {...props} value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" className="h-11" />}</Field>
				<Field label="Contraseña" error={errors.password} hint={settings.provider.hasPassword ? 'Hay una guardada; déjala vacía para usarla.' : undefined}>
					{props => <Input {...props} type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" className="h-11" />}
				</Field>
			</div>
			{settings.sandbox && (
				<button type="button" onClick={() => void sandbox()} disabled={busy} className="inline-flex items-center gap-2 self-start text-sm font-medium text-primary hover:underline disabled:opacity-50">
					<Wand2 className="size-4" /> Usar el sandbox local de la prueba
				</button>
			)}
			{result && (
				<div role="status" className={cn('flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm', result.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900')}>
					{result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-600" />}
					{result.message}
				</div>
			)}
		</StepFrame>
	)
}

function StepRules({ settings, onBack, onDone }: { settings: Settings; onBack: () => void; onDone: () => void }) {
	const p = settings.provider
	const [statuses, setStatuses] = useState<string[]>(p.importableStatuses)
	const [advanced, setAdvanced] = useState(false)
	const [values, setValues] = useState({
		windowMonths: p.windowMonths ? String(p.windowMonths) : '', maxRecentPerContract: p.maxRecentPerContract ? String(p.maxRecentPerContract) : '',
		graceDays: String(p.graceDays), maxNewInvoices: p.maxNewInvoices ? String(p.maxNewInvoices) : '',
		maxNewAmount: p.maxNewAmountCents ? String(p.maxNewAmountCents / 100) : '', excludedDocumentTypes: p.excludedDocumentTypes,
	})
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [saving, setSaving] = useState(false)
	const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues(current => ({ ...current, [key]: event.target.value }))

	const next = async () => {
		setSaving(true)
		try {
			await api.saveProvider(providerInput(p, {
				importableStatuses: statuses, windowMonths: values.windowMonths || null, maxRecentPerContract: values.maxRecentPerContract || null,
				graceDays: values.graceDays, maxNewInvoices: values.maxNewInvoices || null, maxNewAmount: values.maxNewAmount || null,
				excludedDocumentTypes: values.excludedDocumentTypes,
			}))
			notifySettingsChanged()
			onDone()
		} catch (error) {
			if (error instanceof ApiError) {
				setErrors(error.fields)
				if (Object.keys(error.fields).some(key => key !== 'importableStatuses')) setAdvanced(true)
			}
		} finally {
			setSaving(false)
		}
	}

	return (
		<StepFrame title="Qué se cobra" description="Dejamos marcado lo recomendado. Puedes cambiarlo cuando quieras en Configuración."
			footer={<><Button variant="secondary" size="lg" onClick={onBack}>Atrás</Button><Button size="lg" onClick={() => void next()} disabled={saving}>{saving && <Loader2 className="animate-spin" />}Ver vista previa</Button></>}>
			<fieldset>
				<legend className="mb-2 text-sm font-medium">Contratos que se cobran</legend>
				<div className="flex flex-wrap gap-2">
					{STATUSES.map(status => (
						<CheckboxPill key={status.value} checked={statuses.includes(status.value)}
							onChange={checked => setStatuses(current => (checked ? [...current, status.value] : current.filter(item => item !== status.value)))}>
							{status.label}{status.recommended && <span className="text-xs text-muted">· recomendado</span>}
						</CheckboxPill>
					))}
				</div>
				{errors.importableStatuses && <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.importableStatuses}</p>}
			</fieldset>
			<button type="button" onClick={() => setAdvanced(value => !value)} aria-expanded={advanced} className="self-start text-sm font-medium text-primary hover:underline">
				{advanced ? 'Ocultar opciones avanzadas' : 'Opciones avanzadas: antigüedad, cuotas por contrato, días de gracia, topes y documentos'}
			</button>
			{advanced && (
				<div className="space-y-4 rounded-xl border border-line bg-canvas/50 p-4">
					<div className="grid gap-4 sm:grid-cols-3">
						<Field label="Antigüedad máxima" error={errors.windowMonths}>
							{props => <Select {...props} value={values.windowMonths} onChange={set('windowMonths')} className="h-11"><option value="">Toda la deuda</option>{[3, 6, 9, 12].map(m => <option key={m} value={m}>Últimos {m} meses</option>)}</Select>}
						</Field>
						<Field label="Cuotas por contrato" error={errors.maxRecentPerContract} hint="Las más recientes; vacío, todas.">{props => <Input {...props} type="number" min={1} max={60} value={values.maxRecentPerContract} onChange={set('maxRecentPerContract')} placeholder="Todas" className="h-11" />}</Field>
						<Field label="Días de gracia" error={errors.graceDays} hint="Corte = vencimiento + días.">{props => <Input {...props} type="number" min={0} max={60} value={values.graceDays} onChange={set('graceDays')} className="h-11" />}</Field>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Tope de facturas nuevas por sincronización" error={errors.maxNewInvoices}>{props => <Input {...props} type="number" min={1} value={values.maxNewInvoices} onChange={set('maxNewInvoices')} placeholder="Sin tope" className="h-11" />}</Field>
						<Field label="Tope de monto nuevo (USD)" error={errors.maxNewAmount}>{props => <Input {...props} type="number" min={0.01} step="0.01" value={values.maxNewAmount} onChange={set('maxNewAmount')} placeholder="Sin tope" className="h-11" />}</Field>
					</div>
					<fieldset>
						<legend className="mb-2 text-sm font-medium">No cobrar a titulares con documento</legend>
						<div className="flex flex-wrap gap-2">
							{DOCUMENT_TYPES.map(([value, label]) => (
								<CheckboxPill key={value} checked={values.excludedDocumentTypes.includes(value)}
									onChange={checked => setValues(current => ({ ...current, excludedDocumentTypes: checked ? [...current.excludedDocumentTypes, value] : current.excludedDocumentTypes.filter(item => item !== value) }))}>
									{value} · {label}
								</CheckboxPill>
							))}
						</div>
					</fieldset>
				</div>
			)}
		</StepFrame>
	)
}

function StepPreview({ onBack }: { onBack: () => void }) {
	const navigate = useNavigate()
	const [preview, setPreview] = useState<RunWithItems | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [applying, setApplying] = useState(false)
	const started = useRef(false)

	useEffect(() => {
		if (started.current) return
		started.current = true
		runAndWait('import', true).then(
			run => (run.status === 'failed' ? setError(run.error ?? 'La vista previa falló.') : setPreview(run)),
			err => setError(err instanceof Error ? err.message : 'No se pudo preparar la vista previa.'),
		)
	}, [])

	const apply = async () => {
		setApplying(true)
		try {
			const run = await runAndWait('import', false)
			navigate(`/sincronizacion/listo?corridas=${run.id}`)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'No se pudo traer la información.')
			setApplying(false)
		}
	}

	const changes = preview ? changesOf([preview]) : null
	return (
		<StepFrame title="Vista previa: esto llegaría a Cobrix" description="Todavía no se trajo nada. Revisa y confirma."
			footer={<><Button variant="secondary" size="lg" onClick={onBack} disabled={applying}>Atrás</Button>
				<Button size="lg" onClick={() => void apply()} disabled={!preview || applying}>{applying && <Loader2 className="animate-spin" />}Traer clientes y facturas</Button></>}>
			<LiveRun />
			{error && <ErrorNotice title="No se pudo preparar la vista previa" message={error} />}
			{!preview && !error && <Skeleton className="h-28" />}
			{changes && preview && (
				<>
					<div className="grid gap-3 sm:grid-cols-3">
						{[['Clientes', preview.counters.customersWouldCreate ?? 0], ['Facturas abiertas', changes.newCount], ['Por cobrar', money(changes.newAmountCents)]].map(([label, value]) => (
							<div key={label} className="rounded-xl bg-primary-soft p-4"><p className="text-sm text-indigo-900">{label}</p><p className="tabular mt-1 text-2xl font-semibold text-indigo-950">{value}</p></div>
						))}
					</div>
					<ChangeSections changes={{ ...changes, newInvoices: [] }} mode="preview" />
				</>
			)}
		</StepFrame>
	)
}

function StepFrame({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer: ReactNode }) {
	return (
		<>
			<Card className="flex flex-col gap-5 p-6">
				<div>
					<h2 className="text-lg font-semibold">{title}</h2>
					<p className="mt-1 text-sm text-muted">{description}</p>
				</div>
				{children}
			</Card>
			<div className="mt-5 flex justify-between gap-3">{footer}</div>
		</>
	)
}

export function BienvenidaPage() {
	const { data, error, reload } = useAsync(() => api.settings(), [])
	const [settings, setSettings] = useState<Settings>()
	const [step, setStep] = useState(1)
	useEffect(() => { if (data) setSettings(data) }, [data])

	return (
		<div className="mx-auto max-w-3xl">
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Conecta el sistema de facturación de tu ISP</h1>
					<p className="mt-1 text-sm text-muted">Cuatro pasos. Nada se trae hasta que veas la vista previa y la confirmes.</p>
				</div>
				<Link to="/" className="shrink-0 text-sm font-medium text-primary hover:underline">Salir</Link>
			</div>
			<ol aria-label="Pasos" className="mb-6 grid grid-cols-4 gap-2">
				{STEPS.map((label, index) => (
					<li key={label} aria-current={index + 1 === step ? 'step' : undefined} className="flex flex-col gap-1.5">
						<span className={cn('h-1 rounded-full', index + 1 <= step ? 'bg-primary' : 'bg-line')} />
						<span className={cn('text-xs font-semibold sm:text-sm', index + 1 === step ? 'text-primary' : index + 1 < step ? 'text-text' : 'text-muted')}>
							<span className="sm:hidden">{index + 1}</span><span className="hidden sm:inline">{index + 1}. {label}</span>
						</span>
					</li>
				))}
			</ol>
			{error && <ErrorNotice message={error.message} action={<button className="font-medium underline" onClick={reload}>Reintentar</button>} />}
			{!settings && !error && <Skeleton className="h-72" />}
			{settings && step === 1 && <StepCompany settings={settings} onDone={saved => { setSettings(saved); setStep(2) }} />}
			{settings && step === 2 && <StepConnect settings={settings} onBack={() => setStep(1)} onDone={saved => { setSettings(saved); setStep(3) }} />}
			{settings && step === 3 && <StepRules settings={settings} onBack={() => setStep(2)} onDone={() => setStep(4)} />}
			{settings && step === 4 && <StepPreview onBack={() => setStep(3)} />}
		</div>
	)
}
