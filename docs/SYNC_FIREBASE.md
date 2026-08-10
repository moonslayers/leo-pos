# Sincronización Firebase Firestore — POS Leonides

Guía de configuración y plantilla de seguridad para la sincronización de la base local
(IndexedDB / localStorage) con **Firebase Firestore** desde el navegador, sin backend propio.

---

## 1. Qué hace el sync

### Modelo local-first

- **El navegador local es la fuente de verdad.** La app sigue leyendo y escribiendo
  desde IndexedDB (fallback a localStorage) a través de `getStorage()`; la
  sincronización actúa por **snapshots completos**: sube los cambios locales a
  Firestore y descarga los cambios de la nube al dispositivo.
- **Dispositivo nuevo**: si un dispositivo detecta datos en la nube, descarga e
  importa todo (re-idenciación de IDs numéricos locales a IDs globales con `_gid`).
- **Conflictos (local-first)**: el dispositivo que hace **push sobrescribe la nube**
  (gana el último push, no se compara por timestamps contra lo remoto). Al descargar
  (pull) solo se aplica una versión remota de **otro dispositivo** si su `_updatedAt`
  es mayor que el último `_updatedAt` local conocido de ese registro (`SyncMeta.updatedAt`).
  Si el push de una store falla, esa store **no se descarga** en ese ciclo, para no pisar
  ediciones locales que aún no se subieron. Los registros eliminados se marcan con
  tombstones `_deleted` en la nube antes de olvidarse localmente.

### Cuándo se sincroniza

- Automáticamente cada intervalo configurado (default 5 min) y al abrir la app.
- Manualmente con el botón **Sincronizar ahora** en Ajustes → Sincronización.

### Qué se sincroniza

Las 4 stores de la base local: **productos**, **ventas**, **clientes** y **abonos**.

### Dónde se guarda cada cosa

| Dato | Dónde vive |
|------|------------|
| Config Firebase (apiKey, projectId, appId…) | localStorage (`leonides_sync_v1`) de cada dispositivo |
| **syncToken** (llave compartida) | localStorage de cada dispositivo **y** como segmento del **path** de Firestore (`pos/{syncToken}/...`). No se guarda como campo de los documentos, pero sí forma parte de la ruta |
| Datos de negocio | Firestore, bajo el path protegido `pos/{syncToken}/{store}/{gid}` |

El `syncToken` es una llave aleatoria de 128-bit que se genera en el **primer
dispositivo** y se copia a los demás. Es la "contraseña" que permite leer y
escribir en la base: solo quien lo conoce puede acceder a los datos. **No es un
secreto absoluto**: viaja en el path de cada documento (y la UI lo muestra en
Ajustes → Sincronización), así que su protección depende de que no se filtre.

---

## 2. Setup del proyecto Firebase (plan gratuito Spark)

1. Entra a <https://console.firebase.google.com> con tu cuenta de Google y pulsa
   **Add project** (Crea un proyecto). Ponle un nombre (p. ej. `leo-pos`).
2. Acepta la configuración predeterminada y crea el proyecto.
3. En el menú lateral: **Build → Firestore Database** y pulsa **Create database**
   (Crear base de datos).
   - Elige la región más cercana a tu operación (o la default).
   - Modo **production mode** (el más restrictivo por defecto, ideal para
     fire-and-forget con Security Rules).
4. Registra una **app web** para el proyecto:
   - **Project Overview (Vista general) → Agregar app → Web** (ícono `</>`).
   - Pónle un nombre (p. ej. `pos-web`) y registra la app.
   - Copia el objeto `firebaseConfig` que se muestra (o bótalo desde
     **Project settings → Tus apps → Configuración del SDK web**):
     ```js
     const firebaseConfig = {
       apiKey: "AIza...",
       authDomain: "leo-pos.firebaseapp.com",
       projectId: "leo-pos",
       storageBucket: "leo-pos.appspot.com",
       messagingSenderId: "123456789",
       appId: "1:123456789:web:abcdef",
     };
     ```
