# Recuperación de una restauración interrumpida

Antes de modificar la base, el servidor crea `BACKUP_DIR/.restore-pending.json` con el identificador del backup. Si falla la restauración o su verificación, conserva el mantenimiento, el archivo de control y el directorio temporal de recuperación.

Al iniciar, el servidor comprueba el archivo de control antes de aceptar conexiones. Si existe, sigue en mantenimiento. Un archivo inválido o ilegible impide el arranque. No borrar este archivo para reabrir el servicio: un reinicio no verifica ni repara la base y los adjuntos.

## Procedimiento

1. Identificar el backup de la solicitud fallida o consultar el identificador del archivo de control desde el servidor.
2. Revisar los logs y corregir el problema de almacenamiento, espacio o permisos sin modificar el backup original.
3. Iniciar sesión como administrador si la sesión anterior ya no sirve.
4. Repetir `POST /api/backups/{id}/restore` con `{"confirmation":"RESTAURAR"}`, usando el mismo identificador y los controles de sesión, origen y CSRF habituales. No se puede sustituir por otro backup durante la recuperación.
5. Esperar la respuesta exitosa. El servidor verifica los conteos de registros y compara los nombres y SHA-256 de los archivos restaurados con los extraídos del backup antes de quitar el mantenimiento.
6. Consultar `GET /api/backups/status` y comprobar que `maintenance` sea `false`.

Mientras está bloqueado, solo quedan habilitados salud, estado del backup, autenticación necesaria para recuperar y el reintento de restauración. La restauración sigue exigiendo el permiso `backups:manage`. Los inicios concurrentes se rechazan y los backups automáticos no pueden arrancar.

El reintento vuelve a aplicar el backup completo: no continúa desde el punto exacto del fallo. Mantener disponible la copia original y el volumen de backups entre reinicios. Esta coordinación supone una única instancia del backend; no es un bloqueo distribuido ni una transacción conjunta entre PostgreSQL y el sistema de archivos.
