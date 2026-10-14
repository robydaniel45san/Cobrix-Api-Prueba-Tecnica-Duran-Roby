# Bitácora de desarrollo y uso de IA

Registro de cómo trabajé con asistencia de IA (Claude Code) y de las correcciones que hice durante el desarrollo. Lo llevé mientras trabajaba, no al final.

## Cómo la usé

Usé la IA como asistente de programación en todas las etapas. Las decisiones de producto y de ingeniería, el criterio para interpretar el enunciado y la revisión de cada resultado fueron míos. La estructura del proyecto y la documentación las desarrollamos en conjunto: yo definí qué necesitaba y cómo debía organizarse, y revisé y ajusté cada propuesta antes de aceptarla.

| Etapa | Uso de la IA | Mi parte |
|---|---|---|
| Análisis | Lectura del enunciado, de la guía de la API y del código de la API simulada para listar sus rarezas. | Definí el alcance, investigué el producto de Cobrix y prioricé lo que más pesa en la evaluación. |
| Exploración | Un script que volcó por HTTP los 27 contratos y el libro de pagos. | Verifiqué a mano los números de §5 antes de escribir reglas (54 − 9 − 2 − 1 = 42 cuotas, USD 1.235,00). |
| Código | Generación de funciones, pruebas y componentes a partir de mis indicaciones. | Revisé el código, corregí los defectos que encontré y decidí cada caso ambiguo (sección 12 del documento de diseño). |
| Pruebas | Redacción de casos a partir de las reglas y de las fallas que quería cubrir. | Definí qué romper a propósito (tokens vencidos, errores 5xx, respuestas contradictorias, concurrencia). |
| Arquitectura | Propuestas de organización del repositorio. | Pedí separar frontend y backend, aplicar capas y poner el ISP detrás de un adaptador; normalizar errores y agregar registro. |
| Documentación | Borradores de diagramas y tablas. | Revisé contenido y redacción, pedí un tono formal y validé cada diagrama. |

## Correcciones durante el desarrollo

| # | Primera versión | Corrección y motivo |
|---|---|---|
| 1 | El lector del libro rechazaba cualquier monto negativo y, ante una fila ilegible, descartaba el libro entero del contrato. | La prueba de punta a punta lo reveló: 900115 (VALENTINA PAZ) tiene una cuota exonerada con `descuento: -25`, y sus otras dos facturas quedaban «en revisión». El descuento ahora admite signo, porque es la convención de la API, y una fila ilegible solo invalida su propia cuota. |
| 2 | Si la cuota no estaba en el libro pero sí pendiente en el contrato, se consideraba «sigue abierta» sin comparar el monto. | Ahora también se compara el saldo del contrato, que podría ser un abono parcial. La ausencia en ambos lados sigue siendo «sin evidencia», nunca «pagada». |
| 3 | El saldo informado por el ISP se limpiaba en todas las facturas abiertas. | También borraba el dato de las facturas cuya consulta había fallado. Ahora solo se limpia en las que se revisaron. |
| 4 | Ante un 401, cada consulta en paralelo iniciaba su propia sesión. | La prueba de token vencido mostró 5 inicios de sesión en vez de 2. Implementé un inicio de sesión único compartido, y el token solo se descarta si sigue siendo el que falló. |
| 5 | Un contrato cuya respuesta no era una lista quedaba excluido sin fila en el detalle de la corrida. | Ahora se registra una fila a nivel de contrato con el motivo, para que el operador vea por qué no entró. |
| 6 | Las facturas se numeraban con una secuencia de PostgreSQL. | Al revisar el panel vi la corrida #34 justo después de la #2: las secuencias pierden valores si el proceso se detiene de golpe. Facturas y corridas pasaron a numerarse «último + 1» dentro de la transacción. Una prueba fija FAC-000001 a FAC-000042. |
| 7 | Las fechas se formateaban suponiendo que la base respondía en UTC. | La base usaba el huso del equipo (`-04`). Fijé la sesión en UTC y el formateador acepta cualquier huso. |
| 8 | Botones con `title` como ayuda. | El `title` reemplazaba el nombre accesible («Simular» se anunciaba como «Hace lo mismo sin escribir nada»). Quité los `title` y di nombres distintos a cada «Simular». |
| 9 | Tablas con desplazamiento horizontal en pantallas angostas. | En un teléfono la deuda quedaba fuera de la vista. Clientes, detalle de corrida y facturas usan tarjetas en pantallas angostas. |
| 10 | En la reorganización por capas, el caso de uso de pagadas guardaba la conexión con el ISP entre corridas. | Habría usado credenciales viejas tras un cambio de configuración. La conexión ahora se crea por corrida y se pasa explícitamente. |
| 11 | El registro de configuración incluía el campo `passwordChanged`. | El enmascarador lo ocultaba por contener «password», lo que confundía al leer el log. Lo renombré `credentialsUpdated`. |
| 12 | El menú se ocultaba por debajo de 1024 px detrás de un desplegable sin fondo ni cierre con Esc, y no se podía plegar en escritorio; los indicadores del resumen quedaban en una grilla de 3 + 2 y la configuración era un bloque único. | Al revisar el panel en varios anchos rediseñé la navegación: menú agrupado (Cartera, Integración), cajón accesible en teléfono, barra de íconos en tablet y barra lateral plegable en escritorio. Las pantallas se organizan en secciones con título y la configuración en categorías. |
| 13 | El panel reflejaba la API: una pantalla por endpoint y términos técnicos («corrida», «importación», contadores internos). | Al usarlo noté que faltaba un flujo coherente para el operador. Diseñé primero un mockup centrado en sus tareas y reconstruí el panel desde ahí: la simulación como paso previo de cada sincronización, lenguaje de negocio, Inicio con a quién cobrar primero y qué necesita atención, y un asistente de primera vez. Al contrastar el mockup con el enunciado recuperé requisitos que había simplificado (las dos acciones por separado, todos los topes, las columnas de Clientes y los campos del Expediente). |
| 14 | — | La prueba original del entorno fallaba en Windows (`new URL(...).pathname` deja `/F:/prueba%20...`). La corregí con `fileURLToPath`. Es un hallazgo del entorno entregado. |

## Verificado a mano

- Que `lista_ids_contratos` sin `estado` devuelve los 27 contratos; con `estado`, solo los activos.
- Que el abono parcial no debe rebajar el saldo en Cobrix: 1.235 − 280 = 955 solo cuadra si la factura de LUIS GOMEZ conserva sus USD 20.
- Que la cuota del mes sin cobros aparece en el libro con fecha de fin de mes, por lo que al consultar hasta hoy hay que verificarla en el contrato.
- Que el panel muestra los mismos números que las pruebas, recorriendo el ciclo completo en el navegador, en escritorio y en teléfono.
