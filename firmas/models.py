from django.db import models


class Signature(models.Model):
	"""Modelo simple para almacenar imágenes de firma/huella y su plantilla opcional."""
	image = models.ImageField(upload_to='signatures/')
	template = models.TextField(blank=True, null=True, help_text='Plantilla de huella (ANSI/ISO) o datos asociados')
	filename = models.CharField(max_length=255, blank=True, null=True)
	created_at = models.DateTimeField(auto_now_add=True)

	def __str__(self):
		return f"Signature {self.id} - {self.filename or self.image.name}"
