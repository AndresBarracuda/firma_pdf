Despliegue de prueba (acceso desde equipo cliente)

Objetivo
- Levantar una instancia de prueba del proyecto para poder acceder desde otra máquina de la red (o desde Internet, con precaución).

Requisitos
- Python 3.8+ instalado en el servidor
- Acceso a la máquina servidor para instalar dependencias y abrir puertos

Pasos mínimos
1) Crear y activar virtualenv

```bash
python3 -m venv .venv
source .venv/bin/activate
```

2) Instalar dependencias

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

3) Configurar variables de entorno (opcional)
- Para permitir hosts específicos (recomendado en red pública):

```bash
export DJANGO_ALLOWED_HOSTS="192.168.1.10,localhost"
```

Si no estableces `DJANGO_ALLOWED_HOSTS`, el proyecto permitirá cualquier host cuando `DEBUG=True` (configuración para pruebas).

4) Migraciones

```bash
python manage.py makemigrations
python manage.py migrate
```

5) Recopilar estáticos (si vas a usar gunicorn/nginx)

```bash
python manage.py collectstatic --noinput
```

6) Abrir el puerto en el firewall (ejemplo con ufw)

```bash
sudo ufw allow 8000/tcp
```

7) Ejecutar el servidor de desarrollo (no recomendado en producción, pero válido para pruebas locales)

```bash
python manage.py runserver 0.0.0.0:8000
```

o ejecutar con gunicorn (más apropiado para exponer en red de pruebas):

```bash
gunicorn firmas_pdf.wsgi:application --bind 0.0.0.0:8000 --workers 3
```

8) Conectar desde el equipo cliente
- En el navegador del cliente entra a: `http://<IP_DEL_SERVIDOR>:8000/`
- O desde la terminal del cliente:

```bash
curl http://<IP_DEL_SERVIDOR>:8000/
```

Notas de seguridad
- Esta configuración es para pruebas/QA. No uses `DEBUG=True` ni `ALLOWED_HOSTS=['*']` en producción.
- Si vas a exponer el servicio a Internet, coloca un proxy (nginx) delante y usa HTTPS.
- Considera proteger el endpoint de subida (`/api/signatures/upload/`) con autenticación o tokens CSRF.

Siguientes pasos opcionales
- Configurar Gunicorn + Nginx y certbot para HTTPS.
- Añadir autenticación (JWT / session) para proteger endpoints.
- Implementar rate-limiting y logging de accesos.
