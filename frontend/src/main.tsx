import { Compass } from 'lucide-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'

import { Layout } from '@/components/layout'
import { RunsProvider } from '@/components/runs'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { ClientesPage } from '@/pages/clientes'
import { ConfiguracionPage } from '@/pages/configuracion'
import { CorridaPage } from '@/pages/corrida'
import { ExpedientePage } from '@/pages/expediente'
import { BienvenidaPage } from '@/pages/bienvenida'
import { InicioPage } from '@/pages/inicio'
import { ListoPage } from '@/pages/listo'
import { RevisarPage } from '@/pages/revisar'
import { SincronizacionPage } from '@/pages/sincronizacion'

import './index.css'

function NotFound() {
	return <EmptyState icon={Compass} title="Esta página no existe" description="Revisa la dirección o vuelve al inicio." action={<Link to="/" className={buttonVariants()}>Ir al inicio</Link>} />
}

createRoot(document.getElementById('root') as HTMLElement).render(
	<StrictMode>
		<BrowserRouter>
			<RunsProvider>
				<Routes>
					<Route element={<Layout />}>
						<Route index element={<InicioPage />} />
						<Route path="bienvenida" element={<BienvenidaPage />} />
						<Route path="clientes" element={<ClientesPage />} />
						<Route path="clientes/:id" element={<ExpedientePage />} />
						<Route path="sincronizacion" element={<SincronizacionPage />} />
						<Route path="sincronizacion/revisar" element={<RevisarPage />} />
						<Route path="sincronizacion/listo" element={<ListoPage />} />
						<Route path="sincronizacion/:id" element={<CorridaPage />} />
						<Route path="configuracion" element={<ConfiguracionPage />} />
						<Route path="*" element={<NotFound />} />
					</Route>
				</Routes>
				<Toaster position="top-right" richColors closeButton />
			</RunsProvider>
		</BrowserRouter>
	</StrictMode>,
)
