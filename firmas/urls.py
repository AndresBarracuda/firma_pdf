from django.urls import path
from . import views
from .views import generate_id_signature

app_name = 'firmas'

urlpatterns = [
    path('', views.index, name='index'),
    path('api/signatures/upload/', views.upload_signature, name='upload_signature'),
    path('api/ping/', views.ping, name='ping'),
    path('api/generar-id/', generate_id_signature),
]
