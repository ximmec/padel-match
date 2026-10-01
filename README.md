# PADEL MATCH

Plataforma para organizar torneos de pádel: inscripciones, zonas, resultados, posiciones automáticas, cuadros eliminatorios, cronograma de canchas, ranking individual acumulativo, exportación a Excel, auditoría y vista pública para jugadores.

Dominio previsto: **padel-match.net**

---

## Índice

1. [Qué incluye](#qué-incluye)
2. [Publicar en Vercel con tu dominio (paso a paso)](#publicar-en-vercel-con-tu-dominio)
3. [Primer uso](#primer-uso)
4. [Copias de seguridad y recuperación](#copias-de-seguridad-y-recuperación)
5. [Reglas y decisiones de funcionamiento](#reglas-y-decisiones-de-funcionamiento)
6. [Arquitectura técnica](#arquitectura-técnica)
7. [Desarrollo local y pruebas](#desarrollo-local-y-pruebas)

---

## Qué incluye

**Panel de administración** (`/admin`)
- Inicio con torneos activos, partidos en juego, pendientes y finalizados, y accesos rápidos.
- Jugadores: alta, edición, baja lógica (se conserva el historial), búsqueda y aviso de posibles duplicados.
- Torneos con varias categorías (masculina, femenina, mixta o libre), cada una con sus propias reglas.
- Inscripciones con validación de género y sin jugadores duplicados en la misma categoría. Incluye cabezas de serie, reemplazos y retiros.
- Zonas automáticas o manuales, de cualquier tamaño. Se puede mover parejas entre zonas sin perder resultados, viendo antes el impacto.
- Carga rápida de resultados (pensada para el celular): set por set, W.O. y abandono. También permite correcciones con historial completo.
- Posiciones automáticas con desempates configurables y sorteo manual registrado.
- Cuadro eliminatorio automático: pases libres, separación de parejas de la misma zona, cruces manuales y recálculo automático al corregir un resultado.
- Cronograma automático por canchas, que respeta la disponibilidad, evita superposiciones de jugadores y aplica descansos mínimos. Se puede ajustar arrastrando partidos y recalcular por retrasos.
- Ranking individual por categoría, circuito, temporada y general, con ajustes manuales justificados.
- Exportaciones a Excel y auditoría completa e inalterable.
- Usuarios con roles (administrador general, organizador, operador de resultados) y permisos ajustables. Cada organizador tiene sus datos separados.

**Vista pública** (sin cuenta, pensada primero para el celular)
- Torneos en curso, próximos y finalizados.
- **¿Cuándo juego?**: buscás tu nombre y ves pareja, zona, próximos partidos, cancha y horario.
- Posiciones, partidos, cuadro y ranking con el historial de puntos.
- Se actualiza sola cuando se cargan resultados u horarios: revisa si hubo cambios cada 15 segundos.

---

## Publicar en Vercel con tu dominio

Vas a necesitar:

| Servicio | Para qué | Costo inicial |
|---|---|---|
| **GitHub** (ya lo tenés) | Guarda el código; Vercel publica desde ahí | Gratis |
| **Vercel** | Hosting de la aplicación | Plan Hobby gratis*; Pro USD 20/mes |
| **Neon** (desde Vercel) | Base de datos PostgreSQL con backups | Gratis para empezar; planes pagos con más retención de backups |
| **Tu registrador de dominio** | Apuntar padel-match.net a Vercel | Ya pagado |

\*Revisá las condiciones de uso del plan Hobby de Vercel. Si el uso es comercial (por ejemplo, si cobrás a organizadores), corresponde el plan Pro.

### Paso 1 · Crear el proyecto en Vercel
1. Entrá a https://vercel.com y tocá **Sign up → Continue with GitHub**.
2. **Add New… → Project** → elegí el repositorio `ximmec/padel-match` → **Import**.
3. Todavía **no** toques "Deploy". Seguí con el paso 2.

### Paso 2 · Crear la base de datos
1. Dentro del proyecto en Vercel: pestaña **Storage → Create Database → Neon (Postgres)**.
2. Elegí la región **São Paulo (sa-east-1)**, que es la más cercana a Argentina, y conectala al proyecto. Vercel crea sola la variable `DATABASE_URL`.

### Paso 3 · Variables de entorno
En **Settings → Environment Variables** agregá:

| Nombre | Valor |
|---|---|
| `APP_URL` | `https://padel-match.net` |
| `SETUP_KEY` | Una clave inventada por vos (ej. `cancha-azul-2026`). Se pide una sola vez para crear el administrador. |

### Paso 4 · Publicar
**Deployments → Redeploy** (o "Deploy" si es la primera vez). El build aplica las migraciones de la base y compila la app. Cuando termine, Vercel te da una dirección `https://padel-match-xxxx.vercel.app` para probar.

### Paso 5 · Conectar padel-match.net
1. En Vercel: **Settings → Domains → Add** → escribí `padel-match.net` y después agregá también `www.padel-match.net`, que redirige al principal.
2. Vercel te muestra qué registros DNS crear. Normalmente son:
   - Tipo **A**, nombre `@`, valor `76.76.21.21`
   - Tipo **CNAME**, nombre `www`, valor `cname.vercel-dns.com`

   Usá siempre los valores exactos que te muestre Vercel, porque pueden variar.
3. Entrá al panel de tu registrador, en la sección DNS de padel-match.net, y creá esos registros. Borrá cualquier registro A o CNAME anterior para `@` o `www` que apunte a otro lado.
4. La propagación tarda entre minutos y algunas horas. Vercel emite el certificado HTTPS automáticamente cuando el dominio queda verificado.

> Hasta que Vercel muestre el dominio como **Valid Configuration**, no está publicado en padel-match.net.

### Actualizaciones
Cada cambio que se sube a la rama `main` de GitHub se publica solo. Antes, GitHub Actions corre todas las pruebas automáticas (pestaña **Actions** del repositorio).

---

## Primer uso

1. Abrí `https://padel-match.net/setup` (o la dirección de Vercel).
2. Ingresá la `SETUP_KEY`, el nombre de tu organización, tu nombre, email y una contraseña de al menos 10 caracteres con letras y números. Este paso solo funciona mientras no exista ningún usuario.
3. En **Configuración**: cargá la sede con sus canchas, las categorías (vienen tres de ejemplo), circuitos y temporadas.
4. **Jugadores**: alta de jugadores.
5. **Torneos → Nuevo torneo**: datos, sede y categorías.
6. En cada categoría: **Inscripciones → Zonas → Reglas → Cuadro**.
7. En el torneo: cargá la **disponibilidad horaria de las canchas** y entrá a **Cronograma → Generar cronograma**.
8. Durante el torneo: **⚡ Resultados** desde el celular.

Para sumar a otras personas: **Configuración → Usuarios y permisos**.

---

## Copias de seguridad y recuperación

1. **Automáticas (Neon):** Neon guarda el historial de la base y permite restaurarla a cualquier momento dentro del período de retención (point-in-time restore). El período depende del plan: es corto en el gratuito y se amplía en los pagos. Se hace desde la consola de Neon → **Branches → Restore**. Conviene restaurar primero en una rama nueva para revisar y después reemplazar.
2. **Manuales (recomendado antes de cada torneo):** `npm run backup` con `DATABASE_URL` de producción genera `backups/padel-match-FECHA.json.gz` con todas las tablas. También podés usar `pg_dump "$DATABASE_URL" > respaldo.sql`.
3. **Historial interno:** los resultados nunca se pisan (tabla `match_result_versions`), la auditoría no se puede modificar ni borrar (lo impide la propia base de datos) y el ranking conserva las asignaciones reemplazadas. Así, la mayoría de los errores se corrigen desde la app, sin restaurar backups.

---

## Reglas y decisiones de funcionamiento

Las que acordamos:

| Tema | Decisión |
|---|---|
| Retiro de una pareja en la zona | Se elige en cada caso. Por defecto: se mantienen los partidos jugados y los pendientes se dan por **W.O.** al rival. La alternativa es anular todos sus partidos. Una pareja retirada nunca clasifica. |
| Comparar zonas de distinto tamaño (ej. mejores segundos) | **Promedios por partido**: % de partidos ganados → diferencia de sets por partido → diferencia de games por partido → games a favor por partido. Opcional por categoría: descontar los partidos contra el último. |
| Orden de desempate por defecto | Partidos ganados → resultado entre sí (empate de 2) → diferencia de sets → diferencia de games → sorteo manual registrado. Se configura por categoría. |
| Acceso de jugadores | Vista pública sin cuenta, buscando por nombre. Nunca se muestran teléfono, email ni documento. |

Criterios adoptados que podés pedir cambiar:

- **Super tiebreak:** cuenta como un set y como un game (1-0) para quien lo gana.
- **W.O.:** el ganador suma los sets necesarios ganados 6-0 (por ejemplo 6-0 6-0).
- **Abandono:** se registran los sets jugados y el resto se completa a favor del ganador.
- **Reemplazo de jugador:** la pareja conserva sus resultados, y los puntos de ranking van a los integrantes vigentes al terminar el torneo. El jugador reemplazado queda en el historial.
- **Cambio de zona:** los partidos ya jugados por esa pareja en la zona anterior quedan anulados (visibles en el historial) y se crean los partidos nuevos.
- **Puntos de ranking:** se asignan cuando el cuadro tiene campeón. Si una corrección cambia el resultado, se reemplazan; nunca se suman dos veces. Los valores por defecto son Campeón 1000, Subcampeón 600, Semifinal 360, Cuartos 180, Octavos 90, 16avos 45, 32avos 25 y Zona 10, configurables por categoría.
- **Cuadro:** los pases libres van a los mejores sembrados (los 1° de zona, en orden A, B, C…). Se evita que dos parejas de la misma zona se crucen en primera ronda y se las ubica en mitades distintas cuando es posible.

---

## Arquitectura técnica

```
src/
├─ core/            Lógica de dominio pura (sin base de datos ni UI), 100 % probada
│  ├─ scoring.ts      formatos y validación de resultados
│  ├─ zones.ts        tamaños de zona, sorteo con siembra, todos contra todos
│  ├─ standings.ts    posiciones, desempates, comparación entre zonas
│  ├─ bracket.ts      cuadro, pases libres, resolución, impacto de cambios, instancias
│  ├─ scheduling.ts   cronograma por canchas, descansos, conflictos, recálculo
│  ├─ ranking.ts      puntos por instancia y agregación
│  └─ engine.ts       combina todo para una categoría
├─ server/          Acceso a datos y operaciones transaccionales
│  ├─ db.ts           cliente PostgreSQL
│  ├─ auth.ts         sesiones (cookie httpOnly) y permisos
│  ├─ ops.ts          operaciones de negocio (cada una en una transacción, con auditoría)
│  ├─ schedule.ts     cronograma de un torneo
│  ├─ ranking.ts      libro contable de puntos
│  ├─ export.ts       Excel
│  └─ actions/        Server Actions que usan los formularios
├─ app/             Next.js (App Router): /admin, vista pública y /api
└─ components/      Componentes de interfaz
db/migrations/      Esquema SQL versionado (se aplica en cada build)
tests/core/         Pruebas de la lógica (8, 9, 10, 11, 12 y 14 parejas, empates, cuadros, etc.)
tests/db/           Pruebas de integración contra PostgreSQL real
```

- **Next.js 15 + React 19 + TypeScript**, desplegado en Vercel.
- **PostgreSQL** (Neon) con migraciones SQL propias. Las restricciones críticas las garantiza la base: un jugador una sola vez por categoría, auditoría inalterable, historial de resultados inmutable y una sola asignación de puntos automática vigente por jugador y torneo.
- **Derivación en lugar de copias:** las posiciones y el cuadro se calculan a partir de los resultados. Cada lugar del cuadro es una referencia ("1° Zona A", "Ganador R1-3"), así que una corrección recalcula todo de forma consistente. Si un partido ya jugado cambia de participantes, su resultado se invalida (queda en el historial) y se pide confirmación antes.
- **Transacciones con bloqueo por categoría:** dos personas cargando resultados a la vez no pueden dejar datos inconsistentes. Además, cada partido tiene un número de versión que detecta ediciones simultáneas.
- **Seguridad:** contraseñas con scrypt, sesiones con token aleatorio guardado como hash, cookies httpOnly/secure/SameSite, bloqueo tras 5 intentos fallidos, verificación de permisos en cada acción del servidor, aislamiento de datos por organizador y cabeceras de seguridad.
- **Tiempo real:** la vista pública consulta `/api/public/version` y se refresca sola si algo cambió. Funciona bien en Vercel y no requiere servicios extra.

---

## Desarrollo local y pruebas

Requisitos: Node.js 20 o superior y PostgreSQL 14 o superior.

```bash
cp .env.example .env.local      # completar DATABASE_URL
npm install
npm run migrate                 # crea las tablas
npm run dev                     # http://localhost:3000 → /setup
```

Pruebas:

```bash
npm test          # lógica de dominio (no necesita base)
npm run test:db   # integración (necesita DATABASE_URL a una base de prueba)
npx tsc --noEmit  # verificación de tipos
```

GitHub Actions corre todo esto, más la compilación y una prueba de humo del servidor, en cada cambio.
