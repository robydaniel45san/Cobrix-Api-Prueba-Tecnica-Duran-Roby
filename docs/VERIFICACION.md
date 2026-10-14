# Verificación contra el enunciado

Paneo de lo que pide el [enunciado](ENUNCIADO.md), dónde quedó implementado y cómo lo verifiqué. Fecha de la verificación: 13 de octubre de 2026.

## 1. Compilación y pruebas

Cloné el repositorio en una carpeta limpia y ejecuté lo mismo que haría un evaluador:

| Paso | Comando | Resultado |
|---|---|---|
| Instalación | `npm ci` | Correcta, 0 vulnerabilidades |
| Tipos (backend y frontend) | `npm run typecheck` | Sin errores |
| Compilación del panel | `npm run build` | Correcta |
| Pruebas | `npm test` | **72 de 72** (11 suites) |
| Arranque | `npm start` | Panel en `:4300`, API del ISP en `:4310` |
| Integración continua | GitHub Actions (Linux): `npm ci`, `typecheck`, `test`, `build` | Correcta en cada commit |

| Suite | Pruebas | Qué cubre |
|---|---:|---|
| `backend/test/unit/reglas.test.ts` | 32 | Reglas de §4, una por una |
| `backend/test/unit/logger.test.ts` | 4 | Registro: niveles, formatos, secretos enmascarados |
| `backend/test/integration/ciclo.test.ts` | 12 | Criterios de aceptación de §5 contra la API real |
| `backend/test/integration/robustez.test.ts` | 11 | Fallas inyectadas en la API |
| `backend/test/integration/servidor.test.ts` | 11 | API del panel, errores, progreso en vivo, corrida automática |
| `test/entorno.test.ts` | 2 | Entorno provisto por Cobrix |

## 2. Criterios de aceptación (§5)

Verificados de dos maneras: con la prueba automática `ciclo.test.ts` y ejecutando el ciclo por HTTP contra el servidor levantado con `npm start` desde el clon limpio.

| Criterio | Esperado | Obtenido |
|---|---|---|
| Simular importación | 42 cuotas se importarían; no se crea nada | 42; 0 facturas creadas |
| Importar | 20 clientes y 42 facturas abiertas por USD 1.235,00 | 20 · 42 · USD 1.235,00 |
| Excluidas | 9 por estado, 1 contrato por moneda incoherente, 1 saldo residual | 9 · 1 · 1 |
| Importar otra vez | 0 facturas nuevas | 0 (42 ya importadas) |
| LUIS GOMEZ | 1 cliente con 2 contratos | `V9876543`, 2 contratos |
| ELENA RUIZ (`09000123`) | ID de cliente `9000123` | `9000123` |
| Titulares que no deben aparecer | CARLOS ROJAS, ROSA DIAZ, PEDRO LEON, ANDRES VARGAS, LAURA MENDEZ, JORGE CASTILLO | Ninguno aparece |
| ANA PEREZ (900101, pago total) | Sus 3 facturas pagadas | 3 pagadas |
| LUIS GOMEZ (900103, monto 25) | 1 pagada; la siguiente abierta como abono parcial | Julio pagada; agosto abierta, el ISP informa saldo USD 15,00 |
| COMERCIAL EL FARO (900104) | Sus 2 facturas pagadas | 2 pagadas |
| MIGUEL ANGEL SOTO (900114, monto 70) | Sus 2 cuotas más viejas pagadas | Marzo y abril pagadas |
| ELENA RUIZ (900113, pago y anulación) | Nada cambia | 2 abiertas |
| Resultado final | 8 pagadas y 34 abiertas por USD 955,00 | 8 · 34 · USD 955,00 |
| Repetir la actualización | No cambia nada | 0 pagadas nuevas |

## 3. Funcionalidad (§3)

| Requisito | Implementación | Evidencia |
|---|---|---|
| **3.1 Empresa:** nombre, RIF, correo de cobranza | `application/settings.ts` · pantalla Configuración | `servidor`: valida campo por campo |
| **3.1 Proveedor:** URL, usuario, contraseña oculta al editar | Contraseña cifrada (AES-256-GCM), nunca devuelta | `servidor`: la configuración nunca devuelve la contraseña |
| Probar conexión: inicia sesión y dice cuántos contratos hay | `POST /api/settings/provider/test` | `servidor`: cuenta 27 o explica el error |
| Estados importables (por defecto ACTIVO y CORTADO) | `domain/import-rules.ts` | `reglas`: solo estados importables |
| Ventana de importación (3, 6, 9, 12 o sin ventana) | `import-rules.ts` · validación en `settings.ts` | `reglas`: ventana y máximo de recientes |
| Máximo de cuotas recientes por contrato (1 a 60) | `import-rules.ts` | `reglas`: ventana y máximo de recientes |
| Días de gracia (0 a 60) | `domain/period.ts` (corte = vencimiento + días) | `reglas`: periodo, vencimiento y corte |
| Topes por corrida (cantidad y monto) | `application/import-invoices.ts` | `robustez`: lo que excede queda frenado |
| Excluir por tipo de documento | `import-rules.ts` | `reglas`: excluye por tipo de documento |
| Corrida automática diaria (America/Caracas) | `application/scheduler.ts` | `servidor`: corre una vez al día a la hora configurada |
| **3.2 Importar** y **simular importación** | `import-invoices.ts`, dos fases | `ciclo`: simular e importar |
| **3.3 Actualizar pagadas** y **simular** | `application/update-paid.ts` | `ciclo`: 8 pagadas, simulación sin escrituras |
| **3.4 Historial:** tipo, fecha, simulación, estado, resumen | `GET /api/runs` · pantalla Sincronización | Revisado en el navegador |
| Detalle con contadores y una fila por cuota con resultado y motivo | `GET /api/runs/:id` · pantalla de corrida | `ciclo`: cada cuota queda en el detalle |
| Corrida fallida registrada con el error | `runs.fail` | `robustez`: credenciales malas |
| **3.5 Clientes:** búsqueda por nombre, cédula o RIF; columnas pedidas | `GET /api/customers` · pantalla Clientes | `servidor`: búsqueda con separadores |
| **3.6 Expediente:** datos, contratos, facturas, historial | `GET /api/customers/:id` · pantalla Expediente | `servidor`: expediente completo |
| **3.7 UI:** estados visibles, montos con moneda, fechas legibles | Insignias por estado, `USD 1.235,00`, `1 oct 2026` | Revisado en el navegador |
| Vacíos que expliquen qué hacer | Estados vacíos con acción en cada pantalla | Revisado en el navegador |
| Confirmación antes de acciones destructivas | Diálogo antes de Importar y Actualizar pagadas | Revisado en el navegador |
| Errores que digan qué pasó y cómo seguir | Mensajes con la acción sugerida; formato único de error | `servidor`: formato de errores |
| Pantallas angostas | Tarjetas en lugar de tablas en teléfono | Revisado a 375 px, sin desplazamiento horizontal |
| **3.8 Resumen:** totales, proveedor, corrida automática, últimas corridas, accesos rápidos | `GET /api/summary` · pantalla Resumen | `servidor`: totales y antigüedad de la deuda |

