# Nota de entrega

Roby Durán · Prueba técnica de Cobrix · octubre de 2026

## Qué entrego

La integración completa del enunciado: importación y actualización de pagadas, cada una con su simulación, historial de corridas con detalle por cuota, corrida automática diaria y un panel con resumen, sincronización, clientes, expediente y configuración. Los criterios de aceptación de §5 se cumplen con los valores exactos y lo comprueba una prueba automática contra la API real del sandbox (72 pruebas en total). El detalle de cada requisito y su evidencia está en [VERIFICACION.md](VERIFICACION.md).

## Decisiones principales

- **No inferir.** Toda respuesta que se contradice (filas de otro contrato, cuotas duplicadas, estado desconocido, cabecera inconsistente) deja el contrato fuera con su motivo. Una factura solo se marca pagada con evidencia completa en el libro: filas coincidentes, saldo cero y monto pagado.
- **Corridas de todo o nada.** Primero leo y decido todo; después escribo en una sola transacción. La simulación ejecuta exactamente la misma lógica sin la segunda fase, y una corrida que falla no deja datos a medias.
- **Arquitectura en capas.** Separé frontend y backend. En el backend, el dominio es puro, los casos de uso dependen de puertos y el administrador de facturas queda detrás de un adaptador que traduce su JSON al dominio. Integrar otro sistema de ISP implicaría escribir un adaptador nuevo, sin tocar las reglas.
- **PostgreSQL embebido (PGlite).** Es PostgreSQL real dentro del proceso: el evaluador solo ejecuta `npm install && npm start`. En producción lo reemplazaría por un servidor PostgreSQL sin cambiar los casos de uso.
- **Montos en centavos enteros**, porque la API envía decimales como `24.998683`.
- **Ambigüedades del enunciado.** Las resolví y documenté en [DISENO.md §12](DISENO.md#12-decisiones-de-diseño). Las más relevantes: la moneda es incoherente solo si todas las cuotas del contrato están bajo el 1 % del plan; al alcanzar un tope, la corrida frena todo lo siguiente; un abono parcial se informa pero no altera el saldo de Cobrix; una cuota exonerada queda en revisión, no pagada.

## Qué dejé fuera

- Pruebas automáticas de la interfaz en el navegador. Verifiqué el panel recorriendo el ciclo completo de forma manual, en escritorio y en teléfono.
- Autenticación y roles de usuario en el panel; el enunciado no los pide.
- Actualización de los datos de contacto del cliente en importaciones posteriores: se registran al crearlo.
- Soporte de varias monedas y de varios proveedores a la vez. El modelo de datos ya relaciona cada corrida con su proveedor, para habilitarlo después.

## Qué haría con más tiempo

- Pruebas de extremo a extremo del panel con Playwright.
- Exportar a CSV la cartera y el detalle de una corrida.
- Alertas por correo o WhatsApp cuando una corrida falla o cuando hay facturas en revisión.
- Un adaptador de PostgreSQL de servidor y un `docker compose` para desplegar en un comando.
- Paginación del lado del servidor para carteras de miles de clientes.

## Punto diferencial

- **Progreso de corridas en vivo** (Server-Sent Events): el operador ve contrato por contrato mientras corre, también desde otra pestaña.
- **Antigüedad de la deuda** en el resumen, con los clientes que pasaron su fecha de corte: ayuda a decidir a quién cobrar primero.
- **Contadores con el nombre interno de Cobrix** en el detalle de cada corrida, para que operación y soporte hablen el mismo idioma.
- **Robustez verificada con fallas inyectadas**, numeración de facturas sin huecos, registro estructurado sin secretos y un formato único de errores en la API.
- **Documentación de diseño** con casos de uso, contratos de API y 15 diagramas.

## Uso de IA

Trabajé con Claude Code como asistente en todas las etapas: análisis del enunciado, exploración de la API, código, pruebas y documentación. Las decisiones, el criterio y la revisión fueron míos; la estructura y la documentación las desarrollamos en conjunto. Corregí doce puntos durante el desarrollo: cuatro los detectaron las pruebas que diseñé para romper el sistema y el resto, la revisión del código y del panel en el navegador. El caso más ilustrativo: la primera versión del lector del libro descartaba el libro entero de un contrato ante una cuota exonerada con descuento negativo. El detalle está en la [bitácora](BITACORA-IA.md).
