# Bitácora del uso de IA

Registro, mientras se trabaja, de cómo se usó la IA (Claude Code) y dónde hubo que corregirla o decidir distinto. Es la base de la sección «Uso de IA» de la nota.

## Cómo se usó

- **Planificación:** leer el enunciado, la guía de la API y el código de la API simulada para listar las rarezas antes de escribir código. También se investigó qué es Cobrix (cobrix.co) para entender al usuario del panel, un operador de cobranza de un ISP.
- **Exploración de datos por HTTP:** un script volcó los 27 contratos, sus cuotas pendientes y el libro de pagos. Con eso se verificaron a mano los números de §5 (54 filas pendientes − 9 por estado − 2 de moneda incoherente − 1 residual = 42 cuotas, USD 1.235) **antes** de programar las reglas.
- **Código y pruebas:** reglas de dominio como funciones puras con su prueba; después la sincronización y una prueba de punta a punta contra la API real del sandbox.

## Correcciones y decisiones propias

| # | Qué propuso o hizo la IA | Qué se corrigió y por qué |
|---|---|---|
| 1 | El lector del libro rechazaba cualquier monto negativo y, ante una fila ilegible, **descartaba el libro entero del contrato**. | La prueba de punta a punta lo destapó: 900115 (VALENTINA PAZ) tiene una cuota exonerada que la API envía con `descuento: -25`, y eso dejaba sus otras dos facturas «en revisión». El descuento ahora admite signo, porque es la convención de la API, y una fila ilegible solo invalida **su** cuota. Las filas de otro contrato siguen invalidando el libro completo. |
| 2 | Primera versión de «pagada o no»: si la cuota no estaba en el libro pero sí pendiente en el contrato, devolvía «sigue abierta» sin mirar el monto. | Se cambió para comparar también el saldo que reporta el contrato, que podría ser un abono parcial. La ausencia en ambos lados sigue siendo «sin evidencia», nunca «pagada». |
| 3 | Al limpiar el saldo informado por el ISP, lo borraba en **todas** las facturas abiertas. | También borraba el dato de las facturas cuya consulta falló. Ahora solo se limpia en las que se revisaron de verdad. |
| 4 | — | El test original del entorno fallaba en Windows (`new URL(...).pathname` deja `/F:/prueba%20...`). Se corrigió con `fileURLToPath`. No es un error de la IA: es un hallazgo del entorno entregado. |

## Verificado a mano, no asumido

- Que `lista_ids_contratos` sin `estado` devuelve los 27 contratos (con `estado` solo devuelve los activos).
- Que el abono parcial **no** debe rebajar el saldo en Cobrix: 1.235 − 280 = 955 solo cuadra si la factura de LUIS conserva sus USD 20.
- Que la cuota del mes sin cobros aparece en el libro con fecha de fin de mes (2026-10-31). Por eso, si se consulta el libro hasta hoy, no aparece y hay que consultar el contrato.
