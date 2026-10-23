# Gestión de visitas · Infinit Fitness Daganzo

Aplicación privada para registrar contactos, visitas, seguimientos Hot/Warm, altas y bajas mensuales. Usa Supabase Auth y Postgres con acceso restringido por usuario mediante RLS.

## Preparar Supabase

1. Crea un proyecto Supabase y un usuario de acceso desde **Authentication → Users**.
2. Ejecuta `supabase/migrations/001_contacts.sql` en el SQL Editor.
3. Ejecuta también `supabase/migrations/002_monthly_cancellations.sql` para activar el contador agregado de bajas y la fecha de última modificación.
4. Ejecuta `supabase/migrations/003_seed_monthly_cancellations.sql` para cargar los totales históricos comunicados (noviembre de 2025 a octubre de 2026). El script actualiza esos meses si ya existían.
5. Copia la Project URL y la clave publicable (anon) del proyecto a `supabase-config.js`.
6. La tabla guarda solo un total por mes; no almacena socios ni fechas individuales de baja. No cargues una clave `service_role` en la aplicación.

## Abrir localmente

Con Node.js instalado, ejecuta `node server.mjs` desde esta carpeta y abre `http://localhost:4173`.

## Importar el historial

Desde **Contactos → Importar Excel**, selecciona el libro `.xlsm`. El importador reconoce las pestañas mensuales, conserva el mes/pestaña y fila de origen y usa una clave de origen para evitar duplicar registros al repetir la carga. Los seguimientos se calculan a partir de la fecha de visita; estados marcados sin visita y altas sin fecha se señalan para revisión. Las filas con alta anterior al contacto también se conservan con una advertencia.

En el mismo proceso se leen los totales de `Bajas del mes` de cada pestaña mensual. Se importan solo los meses que aún no tienen un dato guardado, para conservar cualquier corrección que hayas hecho en la aplicación. Desde **Bajas**, los botones + y − actualizan el total del mes y muestran la última fecha y hora de modificación.

Las altas del panel se agrupan por `alta_date`; los contactos y visitas, por `contact_date`; las bajas, por mes registrado. En periodos personalizados se suman las bajas de los meses que coinciden con el intervalo. El balance muestra altas menos bajas. Los ratios de contactos y visitas usan las altas del mes frente al volumen de contactos o visitas de ese mes, según la regla que has indicado.

