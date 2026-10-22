# Gestión de visitas · Infinit Fitness Daganzo

Primera versión de la aplicación privada para registrar contactos, visitas, seguimientos Hot/Warm y altas. Usa Supabase Auth y Postgres con acceso restringido por usuario mediante RLS.

## Preparar Supabase

1. Crea un proyecto Supabase y un usuario de acceso desde **Authentication → Users**.
2. Ejecuta `supabase/migrations/001_contacts.sql` en el SQL Editor.
3. Copia la Project URL y la clave publicable (anon) del proyecto a `supabase-config.js`.
4. La tabla permite que un número de socio aparezca en varias filas. No cargues una clave `service_role` en la aplicación.

## Abrir localmente

Con Node.js instalado, ejecuta `node server.mjs` desde esta carpeta y abre `http://localhost:4173`.

## Importar el historial

Desde **Contactos → Importar Excel**, selecciona el libro `.xlsm`. El importador reconoce las pestañas mensuales, conserva el mes/pestaña y fila de origen y usa una clave de origen para evitar duplicar registros al repetir la carga. Los seguimientos se calculan a partir de la fecha de visita; estados marcados sin visita y altas sin fecha se señalan para revisión. Las filas con alta anterior al contacto también se conservan con una advertencia.

Las altas del panel mensual se agrupan por `alta_date`. Los contactos y visitas se agrupan por el mes de `contact_date`; los recordatorios se ordenan por su fecha prevista (visita + 1 día para Hot y + 8 para Warm). Los ratios mensuales usan las altas del mes frente al volumen de contactos o visitas de ese mes, según la regla que has indicado.

