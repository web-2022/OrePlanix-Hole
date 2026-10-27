# Versión web de OREPLANIX-Hole

Sitio estático, sin servidor Node. Los recursos usan rutas relativas compatibles con GitHub Pages bajo el nombre del repositorio.

El frontend conserva la URL y clave **publicable** que ya tenía el proyecto; no incluye contraseñas, claves service_role, fixtures ni sesiones. Cada usuario inicia sesión con su cuenta habitual y Supabase controla permisos mediante RLS/RPC.

Esta publicación NO instala ni modifica nada en Supabase. El nuevo historial depende de get_import_batch_secure, list_import_batches_secure y list_import_batch_rows_secure. Si esas funciones no existen en el entorno remoto, aparece un aviso y los otros módulos siguen disponibles. No se certifica que la integración remota esté completa por el hecho de publicar la página.

La copia de laboratorio y sus usuarios ficticios no forman parte de esta publicación. No intentar iniciar sesión con credenciales ficticias locales.

Validación de código: node --test tests/async-context.test.cjs y node tests/history-core.test.cjs. La validación funcional completa del historial se realizó en laboratorio; no en producción.
