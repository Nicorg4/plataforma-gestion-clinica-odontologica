# Deployment

Guía para instalar el sistema en un servidor Ubuntu del consultorio, accesible desde la red local. Todo corre con Docker Compose: `postgres`, `backend` (aplica las migraciones al iniciar), `frontend` y `proxy` (Caddy con HTTPS).

## Requisitos

- Ubuntu Server 22.04 o 24.04, con acceso a Internet durante la instalación.
- 2 núcleos, 4 GB de RAM y 20 GB libres como mínimo.
- Un segundo disco (o un disco USB) para los backups, distinto del de los datos.
- Una IP fija en la red local (o un nombre, como `consultorio.local`).
- Puertos 80 y 443 libres (configurables con `HTTP_PORT` y `HTTPS_PORT`).

Sin Internet, el sistema sigue funcionando en la red local mientras el servidor esté encendido. Lo único que necesita Internet es WhatsApp, para mandar los recordatorios.

## Instalación con el script

```bash
git clone <url-del-repositorio> sistema
cd sistema
sudo infra/deploy/install.sh 192.168.0.10
```

El argumento es la IP o el nombre con el que los usuarios van a abrir el sistema. El script:

1. instala Docker Engine, Buildx y Compose desde el [repositorio oficial de Docker](https://docs.docker.com/engine/install/ubuntu/), si Docker no está instalado; si ya está, comprueba que ambos plugins estén disponibles;
2. crea `.env` con permisos 600 a partir de `.env.example`, con una clave aleatoria para la base, `NODE_ENV=production`, `SITE_ADDRESS` y `PUBLIC_ORIGIN`. Si ya existe, conserva su contenido y comprueba que dirección y origen coincidan con el argumento y el puerto configurado;
3. levanta todo con `docker compose up -d --build --wait` y verifica `/api/health`;
4. muestra el código de instalación para el asistente y copia el certificado de la red local a `caddy-root.crt`.

El argumento admite un nombre DNS o una IPv4, sin `https://`, puerto ni ruta. Para un puerto HTTPS distinto de 443, preparar previamente `.env` con `HTTPS_PORT` y `PUBLIC_ORIGIN=https://nombre:puerto`; el script rechaza un origen diferente para evitar fallos de las escrituras por CSRF. Si Docker ya existe y falta un plugin, seguir la guía oficial antes de volver a ejecutar el instalador. Este script está destinado a un servidor Ubuntu nuevo y no desinstala paquetes Docker de otras distribuciones.

## Instalación manual

```bash
cp .env.example .env
```

Editar `.env`: cambiar `POSTGRES_PASSWORD` (y `DATABASE_URL`, para que coincida), y poner en `SITE_ADDRESS` y `PUBLIC_ORIGIN` la dirección del servidor. `PUBLIC_ORIGIN` debe ser exactamente la dirección con la que se abre la app (con el puerto si no es el 443): el backend la usa para validar el origen de las escrituras.

```bash
docker compose up -d --build --wait
curl -k https://192.168.0.10/api/health
```

## Primer ingreso

En una instalación nueva, el backend imprime en su registro un código de instalación de un solo uso:

```bash
docker compose logs backend | grep codigo
```

Al abrir la aplicación aparece el asistente de configuración inicial (organización, primera sede y primer administrador), que pide ese código. Una vez completado, deja de estar disponible. Si el servidor se reinicia antes de terminarlo, se genera un código nuevo.

Para una demostración, `npm run demo:seed` (desde `backend/`, con `DATABASE_URL` apuntando a la base) carga datos sintéticos sobre una instalación recién configurada. No corre en producción.

## HTTPS en la red local

Caddy emite los certificados con su CA interna (`tls internal`). Cada dispositivo que acceda tiene que confiar en el certificado raíz de esa CA:

```bash
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Ese archivo se instala como autoridad certificadora de confianza en cada computadora, tablet o celular. En Windows: doble clic, «Instalar certificado», «Equipo local», almacén «Entidades de certificación raíz de confianza». En Android y iOS se instala desde los ajustes de seguridad.

## Datos y volúmenes

| Volumen | Contenido |
|---|---|
| `pgdata` | Base de datos PostgreSQL |
| `clinical_files` | Archivos clínicos (PDF, JPG, PNG), fuera de cualquier carpeta pública |
| `backups` | Paquetes de backup y su registro |
| `caddy_data` | Certificados y CA interna del proxy |

## Backups

El backend hace backups automáticos con la frecuencia y la hora que se configuran mediante la API administrativa (`PUT /api/organization/settings`) (por defecto, todos los días a las 3) y conserva, salvo que se cambie por esa API, 7 diarios, 4 semanales y los últimos 10 manuales. Desde Administración › Backups se generan a mano, se descargan y se restauran.

Para que los backups queden en otro disco, montarlo (por ejemplo en `/mnt/backups`) y crear un `docker-compose.override.yml`:

```yaml
services:
  backend:
    volumes:
      - /mnt/backups:/app/backups
```

El directorio tiene que ser escribible por el usuario `node` del contenedor (UID 1000): `sudo chown 1000:1000 /mnt/backups`.

Se recomienda además copiar periódicamente los paquetes (`backup-*.tar` y su `.json`) a un medio fuera del consultorio. Contienen datos clínicos: guardarlos cifrados y con acceso restringido.

### Restauración

Desde Administración › Backups › Restaurar, escribiendo `RESTAURAR`. El sistema verifica el checksum y que el backup sea de la misma versión, entra en mantenimiento, restaura la base y los archivos y comprueba los conteos antes de volver a operar. Lo cargado después de ese backup se pierde.

Si falla la restauración o su verificación, el mantenimiento persiste incluso después de reiniciar. Seguir el [procedimiento de recuperación](backup-recovery.md), conservando el backup original y el archivo de control; el reintento vuelve a aplicar el mismo paquete y verifica datos y adjuntos antes de reabrir el servicio. Esta coordinación admite una única instancia del backend.

## Actualizar a una versión nueva

```bash
git pull
docker compose up -d --build --wait
```

Antes de actualizar, generar un backup manual. Las migraciones de la base se aplican solas al iniciar el backend. Un backup solo se puede restaurar en la misma versión con la que se generó.

## Seguridad del servidor

- Mantener Ubuntu actualizado (`sudo apt update && sudo apt upgrade`) y activar las actualizaciones automáticas de seguridad.
- Abrir solo los puertos 80 y 443 hacia la red local (`ufw allow 80,443/tcp`), y SSH solo si se administra a distancia.
- Cifrar el disco del servidor y el de los backups (control de infraestructura, no de la aplicación).
- `.env` queda con permisos 600: no copiarlo fuera del servidor.

## Acceso desde fuera del consultorio

No forma parte de esta versión. La opción recomendada es una VPN (WireGuard) hacia la red del consultorio, sin exponer el sistema directamente a Internet.
