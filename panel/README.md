# Panel de Careonys

La pantalla con la que trabaja la Prestadora: Estado actual, guardias, Asistentes,
Pacientes, reportes y configuración. Está hecha con React y Vite.

---

## Levantar todo contra la base de datos local

Es la forma normal de trabajar. **La base de la nube no se toca para probar**: tiene
datos reales de personas reales. La base local es una copia vacía de la misma
estructura, que se puede romper y rehacer cuantas veces haga falta.

Son cuatro pasos y hay que hacerlos en este orden. Todos los comandos se corren
**parado en `productos/aurevia/`**, salvo donde se aclara otra cosa.

### 1. Arrancar Docker Desktop

La base local corre adentro de Docker. Si Docker no está abierto, el paso 2 falla con
un mensaje sobre `docker API`. Se abre como cualquier programa, desde el menú de
Inicio, y hay que esperar a que el ícono deje de moverse.

### 2. Levantar la base local

```bash
npx supabase start
```

La primera vez se descarga bastante y tarda varios minutos; las siguientes es rápido.
Al terminar imprime las direcciones locales. Las que importan:

| Para qué | Dirección |
|---|---|
| La base y su API | `http://127.0.0.1:54421` |
| Studio, para mirar las tablas con el mouse | `http://127.0.0.1:54423` |
| Los correos que manda el sistema (no salen a internet) | `http://127.0.0.1:54424` |

### 3. Cargar los datos de prueba

```bash
npx supabase db reset
```

Este comando borra la base local, vuelve a aplicar todas las migraciones y al final
carga [`supabase/seed.sql`](../supabase/seed.sql): una Prestadora ficticia llamada
**Sandbox** con sus modalidades, sus zonas, diez cuentas, cuatro Asistentes, tres
Familias con su Paciente y su Servicio, y ocho guardias repartidas entre ayer, hoy y
mañana. Termina imprimiendo la lista de cuentas.

Se puede repetir cuando se quiera: siempre deja la base igual.

> **Las guardias se siembran relativas al día de hoy**, no en fechas fijas. Si la base
> quedó cargada hace una semana, "hoy" ya no tiene nada; se vuelve a correr el mismo
> comando y listo.

**Con quién entrar.** Todas las cuentas usan la contraseña `local-sandbox-2026`. No es
una credencial de nada: solo existe dentro de una base que corre en esta máquina y que
se borra entera en cada reset.

| Rol | Correo |
|---|---|
| Superadmin | `superadmin@sandbox.local` |
| Admin de la Prestadora | `admin@sandbox.local` |
| Coordinadora | `coordinadora@sandbox.local` |
| Asistentes | `ana.asistente@sandbox.local`, y las mismas para bruno, clara y delia |
| Familias | `familia.gomez@sandbox.local`, y las mismas para lopez y morales |

### 4. Levantar el backend y el Panel

Son dos ventanas de línea de comandos, cada una con lo suyo corriendo.

**Ventana 1 — el backend**, parado en `productos/aurevia/backend/`:

```bash
npm run dev
```

Ya hay un archivo `backend/.env.local` apuntando a la base local, pero el backend lee
`.env` (que es la nube) salvo que se le diga lo contrario. Hay que indicárselo con la
variable `DOTENV_CONFIG_PATH` **antes** de arrancar. En PowerShell:

```bash
$env:DOTENV_CONFIG_PATH=".env.local"; npm run dev
```

En una terminal de tipo Linux o macOS:

```bash
DOTENV_CONFIG_PATH=.env.local npm run dev
```

Queda escuchando en `http://localhost:4000`. Para comprobarlo, `http://localhost:4000/health`
tiene que contestar `{"status":"ok"}`.

**Ventana 2 — el Panel**, parado en `productos/aurevia/panel/`:

```bash
npm run dev
```

Acá no hace falta ninguna variable: alcanza con que exista un archivo `panel/.env.local`
apuntando a la base local, porque Vite lo lee antes que `.env` sin que se le pida. Para
volver a la nube se lo renombra o se lo borra.

Ese archivo **no se sube al repositorio** (los `.env` nunca se suben), así que en una
copia recién clonada hay que crearlo. Este es el contenido completo, tal cual:

```
VITE_SUPABASE_URL=http://127.0.0.1:54421
VITE_SUPABASE_ANON_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH
VITE_API_URL=http://localhost:4000
```

Esa clave no es un secreto: es la misma en todas las instalaciones locales de Supabase
del mundo y solo sirve contra `127.0.0.1`.

El Panel queda en `http://localhost:5173`.

---

## Dos trabas conocidas del entorno

**"JWT issued at future" y todo falla.** Pasa cuando la máquina estuvo suspendida: el
contenedor que sirve los datos se despierta con la hora atrasada y rechaza cualquier
pedido. Se arregla reiniciando ese contenedor:

```bash
docker restart supabase_rest_aurevia
```

**El backend está leyendo la nube y no la base local.** Es lo mismo de siempre: arrancó
sin `DOTENV_CONFIG_PATH`. Se corta, se vuelve a arrancar con la variable puesta.

---

## Comandos del Panel

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta el Panel para desarrollar |
| `npm run build` | Arma la versión para publicar |
| `npm run preview` | Muestra esa versión ya armada |
| `npm run lint` | Revisa el código |
| `npm test` | Corre las pruebas |

---

## Para leer antes de tocar algo

- [`CLAUDE.md`](../CLAUDE.md) — las reglas que no se negocian: aislamiento entre
  Prestadoras, glosario obligatorio, nada de texto escrito a mano en el código.
- [`docs/PENDIENTES.md`](../docs/PENDIENTES.md) — lo que está abierto.
- [`docs/PROGRESS.md`](../docs/PROGRESS.md) — lo que ya se hizo y por qué.
