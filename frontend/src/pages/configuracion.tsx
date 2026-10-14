/**
 * Configuración (ENUNCIADO §3.1), organized by category. Each category shows its title and
 * explanation on the left and its fields on the right; on narrow screens they stack.
 *   Empresa · Conexión · Qué se importa · Topes y libro de pagos · Corrida automática
 */

import { Building2, CalendarClock, CheckCircle2, CircleAlert, Filter, Gauge, Loader2, PlugZap, Server, Wand2, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorNotice, Skeleton } from '@/components/ui/feedback'
import { CheckboxPill, Field, Input, Select } from '@/components/ui/form'
import { api, ApiError, type Company, type Settings } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { notifySettingsChanged, useAsync } from '@/lib/hooks'
import { cn } from '@/lib/utils'

const STATUSES = ['ACTIVO', 'CORTADO', 'CORTESIA', 'RETIRADO', 'RECHAZADO', 'ANULADO']
const DOCUMENT_TYPES = [
	{ value: 'V', label: 'V · venezolano' }, { value: 'E', label: 'E · extranjero' }, { value: 'J', label: 'J · jurídico' },
	{ value: 'G', label: 'G · gobierno' }, { value: 'P', label: 'P · pasaporte' },
]

interface ProviderForm {
	name: string
	baseUrl: string
	username: string
	password: string
	importableStatuses: string[]
	windowMonths: string
	maxRecentPerContract: string
	graceDays: string
	ledgerMonths: string
	maxNewInvoices: string
	maxNewAmount: string
	excludedDocumentTypes: string[]
	autoEnabled: boolean
	autoTime: string
}

function toForm(settings: Settings): ProviderForm {
	const p = settings.provider
	return {
		name: p.name, baseUrl: p.baseUrl, username: p.username, password: '',
		importableStatuses: p.importableStatuses, windowMonths: p.windowMonths ? String(p.windowMonths) : '',
		maxRecentPerContract: p.maxRecentPerContract ? String(p.maxRecentPerContract) : '', graceDays: String(p.graceDays),
		ledgerMonths: String(p.ledgerMonths), maxNewInvoices: p.maxNewInvoices ? String(p.maxNewInvoices) : '',
		maxNewAmount: p.maxNewAmountCents ? (p.maxNewAmountCents / 100).toFixed(2) : '',
		excludedDocumentTypes: p.excludedDocumentTypes, autoEnabled: p.autoEnabled, autoTime: p.autoTime ?? '',
	}
}

/** One settings category: title and explanation beside (or above) its card of fields. */
function Category({ icon: Icon, title, description, children, footer }: { icon: LucideIcon; title: string; description: string; children: ReactNode; footer?: ReactNode }) {
	return (
		<fieldset className="grid min-w-0 gap-4 lg:grid-cols-[260px_1fr] lg:gap-8">
			<legend className="sr-only">{title}</legend>
			<div className="flex items-start gap-3">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Icon className="size-[18px]" /></span>
				<div>
					<h2 className="font-semibold">{title}</h2>
					<p className="mt-1 text-sm text-muted">{description}</p>
				</div>
			</div>
			<Card className="min-w-0">
				<div className="space-y-5 p-5">{children}</div>
				{footer && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">{footer}</div>}
			</Card>
		</fieldset>
	)
}

function CompanySettings({ settings, onSaved }: { settings: Settings; onSaved: (settings: Settings) => void }) {
	const [form, setForm] = useState<Company>(settings.company)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [saving, setSaving] = useState(false)
	const set = (key: keyof Company) => (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value }))

	const submit = async (event: FormEvent) => {
		event.preventDefault()
		setSaving(true)
		try {
			onSaved(await api.saveCompany(form))
			notifySettingsChanged()
			setErrors({})
			toast.success('Datos de la empresa guardados')
		} catch (error) {
			if (error instanceof ApiError) setErrors(error.fields)
			toast.error('No se guardó la empresa', { description: error instanceof Error ? error.message : undefined })
		} finally {
			setSaving(false)
		}
	}

	return (
		<form onSubmit={submit} noValidate>
			<Category
				icon={Building2}
				title="Empresa"
				description="Aparece en el panel y en las comunicaciones de cobranza. Zona horaria America/Caracas, moneda USD."
				footer={<><span className="text-xs text-muted">Se guarda por separado del proveedor.</span><Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}Guardar empresa</Button></>}
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Nombre" error={errors.name} className="sm:col-span-2">{props => <Input {...props} value={form.name} onChange={set('name')} placeholder="Mi ISP, C.A." />}</Field>
					<Field label="RIF" error={errors.rif} hint="Ejemplo: J-12345678-9">{props => <Input {...props} value={form.rif} onChange={set('rif')} placeholder="J-12345678-9" />}</Field>
					<Field label="Correo de cobranza" error={errors.collectionsEmail}>{props => <Input {...props} type="email" value={form.collectionsEmail} onChange={set('collectionsEmail')} placeholder="cobranza@miisp.com" />}</Field>
				</div>
			</Category>
		</form>
	)
}

