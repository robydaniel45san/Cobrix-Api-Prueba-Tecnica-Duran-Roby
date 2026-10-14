import { CheckCircle2, CircleAlert, Loader2, PlugZap, Wand2 } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
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

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
	return (
		<fieldset className="border-t border-line pt-5 first:border-t-0 first:pt-0">
			<legend className="sr-only">{title}</legend>
			<p className="text-sm font-semibold">{title}</p>
			{description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
			<div className="mt-4">{children}</div>
		</fieldset>
	)
}

function CompanyCard({ settings, onSaved }: { settings: Settings; onSaved: (settings: Settings) => void }) {
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
		<Card>
			<CardHeader title="Empresa" description="Aparece en el panel y en las comunicaciones de cobranza." />
			<form onSubmit={submit} noValidate>
				<CardBody className="grid gap-4 md:grid-cols-3">
					<Field label="Nombre" error={errors.name}>{props => <Input {...props} value={form.name} onChange={set('name')} placeholder="Mi ISP, C.A." />}</Field>
					<Field label="RIF" error={errors.rif} hint="Ejemplo: J-12345678-9">{props => <Input {...props} value={form.rif} onChange={set('rif')} placeholder="J-12345678-9" />}</Field>
					<Field label="Correo de cobranza" error={errors.collectionsEmail}>{props => <Input {...props} type="email" value={form.collectionsEmail} onChange={set('collectionsEmail')} placeholder="cobranza@miisp.com" />}</Field>
				</CardBody>
				<div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
					<p className="text-xs text-muted">Zona horaria America/Caracas · moneda USD</p>
					<Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}Guardar empresa</Button>
				</div>
			</form>
		</Card>
	)
}

