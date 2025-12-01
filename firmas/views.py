import base64
import imghdr
import uuid
from django.shortcuts import render
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.csrf import csrf_exempt
from django.core.files.base import ContentFile
from datetime import datetime
from django.utils import timezone
from .models import Signature


def index(request):
	"""Renderiza la plantilla principal de la app de firma."""
	return render(request, 'firma.html')


@csrf_exempt
def upload_signature(request):
	"""Endpoint para subir una firma/huella enviada como data URL base64.

	Espera JSON con campos:
	- image: data URL (p. ej. data:image/png;base64,...)
	- filename: opcional
	- template: opcional (plantilla de huella)
	"""
	if request.method != 'POST':
		return HttpResponseBadRequest('Método no permitido')

	# Intentar parsear JSON
	try:
		import json
		payload = json.loads(request.body.decode('utf-8'))
	except Exception:
		return HttpResponseBadRequest('JSON inválido')

	image_data = payload.get('image')
	if not image_data:
		return HttpResponseBadRequest('Campo "image" es requerido')

	# Soporta data URLs: data:<mime>;base64,<data>
	if image_data.startswith('data:'):
		try:
			header, b64 = image_data.split(',', 1)
		except ValueError:
			return HttpResponseBadRequest('image debe ser una data URL con base64')
	else:
		# Si envían solo base64, lo aceptamos también
		b64 = image_data

	try:
		decoded = base64.b64decode(b64)
	except Exception:
		return HttpResponseBadRequest('Base64 inválido')

	# Detectar tipo de imagen
	img_type = imghdr.what(None, h=decoded) or 'png'
	filename = payload.get('filename') or f"sig_{uuid.uuid4().hex}.{img_type}"

	content = ContentFile(decoded)
	sig = Signature()
	sig.filename = filename
	if payload.get('template'):
		sig.template = payload.get('template')
	# Guardar el archivo en el ImageField
	sig.image.save(filename, content, save=True)

	image_url = request.build_absolute_uri(sig.image.url)

	return JsonResponse({
		'success': True,
		'image_url': image_url,
		'id': sig.id,
		'message': 'Firma guardada'
	})


@csrf_exempt
def ping(request):
	return JsonResponse({'ok': True})


def generate_id_signature(request):
	now = timezone.localtime(timezone.now())
	micro =f"{now.microsecond:06d}"
	fecha_id = f"{now:%Y%m%d %H:%M:%S}.{micro}"

	return JsonResponse({"id": fecha_id})