5. **No es necesario habilitar Firebase Auth ni Authentication.** Este proyecto no
   usa usuarios: la seguridad se delega por completo a las **Security Rules**, que
   exigen el `syncToken` en el path de cada documento.

---

## 3. Plantilla de Firestore Security Rules

Pégala en la consola de Firebase: **Build → Firestore Database → Rules** (Reglas),
reemplazando `<SYNC_TOKEN>` por el token real (ver sección 4) y pulsa **Publish**
(Publicar).

```js
rules_version = '2';

service cloud.firestore {

  match /databases/{database}/documents {

    // ------------------------------------------------------------------
    //  RUTA DE SINCRONIZACIÓN: pos/{syncToken}/{store}/{docId}
    // ------------------------------------------------------------------
    //  Única ruta accesible. Todo documento de sincronización vive bajo
    //  este path, donde {syncToken} es la llave compartida entre
    //  dispositivos. Los datos SOLO son legibles/escritibles si el
    //  syncToken del path coincide exactamente con el token esperado.
    //
    //  > REEMPLAZA <SYNC_TOKEN> por el token que genera la app en
    //  > Ajustes → Sincronización (botón "Sincronizar ahora" / "Iniciar
    //  > sync"). Si los dispositivos usan otro token, quedan fuera.
    // ------------------------------------------------------------------
    match /pos/{syncToken}/{store}/{docId} {

      // El token coincide: se permite leer y escribir.
      // write incluye create, update y delete.
      allow read, write: if syncToken == '<SYNC_TOKEN>';

    }

    // ------------------------------------------------------------------
    //  DEFAULT DENY: todo lo demás queda bloqueado.
    //  Sin reglas explícitas, Firestore deniega por defecto; se deja
    //  constancia aquí de que ninguna otra ruta (ni subruta) es accesible.
    // ------------------------------------------------------------------
    match /{document=**} {
      allow read, write: if false;
    }

  }

}
```

> **Fuente de verdad**: esta plantilla es idéntica a la constante `RULES_TEMPLATE`
> de `src/core/constants.ts`, que es la que la app copia con el botón
> **📋 Copiar Security Rules** (Ajustes → Sincronización). Si editas una, refleja
> el cambio en la otra para que no diverjan.

### Explicación bloque por bloque

| Bloque | Qué hace |
|--------|----------|
| `rules_version = '2';` | Usa la sintaxis moderna de reglas (requerida para `match` recursivo). |
| `match /pos/{syncToken}/{store}/{docId}` | Captura el token y el store/producto del path; sin esto no hay forma de saber si el llamador tiene permiso. |
| `allow read, write: if syncToken == '<SYNC_TOKEN>';` | **Toda la seguridad.** Solo quien llama con el syncToken correcto puede leer/escribir documentos de ese subárbol. |
| `match /{document=**} { allow read, write: if false; }` | Cierra explícitamente cualquier otra ruta del proyecto (deny por defecto reforzado). |

> **Importante**: las reglas se evalúan en Firestore, nunca en el navegador. Puedes
> cambiar el token en las reglas en cualquier momento, y los dispositivos que no lo
> actualicen perderán el acceso.

---

## 4. Configuración en la app (por dispositivo)

### Primer dispositivo (la PC) — genera el token

1. Abre el POS en la PC y ve a **Ajustes → Sincronización**.
2. Pega el `firebaseConfig` (apiKey, projectId, appId, etc.) en los campos de
   configuración Firebase.
3. Pulsa **Iniciar sync / Generar token**: la app genera el `syncToken`
   (128-bit) y lo guarda en localStorage de esta PC.
4. Pulsa **Sincronizar ahora** para subir los datos actuales a Firestore.
5. **Copia el syncToken** que muestra la app (y guárdalo en un lugar seguro).

