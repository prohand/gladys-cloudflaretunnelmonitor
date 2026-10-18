# Cloudflare Tunnel Monitor

Esta integración vigila sus **túneles de Cloudflare** (`cloudflared`) desde
Gladys: ¿está en línea cada túnel, cuántas conexiones mantiene, y sigue
conectado el `cloudflared` que se ejecuta en su casa? Cada túnel se convierte
en un dispositivo de Gladys, un cambio de estado puede lanzar una escena, y un
widget del panel lo muestra todo de un vistazo.

Solo **lee**: nunca crea, modifica ni elimina un túnel.

## Dos fuentes, use una o las dos

| Fuente    | Lo que necesita                                        | Lo que obtiene                                                       |
| --------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| **Nube**  | Un token de API de Cloudflare y su ID de cuenta        | Todos los túneles de la cuenta, con el estado que calcula Cloudflare |
| **Local** | La dirección de métricas de un `cloudflared` en la red | El estado de ese conector — sigue respondiendo sin Internet          |

Lo mejor es usar las dos: la nube ve todos los túneles, el conector local
sigue respondiendo cuando lo que ha fallado es la conexión a Internet.

### Nube: crear el token de API

1. Abra el panel de Cloudflare y luego **Mi perfil → Tokens de API**
   (<https://dash.cloudflare.com/profile/api-tokens>).
2. **Crear token → Token personalizado → Comenzar**.
3. Póngale un nombre (p. ej. `Gladys`) y añada **un solo** permiso:
   **Cuenta → Cloudflare Tunnel → Lectura**.
4. En **Recursos de la cuenta**, incluya la cuenta que contiene sus túneles.
5. **Continuar al resumen → Crear token**, y copie el token. Cloudflare solo lo
   muestra una vez.

El token es de solo lectura: aunque se filtrara, nadie podría modificar un
túnel con él.

### Nube: encontrar el ID de cuenta

En el panel de Cloudflare, abra su cuenta: el **ID de cuenta** aparece en la
página **Resumen** (columna derecha), o en el menú de la cuenta → **Copiar ID
de cuenta**. Tiene 32 caracteres: cifras y letras de la `a` a la `f`.

### Local: exponer las métricas de cloudflared

`cloudflared` tiene un pequeño servidor de métricas. Por defecto solo escucha
en la propia máquina, en un puerto al azar: dele una dirección fija que Gladys
pueda alcanzar.

- Línea de comandos: añada `--metrics 0.0.0.0:2000`, por ejemplo
  `cloudflared tunnel --metrics 0.0.0.0:2000 run --token <token del túnel>`.
- `config.yml`: añada la línea `metrics: 0.0.0.0:2000`.
- Docker: la misma opción en el comando, y publique el puerto
  (`-p 2000:2000`).

Compruébelo desde otra máquina: `curl http://<host de cloudflared>:2000/ready`
debe responder algo como
`{"status":200,"readyConnections":4,"connectorId":"…"}`.

El servidor de métricas no muestra ningún secreto, pero manténgalo en su red
local: no abra ese puerto a Internet.

## Configuración

| Campo                              | Significado                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Token de API de Cloudflare**     | El token creado arriba. Déjelo vacío para usar solo conectores locales.                        |
| **ID de cuenta de Cloudflare**     | El ID de 32 caracteres encontrado arriba.                                                      |
| **Conectores cloudflared locales** | Direcciones de métricas, separadas por comas: `http://192.168.1.10:2000, http://nas.lan:2000`. |
| **Intervalo de comprobación (s)**  | Segundos entre dos comprobaciones, de 30 a 3600 (60 por defecto).                              |

El interruptor **Preferir la conexión local**, que Gladys muestra bajo el
formulario, decide qué fuente se muestra para un túnel que tiene las dos (vea
más abajo).

Haga clic después en **Probar la conexión**: la respuesta indica, para cada
fuente, qué ha respondido y qué hay que corregir.

## Dispositivos

Los dispositivos aparecen en la pestaña **Descubrir** de la integración:
añada los que quiera seguir.

### Un dispositivo por túnel (nube)

| Función                | Valores                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| **Status**             | `healthy`, `degraded`, `down` o `inactive`                           |
| **Online**             | 1 cuando el túnel transporta tráfico (correcto o degradado), 0 si no |
| **Active connections** | Número de conexiones con la red de Cloudflare                        |

Qué significan los estados, según Cloudflare:

- **healthy** (correcto): el túnel funciona con normalidad;
- **degraded** (degradado): sigue transportando tráfico, pero faltan conexiones
  o conectores;
- **down** (caído): ya no queda ninguna conexión, el túnel no puede transportar
  tráfico;
- **inactive** (inactivo): el túnel nunca se ha ejecutado.

Cambiar el nombre de un túnel en Cloudflare conserva su dispositivo de Gladys:
el dispositivo está ligado al ID del túnel, no a su nombre.

### Un dispositivo por conector local

| Función               | Valores                                             |
| --------------------- | --------------------------------------------------- |
| **Ready**             | 1 cuando el conector mantiene al menos una conexión |
| **Ready connections** | Número de conexiones que mantiene (4 por defecto)   |

### La insignia de cada dispositivo

- **local**: el estado viene de un `cloudflared` de su red;
- **nube**: viene de la API de Cloudflare;
- **inaccesible**: ninguna fuente responde para este dispositivo.

Cuando un conector local sirve un túnel de su cuenta, la integración los
relaciona sola (mediante el ID de conector que indica Cloudflare). Entonces,
con **Preferir la conexión local** activado, el túnel muestra la vista local;
desactivado, la vista de Cloudflare. Si la fuente preferida falla, la otra la
sustituye y la insignia muestra un punto naranja con el motivo.

## Escenas

### Disparadores

- **Un túnel de Cloudflare cambia de estado** — filtro por túnel y por nuevo
  estado. Variables: nombre del túnel, nuevo estado, estado anterior,
  conexiones activas. Ejemplo: «cuando el túnel `home` pase a **Caído**,
  envíame un mensaje».
- **Un conector cloudflared local cambia de estado** — filtro por conector y
  por `Listo`, `No listo`, `Inaccesible`.
- **La API de Cloudflare deja de responder** — se activa una vez cuando la API
  empieza a fallar (token rechazado, cuenta desconocida, sin Internet…), no en
  cada comprobación.

Cada disparador se activa **una vez por cambio**. El último estado conocido se
guarda en disco: un cambio que ocurre mientras Gladys se reinicia también se
detecta.

### Acciones

- **Comprobar los túneles de Cloudflare ahora** — lanza una comprobación al
  momento. Da: número de túneles, túneles correctos, túneles con problemas y
  «todos los túneles correctos» (sí/no), para usar en las acciones siguientes.
- **Leer el estado de un túnel** — da el nombre, el estado, en línea (sí/no) y
  las conexiones activas de un túnel o de un conector local, según la última
  comprobación.

## Widget del panel

Añada el widget **Túneles de Cloudflare** a un panel. Muestra:

- el número de túneles correctos y de túneles con problemas;
- el número de conectores locales listos (si tiene alguno);
- una línea por túnel (los problemas primero) y por conector, con su estado y
  sus conexiones;
- un botón **Comprobar**.

## Solución de problemas

| Mensaje                                                | Qué hacer                                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Cloudflare rechaza el token de API                     | Compruebe el token y su permiso **Cuenta → Cloudflare Tunnel → Lectura**.                           |
| Cloudflare no conoce este ID de cuenta                 | Copie de nuevo el ID de cuenta; compruebe que el token incluye esta cuenta.                         |
| No se puede acceder a la API de Cloudflare             | Compruebe que Gladys tiene acceso a Internet (DNS, cortafuegos).                                    |
| Un conector muestra **sin respuesta**                  | Compruebe `--metrics 0.0.0.0:<puerto>` en cloudflared, el puerto y `curl http://host:puerto/ready`. |
| Un conector responde pero no mantiene ninguna conexión | cloudflared se ejecuta pero no alcanza Cloudflare: consulte sus propios registros.                  |

## Privacidad

El token se guarda en Gladys y solo se envía a `api.cloudflare.com`, por
HTTPS. Nunca se escribe en los registros. Los conectores locales se leen en su
red, sin ningún token.
