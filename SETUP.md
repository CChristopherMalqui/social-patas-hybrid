# Configurar Social Patas Hybrid con cuentas de usuario

La app ahora guarda todo en la nube (Supabase) y cada amigo entra con su correo y
contraseña. Todos ven el mismo tablero y los cambios aparecen en tiempo real.

Solo tienes que hacer esto **una vez**. Toma ~10 minutos.

---

## 1. Crear el proyecto en Supabase (gratis)

1. Entra a https://supabase.com y crea una cuenta (puedes usar tu Google).
2. Clic en **New project**.
   - Elige un nombre (ej. `social-patas`).
   - Pon una contraseña de base de datos (guárdala, no la usarás a diario).
   - Región: la más cercana (ej. *South America (São Paulo)*).
3. Espera 1–2 minutos a que el proyecto termine de crearse.

## 2. Crear las tablas

1. En el menú lateral abre **SQL Editor** → **New query**.
2. Abre el archivo **`schema.sql`** de esta carpeta, copia TODO su contenido y pégalo.
3. Clic en **Run**. Debe decir *Success*.

## 3. Conectar la app con tu proyecto

1. En Supabase ve a **Project Settings** (engranaje) → **API**.
2. Copia estos dos valores:
   - **Project URL**
   - **anon `public`** (en *Project API keys*)
3. Abre el archivo **`config.js`** de esta carpeta y pégalos:

   ```js
   window.SP_CONFIG = {
     SUPABASE_URL: "https://xxxxxxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi...."
   };
   ```

   > La `anon key` es pública y segura de compartir: quien manda es la seguridad
   > (RLS) que ya quedó configurada con el `schema.sql`.

## 4. (Recomendado) Quitar la confirmación por correo

Para que tus amigos entren al instante al registrarse, sin tener que abrir su correo:

1. En Supabase ve a **Authentication** → **Providers** → **Email**
   (o **Authentication** → **Sign In / Providers** según la versión).
2. Desactiva **Confirm email** y guarda.

> Si prefieres dejarlo activado, funciona igual, pero cada amigo deberá hacer clic
> en el enlace que le llegue por correo antes de poder entrar.

## 5. ¡Listo! Compartir con tus amigos

Cada quien abre `socialpatas.html`, toca **"Regístrate"**, pone su nombre, correo y
contraseña, y empieza a usarlo. Sus planes y anécdotas quedan firmados con su nombre.

---

## Recomendado: publicarlo con un link

Abrir el `.html` desde el archivo funciona, pero lo ideal es subirlo a internet para
darles **un solo enlace**. Es gratis:

- **Netlify Drop**: entra a https://app.netlify.com/drop y arrastra la carpeta
  completa (con `socialpatas.html`, `styles.css`, `app.js`, `config.js`). Te da un
  link al instante.
- O **Vercel** / **GitHub Pages** si prefieres.

Sube siempre los 4 archivos juntos (no subas `schema.sql` ni este `SETUP.md`,
aunque no pasa nada si lo haces).

---

## Preguntas frecuentes

**¿Se pierde la info si reinicio la PC o cierro el navegador?**
No. Ahora vive en la nube. Puedes entrar desde tu celular, otra PC u otro navegador
con tu mismo correo y verás todo.

**¿Cuánto cuesta?**
El plan gratis de Supabase alcanza de sobra para un grupo de amigos.

**¿Quién puede borrar las cosas?**
Cada quien solo puede borrar lo que él mismo creó. El botón de borrar (la ✕) solo
aparece en tus propias publicaciones.

**¿Puedo cambiar quién entra?**
Sí. En Supabase → **Authentication** → **Users** puedes ver y eliminar usuarios.