### Segundo dispositivo (el celular) — mismo token, mismo proyecto

1. Abre el POS en el celular y ve a **Ajustes → Sincronización**.
2. Pega el **mismo** `firebaseConfig` (mismo `projectId`).
3. Pega el **mismo syncToken** copiado desde la PC.
4. Pulsa **Sincronizar ahora**: el dispositivo detecta los datos en la nube y los
   importa (descarga completa local-first).

> Ambos dispositivos deben compartir **proyecto Firebase** y **syncToken**. Si uno
> de los dos usa un token distinto, no verá los datos del otro.

### Referencia: config Firebase vs syncToken

| Campo | Dónde se pega | Mismo en todos los dispositivos |
|-------|---------------|---------------------------------|
| `apiKey`, `projectId`, `appId`, … | Ajustes → Sincronización (config Firebase) | Sí |
| `syncToken` | Ajustes → Sincronización (token compartido) | Sí |
| `deviceId` | Lo genera la app por dispositivo | No (identifica cada dispositivo) |

---

## 5. Nota de seguridad

- El **apiKey web de Firebase es público por diseño**: viaja en el bundle del
  frontend y cualquiera puede leerlo. No es un secreto; la protección real son las
  **Security Rules**, que bloquean todo lo que no pase por el syncToken correcto.
- **NO compartas el syncToken públicamente.** Es la llave maestra de tus datos
  (productos, ventas, clientes, abonos). No lo subas a chats públicos ni a
  repositorios.
- Recuerda que el syncToken **no se guarda como campo de los documentos**, pero
  **sí aparece como parte del path** `pos/{syncToken}/...` en Firestore y lo
  muestra la UI en Ajustes. Quien lo conozca (aunque sea por una captura de
  pantalla) puede leer y escribir toda la base: trata de no exponerlo.
- Si el syncToken se filtra o sospechas que alguien lo tiene: **regenera el token**
  en la app y actualiza `<SYNC_TOKEN>` en las Security Rules (punto 3) en el mismo
  proyecto. Los dispositivos legítimos deben actualizar su token en Ajustes.
- La config Firebase y el `deviceId` viven **solo en localStorage** de cada
  dispositivo — nunca se sincronizan a la nube.

---

## 6. Troubleshooting breve

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| El sync no conecta | `projectId` / `apiKey` incorrectos o de otro proyecto | Verifica la config Firebase pegada en Ajustes contra la de la consola (Settings → Tus apps). |
| Permiso denegado (error de reglas) | Rules no publicadas o `<SYNC_TOKEN>` viejo | Publica la plantilla de la sección 3 con el token actual. |
| El celular no ve datos de la PC | syncToken distinto entre dispositivos | Confirma que ambos usan exactamente el mismo token y proyecto. |
| Solo se sincroniza un lado | Intervalo aún no ejecutado o token no compartido | Pulsa **Sincronizar ahora** en ambos y revisa el reporte de resultado (subidos / importados / errores). |

---

## 7. Limitaciones conocidas

- **Una sola pestaña sincroniza a la vez.** El guard anti-concurrencia es por
  módulo: si tienes el POS abierto en dos pestañas del mismo navegador, ambas
  podrían sincronizar simultáneamente y la última escritura remota gana. Usa una
  sola pestaña por dispositivo.
- **El push sube la base completa por store (snapshot), no diffs.** Es simple y
  robusto para el volumen del negocio, pero cada ciclo de sync re-escribe todos los
  registros locales (costo mayor con bases muy grandes). Un batching/`Promise.all`
  por store es una optimización pendiente (`TODO` en `src/services/sync.ts`).
- **Los tombstones que quedan huérfanos en la nube no se limpian.** Al borrar un
  registro localmente se marca `_deleted` en Firestore y se olvida el `_gid`
  local; el documento `_deleted` remoto permanece (ocupa muy poco) y no se
  re-envía en ciclos futuros.