function ProviderCard({ settings, onSaved }: { settings: Settings; onSaved: (settings: Settings) => void }) {
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
	const fillSandbox = () => {
		if (!sandbox) return
		setForm(current => ({ ...current, baseUrl: sandbox.baseUrl, username: sandbox.username, password: sandbox.password }))
		setTest(null)
	}

	return (
		<Card className="mt-6">
			<CardHeader
				title="Administrador de facturas"
				description="Conexión con la API del ISP y reglas de importación."
				actions={
					<>
						{sandbox && <Button variant="ghost" size="sm" onClick={fillSandbox} aria-describedby="sandbox-url"><Wand2 /> Usar el sandbox local<span id="sandbox-url" className="sr-only">{sandbox.baseUrl}</span></Button>}
						<Button variant="secondary" size="sm" onClick={() => void runTest()} disabled={testing}>
							{testing ? <Loader2 className="animate-spin" /> : <PlugZap />} Probar conexión
						</Button>
					</>
				}
			/>
			<form onSubmit={submit} noValidate>
				<CardBody className="space-y-6">
					{test && (
						<div role="status" className={cn('flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm', test.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900')}>
							{test.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-600" />}
							<span>{test.message}{test.ok && !settings.provider.hasPassword && ' Guarda el proveedor para usar estas credenciales en las corridas.'}</span>
						</div>
					)}

					<Group title="Conexión">
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="Nombre visible" error={errors.name}>{props => <Input {...props} value={form.name} onChange={text('name')} />}</Field>
							<Field label="URL de la API" error={errors.baseUrl} hint="Con o sin /api/v1. Ejemplo: https://facturas.miisp.com">{props => <Input {...props} value={form.baseUrl} onChange={text('baseUrl')} placeholder="https://" inputMode="url" />}</Field>
							<Field label="Usuario o correo" error={errors.username}>{props => <Input {...props} value={form.username} onChange={text('username')} autoComplete="off" />}</Field>
							<Field label="Contraseña" error={errors.password} hint={settings.provider.hasPassword ? 'Hay una contraseña guardada. Déjala vacía para conservarla.' : 'Se guarda cifrada y nunca se vuelve a mostrar.'}>
								{props => <Input {...props} type="password" value={form.password} onChange={text('password')} autoComplete="new-password" placeholder={settings.provider.hasPassword ? '••••••••' : ''} />}
							</Field>
						</div>
					</Group>

					<Group title="Qué se importa" description="Solo cuotas pendientes, en USD coherente, de titulares con cédula o RIF válidos.">
						<div className="space-y-5">
							<div>
								<p className="mb-2 text-sm font-medium">Estados de contrato que se importan</p>
								<div className="flex flex-wrap gap-2">
									{STATUSES.map(status => <CheckboxPill key={status} checked={form.importableStatuses.includes(status)} onChange={toggle('importableStatuses', status)}>{status}</CheckboxPill>)}
								</div>
								{errors.importableStatuses && <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.importableStatuses}</p>}
							</div>
							<div className="grid gap-4 md:grid-cols-3">
								<Field label="Ventana de importación" error={errors.windowMonths} hint="Solo cuotas desde el mes actual menos N meses.">
									{props => (
										<Select {...props} value={form.windowMonths} onChange={text('windowMonths')}>
											<option value="">Sin ventana</option>
											{[3, 6, 9, 12].map(months => <option key={months} value={months}>{months} meses</option>)}
										</Select>
									)}
								</Field>
								<Field label="Máximo de cuotas recientes por contrato" error={errors.maxRecentPerContract} hint="De 1 a 60. Vacío: todas. Se conservan las más recientes.">
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
						</div>
					</Group>

					<Group title="Topes por corrida" description="Lo que exceda queda frenado y se importa en la siguiente corrida. Vacío: sin tope.">
						<div className="grid gap-4 md:grid-cols-3">
							<Field label="Facturas nuevas" error={errors.maxNewInvoices}>{props => <Input {...props} type="number" min={1} value={form.maxNewInvoices} onChange={text('maxNewInvoices')} placeholder="Sin tope" />}</Field>
							<Field label="Monto nuevo (USD)" error={errors.maxNewAmount}>{props => <Input {...props} type="number" min={0.01} step="0.01" value={form.maxNewAmount} onChange={text('maxNewAmount')} placeholder="Sin tope" />}</Field>
							<Field label="Meses del libro en «Actualizar pagadas»" error={errors.ledgerMonths} hint="De 1 a 12; por defecto 7.">
								{props => <Input {...props} type="number" min={0} max={12} value={form.ledgerMonths} onChange={text('ledgerMonths')} />}
							</Field>
						</div>
					</Group>

					<Group title="Corrida automática" description="Una vez al día: importar y después actualizar pagadas. Hora de Caracas.">
						<div className="flex flex-wrap items-end gap-4">
							<CheckboxPill checked={form.autoEnabled} onChange={checked => set('autoEnabled', checked)}>Activar la corrida diaria</CheckboxPill>
							<Field label="Hora" error={errors.autoTime} className="w-40">
								{props => <Input {...props} type="time" value={form.autoTime} onChange={text('autoTime')} disabled={!form.autoEnabled} />}
							</Field>
						</div>
					</Group>
				</CardBody>
				<div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
					<p className="text-xs text-muted">Última modificación: {dateTime(settings.provider.updatedAt)}</p>
					<Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}Guardar proveedor</Button>
				</div>
			</form>
		</Card>
	)
}

export function ConfiguracionPage() {
	const { data, error, loading, reload } = useAsync(() => api.settings(), [])
	const [settings, setSettings] = useState<Settings>()
	useEffect(() => { if (data) setSettings(data) }, [data])

	return (
		<>
			<PageHeader title="Configuración" description="Datos de la empresa y del administrador de facturas del que Cobrix importa clientes, facturas y pagos." />
			{error && <ErrorNotice message={error.message} action={<button className="font-medium underline" onClick={reload}>Reintentar</button>} />}
			{loading && !settings && <div className="space-y-4"><Skeleton className="h-48" /><Skeleton className="h-96" /></div>}
			{settings && (
				<>
					<CompanyCard settings={settings} onSaved={setSettings} />
					<ProviderCard key={settings.provider.updatedAt} settings={settings} onSaved={setSettings} />
				</>
			)}
		</>
	)
}