function ProviderSettings({ settings, onSaved }: { settings: Settings; onSaved: (settings: Settings) => void }) {
	const [form, setForm] = useState<ProviderForm>(() => toForm(settings))
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [saving, setSaving] = useState(false)
	const [testing, setTesting] = useState(false)
	const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
	const set = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) => setForm(current => ({ ...current, [key]: value }))
	const text = (key: keyof ProviderForm) => (event: { target: { value: string } }) => set(key, event.target.value as never)
	const toggle = (key: 'importableStatuses' | 'excludedDocumentTypes', value: string) => (checked: boolean) =>
		set(key, checked ? [...form[key], value] : form[key].filter(item => item !== value))

	const payload = () => ({
		...form,
		windowMonths: form.windowMonths || null, maxRecentPerContract: form.maxRecentPerContract || null,
		maxNewInvoices: form.maxNewInvoices || null, maxNewAmount: form.maxNewAmount || null, autoTime: form.autoTime || null,
	})

	const submit = async (event: FormEvent) => {
		event.preventDefault()
		setSaving(true)
		try {
			const saved = await api.saveProvider(payload())
			onSaved(saved)
			notifySettingsChanged()
			setForm(toForm(saved))
			setErrors({})
			toast.success('Proveedor guardado')
		} catch (error) {
			if (error instanceof ApiError) setErrors(error.fields)
			toast.error('No se guardó el proveedor', { description: error instanceof Error ? error.message : undefined })
		} finally {
			setSaving(false)
		}
	}

	const runTest = async () => {
		setTesting(true)
		setTest(null)
		try {
			setTest(await api.testConnection({ baseUrl: form.baseUrl, username: form.username, password: form.password }))
		} catch (error) {
			setTest({ ok: false, message: error instanceof Error ? error.message : 'No se pudo probar la conexión.' })
		} finally {
			setTesting(false)
		}
	}

	const sandbox = settings.sandbox
	/** Saves the sandbox connection on the server (its password never reaches the browser) and tests it. */
	const connectSandbox = async () => {
		setTesting(true)
		setTest(null)
		try {
			const saved = await api.connectSandbox()
			onSaved(saved)
			notifySettingsChanged()
			setForm(toForm(saved))
			setTest(await api.testConnection({}))
		} catch (error) {
			setTest({ ok: false, message: error instanceof Error ? error.message : 'No se pudo conectar al sandbox local.' })
		} finally {
			setTesting(false)
		}
	}

	return (
		<form onSubmit={submit} noValidate className="space-y-8">
			<Category icon={Server} title="Sistema del ISP" description="Dónde está el sistema de facturación de tu proveedor y con qué usuario entrar. La contraseña se guarda cifrada y nunca se vuelve a mostrar.">
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Nombre visible" error={errors.name}>{props => <Input {...props} value={form.name} onChange={text('name')} />}</Field>
					<Field label="URL de la API" error={errors.baseUrl} hint="Con o sin /api/v1.">{props => <Input {...props} value={form.baseUrl} onChange={text('baseUrl')} placeholder="https://facturas.miisp.com" inputMode="url" />}</Field>
					<Field label="Usuario o correo" error={errors.username}>{props => <Input {...props} value={form.username} onChange={text('username')} autoComplete="off" />}</Field>
					<Field label="Contraseña" error={errors.password} hint={settings.provider.hasPassword ? 'Hay una contraseña guardada. Déjala vacía para conservarla.' : undefined}>
						{props => <Input {...props} type="password" value={form.password} onChange={text('password')} autoComplete="new-password" placeholder={settings.provider.hasPassword ? '••••••••' : ''} />}
					</Field>
				</div>
				<div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:flex-wrap">
					<Button variant="secondary" onClick={() => void runTest()} disabled={testing}>
						{testing ? <Loader2 className="animate-spin" /> : <PlugZap />} Probar conexión
					</Button>
					{sandbox && (
						<Button variant="ghost" onClick={() => void connectSandbox()} disabled={testing} aria-describedby="sandbox-url">
							<Wand2 /> Conectar al sandbox local<span id="sandbox-url" className="sr-only">{sandbox.baseUrl}</span>
						</Button>
					)}
				</div>
				{test && (
					<div role="status" className={cn('flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm', test.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900')}>
						{test.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-600" />}
						<span>{test.message}{test.ok && !settings.provider.hasPassword && ' Guarda el proveedor para usar estas credenciales en las corridas.'}</span>
					</div>
				)}
			</Category>

			<Category icon={Filter} title="Qué se cobra" description="Qué cuotas del ISP llegan a Cobrix. Solo pendientes, en dólares y de titulares con cédula o RIF válidos.">
				<div>
					<p className="mb-2 text-sm font-medium">Estados de contrato que se importan</p>
					<div className="flex flex-wrap gap-2">
						{STATUSES.map(status => <CheckboxPill key={status} checked={form.importableStatuses.includes(status)} onChange={toggle('importableStatuses', status)}>{status}</CheckboxPill>)}
					</div>
					{errors.importableStatuses && <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.importableStatuses}</p>}
				</div>
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					<Field label="Ventana de importación" error={errors.windowMonths} hint="Cuotas desde el mes actual menos N meses.">
						{props => (
							<Select {...props} value={form.windowMonths} onChange={text('windowMonths')}>
								<option value="">Sin ventana</option>
								{[3, 6, 9, 12].map(months => <option key={months} value={months}>{months} meses</option>)}
							</Select>
						)}
					</Field>
					<Field label="Cuotas recientes por contrato" error={errors.maxRecentPerContract} hint="De 1 a 60; vacío, todas.">
						{props => <Input {...props} type="number" min={1} max={60} value={form.maxRecentPerContract} onChange={text('maxRecentPerContract')} placeholder="Todas" />}
					</Field>
					<Field label="Días de gracia para el corte" error={errors.graceDays} hint="Corte = vencimiento + días (0 a 60).">
						{props => <Input {...props} type="number" min={0} max={60} value={form.graceDays} onChange={text('graceDays')} />}
					</Field>
				</div>
				<div>
					<p className="mb-2 text-sm font-medium">Excluir por tipo de documento del titular</p>
					<div className="flex flex-wrap gap-2">
						{DOCUMENT_TYPES.map(type => <CheckboxPill key={type.value} checked={form.excludedDocumentTypes.includes(type.value)} onChange={toggle('excludedDocumentTypes', type.value)}>{type.label}</CheckboxPill>)}
					</div>
					<p className="mt-1.5 text-xs text-muted">Un documento sin letra (por ejemplo 09000123) no se excluye: no se adivina su tipo.</p>
				</div>
			</Category>

			<Category icon={Gauge} title="Topes y cobros" description="Límites por sincronización: lo que exceda queda frenado y entra en la siguiente. Vacío: sin tope.">
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					<Field label="Facturas nuevas por sincronización" error={errors.maxNewInvoices}>{props => <Input {...props} type="number" min={1} value={form.maxNewInvoices} onChange={text('maxNewInvoices')} placeholder="Sin tope" />}</Field>
					<Field label="Monto nuevo por sincronización (USD)" error={errors.maxNewAmount}>{props => <Input {...props} type="number" min={0.01} step="0.01" value={form.maxNewAmount} onChange={text('maxNewAmount')} placeholder="Sin tope" />}</Field>
					<Field label="Meses de cobros a revisar" error={errors.ledgerMonths} hint="Cuánto hacia atrás se revisan los cobros del ISP. De 1 a 12; por defecto 7.">
						{props => <Input {...props} type="number" min={0} max={12} value={form.ledgerMonths} onChange={text('ledgerMonths')} />}
					</Field>
				</div>
			</Category>

			<Category icon={CalendarClock} title="Sincronización automática" description="Una vez al día, a la hora de Caracas: trae las facturas nuevas y después revisa los cobros del ISP.">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-end">
					<CheckboxPill checked={form.autoEnabled} onChange={checked => set('autoEnabled', checked)}>Sincronizar todos los días</CheckboxPill>
					<Field label="Hora" error={errors.autoTime} className="sm:w-40">
						{props => <Input {...props} type="time" value={form.autoTime} onChange={text('autoTime')} disabled={!form.autoEnabled} />}
					</Field>
				</div>
			</Category>

			{/* Always reachable: the save bar sticks to the bottom of the screen while scrolling the provider. */}
			<div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:-mx-8 lg:px-8">
				<p className="text-xs text-muted">Proveedor · última modificación: {dateTime(settings.provider.updatedAt)}</p>
				<Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}Guardar proveedor</Button>
			</div>
		</form>
	)
}

export function ConfiguracionPage() {
	const { data, error, loading, reload } = useAsync(() => api.settings(), [])
	const [settings, setSettings] = useState<Settings>()
	useEffect(() => { if (data) setSettings(data) }, [data])

	return (
		<>
			<PageHeader title="Configuración" description="Tu empresa y el sistema de facturación del ISP del que Cobrix trae clientes, facturas y cobros."
				actions={<Link to="/bienvenida" className="text-sm font-medium text-primary hover:underline">Abrir el asistente guiado</Link>} />
			{error && <ErrorNotice message={error.message} action={<button className="font-medium underline" onClick={reload}>Reintentar</button>} />}
			{loading && !settings && <div className="space-y-4"><Skeleton className="h-48" /><Skeleton className="h-96" /></div>}
			{settings && (
				<div className="space-y-8">
					<CompanySettings settings={settings} onSaved={setSettings} />
					<ProviderSettings settings={settings} onSaved={setSettings} />
				</div>
			)}
		</>
	)
}