## 4. Reglas de negocio (§4)

| Regla | Prueba |
|---|---|
| Un cliente por identificación; varios contratos en el mismo cliente | `ciclo`: LUIS GOMEZ con 2 contratos |
| Normalización: `V-12345678` → `V12345678`, `09000123` → `9000123` | `reglas`: quita separadores y ceros a la izquierda |
| J y G jurídicas; el resto naturales | `reglas`: J y G son jurídicas |
| Contrato sin identificación válida no se importa | `reglas`: un contrato sin identificación válida |
| Una factura por cuota pendiente (`deuda_id`, `deuda`) | `reglas`: una factura por cuota pendiente |
| `deuda_id: "0"` no es una cuota | `reglas`: la fila deuda_id "0" es «sin deuda» |
| `deuda` 0 (residual) no se importa | `reglas`: una cuota con deuda 0 |
| Período y vencimiento desde `detalle_deuda`; corte con días de gracia | `reglas`: salen de detalle_deuda |
| Solo estados importables y USD coherente (< 1 % del plan se descarta) | `reglas`: solo USD; moneda incoherente |
| Estado desconocido o respuesta contradictoria: no se adivina | `reglas` y `robustez`: respuestas que se contradicen |
| Idempotencia | `ciclo`: importar otra vez; repetir la actualización |
| Pagada solo si las filas coinciden, saldo 0 y algo pagado | `reglas`: pagada |
| Abono parcial: se informa, sigue abierta | `reglas` y `ciclo` |
| Exonerada no es un pago | `reglas`: exonerada; descuento con signo |
| Sin evidencia: nunca pagada | `reglas` y `robustez`: sin evidencia |
| Cuota del mes fuera del libro: se consulta el contrato | `reglas`: mes en curso fuera del libro |
| Rarezas de la API: filtro de `estado`, filas sin orden, `success: false`, cuotas futuras | Adaptador `infrastructure/invoice-manager/` · `reglas` |

## 5. Entregables (§6)

| Entregable | Estado |
|---|---|
| Implementación en un repositorio de GitHub | Completo |
| Pruebas automáticas de las reglas de §4 | Completo (`reglas.test.ts`) |
| Pruebas de al menos un ciclo completo (importar → pagar → actualizar) | Completo (`ciclo.test.ts`) |
| README con cómo levantarlo y correr las pruebas | **Pendiente:** el README actual es el original del esqueleto |
| Nota breve: decisiones, fuera de alcance, con más tiempo, punto diferencial | **Pendiente:** el contenido existe en `DISENO.md` y `BITACORA-IA.md`; falta la nota de entrega |

## 6. Criterios de evaluación (§7)

| Criterio | Peso | Respaldo |
|---|---:|---|
| Clasificación correcta de la API | 35 % | Reglas puras y probadas; adaptador con capa anticorrupción; criterios de §5 exactos |
| Robustez | 20 % | 11 pruebas de fallas; transacciones de todo o nada; bloqueo de corridas; numeración sin huecos; recuperación ante interrupciones |
| UX/UI | 20 % | Panel propio con progreso en vivo, confirmaciones, estados vacíos, errores accionables y vista de teléfono |
| Pulcritud | 25 % | Arquitectura en capas, documento de diseño con 15 diagramas, contratos de API, registro estructurado, historial de commits por hito |
| Punto diferencial | Extra | Progreso de corridas en vivo; antigüedad de la deuda; contadores con el nombre interno de Cobrix; conexión al sandbox sin exponer credenciales |

## 7. Limitaciones conocidas

- No hay pruebas automáticas de la interfaz en el navegador. El panel se verificó recorriendo el ciclo completo de forma manual, en escritorio y en teléfono.
- Los datos de contacto del cliente se toman al crearlo y no se actualizan en importaciones posteriores (decisión documentada en `DISENO.md` §12).
- PGlite ejecuta PostgreSQL dentro del proceso: es adecuado para la prueba, pero en producción usaría un servidor PostgreSQL detrás del mismo puerto `Store`.
