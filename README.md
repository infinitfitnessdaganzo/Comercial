# Gestión de visitas · Infinit Fitness Daganzo

Aplicación privada para registrar contactos, visitas, seguimientos Hot/Warm, altas y bajas mensuales. Usa Supabase Auth y Postgres con acceso restringido por usuario mediante RLS.

## Preparar Supabase

1. Crea un proyecto Supabase y un usuario de acceso desde **Authentication → Users**.
2. Ejecuta `supabase/migrations/001_contacts.sql` en el SQL Editor.
3. Ejecuta también `supabase/migrations/002_monthly_cancellations.sql` para activar el contador agregado de bajas y la fecha de última modificación.
4. Ejecuta `supabase/migrations/003_seed_monthly_cancellations.sql` para cargar los totales históricos comunicados (noviembre de 2025 a octubre de 2026). El script actualiza esos meses si ya existían.
5. Ejecuta `supabase/migrations/004_contact_followup_options.sql` para permitir activar Hot y Warm por contacto, también cuando no hubo visita.
6. Ejecuta `supabase/migrations/005_custom_followup_dates.sql` para guardar fechas personalizadas de Hot y Warm.
7. Copia la Project URL y la clave publicable (anon) del proyecto a `supabase-config.js`.
8. La tabla guarda solo un total por mes; no almacena socios ni fechas individuales de baja. No cargues una clave `service_role` en la aplicación.

## Abrir localmente

Con Node.js instalado, ejecuta `node server.mjs` desde esta carpeta y abre `http://localhost:4173`.

El apartado **Altas y bajas** permite actualizar el contador mensual y muestra el histórico de altas, bajas y balance (altas menos bajas), además de sus totales.

Las altas se agrupan por `alta_date`; los contactos y visitas, por `contact_date`; las bajas, por mes registrado. En periodos personalizados se suman las bajas de los meses que se solapan con el intervalo. El balance muestra altas menos bajas. Los ratios de contactos y visitas se calculan con las altas del periodo frente al volumen de contactos o visitas correspondiente.

