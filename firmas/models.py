from datetime import date, timedelta
from django.db import models
from ckeditor.fields import RichTextField
from django.contrib.auth.hashers import make_password

class client(models.Model):
    """Modelo para almacenar información de clientes."""
    
    def save(self, *args, **kwargs):
        if self.password and not self.password.startswith('pbkdf2_sha256$'):
            self.password = make_password(self.password)
        super().save(*args, **kwargs)
    
    client_id = models.AutoField(verbose_name="ID de Cliente", primary_key=True)
    name = models.CharField(verbose_name="Nombre del Cliente", max_length=200)
    email = models.EmailField(verbose_name="Correo Electrónico", max_length=254, unique=True)
    phone = models.CharField(verbose_name="Número de Teléfono", max_length=20, blank=True, null=True)
    created_at = models.DateTimeField(verbose_name="Fecha de Creación", auto_now_add=True)
    password = models.CharField(verbose_name="Contraseña", max_length=128)
    
    class Meta:
        verbose_name = "Cliente"
        verbose_name_plural = "Clientes"
        ordering = ['client_id']
    
    def __str__(self):
        return "{}".format(self.name)



class Signature(models.Model):
	"""Modelo simple para almacenar imágenes de firma/huella y su plantilla opcional."""
	image = models.ImageField(upload_to='signatures/')
	template = models.TextField(blank=True, null=True, help_text='Plantilla de huella (ANSI/ISO) o datos asociados')
	filename = models.CharField(max_length=255, blank=True, null=True)
	created_at = models.DateTimeField(auto_now_add=True)

	def __str__(self):
		return f"Signature {self.id} - {self.filename or self.image.name}"
