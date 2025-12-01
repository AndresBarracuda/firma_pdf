from django.contrib import admin
from import_export import resources
from import_export.admin import ImportExportModelAdmin
from .models import *


class ClientResource(resources.ModelResource):
    class Meta:
        model = client
        import_id_fields = ('client_id')

class ClientAdmin(ImportExportModelAdmin, admin.ModelAdmin):
    searchs_fields = ['name', 'email', 'phone']
    list_display = ('client_id', 'name', 'email', 'phone', 'created_at')
    resource_class = ClientResource

admin.site.register(client, ClientAdmin)
    
    
# Register your models here.
